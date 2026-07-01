// Fathom webhook handler — receives meeting-ready events and logs meeting_held activities.
// Payload: calendar_invitees[], title, default_summary, recording_start_time, url
// Update-only — never creates new contacts from meeting invitees.

import { createHmac } from 'crypto';
import { getSupabaseClient, saveDocument, connectedAccountOwnerByEmail, attributeRelationship, isEntityInternal } from '@nous/core';
import { logActivity } from '../../utils/activity.mjs';
import { resolveMeetingContacts } from '../../utils/resolveMeeting.mjs';
import { enqueueForRetry } from '../../utils/webhookInbox.mjs';
import { logSysEvent } from '../../utils/systemLog.mjs';

function verifyFathomSignature(secret, rawBody, webhookId, webhookTimestamp, signatureHeader) {
  if (!secret || !signatureHeader || !webhookId || !webhookTimestamp) return true; // skip if not configured
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(webhookTimestamp, 10)) > 300) return false;

  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const secretKey = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const secretBytes = Buffer.from(secretKey, 'base64');
  const expected = createHmac('sha256', secretBytes).update(signedContent).digest('base64');

  const signatures = signatureHeader.split(' ').map(s => s.split(',').slice(1).join(','));
  return signatures.some(sig => {
    try { return sig === expected; } catch { return false; }
  });
}

export async function reprocessFathom(supabase, workspaceId, payload) {
  payload = payload || {};

  const title       = payload.title || payload.meeting_title || 'Untitled Meeting';
  const summary     = payload.default_summary?.markdown_formatted || payload.default_summary || null;
  const occurredAt  = payload.recording_start_time
    ? new Date(payload.recording_start_time).toISOString()
    : new Date().toISOString();
  const meetingUrl  = payload.share_url || payload.url || null;

  const invitees = (payload.calendar_invitees || []).filter(i => i.email?.includes('@'));
  if (!invitees.length) return { logged: 0, skipped: 'no_invitees' };

  // Attach to EXTERNAL invitees only — never the host/your own team (Fathom flags
  // internal attendees with is_external:false; unknown is kept). The shared layer
  // then enforces email-only matching, host exclusion, and co-attendance.
  const attendees = invitees
    .filter(i => i.is_external !== false)
    .map(i => ({ email: i.email, name: i.name || null }));

  // The host is the internal invitee Fathom flags is_external:false — recover it
  // so each external attendee's relationship attributes to the hosting rep.
  const hostEmail = invitees.find(i => i.is_external === false)?.email || null;
  const meetingOwnerUserId = await connectedAccountOwnerByEmail(supabase, workspaceId, hostEmail);

  const contacts = await resolveMeetingContacts(supabase, workspaceId, {
    startTime:      occurredAt,
    title,
    attendees,
    organizerEmail: null,
    source:         'fathom',
  });

  let logged = 0;
  for (const contact of contacts) {
    const externalId = `fathom_${payload.id || title}_${occurredAt.slice(0, 10)}_${contact.id}`;

    const result = await logActivity(supabase, {
      workspaceId,
      contactId:  contact.id,
      companyId:  contact.company_id || null,
      type:       'meeting_held',
      source:     'fathom',
      externalId,
      occurredAt,
      description: `Meeting: ${title}`,
      // Full recap — it feeds the fact extractor (extractAfterActivity reads the
      // activity summary) so it must not be pre-truncated; the timeline clamps the
      // display and the full recap is also kept as a meeting_notes document.
      summary:    summary || null,
      rawData:    { title, url: meetingUrl, invitees: invitees.map(i => i.email) },
      ownerUserId: meetingOwnerUserId,
    });
    if (result) {
      logged++;
      if (meetingOwnerUserId) {
        try {
          if (!(await isEntityInternal(supabase, workspaceId, contact.id))) {
            await attributeRelationship(supabase, workspaceId, contact.id, meetingOwnerUserId, { at: occurredAt });
          }
        } catch (e) { console.warn('[fathom] attribute failed', e.message); }
      }
      // Keep the FULL notes as a document on the contact — the activity summary
      // is truncated to 500 chars. Gated on `result` so retries (which dedup the
      // activity) don't duplicate the document.
      if (summary) {
        await saveDocument(supabase, workspaceId, {
          entityId: contact.id,
          type:     'meeting_notes',
          title:    `Meeting notes — ${title}`,
          content:  summary,
          date:     occurredAt,
          source:   'fathom',
          // The transcript/recap is raw content — scope it to the hosting rep + admins.
          meta:     { url: meetingUrl || null, owner_user_id: meetingOwnerUserId ?? null },
        }).catch(() => {});
      }
    }
  }

  console.log(`[FATHOM_WEBHOOK] workspace=${workspaceId} logged=${logged}`);

  await logSysEvent(supabase, {
    workspaceId, source: 'fathom', eventType: 'webhook_received',
    summary:    `Meeting recording: ${title} — ${logged} contact${logged === 1 ? '' : 's'} updated`,
    metadata:   { title, logged },
  });

  return { logged };
}

export async function handleFathom(req, res, workspaceId) {
  const supabase = getSupabaseClient();

  // Signature verification (only on live deliveries — retries trust the row)
  const secret = process.env.FATHOM_WEBHOOK_SECRET;
  if (secret) {
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
    const valid = verifyFathomSignature(
      secret, rawBody,
      req.headers['webhook-id'],
      req.headers['webhook-timestamp'],
      req.headers['webhook-signature'],
    );
    if (!valid) return res.status(401).json({ error: 'invalid_signature' });
  }

  try {
    const result = await reprocessFathom(supabase, workspaceId, req.body);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[FATHOM_WEBHOOK] processing failed, queuing for retry:', err.message);
    await enqueueForRetry(supabase, { workspaceId, source: 'fathom', req, err });
    return res.status(200).json({ ok: true, queued: true });
  }
}

// Fireflies.ai webhook handler — ported from assetly-blueprint/server/webhooks.mjs
// Receives meeting transcripts, resolves all participants, logs meeting_held activities.

import { getSupabaseClient } from '@nous/core';
import { logActivity } from '../../utils/activity.mjs';
import { resolveContact } from '../../utils/resolveContact.mjs';
import { enqueueForRetry } from '../../utils/webhookInbox.mjs';
import { logSysEvent } from '../../utils/systemLog.mjs';

async function extractMeetingFacts(title, participants) {
  const names = participants.map(p => p.name || p.email).filter(Boolean).join(', ');
  return `Meeting: ${title || 'Untitled'}${names ? ` — participants: ${names}` : ''}`;
}

export async function reprocessFireflies(supabase, workspaceId, body) {
  const { meetingId, title, participants = [], meeting_attendees = [], transcript_url, duration, summary: transcriptSummary } = body || {};

  if (!meetingId) throw new Error('meetingId_required');

  const allParticipants = [...participants, ...meeting_attendees];
  if (!allParticipants.length) return { logged: 0 };

  const meetingSummary = transcriptSummary || await extractMeetingFacts(title, allParticipants);

  let logged = 0;
  for (const participant of allParticipants) {
    const email     = participant.email?.toLowerCase() || null;
    const full_name = participant.name || null;
    if (!email && !full_name) continue;

    const { contact } = await resolveContact(supabase, workspaceId, {
      email, full_name, source: 'fireflies',
    }, { createIfMissing: false });

    if (!contact) continue;

    const result = await logActivity(supabase, {
      workspaceId,
      contactId:   contact.id,
      companyId:   contact.company_id || null,
      type:        'meeting_held',
      source:      'fireflies',
      externalId:  `ff_${meetingId}_${contact.id}`,
      occurredAt:  new Date().toISOString(),
      description: title || 'Meeting recorded',
      summary:     meetingSummary,
      rawData:     { transcript_url, meeting_id: meetingId, duration },
    });
    if (result) logged++;
  }

  await logSysEvent(supabase, {
    workspaceId, source: 'fireflies', eventType: 'webhook_received',
    summary:    `Meeting transcript received: ${title || 'Untitled'} — ${logged} contact${logged === 1 ? '' : 's'} updated`,
    metadata:   { meeting_id: meetingId, title, logged },
  });

  return { logged };
}

export async function handleFireflies(req, res, workspaceId) {
  const supabase = getSupabaseClient();
  try {
    const result = await reprocessFireflies(supabase, workspaceId, req.body);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[FIREFLIES_WEBHOOK] processing failed, queuing for retry:', err.message);
    await enqueueForRetry(supabase, { workspaceId, source: 'fireflies', req, err });
    return res.status(200).json({ ok: true, queued: true });
  }
}

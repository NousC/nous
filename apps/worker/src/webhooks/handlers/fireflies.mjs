// Fireflies.ai webhook handler.
//
// IMPORTANT: a Fireflies webhook is only a notification PING — it does NOT carry
// the transcript. The body looks like:
//   { "meetingId": "ASxol931...", "eventType": "Transcription completed" }
// To get participants/title/summary we must fetch the transcript from the
// Fireflies GraphQL API using the meetingId plus the workspace's stored API key.
// (The previous version read participants straight out of req.body, so every
// real webhook AND every test event short-circuited to a silent no-op.)

import { getSupabaseClient, saveDocument } from '@nous/core';
import { logActivity } from '../../utils/activity.mjs';
import { resolveMeetingContacts } from '../../utils/resolveMeeting.mjs';
import { enqueueForRetry } from '../../utils/webhookInbox.mjs';
import { logSysEvent } from '../../utils/systemLog.mjs';
import { decrypt } from '../../utils/encryption.mjs';

async function extractMeetingFacts(title, participants) {
  const names = participants.map(p => p.name || p.email).filter(Boolean).join(', ');
  return `Meeting: ${title || 'Untitled'}${names ? ` — participants: ${names}` : ''}`;
}

// Pull the workspace's Fireflies API key (BYOK), mirroring getProviderApiKey in
// utils/verifyLead.mjs. Returns null when Fireflies isn't connected here.
async function getFirefliesApiKey(supabase, workspaceId) {
  const { data: provider } = await supabase
    .from('workflow_providers').select('id').eq('name', 'fireflies').maybeSingle();
  if (!provider?.id) return null;
  const { data } = await supabase
    .from('workflow_provider_connections')
    .select('encrypted_credentials')
    .eq('workspace_id', workspaceId).eq('provider_id', provider.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data?.encrypted_credentials) return null;
  try { return decrypt(data.encrypted_credentials.api_key) || null; } catch { return null; }
}

// Fetch a single transcript by id. Returns the transcript object, or null when
// Fireflies has no transcript for that id (e.g. a test-event ping with a fake id).
async function fetchFirefliesTranscript(meetingId, apiKey) {
  const query = `query Transcript($id: String!) {
    transcript(id: $id) {
      id title date duration transcript_url
      host_email organizer_email
      participants
      meeting_attendees { displayName email name }
      summary { overview action_items keywords short_summary }
      sentences { speaker_name text }
    }
  }`;
  const res = await fetch('https://api.fireflies.ai/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, variables: { id: meetingId } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 401/403 → bad key; surface so it goes to retry/inbox rather than silently dropping.
    throw new Error(`fireflies_api_${res.status}: ${data?.errors?.[0]?.message || 'request failed'}`);
  }
  // A not-found / test-event id comes back as a GraphQL error or null transcript.
  if (data?.errors?.length && !data?.data?.transcript) return null;
  return data?.data?.transcript || null;
}

// Stitch Fireflies sentences into a readable "Speaker: line" transcript. Bounded
// so a multi-hour call can't blow up the stored document or its embedding.
function buildTranscriptText(sentences) {
  if (!Array.isArray(sentences) || !sentences.length) return null;
  const lines = [];
  for (const s of sentences) {
    const txt = String(s?.text || '').trim();
    if (txt) lines.push(`${s?.speaker_name || 'Speaker'}: ${txt}`);
  }
  const out = lines.join('\n').trim();
  return out ? out.slice(0, 100_000) : null;
}

// Normalize the various participant shapes Fireflies returns into {name, email},
// deduped by email (falling back to name). Accepts:
//   - meeting_attendees: [{ displayName, email, name }]
//   - participants: [String] (emails) OR [{ name, email }] (older shape / enriched body)
//   - host_email / organizer_email: bare strings
function normalizeParticipants(participants = [], attendees = [], ...extraEmails) {
  const out = new Map();
  const add = (email, name) => {
    const e = email ? String(email).toLowerCase().trim() : null;
    const n = name ? String(name).trim() : null;
    if (!e && !n) return;
    const key = e || `name:${n.toLowerCase()}`;
    const prev = out.get(key);
    out.set(key, { email: e || prev?.email || null, name: n || prev?.name || null });
  };
  for (const a of attendees || []) {
    if (!a) continue;
    if (typeof a === 'string') add(a, null);
    else add(a.email, a.displayName || a.name);
  }
  for (const p of participants || []) {
    if (!p) continue;
    if (typeof p === 'string') add(p, null);
    else add(p.email, p.name);
  }
  for (const e of extraEmails) if (e) add(e, null);
  return [...out.values()];
}

export async function reprocessFireflies(supabase, workspaceId, body) {
  const { meetingId, meeting_id, eventType } = body || {};
  const id = meetingId || meeting_id;
  if (!id) throw new Error('meetingId_required');

  // Accept an already-hydrated body (webhook-retry of an enriched payload, or a
  // self-host manual post). Otherwise fetch the transcript from the API.
  let { title, transcript_url, duration, summary: transcriptSummary } = body || {};
  let meetingDate    = body?.date || null;
  let actionItems    = body?.action_items || null;
  let keywords       = Array.isArray(body?.keywords) ? body.keywords : [];
  let transcriptText = body?.transcript_text || null;
  let hostEmail      = body?.organizer_email || body?.host_email || null;
  let allParticipants = normalizeParticipants(body?.participants, body?.meeting_attendees);

  if (!allParticipants.length) {
    const apiKey = await getFirefliesApiKey(supabase, workspaceId);
    if (!apiKey) {
      await logSysEvent(supabase, {
        workspaceId, source: 'fireflies', eventType: 'webhook_received',
        summary:  `Fireflies webhook received (meeting ${id}) but Fireflies isn't connected here — connect it in Integrations to ingest transcripts`,
        metadata: { meeting_id: id, event_type: eventType || null, logged: 0, reason: 'no_connection' },
      });
      return { logged: 0, reason: 'no_connection' };
    }

    const t = await fetchFirefliesTranscript(id, apiKey);
    if (!t) {
      await logSysEvent(supabase, {
        workspaceId, source: 'fireflies', eventType: 'webhook_received',
        summary:  `Fireflies webhook received (meeting ${id}) — no matching transcript found (likely a test event)`,
        metadata: { meeting_id: id, event_type: eventType || null, logged: 0, reason: 'transcript_not_found' },
      });
      return { logged: 0, reason: 'transcript_not_found' };
    }

    title             = t.title || title;
    transcript_url    = t.transcript_url || transcript_url;
    duration          = t.duration ?? duration;
    transcriptSummary = t.summary?.overview || transcriptSummary || null;
    actionItems       = t.summary?.action_items || actionItems || null;
    keywords          = Array.isArray(t.summary?.keywords) ? t.summary.keywords : keywords;
    transcriptText    = buildTranscriptText(t.sentences) || transcriptText;
    meetingDate       = t.date || meetingDate;
    hostEmail         = t.host_email || t.organizer_email || hostEmail;
    allParticipants   = normalizeParticipants(t.participants, t.meeting_attendees, t.host_email, t.organizer_email);
  }

  // Digest = AI overview + action items + keywords. This is what the activity
  // carries and what feeds the fact extractor (it reads the activity summary) —
  // action items in particular surface next steps, owners, and commitments.
  const digestParts = [];
  if (transcriptSummary) digestParts.push(transcriptSummary);
  if (actionItems)       digestParts.push(`Action items:\n${actionItems}`);
  if (keywords.length)   digestParts.push(`Keywords: ${keywords.slice(0, 20).join(', ')}`);
  const digest = digestParts.join('\n\n').trim() || null;
  const meetingSummary = digest || await extractMeetingFacts(title, allParticipants);
  // Fireflies `date` is an epoch-ms timestamp (or an ISO string on enriched bodies).
  let occurredAt = new Date().toISOString();
  if (meetingDate != null) {
    const d = new Date(meetingDate); // accepts epoch-ms number or ISO string
    if (!isNaN(d.getTime())) occurredAt = d.toISOString();
  }

  // Resolve who this meeting belongs to via the shared layer: attendee identity
  // match PLUS co-attendance (match to an existing booking by time/title). The
  // latter attaches the transcript to the right person even when they joined from
  // an email we don't have on file — and learns that alternate email for next time.
  const contacts = await resolveMeetingContacts(supabase, workspaceId, {
    startTime:      occurredAt,
    title,
    attendees:      allParticipants,
    organizerEmail: hostEmail,
    source:         'fireflies',
  });

  let logged = 0;
  for (const contact of contacts) {
    const result = await logActivity(supabase, {
      workspaceId,
      contactId:   contact.id,
      companyId:   contact.company_id || null,
      type:        'meeting_held',
      source:      'fireflies',
      externalId:  `ff_${id}_${contact.id}`,
      occurredAt:  occurredAt || new Date().toISOString(),
      description: title || 'Meeting recorded',
      summary:     meetingSummary,
      rawData:     { transcript_url, meeting_id: id, duration },
    });
    if (result) {
      logged++;
      // ONE "Meeting notes" document per call: the digest (summary + action items
      // + keywords) on top, the full word-for-word transcript below. Kept in the
      // Notes tab, out of the timeline. Gated on `result` so webhook retries don't
      // duplicate it.
      const notesContent = [
        digest,
        transcriptText ? `———— Transcript ————\n\n${transcriptText}` : null,
      ].filter(Boolean).join('\n\n') || null;
      if (notesContent) {
        await saveDocument(supabase, workspaceId, {
          entityId: contact.id,
          type:     'meeting_notes',
          title:    `Meeting notes — ${title || 'Untitled'}`,
          content:  notesContent,
          date:     new Date().toISOString(),
          source:   'fireflies',
          meta:     { meeting_id: id, transcript_url: transcript_url || null, duration: duration || null },
        }).catch(() => {});
      }
    }

  }

  await logSysEvent(supabase, {
    workspaceId, source: 'fireflies', eventType: 'webhook_received',
    summary:    `Meeting transcript received: ${title || 'Untitled'} — ${logged} contact${logged === 1 ? '' : 's'} updated`,
    metadata:   { meeting_id: id, title: title || null, attendees: allParticipants.length, logged },
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

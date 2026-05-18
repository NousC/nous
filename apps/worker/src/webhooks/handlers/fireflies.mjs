// Fireflies.ai webhook handler — ported from assetly-blueprint/server/webhooks.mjs
// Receives meeting transcripts, resolves all participants, logs meeting_held activities.

import { getSupabaseClient } from '@nous/core';
import { logActivity } from '../../utils/activity.mjs';
import { resolveContact } from '../../utils/resolveContact.mjs';

async function extractMeetingFacts(title, participants) {
  const names = participants.map(p => p.name || p.email).filter(Boolean).join(', ');
  return `Meeting: ${title || 'Untitled'}${names ? ` — participants: ${names}` : ''}`;
}

export async function handleFireflies(req, res, workspaceId) {
  const supabase = getSupabaseClient();
  const { meetingId, title, participants = [], meeting_attendees = [], transcript_url, duration, summary: transcriptSummary } = req.body;

  if (!meetingId) return res.status(400).json({ error: 'meetingId_required' });

  const allParticipants = [...participants, ...meeting_attendees];
  if (!allParticipants.length) return res.json({ ok: true, logged: 0 });

  // Build a rich summary for signal extraction — include transcript summary if available
  const meetingSummary = transcriptSummary
    || await extractMeetingFacts(title, allParticipants);

  let logged = 0;
  for (const participant of allParticipants) {
    const email     = participant.email?.toLowerCase() || null;
    const full_name = participant.name || null;
    if (!email && !full_name) continue;

    // Update-only — Fireflies never bootstraps new contacts
    const { contact } = await resolveContact(supabase, workspaceId, {
      email,
      full_name,
      source: 'fireflies',
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

  return res.json({ ok: true, logged });
}

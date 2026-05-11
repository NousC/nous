// Fireflies.ai webhook handler — receives meeting transcripts, logs meeting_held activities.

import { getSupabaseClient, logActivity } from '@proply/core';

export async function handleFireflies(req, res, workspaceId) {
  const supabase = getSupabaseClient();
  const { meetingId, title, participants = [], transcript_url, meeting_attendees = [] } = req.body;

  if (!meetingId) return res.status(400).json({ error: 'meetingId_required' });

  const allParticipants = [...participants, ...meeting_attendees];

  let logged = 0;
  for (const participant of allParticipants) {
    const email = participant.email?.toLowerCase();
    if (!email) continue;

    const { data: contact } = await supabase
      .from('contacts')
      .select('id, company_id')
      .eq('workspace_id', workspaceId)
      .eq('email', email)
      .maybeSingle();

    if (!contact) continue;

    const result = await logActivity(supabase, {
      workspaceId,
      contactId:   contact.id,
      companyId:   contact.company_id || null,
      type:        'meeting_held',
      source:      'fireflies',
      externalId:  `ff_${meetingId}_${contact.id}`,
      description: title || 'Meeting recorded',
      rawData:     { transcript_url, meeting_id: meetingId },
    });
    if (result) logged++;
  }

  return res.json({ ok: true, logged });
}

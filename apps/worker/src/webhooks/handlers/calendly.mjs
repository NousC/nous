// Calendly webhook handler — receives booking events and logs meeting activities.
// invitee.created → meeting_scheduled + creates contact if missing (booking = strong intent signal).
// invitee.canceled → meeting_cancelled on existing contact only.

import { getSupabaseClient } from '@proply/core';
import { logActivity } from '../../utils/activity.mjs';
import { resolveContact } from '../../utils/resolveContact.mjs';

export async function handleCalendly(req, res, workspaceId) {
  const supabase = getSupabaseClient();
  const body = req.body;

  const event   = body.event || body.event_type || '';
  const payload = body.payload || body;

  console.log(`[CALENDLY_WEBHOOK] event=${event}`);

  if (!['invitee.created', 'invitee.canceled', 'invitee_created', 'invitee_canceled'].includes(event)) {
    console.log(`[CALENDLY_WEBHOOK] unhandled event: ${event}`);
    return res.json({ ok: true, skipped: `unhandled event: ${event}` });
  }

  const isCanceled = event.includes('canceled');

  // Invitee details
  const invitee     = payload.invitee  || payload;
  const eventObj    = payload.event    || payload.scheduled_event || {};
  const eventType   = payload.event_type || {};

  const email       = (invitee.email || '').toLowerCase().trim();
  const name        = invitee.name || null;
  const startTime   = eventObj.start_time || eventObj.start || null;
  const endTime     = eventObj.end_time   || eventObj.end   || null;
  const meetingName = eventType.name || eventObj.name || 'Meeting';
  const inviteeUri  = invitee.uri || null;

  if (!email) return res.status(400).json({ error: 'invitee_email_required' });

  const nameParts = name?.trim().split(/\s+/) || [];

  const { contact } = await resolveContact(supabase, workspaceId, {
    email,
    first_name: nameParts[0] || null,
    last_name:  nameParts.slice(1).join(' ') || null,
    source:     'calendly',
  }, { createIfMissing: !isCanceled }); // only create on bookings, not cancellations

  if (!contact) return res.json({ ok: true, skipped: isCanceled ? 'contact not found' : 'could not create contact' });

  const occurredAt = startTime ? new Date(startTime).toISOString() : new Date().toISOString();

  // Use invitee URI slug as stable external ID for dedup
  const uriSlug = inviteeUri?.split('/').pop() || null;
  const externalId = uriSlug
    ? `calendly_${isCanceled ? 'cancel' : 'book'}_${uriSlug}`
    : `calendly_${isCanceled ? 'cancel' : 'book'}_${email}_${occurredAt.slice(0, 10)}`;

  await logActivity(supabase, {
    workspaceId,
    contactId:   contact.id,
    companyId:   contact.company_id || null,
    type:        isCanceled ? 'meeting_cancelled' : 'meeting_scheduled',
    source:      'calendly',
    externalId,
    occurredAt,
    description: isCanceled
      ? `Cancelled: ${meetingName}`
      : `Booked: ${meetingName}`,
    rawData:     { meeting_name: meetingName, start_time: startTime, end_time: endTime, invitee_uri: inviteeUri },
  });

  return res.json({ ok: true, contactId: contact.id, type: isCanceled ? 'meeting_cancelled' : 'meeting_scheduled' });
}

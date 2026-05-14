// Instantly.ai webhook handler — receives email campaign events and logs them as activities.
// Supported events: reply_received, email_sent, email_opened, email_bounced, unsubscribed.
// Resolves contact by lead_email (update-only — Instantly never bootstraps new contacts).

import { getSupabaseClient } from '@proply/core';
import { logActivity } from '../../utils/activity.mjs';
import { resolveContact } from '../../utils/resolveContact.mjs';

// Map Instantly event types to CRM activity types
const EVENT_TYPE_MAP = {
  reply_received:     'email_received',
  email_replied:      'email_received',
  email_sent:         'email_sent',
  email_opened:       'email_opened',
  email_bounced:      'email_bounced',
  unsubscribed:       'email_bounced',
};

export async function handleInstantly(req, res, workspaceId) {
  const supabase = getSupabaseClient();
  const body = req.body;

  // Instantly can send either top-level fields or nested under event_data
  const eventType  = body.event_type  || body.event  || body.type || '';
  const leadEmail  = (body.lead_email || body.email  || body.lead?.email || '').toLowerCase().trim();
  const firstName  = body.lead_first_name || body.first_name || null;
  const lastName   = body.lead_last_name  || body.last_name  || null;
  const campaignId = body.campaign_id   || null;
  const campaignName = body.campaign_name || body.campaign || null;
  const preview    = body.preview_text  || body.reply_text || body.body || null;
  const messageId  = body.message_id    || body.email_id   || null;

  console.log(`[INSTANTLY_WEBHOOK] event=${eventType} email=${leadEmail}`);

  if (!leadEmail) return res.status(400).json({ error: 'lead_email_required' });

  const activityType = EVENT_TYPE_MAP[eventType];
  if (!activityType) {
    console.log(`[INSTANTLY_WEBHOOK] unhandled event: ${eventType}`);
    return res.json({ ok: true, skipped: `unhandled event: ${eventType}` });
  }

  const { contact } = await resolveContact(supabase, workspaceId, {
    email:      leadEmail,
    first_name: firstName,
    last_name:  lastName,
    source:     'instantly',
  }, { createIfMissing: false });

  if (!contact) return res.json({ ok: true, skipped: 'contact not found' });

  const externalId = messageId
    ? `instantly_${messageId}`
    : `instantly_${eventType}_${leadEmail}_${Date.now()}`;

  await logActivity(supabase, {
    workspaceId,
    contactId:   contact.id,
    companyId:   contact.company_id || null,
    type:        activityType,
    source:      'instantly',
    externalId,
    occurredAt:  new Date().toISOString(),
    description: campaignName
      ? `${activityType.replace('_', ' ')}: ${campaignName}`
      : activityType.replace('_', ' '),
    summary:     activityType === 'email_received' && preview ? preview.slice(0, 500) : null,
    rawData:     { event_type: eventType, campaign_id: campaignId, campaign_name: campaignName },
  });

  return res.json({ ok: true, contactId: contact.id, type: activityType });
}

// Smartlead webhook handler — receives email outbound events.
// Smartlead payloads look like: { event: "EMAIL_REPLIED" | ..., campaign_id, campaign_name,
//   lead: { email, first_name, last_name, company_name, ... }, reply: {...} (for replies), timestamp }
// Per-campaign webhooks register via POST https://server.smartlead.ai/api/v1/webhooks/create?api_key=...
// We keep registration manual (Smartlead UI) since their model is per-campaign,
// which is awkward to auto-register across an unbounded campaign set.

import { getSupabaseClient } from '@nous/core';
import { logActivity } from '../../utils/activity.mjs';
import { resolveContact } from '../../utils/resolveContact.mjs';
import { enqueueForRetry } from '../../utils/webhookInbox.mjs';
import { logSysEvent } from '../../utils/systemLog.mjs';

const EVENT_TYPE_MAP = {
  EMAIL_SENT:         'email_sent',
  EMAIL_OPENED:       'email_opened',
  EMAIL_CLICKED:      'email_opened',
  EMAIL_REPLIED:      'email_received',
  EMAIL_BOUNCED:      'email_bounced',
  EMAIL_UNSUBSCRIBED: 'email_bounced',
};

function pickLead(body) {
  return body.lead || body.lead_data || body.to_lead || {};
}

export async function reprocessSmartlead(supabase, workspaceId, body) {
  body = body || {};
  const eventType   = (body.event || body.event_type || body.type || '').toString().toUpperCase();
  const lead        = pickLead(body);
  const leadEmail   = (lead.email || body.to_email || body.recipient_email || '').toLowerCase().trim();
  const firstName   = lead.first_name || lead.firstName || null;
  const lastName    = lead.last_name  || lead.lastName  || null;
  const companyName = lead.company_name || lead.company || null;
  const campaignId  = body.campaign_id   || body.campaignId   || null;
  const campaignName = body.campaign_name || body.campaignName || null;
  const replyText   = body.reply?.text || body.reply?.body || body.reply_text || body.body || null;
  const messageId   = body.message_id   || body.email_id    || body.id || null;

  console.log(`[SMARTLEAD_WEBHOOK] event=${eventType} email=${leadEmail}`);

  const activityType = EVENT_TYPE_MAP[eventType];
  if (!activityType) {
    await logSysEvent(supabase, {
      workspaceId, source: 'smartlead', eventType: 'webhook_unknown_event',
      summary:  `Unhandled Smartlead event: ${eventType || '(missing event)'}`,
      metadata: { type: eventType, sample_keys: Object.keys(body).slice(0, 12) },
    });
    return { skipped: `unhandled event: ${eventType}` };
  }

  if (!leadEmail) throw new Error('lead_email_required');

  const isReply = activityType === 'email_received';

  const { contact } = await resolveContact(supabase, workspaceId, {
    email:      leadEmail,
    first_name: firstName,
    last_name:  lastName,
    company:    companyName,
    source:     'smartlead',
  }, { createIfMissing: isReply });

  if (!contact) return { skipped: 'contact not found' };

  const externalId = messageId
    ? `smartlead_${messageId}`
    : `smartlead_${eventType}_${leadEmail}_${Date.now()}`;

  await logActivity(supabase, {
    workspaceId,
    contactId:   contact.id,
    companyId:   contact.company_id || null,
    type:        activityType,
    source:      'smartlead',
    externalId,
    occurredAt:  new Date().toISOString(),
    description: campaignName
      ? `${activityType.replace('_', ' ')}: ${campaignName}`
      : activityType.replace('_', ' '),
    summary:     isReply && replyText ? String(replyText).slice(0, 500) : null,
    rawData:     { event_type: eventType, campaign_id: campaignId, campaign_name: campaignName },
  });

  await logSysEvent(supabase, {
    workspaceId, source: 'smartlead', eventType: 'webhook_received',
    summary:    `${activityType.replace('_', ' ')} from ${leadEmail}${campaignName ? ` (${campaignName})` : ''}`,
    contactId:  contact.id,
    metadata:   { type: eventType, email: leadEmail, campaign_name: campaignName },
  });

  return { contactId: contact.id, type: activityType };
}

export async function handleSmartlead(req, res, workspaceId) {
  const supabase = getSupabaseClient();
  try {
    const result = await reprocessSmartlead(supabase, workspaceId, req.body);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[SMARTLEAD_WEBHOOK] processing failed, queuing for retry:', err.message);
    await enqueueForRetry(supabase, { workspaceId, source: 'smartlead', req, err });
    return res.status(200).json({ ok: true, queued: true });
  }
}

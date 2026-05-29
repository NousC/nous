// Instantly.ai webhook handler — receives email campaign events and logs them as activities.
// Supported events: reply_received, email_sent, email_opened, email_bounced, unsubscribed.
// reply_received creates new contacts (a reply = strong intent signal).
// All other events are update-only.

import { getSupabaseClient, upsertCampaignMessage } from '@nous/core';
import { logActivity } from '../../utils/activity.mjs';
import { resolveContact } from '../../utils/resolveContact.mjs';
import { enqueueForRetry } from '../../utils/webhookInbox.mjs';
import { logSysEvent } from '../../utils/systemLog.mjs';

const EVENT_TYPE_MAP = {
  reply_received:     'email_received',
  email_replied:      'email_received',
  email_sent:         'email_sent',
  email_opened:       'email_opened',
  email_bounced:      'email_bounced',
  unsubscribed:       'email_bounced',
};

export async function reprocessInstantly(supabase, workspaceId, body) {
  body = body || {};
  const eventType  = body.event_type  || body.event  || body.type || '';
  const leadEmail  = (body.lead_email || body.email  || body.lead?.email || '').toLowerCase().trim();
  const firstName  = body.lead_first_name || body.first_name || null;
  const lastName   = body.lead_last_name  || body.last_name  || null;
  const campaignId = body.campaign_id   || null;
  const campaignName = body.campaign_name || body.campaign || null;
  const preview    = body.preview_text  || body.reply_text || body.body || null;
  const messageId  = body.message_id    || body.email_id   || null;
  // Variant attribution — which email earned this event. Lands on the
  // observation via rawData, so the People timeline and the lead-list
  // campaign analysis both read it. Defensive picks; null when absent.
  const step       = body.step ?? body.step_number ?? body.sequence_step ?? null;
  const variant    = body.variant ?? body.email_variant ?? body.step_variant ?? null;
  const subject    = body.email_subject ?? body.subject ?? null;
  const sentBody   = body.email_body ?? body.sent_message ?? body.body_html ?? null;

  console.log(`[INSTANTLY_WEBHOOK] event=${eventType} email=${leadEmail}`);

  if (!leadEmail) throw new Error('lead_email_required');

  const activityType = EVENT_TYPE_MAP[eventType];
  if (!activityType) return { skipped: `unhandled event: ${eventType}` };

  const isReply = eventType === 'reply_received' || eventType === 'email_replied';
  const isSent  = activityType === 'email_sent';

  const { contact } = await resolveContact(supabase, workspaceId, {
    email:      leadEmail,
    first_name: firstName,
    last_name:  lastName,
    source:     'instantly',
  }, { createIfMissing: isReply });

  if (!contact) return { skipped: 'contact not found' };

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
    summary:     isReply && preview ? preview.slice(0, 500)
                 : isSent ? ((sentBody || subject || '').slice(0, 2000) || null)
                 : null,
    rawData:     {
      event_type: eventType, campaign_id: campaignId, campaign_name: campaignName,
      step, variant, subject,
      ...(isSent ? { is_outbound: true } : {}),
    },
  });

  // Stash the sent copy per (campaign, step, variant) so the timeline can show
  // the body and replies can be attributed to the exact email later.
  if (isSent && campaignId && (subject || sentBody)) {
    upsertCampaignMessage(supabase, workspaceId, {
      provider: 'instantly', campaignId, campaignName, step, variant,
      subject, body: sentBody, source: 'webhook',
    }).catch(() => {});
  }

  await logSysEvent(supabase, {
    workspaceId, source: 'instantly', eventType: 'webhook_received',
    summary:    `${activityType.replace('_', ' ')} from ${leadEmail}${campaignName ? ` (${campaignName})` : ''}`,
    contactId:  contact.id,
    metadata:   { type: eventType, email: leadEmail, campaign_name: campaignName },
  });

  return { contactId: contact.id, type: activityType };
}

export async function handleInstantly(req, res, workspaceId) {
  const supabase = getSupabaseClient();
  try {
    const result = await reprocessInstantly(supabase, workspaceId, req.body);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[INSTANTLY_WEBHOOK] processing failed, queuing for retry:', err.message);
    await enqueueForRetry(supabase, { workspaceId, source: 'instantly', req, err });
    return res.status(200).json({ ok: true, queued: true });
  }
}

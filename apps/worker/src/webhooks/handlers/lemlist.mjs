// Lemlist webhook handler — receives outbound email + LinkedIn campaign events.
//
// Lemlist payloads carry a flat shape with a `type` field (e.g. "emailsReplied")
// plus campaign / lead metadata. Per docs the common fields are:
//   { _id, type, campaignId, campaignName, leadId, email, firstName, lastName,
//     text, messageId, createdAt, secret? }
//
// Auth: Lemlist supports an optional `secret` field set at webhook-creation time
// that's echoed back in every delivery. The route in webhooks/index.mjs checks
// it against LEMLIST_WEBHOOK_SECRET if set.
//
// Event selection: we map the granular event types (emailsSent, emailsReplied,
// linkedinSent, etc.) rather than Lemlist's "lead state" aggregates (contacted,
// hooked, warmed, ...). The state aggregates conflate channels — we want the
// channel-specific signal on the contact timeline. LinkedIn inbound events
// (linkedinReplied, linkedinInviteAccepted) are skipped because the native
// LinkedIn integration (Unipile) is already the source of truth for those —
// same logic as HeyReach.

import { getSupabaseClient } from '@nous/core';
import { logActivity } from '../../utils/activity.mjs';
import { resolveContact } from '../../utils/resolveContact.mjs';
import { enqueueForRetry } from '../../utils/webhookInbox.mjs';
import { logSysEvent } from '../../utils/systemLog.mjs';

const EVENT_TYPE_MAP = {
  // Email
  emailsSent:         'email_sent',
  emailsOpened:       'email_opened',
  emailsClicked:      'email_opened',
  emailsReplied:      'email_received',
  emailsBounced:      'email_bounced',
  emailsFailed:       'email_bounced',
  emailsInterested:   'email_received',     // strong intent — treat as a reply
  emailsUnsubscribed: 'email_bounced',
  // LinkedIn (outbound only — Unipile covers inbound)
  linkedinSent:             'linkedin_message_sent',
  linkedinOpened:           'linkedin_message_opened',
  linkedinInviteDone:       'linkedin_connection_sent',
  linkedinFollowDone:       'linkedin_follow_sent',
  linkedinVisitDone:        'linkedin_profile_view',
  linkedinLikeLastPostDone: 'linkedin_like',
  linkedinVoiceNoteDone:    'linkedin_message_sent',
  // Lifecycle
  campaignComplete: 'campaign_completed',
};

function pickEmail(body) {
  return (
    body.email ||
    body.leadEmail ||
    body.lead?.email ||
    ''
  ).toString().toLowerCase().trim();
}

export async function reprocessLemlist(supabase, workspaceId, body) {
  body = body || {};
  const eventType    = body.type || body.event || '';
  const leadEmail    = pickEmail(body);
  const firstName    = body.firstName || body.lead?.firstName || body.first_name || null;
  const lastName     = body.lastName  || body.lead?.lastName  || body.last_name  || null;
  const campaignId   = body.campaignId   || body.campaign?._id   || body.campaign?.id   || null;
  const campaignName = body.campaignName || body.campaign?.name || null;
  const preview      = body.text || body.replyText || body.body || null;
  const messageId    = body.messageId || body._id || null;

  console.log(`[LEMLIST_WEBHOOK] event=${eventType} email=${leadEmail}`);

  const activityType = EVENT_TYPE_MAP[eventType];
  if (!activityType) {
    await logSysEvent(supabase, {
      workspaceId, source: 'lemlist', eventType: 'webhook_unknown_event',
      summary:  `Unhandled Lemlist event: ${eventType || '(missing type)'}`,
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
    source:     'lemlist',
  }, { createIfMissing: isReply });

  if (!contact) return { skipped: 'contact not found' };

  const externalId = messageId
    ? `lemlist_${messageId}`
    : `lemlist_${eventType}_${leadEmail}_${Date.now()}`;

  await logActivity(supabase, {
    workspaceId,
    contactId:   contact.id,
    companyId:   contact.company_id || null,
    type:        activityType,
    source:      'lemlist',
    externalId,
    occurredAt:  new Date().toISOString(),
    description: campaignName
      ? `${activityType.replace(/_/g, ' ')}: ${campaignName}`
      : activityType.replace(/_/g, ' '),
    summary:     isReply && preview ? String(preview).slice(0, 500) : null,
    rawData:     { event_type: eventType, campaign_id: campaignId, campaign_name: campaignName },
  });

  await logSysEvent(supabase, {
    workspaceId, source: 'lemlist', eventType: 'webhook_received',
    summary:    `${activityType.replace(/_/g, ' ')} from ${leadEmail}${campaignName ? ` (${campaignName})` : ''}`,
    contactId:  contact.id,
    metadata:   { type: eventType, email: leadEmail, campaign_name: campaignName },
  });

  return { contactId: contact.id, type: activityType };
}

export async function handleLemlist(req, res, workspaceId) {
  const supabase = getSupabaseClient();
  try {
    const result = await reprocessLemlist(supabase, workspaceId, req.body);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[LEMLIST_WEBHOOK] processing failed, queuing for retry:', err.message);
    await enqueueForRetry(supabase, { workspaceId, source: 'lemlist', req, err });
    return res.status(200).json({ ok: true, queued: true });
  }
}

// Calendly webhook handler — receives booking events and logs meeting activities.
// invitee.created → meeting_scheduled + creates contact if missing (booking = strong intent signal).
// invitee.canceled → meeting_cancelled on existing contact only.
//
// Signature verification (Calendly-Webhook-Signature: t=<unix_ts>,v1=<hex_hmac>):
// HMAC-SHA256 of `${t}.${rawBody}` keyed with the per-workspace signing_key
// supplied to Calendly at subscription time. Replay window: 5 minutes.

import crypto from 'crypto';
import { getSupabaseClient } from '@proply/core';
import { decrypt } from '../../utils/encryption.mjs';
import { logActivity } from '../../utils/activity.mjs';
import { resolveContact } from '../../utils/resolveContact.mjs';

const REPLAY_WINDOW_SEC = 5 * 60;

function parseSignatureHeader(header) {
  if (!header || typeof header !== 'string') return null;
  const out = {};
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2);
    if (k && v) out[k.trim()] = v.trim();
  }
  if (!out.t || !out.v1) return null;
  return out;
}

async function loadCalendlySigningKey(supabase, workspaceId) {
  const { data: conn } = await supabase
    .from('workflow_provider_connections')
    .select('encrypted_credentials, workflow_providers!inner(name)')
    .eq('workspace_id', workspaceId)
    .eq('workflow_providers.name', 'calendly')
    .maybeSingle();
  const encryptedKey = conn?.encrypted_credentials?.webhook_signing_key;
  if (!encryptedKey) return null;
  try { return decrypt(encryptedKey); }
  catch { return null; }
}

export async function handleCalendly(req, res, workspaceId) {
  const supabase = getSupabaseClient();

  const signingKey = await loadCalendlySigningKey(supabase, workspaceId);
  if (!signingKey) {
    console.warn(`[CALENDLY_WEBHOOK] no signing key on file for workspace ${workspaceId} — rejecting`);
    return res.status(401).json({ error: 'no_signing_key' });
  }

  const parsed = parseSignatureHeader(req.headers['calendly-webhook-signature']);
  if (!parsed) return res.status(401).json({ error: 'missing_signature' });

  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - Number(parsed.t));
  if (!Number.isFinite(ageSec) || ageSec > REPLAY_WINDOW_SEC) {
    return res.status(401).json({ error: 'stale_signature' });
  }

  const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
  const signedPayload = `${parsed.t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', signingKey).update(signedPayload).digest('hex');

  const sigBuf = Buffer.from(parsed.v1, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }

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

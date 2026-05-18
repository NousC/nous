// Cal.com webhook handler — receives BOOKING_CREATED, BOOKING_CANCELLED, and
// BOOKING_RESCHEDULED events and logs meeting activities.
//
// Signature: x-cal-signature-256 is the hex HMAC-SHA256 of the raw request body
// keyed with the secret we supplied to Cal.com at subscription time. We look
// the secret up per-workspace from workflow_provider_connections.

import crypto from 'crypto';
import { getSupabaseClient } from '@proply/core';
import { decrypt } from '../../utils/encryption.mjs';
import { logActivity } from '../../utils/activity.mjs';
import { resolveContact } from '../../utils/resolveContact.mjs';

async function loadCalComSigningKey(supabase, workspaceId) {
  const { data: conn } = await supabase
    .from('workflow_provider_connections')
    .select('encrypted_credentials, workflow_providers!inner(name)')
    .eq('workspace_id', workspaceId)
    .eq('workflow_providers.name', 'cal_com')
    .maybeSingle();
  const encryptedKey = conn?.encrypted_credentials?.webhook_signing_key;
  if (!encryptedKey) return null;
  try { return decrypt(encryptedKey); }
  catch { return null; }
}

export async function handleCalCom(req, res, workspaceId) {
  const supabase = getSupabaseClient();

  const signingKey = await loadCalComSigningKey(supabase, workspaceId);
  if (!signingKey) {
    console.warn(`[CAL_COM_WEBHOOK] no signing key on file for workspace ${workspaceId} — rejecting`);
    return res.status(401).json({ error: 'no_signing_key' });
  }

  const sig = req.headers['x-cal-signature-256'];
  if (!sig || typeof sig !== 'string') return res.status(401).json({ error: 'missing_signature' });

  const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', signingKey).update(rawBody).digest('hex');

  // Cal.com sends the hex digest directly (no "sha256=" prefix). Accept the
  // prefixed form too in case that changes — strip it before comparison.
  const sigHex = sig.replace(/^sha256=/i, '').trim();
  let sigBuf, expBuf;
  try { sigBuf = Buffer.from(sigHex, 'hex'); expBuf = Buffer.from(expected, 'hex'); }
  catch { return res.status(401).json({ error: 'invalid_signature' }); }
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  const body = req.body || {};
  const trigger = body.triggerEvent || body.event || '';
  const payload = body.payload || body;

  console.log(`[CAL_COM_WEBHOOK] trigger=${trigger}`);

  const known = ['BOOKING_CREATED', 'BOOKING_CANCELLED', 'BOOKING_RESCHEDULED'];
  if (!known.includes(trigger)) {
    return res.json({ ok: true, skipped: `unhandled trigger: ${trigger}` });
  }

  const isCanceled = trigger === 'BOOKING_CANCELLED';

  // Cal.com payload includes attendees[] — first one is typically the booker.
  const attendees = Array.isArray(payload.attendees) ? payload.attendees : [];
  const primary   = attendees[0] || {};
  const email     = (primary.email || '').toLowerCase().trim();
  const name      = primary.name || '';
  const startTime = payload.startTime || payload.start || null;
  const endTime   = payload.endTime   || payload.end   || null;
  const title     = payload.title || payload.eventType?.title || 'Meeting';
  const bookingUid = payload.uid || payload.bookingUid || null;

  if (!email) return res.status(400).json({ error: 'attendee_email_required' });

  const nameParts = name.trim().split(/\s+/).filter(Boolean);

  const { contact } = await resolveContact(supabase, workspaceId, {
    email,
    first_name: nameParts[0] || null,
    last_name:  nameParts.slice(1).join(' ') || null,
    source:     'cal_com',
  }, { createIfMissing: !isCanceled });

  if (!contact) return res.json({ ok: true, skipped: isCanceled ? 'contact not found' : 'could not create contact' });

  const occurredAt = startTime ? new Date(startTime).toISOString() : new Date().toISOString();

  // External ID keyed on booking uid — same key used by scanCalCom backfill
  // so a meeting discovered both ways dedupes cleanly.
  const externalId = bookingUid
    ? `cal_com_${isCanceled ? 'cancel' : 'book'}_${bookingUid}`
    : `cal_com_${isCanceled ? 'cancel' : 'book'}_${email}_${occurredAt.slice(0, 10)}`;

  await logActivity(supabase, {
    workspaceId,
    contactId:   contact.id,
    companyId:   contact.company_id || null,
    type:        isCanceled ? 'meeting_cancelled' : 'meeting_scheduled',
    source:      'cal_com',
    externalId,
    occurredAt,
    description: isCanceled ? `Cancelled: ${title}` : `Booked: ${title}`,
    rawData:     {
      meeting_name: title,
      start_time:   startTime,
      end_time:     endTime,
      booking_uid:  bookingUid,
      trigger,
    },
  });

  return res.json({ ok: true, contactId: contact.id, type: isCanceled ? 'meeting_cancelled' : 'meeting_scheduled' });
}

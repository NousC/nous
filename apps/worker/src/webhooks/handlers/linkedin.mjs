// LinkedIn / Unipile webhook handler — ported from assetly-blueprint/server/webhooks.mjs
// Handles two Unipile event types:
//   message_received — inbound/outbound LinkedIn messages
//   new_relation     — new 1st-degree connection accepted

import { getSupabaseClient } from '@nous/core';
import { logActivity } from '../../utils/activity.mjs';
import { enqueueForRetry } from '../../utils/webhookInbox.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Write a line to the Activity Log UI (workspace_system_log table).
// Fire-and-forget — never throw.
async function logSysEvent(supabase, workspaceId, source, eventType, summary, contactId, metadata) {
  try {
    await supabase.from('workspace_system_log').insert({
      workspace_id: workspaceId,
      source,
      event_type:   eventType,
      summary:      summary || null,
      contact_id:   contactId || null,
      metadata:     metadata || {},
      occurred_at:  new Date().toISOString(),
    });
  } catch { /* non-critical — never block the webhook response */ }
}

// Flexible LinkedIn URL match — handles www/no-www, trailing slash, query params.
async function matchContactByLinkedInUrl(supabase, workspaceId, rawUrl) {
  if (!rawUrl) return null;
  const slug = rawUrl.match(/\/in\/([^/?#]+)/)?.[1];
  if (!slug) return null;
  const { data } = await supabase
    .from('contacts')
    .select('id, company_id, linkedin_url, linkedin_member_id, email, channels')
    .eq('workspace_id', workspaceId)
    .ilike('linkedin_url', `%/in/${slug}%`)
    .maybeSingle();
  return data || null;
}

// Full contact resolution — 4-step waterfall matching the assetly-blueprint logic.
// 1. linkedin_member_id — permanent numeric ID, survives URL format changes
// 2. URL slug ilike     — readable slug fallback
// 3. First + last name  — catches contacts imported without any LinkedIn data
// 4. Create new contact — only if all above miss and we have enough data
// Always patches linkedin_member_id + linkedin_url back so future calls hit step 1/2.
// Returns { contact, created } — created=true means it was just inserted for the first time.
async function resolveLinkedInContact(supabase, workspaceId, { linkedinUrl, fullName, memberId }) {
  const SELECT = 'id, company_id, linkedin_url, linkedin_member_id, email, channels, first_name, last_name';

  // Step 1: permanent member ID match
  if (memberId) {
    const { data: byMemberId } = await supabase
      .from('contacts')
      .select(SELECT)
      .eq('workspace_id', workspaceId)
      .eq('linkedin_member_id', memberId)
      .maybeSingle();
    if (byMemberId) {
      if (!byMemberId.linkedin_url && linkedinUrl)
        await supabase.from('contacts').update({ linkedin_url: linkedinUrl }).eq('id', byMemberId.id).then(null, () => {});
      return { contact: byMemberId, created: false };
    }
  }

  // Step 2: URL slug match
  const byUrl = await matchContactByLinkedInUrl(supabase, workspaceId, linkedinUrl);
  if (byUrl) {
    if (memberId && !byUrl.linkedin_member_id)
      await supabase.from('contacts').update({ linkedin_member_id: memberId }).eq('id', byUrl.id).then(null, () => {});
    return { contact: byUrl, created: false };
  }

  // Step 3: first + last name match — use array query to avoid null on multiple matches
  if (fullName) {
    const parts = fullName.trim().split(/\s+/);
    const first = parts[0];
    const last  = parts.slice(1).join(' ');
    if (first && last) {
      const { data: nameMatches } = await supabase
        .from('contacts')
        .select(SELECT)
        .eq('workspace_id', workspaceId)
        .ilike('first_name', first)
        .ilike('last_name', last)
        .order('created_at', { ascending: true });
      // Prefer record with existing linkedin_url — more data = more likely canonical
      const byName = nameMatches?.find(c => c.linkedin_url) || nameMatches?.[0] || null;
      if (byName) {
        const patch = {};
        if (!byName.linkedin_url && linkedinUrl)     patch.linkedin_url = linkedinUrl;
        if (!byName.linkedin_member_id && memberId)  patch.linkedin_member_id = memberId;
        if (Object.keys(patch).length)
          await supabase.from('contacts').update(patch).eq('id', byName.id).then(null, () => {});
        return { contact: { ...byName, ...patch }, created: false };
      }
    }
  }

  // Step 4: create — requires at least a LinkedIn URL or a full name
  if (!linkedinUrl && !fullName) return { contact: null, created: false };

  const nameParts = fullName?.trim().split(/\s+/) || [];
  const { data: created, error } = await supabase
    .from('contacts')
    .insert({
      workspace_id:       workspaceId,
      first_name:         nameParts[0] || null,
      last_name:          nameParts.slice(1).join(' ') || null,
      linkedin_url:       linkedinUrl  || null,
      linkedin_member_id: memberId     || null,
      pipeline_stage:     'identified',
      source:             'linkedin',
    })
    .select(SELECT)
    .single();

  if (error) {
    console.error('[LINKEDIN_WEBHOOK] contact create failed:', error.message);
    return { contact: null, created: false };
  }
  return { contact: created, created: true };
}

// Pull up to 50 historical messages from Unipile and backfill them for a new contact.
// chatId: pass directly from the webhook payload — skips slow chat search for outbound.
// Fire-and-forget — called only on new contact creation.
async function backfillLinkedInMessages(supabase, workspaceId, contactId, { linkedinUrl, chatId }) {
  const dsn = process.env.UNIPILE_DSN;
  const key = process.env.UNIPILE_API_KEY;
  if (!dsn || !key) return;

  const BASE = `https://${dsn}/api/v1`;
  const hdrs = { 'X-API-KEY': key, 'Content-Type': 'application/json', accept: 'application/json' };

  const slug = linkedinUrl?.match(/\/in\/([^/?#]+)/)?.[1];
  if (!chatId && !slug) {
    console.log('[LINKEDIN_BACKFILL] skipping — no chatId or linkedin URL slug');
    return;
  }

  try {
    const { data: conn } = await supabase
      .from('workspace_linkedin_connections')
      .select('unipile_account_id')
      .eq('workspace_id', workspaceId)
      .single();
    if (!conn?.unipile_account_id) {
      console.log('[LINKEDIN_BACKFILL] no unipile account for workspace', workspaceId);
      return;
    }
    const accountId = conn.unipile_account_id;
    console.log(`[LINKEDIN_BACKFILL] starting — contact=${contactId} chatId=${chatId} slug=${slug}`);

    let resolvedChatId = chatId;

    if (!resolvedChatId) {
      const chatsRes = await fetch(`${BASE}/chats?account_id=${accountId}&limit=100`, { headers: hdrs });
      if (!chatsRes.ok) {
        console.error(`[LINKEDIN_BACKFILL] chats fetch failed: ${chatsRes.status}`);
        return;
      }
      const chatsBody = await chatsRes.json();
      const chats = chatsBody.items || chatsBody.objects || (Array.isArray(chatsBody) ? chatsBody : []);

      const targetChat = chats.find(chat =>
        (chat.attendees || []).some(a => {
          const url = a.profile_url || a.attendee_profile_url || a.url || '';
          return !a.is_self && url.includes(`/in/${slug}`);
        })
      );
      if (!targetChat) {
        console.log(`[LINKEDIN_BACKFILL] no chat matched slug=${slug} in ${chats.length} chats`);
        return;
      }
      resolvedChatId = targetChat.id;
    }

    const msgsRes = await fetch(`${BASE}/chats/${resolvedChatId}/messages?account_id=${accountId}&limit=50`, { headers: hdrs });
    if (!msgsRes.ok) {
      console.error(`[LINKEDIN_BACKFILL] messages fetch failed: ${msgsRes.status}`);
      return;
    }
    const msgsBody = await msgsRes.json();
    const messages = msgsBody.items || msgsBody.objects || (Array.isArray(msgsBody) ? msgsBody : []);
    console.log(`[LINKEDIN_BACKFILL] fetched ${messages.length} messages for contact=${contactId}`);

    let logged = 0;
    for (const msg of messages) {
      const msgId = msg.id || msg.provider_id || msg.message_id;
      if (!msgId) continue;
      const isOutbound  = !!(msg.is_sender);
      const text        = msg.text || msg.body || msg.content || '';
      const occurredAt  = msg.created_at || msg.timestamp || msg.date || msg.sent_at || new Date().toISOString();
      await logActivity(supabase, {
        workspaceId,
        contactId,
        type:        'linkedin_message',
        source:      'linkedin',
        externalId:  `li_msg_${msgId}`,
        occurredAt,
        rawData:     { text, is_outbound: isOutbound },
        description: text.slice(0, 500) || (isOutbound ? 'LinkedIn message (sent)' : 'LinkedIn message (received)'),
        summary:     isOutbound ? `You: ${text.slice(0, 200)}` : text.slice(0, 200),
      });
      logged++;
    }
    console.log(`[LINKEDIN_BACKFILL] done — contact=${contactId} logged=${logged}/${messages.length}`);
  } catch (e) {
    console.error('[LINKEDIN_BACKFILL] error:', e.message);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

// Non-actionable Unipile events — carry message_id/chat_id but have no content to log.
const NON_ACTIONABLE = new Set([
  'message_read', 'message_delivered',
  'message_edit', 'message_edited',
  'message_delete', 'message_deleted',
  'message_reaction',
]);

export async function handleLinkedIn(req, res, workspaceId) {
  const supabase  = getSupabaseClient();
  const body      = req.body;
  const eventType = body.event || body.event_type || '';

  console.log('[LINKEDIN_WEBHOOK] event=', eventType, 'keys:', Object.keys(body).join(', '));

  if (NON_ACTIONABLE.has(eventType)) {
    console.log('[LINKEDIN_WEBHOOK] skipping non-actionable event:', eventType);
    return res.json({ ok: true, skipped: eventType });
  }

  // Fall back to shape-detection for older webhook configs without explicit event field
  const isMessage  = eventType === 'message_received' || (!eventType && !!(body.message_id || body.chat_id));
  const isRelation = eventType === 'new_relation'     || (!eventType && !!(body.user_profile_url || body.user_full_name));

  if (!isMessage && !isRelation) {
    console.log('[LINKEDIN_WEBHOOK] skipping unknown event:', eventType || 'unknown');
    return res.json({ ok: true, skipped: `unknown event: ${eventType || 'unknown'}` });
  }

  // ── New connection ──────────────────────────────────────────────────────────
  if (isRelation) {
    const linkedinUrl = body.user_profile_url || null;
    const fullName    = body.user_full_name   || null;
    const identifier  = body.user_public_identifier || body.user_provider_id || null;
    if (!linkedinUrl && !fullName) return res.json({ ok: true, skipped: 'no identity' });

    const { contact } = await resolveLinkedInContact(supabase, workspaceId, { linkedinUrl, fullName, memberId: identifier });
    if (!contact) return res.json({ ok: true, skipped: 'could not resolve contact' });

    // Deduplicate — Unipile re-fires new_relation on re-auth
    const { count: alreadyConnected } = await supabase
      .from('contact_activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('contact_id', contact.id)
      .eq('activity_type', 'linkedin_connected')
      .eq('source', 'linkedin');
    if (alreadyConnected > 0) {
      console.log(`[LINKEDIN_WEBHOOK] ${contact.id} already has linkedin_connected — skipping duplicate`);
      return res.json({ ok: true, contactId: contact.id, type: 'connection_already_logged' });
    }

    await logActivity(supabase, {
      workspaceId,
      contactId:   contact.id,
      companyId:   contact.company_id || null,
      type:        'linkedin_connected',
      source:      'linkedin',
      externalId:  `li_conn_${identifier || linkedinUrl?.match(/\/in\/([^/?#]+)/)?.[1] || linkedinUrl}`,
      occurredAt:  body.timestamp ? new Date(body.timestamp).toISOString() : new Date().toISOString(),
      rawData:     body,
      description: 'Connected on LinkedIn',
    });

    // Update channels.linkedin.state = connected
    const { data: chRow } = await supabase.from('contacts').select('channels').eq('id', contact.id).single();
    const ch = chRow?.channels || {};
    const li = ch.linkedin || {};
    await supabase.from('contacts').update({
      channels: { ...ch, linkedin: { ...li, state: 'connected', connected_at: new Date().toISOString() } },
    }).eq('id', contact.id);

    logSysEvent(supabase, workspaceId, 'linkedin', 'webhook_received',
      `New LinkedIn connection${fullName ? `: ${fullName}` : ''}`,
      contact.id, { type: 'connection', linkedin_url: linkedinUrl }
    );
    return res.json({ ok: true, contactId: contact.id, type: 'connection' });
  }

  // ── Message received / sent ─────────────────────────────────────────────────
  if (isMessage) {
    const sender      = body.sender      || {};
    const attendees   = body.attendees   || [];
    const accountInfo = body.account_info || {};

    const myUserId = accountInfo.user_id;
    const isSender = !!(body.is_sender ?? (myUserId && sender.attendee_provider_id === myUserId));

    // Unipile puts the recipient in attendees[] for outbound messages
    let linkedinUrl, fullName, memberId;
    if (isSender) {
      const other = attendees.find(a => !a.is_self && a.provider_id !== myUserId)
                 || attendees.find(a => !a.is_self);
      linkedinUrl = other?.profile_url        || other?.attendee_profile_url || null;
      fullName    = other?.name               || other?.attendee_name        || null;
      memberId    = other?.provider_id        || other?.attendee_provider_id || null;
    } else {
      linkedinUrl = sender.attendee_profile_url || sender.profile_url || null;
      fullName    = sender.attendee_name        || sender.name        || null;
      memberId    = sender.attendee_provider_id || sender.provider_id || null;
    }

    if (!linkedinUrl && !fullName && !memberId) {
      console.warn('[LINKEDIN_WEBHOOK] could not extract identity from message event', { isSender, senderKeys: Object.keys(sender) });
      return res.json({ ok: true, skipped: 'no identity' });
    }

    const { contact, created } = await resolveLinkedInContact(supabase, workspaceId, { linkedinUrl, fullName, memberId });
    if (!contact) {
      console.warn('[LINKEDIN_WEBHOOK] could not resolve contact', { linkedinUrl, fullName, workspaceId });
      return res.json({ ok: true, skipped: 'could not resolve contact' });
    }

    const messageText = body.message?.text || (typeof body.message === 'string' ? body.message : '') || body.text || '';
    const msgId       = body.message?.id   || body.message_id || body.provider_message_id;
    const occurredAt  = body.timestamp ? new Date(body.timestamp).toISOString() : new Date().toISOString();

    await logActivity(supabase, {
      workspaceId,
      contactId:   contact.id,
      companyId:   contact.company_id || null,
      type:        'linkedin_message',
      source:      'linkedin',
      externalId:  msgId ? `li_msg_${msgId}` : null,
      occurredAt,
      rawData:     body,
      description: messageText.slice(0, 500) || (isSender ? 'LinkedIn message (sent)' : 'LinkedIn message (received)'),
      summary:     isSender ? `You: ${messageText.slice(0, 200)}` : messageText.slice(0, 200),
    });

    // channels.linkedin update — fire-and-forget
    setImmediate(async () => {
      try {
        const otherSpecifics = isSender
          ? (attendees.find(a => a.attendee_provider_id !== myUserId && !a.is_self)?.attendee_specifics || {})
          : (sender.attendee_specifics || {});
        const isConnected = otherSpecifics.network_distance === 'DISTANCE_1';
        const chatId = body.chat_id || body.provider_chat_id || null;

        const { data: row } = await supabase.from('contacts').select('channels').eq('id', contact.id).single();
        const currentLi = row?.channels?.linkedin || {};
        const updatedLi = {
          ...currentLi,
          ...(isConnected && { state: 'connected' }),
          ...(chatId && { chat_id: chatId }),
          messages_sent:     (currentLi.messages_sent     || 0) + (isSender ? 1 : 0),
          messages_received: (currentLi.messages_received || 0) + (isSender ? 0 : 1),
          awaiting_reply:    isSender,
          last_message_at:   occurredAt,
        };
        await supabase.from('contacts').update({
          channels: { ...(row?.channels || {}), linkedin: updatedLi },
        }).eq('id', contact.id);

        // Infer linkedin_connected from DISTANCE_1 if new_relation webhook never fired
        if (isConnected) {
          const { count: alreadyConnected } = await supabase
            .from('contact_activity_log')
            .select('id', { count: 'exact', head: true })
            .eq('contact_id', contact.id)
            .eq('activity_type', 'linkedin_connected')
            .eq('source', 'linkedin');
          if (!alreadyConnected) {
            await logActivity(supabase, {
              workspaceId,
              contactId:   contact.id,
              companyId:   contact.company_id || null,
              type:        'linkedin_connected',
              source:      'linkedin',
              externalId:  `li_conn_inferred_${memberId || contact.id}`,
              occurredAt,
              description: 'Connected on LinkedIn',
            });
            console.log(`[LINKEDIN_WEBHOOK] Inferred linkedin_connected for ${contact.id} from message signal`);
          }
        }
      } catch (e) {
        console.error('[LINKEDIN_WEBHOOK] channels.linkedin update failed:', e.message);
      }
    });

    // Email self-healing — if someone shares their email in a LinkedIn message, capture it
    if (!contact.email && messageText) {
      const emailMatch = messageText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
      if (emailMatch) {
        const discoveredEmail = emailMatch[0].toLowerCase();
        await supabase.from('contacts').update({ email: discoveredEmail }).eq('id', contact.id);
        console.log(`[LINKEDIN_WEBHOOK] Email discovered in message: ${discoveredEmail} → contact ${contact.id}`);
      }
    }

    logSysEvent(supabase, workspaceId, 'linkedin', 'webhook_received',
      isSender
        ? `LinkedIn message sent to ${fullName || linkedinUrl}: ${messageText.slice(0, 120)}`
        : `LinkedIn message from ${fullName || linkedinUrl}: ${messageText.slice(0, 120)}`,
      contact.id, { type: isSender ? 'message_sent' : 'message', message_id: msgId, is_sender: isSender }
    );

    // New contact → backfill their full conversation history.
    // Also backfill existing contacts that have no prior linkedin_message activities —
    // catches contacts imported before the webhook was set up (e.g. old connections).
    const chatId = body.chat_id || body.provider_chat_id || null;
    if (created) {
      backfillLinkedInMessages(supabase, workspaceId, contact.id, { linkedinUrl, chatId }).catch(() => {});
    } else {
      const { count: priorMsgCount } = await supabase
        .from('contact_activity_log')
        .select('id', { count: 'exact', head: true })
        .eq('contact_id', contact.id)
        .eq('activity_type', 'linkedin_message')
        .eq('source', 'linkedin');
      if (!priorMsgCount) {
        backfillLinkedInMessages(supabase, workspaceId, contact.id, { linkedinUrl, chatId }).catch(() => {});
      }
    }

    return res.json({ ok: true, contactId: contact.id, type: 'message' });
  }
}

// For the webhook retry worker. Re-runs handleLinkedIn with a stub res so
// internal res.json() calls become no-ops; we just care about the side
// effects (logActivity, resolveContact). Throws on DB/transport failures,
// which is what the retry worker uses to schedule the next attempt.
export async function reprocessLinkedIn(supabase, workspaceId, body) {
  const fakeReq = { body, headers: {}, fromRetry: true };
  const fakeRes = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await handleLinkedIn(fakeReq, fakeRes, workspaceId);
  if (fakeRes.statusCode >= 500) throw new Error(fakeRes.body?.error || 'linkedin_handler_error');
  return fakeRes.body;
}

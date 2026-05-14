// LinkedIn / Unipile webhook handler.
// Receives messages and connection events, resolves to contacts, logs activities.
// Unipile payload field reference verified against real payloads — do not change field names.

import { getSupabaseClient, logActivity } from '@proply/core';

// These event types carry a message_id but require no action — skip before any processing.
const NON_ACTIONABLE = new Set([
  'message_read', 'message_delivered',
  'message_edit', 'message_edited',
  'message_delete', 'message_deleted',
  'message_reaction',
]);

async function matchContactByLinkedInUrl(supabase, workspaceId, rawUrl) {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
    const m = u.pathname.match(/\/in\/([^/]+)/);
    if (!m) return null;
    const slug = m[1].toLowerCase();

    // Try exact normalized URL first
    const normalized = `https://www.linkedin.com/in/${slug}`;
    const { data: exact } = await supabase
      .from('contacts')
      .select('id, company_id')
      .eq('workspace_id', workspaceId)
      .eq('linkedin_url', normalized)
      .maybeSingle();
    if (exact) return exact;

    // Fallback: ilike slug match (handles trailing slashes, www vs non-www)
    const { data: fuzzy } = await supabase
      .from('contacts')
      .select('id, company_id')
      .eq('workspace_id', workspaceId)
      .ilike('linkedin_url', `%/in/${slug}%`)
      .maybeSingle();
    return fuzzy || null;
  } catch { return null; }
}

export async function handleLinkedIn(req, res, workspaceId) {
  const supabase = getSupabaseClient();
  const payload = req.body;

  // Unipile sends body.event for all event types
  const eventType = payload.event || payload.event_type || payload.type;

  if (NON_ACTIONABLE.has(eventType)) {
    return res.json({ ok: true });
  }

  if (eventType === 'message_received') {
    // Skip messages we sent ourselves
    if (payload.is_sender === true) {
      return res.json({ ok: true });
    }

    // Unipile sends attendee_profile_url, not linkedin_url
    const senderUrl = payload.sender?.attendee_profile_url;
    const contact = await matchContactByLinkedInUrl(supabase, workspaceId, senderUrl);

    if (contact) {
      await logActivity(supabase, {
        workspaceId,
        contactId:   contact.id,
        companyId:   contact.company_id || null,
        type:        'linkedin_message',
        source:      'linkedin',
        externalId:  payload.message_id ? `li_msg_${payload.message_id}` : null,
        occurredAt:  payload.timestamp || new Date().toISOString(),
        description: payload.message?.text?.slice(0, 500) || 'LinkedIn message received',
        rawData:     { chat_id: payload.chat_id, message_id: payload.message_id },
      });
    }
  }

  if (eventType === 'new_relation') {
    // Unipile sends user_profile_url for new connections
    const profileUrl = payload.user_profile_url;
    const contact = await matchContactByLinkedInUrl(supabase, workspaceId, profileUrl);

    if (contact) {
      const identifier = payload.user_public_identifier || profileUrl;
      await logActivity(supabase, {
        workspaceId,
        contactId:  contact.id,
        companyId:  contact.company_id || null,
        type:       'linkedin_connected',
        source:     'linkedin',
        externalId: `li_conn_${identifier}`,
        occurredAt: payload.timestamp || new Date().toISOString(),
        description: 'LinkedIn connection accepted',
      });
    }
  }

  return res.json({ ok: true });
}

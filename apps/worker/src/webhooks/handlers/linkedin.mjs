// LinkedIn / Unipile webhook handler.
// Receives messages and connection events, resolves to contacts, logs activities.
// See docs/integrations/linkedin.md for payload field reference.

import { getSupabaseClient, logActivity } from '@proply/core';

const UNIPILE_BASE = () => {
  const dsn = process.env.UNIPILE_DSN;
  if (!dsn) throw new Error('UNIPILE_DSN not configured');
  return `https://${dsn}/api/v1`;
};

const unipileHeaders = () => ({
  'X-API-KEY': process.env.UNIPILE_API_KEY || '',
  'Content-Type': 'application/json',
  accept: 'application/json',
});

async function matchContactByLinkedInUrl(supabase, workspaceId, rawUrl) {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
    const m = u.pathname.match(/\/in\/([^/]+)/);
    if (!m) return null;
    const normalized = `https://www.linkedin.com/in/${m[1].toLowerCase()}`;
    const { data } = await supabase
      .from('contacts')
      .select('id, company_id')
      .eq('workspace_id', workspaceId)
      .eq('linkedin_url', normalized)
      .maybeSingle();
    return data;
  } catch { return null; }
}

export async function handleLinkedIn(req, res, workspaceId) {
  const supabase = getSupabaseClient();
  const payload = req.body;

  // Unipile sends different event types — normalize them
  const eventType = payload.type || payload.event_type;

  if (eventType === 'NewMessage' || eventType === 'message') {
    const senderUrl = payload.sender?.linkedin_url || payload.from_member?.linkedin_url;
    const contact = await matchContactByLinkedInUrl(supabase, workspaceId, senderUrl);

    if (contact) {
      await logActivity(supabase, {
        workspaceId,
        contactId:   contact.id,
        companyId:   contact.company_id || null,
        type:        'linkedin_message',
        source:      'linkedin',
        externalId:  payload.message_id || payload.id || null,
        occurredAt:  payload.created_at || new Date().toISOString(),
        description: payload.text?.slice(0, 500) || 'LinkedIn message received',
        rawData:     { chat_id: payload.chat_id, message_id: payload.message_id },
      });
    }
  }

  if (eventType === 'ConnectionAccepted' || eventType === 'connection') {
    const profileUrl = payload.member?.linkedin_url || payload.profile_url;
    const contact = await matchContactByLinkedInUrl(supabase, workspaceId, profileUrl);

    if (contact) {
      await logActivity(supabase, {
        workspaceId,
        contactId:  contact.id,
        companyId:  contact.company_id || null,
        type:       'linkedin_connected',
        source:     'linkedin',
        externalId: `li_conn_${payload.member_id || payload.profile_url}`,
        occurredAt: payload.connected_at || new Date().toISOString(),
        description: 'LinkedIn connection accepted',
      });
    }
  }

  return res.json({ ok: true });
}

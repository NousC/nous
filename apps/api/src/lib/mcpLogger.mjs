import { getSupabaseClient } from '@nous/core';

// Logs an SDK/MCP/API operation to workspace_system_log.
// Accepts the Express req so we can attribute the call to a specific api_key_id —
// without that, "agent.contact.list" rows from source=api are anonymous and you
// can't tell which key/client is hammering the endpoint.
export function logMcpOp(req, { eventType, summary, contactId = null }) {
  const workspaceId = req?.workspaceId;
  if (!workspaceId) return;
  const clientType = req?.clientType || 'api';
  const apiKeyId   = req?.apiKeyId   || null;
  const userAgent  = req?.headers?.['user-agent'] || null;
  const ip         = req?.headers?.['x-forwarded-for']?.split(',')[0].trim() || req?.ip || null;

  const supabase = getSupabaseClient();
  supabase.from('workspace_system_log').insert({
    workspace_id: workspaceId,
    source: clientType,
    event_type: eventType,
    summary: summary || null,
    contact_id: contactId || null,
    metadata: { api_key_id: apiKeyId, user_agent: userAgent, ip },
    occurred_at: new Date().toISOString(),
  }).then(({ error }) => {
    if (error) console.error('[logMcpOp] insert failed:', error.message, { workspaceId, eventType });
  }).catch(err => {
    console.error('[logMcpOp] unexpected error:', err.message, { workspaceId, eventType });
  });
}

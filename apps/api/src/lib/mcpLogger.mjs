import { getSupabaseClient } from '@proply/core';

/**
 * Fire-and-forget log of an MCP tool call result to workspace_system_log.
 * Surfaces in the Mind page ops drawer as a green agent operation with preview detail.
 */
export function logMcpOp(workspaceId, { eventType, summary, contactId = null, clientType = 'api' }) {
  const supabase = getSupabaseClient();
  supabase.from('workspace_system_log').insert({
    workspace_id: workspaceId,
    source: clientType,
    event_type: eventType,
    summary,
    contact_id: contactId || null,
    occurred_at: new Date().toISOString(),
  }).then(() => {}).catch(() => {});
}

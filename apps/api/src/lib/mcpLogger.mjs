import { getSupabaseClient } from '@proply/core';

export function logMcpOp(workspaceId, { eventType, summary, contactId = null, clientType = 'api' }) {
  if (!workspaceId) return;
  const supabase = getSupabaseClient();
  supabase.from('workspace_system_log').insert({
    workspace_id: workspaceId,
    source: clientType,
    event_type: eventType,
    summary: summary || null,
    contact_id: contactId || null,
    metadata: {},
    occurred_at: new Date().toISOString(),
  }).then(({ error }) => {
    if (error) console.error('[logMcpOp] insert failed:', error.message, { workspaceId, eventType });
  }).catch(err => {
    console.error('[logMcpOp] unexpected error:', err.message, { workspaceId, eventType });
  });
}

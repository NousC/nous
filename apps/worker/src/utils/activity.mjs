// Wrapper around @nous/core logActivity that auto-fires signal extraction.
// All worker webhook handlers import logActivity from here, not from @nous/core directly.

import { logActivity as _logActivity } from '@nous/core';
import { extractAfterActivity } from '../signals/index.mjs';

export async function logActivity(supabase, params) {
  const result = await _logActivity(supabase, params);
  if (result) {
    extractAfterActivity(supabase, result, {
      contactId:   params.contactId,
      workspaceId: params.workspaceId,
      type:        params.type,
      source:      params.source,
      summary:     params.summary || params.description || null,
    }).catch(() => {});
  }
  return result;
}

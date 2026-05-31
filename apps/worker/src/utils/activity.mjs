// Wrapper around @nous/core logActivity that auto-fires signal extraction.
// All worker webhook handlers import logActivity from here, not from @nous/core directly.

import { logActivity as _logActivity } from '@nous/core';
import { extractAfterActivity } from '../signals/index.mjs';
import { classifyReplySentiment } from '../signals/replySentiment.mjs';

// Inbound, content-rich replies we score for sentiment. The score is stashed on
// rawData.sentiment so it's persisted on the observation AND travels with the
// CRM push event, where the create-gate uses it to promote positive replies.
const REPLY_TYPES = new Set(['email_received', 'email_reply', 'linkedin_message', 'linkedin_replied']);

export async function logActivity(supabase, params) {
  // Classify reply sentiment once, here — the single choke point every worker
  // webhook handler routes through. Skips outbound LinkedIn messages and any
  // caller that already supplied a sentiment.
  if (
    REPLY_TYPES.has(params.type) &&
    params.summary &&
    params.rawData?.sentiment == null &&
    params.rawData?.is_outbound !== true
  ) {
    const sentiment = await classifyReplySentiment(params.summary);
    if (sentiment) params.rawData = { ...(params.rawData || {}), sentiment };
  }

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

// CRM hygiene — apply an approved proposal to the CRM (Phase 2). THIS WRITES TO
// A LIVE CRM. Guard rails: `conflict` is never applied; optimistic concurrency
// (re-read before write — bail if the record moved since we proposed); the
// before-value is the proposal's current_value, so any write is reversible.
// See docs/crm-hygiene-phase-2-spec.md, Task B.

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchCrmRecordFields, writeCrmRecordFields, type CrmProvider } from '../integrations/crm/index.js';
import { normalizeFieldValue } from './crmReconcile.js';
import type { HygieneProposalRow } from './crmHygiene.js';

export interface ApplyResult {
  applied: boolean;
  status: 'applied' | 'failed';
  reason?: string;
}

// Kinds Task B can write today. icp_rescore needs custom-field provisioning
// (Task A follow-up); net_new is a bundle; conflict is human-only forever.
const APPLYABLE = new Set(['field_fill', 'field_update']);

export function isApplyable(kind: string): boolean {
  return APPLYABLE.has(kind);
}

/**
 * Apply one approved proposal. Pure-ish: takes the resolved CRM token, does the
 * PATCH, returns the outcome. The caller persists status + telemetry.
 */
export async function applyProposal(
  proposal: HygieneProposalRow,
  token: string | null,
): Promise<ApplyResult> {
  const { kind, field, provider, crm_record_id, current_value, proposed_value } = proposal;

  if (kind === 'conflict')   return { applied: false, status: 'failed', reason: 'conflicts are never auto-applied — human only' };
  if (!isApplyable(kind))    return { applied: false, status: 'failed', reason: `apply not yet supported for ${kind}` };
  if (!token)                return { applied: false, status: 'failed', reason: 'no CRM token' };
  if (!crm_record_id || !field) return { applied: false, status: 'failed', reason: 'missing record id or field' };

  // Optimistic concurrency — the CRM must still hold what we proposed against,
  // or a human changed it after the proposal was raised. Don't clobber that.
  let live: Awaited<ReturnType<typeof fetchCrmRecordFields>>;
  try {
    live = await fetchCrmRecordFields(provider as CrmProvider, token, crm_record_id);
  } catch (err: any) {
    return { applied: false, status: 'failed', reason: `re-read failed: ${err?.message || err}` };
  }
  if (!live) return { applied: false, status: 'failed', reason: 'record no longer in CRM' };
  if (!(field in live)) return { applied: false, status: 'failed', reason: `field ${field} not writable on ${provider}` };
  if (normalizeFieldValue(live[field as keyof typeof live]) !== normalizeFieldValue(current_value)) {
    return { applied: false, status: 'failed', reason: 'stale — CRM value changed since the proposal; re-run hygiene' };
  }

  const res = await writeCrmRecordFields(provider as CrmProvider, token, crm_record_id, { [field]: proposed_value });
  if (!res.ok) return { applied: false, status: 'failed', reason: res.error || 'write failed' };
  return { applied: true, status: 'applied' };
}

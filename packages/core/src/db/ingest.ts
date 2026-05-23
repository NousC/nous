import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityType } from './entities.js';

// The connector ingestion bridge — v1 → v2.
//
// Connectors still resolve a v1 contact/company row and update its columns.
// logActivity() already mirrors *events* into the v2 substrate; this mirrors
// the *state* writes — the enrichment column updates — as `state` observations,
// so claims stay fresh from live ingestion, not just the one-time migration
// backfill. Fire-and-forget: a v2 failure never breaks a v1 write. Entity id
// == the v1 row id (the migration convention).

// Columns that carry a real, claim-worthy fact. Anything not listed — ids,
// timestamps, status flags, raw blobs — is v1 bookkeeping, not a belief.
const PERSON_PROPS = new Set([
  // Profile
  'first_name', 'last_name', 'job_title', 'seniority', 'department',
  'phone', 'city', 'country', 'linkedin_url', 'company', 'photo_url',
  // Pipeline / lifecycle
  'pipeline_stage', 'stage_locked', 'source', 'first_seen_at',
  // Channels (LinkedIn / email / etc. state — JSONB)
  'channels',
  // Deal state
  'deal_health_score', 'deal_health_breakdown', 'deal_stage', 'deal_value',
  // Enrichment process state
  'enrichment_status', 'enriched_at',
  // LLM-derived summary
  'memory_summary',
]);
const COMPANY_PROPS = new Set([
  'name', 'domain', 'industry', 'employee_count', 'location',
  'revenue_range', 'tech_stack',
  'enrichment_status', 'enriched_at',
  'deal_health_score',
  'hubspot_company_id', 'apollo_account_id',
]);

const PROPS_BY_TYPE: Partial<Record<EntityType, Set<string>>> = {
  person: PERSON_PROPS,
  company: COMPANY_PROPS,
};

/**
 * Mirror a v1 contact/company column write into the v2 substrate as `state`
 * observations — one per claim-worthy field in `facts`. Fire-and-forget;
 * resolves silently even when the v2 tables are absent. `facts` is the
 * column→value map that was just written to the v1 row.
 */
export async function mirrorStateToObservations(
  supabase: SupabaseClient,
  args: {
    workspaceId: string;
    entityId: string;          // == the v1 contact/company row id
    type: EntityType;
    source: string;            // 'apollo' | 'webhook' | 'user' | …
    facts: Record<string, unknown>;
    observedAt?: string;
  },
): Promise<void> {
  const allowed = PROPS_BY_TYPE[args.type];
  if (!allowed) return;

  const observedAt = args.observedAt ?? new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  for (const [property, value] of Object.entries(args.facts)) {
    if (!allowed.has(property)) continue;
    if (value == null || value === '') continue;
    rows.push({
      workspace_id: args.workspaceId,
      entity_id: args.entityId,
      kind: 'state',
      property,
      value,
      source: args.source,
      method: 'connector',
      observed_at: observedAt,
    });
  }
  if (rows.length === 0) return;

  // Ensure the entity exists (id == v1 row id — the migration convention).
  const ent = await supabase.from('entities').upsert(
    { id: args.entityId, workspace_id: args.workspaceId, type: args.type, status: 'active' },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (ent.error) return;   // v2 substrate absent, or upsert failed — skip; never break v1

  const { error } = await supabase.from('observations').insert(rows);
  // 23505 = duplicate; 42P01/PGRST205 = v2 tables absent — all benign.
  if (error && !['23505', '42P01', 'PGRST205'].includes(error.code ?? '')) {
    console.error('[INGEST] state mirror failed:', error.message);
  }
}

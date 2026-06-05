import type { SupabaseClient } from '@supabase/supabase-js';

// Observations are the immutable, append-only spine — the system of record.
// Every enrichment result, email, reply, bounce, and agent action is one
// observation. They never mutate and never decay. A new observation insert
// auto-enqueues a claim recompute (DB trigger on the observations table).

export type ObservationKind = 'state' | 'event';

export interface ObservationInput {
  workspaceId: string;
  entityId: string;
  kind: ObservationKind;
  property: string;          // 'job_title' | 'interaction.email_sent' | 'email.bounced' | …
  value: unknown;            // stored as jsonb
  source: string;            // 'apollo' | 'gmail' | 'instantly' | 'agent' | 'user' | …
  method: string;            // 'api' | 'webhook' | 'extraction' | 'inference' | 'user_input'
  observedAt?: string;       // ISO; when it was true / happened. Defaults to now.
  sourceConfidence?: number;
  externalId?: string;       // source's own id — dedup key
  raw?: unknown;             // raw payload, kept for provenance
}

export interface Observation {
  id: string;
  entity_id: string;
  kind: ObservationKind;
  property: string;
  value: unknown;
  source: string;
  method: string;
  source_confidence: number | null;
  observed_at: string;
  ingested_at: string;
}

const COLUMNS =
  'id, entity_id, kind, property, value, source, method, source_confidence, observed_at, ingested_at';

function toRow(input: ObservationInput) {
  return {
    workspace_id: input.workspaceId,
    entity_id: input.entityId,
    kind: input.kind,
    property: input.property,
    value: input.value ?? null,
    source: input.source,
    method: input.method,
    source_confidence: input.sourceConfidence ?? null,
    observed_at: input.observedAt ?? new Date().toISOString(),
    external_id: input.externalId ?? null,
    raw: input.raw ?? null,
  };
}

/** Append one observation. Returns null if it was a duplicate (external_id). */
export async function recordObservation(
  supabase: SupabaseClient,
  input: ObservationInput,
): Promise<Observation | null> {
  const { data, error } = await supabase
    .from('observations')
    .insert(toRow(input))
    .select(COLUMNS)
    .single();
  if (error) {
    if (error.code === '23505') return null;   // duplicate (workspace, source, external_id)
    throw new Error(`failed to record observation: ${error.message}`);
  }
  return data as Observation;
}

/** Append many observations at once. Rows WITH an external_id dedup via the partial
 *  unique index (observations_dedup, WHERE external_id IS NOT NULL); rows WITHOUT one
 *  fall outside that index, so they're plain-inserted (append-only by design — e.g.
 *  enrichment state snapshots that carry no source event id). */
export async function recordObservations(
  supabase: SupabaseClient,
  inputs: ObservationInput[],
): Promise<number> {
  if (inputs.length === 0) return 0;
  const withExt = inputs.filter((i) => i.externalId != null && i.externalId !== '');
  const noExt = inputs.filter((i) => i.externalId == null || i.externalId === '');
  let count = 0;
  if (withExt.length) {
    const { data, error } = await supabase
      .from('observations')
      .upsert(withExt.map(toRow), {
        onConflict: 'workspace_id,source,external_id',
        ignoreDuplicates: true,
      })
      .select('id');
    if (error) throw new Error(`failed to record observations: ${error.message}`);
    count += data?.length ?? 0;
  }
  if (noExt.length) {
    const { data, error } = await supabase
      .from('observations')
      .insert(noExt.map(toRow))
      .select('id');
    if (error) throw new Error(`failed to record observations: ${error.message}`);
    count += data?.length ?? 0;
  }
  return count;
}

// Person/account attribute fields an enrichment provider can assert. These are
// written as state observations tagged with the TRUE provider source
// (apollo / prospeo / linkedin) so the claim engine and the CRM-hygiene
// provenance gate can distinguish enrichment-origin values from CRM-origin ones.
//
// Why this helper exists: writes routed through the v1 `contacts` view inherit
// the *record's* origin source (the view's single `source` column), so an
// Apollo-provided job_title on a HubSpot-pulled contact would be mis-tagged
// `hubspot` and look like the CRM's own data. Enrichment must therefore write
// these fields as observations directly, with its real source, and omit them
// from the `contacts` update so the view trigger doesn't emit a mis-tagged
// duplicate. See docs/crm-hygiene-phase-1b-spec.md, Task 0.
export const ENRICHMENT_ATTRIBUTES = [
  'job_title', 'seniority', 'department', 'company', 'phone', 'city', 'country', 'linkedin_url',
  'domain', 'reachability_status',
] as const;

export async function recordEnrichmentObservations(
  supabase: SupabaseClient,
  workspaceId: string,
  entityId: string,
  source: string,
  facts: Record<string, unknown>,
): Promise<number> {
  const inputs: ObservationInput[] = [];
  for (const property of ENRICHMENT_ATTRIBUTES) {
    const value = facts[property];
    if (value == null || value === '') continue;
    inputs.push({ workspaceId, entityId, kind: 'state', property, value, source, method: 'enrichment' });
  }
  return recordObservations(supabase, inputs);
}

/** Load observations by id (workspace-scoped) — used to resolve a claim's
 *  supporting_observation_ids to their sources/values for the CRM-hygiene
 *  provenance gate and proof payload. */
export async function getObservationsByIds(
  supabase: SupabaseClient,
  workspaceId: string,
  ids: string[],
): Promise<Observation[]> {
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from('observations')
    .select(COLUMNS)
    .eq('workspace_id', workspaceId)
    .in('id', ids);
  if (error) throw new Error(`failed to load observations by id: ${error.message}`);
  return (data as Observation[]) ?? [];
}

/** Observations for an entity, newest first — the account timeline. */
export async function getObservations(
  supabase: SupabaseClient,
  workspaceId: string,
  entityId: string,
  opts: { property?: string; kind?: ObservationKind; limit?: number } = {},
): Promise<Observation[]> {
  let q = supabase
    .from('observations')
    .select(COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('entity_id', entityId)
    .order('observed_at', { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.property) q = q.eq('property', opts.property);
  if (opts.kind) q = q.eq('kind', opts.kind);
  const { data, error } = await q;
  if (error) throw new Error(`failed to load observations: ${error.message}`);
  return (data as Observation[]) ?? [];
}

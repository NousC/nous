import type { SupabaseClient } from '@supabase/supabase-js';
import { REPORTS_TO_CONFIDENCE, type RelationshipType } from '../relationships.js';

// Read/write helpers for the `relationships` table — the derived entity-to-entity
// edge layer (works_at, reports_to, …). Edges are the derived layer, like claims,
// but shaped for two entities and temporal (valid_to NULL = current). All access
// to the table goes through here; never write raw queries in app code.

export interface Relationship {
  from_entity_id: string;
  to_entity_id: string;
  type: string;
  confidence: number;
  valid_from: string | null;
  valid_to: string | null;
}

/** The company a person currently works at (the live `works_at` edge), or null. */
export async function getEmployer(
  supabase: SupabaseClient,
  workspaceId: string,
  personId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('relationships')
    .select('to_entity_id')
    .eq('workspace_id', workspaceId)
    .eq('from_entity_id', personId)
    .eq('type', 'works_at')
    .is('valid_to', null)
    .limit(1);
  if (error) throw new Error(`failed to load employer: ${error.message}`);
  return (data?.[0]?.to_entity_id as string | undefined) ?? null;
}

/** The people who currently work at a company (live `works_at` edges). */
export async function getColleagues(
  supabase: SupabaseClient,
  workspaceId: string,
  companyId: string,
  opts: { limit?: number } = {},
): Promise<string[]> {
  const { data, error } = await supabase
    .from('relationships')
    .select('from_entity_id')
    .eq('workspace_id', workspaceId)
    .eq('to_entity_id', companyId)
    .eq('type', 'works_at')
    .is('valid_to', null)
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  if (error) throw new Error(`failed to load colleagues: ${error.message}`);
  return ((data as { from_entity_id: string }[] | null) ?? []).map(r => r.from_entity_id);
}

/** Current managers for a set of people: from_entity_id → to_entity_id (`reports_to`). */
export async function getManagers(
  supabase: SupabaseClient,
  workspaceId: string,
  personIds: string[],
): Promise<Map<string, string>> {
  const managers = new Map<string, string>();
  if (!personIds.length) return managers;
  const { data, error } = await supabase
    .from('relationships')
    .select('from_entity_id, to_entity_id')
    .eq('workspace_id', workspaceId)
    .in('from_entity_id', personIds)
    .eq('type', 'reports_to')
    .is('valid_to', null);
  if (error) throw new Error(`failed to load managers: ${error.message}`);
  for (const r of (data as { from_entity_id: string; to_entity_id: string }[] | null) ?? []) {
    managers.set(r.from_entity_id, r.to_entity_id);
  }
  return managers;
}

export interface UpsertRelationshipInput {
  workspaceId: string;
  fromEntityId: string;
  toEntityId: string;
  type: RelationshipType;
  confidence?: number;
  validFrom?: string;
  supportingObservationIds?: string[];
}

/** Upsert one derived edge (re-activating it if it had been expired). */
export async function upsertRelationship(
  supabase: SupabaseClient,
  input: UpsertRelationshipInput,
): Promise<void> {
  const { error } = await supabase.from('relationships').upsert(
    {
      workspace_id: input.workspaceId,
      from_entity_id: input.fromEntityId,
      to_entity_id: input.toEntityId,
      type: input.type,
      confidence: input.confidence ?? 1.0,
      valid_from: input.validFrom ?? new Date().toISOString(),
      valid_to: null,
      supporting_observation_ids: input.supportingObservationIds ?? [],
      computed_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,from_entity_id,to_entity_id,type' },
  );
  if (error) throw new Error(`failed to upsert relationship: ${error.message}`);
}

/**
 * Set a person's single current manager: upsert the `reports_to` edge and expire
 * any other live `reports_to` edge from that person. Keeps "one current manager".
 * Returns true if this changed the person's manager (new or different).
 */
export async function setReportsTo(
  supabase: SupabaseClient,
  workspaceId: string,
  fromEntityId: string,
  toEntityId: string,
): Promise<boolean> {
  // expire any other live reports_to from this person (pointing elsewhere)
  const { data: existing, error: readErr } = await supabase
    .from('relationships')
    .select('to_entity_id')
    .eq('workspace_id', workspaceId)
    .eq('from_entity_id', fromEntityId)
    .eq('type', 'reports_to')
    .is('valid_to', null);
  if (readErr) throw new Error(`failed to read reports_to: ${readErr.message}`);
  const current = (existing as { to_entity_id: string }[] | null) ?? [];
  const alreadyCorrect = current.length === 1 && current[0].to_entity_id === toEntityId;
  if (alreadyCorrect) return false;

  const stale = current.filter(r => r.to_entity_id !== toEntityId).map(r => r.to_entity_id);
  if (stale.length) {
    const { error: expErr } = await supabase
      .from('relationships')
      .update({ valid_to: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('from_entity_id', fromEntityId)
      .eq('type', 'reports_to')
      .in('to_entity_id', stale)
      .is('valid_to', null);
    if (expErr) throw new Error(`failed to expire reports_to: ${expErr.message}`);
  }

  await upsertRelationship(supabase, {
    workspaceId,
    fromEntityId,
    toEntityId,
    type: 'reports_to',
    confidence: REPORTS_TO_CONFIDENCE,
  });
  return true;
}

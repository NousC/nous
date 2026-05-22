import type { SupabaseClient } from '@supabase/supabase-js';

// Entities are canonical, temporal anchors. They hold almost no data —
// everything is observations and claims attached to them. The same
// person-entity survives a job change or a new email.

export type EntityType = 'person' | 'company' | 'deal' | 'workspace';

export interface Entity {
  id: string;
  workspace_id: string;
  type: EntityType;
  status: 'active' | 'merged';
}

export interface Identifier {
  kind: string;   // 'email' | 'domain' | 'linkedin_member_id' | 'hubspot' | …
  value: string;
}

/** Normalise an identifier value so lookups are consistent. */
export function normaliseIdentifier(kind: string, value: string): string {
  const v = value.trim();
  return kind === 'email' || kind === 'domain' ? v.toLowerCase() : v;
}

/** Resolve a single identifier to its entity id, or null if unknown. */
export async function resolveEntity(
  supabase: SupabaseClient,
  workspaceId: string,
  identifier: Identifier,
): Promise<string | null> {
  const value = normaliseIdentifier(identifier.kind, identifier.value);
  if (!value) return null;
  const { data } = await supabase
    .from('entity_identifiers')
    .select('entity_id')
    .eq('workspace_id', workspaceId)
    .eq('kind', identifier.kind)
    .eq('value', value)
    .eq('status', 'active')
    .maybeSingle();
  return data?.entity_id ?? null;
}

/** Attach identifiers to an entity, skipping any already registered. */
export async function attachIdentifiers(
  supabase: SupabaseClient,
  workspaceId: string,
  entityId: string,
  identifiers: Identifier[],
): Promise<void> {
  for (const id of identifiers) {
    const value = normaliseIdentifier(id.kind, id.value);
    if (!value) continue;
    const existing = await resolveEntity(supabase, workspaceId, { kind: id.kind, value });
    if (existing) continue;
    await supabase.from('entity_identifiers').insert({
      workspace_id: workspaceId,
      entity_id: entityId,
      kind: id.kind,
      value,
    });
  }
}

/**
 * Resolve an entity by any of its identifiers; create one if none match.
 * The entry point for ingestion — every observation needs an entity.
 */
export async function getOrCreateEntity(
  supabase: SupabaseClient,
  workspaceId: string,
  type: EntityType,
  identifiers: Identifier[],
): Promise<string> {
  for (const id of identifiers) {
    const existing = await resolveEntity(supabase, workspaceId, id);
    if (existing) {
      await attachIdentifiers(supabase, workspaceId, existing, identifiers);
      return existing;
    }
  }

  const { data, error } = await supabase
    .from('entities')
    .insert({ workspace_id: workspaceId, type, status: 'active' })
    .select('id')
    .single();
  if (error || !data) throw new Error(`failed to create entity: ${error?.message}`);

  await attachIdentifiers(supabase, workspaceId, data.id, identifiers);
  return data.id;
}

export async function getEntity(
  supabase: SupabaseClient,
  workspaceId: string,
  entityId: string,
): Promise<Entity | null> {
  const { data } = await supabase
    .from('entities')
    .select('id, workspace_id, type, status')
    .eq('id', entityId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return (data as Entity) ?? null;
}

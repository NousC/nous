import type { SupabaseClient } from '@supabase/supabase-js';
import { normaliseLinkedInUrl, isUUID } from '../utils/identity.js';

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

// ── focus resolution ─────────────────────────────────────────────────────────
// An agent passes whatever it has. A UUID / email / domain / LinkedIn URL is a
// real *identifier* — it resolves to exactly one entity. A bare name is NOT an
// identifier — it may match several entities, so we return candidates.

export interface FocusCandidate {
  entity_id: string;
  name: string | null;
  detail: string | null;          // company / title — to tell candidates apart
}

export type FocusResolution =
  | { status: 'resolved'; entity_id: string }
  | { status: 'ambiguous'; candidates: FocusCandidate[] }
  | { status: 'not_found' };

const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;

export type DetectedIdentifier = {
  kind: 'entity_id' | 'email' | 'linkedin_url' | 'domain';
  value: string;
};

/**
 * Detect a hard identifier in a focus string. Returns null when the input is
 * not a hard identifier (e.g. a bare name) — that case needs a search, not a
 * lookup. Shared by resolveFocus (reads) and the write path (observations).
 */
export function detectIdentifier(focus: string): DetectedIdentifier | null {
  const f = (focus ?? '').trim();
  if (!f) return null;
  if (isUUID(f)) return { kind: 'entity_id', value: f };
  if (f.includes('@')) return { kind: 'email', value: f.toLowerCase() };
  if (/linkedin\.com/i.test(f)) {
    const url = normaliseLinkedInUrl(f);
    return url ? { kind: 'linkedin_url', value: url } : null;
  }
  if (!f.includes(' ') && DOMAIN_RE.test(f)) return { kind: 'domain', value: f.toLowerCase() };
  return null;
}

export async function resolveFocus(
  supabase: SupabaseClient,
  workspaceId: string,
  focus: string,
): Promise<FocusResolution> {
  const f = (focus ?? '').trim();
  if (!f) return { status: 'not_found' };

  const ident = detectIdentifier(f);
  if (ident) {
    if (ident.kind === 'entity_id') {
      const e = await getEntity(supabase, workspaceId, ident.value);
      return e ? { status: 'resolved', entity_id: ident.value } : { status: 'not_found' };
    }
    const id = await resolveEntity(supabase, workspaceId, { kind: ident.kind, value: ident.value });
    return id ? { status: 'resolved', entity_id: id } : { status: 'not_found' };
  }

  // not a hard identifier — treat as a name; one hit resolves, several is ambiguous
  const candidates = await searchEntitiesByName(supabase, workspaceId, f);
  if (candidates.length === 0) return { status: 'not_found' };
  if (candidates.length === 1) return { status: 'resolved', entity_id: candidates[0].entity_id };
  return { status: 'ambiguous', candidates: candidates.slice(0, 10) };
}

/** Match entities by display name. v1: in-memory — fine for moderate workspaces. */
async function searchEntitiesByName(
  supabase: SupabaseClient,
  workspaceId: string,
  term: string,
): Promise<FocusCandidate[]> {
  const needle = term.toLowerCase();
  const { data } = await supabase
    .from('claims')
    .select('entity_id, property, value')
    .eq('workspace_id', workspaceId)
    .in('property', ['first_name', 'last_name', 'name', 'company', 'job_title'])
    .limit(5000);

  const byEntity = new Map<string, Record<string, unknown>>();
  for (const c of (data as any[]) ?? []) {
    const m = byEntity.get(c.entity_id) ?? {};
    m[c.property] = c.value;
    byEntity.set(c.entity_id, m);
  }
  const out: FocusCandidate[] = [];
  for (const [id, m] of byEntity) {
    const name = m.name
      ? String(m.name)
      : [m.first_name, m.last_name].filter(Boolean).join(' ');
    if (name && name.toLowerCase().includes(needle)) {
      out.push({
        entity_id: id,
        name: name || null,
        detail: m.company ? String(m.company) : (m.job_title ? String(m.job_title) : null),
      });
    }
  }
  return out;
}

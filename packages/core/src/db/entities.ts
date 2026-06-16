import type { SupabaseClient } from '@supabase/supabase-js';
import { normaliseLinkedInUrl, isUUID, isMemberUrnLinkedInUrl } from '../utils/identity.js';

// LinkedIn URL variants we'll accept as equivalent on lookup. Covers the
// historical inconsistency where the write path stored URLs raw (with/without
// trailing slash, with/without www, mixed case) but the read path now
// normalises. New writes go through normaliseLinkedInUrl so this is only
// load-bearing for pre-existing data; once a backfill runs it can shrink.
function linkedInVariants(url: string): string[] {
  const out = new Set<string>();
  const trimmed = url.trim();
  if (!trimmed) return [];
  const canonical = normaliseLinkedInUrl(trimmed);
  if (canonical) {
    const noWww = canonical.replace('https://www.', 'https://');
    for (const base of [canonical, noWww]) {
      out.add(base);
      out.add(base + '/');
    }
  }
  out.add(trimmed);
  out.add(trimmed.toLowerCase());
  return Array.from(out);
}

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

/** Normalise an identifier value so writes + lookups land on the same string. */
export function normaliseIdentifier(kind: string, value: string): string {
  const v = value.trim();
  if (kind === 'email' || kind === 'domain') return v.toLowerCase();
  if (kind === 'linkedin_url') return normaliseLinkedInUrl(v) ?? v;
  return v;
}

/** Build the v2 Identifier[] list from a v1-style contact data blob. */
export function identifiersFromContactData(data: {
  email?: string | null;
  linkedin_url?: string | null;
  linkedin_member_id?: string | null;
  hubspot_id?: string | null;
  pipedrive_id?: string | null;
  apollo_id?: string | null;
  rb2b_id?: string | null;
  attio_id?: string | null;
}): Identifier[] {
  const out: Identifier[] = [];
  if (data.email)              out.push({ kind: 'email',              value: data.email });
  // Member-URN URLs (/in/ACoAA…) are not real public handles — keep them out of
  // the identifier set so they never resolve or surface as a scrapeable URL.
  if (data.linkedin_url && !isMemberUrnLinkedInUrl(data.linkedin_url))
                               out.push({ kind: 'linkedin_url',       value: data.linkedin_url });
  if (data.linkedin_member_id) out.push({ kind: 'linkedin_member_id', value: data.linkedin_member_id });
  if (data.hubspot_id)         out.push({ kind: 'hubspot',            value: data.hubspot_id });
  if (data.pipedrive_id)       out.push({ kind: 'pipedrive',          value: data.pipedrive_id });
  if (data.apollo_id)          out.push({ kind: 'apollo',             value: data.apollo_id });
  if (data.rb2b_id)            out.push({ kind: 'rb2b',               value: data.rb2b_id });
  if (data.attio_id)           out.push({ kind: 'attio',              value: data.attio_id });
  return out;
}

/** Resolve a single identifier to its entity id, or null if unknown. */
export async function resolveEntity(
  supabase: SupabaseClient,
  workspaceId: string,
  identifier: Identifier,
): Promise<string | null> {
  const value = normaliseIdentifier(identifier.kind, identifier.value);
  if (!value) return null;

  // LinkedIn URLs need variant matching so historical rows (stored before
  // normalisation existed) still resolve. .in() with the variant set is one
  // round-trip vs the old single-value .eq().
  if (identifier.kind === 'linkedin_url') {
    const variants = linkedInVariants(identifier.value);
    const { data } = await supabase
      .from('entity_identifiers')
      .select('entity_id')
      .eq('workspace_id', workspaceId)
      .eq('kind', 'linkedin_url')
      .in('value', variants)
      .eq('status', 'active')
      .limit(1);
    return (data as { entity_id: string }[] | null)?.[0]?.entity_id ?? null;
  }

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

// ── v2 overlay onto v1 contact/company rows ──────────────────────────────────
// Phase 4a transitional read-path: every reader of `contacts` / `companies`
// fetches the v1 row, then overlays whatever the v2 substrate carries
// (claims, identifiers, the latest icp_fit prediction, the works_at edge,
// the latest observation timestamp). The v2 path is exercised on every read;
// remaining v1-only columns (channels, deal_health_score, memory_summary,
// enrichment_status, source) still fall through. Phase 4b claim-ifies those.

export interface EntityOverlay {
  claims: Record<string, unknown>;
  identifiers: Record<string, string>;
  prediction: { score?: number; fit?: boolean; reason?: string } | null;
  latestObservedAt: string | null;
  worksAtCompanyId: string | null;
}

/** Batch-fetch v2 overlays for many entity ids. Empty entries are safe. */
export async function fetchEntityOverlays(
  supabase: SupabaseClient,
  entityIds: string[],
): Promise<Map<string, EntityOverlay>> {
  const map = new Map<string, EntityOverlay>();
  if (entityIds.length === 0) return map;
  for (const id of entityIds) {
    map.set(id, { claims: {}, identifiers: {}, prediction: null, latestObservedAt: null, worksAtCompanyId: null });
  }

  const [claimsRes, identsRes, predsRes, obsRes, relsRes] = await Promise.all([
    supabase.from('claims')
      .select('entity_id, property, value')
      .in('entity_id', entityIds)
      .is('invalid_at', null),
    supabase.from('entity_identifiers')
      .select('entity_id, kind, value')
      .in('entity_id', entityIds)
      .eq('status', 'active'),
    supabase.from('predictions')
      .select('entity_id, predicted_value, predicted_at')
      .in('entity_id', entityIds)
      .eq('kind', 'icp_fit')
      .order('predicted_at', { ascending: false }),
    supabase.from('observations')
      .select('entity_id, observed_at')
      .in('entity_id', entityIds)
      .order('observed_at', { ascending: false }),
    supabase.from('relationships')
      .select('from_entity_id, to_entity_id, type')
      .in('from_entity_id', entityIds)
      .eq('type', 'works_at')
      .is('valid_to', null),
  ]);

  for (const c of (claimsRes.data as { entity_id: string; property: string; value: unknown }[]) ?? []) {
    map.get(c.entity_id)!.claims[c.property] = c.value;
  }
  for (const i of (identsRes.data as { entity_id: string; kind: string; value: string }[]) ?? []) {
    map.get(i.entity_id)!.identifiers[i.kind] = i.value;
  }
  const seenPred = new Set<string>();
  for (const p of (predsRes.data as { entity_id: string; predicted_value: unknown }[]) ?? []) {
    if (seenPred.has(p.entity_id)) continue;
    seenPred.add(p.entity_id);
    map.get(p.entity_id)!.prediction = p.predicted_value as EntityOverlay['prediction'];
  }
  const seenObs = new Set<string>();
  for (const o of (obsRes.data as { entity_id: string; observed_at: string }[]) ?? []) {
    if (seenObs.has(o.entity_id)) continue;
    seenObs.add(o.entity_id);
    map.get(o.entity_id)!.latestObservedAt = o.observed_at;
  }
  for (const r of (relsRes.data as { from_entity_id: string; to_entity_id: string }[]) ?? []) {
    const o = map.get(r.from_entity_id)!;
    if (!o.worksAtCompanyId) o.worksAtCompanyId = r.to_entity_id;
  }

  return map;
}

/** Overlay v2 data onto a v1 contact row. Returns a new row; doesn't mutate. */
export function applyContactOverlay(
  row: Record<string, unknown>,
  overlay: EntityOverlay | undefined,
): Record<string, unknown> {
  if (!overlay) return row;
  const { claims, identifiers, prediction, latestObservedAt, worksAtCompanyId } = overlay;
  const pick = <T>(...candidates: T[]): T => {
    for (const c of candidates) if (c !== undefined && c !== null) return c;
    return candidates[candidates.length - 1];
  };
  return {
    ...row,
    // Identifiers
    email:              pick(identifiers.email,              row.email as unknown),
    linkedin_url:       pick(identifiers.linkedin_url,       row.linkedin_url as unknown),
    linkedin_member_id: pick(identifiers.linkedin_member_id, row.linkedin_member_id as unknown),
    hubspot_id:         pick(identifiers.hubspot,            row.hubspot_id as unknown),
    pipedrive_id:       pick(identifiers.pipedrive,          row.pipedrive_id as unknown),
    apollo_id:          pick(identifiers.apollo,             row.apollo_id as unknown),
    // Profile claims
    first_name:         pick(claims.first_name,              row.first_name),
    last_name:          pick(claims.last_name,               row.last_name),
    job_title:          pick(claims.job_title,               row.job_title),
    seniority:          pick(claims.seniority,               row.seniority),
    department:         pick(claims.department,              row.department),
    city:               pick(claims.city,                    row.city),
    country:            pick(claims.country,                 row.country),
    phone:              pick(claims.phone,                   row.phone),
    company:            pick(claims.company,                 row.company),
    photo_url:          pick(claims.photo_url,               row.photo_url),
    // Pipeline / lifecycle
    pipeline_stage:     pick(claims.pipeline_stage,          row.pipeline_stage),
    stage_locked:       pick(claims.stage_locked,            row.stage_locked),
    source:             pick(claims.source,                  row.source),
    first_seen_at:      pick(claims.first_seen_at,           row.first_seen_at as unknown),
    // Channels (LinkedIn / email state, JSONB)
    channels:           pick(claims.channels,                row.channels),
    // Relations
    company_id:         pick(worksAtCompanyId,               row.company_id as unknown),
    // Deal state
    deal_health_score:  pick(claims.deal_health_score,       row.deal_health_score),
    deal_stage:         pick(claims.deal_stage,              row.deal_stage),
    deal_value:         pick(claims.deal_value,              row.deal_value),
    // Enrichment process state
    enrichment_status:  pick(claims.enrichment_status,       row.enrichment_status),
    enriched_at:        pick(claims.enriched_at,             row.enriched_at as unknown),
    // LLM-derived summary
    memory_summary:     pick(claims.memory_summary,          row.memory_summary),
    // Scores (from the latest icp_fit prediction)
    icp_score:          pick(prediction?.score,              row.icp_score),
    icp_fit:            pick(prediction?.fit,                row.icp_fit),
    icp_reasoning:      pick(prediction?.reason,             row.icp_reasoning),
    // Derived from observations
    last_activity_at:   pick(latestObservedAt,               row.last_activity_at as unknown),
  };
}

/** Overlay v2 data onto a v1 company row. */
export function applyCompanyOverlay(
  row: Record<string, unknown>,
  overlay: EntityOverlay | undefined,
): Record<string, unknown> {
  if (!overlay) return row;
  const { claims, identifiers } = overlay;
  const pick = <T>(...candidates: T[]): T => {
    for (const c of candidates) if (c !== undefined && c !== null) return c;
    return candidates[candidates.length - 1];
  };
  return {
    ...row,
    name:               pick(claims.name,               row.name),
    domain:             pick(identifiers.domain,        row.domain as unknown),
    industry:           pick(claims.industry,           row.industry),
    employee_count:     pick(claims.employee_count,     row.employee_count),
    location:           pick(claims.location,           row.location),
    revenue_range:      pick(claims.revenue_range,      row.revenue_range),
    tech_stack:         pick(claims.tech_stack,         row.tech_stack),
    enrichment_status:  pick(claims.enrichment_status,  row.enrichment_status),
    enriched_at:        pick(claims.enriched_at,        row.enriched_at as unknown),
    deal_health_score:  pick(claims.deal_health_score,  row.deal_health_score),
    hubspot_company_id: pick(claims.hubspot_company_id, row.hubspot_company_id as unknown),
    apollo_account_id:  pick(claims.apollo_account_id,  row.apollo_account_id as unknown),
  };
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

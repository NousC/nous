import type { SupabaseClient } from '@supabase/supabase-js';
import type { Observation } from './observations.js';
import { getObservations } from './observations.js';

// Claims are the derived layer — the current best belief about
// (entity, property), with calibrated confidence, provenance, and decay.
// Claims are never written by hand: they are computed from observations
// and are fully regenerable. This replaces every bare column that lived
// on v1's `contacts` / `companies`.

export type EpistemicClass = 'observed' | 'inferred' | 'predicted' | 'asserted';
export type Freshness = 'fresh' | 'aging' | 'suspect' | 'expired';

export interface Claim {
  entity_id: string;
  property: string;
  value: unknown;
  confidence: number;
  epistemic_class: EpistemicClass;
  freshness: Freshness;
  decays_at: string | null;
  observation_count: number;
  last_observed_at: string | null;
}

export interface AccountRecord {
  entity_id: string;
  type: string;
  claims: Record<string, Claim>;          // property -> claim
  recent_observations: Observation[];
}

// ── derivation ──────────────────────────────────────────────────────────────
// v1 policy: recency picks the value; corroboration and freshness set the
// confidence. Truth-discovery, calibration, and survival-based decay are
// Tier-A algorithms that come later, demand-driven by data volume.

const DECAY_DAYS = 180;          // default fact half-life; per-fact-type later
const DAY = 86_400_000;

export interface DerivedClaim {
  value: unknown;
  distribution: { value: unknown; weight: number }[];
  confidence: number;
  epistemic_class: EpistemicClass;
  freshness: Freshness;
  decays_at: string | null;
  supporting_observation_ids: string[];
  observation_count: number;
  last_observed_at: string | null;
}

function freshnessFor(ageDays: number): Freshness {
  if (ageDays < 30) return 'fresh';
  if (ageDays < 90) return 'aging';
  if (ageDays < DECAY_DAYS) return 'suspect';
  return 'expired';
}

/** Derive the current claim for one (entity, property) from its state observations. */
export function deriveClaim(observations: Observation[]): DerivedClaim | null {
  const states = observations
    .filter(o => o.kind === 'state' && o.value !== null && o.value !== undefined)
    .sort((a, b) => +new Date(b.observed_at) - +new Date(a.observed_at));
  if (states.length === 0) return null;

  const newest = states[0];
  const key = (v: unknown) => JSON.stringify(v);

  const groups = new Map<string, Observation[]>();
  for (const o of states) {
    const k = key(o.value);
    let g = groups.get(k);
    if (!g) { g = []; groups.set(k, g); }
    g.push(o);
  }

  const supporting = groups.get(key(newest.value))!;   // recency wins the value
  const contradicting = states.length - supporting.length;

  const ageDays = (Date.now() - +new Date(newest.observed_at)) / DAY;
  const freshness = freshnessFor(ageDays);

  // confidence: base + corroboration bonus − contradiction penalty − staleness
  let confidence =
    0.55 +
    Math.min(supporting.length - 1, 4) * 0.08 -
    Math.min(contradicting, 3) * 0.1 -
    (freshness === 'suspect' ? 0.1 : freshness === 'expired' ? 0.25 : 0);
  confidence = Math.max(0.2, Math.min(0.95, confidence));

  const inferredOnly = supporting.every(o => o.method === 'inference');

  return {
    value: newest.value,
    distribution: [...groups.entries()].map(([k, obs]) => ({
      value: JSON.parse(k),
      weight: obs.length / states.length,
    })),
    confidence,
    epistemic_class: inferredOnly ? 'inferred' : 'observed',
    freshness,
    decays_at: new Date(+new Date(newest.observed_at) + DECAY_DAYS * DAY).toISOString(),
    supporting_observation_ids: supporting.map(o => o.id),
    observation_count: states.length,
    last_observed_at: newest.observed_at,
  };
}

// ── read / write ────────────────────────────────────────────────────────────

/** Recompute and persist the claim for one (entity, property). The self-healing step. */
export async function recomputeClaim(
  supabase: SupabaseClient,
  workspaceId: string,
  entityId: string,
  property: string,
): Promise<void> {
  const observations = await getObservations(supabase, workspaceId, entityId, { property });
  const derived = deriveClaim(observations);
  if (!derived) return;

  const { error } = await supabase.from('claims').upsert(
    {
      workspace_id: workspaceId,
      entity_id: entityId,
      property,
      value: derived.value,
      distribution: derived.distribution,
      confidence: derived.confidence,
      epistemic_class: derived.epistemic_class,
      freshness: derived.freshness,
      decays_at: derived.decays_at,
      supporting_observation_ids: derived.supporting_observation_ids,
      observation_count: derived.observation_count,
      last_observed_at: derived.last_observed_at,
      computed_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,entity_id,property' },
  );
  if (error) throw new Error(`failed to upsert claim: ${error.message}`);
}

export async function getClaims(
  supabase: SupabaseClient,
  workspaceId: string,
  entityId: string,
): Promise<Claim[]> {
  const { data, error } = await supabase
    .from('claims')
    .select(
      'entity_id, property, value, confidence, epistemic_class, freshness, decays_at, observation_count, last_observed_at',
    )
    .eq('workspace_id', workspaceId)
    .eq('entity_id', entityId);
  if (error) throw new Error(`failed to load claims: ${error.message}`);
  return (data as Claim[]) ?? [];
}

/**
 * The account record — the projection an agent reads. Entity + every current
 * claim (with its epistemics) + the recent observation timeline. There is no
 * `contacts` table; this is assembled on demand.
 */
export async function getAccountRecord(
  supabase: SupabaseClient,
  workspaceId: string,
  entityId: string,
): Promise<AccountRecord | null> {
  const { data: entity } = await supabase
    .from('entities')
    .select('id, type')
    .eq('id', entityId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (!entity) return null;

  const [claims, recent] = await Promise.all([
    getClaims(supabase, workspaceId, entityId),
    getObservations(supabase, workspaceId, entityId, { limit: 50 }),
  ]);

  return {
    entity_id: entity.id,
    type: entity.type,
    claims: Object.fromEntries(claims.map(c => [c.property, c])),
    recent_observations: recent,
  };
}

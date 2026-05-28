import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScorecardSignal } from '../types.js';
import type { Claim } from './claims.js';
import { scoreLead } from './scorecard.js';
import { getClaims } from './claims.js';

// The prediction-write half of the compound-intelligence loop.
//
// Scoring an entity STAKES a prediction: an immutable snapshot of what the
// Scorecard believed about it, and how reliable that belief was. Later the
// outcome job resolves it against realised evidence — and the
// (prediction, outcome) pair is one graded episode the learning loop trains
// on. Predictions are never updated; a fresh score stakes a new row.

// Company-level features merged in from the entity's employer. Person-level
// features are simply every other claim the entity carries.
const COMPANY_FEATURES = ['industry', 'employee_count'];

// The ICP features a Scorecard actually scores on. If an entity carries none of
// these, it isn't scoreable yet (unenriched) — staking would record a hollow 0
// that's indistinguishable from a genuine bad fit and pollutes calibration.
// Name / company / pipeline claims alone don't count.
const SCOREABLE_FEATURES = ['job_title', 'seniority', 'department', 'industry', 'employee_count'];

export interface StakeResult {
  prediction_id: string;
  entity_id: string;
  score: number;
  fit: boolean;
  fired: number;
}

// Build the feature map + the per-feature {value, confidence} snapshot from a
// set of claims. The snapshot is what lets the learning loop weight an episode
// by how reliable its evidence was at scoring time.
function buildSnapshot(claims: Claim[]): {
  features: Record<string, unknown>;
  snapshot: Record<string, { value: unknown; confidence: number }>;
} {
  const features: Record<string, unknown> = {};
  const snapshot: Record<string, { value: unknown; confidence: number }> = {};
  for (const c of claims) {
    features[c.property] = c.value;
    snapshot[c.property] = { value: c.value, confidence: c.confidence };
  }
  return { features, snapshot };
}

/**
 * Score one person-entity from its claims and stake an `icp_fit` prediction.
 *
 * Features come from the entity's own claims plus the company-level claims of
 * its employer (followed via the works_at relationship). Returns null when the
 * entity has no claims to score yet.
 */
export async function scoreAndStake(
  supabase: SupabaseClient,
  workspaceId: string,
  entityId: string,
  signals: ScorecardSignal[],
): Promise<StakeResult | null> {
  const personClaims = await getClaims(supabase, workspaceId, entityId);
  if (personClaims.length === 0) return null;

  // Merge in the employer's company-level claims, if any.
  let claims = personClaims;
  const { data: rels } = await supabase
    .from('relationships')
    .select('to_entity_id')
    .eq('workspace_id', workspaceId)
    .eq('from_entity_id', entityId)
    .eq('type', 'works_at')
    .is('valid_to', null)
    .limit(1);
  const companyId = rels?.[0]?.to_entity_id as string | undefined;
  if (companyId) {
    const companyClaims = (await getClaims(supabase, workspaceId, companyId))
      .filter(c => COMPANY_FEATURES.includes(c.property));
    claims = [...personClaims, ...companyClaims];
  }

  const { features, snapshot } = buildSnapshot(claims);

  // Gate: only stake on accounts we can actually score. If the entity carries
  // none of the scoreable ICP features yet, it's awaiting enrichment — skip,
  // don't record a hollow 0. It will be picked up once enrichment lands.
  const hasScoreableFeature = SCOREABLE_FEATURES.some(k => {
    const v = features[k];
    return v !== undefined && v !== null && v !== '';
  });
  if (!hasScoreableFeature) return null;

  const { score, fired } = scoreLead(features, signals);
  const fit = score >= 70;
  const reason = fired.length
    ? `Scorecard: ${fired.length} signal${fired.length === 1 ? '' : 's'} fired — ` +
      fired.slice(0, 4).map(f => f.key).join(', ')
    : 'Scorecard: no signals matched this profile';

  const { data, error } = await supabase
    .from('predictions')
    .insert({
      workspace_id: workspaceId,
      entity_id: entityId,
      kind: 'icp_fit',
      predicted_value: { score, fit, reason },
      predicted_confidence: score / 100,
      feature_snapshot: snapshot,
      model_version: 'scorecard',
    })
    .select('id')
    .single();
  if (error) throw new Error(`failed to stake prediction: ${error.message}`);

  return {
    prediction_id: (data as { id: string }).id,
    entity_id: entityId,
    score,
    fit,
    fired: fired.length,
  };
}

/**
 * Person-entities that carry claims but have no open `icp_fit` prediction —
 * the ones the score worker should stake a prediction for next. An entity
 * holds at most one open prediction; once it resolves, it becomes eligible
 * for a fresh score.
 */
export async function entitiesNeedingScore(
  supabase: SupabaseClient,
  workspaceId: string,
  limit = 200,
): Promise<string[]> {
  const [people, open] = await Promise.all([
    supabase
      .from('entities')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('type', 'person')
      .eq('status', 'active'),
    supabase
      .from('predictions')
      .select('entity_id')
      .eq('workspace_id', workspaceId)
      .eq('kind', 'icp_fit')
      .is('resolved_at', null),
  ]);
  if (people.error) throw new Error(`failed to list entities: ${people.error.message}`);
  if (open.error) throw new Error(`failed to list open predictions: ${open.error.message}`);

  const hasOpen = new Set((open.data ?? []).map(p => p.entity_id as string));
  return (people.data ?? [])
    .map(p => p.id as string)
    .filter(id => !hasOpen.has(id))
    .slice(0, limit);
}

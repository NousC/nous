import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScorecardSignal } from '../types.js';
import type { Claim } from './claims.js';
import { scoreToPrediction, modelVersion } from './scorecard.js';
import { getClaims } from './claims.js';
import { pipelineFeatures } from '../services/pipelineFeatures.js';

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

  // Pipeline-engagement features — *how the deal is going* (lead source, channel,
  // inbound/outbound, replied, banded meeting/touch counts), derived from the
  // entity's activity log. Captured into the snapshot so the Mind can learn lift
  // on engagement, not just firmographics. (As of scoring time — the snapshot
  // freezes engagement-so-far against the eventual outcome.)
  const { data: acts } = await supabase
    .from('observations')
    .select('property, source, observed_at')
    .eq('entity_id', entityId).eq('kind', 'event').like('property', 'interaction.%')
    .order('observed_at', { ascending: true }).limit(500);
  for (const [k, v] of Object.entries(pipelineFeatures(acts || []))) {
    features[k] = v;
    snapshot[k] = { value: v, confidence: 1 };
  }

  // Gate: only stake on accounts we can actually score. If the entity carries
  // none of the scoreable ICP features yet, it's awaiting enrichment — skip,
  // don't record a hollow 0. It will be picked up once enrichment lands.
  const hasScoreableFeature = SCOREABLE_FEATURES.some(k => {
    const v = features[k];
    return v !== undefined && v !== null && v !== '';
  });
  if (!hasScoreableFeature) return null;

  const { score, fit, reason, fired } = scoreToPrediction(features, signals);

  const { data, error } = await supabase
    .from('predictions')
    .insert({
      workspace_id: workspaceId,
      entity_id: entityId,
      kind: 'icp_fit',
      predicted_value: { score, fit, reason },
      predicted_confidence: score / 100,
      feature_snapshot: snapshot,
      model_version: modelVersion(signals),
    })
    .select('id')
    .single();
  if (error) throw new Error(`failed to stake prediction: ${error.message}`);

  return {
    prediction_id: (data as { id: string }).id,
    entity_id: entityId,
    score,
    fit,
    fired,
  };
}

/**
 * Person-entities that carry claims but have NO `icp_fit` prediction yet — the
 * ones the score worker should stake a prediction for next. Each entity is
 * scored exactly ONCE: its prediction is re-scored in place while open (when the
 * model changes, see rescore.ts) and frozen once it resolves (won/lost/
 * no_opportunity). We deliberately do NOT re-stake after resolution — doing so
 * churned closed-won customers back into the pipeline as fresh "Pending" rows.
 */
export async function entitiesNeedingScore(
  supabase: SupabaseClient,
  workspaceId: string,
  limit = 200,
): Promise<string[]> {
  const [people, scored] = await Promise.all([
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
      .eq('kind', 'icp_fit'),                 // ANY prediction (open OR resolved)
  ]);
  if (people.error) throw new Error(`failed to list entities: ${people.error.message}`);
  if (scored.error) throw new Error(`failed to list predictions: ${scored.error.message}`);

  const alreadyScored = new Set((scored.data ?? []).map(p => p.entity_id as string));
  return (people.data ?? [])
    .map(p => p.id as string)
    .filter(id => !alreadyScored.has(id))
    .slice(0, limit);
}

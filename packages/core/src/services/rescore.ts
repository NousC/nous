import type { SupabaseClient } from '@supabase/supabase-js';
import { listSignals, scoreToPrediction, modelVersion } from '../db/scorecard.js';

// Re-score-open — keeps the *current fit* fresh as the model evolves.
//
// The bet-vs-current-fit principle: a RESOLVED prediction is an immutable bet
// (the only honest ground truth for "is the model improving?") and is NEVER
// touched here. An OPEN prediction is just today's estimate — it has no outcome
// yet, so when the model changes we recompute it in place from its stored
// feature_snapshot. The prior score is pushed into predicted_value.history so
// the account trail reads "Scored 15 → Re-scored 35", and the head stays the
// current fit. When the account later resolves, the row freezes with its
// history intact and the latest (most-informed) score as the bet.
//
// Triggered after the nightly learning loop ships a signal change
// (scorecardLoop), so a model change immediately refreshes every open account.

export interface RescoreResult {
  rescored: number;       // open predictions whose score actually moved
  restamped: number;      // model changed but this account's score didn't
  version: string | null; // the model fingerprint everything is now at
}

function featuresFromSnapshot(snap: Record<string, { value?: unknown }> | null): Record<string, unknown> {
  const features: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(snap || {})) features[k] = v?.value;
  return features;
}

export async function rescoreOpenPredictions(
  supabase: SupabaseClient,
  workspaceId: string,
  opts: { limit?: number; now?: number } = {},
): Promise<RescoreResult> {
  const signals = await listSignals(supabase, workspaceId);
  const active = signals.filter(s => s.active);
  if (!active.length) return { rescored: 0, restamped: 0, version: null };

  const version = modelVersion(signals);
  const nowIso = new Date(opts.now ?? Date.now()).toISOString();

  const { data: open, error } = await supabase
    .from('predictions')
    .select('id, predicted_value, feature_snapshot, predicted_at, model_version')
    .eq('workspace_id', workspaceId)
    .eq('kind', 'icp_fit')
    .is('resolved_at', null)
    .limit(opts.limit ?? 1000);

  if (error?.code === '42P01' || error?.code === 'PGRST205') return { rescored: 0, restamped: 0, version };
  if (error) throw error;

  let rescored = 0;
  let restamped = 0;
  for (const p of open || []) {
    if (p.model_version === version) continue; // already at the current model

    const features = featuresFromSnapshot(p.feature_snapshot);
    const { score, fit, reason } = scoreToPrediction(features, signals);
    const prev = (p.predicted_value as Record<string, any>) || {};

    if (score === prev.score) {
      // The model changed but this account's score didn't move — just stamp the
      // new version so we don't re-evaluate it next time. No trail entry.
      await supabase.from('predictions').update({ model_version: version }).eq('id', p.id);
      restamped++;
      continue;
    }

    // Score moved: mutate the open estimate, preserving the prior score as
    // history. (Mutating an UNRESOLVED prediction is safe — it isn't a graded
    // bet yet. Resolved rows are never selected here.)
    const priorHistory = Array.isArray(prev.history) ? prev.history : [];
    const priorEntry = {
      score: prev.score ?? null,
      fit: prev.fit ?? null,
      reason: prev.reason ?? null,
      at: prev.rescored_at || p.predicted_at,
      model_version: p.model_version ?? null,
    };
    await supabase
      .from('predictions')
      .update({
        predicted_value: { score, fit, reason, rescored_at: nowIso, history: [priorEntry, ...priorHistory] },
        predicted_confidence: score / 100,
        model_version: version,
      })
      .eq('id', p.id);
    rescored++;
  }

  return { rescored, restamped, version };
}

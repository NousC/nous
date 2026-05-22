// Prediction-write worker — stakes Scorecard predictions on entities.
//
// For every workspace with an active Scorecard, finds person-entities that
// carry claims but have no open `icp_fit` prediction, scores each from its
// claims, and stakes a prediction. This is the front of the compound loop:
// evidence (observations) becomes beliefs (claims) becomes a prediction the
// outcome job will later grade. See packages/core/src/db/predictions.ts.

import {
  getSupabaseClient,
  listSignals,
  scoreAndStake,
  entitiesNeedingScore,
} from '@nous/core';

const PER_WORKSPACE_LIMIT = 200;

export async function scoreEntities() {
  const supabase = getSupabaseClient();
  try {
    // Workspaces with at least one active signal — no Scorecard, nothing to stake.
    const { data: sigRows, error } = await supabase
      .from('scorecard_signals')
      .select('workspace_id')
      .eq('active', true);

    // Migration / tables not yet applied — skip silently.
    if (error?.code === '42P01' || error?.code === 'PGRST205') return;
    if (error) throw error;

    const workspaceIds = [...new Set((sigRows ?? []).map(r => r.workspace_id))];
    if (workspaceIds.length === 0) return;

    let staked = 0;
    let failed = 0;
    for (const workspaceId of workspaceIds) {
      const signals = await listSignals(supabase, workspaceId, { activeOnly: true });
      if (signals.length === 0) continue;

      const entityIds = await entitiesNeedingScore(supabase, workspaceId, PER_WORKSPACE_LIMIT);
      for (const entityId of entityIds) {
        try {
          const result = await scoreAndStake(supabase, workspaceId, entityId, signals);
          if (result) staked++;
        } catch (err) {
          failed++;
          console.error(`[SCORE_ENTITIES] ${entityId}:`, err.message);
        }
      }
    }

    if (staked || failed) {
      console.log(`[SCORE_ENTITIES] staked=${staked} failed=${failed}`);
    }
  } catch (err) {
    console.error('[SCORE_ENTITIES] sweep error:', err.message);
  }
}

// The compound loop — outcome resolution (v2).
//
// scoreAndStake() stakes one `icp_fit` prediction per entity (the
// prediction-write worker). This job closes the loop: it joins each open
// prediction to what actually happened — reply, pipeline advancement,
// closed-won revenue, now all observations — and writes one weighted
// outcome_value the learning loop trains on.
//
// Two-tier resolution (see docs/compound-intelligence-mind.md §5):
//   Pass 1 — resolve open predictions once revenue lands OR the resolution
//            window elapses (early signal: reply + pipeline).
//   Pass 2 — upgrade already-resolved predictions if revenue lands later,
//            within REVENUE_HORIZON_DAYS of the prediction.
//
// Runs daily from the worker cron. Idempotent — it only ever touches
// predictions whose state has actually changed.

import { getSupabaseClient, logWorkerRun } from '@nous/core';

// Pipeline stage ordering — advancement is a rise in rank.
const STAGE_RANK = { identified: 0, aware: 1, interested: 2, evaluating: 3, client: 4 };

// Observation properties that count as a positive reply / engagement signal.
const REPLY_PROPS = [
  'interaction.reply',
  'interaction.email_reply',
  'interaction.linkedin_message',
  'interaction.outbound_positive_reply',
  'interaction.meeting_held',
];

// Observation properties that count as closed-won revenue.
const WON_PROPS = [
  'interaction.deal_won',
  'interaction.payment_received',
  'interaction.proposal_signed',
];

// Outcome signal weights (design §5). Must sum to 1.
const W_REPLY = 0.25;
const W_PIPELINE = 0.35;
const W_REVENUE = 0.40;

// How long after a prediction we keep watching for late revenue.
const REVENUE_HORIZON_DAYS = 120;

// Predictions processed per run, per pass. The job is idempotent, so a backlog
// simply drains over consecutive nightly runs.
const BATCH = 200;

const DAY_MS = 86_400_000;

// Weighted 0..1 outcome score. Pipeline contributes proportionally to how many
// stages the entity advanced (one stage = 0.25, identified→client = 1.0).
function computeOutcomeScore({ replied, pipelineFrom, pipelineTo, won }) {
  const replySignal = replied ? 1 : 0;
  const fromRank = STAGE_RANK[pipelineFrom] ?? 0;
  const toRank = STAGE_RANK[pipelineTo] ?? fromRank;
  const pipelineSignal = Math.min(Math.max(toRank - fromRank, 0), 4) / 4;
  const revenueSignal = won ? 1 : 0;
  const score = W_REPLY * replySignal + W_PIPELINE * pipelineSignal + W_REVENUE * revenueSignal;
  return Math.round(score * 1000) / 1000;
}

// The latest closed-won observation any time after the prediction. Revenue is
// slow, so this is deliberately not window-bounded. The amount may sit in the
// observation's own value or in its raw provider payload.
async function deriveRevenue(supabase, entityId, since) {
  const { data: won } = await supabase
    .from('observations')
    .select('id, value, raw')
    .eq('entity_id', entityId)
    .in('property', WON_PROPS)
    .gte('observed_at', since)
    .order('observed_at', { ascending: false })
    .limit(1);

  if (!won?.length) return { won: false, revenue: null, observationId: null };

  const value = won[0].value || {};
  const raw = won[0].raw || {};
  const amount = Number(
    value.amount ?? value.value ?? raw.amount ?? raw.value ?? raw.deal_value ?? 0,
  ) || null;
  return { won: true, revenue: amount, observationId: won[0].id };
}

// Derive every outcome signal for one prediction: reply (inside the resolution
// window), pipeline movement (the stage claim vs the prediction's snapshot),
// and revenue (any time after the prediction).
async function deriveSignals(supabase, p) {
  const since = p.predicted_at;
  const windowDays = p.resolution_window_days ?? 30;
  const until = new Date(new Date(since).getTime() + windowDays * DAY_MS).toISOString();

  const { data: replies } = await supabase
    .from('observations')
    .select('id')
    .eq('entity_id', p.entity_id)
    .in('property', REPLY_PROPS)
    .gte('observed_at', since)
    .lte('observed_at', until)
    .limit(1);
  const replied = (replies?.length ?? 0) > 0;

  // Pipeline: where the entity stood at scoring time (the snapshot) vs now
  // (the current claim).
  const { data: stageClaim } = await supabase
    .from('claims')
    .select('value')
    .eq('entity_id', p.entity_id)
    .eq('property', 'pipeline_stage')
    .maybeSingle();
  const pipelineFrom = p.feature_snapshot?.pipeline_stage?.value ?? 'identified';
  const pipelineTo = stageClaim?.value ?? pipelineFrom;

  const rev = await deriveRevenue(supabase, p.entity_id, since);

  // Closed-won signal. Prefer an explicit revenue observation (deal_won /
  // payment_received / proposal_signed) when one exists, but also treat
  // reaching the `client` pipeline stage as won — that's this CRM's closed-won
  // state, and it's what flows today. Either one fires the 0.40 revenue weight
  // and resolves the prediction immediately instead of waiting out the window.
  const wonByStage = pipelineTo === 'client';
  return {
    replied,
    pipelineFrom,
    pipelineTo,
    won: rev.won || wonByStage,
    revenue: rev.revenue,
    observationId: rev.observationId,
  };
}

export async function resolveOutcomes() {
  const supabase = getSupabaseClient();
  const startedAt = new Date();
  const now = Date.now();
  let resolved = 0;
  let upgraded = 0;
  // Per-workspace tallies so the Intelligence page shows each workspace's
  // outcome resolution separately.
  const perWorkspace = new Map(); // workspace_id → { resolved, upgraded }
  const bump = (wsId, field) => {
    if (!wsId) return;
    const row = perWorkspace.get(wsId) || { resolved: 0, upgraded: 0 };
    row[field]++;
    perWorkspace.set(wsId, row);
  };

  // ── Pass 1: resolve open predictions ──────────────────────────────────────
  const { data: open, error } = await supabase
    .from('predictions')
    .select('id, workspace_id, entity_id, predicted_at, resolution_window_days, feature_snapshot')
    .is('resolved_at', null)
    .eq('kind', 'icp_fit')
    .order('predicted_at', { ascending: true })
    .limit(BATCH);

  // Migration / tables not yet applied — skip silently so we don't spam logs.
  if (error?.code === '42P01' || error?.code === 'PGRST205') return;
  if (error) {
    console.error('[MIND_OUTCOMES] open-prediction scan failed:', error.message);
    return;
  }

  for (const p of open || []) {
    const windowMs = (p.resolution_window_days ?? 30) * DAY_MS;
    const windowElapsed = now >= new Date(p.predicted_at).getTime() + windowMs;

    const s = await deriveSignals(supabase, p);

    // Resolve on definitive revenue, or once the resolution window elapses.
    // Otherwise keep observing — re-checked on the next run.
    if (!s.won && !windowElapsed) continue;

    const score = computeOutcomeScore(s);
    await supabase
      .from('predictions')
      .update({
        outcome_value: {
          replied: s.replied,
          pipeline_from: s.pipelineFrom,
          pipeline_to: s.pipelineTo,
          revenue: s.revenue,
          score,
        },
        outcome_observation_id: s.observationId,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', p.id);
    resolved++;
    bump(p.workspace_id, 'resolved');
  }

  // ── Pass 2: late-revenue upgrade ──────────────────────────────────────────
  // Predictions resolved on early signal (reply/pipeline) get their score
  // upgraded if revenue lands later, within the revenue horizon.
  const horizonCutoff = new Date(now - REVENUE_HORIZON_DAYS * DAY_MS).toISOString();
  const { data: resolvedRecent } = await supabase
    .from('predictions')
    .select('id, workspace_id, entity_id, predicted_at, outcome_value')
    .not('resolved_at', 'is', null)
    .eq('kind', 'icp_fit')
    .gte('predicted_at', horizonCutoff)
    .limit(BATCH);

  for (const p of resolvedRecent || []) {
    const ov = p.outcome_value || {};
    if (ov.revenue != null) continue; // already carries revenue

    const rev = await deriveRevenue(supabase, p.entity_id, p.predicted_at);
    if (!rev.won) continue;

    const score = computeOutcomeScore({
      replied: ov.replied,
      pipelineFrom: ov.pipeline_from,
      pipelineTo: ov.pipeline_to,
      won: true,
    });
    await supabase
      .from('predictions')
      .update({
        outcome_value: { ...ov, revenue: rev.revenue, score },
        outcome_observation_id: rev.observationId,
      })
      .eq('id', p.id);
    upgraded++;
    bump(p.workspace_id, 'upgraded');
  }

  if (resolved || upgraded) {
    console.log(`[MIND_OUTCOMES] resolved=${resolved} upgraded=${upgraded}`);
  }

  // Write one worker_runs row per workspace that had activity, plus a
  // system-wide row so the nightly heartbeat is always visible — even when
  // there was nothing to resolve. The summary distinguishes the two zero
  // cases that look the same but mean different things:
  //   "no predictions to watch"     — nobody has been scored yet
  //   "N open, none ready yet"      — predictions exist but await their
  //                                   30-day window or a revenue signal
  if (perWorkspace.size === 0) {
    const openCount = open?.length ?? 0;
    const summary = openCount === 0
      ? 'no predictions to watch — Scorecard hasn\'t staked any yet'
      : `${openCount} open prediction${openCount === 1 ? '' : 's'}, none ready (waiting on revenue or 30-day window)`;
    await logWorkerRun(supabase, {
      worker: 'mind_outcomes',
      status: 'no_op',
      summary,
      details: { resolved: 0, upgraded: 0, open_pending: openCount },
      startedAt,
    });
  } else {
    for (const [workspaceId, counts] of perWorkspace) {
      await logWorkerRun(supabase, {
        worker: 'mind_outcomes',
        workspaceId,
        status: 'success',
        summary: `resolved ${counts.resolved}${counts.upgraded ? `, upgraded ${counts.upgraded}` : ''}`,
        details: counts,
        startedAt,
      });
    }
  }
}

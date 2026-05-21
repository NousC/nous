// The Mind — outcome resolution (Phase 2).
//
// scoreICP() writes one mind_episodes row per prediction (Phase 1). This job
// closes the loop: it joins each open prediction to what actually happened —
// reply, pipeline advancement, closed-won revenue — and writes a single
// weighted outcome_score the judge can later learn from.
//
// Resolution is two-tier (see docs/compound-intelligence-mind.md §5):
//   Pass 1 — resolve open episodes once revenue lands OR the observation
//            window elapses (early signal: reply + pipeline).
//   Pass 2 — upgrade already-resolved episodes if revenue lands later,
//            within REVENUE_HORIZON_DAYS of the prediction.
//
// Runs daily from the worker cron. Safe to run repeatedly — it only ever
// touches episodes whose state has actually changed.

import { getSupabaseClient } from '@nous/core';

// Pipeline stage ordering — advancement is a rise in rank.
const STAGE_RANK = { identified: 0, aware: 1, interested: 2, evaluating: 3, client: 4 };

// Activity types that count as a positive reply / engagement signal.
const REPLY_TYPES = ['email_reply', 'linkedin_message', 'outbound_positive_reply', 'meeting_held'];

// Activity types that count as closed-won revenue.
const WON_TYPES = ['deal_won', 'payment_received', 'proposal_signed'];

// Outcome signal weights (design §5). Must sum to 1.
const W_REPLY = 0.25;
const W_PIPELINE = 0.35;
const W_REVENUE = 0.40;

// How long after a prediction we keep watching for late revenue.
const REVENUE_HORIZON_DAYS = 120;

// Episodes processed per run, per pass. The job is idempotent, so a backlog
// simply drains over consecutive nightly runs.
const BATCH = 200;

const DAY_MS = 86_400_000;

// Weighted 0..1 outcome score. Pipeline contributes proportionally to how many
// stages the contact advanced (one stage = 0.25, identified→client = 1.0).
function computeOutcomeScore({ replied, pipelineFrom, pipelineTo, won }) {
  const replySignal = replied ? 1 : 0;
  const fromRank = STAGE_RANK[pipelineFrom] ?? 0;
  const toRank = STAGE_RANK[pipelineTo] ?? fromRank;
  const pipelineSignal = Math.min(Math.max(toRank - fromRank, 0), 4) / 4;
  const revenueSignal = won ? 1 : 0;
  const score = W_REPLY * replySignal + W_PIPELINE * pipelineSignal + W_REVENUE * revenueSignal;
  return Math.round(score * 1000) / 1000;
}

// Look for a closed-won activity any time after the prediction. Revenue is
// slow, so this is deliberately not window-bounded. dealValue (optional) is the
// contact's current deal_value, used when the event carries no explicit amount.
async function deriveRevenue(supabase, contactId, since, dealValue) {
  const { data: wonRows } = await supabase
    .from('contact_activity_log')
    .select('raw_data')
    .eq('contact_id', contactId)
    .in('activity_type', WON_TYPES)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(1);

  if (!wonRows?.length) return { won: false, revenue: null };

  const raw = wonRows[0].raw_data || {};
  const amount = Number(raw.amount ?? raw.value ?? raw.deal_value ?? dealValue ?? 0) || null;
  return { won: true, revenue: amount };
}

// Derive every signal for one episode: reply (inside the window), current
// pipeline stage, and revenue (any time after the prediction).
async function deriveSignals(supabase, ep) {
  const since = ep.predicted_at;
  const windowDays = ep.outcome_window_days ?? 30;
  const until = new Date(new Date(since).getTime() + windowDays * DAY_MS).toISOString();

  const { data: replyRows } = await supabase
    .from('contact_activity_log')
    .select('id')
    .eq('contact_id', ep.contact_id)
    .in('activity_type', REPLY_TYPES)
    .gte('occurred_at', since)
    .lte('occurred_at', until)
    .limit(1);
  const replied = (replyRows?.length ?? 0) > 0;

  const { data: contact } = await supabase
    .from('contacts')
    .select('pipeline_stage, deal_value')
    .eq('id', ep.contact_id)
    .maybeSingle();
  const pipelineTo = contact?.pipeline_stage ?? ep.outcome_pipeline_from ?? 'identified';

  const rev = await deriveRevenue(supabase, ep.contact_id, since, contact?.deal_value);

  return { replied, pipelineTo, won: rev.won, revenue: rev.revenue };
}

export async function resolveMindEpisodes() {
  const supabase = getSupabaseClient();
  const now = Date.now();
  let resolved = 0;
  let upgraded = 0;

  // ── Pass 1: resolve open episodes ─────────────────────────────────────────
  const { data: open, error } = await supabase
    .from('mind_episodes')
    .select('id, contact_id, predicted_at, outcome_window_days, outcome_pipeline_from')
    .is('outcome_resolved_at', null)
    .eq('kind', 'icp_score')
    .order('predicted_at', { ascending: true })
    .limit(BATCH);

  if (error) {
    console.error('[MIND_OUTCOMES] open-episode scan failed:', error.message);
    return;
  }

  for (const ep of open || []) {
    // Contact deleted — nothing left to measure. Resolve with no score.
    if (!ep.contact_id) {
      await supabase
        .from('mind_episodes')
        .update({ outcome_resolved_at: new Date().toISOString() })
        .eq('id', ep.id);
      resolved++;
      continue;
    }

    const windowMs = (ep.outcome_window_days ?? 30) * DAY_MS;
    const windowElapsed = now >= new Date(ep.predicted_at).getTime() + windowMs;

    const signals = await deriveSignals(supabase, ep);

    // Resolve on definitive revenue, or once the observation window elapses.
    // Otherwise keep observing — re-checked on the next run.
    if (!signals.won && !windowElapsed) continue;

    const score = computeOutcomeScore({
      replied: signals.replied,
      pipelineFrom: ep.outcome_pipeline_from,
      pipelineTo: signals.pipelineTo,
      won: signals.won,
    });

    await supabase
      .from('mind_episodes')
      .update({
        outcome_replied: signals.replied,
        outcome_pipeline_to: signals.pipelineTo,
        outcome_revenue: signals.revenue,
        outcome_score: score,
        outcome_resolved_at: new Date().toISOString(),
      })
      .eq('id', ep.id);
    resolved++;
  }

  // ── Pass 2: late-revenue upgrade ──────────────────────────────────────────
  // Episodes resolved on early signal (reply/pipeline) get their score
  // upgraded if revenue lands later, within the revenue horizon.
  const horizonCutoff = new Date(now - REVENUE_HORIZON_DAYS * DAY_MS).toISOString();
  const { data: resolvedNoRev } = await supabase
    .from('mind_episodes')
    .select('id, contact_id, predicted_at, outcome_replied, outcome_pipeline_from, outcome_pipeline_to')
    .not('outcome_resolved_at', 'is', null)
    .is('outcome_revenue', null)
    .eq('kind', 'icp_score')
    .gte('predicted_at', horizonCutoff)
    .limit(BATCH);

  for (const ep of resolvedNoRev || []) {
    if (!ep.contact_id) continue;

    const rev = await deriveRevenue(supabase, ep.contact_id, ep.predicted_at);
    if (!rev.won) continue;

    const score = computeOutcomeScore({
      replied: ep.outcome_replied,
      pipelineFrom: ep.outcome_pipeline_from,
      pipelineTo: ep.outcome_pipeline_to,
      won: true,
    });

    await supabase
      .from('mind_episodes')
      .update({ outcome_revenue: rev.revenue, outcome_score: score })
      .eq('id', ep.id);
    upgraded++;
  }

  if (resolved || upgraded) {
    console.log(`[MIND_OUTCOMES] resolved=${resolved} upgraded=${upgraded}`);
  }
}

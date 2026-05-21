// The Mind — the learning loop (Adaptive Lead Scoring, Phase 4c).
//
// Nightly, per workspace: re-scores past predictions with the current
// Scorecard, proposes one change, tests it on a time-held-back split, and
// ships it only if both gates agree — then logs the run.
//
// Charter-aligned: it trains on the account record's resolved `mind_episodes`
// (predictions checked against real outcomes — reply, pipeline, closed-won),
// not on cold-lead lists. "Close the loop" — closed outcomes feeding the
// scoring model — is exactly the Founding Charter's Phase 1.
//
// propose → test → keep or drop. Two gates: accuracy (does the held-back
// calibration gap rise?) and carry-over (would the change generalize?).
//
// See docs/adaptive-lead-scoring.md.

import Anthropic from '@anthropic-ai/sdk';
import {
  getSupabaseClient,
  listSignals,
  scoreLead,
  upsertSignal,
  setSignalActive,
  logScorecardRun,
} from '@nous/core';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MIN_EPISODES = 20;     // below this, not enough evidence to learn from
const HOLDBACK_FRAC = 0.3;   // the newest 30% of episodes is held back
const HIGH_SCORE = 60;       // Scorecard score ≥ this = "predicted to convert"
const MAX_STEPS = 4;         // catalog changes attempted per run
const CATALOG_CAP = 12;      // ceiling on active signals — forces pruning
const MODEL = 'claude-haiku-4-5-20251001';

const clampWeight = (w) => Math.max(-10, Math.min(10, Math.round(Number(w) || 0)));
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

// Calibration gap on a set of scored episodes: how much better the high-score
// cohort's outcomes are than the low-score cohort's.
function calibrationGap(rows) {
  const hi = rows.filter(r => r.score >= HIGH_SCORE).map(r => r.outcome);
  const lo = rows.filter(r => r.score < HIGH_SCORE).map(r => r.outcome);
  if (!hi.length || !lo.length) return null;
  return avg(hi) - avg(lo);
}

const scoreAll = (episodes, signals) =>
  episodes.map(e => ({ ...e, score: scoreLead(e.features, signals).score }));

// Build the candidate signal set in memory (pure — no DB).
function applyProposal(signals, p) {
  if (!p?.signal?.key) return null;
  const key = p.signal.key;
  const next = signals.map(s => ({ ...s }));

  if (p.action === 'remove') {
    const s = next.find(x => x.key === key);
    if (!s) return null;
    s.active = false;
    return next;
  }

  const existing = next.find(s => s.key === key);
  if (existing) {
    existing.weight = clampWeight(p.signal.weight);
    existing.label = p.signal.label || existing.label;
    existing.rule = p.signal.rule || existing.rule;
    existing.active = true;
    return next;
  }
  if (next.filter(s => s.active).length >= CATALOG_CAP) return null; // capped
  next.push({
    key,
    label: p.signal.label || key,
    weight: clampWeight(p.signal.weight),
    rule: p.signal.rule || {},
    active: true,
  });
  return next;
}

// ── Gate 2 — carry-over: would this change generalize, or is it overfit? ──────
async function carryOverCheck(proposal) {
  const prompt =
    `A learning loop wants to change a GTM account-scoring model:\n` +
    `${JSON.stringify(proposal.signal)}\nreason: ${proposal.note || ''}\n\n` +
    `Would this signal plausibly hold for future accounts in a different ` +
    `campaign, or is it likely overfit to one batch of data?\n` +
    `Respond as JSON: {"generalizes": true|false}`;
  try {
    const msg = await anthropic.messages.create({
      model: MODEL, max_tokens: 60, messages: [{ role: 'user', content: prompt }],
    });
    const j = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)?.[0] || '{}');
    return j.generalizes === true;
  } catch {
    return false; // fail closed — never ship a change on a failed check
  }
}

// ── Propose one change from the training set's misscored episodes ─────────────
async function propose(signals, train) {
  const wrong = scoreAll(train, signals)
    .filter(r => (r.score >= HIGH_SCORE && r.outcome < 0.3)
              || (r.score < HIGH_SCORE && r.outcome > 0.6))
    .slice(0, 20);
  if (wrong.length === 0) return null;

  const active = signals.filter(s => s.active);
  const prompt =
    `You are refining a Scorecard — weighted signals that score how well a GTM ` +
    `account fits, predicting whether it converts.\n\n` +
    `Current signals:\n${active.map(s =>
      `- ${s.key} (weight ${s.weight}): ${s.label} | rule ${JSON.stringify(s.rule)}`,
    ).join('\n') || '(none)'}\n\n` +
    `These accounts were scored wrong (score 0-100; outcome 0-1, 1 = converted):\n` +
    `${wrong.map(r =>
      `score ${r.score}, outcome ${r.outcome.toFixed(2)}, features ${JSON.stringify(r.features)}`,
    ).join('\n')}\n\n` +
    `Propose exactly ONE change to separate converters from non-converters ` +
    `better. Negative-weight signals (reasons an account will NOT convert) are ` +
    `often the strongest lever. Keys are snake_case; weight is -10..10; a rule ` +
    `is { "feature": <name>, "op": ==|!=|>=|<=|>|<|in|exists, "value": <value> }.\n` +
    `Respond as JSON only: {"action":"add"|"recalibrate"|"remove","signal":` +
    `{"key":"...","label":"...","weight":<int>,"rule":{...}},"note":"<short>"}`;

  try {
    const msg = await anthropic.messages.create({
      model: MODEL, max_tokens: 300, messages: [{ role: 'user', content: prompt }],
    });
    const p = JSON.parse(msg.content[0].text.match(/\{[\s\S]*\}/)?.[0] || '{}');
    return p?.signal?.key ? p : null;
  } catch {
    return null;
  }
}

// ── One workspace's run ───────────────────────────────────────────────────────
async function runForWorkspace(supabase, workspaceId, episodes) {
  // episodes arrive sorted by predicted_at ascending — split by time.
  const cut = Math.floor(episodes.length * (1 - HOLDBACK_FRAC));
  const train = episodes.slice(0, cut);
  const held = episodes.slice(cut);
  if (train.length < 5 || held.length < 5) return;

  let signals = await listSignals(supabase, workspaceId);
  if (signals.length === 0) return; // no Scorecard seeded yet — nothing to refine

  const baseline = calibrationGap(scoreAll(held, signals));
  let current = baseline;
  let steps = 0;
  let kept = 0;
  const notes = [];

  for (let i = 0; i < MAX_STEPS; i++) {
    const proposal = await propose(signals, train);
    if (!proposal) break;
    steps++;

    const candidate = applyProposal(signals, proposal);
    if (!candidate) continue;

    // Gate 1 — accuracy: the held-back calibration gap must rise.
    const newGap = calibrationGap(scoreAll(held, candidate));
    if (newGap == null) continue;
    if (current != null && newGap <= current) continue;

    // Gate 2 — carry-over.
    if (!(await carryOverCheck(proposal))) continue;

    // Both gates passed — ship it.
    if (proposal.action === 'remove') {
      const s = signals.find(x => x.key === proposal.signal.key);
      if (s?.id) await setSignalActive(supabase, workspaceId, s.id, false);
    } else {
      await upsertSignal(supabase, workspaceId, {
        key: proposal.signal.key,
        label: proposal.signal.label || proposal.signal.key,
        weight: clampWeight(proposal.signal.weight),
        rule: proposal.signal.rule || {},
      });
    }
    signals = await listSignals(supabase, workspaceId); // refresh (picks up ids)
    current = newGap;
    kept++;
    notes.push(proposal.note || proposal.signal.key);
  }

  await logScorecardRun(supabase, workspaceId, {
    steps,
    gap_before: baseline,
    gap_after: current,
    signal_count: signals.filter(s => s.active).length,
    note: kept ? `kept ${kept}: ${notes.join('; ')}` : 'no change cleared both gates',
  });
  if (kept) {
    console.log(`[SCORECARD_LOOP] ${workspaceId}: ${kept} change(s), gap ${baseline?.toFixed(3) ?? '—'} → ${current?.toFixed(3) ?? '—'}`);
  }
}

export async function runScorecardLoop() {
  const supabase = getSupabaseClient();

  // The evidence set: resolved predictions from the account record.
  const { data: eps, error } = await supabase
    .from('mind_episodes')
    .select('workspace_id, features, outcome_score, predicted_at')
    .eq('kind', 'icp_score')
    .not('outcome_resolved_at', 'is', null)
    .not('outcome_score', 'is', null)
    .order('predicted_at', { ascending: true })
    .limit(10000);

  if (error) {
    console.error('[SCORECARD_LOOP] scan failed:', error.message);
    return;
  }

  // Group by workspace; only episodes that carry a feature snapshot are usable.
  const byWorkspace = new Map();
  for (const e of eps || []) {
    if (!e.features || Object.keys(e.features).length === 0) continue;
    if (!byWorkspace.has(e.workspace_id)) byWorkspace.set(e.workspace_id, []);
    byWorkspace.get(e.workspace_id).push({
      features: e.features,
      outcome: e.outcome_score,
      predicted_at: e.predicted_at,
    });
  }

  for (const [workspaceId, episodes] of byWorkspace) {
    if (episodes.length < MIN_EPISODES) continue;
    try {
      await runForWorkspace(supabase, workspaceId, episodes);
    } catch (e) {
      console.error('[SCORECARD_LOOP] workspace', workspaceId, 'failed:', e.message);
    }
  }
}

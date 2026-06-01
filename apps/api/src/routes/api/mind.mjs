// The Mind — calibration metric (Phase 3).
//
// Surfaces the single headline number for "is the Mind getting smarter":
// the calibration gap. A well-calibrated ICP scores the contacts who actually
// convert higher than those who don't, so
//
//   gap = avg(outcome_score | predicted_score >= 70)
//       - avg(outcome_score | predicted_score <  70)
//
// is large and positive. The judge (Phase 4) widens it; this endpoint lets the
// Mind page plot it. See docs/compound-intelligence-mind.md §7.

import { Router } from 'express';
import Anthropic from 'useleak';
import { getSupabaseClient, listSignals, seedSignals, listNotes, scoreLead, getAttention, saveNote, deleteNote, supersedeNote, getWorkspaceEntityId } from '@nous/core';

export const mindRouter = Router();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Features a seed signal's rule may reference. The lead feature snapshot is
// populated by enrichment; until then rules are valid but inert.
const FEATURE_VOCAB =
  'job_title (string), seniority (one of: c_suite, vp, director, manager, ic), ' +
  'department (string), industry (string), employee_count (number), ' +
  'country (string), company (string)';

// Monday-of-week key (UTC) — buckets episodes for the weekly trend.
function weekKey(iso) {
  const d = new Date(iso);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

const round3 = (n) => Math.round(n * 1000) / 1000;
const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);

// GET /api/mind/substrate?workspaceId=… — the compound-intelligence loop,
// stage by stage, read straight from the v2 evidence substrate:
//
//   observations  →  claims (self-healing)  →  predictions  →  calibration
//
// Each stage is a real table. This is the loop made transparent: the
// evidence it has seen, the beliefs it derived, the predictions it staked,
// and how well those predictions held up.
mindRouter.get('/substrate', async (req, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const supabase = getSupabaseClient();
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();

    // Totals via count('exact') — Supabase/PostgREST caps row-returning
    // queries at 1000 server-side, so .length of a fetched array LIES about
    // total count. Use head:true count queries for the headline numbers and
    // separate (capped) sample queries for breakdowns.
    const [
      obsTotalRes, obsSampleRes, obs7Res,
      claimsTotalRes, claimsSampleRes,
      jobsRes,
      predTotalRes, predSampleRes,
    ] = await Promise.all([
      // observations total
      supabase.from('observations').select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId),
      // observations sample for by-source breakdown (top sources, not exhaustive)
      supabase.from('observations').select('source')
        .eq('workspace_id', workspaceId).limit(2000),
      // last-7d observations count
      supabase.from('observations').select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId).gte('ingested_at', sevenDaysAgo),
      // claims total
      supabase.from('claims').select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId).is('invalid_at', null),
      // claims sample for freshness + epistemic-class breakdown
      supabase.from('claims').select('freshness, epistemic_class')
        .eq('workspace_id', workspaceId).is('invalid_at', null).limit(2000),
      // self-healing — the unprocessed recompute queue
      supabase.from('claim_jobs').select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId).is('picked_at', null),
      // predictions total
      supabase.from('predictions').select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId),
      // predictions sample for kind/open/resolved + calibration trend
      supabase.from('predictions')
        .select('kind, predicted_value, outcome_value, predicted_at, resolved_at')
        .eq('workspace_id', workspaceId).limit(2000),
    ]);
    if (obsSampleRes.error) throw obsSampleRes.error;
    if (claimsSampleRes.error) throw claimsSampleRes.error;
    if (predSampleRes.error) throw predSampleRes.error;

    const observationsTotal = obsTotalRes.count ?? 0;
    const claimsTotal = claimsTotalRes.count ?? 0;
    const predictionsTotal = predTotalRes.count ?? 0;

    // ── 1. evidence ──────────────────────────────────────────────
    const observations = obsSampleRes.data || [];
    const bySource = {};
    for (const o of observations) bySource[o.source] = (bySource[o.source] || 0) + 1;
    const sources = Object.entries(bySource)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);

    // ── 2. beliefs ───────────────────────────────────────────────
    const claims = claimsSampleRes.data || [];
    const freshness = { fresh: 0, aging: 0, suspect: 0, expired: 0 };
    const epistemic = { observed: 0, inferred: 0, predicted: 0, asserted: 0 };
    for (const c of claims) {
      if (c.freshness in freshness) freshness[c.freshness]++;
      if (c.epistemic_class in epistemic) epistemic[c.epistemic_class]++;
    }

    // ── 3 + 4. predictions and calibration ───────────────────────
    // A well-calibrated model scores the accounts that actually convert
    // higher than those that don't, so
    //   gap = avg(outcome | predicted >= 70) - avg(outcome | predicted < 70)
    // is large and positive.
    const preds = predSampleRes.data || [];
    const byKind = {};
    let open = 0, resolved = 0;
    const high = [], low = [];
    const byWeek = new Map();
    for (const p of preds) {
      byKind[p.kind] = (byKind[p.kind] || 0) + 1;
      if (!p.resolved_at) { open++; continue; }
      resolved++;
      const ps = Number(p.predicted_value?.score);
      const os = Number(p.outcome_value?.score);
      if (!Number.isFinite(ps) || !Number.isFinite(os)) continue;
      (ps >= 70 ? high : low).push(os);
      const k = weekKey(p.predicted_at);
      if (!byWeek.has(k)) byWeek.set(k, { high: [], low: [] });
      (ps >= 70 ? byWeek.get(k).high : byWeek.get(k).low).push(os);
    }
    const avgHigh = avg(high), avgLow = avg(low);
    const gap = avgHigh != null && avgLow != null ? round3(avgHigh - avgLow) : null;
    const trend = [...byWeek.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week, c]) => {
        const h = avg(c.high), l = avg(c.low);
        return { week, n: c.high.length + c.low.length, gap: h != null && l != null ? round3(h - l) : null };
      });

    // ── 5. compound-intelligence layer — signals, predictions feed, misses, attention ──

    // Active scorecard signals (used both for hit-rate analysis and ranking)
    const activeSignals = await listSignals(supabase, workspaceId, { activeOnly: true });

    // Top firing signals — by re-evaluating each resolved prediction's
    // feature_snapshot through the current Scorecard. We count fires + hits
    // (positive outcome = outcome_value.score >= 0.5).
    const signalStats = new Map();
    for (const s of activeSignals) signalStats.set(s.key, { signal: s, fires: 0, hits: 0 });
    // Decided cohort = resolved predictions with a finite outcome. Lift compares
    // the win rate among accounts where a signal fired vs where it didn't.
    let totalDecided = 0, totalWins = 0;
    for (const p of preds) {
      if (!p.resolved_at) continue;
      const out = Number(p.outcome_value?.score);
      if (!Number.isFinite(out)) continue;
      totalDecided++;
      const positive = out >= 0.5;
      if (positive) totalWins++;
      const snap = p.feature_snapshot || {};
      const features = {};
      for (const [k, v] of Object.entries(snap)) features[k] = v?.value;
      const { fired } = scoreLead(features, activeSignals);
      for (const f of fired) {
        const stat = signalStats.get(f.key);
        if (!stat) continue;
        stat.fires++;
        if (positive) stat.hits++;
      }
    }
    // lift(signal) = winRate(fired) / winRate(not-fired). Null until both groups
    // have a minimum sample and a non-zero baseline — small cohorts lie.
    const liftOf = (fires, hits) => {
      const notFired = totalDecided - fires;
      const winsNotFired = totalWins - hits;
      if (fires < 3 || notFired < 1) return null;
      const wrFired = hits / fires;
      const wrNot = winsNotFired / notFired;
      if (wrNot <= 0) return null;
      return Math.round((wrFired / wrNot) * 10) / 10;
    };
    const topSignals = [...signalStats.values()]
      .filter(s => s.fires > 0)
      .sort((a, b) => b.fires - a.fires)
      .slice(0, 8)
      .map(s => ({
        key: s.signal.key,
        label: s.signal.label,
        weight: s.signal.weight,
        fires: s.fires,
        hits: s.hits,
        hit_rate: s.fires ? Math.round((s.hits / s.fires) * 100) : 0,
        lift: liftOf(s.fires, s.hits),
        sample: s.fires,
      }));

    // Recent predictions feed (last 20) — enriched with entity name + email
    const recentPredsRes = await supabase
      .from('predictions')
      .select('id, entity_id, predicted_value, predicted_at, outcome_value, resolved_at')
      .eq('workspace_id', workspaceId).eq('kind', 'icp_fit')
      .order('predicted_at', { ascending: false }).limit(20);
    const recentRows = recentPredsRes.data || [];
    const recentEntityIds = [...new Set(recentRows.map(r => r.entity_id))];

    let nameByEntity = {}, emailByEntity = {};
    if (recentEntityIds.length) {
      const [{ data: claimsForNames }, { data: emailIdents }] = await Promise.all([
        supabase.from('claims').select('entity_id, property, value')
          .in('entity_id', recentEntityIds).is('invalid_at', null)
          .in('property', ['first_name', 'last_name']),
        supabase.from('entity_identifiers').select('entity_id, value')
          .in('entity_id', recentEntityIds).eq('kind', 'email').eq('status', 'active'),
      ]);
      for (const c of claimsForNames || []) {
        if (!nameByEntity[c.entity_id]) nameByEntity[c.entity_id] = { first_name: null, last_name: null };
        nameByEntity[c.entity_id][c.property] = c.value;
      }
      for (const i of emailIdents || []) emailByEntity[i.entity_id] = i.value;
    }

    const buildRecent = (p) => {
      const n = nameByEntity[p.entity_id];
      const name = n ? [n.first_name, n.last_name].filter(Boolean).join(' ') || null : null;
      // Top firing signal keys (recompute, lightweight)
      const snap = p.feature_snapshot || {};
      const features = {};
      for (const [k, v] of Object.entries(snap)) features[k] = v?.value;
      const fired = scoreLead(features, activeSignals).fired.slice(0, 3).map(f => f.key);
      return {
        id: p.id,
        entity_id: p.entity_id,
        name,
        email: emailByEntity[p.entity_id] || null,
        score: p.predicted_value?.score ?? null,
        fit: p.predicted_value?.fit ?? null,
        predicted_at: p.predicted_at,
        resolved_at: p.resolved_at,
        outcome_score: p.outcome_value?.score ?? null,
        replied: p.outcome_value?.replied ?? null,
        fired,
      };
    };
    const recentEnriched = recentRows.map(buildRecent);

    // Misses — resolved predictions where the model and reality disagreed
    const misses = recentEnriched
      .filter(p => {
        if (!p.resolved_at || typeof p.outcome_score !== 'number') return false;
        const s = Number(p.score);
        if (!Number.isFinite(s)) return false;
        return (s >= 70 && p.outcome_score < 0.3) || (s < 30 && p.outcome_score > 0.7);
      })
      .slice(0, 10);

    // Attention — accounts going quiet, claims decayed. Already a v2 helper.
    let attention = [];
    try {
      const atRes = await getAttention(supabase, workspaceId, { limit: 8 });
      attention = atRes.items ?? [];
    } catch (e) {
      console.warn('[GET /api/mind/substrate] attention failed:', e?.message);
    }

    return res.json({
      observations: {
        total: observationsTotal,
        last_7d: obs7Res.count ?? 0,
        by_source: sources,
      },
      claims: { total: claimsTotal, freshness, epistemic },
      recompute: { pending: jobsRes.count ?? 0 },
      predictions: { total: predictionsTotal, open, resolved, by_kind: byKind },
      calibration: {
        resolved: high.length + low.length,
        gap,
        high: { count: high.length, avg_outcome: avgHigh != null ? round3(avgHigh) : null },
        low: { count: low.length, avg_outcome: avgLow != null ? round3(avgLow) : null },
        trend,
      },
      top_signals: topSignals,
      recent_predictions: recentEnriched,
      misses,
      attention,
    });
  } catch (err) {
    console.error('[GET /api/mind/substrate]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/mind/icp?workspaceId=… — the plain-English ICP, the Scorecard seed.
mindRouter.get('/icp', async (req, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const { data, error } = await getSupabaseClient()
      .from('workspaces')
      .select('icp_text')
      .eq('id', workspaceId)
      .maybeSingle();
    if (error) throw error;
    return res.json({ icp_text: data?.icp_text ?? null });
  } catch (err) {
    console.error('[GET /api/mind/icp]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// PUT /api/mind/icp — set the ICP. Body: { workspaceId, icp_text }.
mindRouter.put('/icp', async (req, res) => {
  try {
    const { workspaceId, icp_text } = req.body;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const value = typeof icp_text === 'string' ? icp_text.trim() || null : null;
    const { error } = await getSupabaseClient()
      .from('workspaces')
      .update({ icp_text: value })
      .eq('id', workspaceId);
    if (error) throw error;
    return res.json({ icp_text: value });
  } catch (err) {
    console.error('[PUT /api/mind/icp]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/mind/scorecard?workspaceId=… — the current weighted signal list.
mindRouter.get('/scorecard', async (req, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const signals = await listSignals(getSupabaseClient(), workspaceId);
    return res.json({ signals });
  } catch (err) {
    console.error('[GET /api/mind/scorecard]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

const SIGNAL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH /api/mind/scorecard/signals/:id — edit a signal's label / weight /
// active flag. Body: { workspaceId, label?, weight?, active? }. Scoped to the
// workspace so one tenant can't touch another's Scorecard.
mindRouter.patch('/scorecard/signals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { workspaceId, label, weight, active } = req.body;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    if (!SIGNAL_ID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' });

    const updates = {};
    if (typeof label === 'string' && label.trim()) updates.label = label.trim().slice(0, 200);
    if (weight !== undefined && Number.isFinite(Number(weight))) {
      updates.weight = Math.max(-10, Math.min(10, Math.round(Number(weight))));
    }
    if (typeof active === 'boolean') updates.active = active;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'nothing_to_update' });

    const { data, error } = await getSupabaseClient()
      .from('scorecard_signals')
      .update(updates)
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select('id, key, label, weight, coverage, active')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'not_found' });
    return res.json({ signal: data });
  } catch (err) {
    console.error('[PATCH /api/mind/scorecard/signals/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// DELETE /api/mind/scorecard/signals/:id — remove a signal. Body: { workspaceId }.
mindRouter.delete('/scorecard/signals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { workspaceId } = req.body;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    if (!SIGNAL_ID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' });
    const { error } = await getSupabaseClient()
      .from('scorecard_signals')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/mind/scorecard/signals/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/mind/worker-runs?workspaceId=…&limit=50 — surface the
// compound-intelligence loop's run history on the Intelligence page.
//
// Scoped tightly: only the two workers that *are* the loop —
//   mind_outcomes  (outcome resolution, nightly)
//   scorecard_loop (Scorecard learning, nightly)
// Infrastructure workers (crm_sync, pipeline_decay, claim_engine,
// embeddings, lead_replies, score_entities) write to worker_runs too,
// but they belong in a separate "infra" view, not in this one — the
// user wants the loop dashboard to be about the loop, not plumbing.
const LOOP_WORKERS = ['mind_outcomes', 'scorecard_loop'];

mindRouter.get('/worker-runs', async (req, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

    // Scope strictly to this workspace. NULL workspace_id rows are cross-tenant
    // infra runs that have nothing to do with one customer's loop — surfacing
    // them here was leaking other workspaces' activity into a fresh tenant.
    const { data, error } = await getSupabaseClient()
      .from('worker_runs')
      .select('id, workspace_id, worker, status, summary, details, error, duration_ms, started_at, finished_at')
      .in('worker', LOOP_WORKERS)
      .eq('workspace_id', workspaceId)
      .order('finished_at', { ascending: false })
      .limit(limit);

    if (error?.code === '42P01' || error?.code === 'PGRST205') {
      return res.json({ runs: [], migration_pending: true });
    }
    if (error) throw error;
    return res.json({ runs: data || [] });
  } catch (err) {
    console.error('[GET /api/mind/worker-runs]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/mind/scorecard/runs?workspaceId=… — the learning loop's run history.
mindRouter.get('/scorecard/runs', async (req, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const { data, error } = await getSupabaseClient()
      .from('scorecard_runs')
      .select('id, target, steps, gap_before, gap_after, signal_count, note, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    return res.json({ runs: data || [] });
  } catch (err) {
    console.error('[GET /api/mind/scorecard/runs]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/mind/context-changes?workspaceId=… — the workspace's context
// evolution: every GTM fact that was superseded, as from→to pairs, newest
// first. Half of the "what it's learned" timeline (the other half is the
// scoring-model runs above) — this is the workspace sharpening its own profile.
mindRouter.get('/context-changes', async (req, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const supabase = getSupabaseClient();
    const entityId = await getWorkspaceEntityId(supabase, workspaceId);
    if (!entityId) return res.json({ changes: [] });

    const all = await listNotes(supabase, workspaceId, { entityId, includeInactive: true, limit: 300 });
    const byId = new Map(all.map(n => [n.id, n]));
    const changes = all
      .filter(n => !n.is_active && n.superseded_by && byId.has(n.superseded_by))
      .map(n => {
        const next = byId.get(n.superseded_by);
        return { category: next.category, from: n.content, to: next.content, at: next.created_at, source: next.source };
      })
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 20);
    return res.json({ changes });
  } catch (err) {
    console.error('[GET /api/mind/context-changes]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/mind/scorecard/seed — translate the plain-English ICP into a seed
// Scorecard. Body: { workspaceId, force? }. Refuses to clobber an existing
// Scorecard unless force=true.
mindRouter.post('/scorecard/seed', async (req, res) => {
  try {
    const { workspaceId, force } = req.body;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const supabase = getSupabaseClient();

    const existing = await listSignals(supabase, workspaceId);
    if (existing.length > 0 && !force) {
      return res.status(409).json({ error: 'scorecard_exists', signals: existing });
    }

    // The ICP lives in Memory — the ICP / Market / Product / Pricing /
    // Competitors / Positioning notes the user has added. Translate them into
    // the Scorecard.
    const mems = await listNotes(supabase, workspaceId, {
      categories: ['ICP', 'Market', 'Product', 'Pricing', 'Competitors', 'Positioning'],
      limit: 80,
    });
    const icpText = mems.map(m => `[${m.category}] ${m.content}`).join('\n').trim();
    if (!icpText) return res.status(400).json({ error: 'no_icp_memory' });

    const prompt =
      `Translate this Ideal Customer Profile into a Scorecard — a list of ` +
      `weighted signals that score how well a lead fits.\n\n` +
      `ICP: """${icpText}"""\n\n` +
      `Produce 4 to 8 signals. Each is an inclusion criterion, so every weight ` +
      `is positive — the system learns negative signals later from real replies.\n\n` +
      `CRITICAL — stay faithful to the ICP. A signal must be exactly as narrow as ` +
      `what the ICP states, never broader:\n` +
      `- Preserve stated numbers exactly. "1-20 employees" becomes employee_count ` +
      `<= 20 (or a 1-20 range), NOT employee_count < 50. Never loosen a threshold.\n` +
      `- Map qualitative descriptors to the tightest faithful rule. "AI service ` +
      `businesses and agencies" becomes industry in the specific terms given, NOT ` +
      `a vague "operates in the AI space".\n` +
      `- Do not invent criteria the ICP never mentions, and do not generalize a ` +
      `narrow, niche ICP into a broad one. If the ICP is narrow, the signals are narrow.\n\n` +
      `Each signal has:\n` +
      `- key: short snake_case id\n- label: one plain sentence that restates the ` +
      `ICP's own specifics (e.g. "1-20 employees", not "small company")\n` +
      `- weight: integer 1-10, higher = more predictive of fit\n` +
      `- rule: how it fires on a lead's features — ` +
      `{ "feature": <name>, "op": <operator>, "value": <value> }\n\n` +
      `Available features: ${FEATURE_VOCAB}\n` +
      `Operators: ==, !=, >=, <=, >, <, in, exists. For "in", value is an array.\n\n` +
      `Respond with ONLY a JSON array, no prose.`;

    const msg = await anthropic.messages.create({
      feature: 'scorecard-seed-translate',
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = msg.content[0].text.trim();
    const parsed = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] || raw);

    const signals = (Array.isArray(parsed) ? parsed : [])
      .slice(0, 12)
      .map(s => ({
        key: String(s.key || '').trim().slice(0, 60),
        label: String(s.label || '').trim().slice(0, 200),
        weight: Math.max(1, Math.min(10, Math.round(Number(s.weight) || 3))),
        rule: s.rule && typeof s.rule === 'object' ? s.rule : {},
      }))
      .filter(s => s.key && s.label);

    if (signals.length === 0) return res.status(502).json({ error: 'translation_failed' });

    const created = await seedSignals(supabase, workspaceId, signals);
    return res.status(201).json({ signals: created });
  } catch (err) {
    console.error('[POST /api/mind/scorecard/seed]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── The GTM Playbook — guided ICP setup ─────────────────────────────────────
//
// Octave's first-run move: read the customer's own site, draft a strategy back
// to them, then walk segments → buyers → use cases with the answers already
// filled in. The user confirms instead of typing into a blank box. The
// confirmed answers become ICP/Market/Product memory facts, which seed the
// Scorecard — so this feeds the exact same model Phase A renders.

// Fetch a URL's homepage and reduce it to plain readable text. Plain fetch, no
// dependency — good enough for most marketing sites; JS-only sites degrade to
// whatever ships in the initial HTML, and Claude still has the company name.
async function fetchSiteText(website) {
  let url = String(website || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'NousBot/1.0 (+https://opennous.cloud)' },
    });
    if (!res.ok) return '';
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 6000);
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

// POST /api/mind/playbook/research — read the workspace's site, draft the
// strategy doc + pre-filled answers for every step. Body: { workspaceId }.
mindRouter.post('/playbook/research', async (req, res) => {
  try {
    const { workspaceId } = req.body;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const supabase = getSupabaseClient();

    const { data: ws } = await supabase
      .from('workspaces')
      .select('name, website')
      .eq('id', workspaceId)
      .maybeSingle();

    // Hard lifetime cap: each rebuild reads the site + runs an AI draft, so cap
    // it at 3 per workspace. Enforced here so the limit holds across devices and
    // sessions. Queried separately so that if the column hasn't been migrated in
    // yet, the draft above still works — the cap just stays inactive until then.
    const PLAYBOOK_REBUILD_LIMIT = 3;
    const { data: cnt } = await supabase
      .from('workspaces')
      .select('playbook_rebuild_count')
      .eq('id', workspaceId)
      .maybeSingle();
    const rebuildsUsed = cnt?.playbook_rebuild_count ?? 0;
    if (rebuildsUsed >= PLAYBOOK_REBUILD_LIMIT) {
      return res.status(429).json({ error: 'rebuild_limit', limit: PLAYBOOK_REBUILD_LIMIT, used: rebuildsUsed });
    }

    const website = ws?.website || '';
    const company = ws?.name || '';
    const siteText = await fetchSiteText(website);

    const context = [
      company && `Company name: ${company}`,
      website && `Website: ${website}`,
      siteText
        ? `Homepage text:\n"""${siteText}"""`
        : `(Could not read the site — infer from the company name and your knowledge.)`,
    ].filter(Boolean).join('\n\n');

    const prompt =
      `You are setting up a GTM Playbook for this company. Read what you can and ` +
      `infer their go-to-market.\n\n${context}\n\n` +
      `Return ONLY a JSON object, no prose, with this exact shape:\n` +
      `{\n` +
      `  "strategy": {\n` +
      `    "sell": "<1-2 sentences: what they sell and what makes it distinct>",\n` +
      `    "audience": "<1-2 sentences: who they sell to>",\n` +
      `    "problems": "<1-2 sentences: the problems they solve>",\n` +
      `    "pricing": "<1-2 sentences: how they price — model, tiers, or rough range; infer if not stated>",\n` +
      `    "positioning": "<1-2 sentences: how they position against alternatives — the wedge, the why-us>"\n` +
      `  },\n` +
      `  "segments": ["<4-6 specific market segments they target>"],\n` +
      `  "buyers": ["<4-6 specific buyer titles/roles>"],\n` +
      `  "use_cases": ["<4-6 concrete jobs buyers hire this for — the specific task or outcome, e.g. 'consolidate scattered client data before a fundraise', not 'improve efficiency'>"],\n` +
      `  "competitors": ["<real, named companies that sell to the SAME buyer and segment as this company — only ones you are genuinely confident compete here>"]\n` +
      `}\n` +
      `Be specific and concrete (e.g. "Series A-B B2B SaaS, 50-200 employees", ` +
      `"VP RevOps", not "businesses" or "leaders"). Mirror the company's actual ` +
      `scale and category — do not inflate a small or niche company into a broad ` +
      `one. The strategy fields should be rich enough to brief a new rep — a full ` +
      `thought, not a fragment. Each array item is a short phrase.\n` +
      `Use cases: tie each to what this company actually sells, phrased as the ` +
      `job-to-be-done, not a generic benefit.\n` +
      `Competitors: name only real companies that plausibly compete for THIS ` +
      `company's specific buyer, segment, and size. If you are not confident a ` +
      `name genuinely competes, leave it out — 2 accurate competitors (or none) ` +
      `beat 6 that don't fit. Never invent vague "alternatives" to hit a count.\n` +
      `Pricing: if the site is silent, infer a sensible best guess from the ` +
      `category — the user will confirm or correct.`;

    const msg = await anthropic.messages.create({
      feature: 'playbook-research',
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = msg.content[0].text.trim();
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);

    const cleanList = (v) =>
      (Array.isArray(v) ? v : [])
        .map(s => String(s || '').trim())
        .filter(Boolean)
        .slice(0, 6);

    // Count this rebuild only once the draft succeeded — a failed AI call above
    // throws to the catch and never reaches here, so errors don't burn a try.
    await supabase
      .from('workspaces')
      .update({ playbook_rebuild_count: rebuildsUsed + 1 })
      .eq('id', workspaceId);

    return res.json({
      read_site: Boolean(siteText),
      website,
      rebuilds_used: rebuildsUsed + 1,
      rebuilds_limit: PLAYBOOK_REBUILD_LIMIT,
      strategy: {
        sell: String(parsed?.strategy?.sell || '').trim(),
        audience: String(parsed?.strategy?.audience || '').trim(),
        problems: String(parsed?.strategy?.problems || '').trim(),
        pricing: String(parsed?.strategy?.pricing || '').trim(),
        positioning: String(parsed?.strategy?.positioning || '').trim(),
      },
      segments: cleanList(parsed?.segments),
      buyers: cleanList(parsed?.buyers),
      use_cases: cleanList(parsed?.use_cases),
      competitors: cleanList(parsed?.competitors),
    });
  } catch (err) {
    console.error('[POST /api/mind/playbook/research]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// AI-drafted then user-confirmed in the wizard, so confident but not as certain
// as a fact the user typed by hand (which stays at 1.0).
const PLAYBOOK_CONFIDENCE = 0.8;

// POST /api/mind/playbook/confirm — persist the confirmed Playbook as workspace
// memory facts, server-side. Each answer owns a stable `subject` slot, so a
// rebuild EVOLVES the slot's previous fact (supersede + keep as history) rather
// than wiping everything — the GTM context grows over time instead of resetting,
// and manually-added facts are never touched. Body: { workspaceId,
// strategy:{sell,audience,problems,pricing,positioning}, segments[], buyers[],
// use_cases[], competitors[] }.
mindRouter.post('/playbook/confirm', async (req, res) => {
  try {
    const { workspaceId, strategy = {}, segments = [], buyers = [], use_cases = [], competitors = [] } = req.body;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const supabase = getSupabaseClient();
    const entityId = await getWorkspaceEntityId(supabase, workspaceId);

    const list = (v) => (Array.isArray(v) ? v.map(s => String(s || '').trim()).filter(Boolean) : []);
    // Each desired fact carries the subject slot it owns, so rebuilds target the
    // same belief. Use-cases included here so persistence never depends on client
    // state.
    const desired = [
      strategy.sell && { subject: 'playbook.sell', category: 'Product', content: String(strategy.sell).trim() },
      strategy.problems && { subject: 'playbook.problems', category: 'Product', content: `Problems we solve: ${String(strategy.problems).trim()}` },
      strategy.audience && { subject: 'playbook.audience', category: 'ICP', content: String(strategy.audience).trim() },
      strategy.pricing && { subject: 'playbook.pricing', category: 'Pricing', content: String(strategy.pricing).trim() },
      strategy.positioning && { subject: 'playbook.positioning', category: 'Positioning', content: String(strategy.positioning).trim() },
      list(segments).length && { subject: 'playbook.segments', category: 'Market', content: `Target segments: ${list(segments).join('; ')}` },
      list(buyers).length && { subject: 'playbook.buyers', category: 'ICP', content: `Primary buyers: ${list(buyers).join('; ')}` },
      list(use_cases).length && { subject: 'playbook.use_cases', category: 'Product', content: `Primary use cases: ${list(use_cases).join('; ')}` },
      list(competitors).length && { subject: 'playbook.competitors', category: 'Competitors', content: `Competitors / alternatives: ${list(competitors).join('; ')}` },
    ].filter(Boolean);

    // Existing active notes the Playbook owns: subject playbook.* (new) OR legacy
    // source='playbook' facts written before subjects existed. Manual facts have
    // neither, so they're never swept here.
    const existing = entityId ? await listNotes(supabase, workspaceId, { entityId, limit: 200 }) : [];
    const playbookActives = existing.filter(
      n => (typeof n.subject === 'string' && n.subject.startsWith('playbook.')) || n.source === 'playbook',
    );
    const bySubject = new Map();
    for (const n of playbookActives) if (n.subject) bySubject.set(n.subject, n);

    const keptIds = new Set();
    for (const d of desired) {
      const prev = bySubject.get(d.subject);
      const params = {
        entityId, category: d.category, content: d.content,
        source: 'playbook', subject: d.subject, confidence: PLAYBOOK_CONFIDENCE,
      };
      if (!prev) {
        await saveNote(supabase, workspaceId, params);          // brand-new slot
      } else if (prev.content === d.content) {
        keptIds.add(prev.id);                                   // unchanged — leave it
      } else {
        await supersedeNote(supabase, workspaceId, prev.id, params); // evolved — keep history
        keptIds.add(prev.id);
      }
    }

    // Retire playbook-owned facts with no matching answer this round (a cleared
    // slot, or legacy untagged facts now replaced). Soft-delete only — invalid_at
    // preserves them as history.
    for (const n of playbookActives) {
      const stillDesired = n.subject && desired.some(d => d.subject === n.subject);
      if (!stillDesired && !keptIds.has(n.id)) {
        try { await deleteNote(supabase, workspaceId, n.id); } catch { /* best-effort */ }
      }
    }

    return res.status(201).json({ ok: true, saved: desired.length });
  } catch (err) {
    console.error('[POST /api/mind/playbook/confirm]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

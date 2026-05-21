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
import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseClient, listSignals, seedSignals } from '@nous/core';

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

// GET /api/mind/calibration?workspaceId=…
mindRouter.get('/calibration', async (req, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const supabase = getSupabaseClient();

    const [episodesRes, openRes] = await Promise.all([
      supabase
        .from('mind_episodes')
        .select('predicted_score, outcome_score, predicted_at')
        .eq('workspace_id', workspaceId)
        .eq('kind', 'icp_score')
        .not('outcome_resolved_at', 'is', null)
        .not('outcome_score', 'is', null)
        .not('predicted_score', 'is', null)
        .order('predicted_at', { ascending: true })
        .limit(5000),
      supabase
        .from('mind_episodes')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('kind', 'icp_score')
        .is('outcome_resolved_at', null),
    ]);
    if (episodesRes.error) throw episodesRes.error;

    const rows = episodesRes.data || [];
    const high = rows.filter((r) => r.predicted_score >= 70).map((r) => r.outcome_score);
    const low = rows.filter((r) => r.predicted_score < 70).map((r) => r.outcome_score);
    const avgHigh = avg(high);
    const avgLow = avg(low);
    const gap = avgHigh != null && avgLow != null ? round3(avgHigh - avgLow) : null;

    // Weekly trend — gap per week, computed only where both cohorts are present.
    const byWeek = new Map();
    for (const r of rows) {
      const k = weekKey(r.predicted_at);
      if (!byWeek.has(k)) byWeek.set(k, { high: [], low: [] });
      const bucket = byWeek.get(k);
      (r.predicted_score >= 70 ? bucket.high : bucket.low).push(r.outcome_score);
    }
    const trend = [...byWeek.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week, c]) => {
        const h = avg(c.high);
        const l = avg(c.low);
        return {
          week,
          n: c.high.length + c.low.length,
          gap: h != null && l != null ? round3(h - l) : null,
        };
      });

    return res.json({
      resolved: rows.length,
      open: openRes.count ?? 0,
      high: { count: high.length, avgOutcome: avgHigh != null ? round3(avgHigh) : null },
      low: { count: low.length, avgOutcome: avgLow != null ? round3(avgLow) : null },
      gap,
      trend,
    });
  } catch (err) {
    console.error('[GET /api/mind/calibration]', err);
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
    // Competitors facts the user has added. Translate them into the Scorecard.
    const { data: mems } = await supabase
      .from('workspace_memories')
      .select('category, content')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .in('category', ['ICP', 'Market', 'Product', 'Pricing', 'Competitors'])
      .order('created_at', { ascending: false })
      .limit(80);
    const icpText = (mems || []).map(m => `[${m.category}] ${m.content}`).join('\n').trim();
    if (!icpText) return res.status(400).json({ error: 'no_icp_memory' });

    const prompt =
      `Translate this Ideal Customer Profile into a Scorecard — a list of ` +
      `weighted signals that score how well a lead fits.\n\n` +
      `ICP: """${icpText}"""\n\n` +
      `Produce 4 to 8 signals. Each is an inclusion criterion, so every weight ` +
      `is positive — the system learns negative signals later from real replies.\n\n` +
      `Each signal has:\n` +
      `- key: short snake_case id\n- label: one plain sentence\n` +
      `- weight: integer 1-10, higher = more predictive of fit\n` +
      `- rule: how it fires on a lead's features — ` +
      `{ "feature": <name>, "op": <operator>, "value": <value> }\n\n` +
      `Available features: ${FEATURE_VOCAB}\n` +
      `Operators: ==, !=, >=, <=, >, <, in, exists. For "in", value is an array.\n\n` +
      `Respond with ONLY a JSON array, no prose.`;

    const msg = await anthropic.messages.create({
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

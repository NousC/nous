import Anthropic from 'useleak';
import { listSignals, seedSignals, listNotes } from '@nous/core';

// Shared scorecard-seed logic — the ICP scoring model is built by translating
// the workspace's GTM memory (ICP / Market / Product / Pricing / Competitors /
// Positioning notes) into a weighted signal list. Used by both the human web
// route (POST /api/mind/scorecard/seed) and the agent route
// (POST /v2/workspace/scoring-model), so the two never drift.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const FEATURE_VOCAB =
  'job_title (string), seniority (one of: c_suite, vp, director, manager, ic), ' +
  'department (string), industry (string), employee_count (number), ' +
  'company_type (one of: software, agency, services, marketplace, ecommerce, media, hardware), ' +
  'size_band (one of: 1-10, 11-50, 51-200, 201-1000, 1000+), ' +
  'funding_stage (one of: bootstrapped, seed, series_a, series_b, series_c_plus, public), ' +
  'country (string), company (string). ' +
  // Website-derived signals (from the signal extractor) — niche, differentiated:
  'signal.target_market (b2b|b2c|b2b2c|developer|enterprise|smb), ' +
  'signal.pricing_model (usage_based|seat_based|flat|freemium|enterprise_contact), ' +
  'signal.has_api / signal.has_sandbox / signal.self_serve_signup / signal.free_trial / signal.recently_funded (boolean), ' +
  'signal.tech.<tool> (boolean, e.g. signal.tech.stripe), ' +
  'signal.hiring.<role> (boolean, e.g. signal.hiring.revops), ' +
  'signal.compliance.<term> (boolean, e.g. signal.compliance.soc2). ' +
  // Pipeline-engagement (how the deal went), bucketed from the activity log:
  'pipe.lead_source (e.g. inbound_website, outbound_email, inbound_linkedin), ' +
  'pipe.channel (email|linkedin|meeting|website|slack|other), ' +
  'pipe.inbound (boolean), pipe.replied (boolean), ' +
  'pipe.meetings_band (0|1|2|3+), pipe.touches_band (1-2|3-5|6-10|10+)';

/**
 * Build (or rebuild) the ICP scoring model from the workspace's GTM memory.
 *
 * Returns a tagged result so callers map it to their own response shape:
 *   { status: 'exists',            signals }  — a model already exists and force was not set
 *   { status: 'no_icp_memory',     signals: [] } — no GTM context recorded yet
 *   { status: 'translation_failed',signals: [] } — the model came back empty
 *   { status: 'created',           signals }  — built and saved
 * Throws only on unexpected failures.
 */
export async function seedScorecardFromMemory(supabase, workspaceId, { force = false } = {}) {
  const existing = await listSignals(supabase, workspaceId);
  if (existing.length > 0 && !force) {
    return { status: 'exists', signals: existing };
  }

  const mems = await listNotes(supabase, workspaceId, {
    categories: ['ICP', 'Market', 'Product', 'Pricing', 'Competitors', 'Positioning'],
    limit: 80,
  });
  const icpText = mems.map(m => `[${m.category}] ${m.content}`).join('\n').trim();
  if (!icpText) return { status: 'no_icp_memory', signals: [] };

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
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });
  // Defensive parse: strip any markdown fence, pull the JSON array, and never let
  // a malformed/truncated LLM response throw — degrade to translation_failed so
  // the route returns a clean 502 instead of a 500.
  const raw = msg.content[0].text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try {
    parsed = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] || raw);
  } catch (e) {
    console.error('[scorecardSeed] non-JSON scorecard response (stop_reason:', msg.stop_reason + '):', e.message);
    return { status: 'translation_failed', signals: [] };
  }

  const signals = (Array.isArray(parsed) ? parsed : [])
    .slice(0, 12)
    .map(s => ({
      key: String(s.key || '').trim().slice(0, 60),
      label: String(s.label || '').trim().slice(0, 200),
      weight: Math.max(1, Math.min(10, Math.round(Number(s.weight) || 3))),
      rule: s.rule && typeof s.rule === 'object' ? s.rule : {},
    }))
    .filter(s => s.key && s.label);

  if (signals.length === 0) return { status: 'translation_failed', signals: [] };

  const created = await seedSignals(supabase, workspaceId, signals);
  return { status: 'created', signals: created };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { isUUID } from '../utils/identity.js';
import type { ScorecardSignal, ScorecardSignalRule } from '../types.js';

// DB layer + scorer for the Scorecard — the weighted signal list that turns a
// lead into a 0–100 number. See docs/adaptive-lead-scoring.md.

const SIGNAL_COLUMNS =
  'id, workspace_id, key, label, weight, rule, coverage, added_in, active, created_at, updated_at';

// ── The scorer ────────────────────────────────────────────────────────────────

// Evaluate one signal rule against a lead's feature snapshot.
function ruleFires(rule: ScorecardSignalRule | null | undefined, features: Record<string, unknown>): boolean {
  if (!rule || !rule.feature) return false;
  const v = features[rule.feature];
  switch (rule.op) {
    case 'exists': return v !== undefined && v !== null;
    case '==':     return v === rule.value;
    case '!=':     return v !== rule.value;
    case '>=':     return typeof v === 'number' && v >= (rule.value as number);
    case '<=':     return typeof v === 'number' && v <= (rule.value as number);
    case '>':      return typeof v === 'number' && v > (rule.value as number);
    case '<':      return typeof v === 'number' && v < (rule.value as number);
    case 'in':     return Array.isArray(rule.value) && rule.value.includes(v);
    default:       return false;
  }
}

export interface ScoreResult {
  score: number;                                  // 0–100
  raw: number;                                    // summed weights, pre-rescale
  fired: { key: string; weight: number }[];       // the signals that fired
}

// Deterministic score: sum the weights of every active signal whose rule fires
// on the lead's features, then rescale the catalog's [minRaw, maxRaw] span onto
// 0–100. Pure — no DB, no model call.
export function scoreLead(
  features: Record<string, unknown> | null | undefined,
  signals: ScorecardSignal[],
): ScoreResult {
  const f = features || {};
  const active = signals.filter(s => s.active);

  let raw = 0;
  const fired: { key: string; weight: number }[] = [];
  for (const s of active) {
    if (ruleFires(s.rule, f)) {
      raw += s.weight;
      fired.push({ key: s.key, weight: s.weight });
    }
  }

  // Rescale against the catalog's own bounds so the score reads consistently
  // regardless of how many signals exist.
  let maxPos = 0;
  let maxNeg = 0;
  for (const s of active) {
    if (s.weight > 0) maxPos += s.weight;
    else maxNeg += s.weight;
  }
  const span = maxPos - maxNeg;
  const score = span > 0 ? Math.round(((raw - maxNeg) / span) * 100) : 50;

  return { score: Math.max(0, Math.min(100, score)), raw, fired };
}

// ── Signal queries ────────────────────────────────────────────────────────────

export async function listSignals(
  supabase: SupabaseClient,
  workspaceId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<ScorecardSignal[]> {
  let query = supabase
    .from('scorecard_signals')
    .select(SIGNAL_COLUMNS)
    .eq('workspace_id', workspaceId)
    .order('weight', { ascending: false });
  if (opts.activeOnly) query = query.eq('active', true);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as unknown as ScorecardSignal[];
}

export interface SeedSignalInput {
  key: string;
  label: string;
  weight: number;
  rule: ScorecardSignalRule;
}

// Replace the whole Scorecard with a freshly translated seed set. Used at
// cold-start; clobbers any existing signals, so the caller must gate this.
export async function seedSignals(
  supabase: SupabaseClient,
  workspaceId: string,
  signals: SeedSignalInput[],
): Promise<ScorecardSignal[]> {
  await supabase.from('scorecard_signals').delete().eq('workspace_id', workspaceId);
  if (signals.length === 0) return [];

  const payload = signals.map(s => ({
    workspace_id: workspaceId,
    key: s.key,
    label: s.label,
    weight: Math.round(s.weight),
    rule: s.rule ?? {},
    added_in: null,
  }));
  const { data, error } = await supabase
    .from('scorecard_signals')
    .insert(payload)
    .select(SIGNAL_COLUMNS);
  if (error) throw error;
  return (data || []) as unknown as ScorecardSignal[];
}

// Add or recalibrate one signal (used by the learning loop, Phase 4c).
export async function upsertSignal(
  supabase: SupabaseClient,
  workspaceId: string,
  signal: SeedSignalInput & { coverage?: number; added_in?: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('scorecard_signals')
    .upsert(
      {
        workspace_id: workspaceId,
        key: signal.key,
        label: signal.label,
        weight: Math.round(signal.weight),
        rule: signal.rule ?? {},
        coverage: signal.coverage ?? 0,
        added_in: signal.added_in ?? null,
        active: true,
      },
      { onConflict: 'workspace_id,key' },
    );
  if (error) throw error;
}

// Activate / deactivate a signal (the loop prunes by deactivating).
export async function setSignalActive(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  active: boolean,
): Promise<void> {
  if (!isUUID(id)) return;
  const { error } = await supabase
    .from('scorecard_signals')
    .update({ active })
    .eq('id', id)
    .eq('workspace_id', workspaceId);
  if (error) throw error;
}

// ── Run log ───────────────────────────────────────────────────────────────────

export interface ScorecardRunInput {
  target?: number | null;
  steps?: number;
  gap_before?: number | null;
  gap_after?: number | null;
  signal_count?: number | null;
  note?: string | null;
}

export async function logScorecardRun(
  supabase: SupabaseClient,
  workspaceId: string,
  run: ScorecardRunInput,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('scorecard_runs')
    .insert({ workspace_id: workspaceId, ...run })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

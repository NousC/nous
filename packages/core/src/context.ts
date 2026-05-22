import type { SupabaseClient } from '@supabase/supabase-js';
import { getClaims } from './db/claims.js';
import { getObservations, type Observation } from './db/observations.js';

// The Context API's assembly layer. assembleContext() runs the pipeline —
// retrieve → rank → connect → compress → tag → budget — and returns an
// intent-shaped, epistemics-tagged context block for one entity.
// See docs/context-api-spec.md.

export type ContextIntent =
  | 'draft_email' | 'follow_up' | 'meeting_prep' | 'call_prep' | 'account_review';

interface Recipe {
  themes: string[];                          // property substrings to rank up; [] = no preference
  timelineWindowDays: number;
  stakeholders: 'none' | 'direct' | 'buying_group';
  includePredictions: boolean;
  budgetTokens: number;
}

// Intent recipes — declarative. A new intent is a new entry, not new pipeline code.
const RECIPES: Record<ContextIntent, Recipe> = {
  draft_email: {
    themes: ['industry', 'employee_count', 'seniority', 'department', 'job_title', 'tech_stack', 'icp'],
    timelineWindowDays: 90, stakeholders: 'direct', includePredictions: true, budgetTokens: 1200,
  },
  follow_up: {
    themes: ['deal', 'note', 'objection', 'commitment', 'timing', 'budget', 'job_title'],
    timelineWindowDays: 30, stakeholders: 'buying_group', includePredictions: true, budgetTokens: 1500,
  },
  meeting_prep: {
    themes: ['deal', 'note', 'job_title', 'seniority', 'timing'],
    timelineWindowDays: 60, stakeholders: 'buying_group', includePredictions: true, budgetTokens: 1800,
  },
  call_prep: {
    themes: ['deal', 'note', 'job_title', 'seniority', 'timing'],
    timelineWindowDays: 60, stakeholders: 'buying_group', includePredictions: true, budgetTokens: 1800,
  },
  account_review: {
    themes: [], timelineWindowDays: 90, stakeholders: 'buying_group', includePredictions: true, budgetTokens: 2000,
  },
};

export const CONTEXT_INTENTS = Object.keys(RECIPES) as ContextIntent[];

const DAY = 86_400_000;

export interface ContextClaim {
  property: string; value: unknown; confidence: number;
  freshness: string; epistemic_class: string; last_observed_at: string | null;
}
export interface TimelineItem {
  when: string; type: string; tier: 'full' | 'brief' | 'count';
  summary?: string | null; count?: number;
}
export interface Stakeholder { entity_id: string; name: string | null; role: string | null; }

export interface AssembledContext {
  entity: { id: string; type: string };
  intent: ContextIntent;
  summary: string;
  claims: ContextClaim[];
  timeline: TimelineItem[];
  stakeholders: Stakeholder[];
  predictions: { kind: string; value: unknown; confidence: number }[];
  meta: { token_estimate: number; claims_total: number; claims_returned: number; timeline_events: number };
}

// ── pipeline ─────────────────────────────────────────────────────────────────

export async function assembleContext(
  supabase: SupabaseClient,
  workspaceId: string,
  entityId: string,
  intent: ContextIntent = 'account_review',
  budgetTokens?: number,
): Promise<AssembledContext | null> {
  const recipe = RECIPES[intent] ?? RECIPES.account_review;
  const budget = budgetTokens ?? recipe.budgetTokens;

  const { data: entity } = await supabase
    .from('entities').select('id, type')
    .eq('id', entityId).eq('workspace_id', workspaceId).maybeSingle();
  if (!entity) return null;

  const [claims, observations] = await Promise.all([
    getClaims(supabase, workspaceId, entityId),
    getObservations(supabase, workspaceId, entityId, { kind: 'event', limit: 300 }),
  ]);

  // rank claims: on-theme first, then confidence, then recency — then budget-cap
  const ranked = [...claims].sort((a, b) => {
    const t = themeRank(a.property, recipe.themes) - themeRank(b.property, recipe.themes);
    if (t !== 0) return t;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return +new Date(b.last_observed_at ?? 0) - +new Date(a.last_observed_at ?? 0);
  });
  const maxClaims = Math.max(6, Math.floor((budget * 0.5) / 25));   // ~25 tokens/claim
  const claimsOut: ContextClaim[] = ranked.slice(0, maxClaims).map(c => ({
    property: c.property, value: c.value, confidence: c.confidence,
    freshness: c.freshness, epistemic_class: c.epistemic_class,
    last_observed_at: c.last_observed_at,
  }));

  // timeline: window + temporal tiering
  const cutoff = Date.now() - recipe.timelineWindowDays * DAY;
  const events = observations.filter(o => +new Date(o.observed_at) >= cutoff);
  const timeline = compressTimeline(events);

  // connect: stakeholders via the relationship graph
  const stakeholders = recipe.stakeholders === 'none'
    ? []
    : await loadStakeholders(supabase, workspaceId, entityId, recipe.stakeholders);

  // predictions (open only)
  let predictions: AssembledContext['predictions'] = [];
  if (recipe.includePredictions) {
    const { data } = await supabase
      .from('predictions')
      .select('kind, predicted_value, predicted_confidence')
      .eq('workspace_id', workspaceId).eq('entity_id', entityId)
      .is('resolved_at', null)
      .order('predicted_at', { ascending: false }).limit(5);
    predictions = (data ?? []).map(p => ({
      kind: p.kind, value: p.predicted_value, confidence: p.predicted_confidence,
    }));
  }

  const result: AssembledContext = {
    entity: { id: entity.id, type: entity.type },
    intent,
    summary: buildSummary(entity.type, claimsOut, events.length, intent),
    claims: claimsOut, timeline, stakeholders, predictions,
    meta: {
      token_estimate: 0,
      claims_total: claims.length, claims_returned: claimsOut.length,
      timeline_events: events.length,
    },
  };
  result.meta.token_estimate = Math.ceil(JSON.stringify(result).length / 4);
  return result;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function themeRank(property: string, themes: string[]): number {
  if (themes.length === 0) return 0;
  return themes.some(t => property.includes(t)) ? 0 : 1;   // 0 = on-theme, sorts first
}

function compressTimeline(events: Observation[]): TimelineItem[] {
  const now = Date.now();
  const items: TimelineItem[] = [];
  const olderCounts: Record<string, number> = {};
  for (const o of events) {
    const age = now - +new Date(o.observed_at);
    const type = (o.property || '').replace(/^interaction\./, '');
    if (age < 7 * DAY) {
      const v = o.value as { description?: string; summary?: string } | null;
      items.push({ when: o.observed_at, type, tier: 'full', summary: v?.description || v?.summary || null });
    } else if (age < 30 * DAY) {
      items.push({ when: o.observed_at, type, tier: 'brief' });
    } else {
      olderCounts[type] = (olderCounts[type] || 0) + 1;
    }
  }
  for (const [type, count] of Object.entries(olderCounts)) {
    items.push({ when: '', type, tier: 'count', count });
  }
  return items;
}

async function loadStakeholders(
  supabase: SupabaseClient,
  workspaceId: string,
  entityId: string,
  depth: 'direct' | 'buying_group',
): Promise<Stakeholder[]> {
  // the company this entity works at
  const { data: outRels } = await supabase
    .from('relationships')
    .select('to_entity_id')
    .eq('workspace_id', workspaceId)
    .eq('from_entity_id', entityId)
    .eq('type', 'works_at')
    .is('valid_to', null);
  const companyId = (outRels ?? [])[0]?.to_entity_id as string | undefined;
  if (!companyId) return [];

  let colleagueIds: string[] = [];
  if (depth === 'buying_group') {
    const { data: inRels } = await supabase
      .from('relationships')
      .select('from_entity_id')
      .eq('workspace_id', workspaceId)
      .eq('to_entity_id', companyId)
      .eq('type', 'works_at')
      .is('valid_to', null)
      .limit(12);
    colleagueIds = (inRels ?? []).map(r => r.from_entity_id as string).filter(id => id !== entityId);
  }

  const ids = [companyId, ...colleagueIds];
  const { data: claimRows } = await supabase
    .from('claims')
    .select('entity_id, property, value')
    .eq('workspace_id', workspaceId)
    .in('entity_id', ids)
    .in('property', ['name', 'first_name', 'last_name', 'job_title']);

  const byEntity = new Map<string, Record<string, unknown>>();
  for (const c of claimRows ?? []) {
    const m = byEntity.get(c.entity_id) ?? {};
    m[c.property] = c.value;
    byEntity.set(c.entity_id, m);
  }
  const nameOf = (id: string): string | null => {
    const m = byEntity.get(id) ?? {};
    if (m.name) return String(m.name);
    const fn = [m.first_name, m.last_name].filter(Boolean).join(' ');
    return fn || null;
  };

  const stakeholders: Stakeholder[] = [
    { entity_id: companyId, name: nameOf(companyId), role: 'company' },
  ];
  for (const id of colleagueIds) {
    const role = byEntity.get(id)?.job_title;
    stakeholders.push({ entity_id: id, name: nameOf(id), role: (role as string) ?? 'contact' });
  }
  return stakeholders;
}

function buildSummary(
  type: string, claims: ContextClaim[], eventCount: number, intent: ContextIntent,
): string {
  const title = claims.find(c => c.property === 'job_title')?.value;
  const head = [type, title ? String(title) : null].filter(Boolean).join(' · ');
  return `${head} — ${claims.length} known facts, ${eventCount} recent touchpoints. ` +
         `Context assembled for intent: ${intent}.`;
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { searchObservations } from './db/search.js';

// runQuery() — the Shape-B endpoint's engine. Retrieves a corpus of
// observations matching a structured scope, compresses each to a compact
// item, returns it with rollups. The agent does the pattern-finding.
//
// Two modes:
//   structured — scope filters only (last 10 meetings, 25 LinkedIn chats, …)
//   semantic   — when a `question` is given, ranks the scoped corpus by
//                semantic similarity to that question (needs embeddings).

export interface QueryScope {
  kind?: 'event' | 'state';
  property?: string;        // prefix match — e.g. 'interaction.linkedin'
  source?: string;          // exact — e.g. 'gmail'
  entity_id?: string;       // scope to one entity
  since_days?: number;      // observed within the last N days
  limit?: number;           // max items returned (default 50, hard cap 200)
}

export interface QueryItem {
  observation_id: string;
  entity_id: string;
  entity_name: string | null;
  when: string;
  type: string;
  source: string;
  summary: string | null;
  similarity?: number;      // present in semantic mode
}

export interface QueryResult {
  scope: QueryScope;
  mode: 'structured' | 'semantic';
  matched: number;
  returned: number;
  sampled: boolean;
  items: QueryItem[];
  rollups: { by_type: Record<string, number>; by_source: Record<string, number> };
  meta: { token_estimate: number };
}

const DAY = 86_400_000;

export async function runQuery(
  supabase: SupabaseClient,
  workspaceId: string,
  scope: QueryScope = {},
  question?: string,
): Promise<QueryResult> {
  const limit = Math.min(Math.max(scope.limit ?? 50, 1), 200);
  const sinceISO = scope.since_days
    ? new Date(Date.now() - scope.since_days * DAY).toISOString()
    : undefined;

  let rows: any[];
  let matched: number;
  let mode: 'structured' | 'semantic';

  // Semantic path — only when a question is given and embeddings resolve.
  let semantic: any[] | null = null;
  if (question && question.trim()) {
    semantic = await searchObservations(supabase, workspaceId, question, {
      kind: scope.kind, property: scope.property, source: scope.source, since: sinceISO,
    }, limit);
    if (scope.entity_id) semantic = semantic.filter(o => o.entity_id === scope.entity_id);
  }

  if (semantic && semantic.length) {
    rows = semantic;
    matched = semantic.length;
    mode = 'semantic';
  } else {
    let q = supabase
      .from('observations')
      .select('id, entity_id, kind, property, value, source, observed_at', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('observed_at', { ascending: false })
      .limit(limit);
    if (scope.kind)      q = q.eq('kind', scope.kind);
    if (scope.source)    q = q.eq('source', scope.source);
    if (scope.entity_id) q = q.eq('entity_id', scope.entity_id);
    if (scope.property)  q = q.ilike('property', `${scope.property}%`);
    if (sinceISO)        q = q.gte('observed_at', sinceISO);

    const { data, count, error } = await q;
    if (error) throw new Error(`query failed: ${error.message}`);
    rows = data ?? [];
    matched = count ?? rows.length;
    mode = 'structured';
  }

  // entity names — one batched claims query
  const entityIds = [...new Set(rows.map(o => o.entity_id))];
  const nameByEntity = new Map<string, string>();
  if (entityIds.length) {
    const { data: nameClaims } = await supabase
      .from('claims')
      .select('entity_id, property, value')
      .eq('workspace_id', workspaceId)
      .in('entity_id', entityIds)
      .in('property', ['name', 'first_name', 'last_name']);
    const parts = new Map<string, Record<string, unknown>>();
    for (const c of (nameClaims as any[]) ?? []) {
      const m = parts.get(c.entity_id) ?? {};
      m[c.property] = c.value;
      parts.set(c.entity_id, m);
    }
    for (const [id, m] of parts) {
      const name = m.name
        ? String(m.name)
        : [m.first_name, m.last_name].filter(Boolean).join(' ') || null;
      if (name) nameByEntity.set(id, name);
    }
  }

  const items: QueryItem[] = rows.map(o => {
    const v = o.value as { description?: string; summary?: string } | null;
    const item: QueryItem = {
      observation_id: o.id,
      entity_id: o.entity_id,
      entity_name: nameByEntity.get(o.entity_id) ?? null,
      when: o.observed_at,
      type: (o.property || '').replace(/^interaction\./, ''),
      source: o.source,
      summary: v?.summary || v?.description || null,
    };
    if (o.similarity != null) item.similarity = o.similarity;
    return item;
  });

  const byType: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const it of items) {
    byType[it.type] = (byType[it.type] ?? 0) + 1;
    bySource[it.source] = (bySource[it.source] ?? 0) + 1;
  }

  const result: QueryResult = {
    scope, mode, matched,
    returned: items.length,
    sampled: matched > items.length,
    items,
    rollups: { by_type: byType, by_source: bySource },
    meta: { token_estimate: 0 },
  };
  result.meta.token_estimate = Math.ceil(JSON.stringify(result).length / 4);
  return result;
}

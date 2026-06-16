import type { SupabaseClient } from '@supabase/supabase-js';
import { searchObservations } from './db/search.js';

// runQuery() — the corpus-query engine behind POST /v2/query.
//
// Three return shapes the agent can ask for:
//   return: 'observations' (default) — one row per observation. The classic
//     "last 10 meetings" / "last 25 LinkedIn chats" use case.
//   return: 'entities' — group by entity, one row per entity with its
//     most-recent matching observation. Use for "hottest leads",
//     "who replied this week", "who's in evaluating stage".
//
// Plus two power tools, composable with both return shapes:
//   without: <QueryScope> — entities matching `scope` MINUS entities matching
//     `without`. Use for "didn't reply in last 5 days" (sent without reply),
//     "cooled in last 5 days" (had activity in 30d, none in 5d).
//   rollups.by_value — for state observations, count entities by current
//     value. Use for funnel reports (count by `stage`).

export interface QueryScope {
  kind?: 'event' | 'state';
  property?: string;        // prefix match — e.g. 'interaction.linkedin'
  source?: string;          // exact — e.g. 'gmail'
  entity_id?: string;       // scope to one entity
  since_days?: number;      // observed within the last N days (lower bound vs now)
  from?: string;            // ISO — observed_at >= from (absolute lower bound)
  to?: string;              // ISO — observed_at <= to   (absolute upper bound)
  order?: 'asc' | 'desc';   // observed_at sort (default desc). 'asc' for schedules — soonest first.
  limit?: number;           // max items returned (default 50, hard cap 200)
}

export interface QueryOptions {
  return?: 'observations' | 'entities';
  without?: QueryScope;
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
  // Outbound attribution from the observation's raw — which email earned this
  // event (campaign / step / variant / subject). Present on email events;
  // absent in semantic mode. Lets the agent group replies by the email sent.
  attribution?: Record<string, unknown> | null;
}

export interface EntityItem {
  entity_id: string;
  entity_name: string | null;
  matches: number;                          // observations matching scope for this entity
  most_recent_at: string;
  most_recent_type: string;
  most_recent_source: string;
  most_recent_summary: string | null;
  most_recent_value?: unknown;              // present for state observations
  most_recent_attribution?: Record<string, unknown> | null;  // campaign/variant of the latest match
  firmographics?: Record<string, unknown> | null;            // industry/company_size/title for grouping
}

export interface QueryResult {
  scope: QueryScope;
  without?: QueryScope;
  mode: 'structured' | 'semantic';
  return: 'observations' | 'entities';
  matched: number;
  returned: number;
  sampled: boolean;
  items: QueryItem[] | EntityItem[];
  rollups: {
    by_type:   Record<string, number>;
    by_source: Record<string, number>;
    by_value?: Record<string, number>;      // populated when scope.kind = 'state'
  };
  meta: { token_estimate: number };
}

const DAY = 86_400_000;
const ENTITY_FETCH_CAP = 1_000;             // when computing return='entities' or without-set

// Claim properties fetched alongside names so the agent can group results by
// firmographics (e.g. "reply rate by industry") without a call per entity.
const NAME_PROPS = ['name', 'first_name', 'last_name'];
const FIRMO_PROPS = ['job_title', 'seniority', 'department', 'industry', 'employee_count', 'company'];

// The outbound attribution the webhook handlers stash on observation.raw.
const ATTRIB_KEYS = ['campaign_id', 'campaign_name', 'step', 'variant', 'subject'];

function pickAttribution(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ATTRIB_KEYS) {
    if (r[k] != null && r[k] !== '') out[k] = r[k];
  }
  if (r.is_outbound != null) out.is_outbound = r.is_outbound;
  return Object.keys(out).length ? out : null;
}

// Internal: pull observations matching a scope. Used both for the primary
// scope and (without LIMIT) for the without-scope's entity-id set.
async function fetchScopeObservations(
  supabase: SupabaseClient,
  workspaceId: string,
  scope: QueryScope,
  hardLimit: number,
): Promise<any[]> {
  const sinceISO = scope.since_days
    ? new Date(Date.now() - scope.since_days * DAY).toISOString()
    : undefined;

  let q = supabase
    .from('observations')
    .select('id, entity_id, kind, property, value, source, observed_at, raw')
    .eq('workspace_id', workspaceId)
    // Default newest-first; 'asc' surfaces the soonest upcoming row first, which
    // is what a schedule ("what's booked today") wants — events can be future-dated.
    .order('observed_at', { ascending: scope.order === 'asc' })
    .limit(hardLimit);
  if (scope.kind)      q = q.eq('kind', scope.kind);
  if (scope.source)    q = q.eq('source', scope.source);
  if (scope.entity_id) q = q.eq('entity_id', scope.entity_id);
  if (scope.property)  q = q.ilike('property', `${scope.property}%`);
  if (sinceISO)        q = q.gte('observed_at', sinceISO);
  // Absolute window — needed for forward ranges (scheduled meetings live in the
  // future, so since_days can't reach them). from/to bound observed_at directly.
  if (scope.from)      q = q.gte('observed_at', scope.from);
  if (scope.to)        q = q.lte('observed_at', scope.to);

  const { data, error } = await q;
  if (error) throw new Error(`query failed: ${error.message}`);
  return data ?? [];
}

export async function runQuery(
  supabase: SupabaseClient,
  workspaceId: string,
  scope: QueryScope = {},
  question?: string,
  options: QueryOptions = {},
): Promise<QueryResult> {
  const returnMode = options.return ?? 'observations';
  const limit = Math.min(Math.max(scope.limit ?? 50, 1), 200);

  // ── 1. Pull the scope corpus ─────────────────────────────────────────────
  // For entity mode + without-set we need MORE than `limit` rows up front,
  // because we group by entity afterward and the final entity count is
  // capped at `limit`. Cap at ENTITY_FETCH_CAP to stay bounded.
  const needsBroaderPull = returnMode === 'entities' || !!options.without;
  const broadLimit = needsBroaderPull ? ENTITY_FETCH_CAP : limit;

  let rows: any[];
  let matched: number;
  let mode: 'structured' | 'semantic';

  let semantic: any[] | null = null;
  if (question && question.trim() && !options.without) {
    // Semantic mode is incompatible with `without` (the embedding ranker
    // doesn't know about the exclude set). Fall through to structured if
    // the caller asked for both.
    semantic = await searchObservations(supabase, workspaceId, question, {
      kind: scope.kind, property: scope.property, source: scope.source,
      since: scope.since_days ? new Date(Date.now() - scope.since_days * DAY).toISOString() : undefined,
    }, broadLimit);
    if (scope.entity_id) semantic = semantic.filter(o => o.entity_id === scope.entity_id);
  }

  if (semantic && semantic.length) {
    rows = semantic;
    matched = semantic.length;
    mode = 'semantic';
  } else {
    rows = await fetchScopeObservations(supabase, workspaceId, scope, broadLimit);
    matched = rows.length;
    mode = 'structured';
  }

  // ── 2. Apply `without` (set difference on entity_id) ─────────────────────
  if (options.without) {
    const excludeRows = await fetchScopeObservations(supabase, workspaceId, options.without, ENTITY_FETCH_CAP);
    const excludeSet = new Set(excludeRows.map(r => r.entity_id));
    if (excludeSet.size) rows = rows.filter(r => !excludeSet.has(r.entity_id));
    matched = rows.length;
  }

  // ── 3. Resolve entity names + firmographics (one batched claims query) ────
  const entityIds = [...new Set(rows.map(o => o.entity_id))];
  const nameByEntity = new Map<string, string>();
  const firmoByEntity = new Map<string, Record<string, unknown>>();
  if (entityIds.length) {
    const { data: claimRows } = await supabase
      .from('claims')
      .select('entity_id, property, value')
      .eq('workspace_id', workspaceId)
      .in('entity_id', entityIds)
      .in('property', [...NAME_PROPS, ...FIRMO_PROPS]);
    const parts = new Map<string, Record<string, unknown>>();
    for (const c of (claimRows as any[]) ?? []) {
      if (NAME_PROPS.includes(c.property)) {
        const m = parts.get(c.entity_id) ?? {};
        m[c.property] = c.value;
        parts.set(c.entity_id, m);
      } else {
        const f = firmoByEntity.get(c.entity_id) ?? {};
        if (c.value != null && c.value !== '') f[c.property] = c.value;
        firmoByEntity.set(c.entity_id, f);
      }
    }
    for (const [id, m] of parts) {
      const name = m.name
        ? String(m.name)
        : [m.first_name, m.last_name].filter(Boolean).join(' ') || null;
      if (name) nameByEntity.set(id, name);
    }
  }

  // ── 4. Build items in the requested shape ────────────────────────────────
  let items: QueryItem[] | EntityItem[];
  if (returnMode === 'entities') {
    // Group by entity, take the most recent matching observation as the
    // representative row, count the rest.
    const byEntity = new Map<string, { count: number; latest: any }>();
    for (const r of rows) {
      const existing = byEntity.get(r.entity_id);
      if (!existing) {
        byEntity.set(r.entity_id, { count: 1, latest: r });
      } else {
        existing.count++;
        if (new Date(r.observed_at) > new Date(existing.latest.observed_at)) {
          existing.latest = r;
        }
      }
    }
    const entities: EntityItem[] = [];
    for (const [eid, { count, latest }] of byEntity) {
      const v = latest.value as { description?: string; summary?: string } | null;
      const item: EntityItem = {
        entity_id: eid,
        entity_name: nameByEntity.get(eid) ?? null,
        matches: count,
        most_recent_at: latest.observed_at,
        most_recent_type: (latest.property || '').replace(/^interaction\./, ''),
        most_recent_source: latest.source,
        most_recent_summary: v?.summary || v?.description || null,
      };
      // For state observations, surface the value so funnel-style consumers
      // can see "stage = evaluating" without a second call.
      if (latest.kind === 'state') item.most_recent_value = latest.value;
      const attribution = pickAttribution(latest.raw);
      if (attribution) item.most_recent_attribution = attribution;
      const firmo = firmoByEntity.get(eid);
      if (firmo && Object.keys(firmo).length) item.firmographics = firmo;
      entities.push(item);
    }
    // Most-recently-active first, then trim to limit.
    entities.sort((a, b) => new Date(b.most_recent_at).getTime() - new Date(a.most_recent_at).getTime());
    items = entities.slice(0, limit);
  } else {
    items = (rows.slice(0, limit) as any[]).map(o => {
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
      const attribution = pickAttribution(o.raw);
      if (attribution) item.attribution = attribution;
      return item;
    });
  }

  // ── 5. Rollups (always computed over the un-trimmed match set) ──────────
  const byType:   Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byValue:  Record<string, number> = {};
  // Build by_value only for state observations — meaningless for events.
  const includeByValue = scope.kind === 'state';
  // For by_value, count UNIQUE entities per value (funnel: each entity in
  // one stage), using only that entity's most-recent matching observation.
  const valueByEntity = includeByValue ? new Map<string, string>() : null;

  for (const r of rows) {
    const type = (r.property || '').replace(/^interaction\./, '');
    byType[type]     = (byType[type] ?? 0) + 1;
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    if (valueByEntity && !valueByEntity.has(r.entity_id)) {
      // Rows are already ordered by observed_at desc → first seen wins.
      const v = r.value == null
        ? '(null)'
        : (typeof r.value === 'string' || typeof r.value === 'number' || typeof r.value === 'boolean')
            ? String(r.value)
            : JSON.stringify(r.value);
      valueByEntity.set(r.entity_id, v);
    }
  }
  if (valueByEntity) {
    for (const v of valueByEntity.values()) byValue[v] = (byValue[v] ?? 0) + 1;
  }

  const result: QueryResult = {
    scope,
    ...(options.without ? { without: options.without } : {}),
    mode,
    return: returnMode,
    matched,
    returned: items.length,
    sampled: matched > items.length,
    items,
    rollups: includeByValue
      ? { by_type: byType, by_source: bySource, by_value: byValue }
      : { by_type: byType, by_source: bySource },
    meta: { token_estimate: 0 },
  };
  result.meta.token_estimate = Math.ceil(JSON.stringify(result).length / 4);
  return result;
}

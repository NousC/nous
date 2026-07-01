import { Router } from 'express';
import { getSupabaseClient, scoreTier } from '@nous/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';

// GET /api/graph?workspaceId=... — the workspace's context graph as a node/edge
// snapshot for the Galaxy view. This is the SAME graph the agents traverse, shaped
// for a force layout.
//
// SCOPE: only the accounts we have actually TOUCHED — the People view (engaged
// contacts) and the Companies view — NOT the raw cold-lead dump from lead lists.
// The lead lists are a staging area; the graph is the relationship you actually
// have. Sourcing from the `contacts`/`companies` views (the same sets the People
// and Companies pages show) keeps the galaxy a focused core instead of a cloud of
// untouched leads.
//
// Nodes carry only what the visual encodings need — type, ICP score+tier, and
// days-since-last-activity (aliveness) — and deliberately NO names/emails, so the
// snapshot is anonymous-by-construction and safe to render in share mode.
export const graphApiRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PostgREST caps a single response at ~1000 rows.
async function pageAll(makeQuery) {
  const out = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await makeQuery(from, from + size - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

const ageDays = (ts) => ts ? Math.round((Date.now() - +new Date(ts)) / 864e5) : null;

graphApiRouter.get('/', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { workspaceId } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspace_id_required' });
    if (!UUID.test(workspaceId)) return res.status(400).json({ error: 'invalid_workspace_id' });
    if (req.workspaceId !== workspaceId) return res.status(403).json({ error: 'workspace_not_found_or_unauthorized' });

    const [people, companies, rels, gedges] = await Promise.all([
      // touched people — the contacts view (cold leads already filtered out)
      pageAll((a, b) => supabase.from('contacts')
        .select('id,last_activity_at,icp_score').eq('workspace_id', workspaceId).range(a, b)),
      // companies we know
      pageAll((a, b) => supabase.from('companies')
        .select('id,last_activity_at,icp_score').eq('workspace_id', workspaceId).range(a, b)),
      // backbone edges: person → company
      supabase.from('relationships')
        .select('from_entity_id,to_entity_id').eq('workspace_id', workspaceId)
        .eq('type', 'works_at').is('valid_to', null).then(r => r.data || []),
      // semantic edges: person/company → topic concept (and the rare entity↔entity)
      supabase.from('workspace_graph_edges')
        .select('subject_id,object_id,object_label').eq('workspace_id', workspaceId)
        .not('subject_id', 'is', null).then(r => r.data || []),
    ]);

    const nodes = [];
    const ids = new Set();
    for (const p of people) {
      ids.add(p.id);
      const score = p.icp_score != null ? Number(p.icp_score) : null;
      nodes.push({ id: p.id, t: 'person', score, tier: score != null ? scoreTier(score) : null, age: ageDays(p.last_activity_at) });
    }
    for (const c of companies) {
      if (ids.has(c.id)) continue;
      ids.add(c.id);
      const score = c.icp_score != null ? Number(c.icp_score) : null;
      nodes.push({ id: c.id, t: 'company', score, tier: score != null ? scoreTier(score) : null, age: ageDays(c.last_activity_at) });
    }

    const edges = [];
    for (const r of rels) {
      if (ids.has(r.from_entity_id) && ids.has(r.to_entity_id)) edges.push({ s: r.from_entity_id, t: r.to_entity_id, k: 'works_at' });
    }
    // topic concepts become dim nodes keyed by label — the hub starbursts that
    // bridge touched accounts into a connected core. Only topics that hang off a
    // touched node are kept.
    const topics = new Map();
    for (const g of gedges) {
      if (!g.subject_id || !ids.has(g.subject_id)) continue;
      let target;
      if (g.object_id) {
        if (!ids.has(g.object_id)) continue;          // entity↔entity only if both touched
        target = g.object_id;
      } else if (g.object_label) {
        target = `topic:${g.object_label}`;
        if (!topics.has(target)) topics.set(target, { id: target, t: 'topic', label: g.object_label, score: null, tier: null, age: null });
      } else continue;
      edges.push({ s: g.subject_id, t: target, k: 'topic' });
    }
    for (const tn of topics.values()) nodes.push(tn);

    const nodeIds = new Set(nodes.map(n => n.id));
    const cleanEdges = edges.filter(e => nodeIds.has(e.s) && nodeIds.has(e.t));

    return res.json({
      nodes,
      edges: cleanEdges,
      meta: { people: people.length, companies: companies.length, topics: topics.size, edges: cleanEdges.length, ts: Date.now() },
    });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

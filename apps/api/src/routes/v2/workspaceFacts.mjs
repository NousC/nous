import { Router } from 'express';
import { getSupabaseClient, listNotes, saveNote, supersedeNote, getWorkspaceEntityId } from '@nous/core';

export const workspaceFactsV2Router = Router();

// Agent write-backs are observed/inferred, not directly typed by the user, so
// they're confident but not certain — they show as "inferred" until confirmed.
const WRITEBACK_CONFIDENCE = 0.9;

// Find the active fact a write-back should evolve. The agent passes a bare slot
// name ("pricing"); a playbook-created fact owns "playbook.pricing", so match
// either form so a write-back updates the existing belief instead of duplicating.
export function findSupersedable(active, subject) {
  if (!subject) return null;
  return (
    active.find(n => n.subject === subject) ||
    active.find(n => n.subject === `playbook.${subject}`) ||
    active.find(n => typeof n.subject === 'string' && n.subject.endsWith(`.${subject}`)) ||
    null
  );
}

// GET /v2/workspace/facts — workspace-level facts the workspace owner has
// explicitly recorded (ICP, target market, product, pricing, competitors,
// playbooks). These are NOT facts about individual people or companies;
// they're the workspace's own playbook.
//
// Query params:
//   categories — comma-separated list (e.g. "ICP,Market"). Omit for all.
//   limit      — max facts to return (default 50, max 500).
//
// Response:
//   {
//     facts:        [{ id, category, content, source, recorded_at }],
//     count:        number,
//     by_category:  { ICP: 2, Market: 1, ... }
//   }
//
// Read-only — to write a fact, use POST /v2/observations with a
// `note.<uuid>` property, or the workspace UI's Intelligence tab.
workspaceFactsV2Router.get('/', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.workspaceId;

    const workspaceEntityId = await getWorkspaceEntityId(supabase, workspaceId);
    if (!workspaceEntityId) {
      return res.json({ facts: [], count: 0, by_category: {} });
    }

    const rawCategories = typeof req.query.categories === 'string' ? req.query.categories : '';
    const categories = rawCategories
      .split(',')
      .map(c => c.trim())
      .filter(Boolean);

    const rawLimit = parseInt(String(req.query.limit ?? '50'), 10);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 500);

    const notes = await listNotes(supabase, workspaceId, {
      entityId: workspaceEntityId,
      categories: categories.length ? categories : undefined,
      limit,
    });

    const facts = notes.map(n => ({
      id: n.id,
      category: n.category,
      content: n.content,
      source: n.source,
      confidence: n.confidence,
      recorded_at: n.created_at,
    }));
    const by_category = {};
    for (const f of facts) by_category[f.category] = (by_category[f.category] || 0) + 1;

    return res.json({ facts, count: facts.length, by_category });
  } catch (err) {
    console.error('[GET /v2/workspace/facts]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /v2/workspace/facts — write-back. The agent records a durable change to
// the workspace's own GTM profile (ICP, pricing, positioning, …). When the fact
// targets a `subject` slot that already has an active fact (or an explicit
// `supersedes` id is given), it EVOLVES that belief — the old version is kept as
// history, never deleted. Otherwise it's added as a new fact.
//
// Body: { category, content, subject?, supersedes?, confidence? }
//   category   — one of ICP|Market|Product|Pricing|Competitors|Positioning
//   content    — one short sentence (the fact)
//   subject    — stable slot, e.g. "pricing" or "primary-buyer" (recommended)
//   supersedes — explicit fact id to replace (overrides subject matching)
//   confidence — 0–1; defaults to 0.9 for agent write-backs
workspaceFactsV2Router.post('/', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.workspaceId;
    const { category, content, subject, supersedes, confidence } = req.body ?? {};

    if (!content || !String(content).trim()) {
      return res.status(400).json({ error: 'content required' });
    }
    const entityId = await getWorkspaceEntityId(supabase, workspaceId);
    if (!entityId) return res.status(404).json({ error: 'workspace_entity_not_found' });

    const conf = typeof confidence === 'number'
      ? Math.min(Math.max(confidence, 0), 1)
      : WRITEBACK_CONFIDENCE;
    const params = {
      entityId,
      category: String(category || 'General'),
      content: String(content).trim(),
      source: 'agent',
      subject: subject ? String(subject) : undefined,
      confidence: conf,
    };

    // Decide whether this evolves an existing belief or adds a new one.
    let targetId = supersedes ? String(supersedes) : null;
    if (!targetId && subject) {
      const active = await listNotes(supabase, workspaceId, { entityId, limit: 200 });
      targetId = findSupersedable(active, String(subject))?.id ?? null;
    }

    const fact = targetId
      ? await supersedeNote(supabase, workspaceId, targetId, params)
      : await saveNote(supabase, workspaceId, params);

    return res.status(201).json({ fact, superseded: Boolean(targetId) });
  } catch (err) {
    console.error('[POST /v2/workspace/facts]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

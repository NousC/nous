import { Router } from 'express';
import { getSupabaseClient, listNotes, getWorkspaceEntityId } from '@nous/core';

export const workspaceFactsV2Router = Router();

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

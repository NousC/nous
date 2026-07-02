// /v2/lead-lists — read + create + delete a workspace's lead lists for API-key
// callers (e.g. Partner OS operating an agency's own workspace). verifyApiKey
// populates req.workspaceId.
import { Router } from 'express';
import { getSupabaseClient, listLeadLists, createLeadList, deleteLeadList } from '@nous/core';

export const leadListsV2Router = Router();

// GET /v2/lead-lists — all lists with counts.
leadListsV2Router.get('/', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const lead_lists = await listLeadLists(supabase, req.workspaceId);
    return res.json({ lead_lists });
  } catch (err) {
    console.error('[GET /v2/lead-lists]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /v2/lead-lists — create a list. Body: { name, source? }.
leadListsV2Router.post('/', async (req, res) => {
  try {
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const supabase = getSupabaseClient();
    const created = await createLeadList(supabase, req.workspaceId, { name, source: req.body?.source || 'manual' });
    return res.status(201).json({ lead_list: { ...created, lead_count: 0 } });
  } catch (err) {
    console.error('[POST /v2/lead-lists]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// DELETE /v2/lead-lists/:id — delete a list (and its leads).
leadListsV2Router.delete('/:id', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const deleted = await deleteLeadList(supabase, req.workspaceId, req.params.id);
    return res.json({ deleted: !!deleted });
  } catch (err) {
    console.error('[DELETE /v2/lead-lists/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

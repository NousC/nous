// GET /v2/lead-lists — the workspace's lead lists with counts. Read-only mirror
// of /api/lead-lists for API-key callers (e.g. Partner OS surfacing an agency's
// own lists). Auth is verifyApiKey (populates req.workspaceId).
import { Router } from 'express';
import { getSupabaseClient, listLeadLists } from '@nous/core';

export const leadListsV2Router = Router();

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

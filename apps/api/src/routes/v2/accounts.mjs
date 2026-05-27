import { Router } from 'express';
import { getSupabaseClient, getAccountRecord, resolveFocus } from '@nous/core';

export const accountsV2Router = Router();

// GET /v2/accounts/:id — the full account-record projection:
// entity + claims-with-epistemics + recent observation timeline.
// :id may be an entity UUID, email, domain, LinkedIn URL, or a name.
accountsV2Router.get('/:id', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.workspaceId;

    const resolution = await resolveFocus(supabase, workspaceId, req.params.id);
    if (resolution.status === 'not_found') {
      return res.status(404).json({ error: 'entity_not_found' });
    }
    if (resolution.status === 'ambiguous') {
      return res.json({ status: 'ambiguous', candidates: resolution.candidates });
    }

    const record = await getAccountRecord(supabase, workspaceId, resolution.entity_id);
    if (!record) return res.status(404).json({ error: 'entity_not_found' });
    return res.json(record);
  } catch (err) {
    console.error('[GET /v2/accounts/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

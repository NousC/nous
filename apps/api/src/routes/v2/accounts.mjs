import { Router } from 'express';
import { getSupabaseClient, getAccountRecord, resolveFocus, mergeEntities } from '@nous/core';
import { icpFit } from '../../lib/icpFit.mjs';

export const accountsV2Router = Router();

// POST /v2/accounts/merge — fold a duplicate person into a survivor.
// Body: { keep, drop } — each an entity UUID, email, LinkedIn URL, domain, or name.
// Agent-only dedup. Lossless (drop's identifiers re-attach to keep) + reversible
// (drop becomes a merged tombstone). A name that matches several people returns
// candidates instead of merging — the agent confirms which, then re-calls.
accountsV2Router.post('/merge', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.workspaceId;
    const { keep, drop } = req.body || {};
    if (!keep || !drop) return res.status(400).json({ error: 'keep_and_drop_required' });

    for (const [which, value] of [['keep', keep], ['drop', drop]]) {
      const r = await resolveFocus(supabase, workspaceId, String(value));
      if (r.status === 'not_found') return res.status(404).json({ error: 'entity_not_found', which, value });
      if (r.status === 'ambiguous') return res.json({ status: 'ambiguous', which, candidates: r.candidates });
      if (which === 'keep') req._keepId = r.entity_id; else req._dropId = r.entity_id;
    }
    if (req._keepId === req._dropId) return res.status(400).json({ error: 'same_entity' });

    const summary = await mergeEntities(supabase, workspaceId, req._keepId, req._dropId);
    return res.json({ status: 'merged', ...summary });
  } catch (err) {
    const msg = err?.message || 'internal_error';
    const client = /not found|already merged|type mismatch|itself/.test(msg);
    if (!client) console.error('[POST /v2/accounts/merge]', err);
    return res.status(client ? 400 : 500).json({ error: msg });
  }
});

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
    const icp = await icpFit(supabase, workspaceId, resolution.entity_id);
    return res.json(icp ? { ...record, icp } : record);
  } catch (err) {
    console.error('[GET /v2/accounts/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

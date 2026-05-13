import { Router } from 'express';
import { getSupabaseClient, searchMemories } from '@proply/core';

export const searchRouter = Router();

// POST /v1/search — semantic search across workspace memories
searchRouter.post('/', async (req, res) => {
  try {
    const { q, limit, contact_id, company_id } = req.body;
    if (!q?.trim()) return res.status(400).json({ error: 'q_required' });

    const results = await searchMemories(getSupabaseClient(), req.workspaceId, {
      q, contact_id, company_id,
      limit: limit ? parseInt(limit) : undefined,
    });
    return res.json({ results });
  } catch (err) {
    console.error('[POST /v1/search]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

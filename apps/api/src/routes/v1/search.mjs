import { Router } from 'express';
import { getSupabaseClient, searchMemories } from '@nous/core';
import { logMcpOp } from '../../lib/mcpLogger.mjs';

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
    const count = results.length;
    logMcpOp(req, {
      eventType: 'memory_search',
      summary: `"${q}" → ${count} result${count !== 1 ? 's' : ''}`,
    });
    return res.json({ results });
  } catch (err) {
    console.error('[POST /v1/search]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

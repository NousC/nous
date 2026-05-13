import { Router } from 'express';
import {
  getSupabaseClient,
  listMemories,
  saveMemory,
  updateMemory,
  softDeleteMemory,
  searchMemories,
} from '@proply/core';

export const memoriesRouter = Router();

// GET /v1/memories — list workspace-level facts
memoriesRouter.get('/', async (req, res) => {
  try {
    const memories = await listMemories(getSupabaseClient(), req.workspaceId, {
      category: req.query.category,
      limit: req.query.limit ? parseInt(req.query.limit) : undefined,
    });
    return res.json({ memories });
  } catch (err) {
    console.error('[GET /v1/memories]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /v1/memory/search — semantic search
memoriesRouter.get('/search', async (req, res) => {
  try {
    const { q, contact_id, company_id, limit } = req.query;
    if (!q?.trim()) return res.status(400).json({ error: 'q_required' });

    const results = await searchMemories(getSupabaseClient(), req.workspaceId, {
      q, contact_id, company_id,
      limit: limit ? parseInt(limit) : undefined,
    });
    return res.json({ results });
  } catch (err) {
    console.error('[GET /v1/memory/search]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /v1/memory — create a memory fact
memoriesRouter.post('/', async (req, res) => {
  try {
    const { content, category, metadata, source, contact_id, company_id } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'content_required' });

    const mergedMetadata = {
      ...(metadata || {}),
      ...(contact_id ? { contact_id } : {}),
      ...(company_id ? { company_id } : {}),
    };

    const memory = await saveMemory(getSupabaseClient(), req.workspaceId, {
      content, category, source, metadata: mergedMetadata,
    });
    return res.status(201).json({ memory });
  } catch (err) {
    console.error('[POST /v1/memory]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// PATCH /v1/memory/:id
memoriesRouter.patch('/:id', async (req, res) => {
  try {
    const { content, category, metadata } = req.body;
    const memory = await updateMemory(getSupabaseClient(), req.workspaceId, req.params.id, { content, category, metadata });
    if (!memory) return res.status(404).json({ error: 'not_found' });
    return res.json({ memory });
  } catch (err) {
    console.error('[PATCH /v1/memory/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// DELETE /v1/memory/:id
memoriesRouter.delete('/:id', async (req, res) => {
  try {
    const result = await softDeleteMemory(getSupabaseClient(), req.workspaceId, req.params.id);
    if (!result) return res.status(404).json({ error: 'not_found' });
    return res.json(result);
  } catch (err) {
    console.error('[DELETE /v1/memory/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

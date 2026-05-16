import { Router } from 'express';
import { getSupabaseClient } from '@proply/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';

export const workspaceMemoriesRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

workspaceMemoriesRouter.get('/', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { workspaceId, contact_id, company_id, limit = 100, offset = 0 } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });

    let query = supabase
      .from('workspace_memories')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (contact_id) {
      query = query.filter('metadata->>contact_id', 'eq', contact_id);
    } else if (company_id) {
      query = query.filter('metadata->>company_id', 'eq', company_id);
    } else {
      // workspace-level view: exclude contact- and company-specific memories
      // Use metadata JSONB filtering (direct contact_id column may not exist yet)
      query = query
        .filter('metadata->>contact_id', 'is', null)
        .filter('metadata->>company_id', 'is', null);
    }

    const { data: memories, error, count } = await query;
    if (error) throw error;
    return res.json({ memories: memories || [], total: count });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

workspaceMemoriesRouter.get('/:id', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { id } = req.params;
    if (!UUID.test(id)) return res.status(400).json({ error: 'invalid_id' });
    const { data, error } = await supabase.from('workspace_memories').select('*').eq('id', id).single();
    if (error) return res.status(404).json({ error: 'not_found' });
    return res.json({ memory: data });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

workspaceMemoriesRouter.patch('/:id', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { id } = req.params;
    if (!UUID.test(id)) return res.status(400).json({ error: 'invalid_id' });
    const { content, is_active } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (content !== undefined) updates.content = content;
    if (is_active !== undefined) updates.is_active = is_active;
    const { data, error } = await supabase.from('workspace_memories').update(updates).eq('id', id).select('*').single();
    if (error) throw error;
    return res.json({ memory: data });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

workspaceMemoriesRouter.delete('/:id', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { id } = req.params;
    if (!UUID.test(id)) return res.status(400).json({ error: 'invalid_id' });
    await supabase.from('workspace_memories').update({ is_active: false }).eq('id', id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

workspaceMemoriesRouter.post('/ingest', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { workspaceId, content, contact_id, source = 'manual', metadata = {} } = req.body;
    if (!workspaceId || !content) return res.status(400).json({ error: 'workspaceId and content required' });
    const { data, error } = await supabase.from('workspace_memories').insert({
      workspace_id: workspaceId,
      content,
      contact_id: contact_id || null,
      source,
      metadata,
      is_active: true,
      graph_layer: 'private',
    }).select('*').single();
    if (error) throw error;
    return res.json({ memory: data });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

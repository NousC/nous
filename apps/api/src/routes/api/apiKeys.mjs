import { Router } from 'express';
import crypto from 'crypto';
import { getSupabaseClient, isUUID } from '@proply/core';

export const apiKeysRouter = Router();

// GET /api/workspace/api-keys
apiKeysRouter.get('/', async (req, res) => {
  try {
    const { data, error } = await getSupabaseClient()
      .from('api_keys')
      .select('id, name, last_used_at, created_at, revoked_at')
      .eq('workspace_id', req.workspaceId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      // Table may not exist yet — return empty rather than 500
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return res.json({ api_keys: [] });
      }
      throw error;
    }
    return res.json({ api_keys: data || [] });
  } catch (err) {
    console.error('[GET /api/workspace/api-keys]', err);
    return res.json({ api_keys: [] });
  }
});

// POST /api/workspace/api-keys
apiKeysRouter.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name_required' });

    const rawKey = `pk_${crypto.randomBytes(24).toString('hex')}`;
    const hashedKey = crypto.createHash('sha256').update(rawKey).digest('hex');

    const { data, error } = await getSupabaseClient()
      .from('api_keys')
      .insert({
        workspace_id: req.workspaceId,
        name: name.trim(),
        hashed_key: hashedKey,
      })
      .select('id, name, created_at')
      .single();

    if (error) throw error;
    // Raw key only returned once — never stored in plaintext
    return res.status(201).json({ ...data, key: rawKey });
  } catch (err) {
    console.error('[POST /api/workspace/api-keys]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// DELETE /api/workspace/api-keys/:id
apiKeysRouter.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUUID(id)) return res.status(400).json({ error: 'invalid_id' });

    await getSupabaseClient()
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('workspace_id', req.workspaceId);

    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/workspace/api-keys/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

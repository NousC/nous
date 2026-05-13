import { Router } from 'express';
import { getSupabaseClient } from '@proply/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';

export const systemLogRouter = Router();

// GET /api/workspace/system-log
systemLogRouter.get('/', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { workspace_id, days = '7', source, event_type, limit = '100' } = req.query;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id_required' });

    const since = days === 'all' ? null : new Date(Date.now() - parseInt(days) * 86400000).toISOString();

    let query = supabase.from('workspace_system_log')
      .select('id, source, event_type, summary, contact_id, metadata, occurred_at', { count: 'exact' })
      .eq('workspace_id', workspace_id)
      .order('occurred_at', { ascending: false })
      .limit(Math.min(parseInt(limit) || 100, 200));

    if (since) query = query.gte('occurred_at', since);
    if (source && source !== 'all') query = query.eq('source', source);
    if (event_type && event_type !== 'all') query = query.eq('event_type', event_type);

    const { data, count, error } = await query;
    if (error) throw error;

    return res.json({ events: data || [], total: count || data?.length || 0 });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

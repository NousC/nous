import { Router } from 'express';
import { getSupabaseClient } from '@nous/core';
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

    // Per-member privacy (PRIVACY_MODEL.md): the ops feed shows message-content
    // events ("LinkedIn message from X: <text>"). A member sees that the message
    // happened + who, but not the CONTENT of another rep's message. Owner/admin
    // see all. Fail closed: a message event with no owner stamped is redacted for
    // members too. Non-message events (pushes, scans, skips) are unaffected.
    let events = data || [];
    if (req.viewerScope === 'member') {
      const me = req.memberUserId;
      events = events.map(e => {
        const meta = e.metadata || {};
        const isMessage = e.source === 'linkedin' && (meta.type === 'message' || meta.type === 'message_sent');
        if (!isMessage) return e;
        const owned = meta.owner_user_id && meta.owner_user_id === me;
        if (owned) return e;
        // Keep the "who" part before the first ": ", drop the message text.
        const label = typeof e.summary === 'string' ? e.summary.split(': ')[0] : e.summary;
        return { ...e, summary: label };
      });
    }

    return res.json({ events, total: count || events.length || 0 });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

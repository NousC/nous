import { Router } from 'express';
import { getSupabaseClient } from '@proply/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';
import { ensureUserAndTeam } from '../../lib/auth.mjs';

export const requestsRouter = Router();

// GET /api/requests/log
requestsRouter.get('/log', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { user, team } = await ensureUserAndTeam(req.user);
    const { op_type, entity_type, days = '7', limit = '50', offset = '0' } = req.query;

    const since = days === 'all' ? null : new Date(Date.now() - parseInt(days) * 86400000).toISOString();

    let query = supabase.from('memory_ops_log')
      .select('id, created_at, op_type, entity_type, source, api_key_id', { count: 'exact' })
      .eq('team_id', team.id)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + Math.min(parseInt(limit), 100) - 1);

    if (since) query = query.gte('created_at', since);
    if (op_type && op_type !== 'all') query = query.eq('op_type', op_type);
    if (entity_type && entity_type !== 'all') query = query.eq('entity_type', entity_type);

    const { data: rows, count, error } = await query;
    if (error) throw error;

    const keyIds = [...new Set((rows || []).filter(r => r.api_key_id).map(r => r.api_key_id))];
    let keyMap = {};
    if (keyIds.length) {
      const { data: keys } = await supabase.from('api_keys').select('id, name').in('id', keyIds);
      keyMap = Object.fromEntries((keys || []).map(k => [k.id, k.name]));
    }

    return res.json({
      requests: (rows || []).map(r => ({ id: r.id, created_at: r.created_at, op_type: r.op_type, entity_type: r.entity_type, source: r.source, api_key_name: r.api_key_id ? (keyMap[r.api_key_id] || 'Unknown') : null })),
      total: count || 0,
    });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/requests/stats
requestsRouter.get('/stats', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { team } = await ensureUserAndTeam(req.user);
    const { days = '7', workspace_id } = req.query;

    const since = days === 'all' ? null : new Date(Date.now() - parseInt(days) * 86400000).toISOString();
    const { data: workspaces } = await supabase.from('workspaces').select('id').eq('team_id', team.id);
    const allWsIds = (workspaces || []).map(w => w.id);
    let wsFilter = allWsIds.length ? allWsIds : ['00000000-0000-0000-0000-000000000000'];
    if (workspace_id && allWsIds.includes(workspace_id)) wsFilter = [workspace_id];

    const [factsRes, contactsRes, companiesRes, opsRes] = await Promise.all([
      supabase.from('workspace_memories').select('id', { count: 'exact', head: true }).eq('is_active', true).in('workspace_id', wsFilter),
      supabase.from('contacts').select('id', { count: 'exact', head: true }).in('workspace_id', wsFilter),
      supabase.from('companies').select('id', { count: 'exact', head: true }).in('workspace_id', wsFilter),
      (() => { let q = supabase.from('memory_ops_log').select('op_type, entity_type, created_at').eq('team_id', team.id); if (since) q = q.gte('created_at', since); return q; })(),
    ]);

    const opsRows = opsRes.data || [];
    const writeOps    = opsRows.filter(r => r.op_type === 'write').length;
    const deleteOps   = opsRows.filter(r => r.op_type === 'delete').length;
    const retrieveOps = opsRows.filter(r => r.op_type !== 'write' && r.op_type !== 'delete').length;

    // Per-entity_type breakdowns
    const writeBreakdown = {}, retrieveBreakdown = {}, deleteBreakdown = {};
    for (const r of opsRows) {
      const key = r.entity_type || 'unknown';
      if (r.op_type === 'write')   writeBreakdown[key]    = (writeBreakdown[key]    || 0) + 1;
      else if (r.op_type === 'delete') deleteBreakdown[key] = (deleteBreakdown[key] || 0) + 1;
      else                         retrieveBreakdown[key]  = (retrieveBreakdown[key] || 0) + 1;
    }

    const numDays = days === 'all' ? 30 : Math.max(1, parseInt(days));
    const dayMap = {};
    for (const r of opsRows) {
      const day = (r.created_at || '').slice(0, 10);
      if (!day) continue;
      if (!dayMap[day]) dayMap[day] = { write: 0, retrieve: 0, delete: 0 };
      if (r.op_type === 'write')       dayMap[day].write++;
      else if (r.op_type === 'delete') dayMap[day].delete++;
      else                             dayMap[day].retrieve++;
    }
    const timeSeries = [];
    for (let i = numDays - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      timeSeries.push({ date: key, write: dayMap[key]?.write || 0, retrieve: dayMap[key]?.retrieve || 0, delete: dayMap[key]?.delete || 0 });
    }

    return res.json({
      totalFacts:     factsRes.count    || 0,
      totalContacts:  contactsRes.count || 0,
      totalCompanies: companiesRes.count || 0,
      writeOps,
      retrieveOps,
      deleteOps,
      totalOps: writeOps + retrieveOps + deleteOps,
      writeBreakdown,
      retrieveBreakdown,
      deleteBreakdown,
      breakdown: { ...writeBreakdown, ...retrieveBreakdown, ...deleteBreakdown },
      timeSeries,
    });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

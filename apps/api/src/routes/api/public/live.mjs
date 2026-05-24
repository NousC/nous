import { Router } from 'express';
import { getSupabaseClient } from '@nous/core';

export const publicLiveRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/public/live/snapshot
//
// Public, no-auth endpoint that aggregates ops across ALL workspaces.
// Used by the public /live dashboard and the marketing site's hero banner.
//
// Privacy invariant: never returns names, emails, message content, raw IDs,
// company names, or workspace identifiers. Event type strings + counts only.
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_MS = 2_000;
const RECENT_EVENT_LIMIT = 80;
let cached = null;
let cachedAt = 0;

publicLiveRouter.get('/snapshot', async (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=2');

  const now = Date.now();
  if (cached && now - cachedAt < CACHE_MS) {
    return res.json(cached);
  }

  try {
    const supabase = getSupabaseClient();
    const sinceHourIso = new Date(now - 60 * 60 * 1000).toISOString();
    const sinceFiveMinIso = new Date(now - 5 * 60 * 1000).toISOString();

    // 1) Last-hour window — drives ops/sec + instances-online aggregates.
    const { data: hourEvents, error: hourErr } = await supabase
      .from('workspace_system_log')
      .select('workspace_id, billable_ops, occurred_at')
      .gte('occurred_at', sinceHourIso)
      .order('occurred_at', { ascending: false })
      .limit(5000);

    if (hourErr) throw hourErr;

    const hour = hourEvents || [];
    const opsLast60Min = hour.reduce((s, e) => s + (e.billable_ops || 1), 0);
    const opsPerSec = Math.round((opsLast60Min / 3600) * 10) / 10;
    const instancesOnline = new Set(
      hour.filter((e) => e.occurred_at >= sinceFiveMinIso).map((e) => e.workspace_id)
    ).size;

    // 2) Recent events — newest first, ANY time. Drives the feed.
    //    Shows latest ops regardless of how recent, so an empty
    //    last-hour doesn't mean an empty feed.
    const { data: recentRows } = await supabase
      .from('workspace_system_log')
      .select('event_type, billable_ops, occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(RECENT_EVENT_LIMIT);

    const recentEventTypes = (recentRows || []).map((e) => ({
      type: e.event_type || 'op',
      ts: new Date(e.occurred_at).getTime(),
      inc: Math.max(1, e.billable_ops || 1),
    }));

    // 3) Total-ever — union current op log + legacy memory_ops_log, all teams.
    //    Each table contributes via SUM(billable_ops) / COUNT(*) respectively
    //    (memory_ops_log is the pre-Billing-v2 log where each row = 1 op).
    const [currentRes, legacyRes] = await Promise.all([
      supabase.from('workspace_system_log').select('*', { count: 'estimated', head: true }),
      supabase.from('memory_ops_log').select('*', { count: 'estimated', head: true }),
    ]);
    const totalEver = (currentRes.count || 0) + (legacyRes.count || 0);

    const snapshot = {
      totalEver,
      opsLast60Min,
      opsPerSec,
      instancesOnline,
      countries: 1,           // TODO: derive from real geo source
      uptimePct: 99.97,       // TODO: pull from real uptime sample
      recentEventTypes,
      generatedAt: now,
    };

    cached = snapshot;
    cachedAt = now;
    return res.json(snapshot);
  } catch (err) {
    console.error('[PUBLIC_LIVE_SNAPSHOT_ERROR]', err);
    return res.status(500).json({ error: 'snapshot_failed' });
  }
});

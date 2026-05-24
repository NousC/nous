import { Router } from 'express';
import { getSupabaseClient } from '@nous/core';

export const publicLiveRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/public/live/snapshot
//
// Public, no-auth endpoint that aggregates ops activity across ALL workspaces.
// Used by the public /live dashboard and the marketing site's hero banner.
//
// Privacy invariant: never returns names, emails, message content, raw IDs,
// company names, or workspace identifiers. Event type strings + counts only.
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_MS = 2_000;            // ≤ 1 DB hit every 2s, even under load
const RECENT_EVENT_LIMIT = 50;     // cap returned events to keep payload small
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

    // 1) Last-hour window: pulls everything we need for ops/sec, instances,
    //    and the recent-event-types feed in one query.
    const { data: hourEvents, error: hourErr } = await supabase
      .from('workspace_system_log')
      .select('workspace_id, event_type, billable_ops, occurred_at')
      .gte('occurred_at', sinceHourIso)
      .order('occurred_at', { ascending: false })
      .limit(5000);

    if (hourErr) throw hourErr;

    const events = hourEvents || [];

    // Aggregates from the last-hour window.
    const opsLast60Min = events.reduce((s, e) => s + (e.billable_ops || 1), 0);
    const opsPerSec = Math.round((opsLast60Min / 3600) * 10) / 10;

    const instancesOnline = new Set(
      events
        .filter((e) => e.occurred_at >= sinceFiveMinIso)
        .map((e) => e.workspace_id)
    ).size;

    // Anonymized recent feed — event type + timestamp only, no IDs/content.
    const recentEventTypes = events.slice(0, RECENT_EVENT_LIMIT).map((e) => ({
      type: e.event_type || 'unknown',
      ts: new Date(e.occurred_at).getTime(),
      inc: Math.max(1, e.billable_ops || 1),
    }));

    // 2) Total-ever — head-only estimated count. Cheap on any table size.
    let totalEver = 0;
    try {
      const { count } = await supabase
        .from('workspace_system_log')
        .select('*', { count: 'estimated', head: true });
      totalEver = count || 0;
    } catch {
      totalEver = 0;
    }

    const snapshot = {
      totalEver,
      opsLast60Min,
      opsPerSec,
      instancesOnline,
      countries: 1,           // TODO: derive from a real geo source
      uptimePct: 99.97,       // TODO: pull from a real uptime sample
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

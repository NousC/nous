import { Router } from 'express';
import { getSupabaseClient } from '@nous/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';
import { ensureUserAndTeam } from '../../lib/auth.mjs';
import { getPlanFromSubscription, getTeamOpsUsage, getTeamEnrichmentUsage, periodStartFor, RETRIEVAL_EVENT_TYPES } from '../../lib/plans.mjs';

export const usageRouter = Router();

// GET /api/usage
// Ops-only usage for the current team. Ops are summed from the live op log
// (workspace_system_log.billable_ops) over the current billing period.
usageRouter.get('/', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { team } = await ensureUserAndTeam(req.user);
    const { workspaceId: reqWorkspaceId } = req.query;

    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('team_id', team.id)
      .maybeSingle();

    const plan = getPlanFromSubscription(subscription);
    const [ops, enrichments] = await Promise.all([
      getTeamOpsUsage(supabase, team.id, subscription),
      getTeamEnrichmentUsage(supabase, team.id, subscription),
    ]);

    // All-time ops total — the Mind-page lifetime counter. Sums billable_ops
    // from the live op log, PLUS the legacy memory_ops_log rows (each = 1 op)
    // written by the pre-Billing-v2 app, so the lifetime figure stays
    // continuous. This is display-only — billing uses getTeamOpsUsage above,
    // which is period-scoped and never counts these legacy rows.
    const [{ data: allTimeData }, legacyRes] = await Promise.all([
      supabase.rpc('team_ops_used', { p_team_id: team.id, p_since: '1970-01-01T00:00:00Z' }),
      supabase.from('memory_ops_log').select('id', { count: 'exact', head: true }).eq('team_id', team.id),
    ]);
    const allTimeOps = Number(allTimeData ?? 0) + Number(legacyRes?.count ?? 0);

    const { data: workspaces } = await supabase
      .from('workspaces')
      .select('id')
      .eq('team_id', team.id);
    const workspaceCount = workspaces?.length || 0;
    const workspaceId = reqWorkspaceId || workspaces?.[0]?.id;

    return res.json({
      plan: plan.id,
      planName: plan.name,
      subscription: subscription
        ? {
            status: subscription.status,
            current_period_start: subscription.current_period_start,
            current_period_end: subscription.current_period_end,
            cancel_at_period_end: subscription.cancel_at_period_end,
            stripe_subscription_id: subscription.stripe_subscription_id,
          }
        : null,
      ops: {
        used: ops.used,
        included: ops.included,
        remaining: ops.remaining,
        periodStart: ops.periodStart,
        allTime: allTimeOps,
      },
      enrichments: {
        used: enrichments.used,
        included: enrichments.included,
        remaining: enrichments.remaining,
      },
      workspaces: {
        current: workspaceCount,
        limit: plan.workspaceLimit,
      },
      currentWorkspaceId: workspaceId ?? null,
    });
  } catch (err) {
    return res.status(500).json({
      error: 'internal_error',
      ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }),
    });
  }
});

// GET /api/usage/ops-breakdown
// Per-event-type op counts for the current billing period — powers the Ops
// page's retrieval filter and the "Top metrics for Retrieval Ops" panel. Only
// the retrieval event_types (RETRIEVAL_EVENT_TYPES) are billed; every other op
// is logged but free. Counts use head:true so no rows are transferred.
const RETRIEVAL_LABELS = {
  'v2.context':     'get_context',
  'v2.account.get': 'get_account',
  'v2.query':       'query',
  'v2.attention':   'attention',
};

usageRouter.get('/ops-breakdown', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { team } = await ensureUserAndTeam(req.user);

    const { data: subscription } = await supabase
      .from('subscriptions').select('*').eq('team_id', team.id).maybeSingle();
    const periodStart = periodStartFor(subscription).toISOString();

    const { data: workspaces } = await supabase
      .from('workspaces').select('id').eq('team_id', team.id);
    const wsIds = (workspaces ?? []).map((w) => w.id);

    if (!wsIds.length) {
      return res.json({ periodStart, total: 0, billed: 0, free: 0, retrieval: [] });
    }

    const countFor = async (eventType) => {
      const { count } = await supabase
        .from('workspace_system_log')
        .select('id', { count: 'exact', head: true })
        .in('workspace_id', wsIds)
        .eq('event_type', eventType)
        .gte('occurred_at', periodStart);
      return count ?? 0;
    };

    const [totalRes, ...retrievalCounts] = await Promise.all([
      supabase.from('workspace_system_log')
        .select('id', { count: 'exact', head: true })
        .in('workspace_id', wsIds)
        .gte('occurred_at', periodStart),
      ...RETRIEVAL_EVENT_TYPES.map(countFor),
    ]);

    const retrieval = RETRIEVAL_EVENT_TYPES
      .map((et, i) => ({ eventType: et, label: RETRIEVAL_LABELS[et] || et, count: retrievalCounts[i], billed: true }))
      .sort((a, b) => b.count - a.count);

    const total = totalRes.count ?? 0;
    const billed = retrieval.reduce((s, r) => s + r.count, 0);

    return res.json({
      periodStart,
      total,                       // every op logged this period (free + billed)
      billed,                      // retrieval ops — what counts toward the quota
      free: Math.max(0, total - billed),
      retrieval,                   // per-type, ranked — top metrics + filter source
    });
  } catch (err) {
    return res.status(500).json({
      error: 'internal_error',
      ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }),
    });
  }
});

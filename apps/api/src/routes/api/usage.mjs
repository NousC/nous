import { Router } from 'express';
import { getSupabaseClient } from '@nous/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';
import { ensureUserAndTeam } from '../../lib/auth.mjs';
import { getPlanFromSubscription, getTeamOpsUsage } from '../../lib/plans.mjs';

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
    const ops = await getTeamOpsUsage(supabase, team.id, subscription);

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
        topupBalance: ops.topupBalance,
        remaining: ops.remaining,
        periodStart: ops.periodStart,
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

/**
 * Nous Pricing — server-side mirror of apps/frontend/src/config/plans.ts.
 *
 * Plan IDs: 'free' | 'starter' | 'pro' | 'scale'. Pure-tier model — no top-up
 * packs; run out of ops/enrichments → upgrade tier.
 *
 * Two metered units:
 *   - ops          — webhooks, MCP/SDK/API calls, scans (the live op log)
 *   - enrichments  — capped monthly allowance (external provider cost)
 *
 * Self-hosted (SELF_HOSTED=true) bypasses all gating and metering — see access.mjs.
 */

export const PLAN_IDS = ['free', 'starter', 'pro', 'scale'];

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyPriceUsd: 0,
    includedOpsPerMonth: 1_000,
    enrichmentsPerMonth: 25,
    workspaceLimit: 1,
    stripePriceEnv: null,
    features: { contextualization: true, crmSync: false, supportTier: 'community' },
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    monthlyPriceUsd: 19,
    includedOpsPerMonth: 5_000,
    enrichmentsPerMonth: 100,
    workspaceLimit: 1,
    stripePriceEnv: 'STRIPE_STARTER_PRICE_ID',
    features: { contextualization: true, crmSync: false, supportTier: 'community' },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyPriceUsd: 79,
    includedOpsPerMonth: 25_000,
    enrichmentsPerMonth: 500,
    workspaceLimit: 3,
    stripePriceEnv: 'STRIPE_PRO_PRICE_ID',
    features: { contextualization: true, crmSync: false, supportTier: 'email' },
  },
  scale: {
    id: 'scale',
    name: 'Scale',
    monthlyPriceUsd: 249,
    includedOpsPerMonth: 100_000,
    enrichmentsPerMonth: 2_000,
    workspaceLimit: null,
    stripePriceEnv: 'STRIPE_SCALE_PRICE_ID',
    features: { contextualization: true, crmSync: true, supportTier: 'priority' },
  },
};

export function normalizePlanId(input) {
  const s = typeof input === 'string' ? input.toLowerCase() : '';
  return PLAN_IDS.includes(s) ? s : 'free';
}

export function getPlan(planId) {
  return PLANS[normalizePlanId(planId)];
}

/**
 * Resolve a Supabase `subscriptions` row to a Plan.
 * Past_due/canceled/incomplete fall back to Free.
 */
export function getPlanFromSubscription(subscription) {
  if (!subscription) return PLANS.free;
  const status = subscription.status;
  if (status === 'canceled' || status === 'incomplete_expired' || status === 'past_due') {
    return PLANS.free;
  }
  return getPlan(subscription.plan_id ?? subscription.plan_name);
}

export function hasFeature(planId, feature) {
  const plan = getPlan(planId);
  const v = plan.features?.[feature];
  return typeof v === 'boolean' ? v : false;
}

/** True when self-hosted mode is active. Bypasses all gating + metering. */
export function isSelfHosted() {
  return process.env.SELF_HOSTED === 'true';
}

/**
 * Start of the current billing period for a subscription.
 * Uses Stripe's current_period_start when present; otherwise the calendar
 * month (free-plan users have no Stripe period — they reset on the 1st).
 */
export function periodStartFor(subscription) {
  if (subscription?.current_period_start) {
    return new Date(subscription.current_period_start);
  }
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Compute a team's ops usage for the current period off the live op log.
 * `ops used` = SUM(workspace_system_log.billable_ops) since the period start
 * (via the team_ops_used SQL function).
 */
export async function getTeamOpsUsage(supabase, teamId, subscription) {
  const plan = getPlanFromSubscription(subscription);
  const periodStart = periodStartFor(subscription);

  const { data, error } = await supabase.rpc('team_ops_used', {
    p_team_id: teamId,
    p_since: periodStart.toISOString(),
  });
  if (error) {
    console.error('[getTeamOpsUsage] team_ops_used rpc failed:', error.message);
  }
  const used = Number(data ?? 0);
  const included = plan.includedOpsPerMonth;

  return {
    plan,
    used,
    included,
    remaining: Math.max(0, included - used),
    periodStart: periodStart.toISOString(),
  };
}

/**
 * Count enrichments a team has run this period. Enrichment is its own metered
 * unit, NOT ops — each enrichment writes an `enrichment_run` row to the live
 * op log (with billable_ops=0), so we count those rows.
 */
export async function getTeamEnrichmentUsage(supabase, teamId, subscription) {
  const plan = getPlanFromSubscription(subscription);
  const periodStart = periodStartFor(subscription);

  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id')
    .eq('team_id', teamId);
  const wsIds = (workspaces ?? []).map((w) => w.id);

  let used = 0;
  if (wsIds.length) {
    const { count } = await supabase
      .from('workspace_system_log')
      .select('id', { count: 'exact', head: true })
      .in('workspace_id', wsIds)
      .eq('event_type', 'enrichment_run')
      .gte('occurred_at', periodStart.toISOString());
    used = count ?? 0;
  }
  const included = plan.enrichmentsPerMonth;

  return {
    used,
    included,
    remaining: Math.max(0, included - used),
    periodStart: periodStart.toISOString(),
  };
}

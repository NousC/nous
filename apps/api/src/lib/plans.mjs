/**
 * Nous Pricing — server-side mirror of apps/frontend/src/config/plans.ts.
 *
 * Plan IDs: 'free' | 'pro' | 'scale'.
 * Self-hosted (SELF_HOSTED=true) bypasses gating and metering — see access.mjs.
 */

export const PLAN_IDS = ['free', 'pro', 'scale'];

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyPriceUsd: 0,
    includedOpsPerMonth: 1_000,
    workspaceLimit: 1,
    stripePriceEnv: null,
    features: {
      contextualization: true,
      campaignAnalysis: false,
      publicSignalExtraction: false,
      crmSync: false,
      workspaceCreation: false,
      supportTier: 'community',
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyPriceUsd: 79,
    includedOpsPerMonth: 5_000,
    workspaceLimit: 3,
    stripePriceEnv: 'STRIPE_PRO_PRICE_ID',
    features: {
      contextualization: true,
      campaignAnalysis: true,
      publicSignalExtraction: false,
      crmSync: false,
      workspaceCreation: true,
      supportTier: 'email',
    },
  },
  scale: {
    id: 'scale',
    name: 'Scale',
    monthlyPriceUsd: 249,
    includedOpsPerMonth: 25_000,
    workspaceLimit: null,
    stripePriceEnv: 'STRIPE_SCALE_PRICE_ID',
    features: {
      contextualization: true,
      campaignAnalysis: true,
      publicSignalExtraction: true,
      crmSync: true,
      workspaceCreation: true,
      supportTier: 'priority',
    },
  },
};

export const TOP_UP_PACKS = [
  { id: 'pro-5k',     ops: 5_000,   priceUsd: 15,  stripePriceEnv: 'STRIPE_PACK_PRO_5K_PRICE_ID',     forPlan: 'pro' },
  { id: 'pro-25k',    ops: 25_000,  priceUsd: 60,  stripePriceEnv: 'STRIPE_PACK_PRO_25K_PRICE_ID',    forPlan: 'pro' },
  { id: 'pro-100k',   ops: 100_000, priceUsd: 180, stripePriceEnv: 'STRIPE_PACK_PRO_100K_PRICE_ID',   forPlan: 'pro' },
  { id: 'scale-25k',  ops: 25_000,  priceUsd: 50,  stripePriceEnv: 'STRIPE_PACK_SCALE_25K_PRICE_ID',  forPlan: 'scale' },
  { id: 'scale-100k', ops: 100_000, priceUsd: 150, stripePriceEnv: 'STRIPE_PACK_SCALE_100K_PRICE_ID', forPlan: 'scale' },
  { id: 'scale-500k', ops: 500_000, priceUsd: 600, stripePriceEnv: 'STRIPE_PACK_SCALE_500K_PRICE_ID', forPlan: 'scale' },
];

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

export function topUpPacksForPlan(planId) {
  const id = normalizePlanId(planId);
  if (id === 'free') return [];
  return TOP_UP_PACKS.filter((p) => p.forPlan === id);
}

export function getTopUpPackById(id) {
  return TOP_UP_PACKS.find((p) => p.id === id);
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
 * (via the team_ops_used SQL function). Returns the full usage shape used by
 * /api/usage, /api/billing/state, and the ops-balance gate.
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

  const { data: teamRow } = await supabase
    .from('teams')
    .select('ops_topup_balance')
    .eq('id', teamId)
    .maybeSingle();
  const topupBalance = Number(teamRow?.ops_topup_balance ?? 0);

  const included = plan.includedOpsPerMonth;
  const remaining = Math.max(0, included - used) + topupBalance;

  return {
    plan,
    used,
    included,
    topupBalance,
    remaining,
    periodStart: periodStart.toISOString(),
  };
}

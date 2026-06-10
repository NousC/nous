/**
 * Nous Pricing — single source of truth (frontend mirror of apps/api/src/lib/plans.mjs).
 *
 * Model: monthly subscription, pure-tier. No top-up packs. Run out and upgrade.
 * One metered unit: GTM ops (the live op log). Enrichment is bring-your-own-keys
 * (enrichmentsPerMonth: 0 on every plan) — it runs on the workspace's own provider
 * keys, so it is unmetered. Cloud only. Self-hosted bypasses all gating + metering.
 *
 * Plan IDs: 'free' | 'starter' | 'pro' | 'growth' | 'scale'.
 * Customer-facing names: Free / Start / Pro / Growth / Agency. Internal ids
 * 'starter' and 'scale' are kept (subscriptions key on them) but display as
 * "Start" and "Agency". Enterprise is a marketing-page CTA (mailto), not a tier.
 *
 * `dedicatedSlack` and `multiClientDashboard` are display-only flags. The
 * backend does not gate on them. They drive what the UI shows the customer.
 */

export type PlanId = 'free' | 'starter' | 'pro' | 'growth' | 'scale';

export interface PlanFeatures {
  /** Contextualisation / signal synthesis from private activities. */
  contextualization: boolean;
  /** CRM sync to HubSpot, Salesforce, Pipedrive, Close, Attio. */
  crmSync: boolean;
  /** Lead list builder + saved-view exports. */
  leadLists: boolean;
  /** Public signal extraction (rb2b-style webhook ingest into the graph). */
  publicSignalExtraction: boolean;
  /** Display-only. Dedicated Slack channel. No backend gate. */
  dedicatedSlack: boolean;
  /** Display-only. Multi-client dashboard for agencies. No backend gate. */
  multiClientDashboard: boolean;
  /** Support routing tier. */
  supportTier: 'community' | 'email' | 'priority';
}

export interface Plan {
  id: PlanId;
  name: string;
  monthlyPriceUsd: number;
  includedOpsPerMonth: number;
  enrichmentsPerMonth: number;
  workspaceLimit: number | null; // null = unlimited
  features: PlanFeatures;
  stripePriceEnv: string | null; // null for free
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyPriceUsd: 0,
    includedOpsPerMonth: 1_000,
    enrichmentsPerMonth: 0,
    workspaceLimit: 1,
    stripePriceEnv: null,
    features: {
      contextualization: true,
      crmSync: false,
      leadLists: false,
      publicSignalExtraction: false,
      dedicatedSlack: false,
      multiClientDashboard: false,
      supportTier: 'community',
    },
  },
  starter: {
    id: 'starter',
    name: 'Start',
    monthlyPriceUsd: 29,
    includedOpsPerMonth: 10_000,
    enrichmentsPerMonth: 0,
    workspaceLimit: 1,
    stripePriceEnv: 'STRIPE_STARTER_PRICE_ID',
    features: {
      contextualization: true,
      crmSync: false,
      leadLists: false,
      publicSignalExtraction: false,
      dedicatedSlack: false,
      multiClientDashboard: false,
      supportTier: 'email',
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyPriceUsd: 99,
    includedOpsPerMonth: 50_000,
    enrichmentsPerMonth: 0,
    workspaceLimit: 1,
    stripePriceEnv: 'STRIPE_PRO_PRICE_ID',
    features: {
      contextualization: true,
      crmSync: true,
      leadLists: true,
      publicSignalExtraction: true,
      dedicatedSlack: true,
      multiClientDashboard: false,
      supportTier: 'priority',
    },
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    monthlyPriceUsd: 249,
    includedOpsPerMonth: 100_000,
    enrichmentsPerMonth: 0,
    workspaceLimit: 5,
    stripePriceEnv: 'STRIPE_GROWTH_PRICE_ID',
    features: {
      contextualization: true,
      crmSync: true,
      leadLists: true,
      publicSignalExtraction: true,
      dedicatedSlack: true,
      multiClientDashboard: false,
      supportTier: 'priority',
    },
  },
  // Internal id stays 'scale'; displays as "Agency".
  scale: {
    id: 'scale',
    name: 'Agency',
    monthlyPriceUsd: 499,
    includedOpsPerMonth: 250_000,
    enrichmentsPerMonth: 0,
    workspaceLimit: null,
    stripePriceEnv: 'STRIPE_SCALE_PRICE_ID',
    features: {
      contextualization: true,
      crmSync: true,
      leadLists: true,
      publicSignalExtraction: true,
      dedicatedSlack: true,
      multiClientDashboard: true,
      supportTier: 'priority',
    },
  },
};

const PLAN_ID_SET = new Set<PlanId>(['free', 'starter', 'pro', 'growth', 'scale']);

export function normalizePlanId(input: unknown): PlanId {
  const s = typeof input === 'string' ? input.toLowerCase() : '';
  return PLAN_ID_SET.has(s as PlanId) ? (s as PlanId) : 'free';
}

export function getPlan(planId: unknown): Plan {
  return PLANS[normalizePlanId(planId)];
}

export function hasFeature(planId: unknown, feature: keyof PlanFeatures): boolean {
  const plan = getPlan(planId);
  const v = plan.features[feature];
  return typeof v === 'boolean' ? v : false;
}

// ── Display helpers used by SettingsModal ───────────────────────────────────

export function getPlanDisplayName(planId: unknown): string {
  return getPlan(planId).name;
}

export function getPlanById(planId: unknown): Plan {
  return getPlan(planId);
}

export function getPlanFeaturesForDisplay(plan: Plan): string[] {
  const items: string[] = [
    `${plan.includedOpsPerMonth.toLocaleString()} GTM operations / month`,
    plan.enrichmentsPerMonth > 0
      ? `${plan.enrichmentsPerMonth.toLocaleString()} enrichments / month`
      : 'Enrichment: bring your own keys',
    plan.workspaceLimit === null
      ? 'Unlimited workspaces'
      : `${plan.workspaceLimit} workspace${plan.workspaceLimit === 1 ? '' : 's'}`,
  ];
  if (plan.features.crmSync) items.push('CRM sync to HubSpot, Salesforce, Pipedrive, Close, Attio');
  if (plan.features.publicSignalExtraction) items.push('Public signal extraction');
  if (plan.features.leadLists) items.push('Lead lists');
  if (plan.features.dedicatedSlack) items.push('Dedicated Slack channel');
  if (plan.features.multiClientDashboard) items.push('Multi-client dashboard');
  return items;
}

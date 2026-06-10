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
  /** Weekly LinkedIn engagement worker → native "LinkedIn Engagers" list. */
  linkedinEngagement: boolean;
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
  // Per-client pricing (Partner only): $perWorkspaceUsd/mo per client workspace,
  // baseWorkspaces included in the headline price, opsPerWorkspace added per client.
  perWorkspaceUsd?: number;
  baseWorkspaces?: number;
  opsPerWorkspace?: number;
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
      linkedinEngagement: false,
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
      linkedinEngagement: false,
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
    includedOpsPerMonth: 25_000,
    enrichmentsPerMonth: 0,
    workspaceLimit: 1,
    stripePriceEnv: 'STRIPE_PRO_PRICE_ID',
    features: {
      contextualization: true,
      // Lead lists + LinkedIn engagement unlock here. CRM sync is Growth+.
      crmSync: false,
      leadLists: true,
      linkedinEngagement: true,
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
    workspaceLimit: 3,
    stripePriceEnv: 'STRIPE_GROWTH_PRICE_ID',
    features: {
      contextualization: true,
      // CRM synchronization unlocks here, on top of everything in Pro.
      crmSync: true,
      leadLists: true,
      linkedinEngagement: true,
      publicSignalExtraction: true,
      dedicatedSlack: true,
      multiClientDashboard: false,
      supportTier: 'priority',
    },
  },
  // Internal id stays 'scale'; displays as "Partner". Per-client pricing:
  // $100/mo per client workspace, 5 included in the $500 base, +100k ops each.
  scale: {
    id: 'scale',
    name: 'Partner',
    monthlyPriceUsd: 500,
    perWorkspaceUsd: 100,
    baseWorkspaces: 5,
    opsPerWorkspace: 100_000,
    includedOpsPerMonth: 500_000,
    enrichmentsPerMonth: 0,
    workspaceLimit: 5,
    stripePriceEnv: 'STRIPE_SCALE_PRICE_ID',
    features: {
      contextualization: true,
      crmSync: true,
      leadLists: true,
      linkedinEngagement: true,
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
  const workspaceLine = plan.perWorkspaceUsd
    ? `${plan.baseWorkspaces} client workspaces included, then $${plan.perWorkspaceUsd}/mo each`
    : plan.workspaceLimit === null
      ? 'Unlimited workspaces'
      : `${plan.workspaceLimit} workspace${plan.workspaceLimit === 1 ? '' : 's'}`;
  const items: string[] = [
    `${plan.includedOpsPerMonth.toLocaleString()} GTM operations / month`,
    plan.enrichmentsPerMonth > 0
      ? `${plan.enrichmentsPerMonth.toLocaleString()} enrichments / month`
      : 'Enrichment: bring your own keys',
    workspaceLine,
  ];
  // Order mirrors the marketing site: lead db + LinkedIn at Pro, CRM sync at Growth.
  if (plan.features.leadLists) items.push('Centralized lead database');
  if (plan.features.linkedinEngagement) items.push('LinkedIn engagement worker');
  if (plan.features.crmSync) items.push('CRM synchronization');
  if (plan.features.publicSignalExtraction) items.push('Public signal extraction');
  if (plan.features.dedicatedSlack) items.push('Dedicated Slack channel');
  if (plan.features.multiClientDashboard) items.push('Multi-client dashboard');
  return items;
}

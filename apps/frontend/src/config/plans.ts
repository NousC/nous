/**
 * Nous Pricing — single source of truth (frontend mirror of apps/api/src/lib/plans.mjs).
 *
 * Model: monthly subscription, pure-tier — no top-up packs. Run out → upgrade.
 * Two metered units: ops (live op log) and enrichments (capped allowance).
 * Cloud only. Self-hosted bypasses all gating and metering.
 *
 * Plan IDs: 'free' | 'starter' | 'pro' | 'scale'.
 * Enterprise is a marketing-page CTA (mailto), not a backend tier.
 */

export type PlanId = 'free' | 'starter' | 'pro' | 'scale';

export interface PlanFeatures {
  /** Contextualisation / signal synthesis from private activities. */
  contextualization: boolean;
  /** CRM sync (Salesforce, HubSpot, Pipedrive, Attio). */
  crmSync: boolean;
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

const PLAN_ID_SET = new Set<PlanId>(['free', 'starter', 'pro', 'scale']);

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
    `${plan.includedOpsPerMonth.toLocaleString()} ops / month`,
    `${plan.enrichmentsPerMonth.toLocaleString()} enrichments / month`,
    plan.workspaceLimit === null
      ? 'Unlimited workspaces'
      : `${plan.workspaceLimit} workspace${plan.workspaceLimit === 1 ? '' : 's'}`,
  ];
  if (plan.features.crmSync) items.push('CRM sync');
  return items;
}

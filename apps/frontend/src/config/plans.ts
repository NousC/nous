/**
 * Nous Pricing — single source of truth (frontend mirror).
 *
 * Model: monthly subscription + included ops + optional one-time top-up packs.
 * Cloud only. Self-hosted bypasses all gating and metering.
 *
 * Plan IDs: 'free' | 'pro' | 'scale'.
 * Enterprise is a marketing-page CTA (mailto), not a backend tier.
 */

export type PlanId = 'free' | 'pro' | 'scale';

export interface PlanFeatures {
  /** Contextualisation / signal synthesis from private activities. */
  contextualization: boolean;
  /** Campaign analysis across outbound sequences. */
  campaignAnalysis: boolean;
  /** Public signal extraction (web/news scraping). */
  publicSignalExtraction: boolean;
  /** CRM sync (Salesforce, HubSpot, Pipedrive, Attio). */
  crmSync: boolean;
  /** Multi-workspace creation. */
  workspaceCreation: boolean;
  /** Priority/email/community support routing. */
  supportTier: 'community' | 'email' | 'priority';
}

export interface TopUpPack {
  /** Stable id, used as Stripe metadata. */
  id: string;
  /** Ops granted by this pack. */
  ops: number;
  /** Display price in USD (whole dollars). */
  priceUsd: number;
  /** Stripe price id env var name (resolved server-side). */
  stripePriceEnv: string;
  /** Plan that can purchase this pack. */
  forPlan: Exclude<PlanId, 'free'>;
  popular?: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  monthlyPriceUsd: number;
  includedOpsPerMonth: number;
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

export const TOP_UP_PACKS: TopUpPack[] = [
  // Pro tier packs
  { id: 'pro-5k',   ops: 5_000,   priceUsd: 15,  stripePriceEnv: 'STRIPE_PACK_PRO_5K_PRICE_ID',   forPlan: 'pro' },
  { id: 'pro-25k',  ops: 25_000,  priceUsd: 60,  stripePriceEnv: 'STRIPE_PACK_PRO_25K_PRICE_ID',  forPlan: 'pro', popular: true },
  { id: 'pro-100k', ops: 100_000, priceUsd: 180, stripePriceEnv: 'STRIPE_PACK_PRO_100K_PRICE_ID', forPlan: 'pro' },
  // Scale tier packs
  { id: 'scale-25k',  ops: 25_000,  priceUsd: 50,  stripePriceEnv: 'STRIPE_PACK_SCALE_25K_PRICE_ID',  forPlan: 'scale' },
  { id: 'scale-100k', ops: 100_000, priceUsd: 150, stripePriceEnv: 'STRIPE_PACK_SCALE_100K_PRICE_ID', forPlan: 'scale', popular: true },
  { id: 'scale-500k', ops: 500_000, priceUsd: 600, stripePriceEnv: 'STRIPE_PACK_SCALE_500K_PRICE_ID', forPlan: 'scale' },
];

const PLAN_ID_SET = new Set<PlanId>(['free', 'pro', 'scale']);

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

export function topUpPacksForPlan(planId: unknown): TopUpPack[] {
  const id = normalizePlanId(planId);
  if (id === 'free') return [];
  return TOP_UP_PACKS.filter((p) => p.forPlan === id);
}

// ── Backward-compat shims (callers being migrated incrementally) ────────────
// SettingsModal and a few other places still import these by name. They map
// onto the new shape so the build stays green during the migration.

export function getPlanDisplayName(planId: unknown): string {
  return getPlan(planId).name;
}

export function getPlanById(planId: unknown): Plan {
  return getPlan(planId);
}

export function getPlanFeaturesForDisplay(plan: Plan): string[] {
  const items: string[] = [
    `${plan.includedOpsPerMonth.toLocaleString()} ops / month`,
    plan.workspaceLimit === null
      ? 'Unlimited workspaces'
      : `${plan.workspaceLimit} workspace${plan.workspaceLimit === 1 ? '' : 's'}`,
  ];
  if (plan.features.contextualization) items.push('Contextualisation');
  if (plan.features.campaignAnalysis) items.push('Campaign analysis');
  if (plan.features.publicSignalExtraction) items.push('Public signal extraction');
  if (plan.features.crmSync) items.push('CRM sync');
  return items;
}

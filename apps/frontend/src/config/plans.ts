/**
 * Centralized Pricing Config — Proply
 *
 * Model: Op-pack (buy once, balance depletes with use, no monthly reset)
 * Axes: ops balance (depletes) + accounts limit (capacity ceiling)
 * No per-seat. No monthly subscription. All features & integrations on all plans.
 */

// ── Op Pack Definitions ───────────────────────────────────────────────────────

export interface OpPack {
  id: string;
  ops: number;
  accountsLimit: number;
  priceUSD: number;
  ratePerHundred: number; // $/100 ops
  stripePriceId: string;
  popular?: boolean;
}

export const OP_PACKS: OpPack[] = [
  {
    id: '5k',
    ops: 5_000,
    accountsLimit: 100,
    priceUSD: 19,
    ratePerHundred: 0.38,
    stripePriceId: import.meta.env.VITE_STRIPE_PACK_5K_PRICE_ID || '',
  },
  {
    id: '12k',
    ops: 12_000,
    accountsLimit: 250,
    priceUSD: 39,
    ratePerHundred: 0.325,
    stripePriceId: import.meta.env.VITE_STRIPE_PACK_12K_PRICE_ID || '',
  },
  {
    id: '50k',
    ops: 50_000,
    accountsLimit: 500,
    priceUSD: 99,
    ratePerHundred: 0.198,
    stripePriceId: import.meta.env.VITE_STRIPE_PACK_50K_PRICE_ID || '',
    popular: true,
  },
  {
    id: '250k',
    ops: 250_000,
    accountsLimit: 1000,
    priceUSD: 350,
    ratePerHundred: 0.14,
    stripePriceId: import.meta.env.VITE_STRIPE_PACK_250K_PRICE_ID || '',
  },
];

// Dev free plan — permanent, no Stripe
export const DEV_FREE = {
  ops: 1_000,
  accountsLimit: 50,
};

// Headless — contact-only, no public price
export const HEADLESS_PLAN = {
  id: 'headless',
  displayName: 'Headless GTM Memory',
  description: 'Unlimited ops + accounts. Dedicated infra, white-label, on-prem.',
  contactEmail: 'hello@goproply.com',
};

export function getOpPackById(id: string): OpPack | undefined {
  return OP_PACKS.find(p => p.id === id);
}

// ── Op Costs (how many ops each action consumes) ─────────────────────────────

export const OP_COSTS = {
  read: 1,        // MCP getContext, recall query
  write: 2,       // ingest signal, log activity, identity resolution
  synthesis: 3,   // Haiku reads raw signals → writes synthesized facts
};

// ── AI Credit Costs (separate from ops — for doc/graphic/background gen) ─────

export const CREDIT_COSTS = {
  memorySynthesis: 1,
  chatMessage: 1,
  backgroundEnrichment: 3,
  websiteProfiler: 5,
  documentBase: 15,
  documentPerPage: 12,
  chatMessageRag: 2,
  backgroundGeneration: 15,
  graphicGeneration: 20,
};

export function getDocumentCreditCost(pageCount: number): number {
  return CREDIT_COSTS.documentBase + CREDIT_COSTS.documentPerPage * pageCount;
}

// ── Feature Access (all features on all paid plans) ──────────────────────────

export interface FeatureAccess {
  tasks: boolean;
  workspaceCreation: boolean;
  customSchemas: boolean;
  prioritySupport: boolean;
  privateSlack: boolean;
  sso: boolean;
  forms: boolean;
  workflows: boolean;
  content: boolean;
  unlimitedWorkspaces: boolean;
  onboardingAutomation: boolean;
  crmIntegrations: boolean;
  customBranding: boolean;
}

export function getFeatureAccess(planId: string): FeatureAccess {
  const normalized = planId?.toLowerCase() || 'dev';

  // Dev free tier — limited features (tasks/workflows require a pack purchase)
  if (normalized === 'dev' || normalized === 'free' || normalized === 'trial') {
    return {
      tasks: false,
      workspaceCreation: false,
      customSchemas: false,
      prioritySupport: false,
      privateSlack: false,
      sso: false,
      forms: false,
      workflows: false,
      content: false,
      unlimitedWorkspaces: false,
      onboardingAutomation: false,
      crmIntegrations: true,
      customBranding: false,
    };
  }

  // All paid plans (any op-pack) get full feature access
  return {
    tasks: true,
    workspaceCreation: true,
    customSchemas: true,
    prioritySupport: false,
    privateSlack: false,
    sso: false,
    forms: true,
    workflows: true,
    content: true,
    unlimitedWorkspaces: true,
    onboardingAutomation: true,
    crmIntegrations: true,
    customBranding: true,
  };
}

export function hasFeatureAccess(planId: string, feature: keyof FeatureAccess): boolean {
  return getFeatureAccess(planId)[feature];
}

// ── Legacy compat — kept so existing callers don't break ─────────────────────
// These will be removed once all callers are migrated.

export interface PlanLimits {
  prospects: number | null;
  workspaces: number | null;
  memoryOpsPerMonth: number | null;
  aiCreditsPerMonth: number | null;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  dev:        { prospects: DEV_FREE.accountsLimit, workspaces: 1,    memoryOpsPerMonth: DEV_FREE.ops,    aiCreditsPerMonth: 50 },
  free:       { prospects: DEV_FREE.accountsLimit, workspaces: 1,    memoryOpsPerMonth: DEV_FREE.ops,    aiCreditsPerMonth: 50 },
  trial:      { prospects: DEV_FREE.accountsLimit, workspaces: 1,    memoryOpsPerMonth: DEV_FREE.ops,    aiCreditsPerMonth: 50 },
  starter:    { prospects: 250,                    workspaces: null, memoryOpsPerMonth: null,             aiCreditsPerMonth: 500 },
  pro:        { prospects: 500,                    workspaces: null, memoryOpsPerMonth: null,             aiCreditsPerMonth: 2000 },
  scale:      { prospects: 1000,                   workspaces: null, memoryOpsPerMonth: null,             aiCreditsPerMonth: 8000 },
  enterprise: { prospects: null,                   workspaces: null, memoryOpsPerMonth: null,             aiCreditsPerMonth: null },
  lifetime:   { prospects: 500,                    workspaces: null, memoryOpsPerMonth: null,             aiCreditsPerMonth: 300 },
  // legacy aliases
  build:      { prospects: 250,                    workspaces: null, memoryOpsPerMonth: null,             aiCreditsPerMonth: 500 },
  professional: { prospects: 500,                  workspaces: null, memoryOpsPerMonth: null,             aiCreditsPerMonth: 2000 },
};

export function getPlanLimits(planId: string): PlanLimits {
  return PLAN_LIMITS[planId?.toLowerCase()] ?? PLAN_LIMITS['dev'];
}

export const TRIAL_CONFIG = { durationDays: 14 };

export const LIFETIME_DEAL_CONFIG = {
  starterPrice: '$299',
  starterPriceAmount: 299,
  growthPrice: '$699',
  growthPriceAmount: 699,
  timerDurationSeconds: 600,
  priceId: import.meta.env.VITE_STRIPE_LIFETIME_PRICE_ID || '',
};

// Stub Plan type kept for backwards compat with components that import it
export interface Plan {
  id: string;
  name: string;
  displayName: string;
  monthlyPrice: string;
  yearlyPrice: string;
  monthlyPriceId: string;
  yearlyPriceId: string;
  description: string;
  targetAudience: string[];
  features: string[];
  popular?: boolean;
  hidden?: boolean;
  contactUs?: boolean;
}

export function getPlanById(_id: string): Plan | undefined { return undefined; }
export function getPlanDisplayName(planId: string): string { return planId; }
export function getPublicPlans(): Plan[] { return []; }
export function getSubscribablePlans(): Plan[] { return []; }
export function getPlanFeaturesForDisplay(_plan: Plan): string[] { return []; }
export function getAllPlanFeatures(_plan: Plan): string[] { return []; }
export function getMinimumPlanForFeature(_feature: keyof FeatureAccess): string { return 'starter'; }

export const PLANS: Plan[] = [];
export const DEV_PLAN: Plan = {
  id: 'dev', name: 'dev', displayName: 'Dev', monthlyPrice: '$0', yearlyPrice: '$0',
  monthlyPriceId: '', yearlyPriceId: '', description: 'Free forever',
  targetAudience: [], features: [], hidden: true,
};
export const ENTERPRISE_PLAN: Plan = {
  id: 'enterprise', name: 'enterprise', displayName: 'Headless GTM Memory',
  monthlyPrice: 'Custom', yearlyPrice: 'Custom', monthlyPriceId: '', yearlyPriceId: '',
  description: HEADLESS_PLAN.description, targetAudience: [], features: [], hidden: true, contactUs: true,
};
export const LIFETIME_PLAN: Plan = {
  id: 'lifetime', name: 'lifetime', displayName: 'Lifetime',
  monthlyPrice: '$0', yearlyPrice: '$0', monthlyPriceId: '', yearlyPriceId: '',
  description: 'Lifetime access', targetAudience: [], features: [], hidden: true,
};

export const MEMORY_OP_COSTS = OP_COSTS;

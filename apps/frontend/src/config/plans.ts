/**
 * Nous Pricing — single source of truth (frontend mirror of apps/api/src/lib/plans.mjs).
 *
 * Model: monthly subscription, pure-tier. No top-up packs. Run out and upgrade.
 * Billed on RETRIEVAL only — agent context pulls (get_context / get_account /
 * query / attention). includedOpsPerMonth is the retrieval quota. Every other op
 * is logged but free, and records (people + companies) are UNLIMITED on every
 * plan (recordsLimit: null) — the graph is given away. Enrichment is bring-your-own-keys
 * (enrichmentsPerMonth: 0 on every plan) — it runs on the workspace's own provider
 * keys, so it is unmetered. CRM sync, lead lists + the ICP model are on every cloud
 * plan (the Cloud team layer — blocked on self-host). Self-hosted bypasses metering.
 *
 * Plan IDs: 'free' | 'starter' | 'pro' | 'growth' | 'scale'.
 * Customer-facing names: Free / Start / Pro / Growth / Partner. Internal ids
 * 'starter' and 'scale' are kept (subscriptions key on them) but display as
 * "Start" and "Partner". There is no Enterprise tier — Partner is the top of the
 * ladder, and anything beyond it is handled as a custom plan off the marketing
 * pricing page (talk-to-us), not a self-serve tier.
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
  /** The ICP model — scoring model built from won/loss signals. Cloud team layer. */
  icpScoring: boolean;
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
  /** Retrieval quota / month — the one billed unit (get_context/get_account/query/attention). */
  includedOpsPerMonth: number;
  /** Records (unique people + companies) the plan can hold. null = unlimited (graph is free). */
  recordsLimit: number | null;
  /** Connected LinkedIn accounts allowed per workspace (the one gated resource). */
  linkedinProfiles: number;
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
    recordsLimit: null,
    linkedinProfiles: 0,
    enrichmentsPerMonth: 0,
    workspaceLimit: 1,
    stripePriceEnv: null,
    features: {
      contextualization: true,
      // CRM sync + lead lists are on every CLOUD plan — tiering is by the ops +
      // records meters, not feature gates. Cloud-only on self-host (access.mjs).
      crmSync: true,
      leadLists: true,
      icpScoring: true,
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
    includedOpsPerMonth: 5_000,
    recordsLimit: null,
    linkedinProfiles: 1,
    enrichmentsPerMonth: 0,
    workspaceLimit: 1,
    stripePriceEnv: 'STRIPE_STARTER_PRICE_ID',
    features: {
      contextualization: true,
      crmSync: true,
      leadLists: true,
      icpScoring: true,
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
    recordsLimit: null,
    linkedinProfiles: 1,
    enrichmentsPerMonth: 0,
    workspaceLimit: 1,
    stripePriceEnv: 'STRIPE_PRO_PRICE_ID',
    features: {
      contextualization: true,
      crmSync: true,
      leadLists: true,
      icpScoring: true,
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
    recordsLimit: null,
    linkedinProfiles: 5,
    enrichmentsPerMonth: 0,
    workspaceLimit: 3,
    stripePriceEnv: 'STRIPE_GROWTH_PRICE_ID',
    features: {
      contextualization: true,
      // CRM synchronization unlocks here, on top of everything in Pro.
      crmSync: true,
      leadLists: true,
      icpScoring: true,
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
    recordsLimit: null, // unlimited — graph is given away
    linkedinProfiles: 1, // per client workspace
    enrichmentsPerMonth: 0,
    workspaceLimit: 5,
    stripePriceEnv: 'STRIPE_SCALE_PRICE_ID',
    features: {
      contextualization: true,
      crmSync: true,
      leadLists: true,
      icpScoring: true,
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

/**
 * Plan card bullets. We show only the three things that scale with a plan:
 * GTM operations / month, records, and the bring-your-own-keys note. CRM sync,
 * lead lists, LinkedIn and the full intelligence brain are on every plan, so
 * they are not per-tier differentiators and are not listed here.
 */
export function getPlanFeaturesForDisplay(plan: Plan): string[] {
  // Records are unlimited on every plan now (recordsLimit: null) — the graph is
  // given away and the retrieval meter does the tiering.
  const recordsLine = plan.recordsLimit == null
    ? 'Unlimited records'
    : plan.perWorkspaceUsd
      ? `${plan.recordsLimit.toLocaleString()} records per client`
      : `${plan.recordsLimit.toLocaleString()} records`;
  const items: string[] = [
    `${plan.includedOpsPerMonth.toLocaleString()} retrievals / month`,
    recordsLine,
    plan.enrichmentsPerMonth > 0
      ? `${plan.enrichmentsPerMonth.toLocaleString()} enrichments / month`
      : 'Enrichment: bring your own keys',
  ];
  // Partner is sold per client workspace — keep that one structural line.
  if (plan.perWorkspaceUsd) {
    items.push(`${plan.baseWorkspaces} client workspaces included, then $${plan.perWorkspaceUsd}/mo each`);
  }
  return items;
}

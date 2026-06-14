// Server-side feature gating + usage gating.
//
// `requireFeature` blocks a request if the team's current plan does not
// include the named feature. `requireOpsBalance` blocks when the month's
// included ops are exhausted. `requireEnrichmentQuota` blocks when the
// month's enrichment allowance is exhausted.
//
// Self-hosted bypass: if SELF_HOSTED=true, every gate passes. There is no
// concept of a paid plan on self-host — operators can do anything.

import { getSupabaseClient } from '@nous/core';
import { ensureUserAndTeam } from './auth.mjs';
import {
  getPlan,
  getPlanFromSubscription,
  getTeamOpsUsage,
  getTeamOpsState,
  getTeamEnrichmentUsage,
  getTeamRecordsState,
  hasFeature,
  isSelfHosted,
} from './plans.mjs';

export async function resolveTeamAndPlan(req) {
  const supabase = getSupabaseClient();
  let team;
  if (req.user) {
    // JWT auth — resolve the team from the logged-in user.
    ({ team } = await ensureUserAndTeam(req.user));
  } else if (req.workspaceId) {
    // API-key (pk_) auth — there is no logged-in user; resolve the team via the
    // workspace the key belongs to, mirroring getAuthContext's API-key branch.
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('team_id')
      .eq('id', req.workspaceId)
      .single();
    if (!workspace) throw new Error('workspace_not_found');
    const { data: keyTeam } = await supabase
      .from('teams')
      .select('*')
      .eq('id', workspace.team_id)
      .single();
    team = keyTeam;
  }
  if (!team) throw new Error('no_team_context');
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('team_id', team.id)
    .maybeSingle();
  return { team, subscription, plan: getPlanFromSubscription(subscription), supabase };
}

/**
 * Express middleware factory. Blocks the request when the current plan
 * does not enable `feature`. Free on self-host.
 *
 * Usage:
 *   router.post('/sync-now', verifySupabaseAuth, requireFeature('crmSync'), handler);
 */
// Features that are NOT available on self-host (cloud-only). Self-host gets the
// open primitive — the customer graph, identity resolution, get_context /
// get_account / query, verify, record, MCP, integrations, AND the ICP scoring
// model — unmetered. The team layer (CRM sync, lead lists) is reserved for Nous
// Cloud and is the OSS→cloud conversion lever. Add governance/enterprise features here later.
const CLOUD_ONLY_FEATURES = new Set(['crmSync', 'leadLists']);

export function requireFeature(feature) {
  return async function requireFeatureMiddleware(req, res, next) {
    if (isSelfHosted()) {
      if (CLOUD_ONLY_FEATURES.has(feature)) {
        return res.status(403).json({
          error: 'cloud_only_feature',
          feature,
          message: `${feature} is available on Nous Cloud only.`,
        });
      }
      return next();
    }
    try {
      const { plan } = await resolveTeamAndPlan(req);
      req.plan = plan; // stash for downstream handlers (e.g. native-list eligibility)
      if (!hasFeature(plan.id, feature)) {
        return res.status(402).json({
          error: 'feature_not_in_plan',
          feature,
          current_plan: plan.id,
          upgrade_url: '/settings?section=billing',
        });
      }
      return next();
    } catch (err) {
      console.error('[requireFeature]', feature, err);
      return res.status(500).json({ error: 'internal_error' });
    }
  };
}

/**
 * Express middleware. Blocks the request when the month's included ops are
 * exhausted. Pass-through on self-host.
 */
export async function requireOpsBalance(req, res, next) {
  if (isSelfHosted()) return next();
  try {
    const { team, subscription, plan, supabase } = await resolveTeamAndPlan(req);
    const ops = await getTeamOpsState(supabase, team.id, subscription);
    req.opsState = ops.state; // 'ok' | 'warn' | 'grace' | 'restricted'

    // Only the restricted state blocks. 'grace' still passes — the team has 3 days
    // over the limit before anything stops. Ingest (worker webhooks/pollers) never
    // hits this guard, so captured GTM signal is never lost.
    if (ops.state === 'restricted') {
      return res.status(402).json({
        error: 'upgrade_required',
        reason: 'ops_limit_reached',
        current_plan: plan.id,
        included_per_month: ops.included,
        used: ops.used,
        grace_expired_at: ops.graceUntil,
        upgrade_url: '/settings?section=billing',
        message: `You've hit the monthly operations limit on the ${plan.name} plan and the 3-day grace window has ended. Upgrade to resume agent and outbound operations — your data and incoming signal are untouched.`,
      });
    }
    return next();
  } catch (err) {
    // Fail OPEN: never block a live agent op because metering hiccuped. A bug
    // here must not be able to take down customer automation.
    console.error('[requireOpsBalance] fail-open:', err?.message);
    return next();
  }
}

/**
 * Express middleware. Blocks PROACTIVE record creation (lead-list imports,
 * scraper enqueue, bulk adds) when the team is over its records limit AND the
 * 3-day grace window has expired. Mount this ONLY on proactive-creation routes —
 * never on organic ingest (webhooks/pollers/CRM-sync worker), so captured GTM
 * signal is never lost. Pass-through on self-host.
 */
export async function requireRecordsBalance(req, res, next) {
  if (isSelfHosted()) return next();
  try {
    const { team, subscription, plan, supabase } = await resolveTeamAndPlan(req);
    const records = await getTeamRecordsState(supabase, team.id, subscription);
    req.recordsState = records.state; // 'ok' | 'warn' | 'grace' | 'restricted'

    // Only 'restricted' blocks. 'grace' still passes — 3 days over the limit
    // before imports stop. Existing data and live ingest are untouched.
    if (records.state === 'restricted') {
      return res.status(402).json({
        error: 'upgrade_required',
        reason: 'records_limit_reached',
        current_plan: plan.id,
        included: records.included,
        used: records.used,
        grace_expired_at: records.graceUntil,
        upgrade_url: '/settings?section=billing',
        message: `You've reached the records limit on the ${plan.name} plan and the 3-day grace window has ended. Upgrade or remove records to resume imports — your existing data and incoming signal are untouched.`,
      });
    }
    return next();
  } catch (err) {
    // Fail OPEN: a metering hiccup must never block legitimate work.
    console.error('[requireRecordsBalance] fail-open:', err?.message);
    return next();
  }
}

/**
 * Express middleware. Blocks the request when the month's enrichment
 * allowance is exhausted. Pass-through on self-host.
 */
export async function requireEnrichmentQuota(req, res, next) {
  if (isSelfHosted()) return next();
  try {
    const { team, subscription, plan, supabase } = await resolveTeamAndPlan(req);
    // Bring-your-own-keys model: a plan with no managed enrichment allowance
    // (enrichmentsPerMonth === 0) runs enrichment on the workspace's own provider
    // keys, so it is unmetered — pass through, uncapped. Metering only kicks in if
    // a future plan re-introduces a managed allowance (> 0).
    if (!plan.enrichmentsPerMonth) {
      req.enrichRemaining = Infinity;
      return next();
    }
    const enrich = await getTeamEnrichmentUsage(supabase, team.id, subscription);
    if (enrich.remaining <= 0) {
      return res.status(402).json({
        error: 'enrichment_quota_exhausted',
        current_plan: plan.id,
        included_per_month: enrich.included,
        upgrade_url: '/settings?section=billing',
      });
    }
    req.enrichRemaining = enrich.remaining; // so bulk enrich can cap to the allowance
    return next();
  } catch (err) {
    console.error('[requireEnrichmentQuota]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}

/**
 * LinkedIn connect gate. Given a workspace, resolve its team's plan and report
 * whether another LinkedIn account may be connected (used < plan.linkedinProfiles).
 * This is the ONE count-gated resource — LinkedIn accounts cost real money/risk,
 * so the number per workspace is the plan lever. Self-host bypasses (unlimited).
 *
 * Returns { allowed, limit, used, plan, planName } — callers 402 on !allowed.
 */
export async function checkLinkedinSlot(supabase, workspaceId) {
  if (isSelfHosted()) return { allowed: true, limit: Infinity, used: 0, plan: 'self_hosted', planName: 'Self-hosted' };
  const { data: ws } = await supabase
    .from('workspaces')
    .select('team_id')
    .eq('id', workspaceId)
    .maybeSingle();
  // Unknown workspace — don't block here; downstream auth will reject it.
  if (!ws) return { allowed: true, limit: 0, used: 0, plan: 'free', planName: 'Free' };
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('team_id', ws.team_id)
    .maybeSingle();
  const plan = getPlanFromSubscription(subscription);
  const limit = plan.linkedinProfiles ?? 0;
  const { count } = await supabase
    .from('workspace_linkedin_connections')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);
  const used = count ?? 0;
  return { allowed: used < limit, limit, used, plan: plan.id, planName: plan.name };
}

/**
 * Throw if the current plan doesn't include the feature.
 * For use inside route handlers that already resolved the team. Mirrors the
 * middleware shape for parity.
 */
export function assertFeature(planId, feature) {
  if (isSelfHosted()) {
    if (CLOUD_ONLY_FEATURES.has(feature)) {
      const err = new Error(`cloud_only_feature:${feature}`);
      err.code = 'cloud_only_feature';
      err.feature = feature;
      throw err;
    }
    return;
  }
  if (!hasFeature(planId, feature)) {
    const err = new Error(`feature_not_in_plan:${feature}`);
    err.code = 'feature_not_in_plan';
    err.feature = feature;
    err.plan = planId;
    throw err;
  }
}

export { getPlan, hasFeature, isSelfHosted };

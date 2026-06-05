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
  getTeamEnrichmentUsage,
  hasFeature,
  isSelfHosted,
} from './plans.mjs';

async function resolveTeamAndPlan(req) {
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
// Features that are NOT available on self-host (cloud-only). Self-host gets
// everything else, unmetered. Add governance/enterprise features here later.
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
    const ops = await getTeamOpsUsage(supabase, team.id, subscription);
    if (ops.remaining <= 0) {
      return res.status(402).json({
        error: 'ops_exhausted',
        current_plan: plan.id,
        included_per_month: ops.included,
        upgrade_url: '/settings?section=billing',
      });
    }
    return next();
  } catch (err) {
    console.error('[requireOpsBalance]', err);
    return res.status(500).json({ error: 'internal_error' });
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
    const enrich = await getTeamEnrichmentUsage(supabase, team.id, subscription);
    if (enrich.remaining <= 0) {
      return res.status(402).json({
        error: 'enrichment_quota_exhausted',
        current_plan: plan.id,
        included_per_month: enrich.included,
        upgrade_url: '/settings?section=billing',
      });
    }
    return next();
  } catch (err) {
    console.error('[requireEnrichmentQuota]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
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

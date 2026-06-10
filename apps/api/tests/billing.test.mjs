/**
 * Pure unit tests for the billing layer — no DB required.
 *
 * Pure-tier model (Free/Start/Pro/Growth/Agency), no top-up packs. Ops are metered
 * off the live op log via team_ops_used; enrichments are a separate capped
 * allowance. These tests cover the deterministic plan logic against stubs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('plans: five tiers with the expected ops + enrichment ladders + prices', async () => {
  const { PLANS } = await import('../src/lib/plans.mjs');
  assert.deepEqual(Object.keys(PLANS).sort(), ['free', 'growth', 'pro', 'scale', 'starter']);
  assert.equal(PLANS.free.includedOpsPerMonth, 1_000);
  assert.equal(PLANS.starter.includedOpsPerMonth, 10_000);
  assert.equal(PLANS.pro.includedOpsPerMonth, 25_000);
  assert.equal(PLANS.growth.includedOpsPerMonth, 100_000);
  assert.equal(PLANS.scale.includedOpsPerMonth, 500_000);
  // Enrichment is bring-your-own-keys: no plan includes a managed allowance.
  for (const id of ['free', 'starter', 'pro', 'growth', 'scale']) {
    assert.equal(PLANS[id].enrichmentsPerMonth, 0, `${id} should include 0 enrichments (BYOK)`);
  }
  // Pro is single-workspace like Start; Growth=3; Partner base=5 (then per-client).
  assert.equal(PLANS.starter.workspaceLimit, 1);
  assert.equal(PLANS.pro.workspaceLimit, 1);
  assert.equal(PLANS.growth.workspaceLimit, 3);
  assert.equal(PLANS.scale.workspaceLimit, 5);
  // Prices: Free $0 / Start $29 / Pro $99 / Growth $249 / Partner $500 base.
  assert.equal(PLANS.free.monthlyPriceUsd, 0);
  assert.equal(PLANS.starter.monthlyPriceUsd, 29);
  assert.equal(PLANS.pro.monthlyPriceUsd, 99);
  assert.equal(PLANS.growth.monthlyPriceUsd, 249);
  assert.equal(PLANS.scale.monthlyPriceUsd, 500);
  // Partner per-client pricing fields.
  assert.equal(PLANS.scale.perWorkspaceUsd, 100);
  assert.equal(PLANS.scale.baseWorkspaces, 5);
  // Display names: internal ids 'starter'/'scale' show as Start/Partner.
  assert.equal(PLANS.starter.name, 'Start');
  assert.equal(PLANS.scale.name, 'Partner');
});

test('hasFeature: lead lists + LinkedIn at Pro+, CRM sync at Growth+', async () => {
  const { hasFeature } = await import('../src/lib/plans.mjs');
  for (const p of ['free', 'starter']) {
    assert.equal(hasFeature(p, 'crmSync'), false, `${p} should not have crmSync`);
    assert.equal(hasFeature(p, 'leadLists'), false, `${p} should not have leadLists`);
    assert.equal(hasFeature(p, 'linkedinEngagement'), false, `${p} should not have linkedinEngagement`);
    assert.equal(hasFeature(p, 'contextualization'), true);
  }
  // Lead lists + LinkedIn engagement unlock at Pro and stay up the ladder.
  for (const p of ['pro', 'growth', 'scale']) {
    assert.equal(hasFeature(p, 'leadLists'), true, `${p} should have leadLists`);
    assert.equal(hasFeature(p, 'linkedinEngagement'), true, `${p} should have linkedinEngagement`);
  }
  // CRM sync is Growth+ only — NOT on Pro.
  assert.equal(hasFeature('pro', 'crmSync'), false, 'Pro should NOT have crmSync');
  assert.equal(hasFeature('growth', 'crmSync'), true);
  assert.equal(hasFeature('scale', 'crmSync'), true);
});

test('getPlanFromSubscription: missing → free; past_due → free; starter/scale resolve', async () => {
  const { getPlanFromSubscription } = await import('../src/lib/plans.mjs');
  assert.equal(getPlanFromSubscription(null).id, 'free');
  assert.equal(getPlanFromSubscription({ plan_id: 'scale', status: 'past_due' }).id, 'free');
  assert.equal(getPlanFromSubscription({ plan_id: 'scale', status: 'active' }).id, 'scale');
  assert.equal(getPlanFromSubscription({ plan_id: 'starter', status: 'active' }).id, 'starter');
});

test('normalizePlanId: unknown → free; starter is valid', async () => {
  const { normalizePlanId } = await import('../src/lib/plans.mjs');
  assert.equal(normalizePlanId('starter'), 'starter');
  assert.equal(normalizePlanId('lifetime'), 'free');
  assert.equal(normalizePlanId(undefined), 'free');
});

test('periodStartFor: uses Stripe period when present, else start of month', async () => {
  const { periodStartFor } = await import('../src/lib/plans.mjs');
  const stripeStart = '2026-05-03T00:00:00.000Z';
  assert.equal(
    periodStartFor({ current_period_start: stripeStart }).toISOString(),
    new Date(stripeStart).toISOString(),
  );
  assert.equal(periodStartFor(null).getUTCDate(), 1, 'free-plan fallback is the 1st');
});

// getTeamOpsUsage sums billable_ops via the team_ops_used RPC. No top-up balance.
function makeOpsStub(opsUsed) {
  return {
    rpc: async (fn, args) => {
      assert.equal(fn, 'team_ops_used');
      assert.ok(args.p_team_id && args.p_since, 'rpc args present');
      return { data: opsUsed, error: null };
    },
  };
}

test('getTeamOpsUsage: free plan under limit', async () => {
  const { getTeamOpsUsage } = await import('../src/lib/plans.mjs');
  const ops = await getTeamOpsUsage(makeOpsStub(200), 't1', null);
  assert.equal(ops.plan.id, 'free');
  assert.equal(ops.included, 1000);
  assert.equal(ops.used, 200);
  assert.equal(ops.remaining, 800);
});

test('getTeamOpsUsage: exhausted plan reports 0 remaining (no top-up)', async () => {
  const { getTeamOpsUsage } = await import('../src/lib/plans.mjs');
  const sub = { plan_id: 'pro', status: 'active', current_period_start: '2026-05-01T00:00:00Z' };
  const ops = await getTeamOpsUsage(makeOpsStub(99999), 't1', sub);
  assert.equal(ops.included, 25000);
  assert.equal(ops.remaining, 0);
  assert.equal(ops.topupBalance, undefined, 'no top-up balance in the pure-tier model');
});

test('getTeamEnrichmentUsage: counts enrichment_run rows against the plan allowance', async () => {
  const { getTeamEnrichmentUsage } = await import('../src/lib/plans.mjs');
  // Stub: workspaces lookup then a count query on workspace_system_log.
  const stub = {
    from: (table) => {
      if (table === 'workspaces') {
        return { select: () => ({ eq: async () => ({ data: [{ id: 'w1' }] }) }) };
      }
      // workspace_system_log count chain
      return {
        select: () => ({
          in: () => ({
            eq: () => ({
              gte: async () => ({ count: 40 }),
            }),
          }),
        }),
      };
    },
  };
  const sub = { plan_id: 'starter', status: 'active', current_period_start: '2026-05-01T00:00:00Z' };
  const e = await getTeamEnrichmentUsage(stub, 't1', sub);
  // BYOK: no managed allowance, so included is 0 and remaining clamps to 0.
  // requireEnrichmentQuota bypasses entirely when included === 0 (see access.mjs).
  assert.equal(e.included, 0);
  assert.equal(e.used, 40);
  assert.equal(e.remaining, 0);
});

test('isSelfHosted reflects SELF_HOSTED env', async () => {
  const { isSelfHosted } = await import('../src/lib/plans.mjs');
  const prior = process.env.SELF_HOSTED;
  try {
    process.env.SELF_HOSTED = 'true';
    assert.equal(isSelfHosted(), true);
    process.env.SELF_HOSTED = 'false';
    assert.equal(isSelfHosted(), false);
  } finally {
    if (prior === undefined) delete process.env.SELF_HOSTED;
    else process.env.SELF_HOSTED = prior;
  }
});

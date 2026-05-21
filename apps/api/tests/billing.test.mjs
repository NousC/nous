/**
 * Pure unit tests for the billing layer — no DB required.
 *
 * Pure-tier model (Free/Starter/Pro/Scale), no top-up packs. Ops are metered
 * off the live op log via team_ops_used; enrichments are a separate capped
 * allowance. These tests cover the deterministic plan logic against stubs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('plans: four tiers with the expected ops + enrichment ladders', async () => {
  const { PLANS } = await import('../src/lib/plans.mjs');
  assert.deepEqual(Object.keys(PLANS).sort(), ['free', 'pro', 'scale', 'starter']);
  assert.equal(PLANS.free.includedOpsPerMonth, 1_000);
  assert.equal(PLANS.starter.includedOpsPerMonth, 5_000);
  assert.equal(PLANS.pro.includedOpsPerMonth, 25_000);
  assert.equal(PLANS.scale.includedOpsPerMonth, 100_000);
  assert.equal(PLANS.free.enrichmentsPerMonth, 25);
  assert.equal(PLANS.starter.enrichmentsPerMonth, 100);
  assert.equal(PLANS.pro.enrichmentsPerMonth, 500);
  assert.equal(PLANS.scale.enrichmentsPerMonth, 2_000);
});

test('hasFeature: crmSync is Scale-only; contextualization is everywhere', async () => {
  const { hasFeature } = await import('../src/lib/plans.mjs');
  for (const p of ['free', 'starter', 'pro']) {
    assert.equal(hasFeature(p, 'crmSync'), false, `${p} should not have crmSync`);
    assert.equal(hasFeature(p, 'contextualization'), true);
  }
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
  assert.equal(e.included, 100);
  assert.equal(e.used, 40);
  assert.equal(e.remaining, 60);
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

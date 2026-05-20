/**
 * Pure unit tests for the billing layer — no DB required.
 *
 * Ops are metered off the live op log (workspace_system_log.billable_ops),
 * summed by the team_ops_used SQL function. These tests cover the deterministic
 * plan/feature logic and the getTeamOpsUsage computation against a stub client.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('hasFeature: free has contextualization, not crmSync/campaignAnalysis', async () => {
  const { hasFeature } = await import('../src/lib/plans.mjs');
  assert.equal(hasFeature('free', 'contextualization'), true);
  assert.equal(hasFeature('free', 'crmSync'), false);
  assert.equal(hasFeature('free', 'campaignAnalysis'), false);
});

test('hasFeature: pro adds campaignAnalysis but not publicSignalExtraction/crmSync', async () => {
  const { hasFeature } = await import('../src/lib/plans.mjs');
  assert.equal(hasFeature('pro', 'campaignAnalysis'), true);
  assert.equal(hasFeature('pro', 'publicSignalExtraction'), false);
  assert.equal(hasFeature('pro', 'crmSync'), false);
});

test('hasFeature: scale unlocks everything', async () => {
  const { hasFeature } = await import('../src/lib/plans.mjs');
  for (const f of ['contextualization', 'campaignAnalysis', 'publicSignalExtraction', 'crmSync']) {
    assert.equal(hasFeature('scale', f), true, `scale should have ${f}`);
  }
});

test('topUpPacksForPlan: free has none; pro/scale have plan-specific packs', async () => {
  const { topUpPacksForPlan } = await import('../src/lib/plans.mjs');
  assert.equal(topUpPacksForPlan('free').length, 0);
  assert.ok(topUpPacksForPlan('pro').every((p) => p.forPlan === 'pro'));
  assert.ok(topUpPacksForPlan('scale').every((p) => p.forPlan === 'scale'));
});

test('getPlanFromSubscription: missing → free; past_due → free; active scale → scale', async () => {
  const { getPlanFromSubscription } = await import('../src/lib/plans.mjs');
  assert.equal(getPlanFromSubscription(null).id, 'free');
  assert.equal(getPlanFromSubscription({ plan_id: 'scale', status: 'past_due' }).id, 'free');
  assert.equal(getPlanFromSubscription({ plan_id: 'scale', status: 'active' }).id, 'scale');
  assert.equal(getPlanFromSubscription({ plan_id: 'pro', status: 'trialing' }).id, 'pro');
});

test('periodStartFor: uses Stripe period when present, else start of month', async () => {
  const { periodStartFor } = await import('../src/lib/plans.mjs');
  const stripeStart = '2026-05-03T00:00:00.000Z';
  assert.equal(
    periodStartFor({ current_period_start: stripeStart }).toISOString(),
    new Date(stripeStart).toISOString(),
  );
  const fallback = periodStartFor(null);
  assert.equal(fallback.getUTCDate(), 1, 'free-plan fallback is the 1st of the month');
});

// getTeamOpsUsage sums billable_ops via the team_ops_used RPC. Stub the client.
function makeStubClient({ opsUsed, topupBalance }) {
  return {
    rpc: async (fn, args) => {
      assert.equal(fn, 'team_ops_used');
      assert.ok(args.p_team_id && args.p_since, 'rpc args present');
      return { data: opsUsed, error: null };
    },
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            assert.equal(table, 'teams');
            return { data: { ops_topup_balance: topupBalance }, error: null };
          },
        }),
      }),
    }),
  };
}

test('getTeamOpsUsage: free plan, under limit', async () => {
  const { getTeamOpsUsage } = await import('../src/lib/plans.mjs');
  const ops = await getTeamOpsUsage(makeStubClient({ opsUsed: 200, topupBalance: 0 }), 't1', null);
  assert.equal(ops.plan.id, 'free');
  assert.equal(ops.included, 1000);
  assert.equal(ops.used, 200);
  assert.equal(ops.remaining, 800);
});

test('getTeamOpsUsage: scale plan over included falls back to top-up balance', async () => {
  const { getTeamOpsUsage } = await import('../src/lib/plans.mjs');
  const sub = { plan_id: 'scale', status: 'active', current_period_start: '2026-05-01T00:00:00Z' };
  const ops = await getTeamOpsUsage(makeStubClient({ opsUsed: 30000, topupBalance: 5000 }), 't1', sub);
  assert.equal(ops.included, 25000);
  assert.equal(ops.used, 30000);
  assert.equal(ops.topupBalance, 5000);
  // included exhausted (25k used past 25k) → only the 5k top-up remains
  assert.equal(ops.remaining, 5000);
});

test('getTeamOpsUsage: exhausted plan reports 0 remaining', async () => {
  const { getTeamOpsUsage } = await import('../src/lib/plans.mjs');
  const sub = { plan_id: 'pro', status: 'active', current_period_start: '2026-05-01T00:00:00Z' };
  const ops = await getTeamOpsUsage(makeStubClient({ opsUsed: 9999, topupBalance: 0 }), 't1', sub);
  assert.equal(ops.included, 5000);
  assert.equal(ops.remaining, 0);
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

// Billing API — Stripe subscription + top-up packs.
//
//   GET  /api/billing/state          → current plan, ops usage, eligible packs
//   POST /api/billing/subscribe      → start Checkout for Pro or Scale subscription
//   POST /api/billing/purchase-pack  → start Checkout for a one-time top-up pack
//   POST /api/billing/customer-portal → open Stripe Customer Portal
//
// Self-hosted (SELF_HOSTED=true) or when STRIPE_SECRET_KEY is unset, all routes
// short-circuit to `{ billing_disabled: true }`.

import { Router } from 'express';
import Stripe from 'stripe';
import { getSupabaseClient } from '@nous/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';
import { ensureUserAndTeam } from '../../lib/auth.mjs';
import {
  PLANS,
  TOP_UP_PACKS,
  topUpPacksForPlan,
  getPlanFromSubscription,
  getTopUpPackById,
  getTeamOpsUsage,
  isSelfHosted,
} from '../../lib/plans.mjs';

export const billingRouter = Router();

function billingEnabled() {
  if (isSelfHosted()) return false;
  return process.env.BILLING_ENABLED !== 'false' && !!process.env.STRIPE_SECRET_KEY;
}

let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY missing');
  _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

function appUrl() {
  return process.env.APP_URL || process.env.VITE_APP_URL || 'http://localhost:5173';
}

async function ensureStripeCustomer(stripe, supabase, user, team) {
  if (team.stripe_customer_id) return team.stripe_customer_id;
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name || user.email?.split('@')[0] || team.name || 'Nous customer',
    metadata: { team_id: team.id },
  });
  await supabase
    .from('teams')
    .update({ stripe_customer_id: customer.id })
    .eq('id', team.id);
  return customer.id;
}

// ── GET /api/billing/state ─────────────────────────────────────────────────
billingRouter.get('/state', verifySupabaseAuth, async (req, res) => {
  if (!billingEnabled()) {
    return res.json({
      billing_disabled: true,
      self_hosted: isSelfHosted(),
      plan: 'free',
      ops: null,
      packs: [],
      purchases: [],
    });
  }
  try {
    const supabase = getSupabaseClient();
    const { team } = await ensureUserAndTeam(req.user);

    const [{ data: teamRow }, { data: subscription }, { data: purchases }] = await Promise.all([
      supabase
        .from('teams')
        .select('stripe_payment_method_id, stripe_customer_id')
        .eq('id', team.id)
        .single(),
      supabase
        .from('subscriptions')
        .select('*')
        .eq('team_id', team.id)
        .maybeSingle(),
      supabase
        .from('op_pack_purchases')
        .select('pack_id, ops_granted, amount_usd_cents, is_auto_topup, created_at')
        .eq('team_id', team.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    const plan = getPlanFromSubscription(subscription);
    const ops = await getTeamOpsUsage(supabase, team.id, subscription);

    return res.json({
      billing_disabled: false,
      plan: plan.id,
      planName: plan.name,
      subscription: subscription
        ? {
            status: subscription.status,
            current_period_start: subscription.current_period_start,
            current_period_end: subscription.current_period_end,
            cancel_at_period_end: subscription.cancel_at_period_end,
            stripe_subscription_id: subscription.stripe_subscription_id,
            is_comp: subscription.is_comp,
          }
        : null,
      ops: {
        used: ops.used,
        included: ops.included,
        topupBalance: ops.topupBalance,
        remaining: ops.remaining,
        periodStart: ops.periodStart,
      },
      hasPaymentMethod: !!teamRow?.stripe_payment_method_id,
      packs: topUpPacksForPlan(plan.id),
      allPlans: Object.values(PLANS).map((p) => ({
        id: p.id,
        name: p.name,
        monthlyPriceUsd: p.monthlyPriceUsd,
        includedOpsPerMonth: p.includedOpsPerMonth,
        workspaceLimit: p.workspaceLimit,
      })),
      purchases: purchases ?? [],
    });
  } catch (err) {
    console.error('[GET /api/billing/state]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST /api/billing/subscribe { plan: 'pro' | 'scale' } ──────────────────
billingRouter.post('/subscribe', verifySupabaseAuth, async (req, res) => {
  if (!billingEnabled()) return res.status(403).json({ error: 'billing_disabled' });
  try {
    const stripe = getStripe();
    const { plan: requestedPlanId } = req.body;
    const plan = PLANS[requestedPlanId];
    if (!plan || plan.id === 'free') {
      return res.status(400).json({ error: 'invalid_plan' });
    }
    const priceId = process.env[plan.stripePriceEnv];
    if (!priceId) return res.status(500).json({ error: 'plan_not_configured', detail: plan.stripePriceEnv });

    const { user, team } = await ensureUserAndTeam(req.user);
    const supabase = getSupabaseClient();
    const stripeCustomerId = await ensureStripeCustomer(stripe, supabase, user, team);

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { team_id: team.id, plan_id: plan.id } },
      metadata: { team_id: team.id, plan_id: plan.id, kind: 'subscription' },
      success_url: `${appUrl()}/settings?section=billing&success=true&plan=${plan.id}`,
      cancel_url: `${appUrl()}/settings?section=billing&canceled=true`,
      allow_promotion_codes: true,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('[POST /api/billing/subscribe]', err);
    return res.status(500).json({ error: 'checkout_error', detail: err.message });
  }
});

// ── POST /api/billing/purchase-pack { packId } ─────────────────────────────
billingRouter.post('/purchase-pack', verifySupabaseAuth, async (req, res) => {
  if (!billingEnabled()) return res.status(403).json({ error: 'billing_disabled' });
  try {
    const stripe = getStripe();
    const { packId } = req.body;
    const pack = getTopUpPackById(packId);
    if (!pack) return res.status(400).json({ error: 'invalid_pack_id' });

    const priceId = process.env[pack.stripePriceEnv];
    if (!priceId) return res.status(500).json({ error: 'pack_not_configured', detail: pack.stripePriceEnv });

    const { user, team } = await ensureUserAndTeam(req.user);
    const supabase = getSupabaseClient();

    // Plan eligibility — Free can't buy packs; Pro can only buy 'pro' packs;
    // Scale can buy 'scale' packs (and Scale users on lower spend can also
    // grab a Pro pack if they want — gate by `forPlan` ≤ current plan).
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('plan_id, status')
      .eq('team_id', team.id)
      .maybeSingle();
    const currentPlan = getPlanFromSubscription(subscription).id;
    if (currentPlan === 'free') return res.status(403).json({ error: 'upgrade_required' });
    if (pack.forPlan === 'scale' && currentPlan !== 'scale') {
      return res.status(403).json({ error: 'pack_requires_scale' });
    }

    const stripeCustomerId = await ensureStripeCustomer(stripe, supabase, user, team);

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      payment_intent_data: {
        setup_future_usage: 'off_session',
        metadata: { team_id: team.id, pack_id: pack.id, ops: String(pack.ops), kind: 'pack' },
      },
      metadata: { team_id: team.id, pack_id: pack.id, ops: String(pack.ops), kind: 'pack' },
      success_url: `${appUrl()}/settings?section=billing&success=true&pack=${pack.id}`,
      cancel_url: `${appUrl()}/settings?section=billing&canceled=true`,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('[POST /api/billing/purchase-pack]', err);
    return res.status(500).json({ error: 'checkout_error', detail: err.message });
  }
});

// ── POST /api/billing/customer-portal ──────────────────────────────────────
billingRouter.post('/customer-portal', verifySupabaseAuth, async (req, res) => {
  if (!billingEnabled()) return res.status(403).json({ error: 'billing_disabled' });
  try {
    const stripe = getStripe();
    const { team } = await ensureUserAndTeam(req.user);
    if (!team.stripe_customer_id) {
      return res.status(400).json({ error: 'no_stripe_customer' });
    }
    const portal = await stripe.billingPortal.sessions.create({
      customer: team.stripe_customer_id,
      return_url: `${appUrl()}/settings?section=billing`,
    });
    return res.json({ url: portal.url });
  } catch (err) {
    console.error('[POST /api/billing/customer-portal]', err);
    return res.status(500).json({ error: 'portal_error', detail: err.message });
  }
});

// ── Legacy alias kept so the existing `GET /api/billing/packs` callers don't 404
billingRouter.get('/packs', verifySupabaseAuth, async (req, res) => {
  if (!billingEnabled()) {
    return res.json({ billing_disabled: true, packs: TOP_UP_PACKS, balance: null, purchases: [] });
  }
  // Delegate to state and reshape lightly.
  try {
    const supabase = getSupabaseClient();
    const { team } = await ensureUserAndTeam(req.user);
    const { data: subscription } = await supabase
      .from('subscriptions').select('plan_id, status').eq('team_id', team.id).maybeSingle();
    const plan = getPlanFromSubscription(subscription);
    return res.json({ packs: topUpPacksForPlan(plan.id) });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

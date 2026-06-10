// Billing API — Stripe subscriptions (pure-tier model, no top-up packs).
//
//   GET  /api/billing/state           → current plan + ops/enrichment usage
//   POST /api/billing/subscribe       → start Checkout for a paid tier
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
  getPlanFromSubscription,
  getTeamOpsUsage,
  getTeamEnrichmentUsage,
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
      enrichments: null,
    });
  }
  try {
    const supabase = getSupabaseClient();
    const { team } = await ensureUserAndTeam(req.user);

    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('team_id', team.id)
      .maybeSingle();

    const plan = getPlanFromSubscription(subscription);
    const [ops, enrichments] = await Promise.all([
      getTeamOpsUsage(supabase, team.id, subscription),
      getTeamEnrichmentUsage(supabase, team.id, subscription),
    ]);

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
        remaining: ops.remaining,
        periodStart: ops.periodStart,
      },
      enrichments: {
        used: enrichments.used,
        included: enrichments.included,
        remaining: enrichments.remaining,
      },
      allPlans: Object.values(PLANS).map((p) => ({
        id: p.id,
        name: p.name,
        monthlyPriceUsd: p.monthlyPriceUsd,
        includedOpsPerMonth: p.includedOpsPerMonth,
        enrichmentsPerMonth: p.enrichmentsPerMonth,
        workspaceLimit: p.workspaceLimit,
        crmSync: p.features.crmSync,
        leadLists: p.features.leadLists,
        publicSignalExtraction: p.features.publicSignalExtraction,
        supportTier: p.features.supportTier,
      })),
    });
  } catch (err) {
    console.error('[GET /api/billing/state]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST /api/billing/subscribe ────────────────────────────────────────────
//   { plan: 'starter'|'pro'|'growth'|'scale', interval?: 'month'|'year', promotion_code?: string }
// interval:'year' is currently Pro-only (the onboarding first-year offer) and
// uses STRIPE_PRO_ANNUAL_PRICE_ID. A promotion_code, when valid, is auto-applied
// to the session (so the drip email's code lands pre-filled); otherwise we fall
// back to letting the customer type one. Team binding via subscription metadata
// is preserved either way — that's why the offer routes through our own session
// and not a standalone Payment Link.
billingRouter.post('/subscribe', verifySupabaseAuth, async (req, res) => {
  if (!billingEnabled()) return res.status(403).json({ error: 'billing_disabled' });
  try {
    const stripe = getStripe();
    const { plan: requestedPlanId, interval: requestedInterval, promotion_code: promoCode } = req.body;
    const plan = PLANS[requestedPlanId];
    if (!plan || plan.id === 'free') {
      return res.status(400).json({ error: 'invalid_plan' });
    }

    const interval = requestedInterval === 'year' ? 'year' : 'month';
    let priceId;
    if (interval === 'year') {
      if (plan.id !== 'pro') return res.status(400).json({ error: 'annual_not_available', detail: plan.id });
      // Annual billing is disabled until a correctly-priced annual Price is wired.
      // STRIPE_PRO_ANNUAL_PRICE_ID is intentionally unset; the prior $2,988/yr price
      // was 12× the old $249 Pro and is mispriced against the current $99/mo. Fail
      // cleanly (400) rather than 500; setting the env again re-enables this path.
      priceId = process.env.STRIPE_PRO_ANNUAL_PRICE_ID;
      if (!priceId) return res.status(400).json({ error: 'annual_not_available', detail: 'pro_annual_disabled' });
    } else {
      priceId = process.env[plan.stripePriceEnv];
      if (!priceId) return res.status(500).json({ error: 'plan_not_configured', detail: plan.stripePriceEnv });
    }

    const { user, team } = await ensureUserAndTeam(req.user);
    const supabase = getSupabaseClient();
    const stripeCustomerId = await ensureStripeCustomer(stripe, supabase, user, team);

    // Resolve a supplied code to its promotion-code id so we can auto-apply it.
    // discounts[] and allow_promotion_codes are mutually exclusive in Checkout,
    // so we use one or the other.
    let discounts;
    if (typeof promoCode === 'string' && promoCode.trim()) {
      try {
        const found = await stripe.promotionCodes.list({ code: promoCode.trim(), active: true, limit: 1 });
        if (found.data[0]) discounts = [{ promotion_code: found.data[0].id }];
      } catch (e) {
        console.warn('[billing/subscribe] promo lookup failed:', e.message);
      }
    }

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { team_id: team.id, plan_id: plan.id, billing_interval: interval } },
      metadata: { team_id: team.id, plan_id: plan.id, kind: 'subscription', billing_interval: interval },
      success_url: `${appUrl()}/settings?section=billing&success=true&plan=${plan.id}`,
      cancel_url: `${appUrl()}/settings?section=billing&canceled=true`,
      ...(discounts ? { discounts } : { allow_promotion_codes: true }),
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('[POST /api/billing/subscribe]', err);
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

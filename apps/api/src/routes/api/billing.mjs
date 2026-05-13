import { Router } from 'express';
import { getSupabaseClient } from '@proply/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';
import { ensureUserAndTeam } from '../../lib/auth.mjs';

export const billingRouter = Router();

const OP_PACKS = [
  { id: '5k',   ops: 5000,   accountsLimit: 100,  priceUSD: 19,  ratePerHundred: 0.38 },
  { id: '12k',  ops: 12000,  accountsLimit: 250,  priceUSD: 39,  ratePerHundred: 0.325 },
  { id: '50k',  ops: 50000,  accountsLimit: 500,  priceUSD: 99,  ratePerHundred: 0.198, popular: true },
  { id: '250k', ops: 250000, accountsLimit: 1000, priceUSD: 350, ratePerHundred: 0.14 },
];

const billingEnabled = () =>
  process.env.BILLING_ENABLED !== 'false' && !!process.env.STRIPE_SECRET_KEY;

// GET /api/billing/packs
billingRouter.get('/packs', verifySupabaseAuth, async (req, res) => {
  if (!billingEnabled()) return res.json({ billing_disabled: true, packs: [], balance: null, autoTopup: null, hasPaymentMethod: false, purchases: [] });
  try {
    const supabase = getSupabaseClient();
    const { team } = await ensureUserAndTeam(req.user);

    const { data: teamRow } = await supabase.from('teams')
      .select('ops_balance, ops_accounts_limit, ops_total_purchased, auto_topup_enabled, auto_topup_threshold, auto_topup_pack_id, stripe_payment_method_id')
      .eq('id', team.id).single();

    const { data: purchases } = await supabase.from('op_pack_purchases')
      .select('pack_id, ops_granted, amount_usd_cents, is_auto_topup, created_at')
      .eq('team_id', team.id).order('created_at', { ascending: false }).limit(10);

    const { count: opsUsed } = await supabase.from('memory_ops_log').select('id', { count: 'exact', head: true }).eq('team_id', team.id);

    const DEV_FREE_OPS = 5000;
    const totalEver = DEV_FREE_OPS + (teamRow?.ops_total_purchased ?? 0);
    const correctBalance = Math.max(0, totalEver - (opsUsed || 0));

    return res.json({
      packs: OP_PACKS,
      balance: {
        opsRemaining: correctBalance,
        accountsLimit: teamRow?.ops_accounts_limit ?? 50,
        opsTotalPurchased: teamRow?.ops_total_purchased ?? 0,
        opsUsed: opsUsed || 0,
      },
      autoTopup: {
        enabled: teamRow?.auto_topup_enabled ?? false,
        threshold: teamRow?.auto_topup_threshold ?? 1000,
        packId: teamRow?.auto_topup_pack_id ?? null,
      },
      hasPaymentMethod: !!teamRow?.stripe_payment_method_id,
      purchases: purchases || [],
    });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/billing/purchase-pack — initiate Stripe Checkout
billingRouter.post('/purchase-pack', verifySupabaseAuth, async (req, res) => {
  if (!billingEnabled()) return res.status(403).json({ error: 'billing_disabled' });
  try {
    const stripe = global._stripe;
    if (!stripe) return res.status(500).json({ error: 'stripe_not_configured' });

    const { packId } = req.body;
    const pack = OP_PACKS.find(p => p.id === packId);
    if (!pack) return res.status(400).json({ error: 'invalid_pack_id' });

    const priceId = process.env[`STRIPE_PACK_${packId.toUpperCase()}_PRICE_ID`];
    if (!priceId) return res.status(400).json({ error: 'pack_not_configured' });

    const { user, team } = await ensureUserAndTeam(req.user);
    const supabase = getSupabaseClient();

    let stripeCustomerId = team.stripe_customer_id;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({ email: user.email, name: user.name || user.email.split('@')[0], metadata: { team_id: team.id } });
      stripeCustomerId = customer.id;
      await supabase.from('teams').update({ stripe_customer_id: stripeCustomerId }).eq('id', team.id);
    }

    const APP_URL = process.env.VITE_APP_URL || process.env.APP_URL || 'http://localhost:5173';
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'payment',
      payment_intent_data: { setup_future_usage: 'off_session', metadata: { team_id: team.id, pack_id: packId, ops: String(pack.ops), accounts_limit: String(pack.accountsLimit) } },
      metadata: { team_id: team.id, pack_id: packId, ops: String(pack.ops), accounts_limit: String(pack.accountsLimit) },
      success_url: `${APP_URL}/developer?section=billing&success=true&pack=${packId}`,
      cancel_url: `${APP_URL}/developer?section=billing&canceled=true`,
    });

    return res.json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: 'checkout_error', detail: err.message });
  }
});

// POST /api/billing/auto-topup
billingRouter.post('/auto-topup', verifySupabaseAuth, async (req, res) => {
  if (!billingEnabled()) return res.status(403).json({ error: 'billing_disabled' });
  try {
    const supabase = getSupabaseClient();
    const { enabled, threshold, packId } = req.body;
    const { team } = await ensureUserAndTeam(req.user);

    if (enabled && !OP_PACKS.find(p => p.id === packId)) return res.status(400).json({ error: 'invalid_pack_id' });

    const { data: teamRow } = await supabase.from('teams').select('stripe_payment_method_id').eq('id', team.id).single();
    if (enabled && !teamRow?.stripe_payment_method_id) return res.status(400).json({ error: 'no_payment_method' });

    await supabase.from('teams').update({ auto_topup_enabled: enabled, auto_topup_threshold: threshold ?? 1000, auto_topup_pack_id: packId ?? null }).eq('id', team.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

import { Router } from 'express';
import { getSupabaseClient } from '@proply/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';
import { ensureUserAndTeam } from '../../lib/auth.mjs';

export const usageRouter = Router();

const PLAN_PROSPECT_LIMITS = { dev: 25, free: 25, trial: 25, starter: 150, build: 150, pro: 1000, professional: 1000, scale: 8000, unlimited: 8000, agencies: 8000, consultancies: 8000, enterprise: null, lifetime: 500 };
const PLAN_AI_CREDIT_LIMITS = { dev: 50, free: 50, trial: 50, starter: 300, build: 300, pro: 1500, professional: 1500, scale: 8000, unlimited: 8000, agencies: 8000, consultancies: 8000, enterprise: null, lifetime: 300 };

// GET /api/usage
usageRouter.get('/', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { user, team } = await ensureUserAndTeam(req.user);
    const { workspaceId: reqWorkspaceId } = req.query;

    const { data: subscription } = await supabase.from('subscriptions').select('*').eq('team_id', team.id).maybeSingle();
    const planName = subscription?.plan_name || 'dev';

    const { data: workspaces } = await supabase.from('workspaces').select('id').eq('team_id', team.id);
    const workspaceCount = workspaces?.length || 0;
    const workspaceId = reqWorkspaceId || workspaces?.[0]?.id;

    // Ops balance
    const { data: teamRow } = await supabase.from('teams').select('ops_balance, ops_accounts_limit, ops_total_purchased').eq('id', team.id).single();
    const opsBalance = teamRow?.ops_balance ?? 5000;
    const opsAccountsLimit = teamRow?.ops_accounts_limit ?? 50;

    // Prospect count (across all workspaces)
    let prospectCount = 0;
    if (workspaces?.length) {
      const { count } = await supabase.from('contacts').select('*', { count: 'exact', head: true }).in('workspace_id', workspaces.map(w => w.id));
      prospectCount = count || 0;
    }

    // Document + template count in current workspace
    let documentUsage = 0;
    let templateCount = 0;
    if (workspaceId) {
      const { count: dc } = await supabase.from('documents').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId);
      documentUsage = dc || 0;
      const { count: tc } = await supabase.from('templates').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId);
      templateCount = tc || 0;
    }

    const prospectLimit = PLAN_PROSPECT_LIMITS[planName] ?? 25;
    const aiCreditLimit = PLAN_AI_CREDIT_LIMITS[planName] ?? 50;

    return res.json({
      plan: planName,
      usage: {
        prospects: { current: prospectCount, limit: prospectLimit, remaining: prospectLimit !== null ? Math.max(0, prospectLimit - prospectCount) : null },
        documents: { current: documentUsage },
        templates: { current: templateCount },
        workspaces: { current: workspaceCount },
        ops: { balance: opsBalance, accounts_limit: opsAccountsLimit, total_purchased: teamRow?.ops_total_purchased ?? 0 },
        credits: { limit: aiCreditLimit },
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

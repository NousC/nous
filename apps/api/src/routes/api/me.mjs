import { Router } from 'express';
import { getSupabaseClient } from '@nous/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';
import { ensureUserAndTeam } from '../../lib/auth.mjs';
import { getCountryFromRequest } from '../../lib/geo.mjs';

export const meRouter = Router();

const userActiveWorkspace = new Map();

// GET /api/me
meRouter.get('/', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { user, team } = await ensureUserAndTeam(req.user);

    // Auto-accept pending invitation if user is not yet in team_members
    if (team) {
      const { data: existingMember } = await supabase
        .from('team_members')
        .select('id')
        .eq('team_id', team.id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!existingMember) {
        const { data: pendingInvitation } = await supabase
          .from('team_invitations')
          .select('*')
          .eq('email', user.email.toLowerCase())
          .eq('status', 'pending')
          .eq('team_id', team.id)
          .maybeSingle();

        if (pendingInvitation && new Date(pendingInvitation.expires_at) >= new Date()) {
          const memberRole = pendingInvitation.role || 'member';

          const { error: memberError } = await supabase.from('team_members').insert({
            team_id: team.id,
            user_id: user.id,
            role: memberRole,
          });

          if (!memberError) {
            const { data: allWorkspaces } = await supabase
              .from('workspaces')
              .select('id')
              .eq('team_id', team.id);

            if (allWorkspaces?.length > 0) {
              const workspaceRole = ['founder', 'owner', 'admin'].includes(memberRole)
                ? 'admin'
                : memberRole === 'member' ? 'member' : 'viewer';

              await Promise.allSettled(
                allWorkspaces.map(ws =>
                  supabase.from('workspace_members').insert({
                    workspace_id: ws.id,
                    user_id: user.id,
                    role: workspaceRole,
                  }).select().single()
                )
              );
            }

            await supabase.from('team_invitations').update({
              status: 'accepted',
              accepted_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }).eq('id', pendingInvitation.id);

            if (!user.onboarding_completed_at) {
              await supabase.from('users').update({
                onboarding_completed_at: new Date().toISOString(),
              }).eq('id', user.id);
            }
          }
        }
      }
    }

    // Is founder?
    let isFounder = false;
    if (team) {
      const { data: membership } = await supabase
        .from('team_members')
        .select('role')
        .eq('team_id', team.id)
        .eq('user_id', user.id)
        .eq('role', 'founder')
        .maybeSingle();
      isFounder = !!membership;
    }

    // Get user's workspaces
    const { data: memberships, error: membershipsError } = await supabase
      .from('workspace_members')
      .select('workspace_id, workspaces:workspace_id(*)')
      .eq('user_id', user.id);

    let workspace = null;
    const workspaceId = req.query.workspace_id;

    if (!membershipsError && memberships?.length > 0) {
      if (workspaceId) {
        const selected = memberships.find(m => String(m.workspaces?.id) === String(workspaceId));
        workspace = selected?.workspaces || memberships[0].workspaces;
      } else {
        workspace = memberships[0].workspaces;
      }
      if (workspace?.id) userActiveWorkspace.set(user.id, workspace.id);

      // Lazy country backfill — first authenticated /me call after the
      // 2026_05_26_workspace_country migration populates the field for
      // existing workspaces, and captures it for new signups. Fully
      // non-blocking: failures are swallowed.
      if (workspace?.id && !workspace.country) {
        const country = getCountryFromRequest(req);
        if (country) {
          supabase
            .from('workspaces')
            .update({ country })
            .eq('id', workspace.id)
            .then(() => { workspace.country = country; })
            .catch(() => { /* silent — column may not exist yet */ });
        }
      }
    }

    const onboardingCompleted = isFounder ? !!user.account_setup_completed_at : true;

    // Trial status
    let trialActive = false;
    let trialEndsAt = null;
    if (team) {
      const { data: subscription } = await supabase
        .from('subscriptions')
        .select('status, trial_ends_at')
        .eq('team_id', team.id)
        .maybeSingle();

      if (subscription?.status === 'trial' && subscription?.trial_ends_at) {
        const endsAt = new Date(subscription.trial_ends_at);
        trialActive = endsAt > new Date();
        trialEndsAt = subscription.trial_ends_at;
      }
    }

    return res.json({
      user,
      team,
      workspace,
      onboarding_completed: onboardingCompleted,
      is_founder: isFounder,
      trial: {
        is_active: trialActive,
        ends_at: trialEndsAt,
      },
      billing_enabled: process.env.BILLING_ENABLED !== 'false' && !!process.env.STRIPE_SECRET_KEY,
      plan_enforcement: process.env.PLAN_ENFORCEMENT !== 'false',
      self_hosted: process.env.SELF_HOSTED === 'true',
    });
  } catch (err) {
    console.error('[ME_ROUTE_ERROR]', err);
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message || err) }) });
  }
});

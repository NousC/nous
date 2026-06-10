import { Router } from 'express';
import { getSupabaseClient } from '@nous/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';
import { ensureUserAndTeam } from '../../lib/auth.mjs';
import { sendWelcomeEmail } from '../../lib/welcomeEmail.mjs';
import { upsertNousPerson, logNousObservation } from '../../lib/dogfood.mjs';

export const onboardingRouter = Router();

// GET /api/onboarding/status — drives the gated "Connect your agent" screen.
// onboarded = the agent has set the workspace profile (business_type present);
// connected = a workspace API key has actually been used (the MCP has called in).
onboardingRouter.get('/status', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    let workspaceId = req.workspaceId || null;
    if (!workspaceId) {
      const { user, team } = await ensureUserAndTeam(req.user);
      const { data: wms } = await supabase
        .from('workspace_members')
        .select('workspace_id, workspaces:workspace_id(id, team_id)')
        .eq('user_id', user.id);
      const match = (wms || []).find(m => m.workspaces?.team_id === team.id);
      workspaceId = match?.workspace_id || null;
    }
    if (!workspaceId) return res.json({ connected: false, onboarded: false });

    const [{ data: ws }, { data: keys }] = await Promise.all([
      supabase.from('workspaces').select('business_type').eq('id', workspaceId).maybeSingle(),
      supabase.from('api_keys').select('last_used_at').eq('workspace_id', workspaceId).is('revoked_at', null),
    ]);
    const onboarded = !!ws?.business_type;
    const connected = (keys || []).some(k => k.last_used_at);
    return res.json({ connected, onboarded });
  } catch (err) {
    console.error('[GET /api/onboarding/status]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/onboarding/complete
onboardingRouter.post('/complete', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { name, company_name, website, icp_description } = req.body;
    const { user, team } = await ensureUserAndTeam(req.user);

    const { data: wms } = await supabase.from('workspace_members').select('workspace_id, workspaces:workspace_id(*)').eq('user_id', user.id);
    const match = wms?.find(m => m.workspaces?.team_id === team.id);
    let workspace = match?.workspaces || null;

    const isFirstCompletion = !user.onboarding_completed_at;
    if (isFirstCompletion) {
      await supabase.from('users').update({ onboarding_completed_at: new Date().toISOString() }).eq('id', user.id);
    }

    // Guarantee the team has a Free subscription. ensureUserAndTeam creates one
    // on first auth; this is the belt-and-suspenders if that ever missed.
    // ignoreDuplicates leaves an existing (potentially paid) row untouched.
    if (isFirstCompletion) {
      try {
        await supabase.from('subscriptions').upsert({
          team_id: team.id,
          plan_id: 'free',
          plan_name: 'free',
          status: 'active',
          current_period_start: new Date().toISOString(),
        }, { onConflict: 'team_id', ignoreDuplicates: true });
      } catch (e) {
        console.warn('[onboarding/complete] free-plan upsert:', e?.message || e);
      }
    }

    // Welcome email + dogfood the public API — only on first completion,
    // fire-and-forget so onboarding never blocks on external services.
    if (isFirstCompletion) {
      const fullName = (typeof name === 'string' && name.trim()) || user.name || '';
      const [firstName, ...rest] = fullName.split(/\s+/);
      const lastName = rest.join(' ') || null;
      const recipientEmail = user.email || null;
      const finalCompany = (typeof company_name === 'string' && company_name.trim()) || workspace?.name || null;
      const signupStage = workspace?.default_signup_stage
        || (workspace?.business_type === 'service' ? 'Lead' : 'Free User');

      (async () => {
        // 1. Welcome email (idempotent — only send once per user)
        if (recipientEmail && !user.welcome_email_sent_at) {
          const result = await sendWelcomeEmail({ to: recipientEmail, firstName });
          if (result.sent) {
            await supabase.from('users')
              .update({ welcome_email_sent_at: new Date().toISOString() })
              .eq('id', user.id)
              .then(({ error }) => {
                if (error) console.error('[WELCOME_EMAIL] failed to set sent_at:', error.message);
              });
            await logNousObservation(recipientEmail, [
              { kind: 'event', property: 'interaction.welcome_email_sent',
                value: { at: new Date().toISOString() } },
            ]);
          }
        }

        // 2. Upsert this new user as a person in our own Nous workspace
        if (recipientEmail) {
          await upsertNousPerson({
            email: recipientEmail,
            first_name: firstName || null,
            last_name: lastName,
            company: finalCompany,
            stage: signupStage,
          });

          // 3. Log signup on their timeline. Also write state.pipeline_stage
          // so the contact detail view's Pipeline Stage field flips off the
          // default 'identified' onto whatever the founder named their
          // signup stage in onboarding.
          await logNousObservation(recipientEmail, [
            { kind: 'event', property: 'interaction.signed_up',
              value: {
                source: 'app.opennous.cloud',
                plan: 'free',
                business_type: workspace?.business_type || null,
                website: (typeof website === 'string' && website.trim()) || null,
                icp_description: (typeof icp_description === 'string' && icp_description.trim()) || null,
                at: new Date().toISOString(),
              } },
            { kind: 'state', property: 'stage', value: signupStage },
            { kind: 'state', property: 'pipeline_stage', value: signupStage },
            ...(finalCompany ? [{ kind: 'state', property: 'company', value: finalCompany }] : []),
          ]);
        }
      })().catch(err => console.error('[onboarding/complete] side effects error:', err.message));
    }

    return res.json({ success: true, workspace });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

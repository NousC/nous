import { Router } from 'express';
import { getSupabaseClient, saveNote, listNotes } from '@nous/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';
import { ensureUserAndTeam } from '../../lib/auth.mjs';
import { sendWelcomeEmail } from '../../lib/welcomeEmail.mjs';
import { upsertNousPerson, logNousObservation } from '../../lib/dogfood.mjs';

export const onboardingRouter = Router();

// POST /api/onboarding/step-1 — save company name + website to workspace
onboardingRouter.post('/step-1', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { user, team } = await ensureUserAndTeam(req.user);
    const { name, company_name, website, icp_description } = req.body;

    // Find the user's workspace for this team (same pattern as /complete)
    const { data: wms } = await supabase
      .from('workspace_members')
      .select('workspace_id, workspaces:workspace_id(id, team_id)')
      .eq('user_id', user.id);
    const match = (wms || []).find(m => m.workspaces?.team_id === team.id);
    const workspaceId = match?.workspace_id || null;

    if (name?.trim()) {
      try {
        await supabase.from('users')
          .update({ name: name.trim() })
          .eq('id', user.id);
      } catch { /* best-effort */ }
    }

    if (workspaceId && (company_name?.trim() || website?.trim())) {
      // Mirror the structured fields on workspaces so Settings → Team can read
      // them back. The Company note + ICP note below stay as the canonical
      // sources for the Scorecard auto-build downstream.
      const updates = {};
      if (company_name?.trim()) updates.name = company_name.trim();
      if (website?.trim()) updates.website = website.trim();
      await supabase.from('workspaces').update(updates).eq('id', workspaceId);
    }

    if (workspaceId) {
      if (website?.trim()) {
        try {
          await saveNote(supabase, workspaceId, {
            category: 'Company',
            content: `Company website: ${website.trim()}`,
            source: 'onboarding',
          });
        } catch { /* best-effort */ }
      }
      // 'ICP' category seeds the Scorecard auto-build on the Intelligence page.
      if (icp_description?.trim()) {
        try {
          await saveNote(supabase, workspaceId, {
            category: 'ICP',
            content: icp_description.trim(),
            source: 'onboarding',
          });
        } catch { /* best-effort */ }
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/onboarding/step-1]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/onboarding/business-type — service vs software + plan model + signup-stage label.
// Persisted on the workspace so the CRM picks the right buyer terminology (Client vs
// Customer) and the right default label for brand-new signups (Free User, Trial, Lead, ...).
onboardingRouter.post('/business-type', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { user, team } = await ensureUserAndTeam(req.user);
    const { business_type, plan_model, default_signup_stage } = req.body || {};

    if (business_type !== 'service' && business_type !== 'software') {
      return res.status(400).json({ error: 'business_type must be "service" or "software"' });
    }
    if (business_type === 'software' && plan_model && !['free_plan','free_trial','both','paid_only'].includes(plan_model)) {
      return res.status(400).json({ error: 'invalid plan_model' });
    }

    const stageLabel = (default_signup_stage || '').toString().trim()
      || (business_type === 'service' ? 'Lead' : 'Free User');

    const { data: wms } = await supabase
      .from('workspace_members')
      .select('workspace_id, workspaces:workspace_id(id, team_id)')
      .eq('user_id', user.id);
    const match = (wms || []).find(m => m.workspaces?.team_id === team.id);
    const workspaceId = match?.workspace_id || null;
    if (!workspaceId) return res.status(404).json({ error: 'no_workspace_for_team' });

    const { data: updated, error } = await supabase
      .from('workspaces')
      .update({
        business_type,
        plan_model: business_type === 'software' ? (plan_model || null) : null,
        default_signup_stage: stageLabel,
      })
      .eq('id', workspaceId)
      .select('id, business_type, plan_model, default_signup_stage')
      .single();

    if (error) {
      console.error('[POST /api/onboarding/business-type] update failed:', error);
      return res.status(500).json({ error: 'internal_error' });
    }

    return res.json({ workspace: updated });
  } catch (err) {
    console.error('[POST /api/onboarding/business-type]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/onboarding/checklist?workspaceId=... — 5-item post-onboarding progress.
// Prefers req.workspaceId (set by middleware from query), falls back to the
// user's first workspace via workspace_members. The query param is what the
// frontend actually sends, so it stays accurate when a user has many workspaces.
onboardingRouter.get('/checklist', verifySupabaseAuth, async (req, res) => {
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
    if (!workspaceId) {
      return res.json({ steps: [], completed_count: 0, total: 5, workspaceId: null });
    }

    const safe = async (fn) => { try { return await fn(); } catch (e) { return { error: String(e?.message || e) }; } };

    // Fetch api_keys once and filter in JS — more reliable than .is()/.not() chains.
    const [icpNotes, scorecardSignals, contacts, apiKeys, webhooks] = await Promise.all([
      safe(() => listNotes(supabase, workspaceId, { categories: ['ICP'] })),
      safe(async () => {
        const { data } = await supabase
          .from('scorecard_signals')
          .select('id')
          .eq('workspace_id', workspaceId)
          .limit(1);
        return data ?? [];
      }),
      safe(async () => {
        const { count } = await supabase
          .from('contacts')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId);
        return count ?? 0;
      }),
      safe(async () => {
        const { data } = await supabase
          .from('api_keys')
          .select('id, revoked_at, last_used_at')
          .eq('workspace_id', workspaceId);
        return data ?? [];
      }),
      safe(async () => {
        const { count } = await supabase
          .from('workspace_webhook_subscriptions')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId);
        return count ?? 0;
      }),
    ]);

    const icpCount       = Array.isArray(icpNotes)        ? icpNotes.length : 0;
    const signalCount    = Array.isArray(scorecardSignals) ? scorecardSignals.length : 0;
    const contactCount   = typeof contacts === 'number'   ? contacts : 0;
    const apiKeyRows     = Array.isArray(apiKeys)         ? apiKeys : [];
    const activeKeyCount = apiKeyRows.filter(k => !k.revoked_at).length;
    const usedKeyCount   = apiKeyRows.filter(k => !!k.last_used_at).length;
    const webhookCount   = typeof webhooks === 'number'   ? webhooks : 0;

    // ICP done = either workspace has an ICP-category memory OR a Scorecard exists.
    const icpDone = icpCount > 0 || signalCount > 0;

    const steps = [
      { id: 'icp',      label: 'Describe your ICP',  completed: icpDone,                href: '/intelligence' },
      { id: 'contacts', label: 'Bring contacts in',  completed: contactCount > 0,       href: '/people' },
      { id: 'api_key',  label: 'Create an API key',  completed: activeKeyCount > 0,     href: '/keys' },
      { id: 'install',  label: 'Install Nous',       completed: usedKeyCount > 0,       href: '/install' },
      { id: 'webhooks', label: 'Set up 3 webhooks',  completed: webhookCount >= 3,      href: '/webhooks' },
    ];

    const debug = process.env.NODE_ENV !== 'production' ? {
      workspaceId,
      counts: { icpCount, signalCount, contactCount, activeKeyCount, usedKeyCount, webhookCount },
      errors: {
        icp:       icpNotes?.error ?? null,
        scorecard: scorecardSignals?.error ?? null,
        contacts:  typeof contacts !== 'number' ? contacts?.error ?? null : null,
        apiKeys:   !Array.isArray(apiKeys) ? apiKeys?.error ?? null : null,
        webhooks:  typeof webhooks !== 'number' ? webhooks?.error ?? null : null,
      },
    } : undefined;

    return res.json({
      steps,
      completed_count: steps.filter(s => s.completed).length,
      total: steps.length,
      ...(debug ? { debug } : {}),
    });
  } catch (err) {
    console.error('[GET /api/onboarding/checklist]', err);
    return res.status(500).json({ error: 'internal_error', detail: String(err?.message || err) });
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

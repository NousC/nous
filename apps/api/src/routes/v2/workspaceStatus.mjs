import { Router } from 'express';
import {
  getSupabaseClient,
  listNotes,
  saveNote,
  listTriggers,
  countHygieneProposals,
} from '@nous/core';

// ── Workspace status + onboarding — the agent's setup surface ──────────────────
//
// Nous is built for the agent to operate, not the human to click. Two routes:
//
//   GET  /v2/workspace/status      — the "one main call". Returns the whole
//                                    state of the workspace in one shot: is it
//                                    onboarded, is the GTM playbook built, which
//                                    integrations are connected, is CRM sync
//                                    configured, are webhooks/triggers live —
//                                    plus a ranked next_steps list so the agent
//                                    knows what to set up next without being asked.
//
//   POST /v2/workspace/onboarding  — agent-driven onboarding. The agent collects
//                                    the basics from the user (name, website,
//                                    business type, a sentence on their ICP) and
//                                    writes them here, instead of the human
//                                    clicking through a wizard in the app.
//
// Both are API-key auth (verifyApiKey sets req.workspaceId) and logged to the
// Ops page via logV2Op, so every agent setup action is visible to the human.

export const workspaceStatusV2Router = Router();

const DAY = 86400000;
const ageDays = (ts) => (ts ? Math.floor((Date.now() - new Date(ts).getTime()) / DAY) : null);
const safe = async (fn, fallback = null) => { try { return await fn(); } catch { return fallback; } };

// ── GET /v2/workspace/status ───────────────────────────────────────────────────
workspaceStatusV2Router.get('/status', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.workspaceId;

    const [workspace, notes, signalCount, connections, crmConfigs, hygieneOpen, webhookCount, triggers] =
      await Promise.all([
        safe(async () => {
          const { data } = await supabase
            .from('workspaces')
            .select('id, name, website, business_type, plan_model, default_signup_stage')
            .eq('id', workspaceId)
            .maybeSingle();
          return data || null;
        }),
        safe(() => listNotes(supabase, workspaceId, {}), []),
        safe(async () => {
          const { count } = await supabase
            .from('scorecard_signals')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspaceId);
          return count ?? 0;
        }, 0),
        safe(async () => {
          const { data } = await supabase
            .from('workflow_provider_connections')
            .select('id, name, is_verified, last_used_at, provider:workflow_providers(display_name, category)')
            .eq('workspace_id', workspaceId);
          return data ?? [];
        }, []),
        safe(async () => {
          const { data } = await supabase
            .from('crm_sync_configs')
            .select('provider, auto_sync, push_activities, hygiene_enabled, hygiene_cadence, updated_at')
            .eq('workspace_id', workspaceId);
          return data ?? [];
        }, []),
        safe(() => countHygieneProposals(supabase, workspaceId, 'proposed'), 0),
        safe(async () => {
          const { count } = await supabase
            .from('workspace_webhook_subscriptions')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspaceId);
          return count ?? 0;
        }, 0),
        safe(() => listTriggers(supabase, workspaceId), []),
      ]);

    // ── Onboarding: the workspace's basic identity ──
    const profileMissing = [];
    if (!workspace?.name)          profileMissing.push('name');
    if (!workspace?.website)       profileMissing.push('website');
    if (!workspace?.business_type) profileMissing.push('business_type');
    const onboardingDone = !!(workspace?.website && workspace?.business_type);

    // ── GTM playbook ──
    const playbookFacts = (notes || []).filter((n) => n.source === 'playbook');
    const icpNotes      = (notes || []).filter((n) => n.category === 'ICP');
    const hasModel      = signalCount > 0;
    const playbookDone  = playbookFacts.length > 0 || hasModel;
    const staleFacts    = playbookFacts.filter((n) => {
      const a = ageDays(n.reaffirmed_at || n.created_at);
      return a != null && a >= 90;
    }).length;

    // ── Integrations (verified connections), with CRM + enrichment derived ──
    const verified = (connections || []).filter((c) => c.is_verified === true);
    const connectedList = verified.map((c) => ({
      name: c.provider?.display_name || c.name,
      category: c.provider?.category || null,
      last_used_at: c.last_used_at || null,
    }));
    const enrichment = verified.find((c) => c.provider?.category === 'enrichment') || null;

    // ── CRM sync ──
    const crmSyncConfigured = (crmConfigs || []).length > 0;
    const crmProviders = (crmConfigs || []).map((c) => ({
      provider: c.provider,
      auto_sync: !!c.auto_sync,
      hygiene_enabled: !!c.hygiene_enabled,
      hygiene_cadence: c.hygiene_cadence || null,
    }));

    const triggerCount = Array.isArray(triggers) ? triggers.length : 0;

    // ── Ranked next steps — what the agent should set up next ──
    const next_steps = [];
    if (!onboardingDone) {
      next_steps.push({
        id: 'onboarding',
        title: 'Finish onboarding',
        why: `Missing: ${profileMissing.join(', ')}. The whole context layer is built on the workspace knowing who you are and who you sell to.`,
        how: 'Ask the user for their company name, website, whether they sell a service or software, and a sentence on their ideal customer — then call set_workspace_profile.',
      });
    } else if (!playbookDone) {
      next_steps.push({
        id: 'gtm_playbook',
        title: 'Build the GTM playbook',
        why: 'No ICP scoring model exists yet, so accounts cannot be scored for fit. This is what makes Nous score and prioritise.',
        how: 'Work through the GTM context with the user (what they sell, who, the problems, pricing, competitors) and record it with update_gtm_profile.',
      });
    }
    if (verified.length === 0) {
      next_steps.push({
        id: 'integrations',
        title: 'Connect a data source',
        why: 'No integrations are connected, so no activity is flowing in. The account record stays empty without a source (Gmail, a CRM, an enrichment provider).',
        how: 'Tell the user which sources you can connect; key-based ones you can set up directly, OAuth ones need one authorize click from them.',
      });
    }
    if (onboardingDone && !crmSyncConfigured) {
      next_steps.push({
        id: 'crm_sync',
        title: 'Set up CRM sync',
        why: 'No CRM sync is configured, so the account record is not kept in step with the system of record.',
        how: 'Confirm which CRM and the create/hygiene policy with the user, then configure it.',
      });
    }
    if (webhookCount === 0 && triggerCount === 0) {
      next_steps.push({
        id: 'events',
        title: 'Set up event triggers',
        why: 'No webhooks or triggers are live, so downstream tools are not notified when the record changes.',
        how: 'Set up the triggers the user needs for their stack.',
      });
    }
    if (hygieneOpen > 0) {
      next_steps.push({
        id: 'hygiene_review',
        title: `${hygieneOpen} hygiene proposal${hygieneOpen === 1 ? '' : 's'} awaiting review`,
        why: 'Hygiene proposals are human accept/deny decisions — surface them so they do not pile up.',
        how: 'Point the user to the CRM Sync page to accept or dismiss them.',
      });
    }

    return res.json({
      workspace: workspace
        ? {
            id: workspace.id,
            name: workspace.name || null,
            website: workspace.website || null,
            business_type: workspace.business_type || null,
            plan_model: workspace.plan_model || null,
            default_signup_stage: workspace.default_signup_stage || null,
          }
        : { id: workspaceId },
      setup: {
        onboarding: { done: onboardingDone, missing: profileMissing },
        gtm_playbook: {
          done: playbookDone,
          facts: playbookFacts.length,
          icp_facts: icpNotes.length,
          model: hasModel,
          stale_facts: staleFacts,
        },
        integrations: { count: verified.length, connected: connectedList },
        crm_sync: {
          configured: crmSyncConfigured,
          providers: crmProviders,
          pending_hygiene_proposals: hygieneOpen,
        },
        enrichment: { connected: !!enrichment, provider: enrichment?.provider?.display_name || null },
        webhooks: { count: webhookCount },
        triggers: { count: triggerCount },
      },
      next_steps,
    });
  } catch (err) {
    console.error('[GET /v2/workspace/status]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST /v2/workspace/onboarding ────────────────────────────────────────────
// Agent-driven onboarding: write the workspace's basic identity. Mirrors what
// the app's onboarding wizard used to collect (step-1 + business-type), but the
// agent does it for the user.
workspaceStatusV2Router.post('/onboarding', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.workspaceId;
    const { name, website, business_type, plan_model, default_signup_stage, icp } = req.body || {};

    if (business_type != null && business_type !== 'service' && business_type !== 'software') {
      return res.status(400).json({ error: 'business_type must be "service" or "software"' });
    }
    if (business_type === 'software' && plan_model &&
        !['free_plan', 'free_trial', 'both', 'paid_only'].includes(plan_model)) {
      return res.status(400).json({ error: 'invalid plan_model' });
    }

    // Update the structured fields on the workspace (only what was sent).
    const updates = {};
    if (typeof name === 'string' && name.trim())       updates.name = name.trim();
    if (typeof website === 'string' && website.trim()) updates.website = website.trim();
    if (business_type) {
      updates.business_type = business_type;
      updates.plan_model = business_type === 'software' ? (plan_model || null) : null;
      updates.default_signup_stage =
        (default_signup_stage || '').toString().trim()
        || (business_type === 'service' ? 'Lead' : 'Free User');
    } else if (default_signup_stage) {
      updates.default_signup_stage = String(default_signup_stage).trim();
    }

    if (Object.keys(updates).length) {
      const { error } = await supabase.from('workspaces').update(updates).eq('id', workspaceId);
      if (error) throw error;
    }

    // Mirror the website + ICP as memory facts (the canonical sources the
    // Scorecard auto-build reads), matching the old onboarding wizard.
    if (typeof website === 'string' && website.trim()) {
      await safe(() => saveNote(supabase, workspaceId, {
        category: 'Company',
        content: `Company website: ${website.trim()}`,
        source: 'onboarding',
      }));
    }
    if (typeof icp === 'string' && icp.trim()) {
      await safe(() => saveNote(supabase, workspaceId, {
        category: 'ICP',
        content: icp.trim(),
        source: 'onboarding',
      }));
    }

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, name, website, business_type, plan_model, default_signup_stage')
      .eq('id', workspaceId)
      .maybeSingle();

    return res.json({ ok: true, workspace: workspace || { id: workspaceId } });
  } catch (err) {
    console.error('[POST /v2/workspace/onboarding]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

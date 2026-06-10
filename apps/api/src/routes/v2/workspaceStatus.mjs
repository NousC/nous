import { Router } from 'express';
import {
  getSupabaseClient,
  listNotes,
  saveNote,
  listTriggers,
  createTrigger,
  TRIGGER_EVENTS,
  countHygieneProposals,
} from '@nous/core';
import { seedScorecardFromMemory } from '../../lib/scorecardSeed.mjs';
import { requireFeature, resolveTeamAndPlan, hasFeature, isSelfHosted } from '../../lib/access.mjs';
import { testProviderCredentials, encryptCredentials } from '../api/workflowProviders.mjs';

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

    // ── Plan + feature availability (so the agent doesn't push paid features) ──
    const plan = await safe(async () => (await resolveTeamAndPlan(req)).plan, null);
    const crmSyncAvailable  = !isSelfHosted() && !!plan && hasFeature(plan.id, 'crmSync');
    const leadListsAvailable = !isSelfHosted() && !!plan && hasFeature(plan.id, 'leadLists');

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
    if (onboardingDone && crmSyncAvailable && !crmSyncConfigured) {
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
      plan: {
        id: plan?.id || 'free',
        name: plan?.name || plan?.id || 'free',
        crm_sync: crmSyncAvailable,
        lead_lists: leadListsAvailable,
      },
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
          available: crmSyncAvailable,
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

// ── POST /v2/workspace/scoring-model ─────────────────────────────────────────
// Agent-callable: build (or rebuild) the ICP scoring model from the GTM context
// the workspace has recorded. This is the second half of building the GTM
// playbook — the agent records the context with update_gtm_profile, then calls
// this to turn it into a weighted scoring model. Pass force:true to rebuild over
// an existing model. Shares its implementation with the human web route.
workspaceStatusV2Router.post('/scoring-model', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const force = req.body?.force === true;
    const r = await seedScorecardFromMemory(supabase, req.workspaceId, { force });

    if (r.status === 'exists') {
      return res.status(409).json({
        error: 'model_exists',
        message: 'A scoring model already exists. Pass force:true to rebuild it.',
        signals: r.signals,
      });
    }
    if (r.status === 'no_icp_memory') {
      return res.status(400).json({
        error: 'no_gtm_context',
        message: 'No GTM context recorded yet. Record the ICP and how they sell with update_gtm_profile, then build the model.',
      });
    }
    if (r.status === 'translation_failed') {
      return res.status(502).json({ error: 'translation_failed', message: 'Could not build a model from the current context.' });
    }
    return res.status(201).json({ ok: true, signals: r.signals });
  } catch (err) {
    console.error('[POST /v2/workspace/scoring-model]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST /v2/workspace/integrations ──────────────────────────────────────────
// Agent-callable: connect a KEY-BASED integration (Apollo, Prospeo, Instantly,
// HubSpot, …) by supplying credentials. OAuth providers can't be done this way
// (they need a browser) — the agent is told to send the user to Integrations.
// Mirrors the web connect route: tests the credentials, then stores them
// encrypted exactly the same way.
workspaceStatusV2Router.post('/integrations', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { provider, credentials, name } = req.body || {};
    if (!provider || !credentials || typeof credentials !== 'object') {
      return res.status(400).json({ error: 'provider_and_credentials_required' });
    }

    const { data: prov } = await supabase
      .from('workflow_providers')
      .select('id, name, display_name, auth_type, category')
      .eq('name', String(provider).toLowerCase())
      .eq('is_active', true)
      .maybeSingle();
    if (!prov) return res.status(404).json({ error: 'unknown_provider', message: `No provider named "${provider}".` });

    if ((prov.auth_type || '').toLowerCase() === 'oauth') {
      return res.status(400).json({
        error: 'oauth_provider',
        message: `${prov.display_name} uses a browser sign-in. Send the user to the Integrations page to connect it — key-based connect isn't possible here.`,
      });
    }

    const test = await testProviderCredentials(prov.name, credentials);
    if (!test.verified) {
      return res.status(400).json({ error: 'invalid_credentials', message: test.message || 'Credentials did not verify.' });
    }

    // created_by is NOT NULL. API-key auth has no user, so attribute the
    // connection to a workspace member (prefer the owner).
    const { data: members } = await supabase
      .from('workspace_members').select('user_id, role').eq('workspace_id', req.workspaceId);
    const createdBy = (members || []).find(m => m.role === 'owner')?.user_id || members?.[0]?.user_id;
    if (!createdBy) return res.status(400).json({ error: 'no_workspace_member' });

    const { data: conn, error } = await supabase
      .from('workflow_provider_connections')
      .upsert({
        workspace_id: req.workspaceId,
        provider_id: prov.id,
        name: name || prov.display_name || 'Connection',
        encrypted_credentials: encryptCredentials(credentials),
        created_by: createdBy,
        is_verified: true,
        last_test_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id,provider_id,name' })
      .select('id, provider_id, name, is_verified')
      .single();
    if (error) throw error;

    return res.status(201).json({ ok: true, connection: { ...conn, provider: prov.name }, message: test.message });
  } catch (err) {
    console.error('[POST /v2/workspace/integrations]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST /v2/workspace/crm-sync ──────────────────────────────────────────────
// Agent-callable: configure CRM sync rules — the same options as the CRM Sync
// setup form. The CRM must already be connected (OAuth connect stays a human
// step). Cloud-only Pro+ feature, gated like the web route.
const CREATE_TRIGGERS = ['any_reply_or_meeting', 'positive_reply_or_meeting', 'meeting_only', 'interested_stage'];
const HYGIENE_CADENCES = ['weekly', 'monthly'];
workspaceStatusV2Router.post('/crm-sync', requireFeature('crmSync'), async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.workspaceId;
    const { provider, autoSync, pushActivities, createInCrm, createTrigger: createTrig,
            createRequireIcpFit, createIcpThreshold, hygieneEnabled, hygieneCadence } = req.body || {};
    if (!provider) return res.status(400).json({ error: 'provider_required' });

    // Resolve the connected CRM for this provider.
    const { data: conns } = await supabase
      .from('workflow_provider_connections')
      .select('id, provider:workflow_providers(name)')
      .eq('workspace_id', workspaceId);
    const match = (conns || []).find(c => c.provider?.name === String(provider).toLowerCase());
    if (!match) {
      return res.status(400).json({ error: 'crm_not_connected', message: `${provider} isn't connected. Connect it on the Integrations page first.` });
    }

    const { data: existing } = await supabase.from('crm_sync_configs')
      .select('auto_sync, push_activities, create_in_crm, create_trigger, create_require_icp_fit, create_icp_threshold, hygiene_enabled, hygiene_cadence')
      .eq('workspace_id', workspaceId).eq('provider', String(provider).toLowerCase()).maybeSingle();

    const payload = {
      workspace_id: workspaceId,
      connection_id: match.id,
      provider: String(provider).toLowerCase(),
      auto_sync:       typeof autoSync       === 'boolean' ? autoSync       : (existing?.auto_sync       ?? false),
      push_activities: typeof pushActivities === 'boolean' ? pushActivities : (existing?.push_activities ?? true),
      create_in_crm:          typeof createInCrm         === 'boolean' ? createInCrm         : (existing?.create_in_crm          ?? true),
      create_trigger:         CREATE_TRIGGERS.includes(createTrig)     ? createTrig         : (existing?.create_trigger          ?? 'positive_reply_or_meeting'),
      create_require_icp_fit: typeof createRequireIcpFit === 'boolean' ? createRequireIcpFit : (existing?.create_require_icp_fit ?? true),
      create_icp_threshold:   Number.isFinite(createIcpThreshold)      ? Math.max(0, Math.min(100, Math.round(createIcpThreshold))) : (existing?.create_icp_threshold ?? 70),
      hygiene_enabled: typeof hygieneEnabled === 'boolean' ? hygieneEnabled : (existing?.hygiene_enabled ?? true),
      hygiene_cadence: HYGIENE_CADENCES.includes(hygieneCadence)       ? hygieneCadence     : (existing?.hygiene_cadence ?? 'weekly'),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from('crm_sync_configs')
      .upsert(payload, { onConflict: 'workspace_id,provider' }).select().single();
    if (error) throw error;
    return res.json({ ok: true, config: data });
  } catch (err) {
    console.error('[POST /v2/workspace/crm-sync]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── GET/POST /v2/workspace/triggers ──────────────────────────────────────────
// Agent-callable: list or create outbound event triggers (webhooks). The agent
// wires the user's stack to fire on record changes.
workspaceStatusV2Router.get('/triggers', async (req, res) => {
  try {
    const triggers = await listTriggers(getSupabaseClient(), req.workspaceId);
    return res.json({ triggers, available_events: TRIGGER_EVENTS });
  } catch (err) {
    console.error('[GET /v2/workspace/triggers]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});
workspaceStatusV2Router.post('/triggers', async (req, res) => {
  try {
    const { name, url, events } = req.body || {};
    if (!url || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'url_and_events_required', available_events: TRIGGER_EVENTS });
    }
    const trigger = await createTrigger(getSupabaseClient(), req.workspaceId, { name, url, events });
    return res.status(201).json({ ok: true, trigger });
  } catch (err) {
    if (err?.message) return res.status(400).json({ error: err.message, available_events: TRIGGER_EVENTS });
    console.error('[POST /v2/workspace/triggers]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

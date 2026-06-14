import { Router } from 'express';
import {
  getSupabaseClient,
  listNotes,
  saveNote,
  listTriggers,
  createTrigger,
  TRIGGER_EVENTS,
  countHygieneProposals,
  syncCrmProvider,
} from '@nous/core';
import { seedScorecardFromMemory } from '../../lib/scorecardSeed.mjs';
import { requireFeature, resolveTeamAndPlan, hasFeature, isSelfHosted } from '../../lib/access.mjs';
import { testProviderCredentials, encryptCredentials } from '../api/workflowProviders.mjs';
import { resolveCrmTokenForProvider } from '../api/crm.mjs';
import { runClosedDeals } from '../api/mind.mjs';

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

    const [workspace, notes, signalCount, connections, crmConfigs, hygieneOpen, webhookCount, triggers, linkedinRows, contactCount] =
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
            .select('id, name, is_verified, last_used_at, provider:workflow_providers(name, display_name, category)')
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
        safe(async () => {
          const { data } = await supabase
            .from('workspace_linkedin_connections')
            .select('id').eq('workspace_id', workspaceId).limit(1);
          return data ?? [];
        }, []),
        safe(async () => {
          const { count } = await supabase
            .from('contacts')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspaceId);
          return count ?? 0;
        }, 0),
      ]);

    // ── Plan + feature availability (so the agent doesn't push paid features) ──
    const plan = await safe(async () => (await resolveTeamAndPlan(req)).plan, null);
    const crmSyncAvailable  = !isSelfHosted() && !!plan && hasFeature(plan.id, 'crmSync');
    const leadListsAvailable = !isSelfHosted() && !!plan && hasFeature(plan.id, 'leadLists');
    // ICP scoring is OPEN on self-host (unlike CRM sync / lead lists); on cloud it's
    // plan-gated. Mirrors requireFeature('icpScoring'). Surfaced so the agent never
    // tells a self-hoster the scoring model is "Cloud-only".
    const icpScoringAvailable = isSelfHosted() || (!!plan && hasFeature(plan.id, 'icpScoring'));

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

    // ── Recommended onboarding integrations (the order the agent should guide) ──
    const provName = (c) => (c.provider?.name || c.name || '').toLowerCase();
    const gmailConnected   = verified.some((c) => /gmail|google|smtp|imap/.test(provName(c)) || c.provider?.category === 'email');
    const meetingConnected = verified.some((c) => c.provider?.category === 'meetings');
    const linkedinConnected = (linkedinRows || []).length > 0;
    const recordCount = typeof contactCount === 'number' ? contactCount : 0;
    const hasWebhooks = webhookCount > 0 || (Array.isArray(triggers) ? triggers.length : 0) > 0;

    // Self-host: some channels are configured at the INSTANCE level (env vars +
    // restart), not per-workspace in the app — and the agent CANNOT set env vars.
    // Surface what's wired so the agent tells the operator which to set.
    const selfHosted     = isSelfHosted();
    const unipileEnv     = !!(process.env.UNIPILE_API_KEY && process.env.UNIPILE_DSN);
    const resendEnv      = !!process.env.RESEND_API_KEY;
    const googleOauthEnv = !!process.env.GOOGLE_CLIENT_ID;

    // ── CRM sync ──
    const crmSyncConfigured = (crmConfigs || []).length > 0;
    const crmProviders = (crmConfigs || []).map((c) => ({
      provider: c.provider,
      auto_sync: !!c.auto_sync,
      hygiene_enabled: !!c.hygiene_enabled,
      hygiene_cadence: c.hygiene_cadence || null,
    }));

    const triggerCount = Array.isArray(triggers) ? triggers.length : 0;

    // ── Ranked next steps — the onboarding sequence, in order. Guide the user
    // through these top-down; later steps build on earlier ones. ──
    const next_steps = [];

    // 1. Profile.
    if (!onboardingDone) {
      next_steps.push({
        id: 'onboarding',
        title: 'Finish onboarding the workspace',
        why: `Missing: ${profileMissing.join(', ')}. Everything else builds on the workspace knowing who you are and who you sell to.`,
        how: 'Ask for the company name + website, then RESEARCH the company from its website yourself (home, product, pricing, about, customers/case studies) so you can pre-fill instead of interrogating the user. Confirm service-or-software and a first cut of the ideal customer, then call set_workspace_profile. Treat this research as the groundwork for the GTM playbook next — dig in now, do not just collect a one-liner.',
      });
    }

    // 2. Core channels — Gmail/email, LinkedIn, a meeting note-taker. These are
    // the first sources of truth. Connected in the APP (OAuth / native), not by
    // the agent.
    if (onboardingDone && !gmailConnected) {
      next_steps.push({
        id: 'connect_email',
        title: 'Connect email (Gmail, recommended)',
        why: 'Email is the main channel of record. Without it the account timeline stays empty.',
        how: selfHosted
          ? `Self-hosted: Gmail OAuth needs GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in nous.env${googleOauthEnv ? ' (set ✓ — the user connects on the Integrations page)' : ' (NOT set — the operator adds them + restarts first)'}. Custom SMTP/IMAP works with no env. You cannot set env vars — tell the operator.`
          : 'Gmail uses Google OAuth, so the user connects it on the Integrations page (you cannot do OAuth). If they are not on Google, they can add custom SMTP/IMAP there. Point them to it.',
      });
    }
    if (onboardingDone && !linkedinConnected) {
      next_steps.push({
        id: 'connect_linkedin',
        title: 'Connect LinkedIn (recommended)',
        why: 'LinkedIn is a core GTM channel. Nous has a native LinkedIn integration.',
        how: selfHosted
          ? `Self-hosted: LinkedIn runs on Unipile at the INSTANCE level — UNIPILE_API_KEY + UNIPILE_DSN in nous.env${unipileEnv ? ' (set ✓ — the user connects their account on the Integrations page)' : ' (NOT set — the operator must add these first; Unipile is a paid third-party account, then restart)'}. There is no public LinkedIn API; you cannot set env vars — tell the operator.`
          : 'There is NO public LinkedIn API — Nous connects it natively (via Unipile) and the user configures it on the Integrations page in the app. Tell them to set it up there; you cannot connect it programmatically. (Apify / HeyReach etc. are not needed — the native one covers it.)',
      });
    }
    if (onboardingDone && !meetingConnected) {
      next_steps.push({
        id: 'connect_meetings',
        title: 'Connect a meeting note-taker (recommended)',
        why: 'Calls become part of the record — what was discussed, objections, next steps.',
        how: 'Fireflies, Fathom, Calendly, or Cal.com. These connect in the app on the Integrations page (or via webhook). Recommend one.',
      });
    }

    // 3. Enrichment / outbound — agent CAN connect key-based ones directly.
    if (onboardingDone && !enrichment) {
      next_steps.push({
        id: 'connect_enrichment',
        title: 'Connect enrichment (Prospeo or Apollo)',
        why: 'Enrichment fills job title, seniority, company size — the signals the ICP model scores on.',
        how: 'These are key-based — ask the user for the API key and call connect_integration. Outbound senders (Instantly etc.) are key-based too.',
      });
    }

    // 4. Webhooks — so the tools just connected actually push data in.
    if (onboardingDone && verified.length > 0 && !hasWebhooks) {
      next_steps.push({
        id: 'webhooks',
        title: 'Set up webhooks for the tools you connected',
        why: 'Several tools (Instantly, Fireflies, Calendly, …) only deliver events via webhook, so without one their data never reaches Nous.',
        how: 'For each connected tool that pushes events, set up its webhook (set_trigger for outbound, or point the tool at the Nous inbound webhook on the Webhooks page). Especially the sequencer + note-taker.',
      });
    }

    // 5. First records — CSV into Accounts. But channels FIRST: a record imported
    // before any channel is connected has nothing to backfill activity from, so it
    // lands as a bare name + score with an empty timeline. Adapt the step.
    const anyChannelConnected = gmailConnected || linkedinConnected || meetingConnected;
    if (onboardingDone && recordCount === 0) {
      next_steps.push(anyChannelConnected
        ? {
            id: 'import_records',
            title: 'Add the first records (CSV, ideally from the CRM)',
            why: 'An empty workspace has nothing to score or act on. Importing the CRM contacts seeds the account record, and your connected channels can backfill their real activity.',
            how: 'Tell the user to upload a CSV on the Accounts page, ideally exported from their CRM. After import, run backfill enrichment + activity so the records get scored and their past interactions attach. You cannot upload the file — guide them to it.',
          }
        : {
            id: 'import_records',
            title: 'Connect a channel FIRST, then add records',
            why: 'Importing records before any channel (LinkedIn/Gmail/meeting note-taker) is connected leaves them as names with an ICP score but an EMPTY timeline — there is no connected source to backfill their past activity from. Connect channels first so the import actually comes alive.',
            how: 'Do NOT rush to a CSV yet. First get the core channels connected — LinkedIn + Gmail at minimum, ideally a meeting note-taker — and any other relevant tools, so that once records are imported you can backfill real activity onto them. ONLY THEN upload the CSV (ideally exported from the CRM) on the Accounts page. Importing into a workspace with no channels gives a score but no history.',
          });
    }

    // 6. GTM playbook — once the workspace has its setup + first records, build
    // the scoring model.
    if (onboardingDone && !playbookDone) {
      next_steps.push({
        id: 'gtm_playbook',
        title: 'Research the company and build the GTM playbook',
        why: 'No ICP scoring model yet, so accounts are not scored for fit. This is what makes Nous prioritise — and it is only as good as the context behind it.',
        how: 'This is the heart of the setup — do REAL research, not one question. '
          + '(1) RESEARCH: read the company website (home, product, pricing, about, blog, case studies/customers) and any public material, and infer how they go to market. '
          + '(2) FILL EVERY SECTION with update_gtm_profile — Market (who + segment/geo), Product (what it does + the problem it solves), Pricing (model + tiers), Competitors (named alternatives), Positioning (the wedge / why them), GTM Motion (PLG / sales-led / outbound + sales cycle), and ICP (the sharp ideal-customer definition the score is built on). '
          + '(3) CONFIRM: show the user the drafted context and let them correct it BEFORE you build anything — never build silently off your own guesses. '
          + '(4) OUTCOMES (ask EARLY): get a handful of closed-WON and closed-LOST customer domains and call record_closed_deals — a model trained on real outcomes beats one from a description, and the won-vs-lost contrast sharpens the ICP. '
          + '(5) BUILD: call build_scoring_model. A one-line ICP is not enough.',
      });
    }

    // 6b. Routing preferences — Claude Code only, optional finishing touch once
    // the workspace is set up. (No done-signal exists, so it's surfaced as the
    // last optional step.)
    if (onboardingDone && playbookDone) {
      next_steps.push({
        id: 'routing_preferences',
        title: 'Set routing preferences (Claude Code, optional)',
        why: 'So GTM questions default to Nous even when the user does not say "Nous" — instead of the agent reaching for raw CRM/HubSpot/Salesforce/Gong/Granola.',
        how: 'ONLY if you are Claude Code: call get_routing_preferences and write the text to the user\'s CLAUDE.md (ask: this project ./CLAUDE.md, or all projects ~/.claude/CLAUDE.md). Not applicable to Codex/other clients — skip it there.',
      });
    }

    // 7. CRM sync — only if the plan includes it.
    if (onboardingDone && crmSyncAvailable && !crmSyncConfigured) {
      next_steps.push({
        id: 'crm_sync',
        title: 'Set up CRM sync',
        why: 'Keeps the account record in step with the system of record.',
        how: 'Confirm which CRM (must be connected) and the create/hygiene policy, then configure_crm_sync.',
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
        icp_scoring: icpScoringAvailable,
      },
      self_hosted: selfHosted,
      // On self-host, these channels are wired via nous.env (instance-level), not
      // per-workspace. true = the env vars are set; the agent guides the operator
      // to set the missing ones + restart (it cannot set env itself).
      env_integrations: selfHosted
        ? { linkedin_unipile: unipileEnv, email_resend: resendEnv, gmail_oauth: googleOauthEnv }
        : null,
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
        // The recommended onboarding integrations, in priority order.
        recommended: {
          email: gmailConnected,
          linkedin: linkedinConnected,
          meeting_notetaker: meetingConnected,
          enrichment: !!enrichment,
        },
        records: { count: recordCount },
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
workspaceStatusV2Router.post('/scoring-model', requireFeature('icpScoring'), async (req, res) => {
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

// ── POST /v2/workspace/crm-sync-now ──────────────────────────────────────────
// Agent-callable: run an immediate incremental pull NOW instead of waiting for
// the daily cron. Same code path (syncCrmProvider) the auto-sync worker uses, so
// manual and scheduled pulls stay consistent. CRM must already be configured.
const SYNC_NOW_PROVIDERS = ['hubspot', 'pipedrive', 'attio'];
workspaceStatusV2Router.post('/crm-sync-now', requireFeature('crmSync'), async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.workspaceId;
    const provider = String(req.body?.provider || 'hubspot').toLowerCase();
    const full = req.body?.full === true;
    if (provider === 'salesforce') return res.status(400).json({ error: 'salesforce_not_yet_supported' });
    if (!SYNC_NOW_PROVIDERS.includes(provider)) return res.status(400).json({ error: `unsupported_provider: ${provider}` });

    const { data: cfg } = await supabase.from('crm_sync_configs')
      .select('id, last_synced_at, contacts_synced')
      .eq('workspace_id', workspaceId).eq('provider', provider).maybeSingle();
    if (!cfg) return res.status(400).json({ error: 'sync_not_configured', message: `Configure ${provider} sync first with configure_crm_sync.` });

    const token = await resolveCrmTokenForProvider(supabase, workspaceId, provider);
    if (!token) return res.status(400).json({ error: 'crm_not_connected', message: `${provider} isn't connected. Connect it on the Integrations page first.` });

    const startedAt = new Date().toISOString();
    // full=true re-fetches everything; otherwise resume from the last cursor.
    const since = full ? null : (cfg.last_synced_at || null);
    let result;
    try {
      result = await syncCrmProvider(supabase, workspaceId, provider, token, since);
    } catch (err) {
      return res.status(502).json({ error: 'provider_fetch_failed', message: err.message });
    }

    // Advance the cursor only on a clean run, so a partial failure retries the
    // same window next time (no missed records).
    const patch = {
      contacts_synced: (cfg.contacts_synced || 0) + result.contacts.inserted + result.companies.inserted,
      updated_at: new Date().toISOString(),
    };
    if (result.errors.length === 0) patch.last_synced_at = startedAt;
    await supabase.from('crm_sync_configs').update(patch).eq('id', cfg.id);

    const fetched = result.contacts.fetched + result.companies.fetched + result.deals.fetched;
    const created = result.contacts.inserted + result.companies.inserted + result.deals.inserted;
    const updated = result.contacts.updated + result.companies.updated + result.deals.updated;
    await supabase.from('workspace_system_log').insert({
      workspace_id: workspaceId, source: provider,
      event_type: result.errors.length ? 'sync_partial' : 'sync_complete',
      summary: `Pulled ${fetched} from ${provider} — ${created} new, ${updated} updated${result.errors.length ? ` · ${result.errors.length} errors` : ''}`,
      metadata: { trigger: 'agent', ...result },
    }).then(() => {}, () => {});

    return res.json({ ok: true, provider, fetched, created, updated, errors: result.errors });
  } catch (err) {
    console.error('[POST /v2/workspace/crm-sync-now]', err);
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

// ── POST /v2/workspace/closed-deals ──────────────────────────────────────────
// Agent-callable: build the ICP scoring model from REAL closed deals. Enriches
// each domain, links known contacts, and runs contrastive lift (won vs lost) to
// discover the signals that actually predict revenue, then re-scores open
// accounts. Shares its implementation with the web "Add deals" flow.
workspaceStatusV2Router.post('/closed-deals', async (req, res) => {
  try {
    const { won = [], lost = [] } = req.body || {};
    const r = await runClosedDeals(getSupabaseClient(), req.workspaceId, { won, lost });
    if (r.need_more_deals) {
      return res.status(400).json({ error: 'need_more_deals', message: 'Give at least one closed-won or closed-lost domain.' });
    }
    return res.status(201).json({ ok: true, ...r });
  } catch (err) {
    console.error('[POST /v2/workspace/closed-deals]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

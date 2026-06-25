import './bootEnv.mjs'; // first — normalizes APP_URL/API_URL from domains before any module reads them
import express from 'express';
import cors from 'cors';
import { registerCrmPushHandler, pushActivityToAllCrms, getSupabaseClient } from '@nous/core';
import { stripeWebhookHandler } from './routes/stripeWebhook.mjs';
import { registerLinkedInRoutes } from './services/linkedin.mjs';

// Wire activity logging → CRM push at module load time
registerCrmPushHandler(pushActivityToAllCrms);

import { verifyApiKey } from './middleware/apiKey.mjs';
import { verifySupabaseAuth } from './middleware/supabaseAuth.mjs';
import { verifyAuthEither } from './middleware/authEither.mjs';
import { requireAdmin } from './middleware/requireAdmin.mjs';
import { logV2Op } from './middleware/opLogger.mjs';
import { requireFeature, requireOpsBalance, blockOnSelfHost } from './lib/access.mjs';

// v2 — Context API (evidence substrate)
import { accountsV2Router } from './routes/v2/accounts.mjs';
import { observationsV2Router } from './routes/v2/observations.mjs';
import { contextV2Router } from './routes/v2/context.mjs';
import { queryV2Router } from './routes/v2/query.mjs';
import { reportV2Router } from './routes/v2/report.mjs';
import { attentionV2Router } from './routes/v2/attention.mjs';
import { verifyV2Router } from './routes/v2/verify.mjs';
import { dedupV2Router } from './routes/v2/dedup.mjs';
import { workspaceFactsV2Router } from './routes/v2/workspaceFacts.mjs';
import { workspaceStatusV2Router } from './routes/v2/workspaceStatus.mjs';
import { notesV2Router } from './routes/v2/notes.mjs';
import { signalsV2Router } from './routes/v2/signals.mjs';
import { peopleV2Router } from './routes/v2/people.mjs';
import { leadsV2Router } from './routes/v2/leads.mjs';
import { actionItemsV2Router } from './routes/v2/actionItems.mjs';

// /api — Frontend API (Supabase JWT auth)
import { apiKeysRouter } from './routes/api/apiKeys.mjs';
import { cliAuthRouter } from './routes/api/cliAuth.mjs';
import { webhooksRouter } from './routes/api/webhooks.mjs';
import { meRouter } from './routes/api/me.mjs';
import { workspacesRouter } from './routes/api/workspaces.mjs';
import { teamsRouter } from './routes/api/teams.mjs';
import { usersRouter } from './routes/api/users.mjs';
import { invitationsRouter } from './routes/api/invitations.mjs';
import { onboardingRouter } from './routes/api/onboarding.mjs';
import { usageRouter } from './routes/api/usage.mjs';
import { billingRouter } from './routes/api/billing.mjs';
import { opsEmailsRouter } from './routes/opsEmails.mjs';
import { integrationsRouter } from './routes/api/integrations.mjs';
import { crmRouter } from './routes/api/crm.mjs';
import { contactsApiRouter } from './routes/api/contacts.mjs';
import { companiesApiRouter } from './routes/api/companies.mjs';
import { signalsRouter, publicSignalsRouter } from './routes/api/signals.mjs';
import { skillDownloadsRouter } from './routes/public/skillDownloads.mjs';
import { requestsRouter } from './routes/api/requests.mjs';
import { feedbackRouter } from './routes/api/feedback.mjs';
import { publicLiveRouter } from './routes/api/public/live.mjs';
import { workspaceMemoriesRouter } from './routes/api/workspaceMemories.mjs';
import { playgroundRouter } from './routes/api/playground.mjs';
import { mindRouter } from './routes/api/mind.mjs';
import { leadListsRouter } from './routes/api/leadLists.mjs';
import { campaignMessagesRouter } from './routes/api/campaignMessages.mjs';
import { triggersRouter } from './routes/api/triggers.mjs';
import { workflowProvidersRouter } from './routes/api/workflowProviders.mjs';
import { linkedinRouter } from './routes/api/linkedin.mjs';
import { systemLogRouter } from './routes/api/systemLog.mjs';
import { oauthGoogleRouter } from './routes/api/oauthGoogle.mjs';
import { oauthAirtableRouter } from './routes/api/oauthAirtable.mjs';
import { oauthSlackRouter } from './routes/api/oauthSlack.mjs';
import { oauthSalesforceRouter } from './routes/api/oauthSalesforce.mjs';

// /api/admin — Admin routes
import { blogRouter } from './routes/api/blog.mjs';
import { adminBlogRouter } from './routes/api/admin/blog.mjs';
import { resourcesRouter, adminResourcesRouter } from './routes/api/resources.mjs';
import { adminChangelogRouter, publicChangelogRouter } from './routes/api/admin/changelog.mjs';
import { roadmapRouter, adminRoadmapRouter } from './routes/api/admin/roadmap.mjs';
import { updatesRouter, adminUpdatesRouter } from './routes/api/admin/updates.mjs';
import { adminUsersRouter } from './routes/api/admin/users.mjs';

const app = express();

// Behind Caddy → req.ip resolves to the real client IP, not the proxy hop.
// Needed for IP-based country geolocation (see lib/geo.mjs).
app.set('trust proxy', 1);

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : true;

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// Stripe webhook MUST receive the raw body so the signature can be verified.
// Mounted before `express.json()` so that middleware never touches it.
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

app.use(express.json({ limit: '10mb' }));

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── Public auth config ────────────────────────────────────────────────────────
// Read by the login/signup UI before auth. Lets a self-host hide the
// "Create account" path (DISABLE_SIGNUPS) and the Google button when Google
// OAuth isn't configured. Even with DISABLE_SIGNUPS=true, registration stays
// OPEN until the first user (the owner) exists, so the owner can still sign up;
// it closes once an account exists. Mirrors the server gate in ensureUserAndTeam.
app.get('/api/auth/config', async (_req, res) => {
  let signupsDisabled = false;
  if (process.env.DISABLE_SIGNUPS === 'true') {
    try {
      const { count } = await getSupabaseClient()
        .from('users')
        .select('id', { count: 'exact', head: true });
      signupsDisabled = (count ?? 0) > 0;
    } catch {
      signupsDisabled = false; // on error, don't lock the owner out
    }
  }
  res.json({
    signupsDisabled,
    googleEnabled: Boolean(process.env.GOOGLE_CLIENT_ID),
  });
});

// ── v2 — Context API (evidence substrate) ────────────────────────────────────
// Order matters: verifyApiKey populates req.workspaceId; logV2Op reads it
// after the response finishes and writes a row to workspace_system_log so
// the Ops page Live Op Log surfaces every agent/MCP/SDK call.
// requireOpsBalance sits after auth (needs req.workspaceId/req.user) and before
// logV2Op: when a team is in the RESTRICTED state it 402s here, so a blocked op
// never reaches the router and never writes an op-log row. 'grace'/'warn'/'ok'
// all pass through. These are the ACTIVE agent/MCP surfaces; inbound ingest lives
// in the worker and is never gated, so captured signal is never lost.
app.use('/v2/accounts',        verifyApiKey,     requireOpsBalance, logV2Op, accountsV2Router);
app.use('/v2/observations',    verifyApiKey,     requireOpsBalance, logV2Op, observationsV2Router);
app.use('/v2/context',         verifyApiKey,     requireOpsBalance, logV2Op, contextV2Router);
app.use('/v2/query',           verifyApiKey,     requireOpsBalance, logV2Op, queryV2Router);
app.use('/v2/report',          verifyApiKey,     requireOpsBalance, logV2Op, reportV2Router);
app.use('/v2/attention',       verifyApiKey,     requireOpsBalance, logV2Op, attentionV2Router);
app.use('/v2/verify',          verifyApiKey,     requireOpsBalance, logV2Op, verifyV2Router);
app.use('/v2/dedup',           verifyAuthEither, requireOpsBalance, logV2Op, dedupV2Router);
app.use('/v2/workspace/facts', verifyApiKey,     requireOpsBalance, logV2Op, workspaceFactsV2Router);
// Event triggers (set_trigger / list_triggers) are a Cloud-only feature — block
// them on self-host. Mounted BEFORE the general /v2/workspace router so this more
// specific path runs first; on cloud it falls through to the real handler.
app.use('/v2/workspace/triggers', blockOnSelfHost('triggers'));
// Mounted AFTER /v2/workspace/facts so the more specific facts route wins; this
// handles /v2/workspace/status (GET) and /v2/workspace/onboarding (POST).
app.use('/v2/workspace',       verifyApiKey,     requireOpsBalance, logV2Op, workspaceStatusV2Router);
app.use('/v2/notes',           verifyApiKey,     requireOpsBalance, logV2Op, notesV2Router);
app.use('/v2/signals',         verifyApiKey,     requireOpsBalance, logV2Op, signalsV2Router);
app.use('/v2/people',          verifyApiKey,     requireOpsBalance, logV2Op, peopleV2Router);
app.use('/v2/leads',           verifyApiKey,     requireOpsBalance, logV2Op, requireFeature('leadLists'), leadsV2Router);
app.use('/v2/action-items',    verifyApiKey,     requireOpsBalance, logV2Op, actionItemsV2Router);

// ── /api — Frontend API ───────────────────────────────────────────────────────
app.use('/me',                        meRouter); // legacy path used by AuthContext
app.use('/api/me',                    meRouter);
app.use('/api/workspaces',            workspacesRouter);
app.use('/api/teams',                 teamsRouter);
app.use('/api/users',                 usersRouter);
app.use('/api/invitations',           invitationsRouter);
app.use('/api/onboarding',            onboardingRouter);
app.use('/api/usage',                 usageRouter);
app.use('/api/billing',               billingRouter);
// Internal worker→api endpoint (secret-guarded, dormant unless WORKER_INTERNAL_SECRET set).
app.use('/internal/ops-emails',       opsEmailsRouter);
app.use('/api/integrations',          integrationsRouter);
app.use('/api/crm',                   crmRouter);
app.use('/api/contacts',              contactsApiRouter);
app.use('/api/companies',             companiesApiRouter);
// publicSignalExtraction gates the authenticated setup/configuration routes.
// The public ingest endpoint stays open (its own HMAC token guards it).
app.use('/api/signals',               verifySupabaseAuth, requireFeature('publicSignalExtraction'), signalsRouter);
app.use('/api/public/signals',        publicSignalsRouter);
app.use('/api/public/skill-downloads', skillDownloadsRouter);
app.use('/api/requests',              requestsRouter);
app.use('/api/feedback',              feedbackRouter);
app.use('/api/public/live',           publicLiveRouter);
app.use('/api/workspace/system-log',  systemLogRouter);
app.use('/api/workspace/api-keys',    verifySupabaseAuth, apiKeysRouter);
// CLI/plugin browser-login (device-auth). start + poll are public; the router's
// approve + request routes apply verifySupabaseAuth themselves.
app.use('/api/cli/auth',              cliAuthRouter);
app.use('/api/workspace/memories',    verifySupabaseAuth, workspaceMemoriesRouter);
app.use('/api/playground',            blockOnSelfHost('playground'), playgroundRouter);
app.use('/api/mind',                  verifySupabaseAuth, mindRouter);
app.use('/api/lead-lists',            verifyAuthEither, requireFeature('leadLists'), leadListsRouter);
app.use('/api/campaign-messages',     verifyAuthEither, requireFeature('leadLists'), campaignMessagesRouter);
app.use('/api/triggers',              verifyAuthEither, blockOnSelfHost('triggers'), triggersRouter);
app.use('/api/webhooks',              verifySupabaseAuth, webhooksRouter);
app.use('/api/workflow-providers',    verifySupabaseAuth, workflowProvidersRouter);
// LinkedIn action endpoints — invite/message/sync (Supabase JWT, workspaceId in body),
// send-invite/send-message/post-comment (API key or Supabase JWT), and the
// Unipile OAuth callback (no auth, redirected from Unipile).
//
// MUST be registered BEFORE the /api/linkedin app.use mount below. Otherwise the
// mount's verifySupabaseAuth runs first for every /api/linkedin/* request and
// short-circuits non-JWT calls with auth_required, never reaching these handlers.
// Express resolves routes in registration order — these app.post('/api/linkedin/...')
// declarations match exact path+method before the prefix mount runs.
registerLinkedInRoutes(app, getSupabaseClient(), verifySupabaseAuth, verifyAuthEither);
app.use('/api/linkedin',              verifySupabaseAuth, linkedinRouter);

// ── OAuth callbacks — no auth middleware (redirects from external providers) ──
app.use('/api/oauth/google',                         oauthGoogleRouter);
app.use('/api/oauth/slack',                          oauthSlackRouter);
app.use('/api/workflow-providers/airtable/oauth',    oauthAirtableRouter);
app.use('/api/workflow-providers/salesforce/oauth',  oauthSalesforceRouter);

// ── /api/roadmap, /api/updates, /api/blog, /api/changelog — Public ───────────
app.use('/api/roadmap',           roadmapRouter);
app.use('/api/updates',           updatesRouter);
app.use('/api/blog',              blogRouter);
app.use('/api/resources',         resourcesRouter);
app.use('/api/changelog/entries', publicChangelogRouter);

// ── /api/admin — Admin (auth + admin check applied at mount) ──────────────────
app.use('/api/admin/blog',      verifySupabaseAuth, requireAdmin, adminBlogRouter);
app.use('/api/admin/resources', verifySupabaseAuth, requireAdmin, adminResourcesRouter);
app.use('/api/changelog/entries', verifySupabaseAuth, requireAdmin, adminChangelogRouter);
app.use('/api/admin/roadmap',   verifySupabaseAuth, requireAdmin, adminRoadmapRouter);
app.use('/api/admin/updates',   verifySupabaseAuth, requireAdmin, adminUpdatesRouter);
app.use('/api/admin/users',     verifySupabaseAuth, requireAdmin, adminUsersRouter);

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[UNHANDLED]', err);
  res.status(500).json({
    error: 'internal_error',
    ...(process.env.NODE_ENV !== 'production' && { detail: err.message }),
  });
});

export { app };

// Idempotent provider seed — both adds new providers and normalizes the
// category/display_name for existing ones that may have shipped with the
// wrong values (e.g. apollo originally seeded as 'analytics' on some
// deployments). Safe to run on every boot.
async function bootstrapProviders() {
  try {
    const { getSupabaseClient } = await import('@nous/core');
    const supabase = getSupabaseClient();
    await supabase
      .from('workflow_providers')
      .upsert(
        [
          { name: 'cal_com',   display_name: 'Cal.com',      category: 'meetings'   },
          { name: 'apollo',    display_name: 'Apollo.io',    category: 'enrichment' },
          { name: 'prospeo',   display_name: 'Prospeo',      category: 'enrichment' },
          { name: 'fireflies', display_name: 'Fireflies.ai', category: 'meetings'   },
          { name: 'fathom',    display_name: 'Fathom',       category: 'meetings'   },
          { name: 'calendly',  display_name: 'Calendly',     category: 'meetings'   },
          // BYOK key for the LinkedIn engager scrape (HarvestAPI actors on Apify).
          { name: 'apify',     display_name: 'Apify',        category: 'scraping'   },
        ],
        { onConflict: 'name' }   // overwrite — fixes stale categories on every boot
      );
  } catch (err) {
    console.warn('[BOOTSTRAP] provider seed skipped:', err.message);
  }
}

// Only start the server when run directly, not when imported by tests
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORT = process.env.PORT ?? 3000;
  bootstrapProviders();
  app.listen(PORT, () => console.log(`Nous API running on :${PORT}`));
}

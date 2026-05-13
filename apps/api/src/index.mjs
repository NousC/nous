import express from 'express';
import cors from 'cors';

import { verifyApiKey } from './middleware/apiKey.mjs';
import { verifySupabaseAuth } from './middleware/supabaseAuth.mjs';
import { requireAdmin } from './middleware/requireAdmin.mjs';

// v1 — Public API (API key auth)
import { contactsRouter } from './routes/v1/contacts.mjs';
import { memoriesRouter } from './routes/v1/memories.mjs';
import { captureRouter } from './routes/v1/capture.mjs';
import { companiesRouter } from './routes/v1/companies.mjs';
import { rememberRouter } from './routes/v1/remember.mjs';
import { searchRouter } from './routes/v1/search.mjs';

// /api — Frontend API (Supabase JWT auth)
import { apiKeysRouter } from './routes/api/apiKeys.mjs';
import { webhooksRouter } from './routes/api/webhooks.mjs';
import { meRouter } from './routes/api/me.mjs';
import { workspacesRouter } from './routes/api/workspaces.mjs';
import { teamsRouter } from './routes/api/teams.mjs';
import { usersRouter } from './routes/api/users.mjs';
import { invitationsRouter } from './routes/api/invitations.mjs';
import { onboardingRouter } from './routes/api/onboarding.mjs';
import { usageRouter } from './routes/api/usage.mjs';
import { billingRouter } from './routes/api/billing.mjs';
import { integrationsRouter } from './routes/api/integrations.mjs';
import { crmRouter } from './routes/api/crm.mjs';
import { contactsApiRouter } from './routes/api/contacts.mjs';
import { companiesApiRouter } from './routes/api/companies.mjs';
import { signalsRouter } from './routes/api/signals.mjs';
import { requestsRouter } from './routes/api/requests.mjs';
import { workspaceMemoriesRouter } from './routes/api/workspaceMemories.mjs';
import { workflowProvidersRouter } from './routes/api/workflowProviders.mjs';
import { linkedinRouter } from './routes/api/linkedin.mjs';
import { systemLogRouter } from './routes/api/systemLog.mjs';
import { oauthGoogleRouter } from './routes/api/oauthGoogle.mjs';
import { oauthAirtableRouter } from './routes/api/oauthAirtable.mjs';

// /api/admin — Admin routes
import { blogRouter } from './routes/api/blog.mjs';
import { adminBlogRouter } from './routes/api/admin/blog.mjs';
import { adminChangelogRouter, publicChangelogRouter } from './routes/api/admin/changelog.mjs';
import { roadmapRouter, adminRoadmapRouter } from './routes/api/admin/roadmap.mjs';
import { updatesRouter, adminUpdatesRouter } from './routes/api/admin/updates.mjs';
import { adminUsersRouter } from './routes/api/admin/users.mjs';

const app = express();

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : true;

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── v1 — Public API (API key auth) ───────────────────────────────────────────
app.use('/v1/contacts',  verifyApiKey, contactsRouter);
app.use('/v1/contact',   verifyApiKey, contactsRouter);   // singular alias (MCP/CLI)
app.use('/v1/companies', verifyApiKey, companiesRouter);
app.use('/v1/company',   verifyApiKey, companiesRouter);   // singular alias (MCP)
app.use('/v1/memories',  verifyApiKey, memoriesRouter);
app.use('/v1/memory',    verifyApiKey, memoriesRouter);
app.use('/v1/capture',   verifyApiKey, captureRouter);
app.use('/v1/track',     verifyApiKey, captureRouter);     // alias used by MCP track tool
app.use('/v1/remember',  verifyApiKey, rememberRouter);    // MCP remember tool
app.use('/v1/search',    verifyApiKey, searchRouter);      // MCP search tool

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
app.use('/api/integrations',          integrationsRouter);
app.use('/api/crm',                   crmRouter);
app.use('/api/contacts',              contactsApiRouter);
app.use('/api/companies',             companiesApiRouter);
app.use('/api/signals',               signalsRouter);
app.use('/api/requests',              requestsRouter);
app.use('/api/workspace/system-log',  systemLogRouter);
app.use('/api/workspace/api-keys',    verifySupabaseAuth, apiKeysRouter);
app.use('/api/workspace/memories',    verifySupabaseAuth, workspaceMemoriesRouter);
app.use('/api/webhooks',              verifySupabaseAuth, webhooksRouter);
app.use('/api/workflow-providers',    verifySupabaseAuth, workflowProvidersRouter);
app.use('/api/linkedin',              verifySupabaseAuth, linkedinRouter);

// ── OAuth callbacks — no auth middleware (redirects from external providers) ──
app.use('/api/oauth/google',                         oauthGoogleRouter);
app.use('/api/workflow-providers/airtable/oauth',    oauthAirtableRouter);

// ── /api/roadmap, /api/updates, /api/blog, /api/changelog — Public ───────────
app.use('/api/roadmap',           roadmapRouter);
app.use('/api/updates',           updatesRouter);
app.use('/api/blog',              blogRouter);
app.use('/api/changelog/entries', publicChangelogRouter);

// ── /api/admin — Admin (auth + admin check applied at mount) ──────────────────
app.use('/api/admin/blog',      verifySupabaseAuth, requireAdmin, adminBlogRouter);
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

// Only start the server when run directly, not when imported by tests
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORT = process.env.PORT ?? 3000;
  app.listen(PORT, () => console.log(`Proply API running on :${PORT}`));
}

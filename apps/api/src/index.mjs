import express from 'express';
import cors from 'cors';

import { verifyApiKey } from './middleware/apiKey.mjs';
import { verifySupabaseAuth } from './middleware/supabaseAuth.mjs';

import { contactsRouter } from './routes/v1/contacts.mjs';
import { memoriesRouter } from './routes/v1/memories.mjs';
import { captureRouter } from './routes/v1/capture.mjs';
import { companiesRouter } from './routes/v1/companies.mjs';
import { apiKeysRouter } from './routes/api/apiKeys.mjs';
import { webhooksRouter } from './routes/api/webhooks.mjs';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── v1 — Public API (API key auth) ───────────────────────────────────────────
app.use('/v1/contacts',  verifyApiKey, contactsRouter);
app.use('/v1/companies', verifyApiKey, companiesRouter);
app.use('/v1/memories',  verifyApiKey, memoriesRouter);
app.use('/v1/memory',    verifyApiKey, memoriesRouter);   // /v1/memory/search alias
app.use('/v1/capture',   verifyApiKey, captureRouter);

// ── /api — Frontend API (Supabase JWT auth) ───────────────────────────────────
app.use('/api/workspace/api-keys', verifySupabaseAuth, apiKeysRouter);
app.use('/api/webhooks',           verifySupabaseAuth, webhooksRouter);

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

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`Proply API running on :${PORT}`));

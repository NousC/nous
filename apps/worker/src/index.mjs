// Proply Worker — background signal ingestion and scheduled pollers.
//
// Runs two things:
//   1. A lightweight HTTP server for inbound webhooks (LinkedIn, Fireflies, RB2B, etc.)
//   2. Scheduled pollers (Google Calendar every 10 minutes)

import express from 'express';
import { pollAllWorkspaces } from './pollers/calendar.mjs';
import { webhookRouter } from './webhooks/index.mjs';

// ── Validate required env vars ────────────────────────────────────────────────
const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`[WORKER] Missing required env var: ${key}`);
    process.exit(1);
  }
}

// ── Inbound webhook server ────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '5mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'proply-worker' }));
app.use('/inbound', webhookRouter);

const PORT = process.env.WORKER_PORT ?? 3001;
app.listen(PORT, () => console.log(`[WORKER] Webhook server on :${PORT}`));

// ── Pollers ───────────────────────────────────────────────────────────────────
const CALENDAR_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

async function runCalendarPoller() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.log('[WORKER] Google Calendar not configured — skipping poll');
    return;
  }
  try {
    await pollAllWorkspaces();
  } catch (err) {
    console.error('[WORKER] Calendar poll error:', err.message);
  }
}

// Run once on startup, then on interval
runCalendarPoller();
setInterval(runCalendarPoller, CALENDAR_INTERVAL_MS);

console.log(`[WORKER] Started — calendar poller every ${CALENDAR_INTERVAL_MS / 60000}min`);

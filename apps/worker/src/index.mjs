// Nous Worker — background signal ingestion and scheduled pollers.
//
// Runs two things:
//   1. A lightweight HTTP server for inbound webhooks (LinkedIn, Fireflies, RB2B, etc.)
//   2. Scheduled pollers using node-cron for predictable timing

import express from 'express';
import cron from 'node-cron';
import { getSupabaseClient, registerCrmPushHandler, pushActivityToAllCrms } from '@nous/core';
import { pollAllWorkspaces } from './pollers/calendar.mjs';
import { pollAllSlackWorkspaces } from './pollers/slack.mjs';
import { pollAllGmailWorkspaces } from './pollers/gmail.mjs';
import { pollAllSmtpWorkspaces } from './pollers/smtp.mjs';
import { webhookRouter } from './webhooks/index.mjs';

// Wire webhook-driven activity logging → CRM push at module load.
// Worker is where most logActivity() calls originate (Instantly/Lemlist replies,
// Fireflies/Fathom meetings, LinkedIn messages, Calendly bookings, etc.)
registerCrmPushHandler(pushActivityToAllCrms);

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
app.use(express.json({
  limit: '5mb',
  // Preserve raw body bytes so webhook handlers can verify signatures
  // (Calendly, Stripe, etc.) against exactly what the sender hashed.
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'nous-worker' }));
app.use('/inbound', webhookRouter);

const PORT = process.env.WORKER_PORT ?? 3001;
app.listen(PORT, () => console.log(`[WORKER] Webhook server on :${PORT}`));

// ── Calendar poller — every 10 minutes ───────────────────────────────────────
async function runCalendarPoller() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return;
  try {
    await pollAllWorkspaces();
  } catch (err) {
    console.error('[WORKER] Calendar poll error:', err.message);
  }
}

// Run once on startup, then every 10 min
runCalendarPoller();
cron.schedule('*/10 * * * *', runCalendarPoller);
console.log('[WORKER] Calendar poller — every 10 min');

// ── Slack DM poller — every hour ─────────────────────────────────────────────
async function runSlackPoller() {
  if (!process.env.SLACK_CLIENT_ID) return;
  try { await pollAllSlackWorkspaces(); }
  catch (err) { console.error('[WORKER] Slack poll error:', err.message); }
}
cron.schedule('0 * * * *', runSlackPoller);
console.log('[WORKER] Slack poller — every hour');

// ── Gmail poller — every 30 minutes ──────────────────────────────────────────
async function runGmailPoller() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return;
  try { await pollAllGmailWorkspaces(); }
  catch (err) { console.error('[WORKER] Gmail poll error:', err.message); }
}
cron.schedule('*/30 * * * *', runGmailPoller);
console.log('[WORKER] Gmail poller — every 30 min');

// ── SMTP/IMAP poller — every 15 minutes ──────────────────────────────────────
async function runSmtpPoller() {
  try { await pollAllSmtpWorkspaces(); }
  catch (err) { console.error('[WORKER] SMTP poll error:', err.message); }
}
cron.schedule('*/15 * * * *', runSmtpPoller);
console.log('[WORKER] SMTP/IMAP poller — every 15 min');

// ── Pipeline stage decay — daily at 03:00 UTC ────────────────────────────────
async function runPipelineDecay() {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc('decay_pipeline_stages');
    if (error) throw error;
    console.log('[WORKER] Pipeline stage decay complete');
  } catch (err) {
    console.error('[WORKER] Pipeline decay error:', err.message);
  }
}

cron.schedule('0 3 * * *', runPipelineDecay, { timezone: 'UTC' });
console.log('[WORKER] Pipeline decay — daily at 03:00 UTC');

console.log('[WORKER] Started');

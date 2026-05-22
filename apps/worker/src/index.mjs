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
import { processWebhookInbox } from './workers/webhookRetry.mjs';
import { resolveMindEpisodes } from './workers/mindOutcomes.mjs';
import { processLeadReplies } from './workers/leadReplies.mjs';
import { runScorecardLoop } from './workers/scorecardLoop.mjs';
import { processClaimJobs } from './workers/claimEngine.mjs';

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

// ── Calendar poller — every hour ─────────────────────────────────────────────
async function runCalendarPoller() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return;
  try {
    await pollAllWorkspaces();
  } catch (err) {
    console.error('[WORKER] Calendar poll error:', err.message);
  }
}

// Run once on startup, then hourly
runCalendarPoller();
cron.schedule('0 * * * *', runCalendarPoller);
console.log('[WORKER] Calendar poller — every hour');

// ── Slack DM poller — every hour ─────────────────────────────────────────────
async function runSlackPoller() {
  if (!process.env.SLACK_CLIENT_ID) return;
  try { await pollAllSlackWorkspaces(); }
  catch (err) { console.error('[WORKER] Slack poll error:', err.message); }
}
cron.schedule('0 * * * *', runSlackPoller);
console.log('[WORKER] Slack poller — every hour');

// ── Gmail poller — every hour ────────────────────────────────────────────────
async function runGmailPoller() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return;
  try { await pollAllGmailWorkspaces(); }
  catch (err) { console.error('[WORKER] Gmail poll error:', err.message); }
}
// Run once on startup so reconnects/redeploys produce visible activity immediately
runGmailPoller();
cron.schedule('0 * * * *', runGmailPoller);
console.log('[WORKER] Gmail poller — every hour');

// ── SMTP/IMAP poller — every hour ────────────────────────────────────────────
async function runSmtpPoller() {
  try { await pollAllSmtpWorkspaces(); }
  catch (err) { console.error('[WORKER] SMTP poll error:', err.message); }
}
runSmtpPoller();
cron.schedule('0 * * * *', runSmtpPoller);
console.log('[WORKER] SMTP/IMAP poller — every hour');

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

// ── Mind outcome resolution — daily at 03:30 UTC ─────────────────────────────
// Joins each ICP prediction in mind_episodes to its realized outcome (reply /
// pipeline advance / closed-won revenue) and writes a weighted outcome_score.
// Runs after pipeline decay so contact stages are fresh.
// See docs/compound-intelligence-mind.md (Phase 2).
async function runMindOutcomes() {
  try {
    await resolveMindEpisodes();
  } catch (err) {
    console.error('[WORKER] Mind outcomes error:', err.message);
  }
}

cron.schedule('30 3 * * *', runMindOutcomes, { timezone: 'UTC' });
console.log('[WORKER] Mind outcomes — daily at 03:30 UTC');

// ── Lead reply classification — every 15 minutes ─────────────────────────────
// Classifies inbound replies and graduates matched leads into People.
// Decoupled from webhook ingestion. See docs/adaptive-lead-scoring.md.
async function runLeadReplies() {
  try {
    await processLeadReplies();
  } catch (err) {
    console.error('[WORKER] Lead replies error:', err.message);
  }
}

cron.schedule('*/15 * * * *', runLeadReplies);
console.log('[WORKER] Lead reply classification — every 15 minutes');

// ── Scorecard learning loop — daily at 04:00 UTC ─────────────────────────────
// Refines the Scorecard from the account record's resolved predictions:
// propose → test on a held-back split → keep only if both gates agree.
// Runs after outcome resolution (03:30). See docs/adaptive-lead-scoring.md.
async function runScorecard() {
  try {
    await runScorecardLoop();
  } catch (err) {
    console.error('[WORKER] Scorecard loop error:', err.message);
  }
}

cron.schedule('0 4 * * *', runScorecard, { timezone: 'UTC' });
console.log('[WORKER] Scorecard learning loop — daily at 04:00 UTC');

// ── Webhook retry queue — every minute ───────────────────────────────────────
// Picks up rows from webhook_inbox whose handlers failed (DB hiccup, Haiku
// timeout, etc.) and reprocesses them with exponential backoff.
cron.schedule('* * * * *', processWebhookInbox);
console.log('[WORKER] Webhook retry queue — every minute');

// ── Claim-derivation engine — every minute ───────────────────────────────────
// Drains claim_jobs (filled by a DB trigger on every observation insert) and
// re-derives each affected claim from its observations. The self-healing loop:
// a new observation pulls the belief back toward truth. See docs/v2-build-plan.md.
cron.schedule('* * * * *', processClaimJobs);
console.log('[WORKER] Claim-derivation engine — every minute');

console.log('[WORKER] Started');

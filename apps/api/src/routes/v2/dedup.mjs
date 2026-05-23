import { Router } from 'express';
import { getSupabaseClient, classifyEmails } from '@nous/core';

export const dedupV2Router = Router();

// POST /v2/dedup — the cross-list cold-outbound dedup primitive.
//
// You upload a list of emails (from Apollo, Instantly, Lemlist, a CSV, anywhere),
// and we tell you which are safe to cold-email and which are not — across
// every list and every engagement signal the workspace has ever seen.
//
// Body:  { emails: string[] }   (max 10,000 per call)
//
// Response:
//   {
//     results: [
//       { email, status: 'net_new'|'engaged'|'recent'|'bounced'|
//                        'unsubscribed'|'suppressed',
//         entity_id?: string, reason?: string }
//     ],
//     summary: { net_new, engaged, recent, bounced, unsubscribed, suppressed, total }
//   }
//
// Reasoning behind each status:
//   net_new       — no prior record. Safe to send.
//   engaged       — already in an active conversation. Don't cold-send.
//   recent        — contacted in the last 30 days. Defer.
//   bounced       — last delivery bounced. Skip.
//   unsubscribed  — opted out or do-not-contact. Skip.
//   suppressed    — workspace-level suppression (policy). Skip.

const MAX_EMAILS = 10_000;

dedupV2Router.post('/', async (req, res) => {
  try {
    const { emails } = req.body || {};
    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({
        error: 'emails_required',
        message: 'Body must include a non-empty `emails` array.',
      });
    }
    if (emails.length > MAX_EMAILS) {
      return res.status(413).json({
        error: 'too_many_emails',
        message: `Maximum ${MAX_EMAILS} emails per call. Split into batches.`,
        max: MAX_EMAILS,
      });
    }

    const supabase = getSupabaseClient();
    const results = await classifyEmails(supabase, req.workspaceId, emails);

    const summary = {
      net_new: 0, engaged: 0, recent: 0,
      bounced: 0, unsubscribed: 0, suppressed: 0,
      total: results.length,
    };
    for (const r of results) summary[r.status] = (summary[r.status] || 0) + 1;

    return res.json({ results, summary });
  } catch (err) {
    console.error('[POST /v2/dedup]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

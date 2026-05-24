import { Router } from 'express';
import { getSupabaseClient, classifyIdentifiers } from '@nous/core';

export const dedupV2Router = Router();

// POST /v2/dedup — the cross-list cold-outbound dedup primitive.
//
// The "pre-flight before you pay" check. You're about to scrape 10k leads on
// Apollo for $300 — paste in the LinkedIn URLs (visible for free in Apollo's
// preview), get back which ones you already have. Buy only the difference.
//
// Body — at least one of:
//   { emails:        string[] }  // up to 10,000
//   { linkedin_urls: string[] }  // up to 10,000
//   { emails: [...], linkedin_urls: [...] }   // both, combined response
//
// Response:
//   {
//     results: [
//       { kind: 'email'|'linkedin_url', value, status, entity_id?, reason? }
//     ],
//     summary: { net_new, engaged, recent, bounced, unsubscribed, suppressed, total }
//   }
//
// Status semantics:
//   net_new       — no prior record. Safe to send / safe to buy.
//   engaged       — in an active conversation. Don't cold-send.
//   recent        — contacted in the last 30 days. Defer.
//   bounced       — last delivery bounced (email-only signal). Skip.
//   unsubscribed  — opted out or do-not-contact. Skip.
//   suppressed    — workspace-level suppression policy. Skip.

const MAX_PER_BATCH = 10_000;

dedupV2Router.post('/', async (req, res) => {
  try {
    const { emails, linkedin_urls } = req.body || {};
    const emailList = Array.isArray(emails) ? emails : [];
    const linkedinList = Array.isArray(linkedin_urls) ? linkedin_urls : [];

    if (emailList.length === 0 && linkedinList.length === 0) {
      return res.status(400).json({
        error: 'identifiers_required',
        message: 'Body must include a non-empty `emails` or `linkedin_urls` array (or both).',
      });
    }
    if (emailList.length > MAX_PER_BATCH || linkedinList.length > MAX_PER_BATCH) {
      return res.status(413).json({
        error: 'too_many',
        message: `Maximum ${MAX_PER_BATCH} of each kind per call. Split into batches.`,
        max: MAX_PER_BATCH,
      });
    }

    const supabase = getSupabaseClient();
    const results = await classifyIdentifiers(supabase, req.workspaceId, {
      emails: emailList,
      linkedin_urls: linkedinList,
    });

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

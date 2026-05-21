// The Mind — reply classifier + lead graduation (Adaptive Lead Scoring, 4a.3).
//
// Scans recently-logged inbound reply activities. When a reply's sender matches
// an unresolved lead, the reply is classified into an outcome, recorded on the
// lead, and the lead is linked to the contact the reply already created
// (graduation: lead → person).
//
// Runs as a worker cron, decoupled from webhook ingestion — it never blocks a
// webhook and touches no ingestion code. A classification failure simply
// leaves the lead unresolved for the next pass; re-scanning is idempotent
// because an already-resolved lead is skipped.
//
// See docs/adaptive-lead-scoring.md.

import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseClient, findLeadByEmail, updateLead, addSuppression } from '@nous/core';
import { logSysEvent } from '../utils/systemLog.mjs';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Activity types that represent an inbound reply worth learning from.
const REPLY_ACTIVITY_TYPES = [
  'email_reply', 'email_received', 'outbound_positive_reply', 'linkedin_message',
];

// Outcomes the learning loop can use. 'auto' (out-of-office / bounce) is noise.
const LEARNABLE = ['interested', 'objection', 'wrong_fit', 'unsubscribe'];

const BATCH = 100;
// Each pass looks back this far. Generous overlap — resolved leads are skipped,
// so a missed or failed run is recovered on the next pass with no duplication.
const LOOKBACK_HOURS = 6;

// Classify a reply into a learnable outcome, or 'auto' for noise to discard.
async function classifyReply(text) {
  const prompt =
    `A cold outreach email received this reply:\n\n"""${text.slice(0, 1500)}"""\n\n` +
    `Classify it as exactly one of:\n` +
    `- interested — wants to talk, asks a question, positive\n` +
    `- objection — pushback ("not now", "no budget") but still engaged\n` +
    `- wrong_fit — not the right person or company, or a referral elsewhere\n` +
    `- unsubscribe — asks to stop, be removed, or opt out\n` +
    `- auto — an out-of-office, auto-reply, or bounce notice (not a real reply)\n\n` +
    `Respond as JSON: {"outcome": "<one of the above>"}`;

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 60,
    messages: [{ role: 'user', content: prompt }],
  });
  const raw = msg.content[0].text.trim();
  const json = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
  return json.outcome;
}

export async function processLeadReplies() {
  const supabase = getSupabaseClient();
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString();

  // Recent inbound reply activities, joined to the contact's email.
  const { data: activities, error } = await supabase
    .from('contact_activity_log')
    .select(
      'id, workspace_id, contact_id, activity_type, description, summary, ' +
      'raw_data, occurred_at, contacts(email)',
    )
    .in('activity_type', REPLY_ACTIVITY_TYPES)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(BATCH);

  if (error) {
    console.error('[LEAD_REPLIES] scan failed:', error.message);
    return;
  }

  let graduated = 0;

  for (const act of activities || []) {
    const email = act.contacts?.email;
    if (!email || !act.contact_id) continue;

    // Match to a lead. Skip if there is none, or it is already resolved.
    let lead;
    try {
      lead = await findLeadByEmail(supabase, act.workspace_id, email);
    } catch {
      continue;
    }
    if (!lead || lead.reply_outcome) continue;

    // Classify the reply text.
    const text =
      act.summary || act.raw_data?.text || act.raw_data?.body || act.description || '';
    if (!text.trim()) continue;

    let outcome;
    try {
      outcome = await classifyReply(text);
    } catch (e) {
      console.warn('[LEAD_REPLIES] classify failed for lead', lead.id, ':', e.message);
      continue;
    }
    // Noise (auto-reply / bounce) — leave the lead unresolved, do not pollute
    // the evidence set.
    if (!LEARNABLE.includes(outcome)) continue;

    // Graduate: record the outcome on the lead and link it to the contact the
    // reply already created.
    try {
      await updateLead(supabase, act.workspace_id, lead.id, {
        reply_outcome: outcome,
        replied_at: act.occurred_at || new Date().toISOString(),
        status: 'replied',
        contact_id: act.contact_id,
      });
      if (outcome === 'unsubscribe') {
        await addSuppression(supabase, act.workspace_id, email, 'unsubscribed via reply');
      }
      graduated++;

      logSysEvent(supabase, {
        workspaceId: act.workspace_id,
        source: 'mind',
        eventType: 'lead_graduated',
        summary: `Lead reply classified: ${outcome}`,
        contactId: act.contact_id,
        metadata: { outcome, lead_id: lead.id },
      }).catch(() => {});
    } catch (e) {
      console.warn('[LEAD_REPLIES] update failed for lead', lead.id, ':', e.message);
    }
  }

  if (graduated) console.log(`[LEAD_REPLIES] graduated ${graduated} lead(s)`);
}

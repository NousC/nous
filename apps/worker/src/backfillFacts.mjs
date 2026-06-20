// One-off backfill: purge low-value "facts" that the OLD signal extractor saved
// before the durable/decision-relevant/specific quality bar landed. It walks the
// signal_extraction `note.*` claims on a contact, asks Haiku to judge each one
// against the SAME standard the live extractor now enforces, and soft-deletes
// (invalid_at) the ones that fail — per the v2 rule, claims are never hard-deleted.
//
// SAFE BY DEFAULT: dry-run. It prints KEEP/PURGE for every fact and changes
// nothing. Pass --apply to actually invalidate the PURGE rows.
//
// Scoped to ONE contact so you can test on a single record first. Defaults to
// Mansoor; pass a contact id to target someone else.
//
// Usage (from repo root):
//   node --env-file=.env apps/worker/src/backfillFacts.mjs                 # dry-run, Mansoor
//   node --env-file=.env apps/worker/src/backfillFacts.mjs --apply         # commit, Mansoor
//   node --env-file=.env apps/worker/src/backfillFacts.mjs <contactId>     # dry-run, other contact
//   node --env-file=.env apps/worker/src/backfillFacts.mjs <contactId> --apply

import './bootEnv.mjs';
import Anthropic from 'useleak';
import { getSupabaseClient, listNotes, deleteNote } from '@nous/core';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DEFAULT_CONTACT = '0cbde5c4-3ec6-4252-ba09-f3cb24a8b35b'; // Mansoor Ali

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const contactId = args.find(a => !a.startsWith('--')) || DEFAULT_CONTACT;

// Mirror of the live extractor's "NEVER record" rules — judge an EXISTING fact
// by the same bar so the backfill and the writer agree on what a fact is.
async function judge(content) {
  const msg = await anthropic.messages.create({
    feature: 'facts-backfill-judge',
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 10,
    messages: [{ role: 'user', content: `You are cleaning a CRM's atomic-fact store. Judge ONE existing fact.

FACT: "${content}"

PURGE it if it is any of:
- Meeting logistics: scheduling, availability, a reschedule, "has a call on X", an invite sent or pending.
- Generic sentiment, small talk, or a pleasantry.
- Non-durable: true today but meaningless in a few weeks.

KEEP it if it is DURABLE (true for weeks/months) AND DECISION-RELEVANT (budget, authority, pain, goals, stack, or a real buying/project timeline) AND SPECIFIC (carries a concrete detail or reason).

Reply with ONLY one word: KEEP or PURGE` }],
  });
  return (msg.content[0]?.text || '').toUpperCase().includes('PURGE') ? 'PURGE' : 'KEEP';
}

async function main() {
  const supabase = getSupabaseClient();

  const { data: contact } = await supabase
    .from('contacts')
    .select('workspace_id, first_name, last_name')
    .eq('id', contactId)
    .maybeSingle();
  if (!contact) { console.error(`contact ${contactId} not found`); process.exit(1); }

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contactId;
  const notes = await listNotes(supabase, contact.workspace_id, { entityId: contactId, limit: 200 });

  // Only auto-extracted atomic facts — never touch manual notes or documents.
  const facts = notes.filter(n => n.source === 'signal_extraction' && !n.metadata?.doc_type);

  console.log(`\n${apply ? 'APPLY' : 'DRY-RUN'} — ${facts.length} signal_extraction facts on ${name}\n`);

  let purged = 0;
  for (const f of facts) {
    const verdict = await judge(f.content);
    console.log(`  ${verdict === 'PURGE' ? '✗ PURGE' : '✓ keep '}  [${f.category}]  ${f.content}`);
    if (verdict === 'PURGE') {
      purged++;
      if (apply) await deleteNote(supabase, contact.workspace_id, f.id);
    }
  }

  console.log(`\n${apply ? `Invalidated ${purged}` : `Would invalidate ${purged}`} of ${facts.length} facts.`);
  if (!apply && purged) console.log('Re-run with --apply to commit.\n');
}

main().catch(err => { console.error(err); process.exit(1); });

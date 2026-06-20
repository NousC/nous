// Re-mine a contact's MEETING TRANSCRIPTS with the CURRENT (improved) extractor.
//
// The live extractor only runs once, at ingest. Older meetings were mined by the
// old prompt (2-fact cap, logistics-prone) and usually only saw the short meeting
// summary — so the richer intelligence buried in the full transcript (named
// people, org dynamics, who does what, real plans) was never captured. This
// re-runs the SAME extractor (single source of truth — no prompt drift) over the
// saved transcript with a higher fact cap, dedupes against existing facts, and
// saves what's genuinely new.
//
// SAFE BY DEFAULT: dry-run. Prints candidate facts (new / dup) and writes nothing.
// Pass --apply to save the new ones.
//
// Usage (from repo root):
//   node --env-file=nous.env apps/worker/src/reextractMeetings.mjs <contactId>
//   node --env-file=nous.env apps/worker/src/reextractMeetings.mjs <contactId> --apply
//   node --env-file=nous.env apps/worker/src/reextractMeetings.mjs <contactId> --max 10 --apply
//
// In the deployed worker container (env already injected via env_file):
//   docker compose exec -T worker node apps/worker/src/reextractMeetings.mjs <contactId>

import './bootEnv.mjs';
import { getSupabaseClient, listNotes } from '@nous/core';
import { extractActivitySignals } from './signals/index.mjs';

const DEFAULT_CONTACT = '0580d1b1-94f7-4376-b677-cb3a1051610f'; // Muhammad Taimoor Ali

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const maxIdx = args.indexOf('--max');
const maxFacts = maxIdx !== -1 ? Number(args[maxIdx + 1]) : 8;
// First positional arg that isn't a flag or the --max number is the contact id.
const contactId = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a)) || DEFAULT_CONTACT;

// Meeting source text is stored as note documents. Prefer the full transcript,
// then the AI meeting-notes summary. Briefs are the agent's OWN research about the
// person (not their words), so they're excluded — extracting "facts" from those
// would attribute our research back to the prospect.
const SOURCE_TYPES = ['transcript', 'meeting_notes'];

async function main() {
  const supabase = getSupabaseClient();
  const { data: contact } = await supabase
    .from('contacts').select('workspace_id, first_name, last_name').eq('id', contactId).maybeSingle();
  if (!contact) { console.error(`contact ${contactId} not found`); process.exit(1); }

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contactId;
  const notes = await listNotes(supabase, contact.workspace_id, { entityId: contactId, limit: 200 });
  const sources = notes
    .filter(n => SOURCE_TYPES.includes(n.metadata?.doc_type) && (n.content || '').trim())
    .sort((a, b) => (b.content?.length || 0) - (a.content?.length || 0));

  if (!sources.length) { console.log(`No meeting transcript/notes on ${name}.`); process.exit(0); }

  console.log(`\n${apply ? 'APPLY' : 'DRY-RUN'} — re-extracting on ${name} (up to ${maxFacts} facts; richest source first)\n`);

  // Mine the single richest source that yields facts (transcript first, then the
  // AI summary). Stopping after the first hit avoids cross-source duplicates —
  // especially while prod dedup is degraded.
  for (const doc of sources) {
    console.log(`# trying ${doc.metadata?.doc_type} — ${doc.content.length} chars`);
    const results = await extractActivitySignals({
      supabase,
      activityId:  doc.id,
      contactId,
      workspaceId: contact.workspace_id,
      type:        'meeting_held',
      source:      'reextract',
      summary:     doc.content,
      maxFactsOverride: maxFacts,
      dryRun:      !apply,
    });
    if (!results?.length) { console.log('  (nothing cleared the bar — trying next source)\n'); continue; }
    for (const r of results) {
      const tag = r.action === 'SKIP' ? '· already have' : (apply ? '+ saved' : '+ new  ');
      console.log(`  ${tag}  [${r.category}]  ${r.content}`);
    }
    console.log('');
    break; // richest source produced facts — done
  }
}

main().catch(err => { console.error(err); process.exit(1); });

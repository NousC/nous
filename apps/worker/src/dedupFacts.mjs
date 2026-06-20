// One-off dedup sweep: collapse near-duplicate facts on a contact, keeping the
// single most complete/specific one and soft-deleting the thinner restatements.
//
// The live extractor's per-fact dedup (decideMerge) prevents most dupes going
// forward, but earlier passes — especially before dedup was fixed — left
// overlapping facts (e.g. a thin "hire after $50k MRR" next to a richer
// "won't hire beyond his co-founder until ~$50k MRR"). This batches a contact's
// auto-extracted facts through Haiku, groups the ones that express the SAME
// underlying fact, keeps the best, and invalidates the rest.
//
// SAFE BY DEFAULT: dry-run. Prints keep/remove groups, writes nothing. Pass
// --apply to soft-delete (invalid_at) the redundant ones. Only touches
// signal_extraction facts — never manual notes or documents.
//
// Usage (in the worker container, env injected via env_file):
//   docker compose exec -T worker node apps/worker/src/dedupFacts.mjs <contactId>
//   docker compose exec -T worker node apps/worker/src/dedupFacts.mjs <contactId> --apply

import './bootEnv.mjs';
import Anthropic from 'useleak';
import { getSupabaseClient, listNotes, deleteNote } from '@nous/core';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DEFAULT_CONTACT = '0580d1b1-94f7-4376-b677-cb3a1051610f'; // Muhammad Taimoor Ali

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const contactId = args.find(a => !a.startsWith('--')) || DEFAULT_CONTACT;

// Ask Haiku to group facts that restate the SAME underlying fact and pick the
// richest survivor. Facts are referenced by 1-based number to avoid UUID
// hallucination; we map back to real ids.
async function findDuplicateGroups(facts) {
  const numbered = facts.map((f, i) => `${i + 1}. ${f.content}`).join('\n');
  const msg = await anthropic.messages.create({
    feature: 'facts-dedup-sweep',
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{ role: 'user', content: `You are deduplicating a CRM's atomic facts about ONE person. Some facts restate the SAME underlying fact at different levels of detail or wording.

Group together facts that express the same underlying fact. For each group of 2 or more, KEEP the single most complete and specific fact and mark the OTHERS for removal. Facts about genuinely different things must stay separate — never merge distinct facts, and when unsure, keep them separate.

Facts:
${numbered}

Output ONLY valid JSON: [{"keep": <number>, "remove": [<numbers>], "why": "<short>"}]
Include a group ONLY if it has real duplicates (a non-empty "remove"). If there are no duplicates, return [].` }],
  });
  try {
    const text = msg.content[0]?.text ?? '[]';
    const s = text.indexOf('['), e = text.lastIndexOf(']');
    return s !== -1 && e !== -1 ? JSON.parse(text.slice(s, e + 1)) : [];
  } catch { return []; }
}

async function main() {
  const supabase = getSupabaseClient();
  const { data: contact } = await supabase
    .from('contacts').select('workspace_id, first_name, last_name').eq('id', contactId).maybeSingle();
  if (!contact) { console.error(`contact ${contactId} not found`); process.exit(1); }

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contactId;
  const notes = await listNotes(supabase, contact.workspace_id, { entityId: contactId, limit: 200 });
  const facts = notes.filter(n => n.source === 'signal_extraction' && !n.metadata?.doc_type);

  if (facts.length < 2) { console.log(`${name}: ${facts.length} fact(s) — nothing to dedup.`); process.exit(0); }

  console.log(`\n${apply ? 'APPLY' : 'DRY-RUN'} — dedup ${facts.length} facts on ${name}\n`);

  const groups = (await findDuplicateGroups(facts)).filter(g =>
    Number.isInteger(g.keep) && Array.isArray(g.remove) && g.remove.length);

  if (!groups.length) { console.log('  No duplicates found — all facts are distinct.\n'); process.exit(0); }

  let removed = 0;
  for (const g of groups) {
    const keep = facts[g.keep - 1];
    const dropped = g.remove.map(n => facts[n - 1]).filter(Boolean).filter(f => f.id !== keep?.id);
    if (!keep || !dropped.length) continue;
    console.log(`  ✓ keep    ${keep.content}`);
    for (const d of dropped) {
      console.log(`  ✗ remove  ${d.content}`);
      removed++;
      if (apply) await deleteNote(supabase, contact.workspace_id, d.id);
    }
    if (g.why) console.log(`            ↳ ${g.why}`);
    console.log('');
  }

  console.log(`${apply ? `Invalidated ${removed}` : `Would invalidate ${removed}`} of ${facts.length} facts.`);
  if (!apply && removed) console.log('Re-run with --apply to commit.\n');
}

main().catch(err => { console.error(err); process.exit(1); });

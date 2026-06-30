// Signal extraction pipeline — ported from assetly-blueprint/server.mjs
// After every qualifying private activity (LinkedIn message, email reply, meeting, Slack DM),
// Claude Haiku extracts structured CRM facts → `note.*` claims on the contact entity.
// Graph edges (REPORTS_TO, BUDGET_HOLDER_AT, etc.) extracted from each fact → workspace_graph_edges.

import Anthropic, { setUser } from 'useleak';
import { listNotes, saveNote, updateNote, searchClaims, listActivities, recordObservation,
  normalizeFactCategory, normalizeFactAbout, factCategoryPromptBlock, FACT_CATEGORY_KEYS } from '@nous/core';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Activity types that warrant signal extraction — private, content-rich interactions only.
export const SIGNAL_WORTHY_TYPES = new Set([
  'slack_dm', 'slack_message',
  'email_reply', 'email_received',
  'linkedin_message', 'linkedin_replied',
  'meeting_held',
]);

// Noise patterns — generic messages with no extractable intelligence.
const SIGNAL_NOISE = [
  /has joined the channel/i,
  /has left the channel/i,
  /has accepted your invitation/i,
  /take a second to say hello/i,
  /set the channel topic/i,
];

// ── Note dedup ────────────────────────────────────────────────────────────────
// Semantic search across `note.*` claims via the v2 search_claims RPC.
// Embeddings are filled in by the embeddings worker; if none yet, we degrade
// to no-dedup (always ADD), which is safe but slightly noisier.

async function searchSimilarNotes(supabase, workspaceId, query, threshold = 0.88, limit = 5) {
  // Restrict to note.* claims in SQL — dedup only compares against notes, and
  // scoping the candidate set keeps the search fast (hundreds of notes, not
  // tens of thousands of claims) and high-recall (the global nearest claims are
  // usually signals/features, not notes).
  const hits = await searchClaims(supabase, workspaceId, query, { threshold, limit: limit * 3, propertyPrefix: 'note.' });
  return hits
    .filter(h => h.property?.startsWith('note.'))
    .slice(0, limit)
    .map(h => ({ id: h.id, content: (h.value && h.value.content) || '' }))
    .filter(m => m.content);
}

async function decideMerge(supabase, workspaceId, newFact) {
  const similar = await searchSimilarNotes(supabase, workspaceId, newFact);
  if (similar.length === 0) return { action: 'ADD', supersedes: null };

  const existing = similar.map((f, i) => `${i + 1}. [ID:${f.id}] ${f.content}`).join('\n');
  const msg = await anthropic.messages.create({
    feature: 'note-merge-decide',
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    messages: [{ role: 'user', content: `You are managing an atomic fact memory store for a business workspace.\n\nNEW FACT: "${newFact}"\n\nSIMILAR EXISTING FACTS:\n${existing}\n\nDecide one of:\n- ADD — the new fact is distinct enough to add alongside existing ones\n- UPDATE:<ID> — the new fact supersedes one existing fact (provide the ID to replace)\n- SKIP — the new fact is already captured by an existing fact\n\nReply with ONLY one of: ADD | UPDATE:<uuid> | SKIP` }],
  });
  const reply = msg.content[0]?.text?.trim() ?? 'ADD';
  if (reply === 'SKIP')            return { action: 'SKIP',   supersedes: null };
  if (reply.startsWith('UPDATE:')) return { action: 'UPDATE', supersedes: reply.slice(7).trim() };
  return { action: 'ADD', supersedes: null };
}

// ── Graph edge extraction ─────────────────────────────────────────────────────

async function extractGraphEdges(supabase, workspaceId, factContent, sourceMemoryId, context = {}) {
  try {
    const contextHint = [
      context.contact_name ? `Subject: ${context.contact_name}` : null,
      context.company_name ? `Company: ${context.company_name}` : null,
    ].filter(Boolean).join(', ');

    const msg = await anthropic.messages.create({
      feature: 'graph-edges-extract',
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 250,
      messages: [{ role: 'user', content: `Extract relationship edges from this fact for a GTM knowledge graph. Only extract when two named entities have a clear directional relationship.

FACT: "${factContent}"${contextHint ? `\nCONTEXT: ${contextHint}` : ''}

Return a JSON array. Each edge:
{"subject_label":"name","subject_type":"contact|company|product|competitor|topic","relationship":"REPORTS_TO|DEFERS_TO_TECHNICAL|DEFERS_TO_BUDGET|DECISION_MAKER_AT|BUDGET_HOLDER_AT|CHAMPIONS|BLOCKS|EVALUATING|USES|WORKS_WITH|CHURNED_FROM|COMPETES_WITH","object_label":"name","object_type":"contact|company|product|competitor|topic"}

Examples:
"Sarah defers to Marcus on technical decisions" → [{"subject_label":"Sarah","subject_type":"contact","relationship":"DEFERS_TO_TECHNICAL","object_label":"Marcus","object_type":"contact"}]
"Jennifer controls the budget at TechFlow" → [{"subject_label":"Jennifer","subject_type":"contact","relationship":"BUDGET_HOLDER_AT","object_label":"TechFlow","object_type":"company"}]
"They use Salesforce" → [{"subject_label":"TechFlow","subject_type":"company","relationship":"USES","object_label":"Salesforce","object_type":"product"}]
"Mentioned Q2 budget" → []

Return [] if no clear two-entity relationship. ONLY valid JSON array, no other text.` }],
    });

    const text = msg.content[0]?.text?.trim() ?? '[]';
    const s = text.indexOf('['), e = text.lastIndexOf(']');
    if (s === -1 || e === -1) return;
    let edges = [];
    try { edges = JSON.parse(text.slice(s, e + 1)); } catch { return; }
    if (!Array.isArray(edges) || edges.length === 0) return;

    for (const edge of edges.slice(0, 4)) {
      if (!edge.subject_label || !edge.relationship || !edge.object_label) continue;

      let subjectId = null, objectId = null;

      if (edge.subject_type === 'contact') {
        const fn = edge.subject_label.split(' ')[0];
        const { data } = await supabase.from('contacts').select('id')
          .eq('workspace_id', workspaceId)
          .or(`first_name.ilike.${fn},email.ilike.%${edge.subject_label.toLowerCase()}%`)
          .limit(1).maybeSingle();
        subjectId = data?.id ?? context.contact_id ?? null;
      } else if (edge.subject_type === 'company') {
        const { data } = await supabase.from('companies').select('id')
          .eq('workspace_id', workspaceId).ilike('name', `%${edge.subject_label}%`).limit(1).maybeSingle();
        subjectId = data?.id ?? context.company_id ?? null;
      }

      if (edge.object_type === 'contact') {
        const fn = edge.object_label.split(' ')[0];
        const { data } = await supabase.from('contacts').select('id')
          .eq('workspace_id', workspaceId)
          .or(`first_name.ilike.${fn},email.ilike.%${edge.object_label.toLowerCase()}%`)
          .limit(1).maybeSingle();
        objectId = data?.id ?? null;
      } else if (edge.object_type === 'company') {
        const { data } = await supabase.from('companies').select('id')
          .eq('workspace_id', workspaceId).ilike('name', `%${edge.object_label}%`).limit(1).maybeSingle();
        objectId = data?.id ?? context.company_id ?? null;
      }

      await supabase.from('workspace_graph_edges').upsert({
        workspace_id:     workspaceId,
        subject_type:     edge.subject_type || 'contact',
        subject_id:       subjectId,
        subject_label:    edge.subject_label,
        relationship:     edge.relationship,
        object_type:      edge.object_type || 'contact',
        object_id:        objectId,
        object_label:     edge.object_label,
        source:           context.source || 'extraction',
        source_memory_id: sourceMemoryId ?? null,
        confidence:       0.9,
        metadata:         { fact: factContent.slice(0, 200) },
      }, { onConflict: 'workspace_id,subject_label,relationship,object_label', ignoreDuplicates: false });
    }

    if (edges.length > 0) console.log(`[GRAPH_EXTRACT] ${edges.length} edges — workspace ${workspaceId}`);
  } catch (err) {
    console.warn('[GRAPH_EXTRACT_ERROR]', err.message);
  }
}

// ── Memory summary refresh ────────────────────────────────────────────────────
// Regenerates contacts.memory_summary after new signals land — fire-and-forget.

async function refreshContactBlock(supabase, contactId, workspaceId) {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [{ data: contact }, recentActs, factList] = await Promise.all([
      supabase.from('contacts').select('first_name, last_name, email, pipeline_stage, company, summary_generated_at').eq('id', contactId).single(),
      listActivities(supabase, { contactId, since: thirtyDaysAgo, limit: 15 }),
      listNotes(supabase, workspaceId, { entityId: contactId, limit: 15 }),
    ]);
    if (!contact || (!recentActs.length && !factList.length)) return;

    // Debounce: skip if summary was regenerated in the last 30 minutes (burst protection)
    if (contact.summary_generated_at) {
      const age = Date.now() - new Date(contact.summary_generated_at).getTime();
      if (age < 30 * 60 * 1000) {
        console.log(`[CONTACT_BLOCK] skipped — regenerated ${Math.floor(age / 60000)}m ago — contact ${contactId}`);
        return;
      }
    }

    const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email;
    const actLines  = recentActs.slice(0, 8).map(a =>
      `- ${a.activity_type}${a.description ? `: ${a.description}` : ''} (${new Date(a.occurred_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
    ).join('\n');
    const factLines = factList.map(f => `- ${f.content}`).join('\n');

    const prompt = `Write a 2-sentence memory summary of ${name} for an AI sales agent. Plain prose only — no markdown, no bullets.
First sentence: who they are and where they stand in the pipeline.
Second sentence: the single most important thing to know right now — the blocker, the opportunity, or the next move.${actLines ? `\n\nRecent activity (last 30 days):\n${actLines}` : ''}${factLines ? `\n\nStored facts:\n${factLines}` : ''}\n\nSummary:`;

    const msg = await anthropic.messages.create({
      feature: 'contact-memory-summary',
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{ role: 'user', content: prompt }],
    });
    const newSummary = msg.content[0]?.text?.trim();
    if (newSummary) {
      await supabase.from('contacts').update({
        memory_summary: newSummary,
        summary_generated_at: new Date().toISOString(),
      }).eq('id', contactId);
      console.log(`[CONTACT_BLOCK] summary refreshed — contact ${contactId}`);
    }
  } catch (err) {
    console.warn('[CONTACT_BLOCK_ERROR]', err.message);
  }
}

// ── Private activity signal extractor ────────────────────────────────────────
// Extracts Budget / Timeline / Pain Points / Objections / Preferences / Relationships
// from qualifying private interactions and saves as `note.*` claims.

export async function extractActivitySignals({ supabase, activityId, contactId, workspaceId, type, source, summary, maxFactsOverride, dryRun = false }) {
  try {
    setUser({ id: String(workspaceId) });
    const { data: contact } = await supabase.from('contacts')
      .select('first_name, last_name, company').eq('id', contactId).single();

    const contactCtx = contact
      ? [[contact.first_name, contact.last_name].filter(Boolean).join(' '), contact.company].filter(Boolean).join(' at ')
      : null;
    const contactName = (contact && [contact.first_name, contact.last_name].filter(Boolean).join(' ')) || 'the contact';
    // Reaching here means the content is the contact's own words (outbound is
    // filtered out in extractAfterActivity). State that explicitly so Haiku
    // never mistakes the user's side of a thread for a fact about the contact.
    const provenance = type === 'meeting_held'
      ? `These are notes/transcript from a meeting with ${contactName}.`
      : `This is a message that ${contactName} sent to you (the user) — these are ${contactName}'s own words, not yours.`;

    const channelLabel = {
      slack_dm:         'Slack DM',
      slack_message:    'Slack channel message',
      email_reply:      'email reply',
      email_received:   'inbound email',
      linkedin_message: 'LinkedIn message',
      linkedin_replied: 'LinkedIn reply',
      meeting_held:     'meeting notes/transcript',
    }[type] || type;

    // Meetings are content-rich, so they earn a few more facts than a single
    // message — but the quality bar below is identical either way. A deliberate
    // re-extract pass over a full transcript can raise the cap via override.
    const maxFacts = maxFactsOverride ?? (type === 'meeting_held' ? 4 : 2);

    const msg = await anthropic.messages.create({
      feature: 'activity-signals-extract',
      model: 'claude-haiku-4-5-20251001',
      // Scale the output budget with the fact cap — a deep transcript re-extract
      // asking for up to 8 detailed facts needs more room than a 2-fact message,
      // or the JSON array truncates mid-fact and fails to parse (→ zero facts).
      max_tokens: Math.min(2000, Math.max(400, maxFacts * 130)),
      messages: [{ role: 'user', content: `Extract durable CRM intelligence about ${contactName} from this private ${channelLabel}.
${provenance}
Record facts ONLY about ${contactName}, drawn from what THEY reveal about themselves, their company, needs, constraints, opinions, or plans. NEVER turn the user's own questions, offers, or statements into facts about ${contactName} (e.g. if the user asked "what's behind your product?", that is NOT a fact that ${contactName} is interested in the user's product).
${contactCtx ? `Contact: ${contactCtx}` : ''}

Message: "${summary}"

A fact is worth recording ONLY if it passes ALL THREE bars:
1. DURABLE — still true weeks or months from now. A meeting time, an availability, or a reschedule is NOT durable.
2. DECISION-RELEVANT — it would change how someone sells to or works with ${contactName}: their budget, authority, pain, goals, stack, or buying timeline.
3. SPECIFIC — it carries the concrete detail or the reason WHY, not a vague label. "Evaluating Clay vs Apollo because Apollo's data went stale", not "looking at tools".

NEVER record (noise, or it already lives elsewhere in the CRM):
- Meeting logistics: scheduling, availability, reschedules, "has a call on X", invites sent or pending.
- Generic sentiment, small talk, greetings, pleasantries.
- Anything true today but meaningless next week.

Tag each fact with exactly one category, and whether it is about the person or their company.

Categories:
${factCategoryPromptBlock()}

Rules:
- Each fact is one self-contained sentence naming ${contactName} explicitly (no pronouns).
- Set "category" to exactly one of: ${FACT_CATEGORY_KEYS.join(', ')}.
- Set "about" to "person" for a fact about ${contactName}, or "company" for a fact about their company.
- Prefer fewer, sharper facts over more. If nothing clears all three bars, return [].
- Maximum ${maxFacts} facts.

Output ONLY valid JSON: [{"content": "...", "category": "<one category key>", "about": "person|company"}]
If nothing meaningful: []` }],
    });

    let facts = [];
    try {
      const text = msg.content[0]?.text?.trim() ?? '[]';
      const s = text.indexOf('['), e = text.lastIndexOf(']');
      if (s !== -1 && e !== -1) facts = JSON.parse(text.slice(s, e + 1));
    } catch { return []; }

    if (!Array.isArray(facts) || facts.length === 0) return [];

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const results = [];

    for (const fact of facts.slice(0, maxFacts)) {
      if (!fact.content || typeof fact.content !== 'string') continue;

      const { action, supersedes } = await decideMerge(supabase, workspaceId, fact.content);
      if (action === 'SKIP') { results.push({ ...fact, action: 'SKIP' }); continue; }

      // Preview mode (re-extract dry-run): report what WOULD be saved, write nothing.
      if (dryRun) { results.push({ ...fact, action }); continue; }

      let newMem = null;
      try {
        newMem = await saveNote(supabase, workspaceId, {
          entityId: contactId,
          category: normalizeFactCategory(fact.category),
          content:  fact.content,
          source:   'signal_extraction',
          metadata: {
            about:              normalizeFactAbout(fact.about),
            signal_type:        type,
            extraction_source:  source,
            source_activity_id: activityId || null,
            graph_layer:        'private',
          },
        });
      } catch (err) {
        console.warn('[SIGNAL_EXTRACTOR] Insert error:', err.message);
        continue;
      }

      if (action === 'UPDATE' && supersedes && uuidRe.test(supersedes)) {
        await updateNote(supabase, workspaceId, supersedes, { is_active: false }).catch(() => {});
      }

      if (newMem) {
        extractGraphEdges(supabase, workspaceId, fact.content, newMem.id, {
          contact_id: contactId,
          source: 'signal_extraction',
        }).catch(() => {});
      }
      results.push({ ...fact, action });
    }

    console.log(`[SIGNAL_EXTRACTOR] ${results.length} facts — ${type}/${source} — contact ${contactId}`);

    // Refresh the pre-computed memory_summary on the contact (skip in dry-run).
    if (!dryRun) refreshContactBlock(supabase, contactId, workspaceId).catch(() => {});
    return results;
  } catch (err) {
    console.warn('[SIGNAL_EXTRACTOR_ERROR]', err.message);
    return [];
  }
}

// ── Email action items ───────────────────────────────────────────────────────
// Mine commitments/asks out of an email and record them as action_item.* state
// observations (Phase 1's store; see reference-nous-action-items). Runs on BOTH
// directions — an outbound "I'll send the deck" is the user's own commitment, so
// this can't sit behind the inbound-only guard that the facts extractor uses.
// owner is decided from the email's direction + who is committing/being asked.
const EMAIL_TYPES = new Set(['email_reply', 'email_received']);

async function extractEmailActionItems({ supabase, activityId, contactId, workspaceId, source, summary, isOutbound }) {
  if (!summary || summary.length < 40) return;
  const { data: c } = await supabase.from('contacts').select('first_name, last_name').eq('id', contactId).maybeSingle();
  const name = [c?.first_name, c?.last_name].filter(Boolean).join(' ') || 'the contact';
  const direction = isOutbound === true
    ? `This email was SENT BY the user (the founder / account owner) TO ${name}.`
    : `This email was RECEIVED FROM ${name} (the prospect), addressed to the user.`;

  const msg = await anthropic.messages.create({
    feature: 'email-action-items',
    model:   'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{ role: 'user', content:
`Extract concrete action items / commitments from this email. ${direction}

Tag each item's owner:
- "user" — the founder owes it (the user promised to do something, OR ${name} asked the user to do something)
- "prospect" — ${name} owes it (they promised, OR the user asked them to do it)

Only a CONCRETE commitment or explicit ask with a clear deliverable (send X, schedule Y, review Z, follow up by <date>). Skip greetings, FYIs, vague statements. Be strict — if nothing is clearly actionable, return [].

Email:
"""${summary.slice(0, 6000)}"""

Output ONLY valid JSON, max 4 items:
[{"title":"<imperative, names the deliverable>","owner_kind":"user|prospect","due_phrase":"<timing if stated, else null>"}]` }],
  });

  let items = [];
  try {
    const t = msg.content?.[0]?.text ?? '[]';
    const s = t.indexOf('['), e = t.lastIndexOf(']');
    if (s !== -1 && e !== -1) items = JSON.parse(t.slice(s, e + 1));
  } catch { return; }

  let n = 0;
  for (let i = 0; i < items.length && i < 4; i++) {
    const it = items[i];
    if (!it?.title || typeof it.title !== 'string') continue;
    const rec = await recordObservation(supabase, {
      workspaceId, entityId: contactId, kind: 'state',
      property: `action_item.email_${activityId}_${i}`,
      value: {
        title:       it.title.trim(),
        owner_kind:  it.owner_kind === 'prospect' ? 'prospect' : 'user',
        status:      'open',
        due_phrase:  it.due_phrase || null,
        source_type: 'email',
        source_id:   activityId,
      },
      source:     source || 'email',
      method:     'extraction',
      externalId: `action_item_email_${activityId}_${i}`,
    }).catch(() => null);
    if (rec) n++;
  }
  if (n) console.log(`[ACTION_ITEMS] ${n} from email — contact ${contactId}`);
}

// ── Public export — call this after every logActivity ────────────────────────

export async function extractAfterActivity(supabase, activityResult, { contactId, workspaceId, type, source, summary, isOutbound }) {
  if (!activityResult?.id) return;
  if (!SIGNAL_WORTHY_TYPES.has(type)) return;
  if (!summary || summary.length < 20) return;
  if (SIGNAL_NOISE.some(p => p.test(summary))) return;

  // Action items mine BOTH directions (the user's own "I'll send X" counts), so
  // they run before the inbound-only guard below.
  if (EMAIL_TYPES.has(type)) {
    setImmediate(() =>
      extractEmailActionItems({ supabase, activityId: activityResult.id, contactId, workspaceId, source, summary, isOutbound })
        .catch(err => console.warn('[ACTION_ITEM_HOOK_ERROR]', err.message))
    );
  }

  // Never extract "facts about the contact" from a message the USER sent — that
  // would attribute our own questions/offers to them (e.g. "interested in X"
  // when we were the one asking about X). Only the contact's own words (inbound
  // messages, meeting transcripts) describe the contact.
  if (isOutbound === true) return;

  setImmediate(() =>
    extractActivitySignals({
      supabase,
      activityId:  activityResult.id,
      contactId,
      workspaceId,
      type,
      source,
      summary,
    }).catch(err => console.warn('[SIGNAL_HOOK_ERROR]', err.message))
  );
}

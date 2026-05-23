// Signal extraction pipeline — ported from assetly-blueprint/server.mjs
// After every qualifying private activity (LinkedIn message, email reply, meeting, Slack DM),
// Claude Haiku extracts structured CRM facts → `note.*` claims on the contact entity.
// Graph edges (REPORTS_TO, BUDGET_HOLDER_AT, etc.) extracted from each fact → workspace_graph_edges.

import Anthropic from '@anthropic-ai/sdk';
import { listNotes, saveNote, updateNote, searchClaims, listActivities, mirrorStateToObservations } from '@nous/core';

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
  const hits = await searchClaims(supabase, workspaceId, query, { threshold, limit: limit * 3 });
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
      void mirrorStateToObservations(supabase, {
        workspaceId, entityId: contactId, type: 'person', source: 'signal_extraction',
        facts: { memory_summary: newSummary },
      }).catch(() => {});
      console.log(`[CONTACT_BLOCK] summary refreshed — contact ${contactId}`);
    }
  } catch (err) {
    console.warn('[CONTACT_BLOCK_ERROR]', err.message);
  }
}

// ── Private activity signal extractor ────────────────────────────────────────
// Extracts Budget / Timeline / Pain Points / Objections / Preferences / Relationships
// from qualifying private interactions and saves as `note.*` claims.

async function extractActivitySignals({ supabase, activityId, contactId, workspaceId, type, source, summary }) {
  try {
    const { data: contact } = await supabase.from('contacts')
      .select('first_name, last_name, company').eq('id', contactId).single();

    const contactCtx = contact
      ? [[contact.first_name, contact.last_name].filter(Boolean).join(' '), contact.company].filter(Boolean).join(' at ')
      : null;

    const channelLabel = {
      slack_dm:         'Slack DM',
      slack_message:    'Slack channel message',
      email_reply:      'email reply',
      email_received:   'inbound email',
      linkedin_message: 'LinkedIn message',
      linkedin_replied: 'LinkedIn reply',
      meeting_held:     'meeting notes/transcript',
    }[type] || type;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: `Extract CRM intelligence from this private ${channelLabel}.
${contactCtx ? `Contact: ${contactCtx}` : ''}

Message: "${summary}"

Extract ONLY concrete, actionable facts that reveal:
- Budget or pricing opinions (e.g. "thinks $X is fair", "budget tight until Q2")
- Decision makers or approval blockers (e.g. "needs CEO approval from Thomas Johnson")
- Objections or concerns (e.g. "onboarding felt inefficient")
- Feature preferences or praise (e.g. "loves the dashboard feature")
- Timeline signals (e.g. "wants to start in June", "waiting on Q1 results")
- Relationship intelligence (e.g. "was referred by Jane Smith")

Rules:
- Each fact is one self-contained sentence naming the subject explicitly (no pronouns)
- Skip greetings, generic sentiment, small talk, system messages
- Maximum 2 facts — only extract if genuinely actionable

Output ONLY valid JSON: [{"content": "...", "category": "Budget|Timeline|Pain Points|Objections|Preferences|Relationships|General"}]
If nothing meaningful: []` }],
    });

    let facts = [];
    try {
      const text = msg.content[0]?.text?.trim() ?? '[]';
      const s = text.indexOf('['), e = text.lastIndexOf(']');
      if (s !== -1 && e !== -1) facts = JSON.parse(text.slice(s, e + 1));
    } catch { return; }

    if (!Array.isArray(facts) || facts.length === 0) return;

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    for (const fact of facts) {
      if (!fact.content || typeof fact.content !== 'string') continue;

      const { action, supersedes } = await decideMerge(supabase, workspaceId, fact.content);
      if (action === 'SKIP') continue;

      let newMem = null;
      try {
        newMem = await saveNote(supabase, workspaceId, {
          entityId: contactId,
          category: fact.category || 'General',
          content:  fact.content,
          source:   'signal_extraction',
          metadata: {
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
    }

    console.log(`[SIGNAL_EXTRACTOR] ${facts.length} facts — ${type}/${source} — contact ${contactId}`);

    // Refresh the pre-computed memory_summary on the contact
    refreshContactBlock(supabase, contactId, workspaceId).catch(() => {});
  } catch (err) {
    console.warn('[SIGNAL_EXTRACTOR_ERROR]', err.message);
  }
}

// ── Public export — call this after every logActivity ────────────────────────

export async function extractAfterActivity(supabase, activityResult, { contactId, workspaceId, type, source, summary }) {
  if (!activityResult?.id) return;
  if (!SIGNAL_WORTHY_TYPES.has(type)) return;
  if (!summary || summary.length < 20) return;
  if (SIGNAL_NOISE.some(p => p.test(summary))) return;

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

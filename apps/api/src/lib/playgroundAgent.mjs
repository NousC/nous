// Playground chat agent — the loop behind /playground.
//
// User types a question ("What do we know about Arnold?"). We hand it to
// Haiku with the six READ-ONLY Nous verbs as tools. Haiku picks which to
// call, calls them through @nous/core (in-process — no HTTP self-call),
// and synthesises a natural-language answer. We return both the answer
// AND a structured trace of every tool call so the right-hand panel can
// show the substrate working in real time.
//
// Read-only by design — no `record` tool here. The Playground must not
// pollute the user's workspace from experiments. CRM mutations stay on
// the explicit code paths (SDK, MCP, /v2/observations).

import Anthropic from '@anthropic-ai/sdk';
import {
  assembleContext, CONTEXT_INTENTS,
  resolveFocus, getAccountRecord, verifyClaim,
  runQuery, getAttention,
  classifyIdentifiers,
  listNotes, getWorkspaceEntityId,
} from '@nous/core';

const MODEL       = 'claude-haiku-4-5-20251001';
const MAX_TURNS   = 6;          // hard cap on tool-call iterations per message
const MAX_TOKENS  = 1500;
const SYSTEM_PROMPT = [
  "You are the Nous Playground assistant. The user is exploring what their Nous workspace knows — try their questions out before they integrate the API into their own agent.",
  "",
  "You have seven READ-ONLY tools for inspecting the workspace. Pick the smallest set that answers the question:",
  "  • get_workspace_facts — workspace-level facts the user has explicitly recorded: ICP, target market, product details, pricing, competitors, playbooks. ALWAYS use this for 'what's our ICP', 'who do we target', 'what's our pricing', 'what differentiates us'.",
  "  • get_context         — engineered context block for a task about one entity + intent. Best for 'help me draft', 'what should I do about', 'prep me for'.",
  "  • get_account         — the full Account Record (every claim with epistemics + recent observation timeline). Best for 'what do we know about', 'tell me about', 'show me' for ONE PERSON OR COMPANY.",
  "  • query               — retrieve+summarise observations across many entities for a corpus question. Best for 'across all', 'last 30 days', 'which segments'. NOT for workspace-level facts — those are in get_workspace_facts.",
  "  • attention           — workspace-wide: who's gone quiet, what facts have decayed. Best for 'what needs attention', 'who should I follow up with'.",
  "  • verify              — re-check one claim against current observations. Best for 'is X still true', 'verify that'.",
  "  • classify            — cross-list dedup for cold-outbound — net_new vs engaged vs bounced. Best for 'have I touched these leads', 'pre-flight check'.",
  "",
  "WHERE THINGS LIVE — important distinction:",
  "  - Workspace-level facts (ICP, market, pricing, product, competitors, playbooks) → get_workspace_facts",
  "  - Per-person/per-company claims (title, stage, intent, sentiment, observations) → get_account or get_context",
  "If asked about the user's OWN business (what we sell, who we target, how we price), reach for get_workspace_facts FIRST.",
  "",
  "Focus identifiers are universal: pass an email, domain, LinkedIn URL, entity UUID, or a name. If a name returns ambiguous, surface the candidates and ask the user to pick.",
  "",
  "Rules:",
  "  1. Ground every claim you make in tool output. If a tool returns nothing, say so plainly — never invent.",
  "  2. Prefer concise answers. The right-hand panel will show the raw API responses; you don't need to dump JSON.",
  "  3. When you cite a fact, briefly note its source/freshness if the tool exposed it (e.g. 'from HubSpot, 3 days old').",
  "  4. If the user asks for something a tool can't do (e.g. writing data), say it's read-only and point them at /install for the SDK.",
].join('\n');

// ─── Tool schemas — what we give Haiku ──────────────────────────────────────

const TOOLS = [
  {
    name: 'get_workspace_facts',
    description: "Workspace-level facts the user has explicitly recorded about THEIR OWN business — ICP, target market, product, pricing, competitors, playbooks. These are NOT facts about individual people or companies; they are the user's own playbook. Use this for any question about the user's ICP, target buyer, pricing, market, or differentiators. Optional category filter (common categories: 'ICP', 'Market', 'Product', 'Pricing', 'Competitors').",
    input_schema: {
      type: 'object',
      properties: {
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional. Filter to these categories (e.g. ["ICP"]). Omit to load all categories.',
        },
        limit: { type: 'number', description: 'Max facts to return (default 50)' },
      },
    },
  },
  {
    name: 'get_context',
    description: 'Engineered context block for one entity + intent. Returns the budgeted, ranked, claim-tagged context an agent would consume before acting. Focus accepts email, domain, LinkedIn URL, UUID, or a name (ambiguous names return candidates).',
    input_schema: {
      type: 'object',
      properties: {
        focus:         { type: 'string', description: 'email / domain / LinkedIn / UUID / name' },
        intent:        { type: 'string', enum: CONTEXT_INTENTS, description: 'the task you are about to do' },
        budget_tokens: { type: 'number', description: 'optional token budget for the assembled context' },
      },
      required: ['focus'],
    },
  },
  {
    name: 'get_account',
    description: 'The full Account Record: entity + every claim with epistemics (source, freshness, confidence) + recent observation timeline. Use when the user wants to know WHAT you know about a person or company.',
    input_schema: {
      type: 'object',
      properties: { focus: { type: 'string', description: 'email / domain / LinkedIn / UUID / name' } },
      required: ['focus'],
    },
  },
  {
    name: 'query',
    description:
      'Retrieve + compact observations across many entities. The substrate retrieves; you find the pattern.\n\n' +
      'Three powers:\n' +
      '  1. `return:"entities"` groups results by entity (one row per person/company). Use for "hottest leads", "who replied this week", "who\'s in evaluating stage".\n' +
      '  2. `without` subtracts entities — "sent in 5d MINUS replied in 5d" gives you "no-reply in 5d". "any activity in 30d MINUS activity in 5d" gives you "cooled in 5d".\n' +
      '  3. `rollups.by_value` appears when scope.kind="state" — counts entities by current value. Use for funnel reports (scope.property="stage").',
    input_schema: {
      type: 'object',
      properties: {
        scope: {
          type: 'object',
          description: 'Primary filter: { kind?, property?, source?, entity_id?, since_days?, limit? }. kind=event for interactions, kind=state for facts.',
        },
        without: {
          type: 'object',
          description: 'Optional set-subtract filter — same shape as scope. Entities matching scope MINUS entities matching without.',
        },
        return: {
          type: 'string',
          enum: ['observations', 'entities'],
          description: 'observations (default) = one row per observation. entities = one row per entity (grouped, ranked by most-recent matching activity).',
        },
        question: { type: 'string', description: 'optional analytical question — echoed back; enables semantic ranking when set' },
      },
      required: ['scope'],
    },
  },
  {
    name: 'attention',
    description: 'Workspace-wide ranked decisions: accounts gone quiet, key facts decayed. Each item comes with a suggested action.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'max items, default 10' } },
    },
  },
  {
    name: 'verify',
    description: 'Re-derive one claim from current observations. Returns before+after — the calibration check. Use when the user wants to know if a fact is still reliable.',
    input_schema: {
      type: 'object',
      properties: {
        focus:    { type: 'string', description: 'email / domain / LinkedIn / UUID / name' },
        property: { type: 'string', description: 'the claim property, e.g. "title" or "stage"' },
      },
      required: ['focus', 'property'],
    },
  },
  {
    name: 'classify',
    description: 'Cross-list cold-outbound dedup. Pass emails and/or LinkedIn URLs — get back net_new / engaged / recent / bounced / unsubscribed / suppressed for each.',
    input_schema: {
      type: 'object',
      properties: {
        emails:        { type: 'array', items: { type: 'string' } },
        linkedin_urls: { type: 'array', items: { type: 'string' } },
      },
    },
  },
];

// ─── Tool dispatcher — runs a tool call against the live substrate ──────────

async function executeTool(supabase, workspaceId, name, input) {
  switch (name) {
    case 'get_workspace_facts': {
      const workspaceEntityId = await getWorkspaceEntityId(supabase, workspaceId);
      if (!workspaceEntityId) {
        return { facts: [], note: 'No workspace entity yet — no facts have been recorded.' };
      }
      const notes = await listNotes(supabase, workspaceId, {
        entityId: workspaceEntityId,
        categories: Array.isArray(input.categories) && input.categories.length ? input.categories : undefined,
        limit: typeof input.limit === 'number' ? input.limit : 50,
      });
      const facts = notes.map(n => ({
        id: n.id,
        category: n.category,
        content: n.content,
        source: n.source,
        recorded_at: n.created_at,
      }));
      const by_category = {};
      for (const f of facts) by_category[f.category] = (by_category[f.category] || 0) + 1;
      return { facts, count: facts.length, by_category };
    }
    case 'get_context': {
      const intent = input.intent ?? 'account_review';
      if (!CONTEXT_INTENTS.includes(intent)) return { error: 'invalid_intent', valid: CONTEXT_INTENTS };
      const res = await resolveFocus(supabase, workspaceId, String(input.focus));
      if (res.status === 'not_found') return { error: 'entity_not_found' };
      if (res.status === 'ambiguous') return { status: 'ambiguous', candidates: res.candidates };
      const ctx = await assembleContext(supabase, workspaceId, res.entity_id, intent, input.budget_tokens);
      return ctx ?? { error: 'entity_not_found' };
    }
    case 'get_account': {
      const res = await resolveFocus(supabase, workspaceId, String(input.focus));
      if (res.status === 'not_found') return { error: 'entity_not_found' };
      if (res.status === 'ambiguous') return { status: 'ambiguous', candidates: res.candidates };
      const acc = await getAccountRecord(supabase, workspaceId, res.entity_id);
      return acc ?? { error: 'entity_not_found' };
    }
    case 'query': {
      const out = await runQuery(supabase, workspaceId, input.scope ?? {}, input.question, {
        return: input.return,
        without: input.without,
      });
      return { ...out, question: input.question ?? null };
    }
    case 'attention': {
      return await getAttention(supabase, workspaceId, { limit: input.limit });
    }
    case 'verify': {
      const res = await resolveFocus(supabase, workspaceId, String(input.focus));
      if (res.status === 'not_found') return { error: 'entity_not_found' };
      if (res.status === 'ambiguous') return { status: 'ambiguous', candidates: res.candidates };
      const { before, after } = await verifyClaim(supabase, workspaceId, res.entity_id, input.property);
      if (!after) return { error: 'claim_not_found' };
      return { property: input.property, before, after };
    }
    case 'classify': {
      const emails        = Array.isArray(input.emails)        ? input.emails        : [];
      const linkedin_urls = Array.isArray(input.linkedin_urls) ? input.linkedin_urls : [];
      if (!emails.length && !linkedin_urls.length) {
        return { error: 'identifiers_required', message: 'pass emails or linkedin_urls' };
      }
      const results = await classifyIdentifiers(supabase, workspaceId, { emails, linkedin_urls });
      const summary = { net_new: 0, engaged: 0, recent: 0, bounced: 0, unsubscribed: 0, suppressed: 0, total: results.length };
      for (const r of results) summary[r.status] = (summary[r.status] || 0) + 1;
      return { results, summary };
    }
    default:
      return { error: 'unknown_tool', name };
  }
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Run one chat turn against the user's workspace.
 *
 * @param {object}      args
 * @param {object}      args.supabase     — service-role Supabase client
 * @param {string}      args.workspaceId
 * @param {Array<{role: 'user'|'assistant', content: string}>} args.history  — prior conversation (oldest → newest), excluding the current user message
 * @param {string}      args.userMessage  — the message just typed by the user
 * @returns {Promise<{ content: string, toolCalls: Array<{name, input, output, duration_ms, status, error?}> }>}
 */
export async function runPlaygroundTurn({ supabase, workspaceId, history, userMessage }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  const anthropic = new Anthropic({ apiKey });

  // Build the Anthropic-shape message list. We never persist assistant tool_use
  // blocks (they belong to the orchestrator's internal loop); the DB stores
  // the user-visible text only + a sidecar tool_calls array.
  const messages = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const toolCalls = [];
  let finalText = '';

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await anthropic.messages.create({
      model:      MODEL,
      max_tokens: MAX_TOKENS,
      system:     SYSTEM_PROMPT,
      tools:      TOOLS,
      messages,
    });

    // Surface any text Haiku produced this turn (it may interleave text + tool_use).
    const texts = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
    if (texts) finalText += (finalText ? '\n\n' : '') + texts;

    // If Haiku didn't ask for tools, we're done.
    const toolUses = resp.content.filter(b => b.type === 'tool_use');
    if (toolUses.length === 0 || resp.stop_reason !== 'tool_use') {
      break;
    }

    // Execute every requested tool, in order, and collect tool_result blocks
    // to feed back to Haiku for synthesis.
    const toolResultBlocks = [];
    for (const tu of toolUses) {
      const startedAt = Date.now();
      let output, status = 'ok', error;
      try {
        output = await executeTool(supabase, workspaceId, tu.name, tu.input ?? {});
        if (output && typeof output === 'object' && output.error) {
          status = 'error'; error = output.error;
        }
      } catch (e) {
        status = 'error';
        error = e.message || String(e);
        output = { error: 'tool_threw', message: error };
      }
      const duration_ms = Date.now() - startedAt;
      toolCalls.push({ name: tu.name, input: tu.input ?? {}, output, duration_ms, status, error });
      toolResultBlocks.push({
        type:        'tool_result',
        tool_use_id: tu.id,
        // Anthropic accepts string content here; cap to keep the next prompt bounded.
        content:     JSON.stringify(output ?? null).slice(0, 24_000),
        is_error:    status === 'error',
      });
    }

    // Append the assistant tool-use turn + our tool_result turn, then loop.
    messages.push({ role: 'assistant', content: resp.content });
    messages.push({ role: 'user',      content: toolResultBlocks });
  }

  if (!finalText) {
    finalText = "I couldn't compose an answer for that — try rephrasing the question or asking about a specific person, company, or list.";
  }
  return { content: finalText, toolCalls };
}

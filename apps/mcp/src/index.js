#!/usr/bin/env node

/**
 * Nous MCP Server — the context layer for GTM agents.
 *
 * Reads from and writes to the v2 evidence substrate via the Context API.
 * The agent never sees raw rows — it gets engineered, epistemics-tagged
 * context. It never "updates" — it records observations; Nous derives.
 *
 * Required env:
 *   NOUS_API_KEY   — workspace API key (Settings -> API Keys)
 * Optional:
 *   NOUS_API_URL   — API base URL (default: https://api.opennous.cloud)
 *
 * Tools:
 *   get_context   — engineered context for a task (draft_email, follow_up, ...)
 *   get_account   — the full account record: every claim + the timeline
 *   record        — record what happened / what you learned (observe, never update)
 *   list_contacts — list contacts by stage/urgency      (transitional, v1)
 *   search        — semantic search across stored facts (transitional, v1)
 *   get_memories  — workspace-level facts (ICP, product) (transitional, v1)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { validateConfig, get, post } from "./client.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

function relAge(ts) {
  if (!ts) return "—";
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  if (d < 1)   return "today";
  if (d === 1) return "1d ago";
  if (d < 30)  return `${d}d ago`;
  const m = Math.floor(d / 30);
  if (m < 12)  return `${m}mo ago`;
  return `${Math.floor(m / 12)}y ago`;
}

const fmtType = (p) => (p || "").replace(/^interaction\./, "").replace(/_/g, " ");
const fmtVal  = (v) => (v != null && typeof v === "object") ? JSON.stringify(v) : String(v ?? "");
const pct     = (c) => `${Math.round((c ?? 0) * 100)}%`;

validateConfig();

const server = new McpServer({
  name: "nous",
  version: "0.9.0",
  description:
    "Nous — the context layer for GTM agents. Call get_context before drafting outreach or " +
    "preparing for a meeting. Call record after every interaction, or whenever you learn something.",
  icons: [
    { src: "https://opennous.cloud/newlogoP.png", mimeType: "image/png", sizes: ["64x64"] },
  ],
});

// ===========================================================================
// TOOL: get_context  —  POST /v2/context
// The headline tool. Engineered, intent-shaped context for a specific task.
// ===========================================================================
server.tool(
  "get_context",
  "Get engineered context for a specific task about a person or company. Pass their email (or " +
  "entity id) and the intent. Returns a focused, ranked context block: the facts that matter for " +
  "that task — each with a confidence and a freshness — plus the recent timeline, the buying-group " +
  "stakeholders, and open predictions. Call this before drafting outreach, preparing for a meeting, " +
  "or making any decision about a person. A fact's freshness tells you whether to trust it: 'fresh' " +
  "act on it, 'suspect'/'expired' verify first.",
  {
    focus: z.string().describe("Email address or entity UUID of the person or company"),
    intent: z.enum(["draft_email", "follow_up", "meeting_prep", "call_prep", "account_review"])
      .optional()
      .describe("What you are about to do — shapes which context surfaces (default: account_review)"),
    budget_tokens: z.number().optional().describe("Approximate token budget for the context block"),
  },
  async ({ focus, intent, budget_tokens }) => {
    const ctx = await post("/v2/context", { focus, intent: intent ?? "account_review", budget_tokens });
    const lines = [ctx.summary, ""];

    if (ctx.claims?.length) {
      lines.push(`FACTS (${ctx.meta?.claims_returned ?? ctx.claims.length}):`);
      for (const c of ctx.claims) {
        lines.push(`  ${c.property}: ${fmtVal(c.value)}  [${pct(c.confidence)} · ${c.freshness}]`);
      }
      lines.push("");
    }
    if (ctx.timeline?.length) {
      lines.push("TIMELINE:");
      for (const t of ctx.timeline) {
        if (t.tier === "count") lines.push(`  ${t.count}× ${fmtType(t.type)}`);
        else lines.push(`  ${relAge(t.when)}  ${fmtType(t.type)}${t.summary ? `: ${t.summary}` : ""}`);
      }
      lines.push("");
    }
    if (ctx.stakeholders?.length) {
      lines.push("STAKEHOLDERS:");
      for (const s of ctx.stakeholders) lines.push(`  ${s.name ?? "—"} — ${s.role ?? ""}`);
      lines.push("");
    }
    if (ctx.predictions?.length) {
      lines.push("PREDICTIONS:");
      for (const p of ctx.predictions) {
        lines.push(`  ${p.kind}: ${fmtVal(p.value)} (${pct(p.confidence)})`);
      }
    }
    return {
      content: [{ type: "text", text: `${lines.join("\n").trim()}\n\n(entity_id: ${ctx.entity?.id})` }],
    };
  }
);

// ===========================================================================
// TOOL: get_account  —  GET /v2/accounts/:id
// The full account-record projection. For a focused view, prefer get_context.
// ===========================================================================
server.tool(
  "get_account",
  "Get the full account record for a person or company — every known fact (claim) with its " +
  "confidence and freshness, plus the recent activity timeline. Pass an email or entity UUID. " +
  "For a task-specific, ranked view, prefer get_context.",
  { id: z.string().describe("Email address or entity UUID") },
  async ({ id }) => {
    const rec = await get(`/v2/accounts/${encodeURIComponent(id)}`);
    const lines = [`${rec.type} · ${rec.entity_id}`, ""];

    const claims = Object.values(rec.claims ?? {});
    if (claims.length) {
      lines.push(`FACTS (${claims.length}):`);
      for (const c of claims) {
        lines.push(`  ${c.property}: ${fmtVal(c.value)}  [${pct(c.confidence)} · ${c.freshness}]`);
      }
      lines.push("");
    }
    const obs = rec.recent_observations ?? [];
    if (obs.length) {
      lines.push(`TIMELINE (${obs.length}):`);
      for (const o of obs.slice(0, 30)) {
        lines.push(`  ${relAge(o.observed_at)}  ${fmtType(o.property)}`);
      }
    }
    return { content: [{ type: "text", text: lines.join("\n").trim() }] };
  }
);

// ===========================================================================
// TOOL: record  —  POST /v2/observations
// The single write verb. You observe — Nous derives the updated facts.
// ===========================================================================
server.tool(
  "record",
  "Record what happened or what you learned about a person or company. You never overwrite " +
  "anything — you observe, and Nous derives the updated facts. Use kind:'event' for an interaction " +
  "(property like 'interaction.email_sent', 'interaction.call_held', 'interaction.email_reply') and " +
  "kind:'state' for a fact (property like 'job_title', 'deal.proposal_amount'). Examples — sent an " +
  "email: {kind:'event',property:'interaction.email_sent',value:{description:'intro email'}}; " +
  "learned their title changed: {kind:'state',property:'job_title',value:'VP of Engineering'}; " +
  "a fact ended (they left): {kind:'state',property:'job_title',value:null}.",
  {
    focus: z.string().describe("Email address or entity UUID of the person or company"),
    observations: z.array(z.object({
      kind: z.enum(["event", "state"]).describe("event = an interaction; state = a fact"),
      property: z.string().describe("e.g. 'interaction.email_sent' or 'job_title'"),
      value: z.any().optional().describe("the event detail or the fact value; null = the fact ended"),
      source: z.string().optional().describe("where this came from (default: agent)"),
    })).describe("One or more observations to record"),
  },
  async ({ focus, observations }) => {
    const result = await post("/v2/observations", { focus, observations });
    const parts = [`Recorded ${result.recorded} observation${result.recorded !== 1 ? "s" : ""}.`];
    if (result.claims_recomputed?.length) {
      parts.push(`Facts updated: ${result.claims_recomputed.join(", ")}.`);
    }
    parts.push(`(entity_id: ${result.entity_id})`);
    return { content: [{ type: "text", text: parts.join("\n") }] };
  }
);

// ===========================================================================
// TRANSITIONAL — v1-backed. These migrate to /v2/query when it ships.
// ===========================================================================

server.tool(
  "list_contacts",
  "List contacts sorted by urgency (high ICP + longest since last touch first). Use stage to focus " +
  "on a pipeline stage. Contacts marked !! are high-ICP and have gone cold — prioritize those.",
  {
    stage: z.enum(["identified", "aware", "interested", "evaluating", "client"]).optional()
      .describe("Filter by pipeline stage — omit to list all"),
    limit: z.number().min(1).max(50).optional().describe("Max contacts (default 20)"),
  },
  async ({ stage, limit = 20 }) => {
    const params = { limit, sort: "urgency" };
    if (stage) params.pipeline_stage = stage;
    const data = await get("/v1/contacts", params);
    const contacts = data.contacts ?? [];
    if (!contacts.length) {
      return { content: [{ type: "text", text: stage ? `No contacts in stage "${stage}".` : "No contacts found." }] };
    }
    const lines = contacts.map(c => {
      const name = c.name || c.email;
      const d = c.last_activity_at
        ? Math.floor((Date.now() - new Date(c.last_activity_at).getTime()) / 86400000) : 999;
      const flag = d > 7 && (c.icp_score ?? 0) >= 70 ? "!! " : "   ";
      const icp = c.icp_score != null ? ` · ICP:${c.icp_score}` : "";
      const age = d === 999 ? " · never touched" : ` · ${relAge(c.last_activity_at)}`;
      return `${flag}${name} — ${c.pipeline_stage || "identified"}${icp}${age} (${c.id})`;
    });
    return { content: [{ type: "text", text: `Contacts (${contacts.length}):\n${lines.join("\n")}` }] };
  }
);

server.tool(
  "search",
  "Semantic search across stored facts in the workspace. Scope to one contact or company, or omit " +
  "to search workspace-wide. Useful for finding context before drafting a message.",
  {
    q: z.string().describe("Search query — e.g. 'budget concerns'"),
    contact_id: z.string().optional().describe("Scope to one contact"),
    company_id: z.string().optional().describe("Scope to one company"),
    limit: z.number().min(1).max(20).optional().describe("Max results (default 10)"),
  },
  async ({ q, contact_id, company_id, limit = 10 }) => {
    const body = { q, limit };
    if (contact_id) body.contact_id = contact_id;
    if (company_id) body.company_id = company_id;
    const data = await post("/v1/search", body);
    const results = data.results ?? [];
    if (!results.length) return { content: [{ type: "text", text: `No results for "${q}".` }] };
    const lines = results.map(r => `  [${r.category}] ${r.content}`);
    return { content: [{ type: "text", text: `Results for "${q}" (${results.length}):\n${lines.join("\n")}` }] };
  }
);

server.tool(
  "get_memories",
  "Load workspace-level facts — your ICP, product, pricing, market, and competitive intel. Call " +
  "before drafting outreach or preparing a pitch — anything needing your own company context.",
  {
    category: z.enum(["ICP", "Product", "Pricing", "Market", "Competitors", "Team", "Patterns", "General"])
      .optional().describe("Filter by category — omit for all"),
    limit: z.number().min(1).max(200).optional().describe("Max facts (default 50)"),
  },
  async ({ category, limit = 50 }) => {
    const params = { limit };
    if (category) params.category = category;
    const data = await get("/v1/memories", params);
    const memories = data.memories ?? [];
    if (!memories.length) {
      return { content: [{ type: "text", text: `No workspace facts stored yet${category ? ` in "${category}"` : ""}.` }] };
    }
    const byCat = {};
    for (const m of memories) (byCat[m.category] ??= []).push(m.content);
    const lines = [];
    for (const [cat, facts] of Object.entries(byCat)) {
      lines.push(`[${cat}]`);
      for (const f of facts) lines.push(`  • ${f}`);
    }
    return { content: [{ type: "text", text: `Workspace knowledge (${memories.length}):\n\n${lines.join("\n")}` }] };
  }
);

// ───────────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);

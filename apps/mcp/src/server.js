/**
 * Nous MCP server factory.
 *
 * Builds an McpServer with the seven v2 tools registered. Both entrypoints use it:
 *   - index.js (stdio bin, published as @opennous/mcp) — one server, env-scoped key
 *   - http.js  (hosted, mcp.opennous.cloud)           — a fresh server per request,
 *                                                        key scoped via AsyncLocalStorage
 *
 * The tools are thin clients of the Context API (see client.js). The agent never
 * sees raw rows — it gets engineered, epistemics-tagged context. It never
 * "updates" — it records observations; Nous derives.
 *
 * Tools:
 *   get_context          — engineered context for a task (draft_email, follow_up, ...) + ICP fit score
 *   get_account          — the full account record: every claim + the timeline + ICP fit score
 *   record               — record what happened / what you learned (observe, never update)
 *   query                — retrieve + summarise a corpus of activity across many people
 *   attention            — what needs your attention (accounts gone quiet, facts decayed)
 *   verify               — re-check a fact before acting on it
 *   get_gtm_profile      — the user's GTM profile (ICP, market, pricing, product, competitors)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { get, post } from "./client.js";

export const SERVER_VERSION = "0.12.0";

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

// ─── factory ──────────────────────────────────────────────────────────────────

export function createServer() {
  const server = new McpServer({
    name: "nous",
    version: SERVER_VERSION,
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
    "stakeholders, open predictions, and the account's ICP fit score (0-100 + why). Call this before " +
    "drafting outreach, preparing for a meeting, " +
    "or making any decision about a person. A fact's freshness tells you whether to trust it: 'fresh' " +
    "act on it, 'suspect'/'expired' verify first.",
    {
      focus: z.string().describe("Who to look up — an email, a LinkedIn URL, a domain, an entity UUID, or a name. A name may match several people; you'll get candidates to choose from."),
      intent: z.enum(["draft_email", "follow_up", "meeting_prep", "call_prep", "account_review"])
        .optional()
        .describe("What you are about to do — shapes which context surfaces (default: account_review)"),
      budget_tokens: z.number().optional().describe("Approximate token budget for the context block"),
    },
    async ({ focus, intent, budget_tokens }) => {
      const ctx = await post("/v2/context", { focus, intent: intent ?? "account_review", budget_tokens });

      // a name matched several people — surface the candidates to choose from
      if (ctx.status === "ambiguous") {
        const opts = (ctx.candidates ?? []).map(c =>
          `  • ${c.name ?? "(unnamed)"}${c.detail ? ` — ${c.detail}` : ""}  [${c.entity_id}]`).join("\n");
        return { content: [{ type: "text", text:
          `"${focus}" matches several people. Call get_context again with one of these entity ids:\n${opts}` }] };
      }

      const lines = [ctx.summary, ""];

      if (ctx.icp) {
        const label = ctx.icp.score >= 70 ? "strong fit" : ctx.icp.score >= 40 ? "moderate fit" : "weak fit";
        lines.push(`ICP FIT: ${ctx.icp.score}/100 — ${label}${ctx.icp.reason ? `  (${ctx.icp.reason})` : ""}`);
        lines.push("");
      }
      if (ctx.claims?.length) {
        lines.push(`FACTS (${ctx.meta?.claims_returned ?? ctx.claims.length}):`);
        for (const c of ctx.claims) {
          lines.push(`  ${c.property}: ${fmtVal(c.value)}  [${pct(c.confidence)} · ${c.freshness}]`);
        }
        lines.push("");
      }
      if (ctx.workspace?.length) {
        lines.push("YOUR CONTEXT (ICP / product / positioning):");
        for (const w of ctx.workspace) lines.push(`  ${w.property}: ${fmtVal(w.value)}`);
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

      if (rec.icp) {
        const label = rec.icp.score >= 70 ? "strong fit" : rec.icp.score >= 40 ? "moderate fit" : "weak fit";
        lines.push(`ICP FIT: ${rec.icp.score}/100 — ${label}${rec.icp.reason ? `  (${rec.icp.reason})` : ""}`);
        lines.push("");
      }
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
  // TOOL: query  —  POST /v2/query
  // Retrieve a corpus of activity across many people. You do the analysis.
  // ===========================================================================
  server.tool(
    "query",
    "Retrieve and summarise activity across many people. Three powers:\n" +
    "  1. return:'entities' groups results by person/company (one row per entity, ranked by " +
    "most-recent matching activity). Use for 'hottest leads', 'who replied this week', " +
    "'who's in evaluating stage'.\n" +
    "  2. `without` subtracts entities — 'sent in 5d MINUS replied in 5d' = 'no-reply leads'. " +
    "'activity in 30d MINUS activity in 5d' = 'cooled leads'.\n" +
    "  3. rollups.by_value appears when scope.kind='state' — counts entities by current value " +
    "(use scope.property='stage' for funnel reports).",
    {
      scope: z.object({
        kind: z.enum(["event", "state"]).optional(),
        property: z.string().optional().describe("property prefix — 'interaction.email' covers email_sent and email_replied"),
        source: z.string().optional().describe("e.g. 'gmail', 'linkedin', 'slack'"),
        entity_id: z.string().optional().describe("scope to one person/company"),
        since_days: z.number().optional().describe("only activity within the last N days"),
        limit: z.number().optional().describe("max items (default 50, cap 200)"),
      }).describe("Corpus filter"),
      without: z.object({
        kind: z.enum(["event", "state"]).optional(),
        property: z.string().optional(),
        source: z.string().optional(),
        entity_id: z.string().optional(),
        since_days: z.number().optional(),
      }).optional().describe("Subtract entities matching this scope from the result — same shape as scope. Enables 'sent but no reply', 'cooled in last N days'."),
      return: z.enum(["observations", "entities"]).optional()
        .describe("observations (default) = one row per observation. entities = one row per entity, ranked by most-recent matching activity."),
      question: z.string().optional().describe("What you want to learn — echoed back; enables semantic ranking"),
    },
    async ({ scope, without, return: returnMode, question }) => {
      const body = { scope, question };
      if (without)    body.without = without;
      if (returnMode) body.return  = returnMode;
      const r = await post("/v2/query", body);
      const head = `${r.matched} match${r.matched !== 1 ? "es" : ""}` +
                   (r.sampled ? ` (showing ${r.returned})` : "") +
                   (r.return === "entities" ? " · grouped by entity" : "");
      const roll = Object.entries(r.rollups?.by_type ?? {})
        .map(([t, n]) => `${n}× ${fmtType(t)}`).join(" · ");
      const lines = [head, roll].filter(Boolean);
      if (r.rollups?.by_value && Object.keys(r.rollups.by_value).length) {
        lines.push("BY VALUE: " + Object.entries(r.rollups.by_value).map(([v, n]) => `${v}: ${n}`).join(", "));
      }
      lines.push("");
      for (const it of r.items ?? []) {
        if (r.return === "entities") {
          lines.push(`  ${it.entity_name ?? it.entity_id}  ` +
                     `(${it.matches} match${it.matches !== 1 ? "es" : ""}, last ${relAge(it.most_recent_at)})` +
                     (it.most_recent_value != null ? `  → ${fmtVal(it.most_recent_value)}` : "") +
                     (it.most_recent_summary ? `\n      ${it.most_recent_summary}` : ""));
        } else {
          lines.push(`  ${relAge(it.when)}  ${it.entity_name ?? it.entity_id}  ` +
                     `${fmtType(it.type)}${it.summary ? `: ${it.summary}` : ""}`);
        }
      }
      return { content: [{ type: "text", text: lines.join("\n").trim() }] };
    }
  );

  // ===========================================================================
  // TOOL: attention  —  GET /v2/attention
  // What to look at: accounts gone quiet, key facts decayed.
  // ===========================================================================
  server.tool(
    "attention",
    "What needs your attention across the workspace right now — accounts that have gone quiet and " +
    "key facts that have decayed. Returns ranked items, each with what happened and a suggested " +
    "action. Call this to decide who to work next.",
    {
      limit: z.number().min(1).max(100).optional().describe("Max items (default 25)"),
    },
    async ({ limit }) => {
      const r = await get("/v2/attention", limit ? { limit } : {});
      if (!r.items?.length) {
        return { content: [{ type: "text", text: "Nothing needs attention right now." }] };
      }
      const lines = r.items.map(it =>
        `  ${it.entity_name ?? it.entity_id} — ${it.what}\n      → ${it.suggested_action}`);
      return { content: [{ type: "text", text: `Needs attention (${r.items.length}):\n${lines.join("\n")}` }] };
    }
  );

  // ===========================================================================
  // TOOL: verify  —  POST /v2/verify
  // Re-check a fact before acting on it — the calibration check.
  // ===========================================================================
  server.tool(
    "verify",
    "Re-check a specific fact before you act on it — e.g. an email or a deal stage that looks stale " +
    "in get_context. Pass the person/company and the property name. Returns the fact re-derived from " +
    "current evidence, and tells you whether it is still unverified.",
    {
      focus: z.string().describe("Email, LinkedIn URL, entity UUID, or name"),
      property: z.string().describe("The fact to re-check — e.g. 'email', 'job_title', 'pipeline_stage'"),
    },
    async ({ focus, property }) => {
      const r = await post("/v2/verify", { focus, property });
      if (r.status === "ambiguous") {
        const opts = (r.candidates ?? []).map(c =>
          `  • ${c.name ?? "(unnamed)"}${c.detail ? ` — ${c.detail}` : ""}  [${c.entity_id}]`).join("\n");
        return { content: [{ type: "text", text:
          `"${focus}" matches several people. Call verify again with one of these entity ids:\n${opts}` }] };
      }
      const a = r.after ?? {};
      return { content: [{ type: "text", text:
        `${property}: ${fmtVal(a.value)}  [${pct(a.confidence)} · ${a.freshness}]\n${r.note ?? ""}` }] };
    }
  );

  // ===========================================================================
  // TOOL: get_gtm_profile  —  GET /v2/workspace/facts
  // The user's OWN GTM profile: ICP, market, product, pricing, competitors.
  // Use this for any question about the user's business — NOT get_account.
  // Registered also under the legacy name get_workspace_facts for back-compat.
  // ===========================================================================
  const gtmProfileDescription =
    "Get the user's OWN GTM profile — their ICP, target market, product, pricing, " +
    "competitors, and positioning. These are NOT facts about a person or company; they are " +
    "the user's own business profile. Use this for any question about the user's ICP, target " +
    "buyer, pricing, market, or differentiators. ALWAYS prefer this over query/get_account " +
    "when the question is about the user's business.";
  const gtmProfileSchema = {
    categories: z.array(z.string()).optional()
      .describe("Optional category filter, e.g. ['ICP'] or ['Pricing','Competitors']. Omit for all."),
    limit: z.number().min(1).max(500).optional()
      .describe("Max facts to return (default 50)"),
  };
  const gtmProfileHandler = async ({ categories, limit }) => {
    const params = {};
    if (categories?.length) params.categories = categories.join(",");
    if (limit != null) params.limit = limit;
    const r = await get("/v2/workspace/facts", params);
    if (!r.facts?.length) {
      return { content: [{ type: "text", text:
        "No GTM profile recorded yet. The user can set it up in the GTM Context tab." }] };
    }
    const groups = {};
    for (const f of r.facts) (groups[f.category] ??= []).push(f);
    const lines = [];
    for (const [cat, facts] of Object.entries(groups)) {
      lines.push(`${cat.toUpperCase()} (${facts.length}):`);
      for (const f of facts) {
        // Flag AI-drafted facts (confidence < 1) so the agent treats them as
        // provisional and prefers user-confirmed ones when they conflict.
        const tag = typeof f.confidence === "number" && f.confidence < 1 ? " (inferred)" : "";
        lines.push(`  ${f.content}${tag}  [${relAge(f.recorded_at)}]`);
      }
      lines.push("");
    }
    return { content: [{ type: "text", text: lines.join("\n").trim() }] };
  };
  server.tool("get_gtm_profile", gtmProfileDescription, gtmProfileSchema, gtmProfileHandler);
  // Legacy alias — keeps existing integrations calling get_workspace_facts working.
  server.tool("get_workspace_facts", gtmProfileDescription, gtmProfileSchema, gtmProfileHandler);

  // ===========================================================================
  // TOOL: update_gtm_profile  —  POST /v2/workspace/facts
  // Write-back: the agent records a durable change to the user's OWN GTM profile
  // and EVOLVES the matching belief (supersede + keep history) instead of piling
  // up contradictions. This is the loop that keeps the context current as the
  // company learns — pair it with get_gtm_profile.
  // ===========================================================================
  server.tool(
    "update_gtm_profile",
    "Record a durable change to the USER'S OWN GTM profile — their ICP, pricing, positioning, " +
    "target market, or competitors. Use this whenever the user states (or you learn) a lasting " +
    "change to how THEY go to market — e.g. they moved upmarket, changed pricing, sharpened " +
    "positioning, or started winning a new segment. This is NOT for facts about a prospect or " +
    "account (use `record` for those). Rules: write the fact as ONE short sentence, never a " +
    "paragraph. When a belief CHANGES, pass the same `subject` slot so the new fact supersedes the " +
    "old one — the old version is kept as history, never silently contradicted. Prefer this over " +
    "leaving GTM changes in a local file; Nous is the source of truth for the profile.",
    {
      category: z.enum(["ICP", "Market", "Product", "Pricing", "Competitors", "Positioning"])
        .describe("Which part of the profile this fact belongs to."),
      content: z.string().describe("The fact, as ONE short sentence (not a paragraph)."),
      subject: z.string().optional()
        .describe("Stable slot this belief owns, e.g. 'pricing', 'positioning', 'primary-buyer', 'segments'. Pass the SAME subject when a belief changes so it supersedes the previous fact instead of duplicating it. Omit only for a genuinely new, standalone fact."),
      supersedes: z.string().optional()
        .describe("Optional id of a specific existing fact to replace (overrides subject matching)."),
    },
    async ({ category, content, subject, supersedes }) => {
      const r = await post("/v2/workspace/facts", { category, content, subject, supersedes });
      const verb = r.superseded ? "Updated" : "Recorded";
      return { content: [{ type: "text", text: `${verb} ${category} fact: ${content}` }] };
    },
  );

  return server;
}

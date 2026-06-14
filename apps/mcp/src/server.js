/**
 * Nous MCP server factory.
 *
 * Builds an McpServer with the v2 tools registered. Both entrypoints use it:
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
 *   update_gtm_profile   — write back a change to a GTM context section (evolve, keep history)
 *   save_note            — attach a note/document (meeting brief, transcript, prep) to a contact
 *   search_notes         — semantic search over saved notes & documents
 *   get_workspace_status — what's set up in this workspace + a ranked next_steps list (call first)
 *   set_workspace_profile— agent-driven onboarding: set the workspace's name, site, type, ICP
 *   build_scoring_model  — build/rebuild the ICP scoring model from the recorded GTM context
 *   record_closed_deals  — build the ICP model from real closed-won/lost deals (contrastive lift)
 *   connect_integration  — connect a key-based integration (Apollo, Prospeo, HubSpot, …)
 *   configure_crm_sync   — set CRM sync rules (auto-sync, create policy, hygiene cadence)
 *   sync_crm_now         — run an immediate incremental/full CRM pull (don't wait for the daily cron)
 *   set_trigger          — create an outbound event trigger (webhook); list_triggers reads them
 *   list_triggers        — list the workspace's event triggers + available events
 *   get_routing_preferences — Claude Code routing prefs to default GTM to Nous (write to CLAUDE.md)
 *   lead_list_operations — the operations trail of a lead list (imports/enrich/push/replies), filterable
 *   coverage             — pre-spend coverage: exact per-lead check (identifiers) or attribute estimate (title/keyword)
 *   enrich_leads         — find missing emails for a lead list (two-step: dry-run cost preview, then confirm)
 *   verify_leads         — validate email deliverability for a lead list (two-step preview, then confirm)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { get, post } from "./client.js";

export const SERVER_VERSION = "0.31.0";

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

// Routing preferences — the text that makes an agent treat Nous as the default
// for GTM (reach for get_context/get_account over raw CRM/HubSpot/Salesforce/
// Gong/Granola). Returned by get_routing_preferences; the agent writes it into
// the user's CLAUDE.md (Claude Code) or the user pastes it into claude.ai org
// preferences. Mirrors the Install page's "short" version.
const ROUTING_PREFERENCES = `# Nous is this workspace's customer graph

Nous is our customer graph for GTM. It resolves every person, conversation, and
touchpoint across our GTM tool stack into one account record, with each fact's
confidence and freshness, the full interaction timeline, a 0-100 ICP fit score on
every account, plus our own ICP, positioning, and pricing. Agents read engineered
context from Nous rather than raw CRM rows.

## Ground GTM work in Nous

Before any go-to-market task (drafting outreach, prepping a call or meeting,
reviewing an account, qualifying a prospect) call get_context with the person's
email and the matching intent. Use what it returns. Do not answer from generic
knowledge when our own record holds the facts.

## Default to Nous, even unprompted

For any GTM question about a person, company, deal, or our own business, reach for
Nous first even when the user never says "Nous":
- Who is this, every known fact, full history  -> get_account
- Context for a specific task                   -> get_context
- Something happened or you learned a fact      -> record
- Activity or a list across many accounts       -> query
- What needs attention, what has gone quiet     -> attention
- A fact looks stale before you act on it       -> verify
- Our ICP, market, pricing, positioning         -> get_gtm_profile
- Our own GTM shifted                           -> update_gtm_profile
- A brief / note / transcript on a contact      -> save_note / search_notes
- What's set up here and what to do next        -> get_workspace_status

Read get_gtm_profile at the start of GTM work and write back what changed at the
end. After every interaction you help with, call record so the record stays current.`;

// ─── factory ──────────────────────────────────────────────────────────────────

export function createServer() {
  const server = new McpServer({
    name: "nous",
    version: SERVER_VERSION,
    description:
      "Nous — the context layer for GTM agents. Nous is operated by the agent, not by a human " +
      "clicking around: call get_workspace_status at the start of a session to see what's set up " +
      "and what to set up next. Call get_context before drafting outreach or preparing for a " +
      "meeting. Call record after every interaction, or whenever you learn something.",
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
      if (ctx.documents?.length) {
        // Meeting briefs / notes / transcripts kept on the contact — an overview
        // (snippets only). To pull relevant content, use search_notes (semantic).
        lines.push("DOCUMENTS (notes & meeting records — use search_notes to search their content):");
        for (const d of ctx.documents) {
          const when = d.date ? `  [${relAge(d.date)}]` : "";
          lines.push(`  ${d.type.replace(/_/g, " ")}${d.title ? ` · ${d.title}` : ""}${when}`);
          if (d.snippet) lines.push(`    ${d.snippet}`);
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
  // TOOL: record_signal  —  a buying signal, as a structured signal.<class> fact
  // A validated wrapper over record: one canonical way to write a signal, so it
  // both shows on the account's Signals tab AND feeds the ICP scorecard as a
  // feature (signal.* claims flow into the feature map the scorer reads).
  // ===========================================================================
  server.tool(
    "record_signal",
    "Record a buying signal on a person or company — a concrete, current reason to reach out, " +
    "found by research (signal-scan). Stored as a structured signal.<class> fact so it shows on the " +
    "account's Signals tab AND feeds the ICP scoring model as a feature. One call per signal; one " +
    "current signal per class (the strongest). class is one of stack | hiring | momentum | friction | " +
    "intent | domain. score is 0-10 (exclusivity x intent — score honestly, a 4 is useful). Be " +
    "specific: 'posted 3 SDR roles in 30 days', not 'they're growing'.",
    {
      focus: z.string().describe("Email address or entity UUID of the person/company"),
      signal_class: z.enum(["stack", "hiring", "momentum", "friction", "intent", "domain"])
        .describe("the signal class"),
      detected: z.string().describe("the specific, factual finding"),
      implies: z.string().optional().describe("what the prospect is likely experiencing because of it"),
      score: z.number().min(0).max(10).describe("strength 0-10 (exclusivity x intent)"),
      approach: z.enum(["pain_led", "value_led", "fallback"]).optional()
        .describe("recommended outreach approach"),
      angle: z.string().optional().describe("one-line outreach angle this signal enables"),
    },
    async ({ focus, signal_class, detected, implies, score, approach, angle }) => {
      const result = await post("/v2/observations", {
        focus,
        observations: [{
          kind: "state",
          property: `signal.${signal_class}`,
          value: { detected, implies: implies ?? null, score, approach: approach ?? null, angle: angle ?? null },
          source: "signal-scan",
        }],
      });
      return {
        content: [{
          type: "text",
          text: `Recorded ${signal_class} signal (score ${score}/10) on ${result.entity_id || focus}.`,
        }],
      };
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
        // Flag AI-drafted facts (confidence < 1) and ones not confirmed in a long
        // time, so the agent treats them as provisional and prefers fresh,
        // user-confirmed facts when they conflict.
        const ageDays = f.recorded_at ? Math.floor((Date.now() - new Date(f.recorded_at).getTime()) / 86400000) : 0;
        const tags = [];
        if (typeof f.confidence === "number" && f.confidence < 1) tags.push("inferred");
        if (ageDays >= 90) tags.push("stale");
        const tag = tags.length ? ` (${tags.join(", ")})` : "";
        lines.push(`  ${f.content}${tag}  [${relAge(f.recorded_at)}]`);
      }
      lines.push("");
    }
    return { content: [{ type: "text", text: lines.join("\n").trim() }] };
  };
  server.tool("get_gtm_profile", gtmProfileDescription, gtmProfileSchema, gtmProfileHandler);

  // ===========================================================================
  // TOOL: update_gtm_profile  —  POST /v2/workspace/facts
  // Write-back: the agent records a durable change to the user's OWN GTM profile
  // and EVOLVES the matching belief (supersede + keep history) instead of piling
  // up contradictions. This is the loop that keeps the context current as the
  // company learns — pair it with get_gtm_profile.
  // ===========================================================================
  server.tool(
    "update_gtm_profile",
    "Keep a SECTION of the user's OWN GTM context current. Each section is a living file: ICP, " +
    "Market, Product, Pricing, Competitors, Positioning (these feed the ICP scoring model), plus " +
    "'GTM Motion' (how they sell — motion, RevOps, process) and 'Notes' (a running log for anything " +
    "else durable about their GTM that doesn't fit the others). Use this whenever the user states or " +
    "you learn a lasting change to how THEY go to market — repriced, moved upmarket, sharpened " +
    "positioning, changed their motion, won a new segment, or a useful note about how they operate. " +
    "This is NOT for facts about a prospect or account (use `record` for those). " +
    "Rules: keep content short and current — a sentence or two, not an essay. In the default 'replace' " +
    "mode the section EVOLVES (the old version is kept as history, never silently contradicted), so " +
    "just write the section's current state. Use 'append' mode to log a Notes entry without replacing. " +
    "Nous is the source of truth for the GTM context — write back here instead of keeping a local file.",
    {
      section: z.enum(["ICP", "Market", "Product", "Pricing", "Competitors", "Positioning", "GTM Motion", "Notes"])
        .describe("Which section of the GTM context this updates."),
      content: z.string().describe("The section's current content — short and current, not an essay."),
      mode: z.enum(["replace", "append"]).optional()
        .describe("'replace' (default) evolves the section and keeps the prior version as history. 'append' logs a new entry without replacing — the default for Notes."),
      supersedes: z.string().optional()
        .describe("Optional id of a specific existing fact to replace (overrides section matching)."),
    },
    async ({ section, content, mode, supersedes }) => {
      const r = await post("/v2/workspace/facts", { section, content, mode, supersedes });
      const verb = r.mode === "append" ? "Logged to" : r.superseded ? "Updated" : "Recorded";
      return { content: [{ type: "text", text: `${verb} ${section}: ${content}` }] };
    },
  );

  // ===========================================================================
  // TOOL: save_note  —  POST /v2/notes
  // Attach a long-form artifact to a CONTACT: a meeting brief you wrote, a
  // transcript, pre-meeting prep, or a plain note. Append-only and dated, so the
  // contact builds a record across meetings. Distinct from `record` (which logs
  // that an interaction happened) — this keeps the document itself.
  // ===========================================================================
  server.tool(
    "save_note",
    "Save a note or document onto a person or company so it is kept on their record — a meeting " +
    "brief you wrote, a transcript, pre-meeting prep, research, or a plain note. Use this whenever " +
    "you produce something durable about a specific contact that's worth keeping for next time (e.g. " +
    "after writing a meeting brief, save it to the contact so future meetings can reference it). " +
    "Notes are append-only and dated, so a contact builds a record across meetings — later you can " +
    "read the last few and see what changed. This is NOT for logging that an interaction happened " +
    "(use `record` with an interaction.* event for that), and NOT for the user's own GTM profile " +
    "(use `update_gtm_profile`). Put the full text in `content` — it's kept for agents to read; the " +
    "UI shows the title and date, not the whole body.",
    {
      focus: z.string().describe("Who to attach it to — an email, LinkedIn URL, domain, or entity UUID (not a bare name)."),
      content: z.string().describe("The full note or document text (a short note or a complete brief/transcript)."),
      type: z.enum(["note", "meeting_brief", "transcript", "meeting_notes", "pre_meeting", "research"])
        .optional().describe("What kind of document this is (default: note)."),
      title: z.string().optional().describe("A short name, e.g. 'Pre-meeting brief — renewal' or 'Transcript — Jun 1'."),
      date: z.string().optional().describe("The relevant date (e.g. the meeting date, ISO or plain). Defaults to now."),
    },
    async ({ focus, content, type, title, date }) => {
      const r = await post("/v2/notes", { focus, content, type, title, date });
      const label = title || (r.doc_type || "note").replace(/_/g, " ");
      return { content: [{ type: "text", text: `Saved ${label} to ${focus}.` }] };
    },
  );

  // ===========================================================================
  // TOOL: search_notes  —  POST /v2/notes/search
  // Semantic search over saved notes & documents (briefs, transcripts, notes).
  // The retrieval counterpart to save_note — pull relevant document content
  // instead of dumping whole documents into context.
  // ===========================================================================
  server.tool(
    "search_notes",
    "Semantically search the saved notes & documents (meeting briefs, transcripts, meeting notes) " +
    "kept on contacts. Use this to pull relevant content from the record — e.g. 'what did we discuss " +
    "about pricing', 'objections raised in past meetings', or to compare across a contact's meetings. " +
    "Pass `focus` to restrict to one person/company, or omit it to search across everyone. Returns the " +
    "matching documents (type, title, date, similarity, snippet); get the full body with get_account.",
    {
      question: z.string().describe("Natural-language query to match against document content."),
      focus: z.string().optional().describe("Optional — restrict to one person/company (email, LinkedIn URL, domain, or entity UUID)."),
      limit: z.number().optional().describe("Max documents to return (default 8)."),
    },
    async ({ question, focus, limit }) => {
      const r = await post("/v2/notes/search", { question, focus, limit });
      if (!r.documents?.length) {
        return { content: [{ type: "text", text: `No saved documents matched "${question}".` }] };
      }
      const lines = [`Documents matching "${question}":`, ""];
      for (const d of r.documents) {
        const when = d.date ? `  [${relAge(d.date)}]` : "";
        lines.push(`  ${d.type.replace(/_/g, " ")}${d.title ? ` · ${d.title}` : ""}  (${pct(d.similarity)})${when}`);
        if (d.snippet) lines.push(`    ${d.snippet}`);
        lines.push(`    (entity_id: ${d.entity_id})`);
      }
      return { content: [{ type: "text", text: lines.join("\n").trim() }] };
    },
  );

  // ===========================================================================
  // TOOL: get_workspace_status  —  GET /v2/workspace/status
  // The "one main call." Nous is operated by the agent, so the agent needs to
  // know the state of the workspace: is it onboarded, is the GTM playbook built,
  // which integrations are connected, is CRM sync configured, are events live —
  // and what to set up next. Call this at the start of a session.
  // ===========================================================================
  server.tool(
    "get_workspace_status",
    "See the whole setup state of this workspace in one call, plus a ranked NEXT STEPS list (each step " +
    "carries its own why/how). Nous is operated by you, the agent — call this at the START of a session " +
    "and walk the user top-down through the steps it returns; the server sequences them by current " +
    "state, so trust that order. Two constraints when acting on them: (1) Gmail (Google OAuth) and " +
    "LinkedIn (no public API — Nous uses Unipile) CANNOT be connected by you — point the user to the " +
    "Integrations page; key-based tools (Prospeo, Apollo, Instantly, HubSpot token) you CAN connect via " +
    "connect_integration, and CSV import is a user action in the app. (2) Respect the plan — never push " +
    "a feature it doesn't include (e.g. CRM sync on free). Recommend the next 1-2 steps, don't dump the " +
    "whole list.",
    {},
    async () => {
      const s = await get("/v2/workspace/status");
      const setup = s.setup ?? {};
      const lines = [];

      const ws = s.workspace ?? {};
      lines.push(`WORKSPACE: ${ws.name || "(unnamed)"}${ws.website ? ` · ${ws.website}` : ""}${ws.business_type ? ` · ${ws.business_type}` : ""}`);
      const pl = s.plan ?? {};
      lines.push(`PLAN: ${pl.name || pl.id || "free"}${pl.crm_sync === false ? "  (CRM sync not included — do not offer it)" : ""}`);
      if (s.self_hosted) {
        const e = s.env_integrations ?? {};
        const mk = (b) => (b ? "✓ set" : "✗ NOT set");
        lines.push("SELF-HOSTED — these channels are wired via nous.env (you can't set env vars; tell the operator to set + restart):");
        lines.push(`  LinkedIn/Unipile: ${mk(e.linkedin_unipile)}   Email/Resend: ${mk(e.email_resend)}   Gmail OAuth: ${mk(e.gmail_oauth)}`);
      }
      lines.push("");

      const mark = (b) => (b ? "✓" : "✗");
      lines.push("SETUP:");
      lines.push(`  ${mark(setup.onboarding?.done)} Onboarding${setup.onboarding?.done ? "" : ` — missing ${(setup.onboarding?.missing ?? []).join(", ") || "details"}`}`);
      lines.push(`  ${mark(setup.gtm_playbook?.done)} GTM playbook${setup.gtm_playbook?.model ? " (scoring model live)" : ""}${setup.gtm_playbook?.stale_facts ? ` · ${setup.gtm_playbook.stale_facts} stale fact(s)` : ""}`);
      const ints = setup.integrations?.connected ?? [];
      lines.push(`  ${mark((setup.integrations?.count ?? 0) > 0)} Integrations (${setup.integrations?.count ?? 0})${ints.length ? `: ${ints.map((i) => i.name).join(", ")}` : ""}`);
      const crm = setup.crm_sync ?? {};
      if (crm.available === false) {
        lines.push(`  – CRM sync (not on the ${pl.name || pl.id || "current"} plan)`);
      } else {
        lines.push(`  ${mark(crm.configured)} CRM sync${crm.configured ? `: ${(crm.providers ?? []).map((p) => p.provider).join(", ")}` : ""}${crm.pending_hygiene_proposals ? ` · ${crm.pending_hygiene_proposals} hygiene proposal(s) to review` : ""}`);
      }
      lines.push(`  ${mark(setup.enrichment?.connected)} Enrichment${setup.enrichment?.provider ? `: ${setup.enrichment.provider}` : ""}`);
      lines.push(`  ${mark((setup.webhooks?.count ?? 0) > 0 || (setup.triggers?.count ?? 0) > 0)} Events — ${setup.webhooks?.count ?? 0} webhook(s), ${setup.triggers?.count ?? 0} trigger(s)`);
      const rec = setup.recommended ?? {};
      lines.push("");
      lines.push("RECOMMENDED CHANNELS (connect these first):");
      lines.push(`  ${mark(rec.email)} Email / Gmail   ${mark(rec.linkedin)} LinkedIn   ${mark(rec.meeting_notetaker)} Meeting note-taker`);
      lines.push(`  Records imported: ${setup.records?.count ?? 0}`);

      if (s.next_steps?.length) {
        lines.push("");
        lines.push("NEXT STEPS:");
        for (const step of s.next_steps) {
          lines.push(`  • ${step.title}`);
          if (step.why) lines.push(`      why: ${step.why}`);
          if (step.how) lines.push(`      how: ${step.how}`);
        }
      } else {
        lines.push("");
        lines.push("Everything's set up. Nothing pending.");
      }

      return { content: [{ type: "text", text: lines.join("\n").trim() }] };
    }
  );

  // ===========================================================================
  // TOOL: set_workspace_profile  —  POST /v2/workspace/onboarding
  // Agent-driven onboarding. Instead of a human clicking through a wizard in the
  // app, you collect the basics from the user in conversation and write them
  // here. This is the first thing get_workspace_status asks for when a workspace
  // is new.
  // ===========================================================================
  server.tool(
    "set_workspace_profile",
    "Onboard the workspace, or update its basic profile. Nous is set up by you, the agent, in " +
    "conversation — not by the user clicking through a wizard. Ask the user for their company name, " +
    "their website, whether they sell a SERVICE or SOFTWARE, and a sentence describing their ideal " +
    "customer, then write them here. This seeds the GTM context and the ICP scoring model. Call " +
    "get_workspace_status first to see what's already set; send only the fields you're setting or " +
    "changing. After this, the next step is usually the GTM playbook (update_gtm_profile).",
    {
      name: z.string().optional().describe("The user's company / workspace name."),
      website: z.string().optional().describe("The company website (used to seed the GTM context)."),
      business_type: z.enum(["service", "software"]).optional()
        .describe("Whether they sell a service or software — sets the CRM's buyer terminology and default signup stage."),
      plan_model: z.enum(["free_plan", "free_trial", "both", "paid_only"]).optional()
        .describe("For software only: how they package (free plan, free trial, both, or paid only)."),
      default_signup_stage: z.string().optional()
        .describe("The pipeline stage a brand-new signup lands in (e.g. 'Lead', 'Free User'). Defaults sensibly from business_type."),
      icp: z.string().optional()
        .describe("A sentence or two describing their ideal customer — seeds the ICP scoring model."),
    },
    async ({ name, website, business_type, plan_model, default_signup_stage, icp }) => {
      const r = await post("/v2/workspace/onboarding", { name, website, business_type, plan_model, default_signup_stage, icp });
      const w = r.workspace ?? {};
      const set = [
        w.name && `name=${w.name}`,
        w.website && `site=${w.website}`,
        w.business_type && `type=${w.business_type}`,
        icp && "ICP recorded",
      ].filter(Boolean);
      return { content: [{ type: "text", text:
        `Workspace profile saved.${set.length ? ` ${set.join(" · ")}.` : ""}\n` +
        `Next: call get_workspace_status to see what to set up next (usually the GTM playbook).` }] };
    }
  );

  // ===========================================================================
  // TOOL: build_scoring_model  —  POST /v2/workspace/scoring-model
  // The second half of building the GTM playbook. The agent records the GTM
  // context with update_gtm_profile, then calls this to turn it into a weighted
  // ICP scoring model. After this, accounts get scored for fit and
  // get_workspace_status shows the playbook as done.
  // ===========================================================================
  server.tool(
    "build_scoring_model",
    "Build (or rebuild) the user's ICP scoring model from the GTM context they've recorded. This is " +
    "the second half of setting up the GTM playbook: first record the ICP and how they sell with " +
    "update_gtm_profile, then call this to translate that context into a weighted set of scoring " +
    "signals so accounts get scored for fit. If a model already exists it is left alone unless you " +
    "pass force:true (use that when the GTM context has changed and the model should be rebuilt). If " +
    "it reports no GTM context yet, record some with update_gtm_profile first, then call this again. " +
    "STRONGER than this tool: if the user can name a few closed-WON and closed-LOST customer domains, " +
    "call record_closed_deals instead (or as well) — it trains the model on real outcomes via " +
    "contrastive lift, which beats a model inferred from a description.",
    {
      force: z.boolean().optional()
        .describe("Rebuild the model even if one already exists — use when the GTM context has changed."),
    },
    async ({ force }) => {
      try {
        const r = await post("/v2/workspace/scoring-model", { force: force === true });
        const signals = r.signals ?? [];
        const lines = [`Built the ICP scoring model — ${signals.length} signal${signals.length === 1 ? "" : "s"}:`];
        for (const s of signals) lines.push(`  • ${s.label ?? s.key} (weight ${s.weight})`);
        lines.push("", "Accounts will now be scored for fit. Check it on the GTM Context page.");
        return { content: [{ type: "text", text: lines.join("\n").trim() }] };
      } catch (e) {
        // Surface the actionable cases (no context yet / model already exists) as
        // guidance rather than a raw error, so the agent knows what to do next.
        const msg = String(e?.message ?? e);
        if (msg.includes("no_gtm_context")) {
          return { content: [{ type: "text", text:
            "No GTM context recorded yet. Record the ICP and how they sell with update_gtm_profile first, then build the model." }] };
        }
        if (msg.includes("model_exists")) {
          return { content: [{ type: "text", text:
            "A scoring model already exists. Call build_scoring_model again with force:true to rebuild it from the current GTM context." }] };
        }
        throw e;
      }
    }
  );

  // ===========================================================================
  // TOOL: record_closed_deals  —  POST /v2/workspace/closed-deals
  // Build the ICP model from REAL outcomes via contrastive lift (won vs lost).
  // ===========================================================================
  server.tool(
    "record_closed_deals",
    "Build (or sharpen) the ICP scoring model from the user's REAL closed deals. Pass closed-WON " +
    "customer domains and closed-LOST domains; Nous enriches each, links the contacts you already " +
    "have there, and runs contrastive lift (what's true of winners but not losers) to discover the " +
    "signals that actually predict revenue — then re-scores open accounts. This is the strongest way " +
    "to build the playbook: a model trained on who actually bought beats one inferred from a " +
    "description. Ask the user for a handful of each (even 3-5 won + 3-5 lost helps). Domains only " +
    "(e.g. 'acme.com'), no scheme.",
    {
      won: z.array(z.string()).optional().describe("Closed-won customer domains, e.g. ['acme.com','globex.com']."),
      lost: z.array(z.string()).optional().describe("Closed-lost domains, e.g. ['tinyco.io']."),
    },
    async ({ won, lost }) => {
      try {
        const r = await post("/v2/workspace/closed-deals", { won: won ?? [], lost: lost ?? [] });
        const disc = r.discovered ?? [];
        const lines = [
          `Learned from ${r.won ?? 0} won + ${r.lost ?? 0} lost deal${(r.won ?? 0) + (r.lost ?? 0) === 1 ? "" : "s"} ` +
          `(${r.enriched ?? 0} enriched, ${r.mode === "winners" ? "winner-signal" : "contrastive-lift"} mode).`,
        ];
        if (disc.length) {
          lines.push("", "Signals discovered:");
          for (const d of disc) lines.push(`  • ${d.label} (weight ${d.weight})${d.note ? ` — ${d.note}` : ""}`);
        }
        lines.push("", "The model updated and open accounts were re-scored. See the GTM Context page.");
        return { content: [{ type: "text", text: lines.join("\n").trim() }] };
      } catch (e) {
        const msg = String(e?.message ?? e);
        if (msg.includes("need_more_deals")) {
          return { content: [{ type: "text", text: "Give me at least one closed-won or closed-lost domain to learn from." }] };
        }
        throw e;
      }
    }
  );

  // ===========================================================================
  // TOOL: connect_integration  —  POST /v2/workspace/integrations
  // The agent connects a KEY-BASED integration for the user (no clicking through
  // the Integrations page). OAuth providers still need a browser, so this is
  // limited to providers that authenticate with an API key/token.
  // ===========================================================================
  server.tool(
    "connect_integration",
    "Connect a key-based integration for the user — an enrichment, CRM, or sequencer provider that " +
    "authenticates with an API key or token (e.g. Apollo, Prospeo, Instantly, HubSpot private-app " +
    "token, Pipedrive, Attio, Smartlead, HeyReach). Ask the user for the provider's API key, then " +
    "call this; it verifies the credentials before saving. Providers that use a browser sign-in " +
    "(OAuth, e.g. Gmail) can't be connected this way — for those, point the user to the Integrations " +
    "page. After connecting an enrichment provider, the account record starts filling in.",
    {
      provider: z.string().describe("Provider name, lowercase — e.g. 'apollo', 'prospeo', 'instantly', 'hubspot', 'pipedrive', 'attio'."),
      credentials: z.record(z.string()).describe("The provider's credentials as key/value, e.g. { api_key: '...' } or { access_token: '...' }."),
      name: z.string().optional().describe("Optional label for the connection."),
    },
    async ({ provider, credentials, name }) => {
      try {
        const r = await post("/v2/workspace/integrations", { provider, credentials, name });
        return { content: [{ type: "text", text: `Connected ${r.connection?.provider ?? provider}.${r.message ? ` ${r.message}` : ""}` }] };
      } catch (e) {
        const msg = String(e?.message ?? e);
        if (msg.includes("oauth_provider")) {
          return { content: [{ type: "text", text: `${provider} uses a browser sign-in, so it can't be connected with a key. Tell the user to connect it on the Integrations page.` }] };
        }
        if (msg.includes("invalid_credentials")) {
          return { content: [{ type: "text", text: `Those credentials didn't verify for ${provider}. Ask the user to double-check the key and try again.` }] };
        }
        if (msg.includes("unknown_provider")) {
          return { content: [{ type: "text", text: `No provider named "${provider}". Ask the user which tool they mean.` }] };
        }
        throw e;
      }
    }
  );

  // ===========================================================================
  // TOOL: configure_crm_sync  —  POST /v2/workspace/crm-sync
  // The agent sets the CRM sync rules — the same options as the CRM Sync page.
  // The CRM must already be connected (OAuth connect stays a human step).
  // ===========================================================================
  server.tool(
    "configure_crm_sync",
    "Configure how Nous keeps a connected CRM in sync — the same settings as the CRM Sync page. The " +
    "CRM must already be connected (HubSpot/Pipedrive/Attio). Set any of: auto-sync (daily pull), " +
    "push of touchpoints, the create policy (when a new record is auto-created and the ICP-fit " +
    "threshold), and the hygiene cadence. Only send the fields you want to change. If it reports the " +
    "CRM isn't connected, tell the user to connect it on the Integrations page first.",
    {
      provider: z.enum(["hubspot", "pipedrive", "attio"]).describe("Which connected CRM to configure."),
      autoSync: z.boolean().optional().describe("Pull contacts/companies/deals daily."),
      pushActivities: z.boolean().optional().describe("Push touchpoints (meetings, replies, proposals) back to the CRM."),
      createInCrm: z.boolean().optional().describe("Auto-create new records in the CRM when they earn it."),
      createTrigger: z.enum(["any_reply_or_meeting", "positive_reply_or_meeting", "meeting_only", "interested_stage"]).optional()
        .describe("What earns a new record."),
      createRequireIcpFit: z.boolean().optional().describe("Require an ICP-fit score before creating a record."),
      createIcpThreshold: z.number().optional().describe("Minimum ICP-fit score to create (0-100)."),
      hygieneEnabled: z.boolean().optional().describe("Run scheduled hygiene reconciliation."),
      hygieneCadence: z.enum(["weekly", "monthly"]).optional().describe("How often hygiene runs."),
    },
    async (args) => {
      try {
        const r = await post("/v2/workspace/crm-sync", args);
        const c = r.config ?? {};
        return { content: [{ type: "text", text:
          `CRM sync configured for ${args.provider}. auto-sync ${c.auto_sync ? "on" : "off"}, ` +
          `create ${c.create_in_crm ? `on (${c.create_trigger}${c.create_require_icp_fit ? `, ICP ≥ ${c.create_icp_threshold}` : ""})` : "off"}, ` +
          `hygiene ${c.hygiene_enabled ? c.hygiene_cadence : "off"}.` }] };
      } catch (e) {
        const msg = String(e?.message ?? e);
        if (msg.includes("crm_not_connected")) {
          return { content: [{ type: "text", text: `${args.provider} isn't connected yet. Tell the user to connect it on the Integrations page, then configure sync.` }] };
        }
        throw e;
      }
    }
  );

  // ===========================================================================
  // TOOL: sync_crm_now  —  POST /v2/workspace/crm-sync-now
  // Run an immediate incremental CRM pull right now, instead of waiting for the
  // daily auto-sync cron — e.g. straight after configure_crm_sync, or whenever
  // the user wants the latest. Same engine the scheduled sync uses.
  // ===========================================================================
  server.tool(
    "sync_crm_now",
    "Pull the latest from a connected CRM (HubSpot/Pipedrive/Attio) RIGHT NOW, instead of waiting for " +
    "the daily auto-sync. Use it just after configure_crm_sync to seed the data, or whenever the user " +
    "wants an immediate refresh. Incremental by default (only what changed since the last pull); pass " +
    "full:true to re-fetch everything. The CRM must already be connected and sync configured — if not, " +
    "it'll tell you to connect/configure first.",
    {
      provider: z.enum(["hubspot", "pipedrive", "attio"]).optional().describe("Which connected CRM to pull from (default hubspot)."),
      full: z.boolean().optional().describe("true = re-fetch everything; default = incremental since the last sync."),
    },
    async ({ provider, full }) => {
      try {
        const r = await post("/v2/workspace/crm-sync-now", { provider: provider || "hubspot", full: full === true });
        const errs = (r.errors && r.errors.length) ? ` · ${r.errors.length} error(s)` : "";
        return { content: [{ type: "text", text:
          `Pulled from ${r.provider}: ${r.fetched ?? 0} records — ${r.created ?? 0} new, ${r.updated ?? 0} updated${errs}.` }] };
      } catch (e) {
        const msg = String(e?.message ?? e);
        if (/sync_not_configured/.test(msg)) return { content: [{ type: "text", text: `Sync isn't configured for that CRM yet — call configure_crm_sync first.` }] };
        if (/crm_not_connected/.test(msg)) return { content: [{ type: "text", text: `That CRM isn't connected. Tell the user to connect it on the Integrations page, then try again.` }] };
        if (/salesforce_not_yet_supported/.test(msg)) return { content: [{ type: "text", text: `Salesforce pull isn't supported yet — only HubSpot, Pipedrive, and Attio.` }] };
        return { content: [{ type: "text", text: `Couldn't sync: ${msg}` }] };
      }
    }
  );

  // ===========================================================================
  // TOOL: set_trigger / list_triggers  —  /v2/workspace/triggers
  // Outbound event triggers (webhooks) — wire the user's stack to fire when the
  // record changes.
  // ===========================================================================
  server.tool(
    "set_trigger",
    "Create an outbound event trigger (a webhook) so an external tool is notified when something " +
    "happens in the workspace — e.g. a new contact, a reply, a meeting booked. Pass the destination " +
    "URL and which events to fire on. Call list_triggers first to see the available event names.",
    {
      url: z.string().describe("The destination URL the event is POSTed to."),
      events: z.array(z.string()).describe("Event names to fire on (see list_triggers for the catalog)."),
      name: z.string().optional().describe("Optional label for the trigger."),
    },
    async ({ url, events, name }) => {
      try {
        const r = await post("/v2/workspace/triggers", { url, events, name });
        return { content: [{ type: "text", text: `Trigger created for ${events.join(", ")} → ${url}.` }] };
      } catch (e) {
        const msg = String(e?.message ?? e);
        return { content: [{ type: "text", text: `Couldn't create the trigger: ${msg}. Call list_triggers to see valid event names.` }] };
      }
    }
  );
  server.tool(
    "list_triggers",
    "List the workspace's outbound event triggers (webhooks) and the catalog of available event names.",
    {},
    async () => {
      const r = await get("/v2/workspace/triggers");
      const lines = [];
      if (r.triggers?.length) {
        lines.push(`TRIGGERS (${r.triggers.length}):`);
        for (const t of r.triggers) lines.push(`  ${t.name || "(unnamed)"} → ${t.url}  [${(t.events || []).join(", ")}]`);
      } else {
        lines.push("No triggers set up yet.");
      }
      if (r.available_events?.length) {
        lines.push("", `AVAILABLE EVENTS: ${r.available_events.join(", ")}`);
      }
      return { content: [{ type: "text", text: lines.join("\n").trim() }] };
    }
  );

  // ===========================================================================
  // TOOL: lead_list_operations  —  GET /api/lead-lists[/:id/operations]
  // The operations trail for a lead list: imports, enrichment runs, pushes to
  // campaigns, and replies — filterable by category and time window. This is how
  // you answer "what happened on this list?" and attribute campaign performance
  // back to where the leads came from (the list's source). Call with no
  // lead_list_id to discover the lists and their ids first.
  // ===========================================================================
  server.tool(
    "lead_list_operations",
    "Inspect the operations trail of a lead list — imports, enrichment runs, pushes to campaigns, " +
    "and classified replies — to report on what happened and attribute outcomes to a list's source. " +
    "Call with NO lead_list_id to list the workspace's lead lists (id, name, count, source), then " +
    "call again with an id. Filter with `event` (import | enrich | export | reply) and `days`. " +
    "Each operation is a run-level summary (one row per import/enrich/push), not per-lead noise.",
    {
      lead_list_id: z.string().optional().describe("The lead list's UUID. Omit to list the available lead lists first."),
      event: z.enum(["import", "enrich", "export", "reply"]).optional().describe("Filter to one category of operation."),
      days: z.number().optional().describe("Look back this many days (default 30). Pass a large number for all-time."),
      limit: z.number().optional().describe("Max operations to return (default 100, cap 200)."),
    },
    async ({ lead_list_id, event, days, limit }) => {
      // Discovery mode — no list id yet. Return the lists so the agent can pick.
      if (!lead_list_id) {
        const r = await get("/api/lead-lists");
        const lists = r.lead_lists || [];
        const lines = lists.length
          ? [`LEAD LISTS (${lists.length}):`,
             ...lists.map(l => `  ${l.id}  ${l.name}  · ${l.lead_count ?? 0} leads · source: ${l.source || "—"}`),
             "", "Call lead_list_operations again with one of these ids (and an optional event filter)."]
          : ["No lead lists yet."];
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      const r = await get(`/api/lead-lists/${encodeURIComponent(lead_list_id)}/operations`, { event, days, limit });
      const ops = r.operations || [];
      const lines = [];
      const summary = Object.entries(r.by_category || {}).map(([k, v]) => `${k} ${v}`).join(" · ");
      lines.push(`OPERATIONS${event ? ` · ${event}` : ""} (${ops.length})${summary ? ` — ${summary}` : ""}`);
      if (!ops.length) {
        lines.push("", "No operations in this window.");
      } else {
        for (const o of ops) {
          const cat = o.metadata?.category || o.event_type;
          lines.push(`  ${relAge(o.occurred_at).padEnd(8)} ${String(cat).padEnd(8)} ${o.summary}`);
        }
      }
      return { content: [{ type: "text", text: lines.join("\n").trim() }] };
    }
  );

  // ===========================================================================
  // TOOL: coverage  —  POST /v2/dedup (exact) | GET /v2/people/coverage (estimate)
  // "What do I already have?" before spending on a list elsewhere. One tool, two
  // modes: pass identifiers for an EXACT per-lead net-new/re-enrich/reuse check
  // (the pre-spend gate), or a title/keyword for a rough attribute ESTIMATE.
  // (Replaces the former check_leads + lead_coverage tools.)
  // ===========================================================================
  server.tool(
    "coverage",
    "Check what you ALREADY have before spending on a list elsewhere (Apollo, Sales Navigator, Clay). " +
    "Two modes:\n" +
    "  • EXACT — pass candidate identifiers (emails / linkedin_urls / domains, free in any tool's " +
    "preview). Returns per-lead buckets: net_new (acquire + enrich), needs_enrichment (you OWN these " +
    "but stale >90d — re-enrich, don't re-buy), reusable (fresh verified email on file — reuse, spend " +
    "nothing), plus engaged/recent/known/bounced to skip. Each result carries entity_id, email_status, " +
    "enriched_at, stale.\n" +
    "  • ESTIMATE — pass a title and/or keyword instead. Returns how many people you already have " +
    "matching (e.g. title='founder', keyword='agency'), split by freshness: never-enriched, stale >90d, " +
    "fresh-verified. Rough by design (title precise; keyword matches title/company/department).\n" +
    "Pass identifiers for the exact pre-spend check, OR title/keyword for the planning estimate — not both.",
    {
      emails: z.array(z.string()).optional().describe("EXACT mode — candidate email addresses (up to 50,000)."),
      linkedin_urls: z.array(z.string()).optional().describe("EXACT mode — candidate LinkedIn profile URLs (up to 50,000)."),
      domains: z.array(z.string()).optional().describe("EXACT mode — company domains, 'do I already have anyone here?' (up to 50,000)."),
      title: z.string().optional().describe("ESTIMATE mode — role match, e.g. 'founder', 'VP Sales' (matches job_title)."),
      keyword: z.string().optional().describe("ESTIMATE mode — extra match across title/company/department, e.g. 'agency'."),
      stale_days: z.number().optional().describe("ESTIMATE mode — days after which enrichment counts as stale (default 90)."),
    },
    async ({ emails, linkedin_urls, domains, title, keyword, stale_days }) => {
      const hasIds  = !!(emails?.length || linkedin_urls?.length || domains?.length);
      const hasAttr = !!(title || keyword);
      if (hasIds && hasAttr) {
        return { content: [{ type: "text", text:
          "Pass identifiers (emails/linkedin_urls/domains) for the exact check, OR title/keyword for the estimate — not both." }] };
      }

      // EXACT mode — per-identifier coverage against /v2/dedup.
      if (hasIds) {
        const body = {};
        if (emails?.length) body.emails = emails;
        if (linkedin_urls?.length) body.linkedin_urls = linkedin_urls;
        if (domains?.length) body.domains = domains;
        const r = await post("/v2/dedup", body);
        const s = r.summary || {};
        const lines = [
          `COVERAGE (${s.total ?? 0} checked)`,
          `  net_new          ${s.net_new ?? 0}   → acquire + enrich`,
          `  needs_enrichment ${s.needs_enrichment ?? 0}   → you OWN these but stale (>90d) → re-enrich, don't re-buy`,
          `  reusable         ${s.reusable ?? 0}   → fresh verified email on file → reuse, spend nothing`,
          `  engaged          ${s.engaged ?? 0}   → in an active conversation, don't cold-send`,
          `  recent           ${s.recent ?? 0}   → contacted <30d, defer`,
          `  known            ${s.known ?? 0}   → company already in the workspace`,
          `  bounced/unsub    ${(s.bounced ?? 0) + (s.unsubscribed ?? 0) + (s.suppressed ?? 0)}   → skip`,
        ];
        // Surface a few stale entities the caller should re-enrich (with their last date).
        const stale = (r.results || []).filter(x => x.entity_id && x.stale).slice(0, 15);
        if (stale.length) {
          lines.push("", "RE-ENRICH (sample):");
          for (const x of stale) {
            lines.push(`  ${x.value}  [${x.enriched_at ? `last enriched ${relAge(x.enriched_at)}` : "never enriched"}]  ${x.entity_id}`);
          }
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      // ESTIMATE mode — attribute coverage against /v2/people/coverage.
      if (hasAttr) {
        const r = await get("/v2/people/coverage", { title, keyword, stale_days });
        const lines = [
          `COVERAGE — ${[title && `title~"${title}"`, keyword && `keyword~"${keyword}"`].filter(Boolean).join(" + ")}`,
          `  ${r.total ?? 0} already in your workspace`,
          `    ${r.needs_enrichment ?? 0} need (re-)enrichment  (${r.never_enriched ?? 0} never enriched · ${r.stale ?? 0} stale >90d)`,
          `    ${r.fresh_verified ?? 0} have a fresh verified email`,
        ];
        const sample = r.sample || [];
        if (sample.length) {
          lines.push("", "SAMPLE (oldest first):");
          for (const s of sample.slice(0, 12)) {
            lines.push(`  ${[s.job_title, s.company].filter(Boolean).join(" @ ") || s.entity_id}  [${s.enriched_at ? `enriched ${relAge(s.enriched_at)}` : "never enriched"}]`);
          }
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      return { content: [{ type: "text", text:
        "Pass at least one of: emails / linkedin_urls / domains (exact check), or title / keyword (estimate)." }] };
    }
  );

  // ===========================================================================
  // TOOLS: enrich_leads / verify_leads  —  POST /api/lead-lists/:id/enrich|verify
  // The agent OPERATES the lead list. Both are two-step: a dry-run preview that
  // quotes the chargeable count + provider + $ estimate (report it to the user
  // first), then a confirmed run as a background job. Target by `filter` so no
  // ids are needed (enrich {emailStatus:'none'} = all missing an email; verify
  // defaults to all unverified). BYOK — the $ is the user's own provider spend.
  // ===========================================================================
  const fmtCost = (c) => {
    if (!c) return "no chargeable records — nothing to spend";
    const money = c.low === c.high ? `~$${c.low.toFixed(2)}` : `~$${c.low.toFixed(2)}–$${c.high.toFixed(2)}`;
    return `${money} via ${c.label} (${(c.count ?? 0).toLocaleString()} ${c.action})`;
  };
  const LEAD_FILTER_SHAPE = {
    emailStatus: z.enum(["has", "none", "unverified"]).optional().describe("none = no email yet; unverified = has an email but no verification verdict; has = has any email."),
    domain: z.enum(["has", "none"]).optional().describe("has = a company domain is known; none = no domain."),
    icp: z.enum(["true", "false"]).optional().describe("true = ICP-qualified leads only."),
    status: z.string().optional().describe("Lifecycle: pending | sent | replied | bounced."),
    source: z.string().optional().describe("Substring of where the lead came from (campaign / import name)."),
    size: z.string().optional().describe("Substring of company size, e.g. '1 to 10'."),
    channel: z.string().optional().describe("Last-contacted channel substring, or 'none' for not-yet-contacted."),
  };

  server.tool(
    "enrich_leads",
    "Find missing emails for leads in a lead list, on the workspace's own Prospeo/Apollo key. ALWAYS two " +
    "steps: call WITHOUT confirm for a dry-run cost preview (chargeable count, provider, $ estimate) — " +
    "report it and get the user's go-ahead — then call again with confirm:true to run as a background job. " +
    "Pick leads with `filter` (e.g. {emailStatus:'none'} = every lead missing an email, the usual case) or " +
    "explicit `ids`; defaults to {emailStatus:'none'}. Call lead_list_operations with no id first to get the " +
    "list's id.",
    {
      lead_list_id: z.string().describe("The lead list's UUID."),
      filter: z.object(LEAD_FILTER_SHAPE).optional().describe("Pick leads by attribute. Omit (with no ids) to default to all leads missing an email."),
      ids: z.array(z.string()).optional().describe("Explicit lead ids — an alternative to filter."),
      confirm: z.boolean().optional().describe("Omit or false = dry-run cost preview only (spends nothing). true = actually run it as a background job."),
    },
    async ({ lead_list_id, filter, ids, confirm }) => {
      const sel = (ids && ids.length) ? { ids } : { filter: filter || { emailStatus: "none" } };
      const path = `/api/lead-lists/${encodeURIComponent(lead_list_id)}/enrich`;
      try {
        if (!confirm) {
          const r = await post(path, { ...sel, preview: true });
          const lines = [
            `ENRICH PREVIEW — list ${lead_list_id}`,
            `  ${r.total ?? 0} selected · ${r.chargeable ?? 0} chargeable · ${r.reused ?? 0} already on file (free) · ${r.no_identifier ?? 0} no identifier`,
            `  provider: ${r.provider || "—"}`,
            `  estimated cost: ${fmtCost(r.cost)}`,
            "",
            r.chargeable
              ? "Report this to the user. To run it, call enrich_leads again with the same selection and confirm:true."
              : "Nothing chargeable to enrich.",
          ];
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }
        const r = await post(path, { ...sel, background: true });
        return { content: [{ type: "text", text:
          `Enrichment started — job ${r.job_id}, ${r.total} lead${r.total === 1 ? "" : "s"} queued. It runs in the background; report back to the user that it's running.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Couldn't enrich: ${e.message}` }] };
      }
    }
  );

  server.tool(
    "verify_leads",
    "Validate email deliverability for leads in a lead list, on the workspace's own MillionVerifier / " +
    "NeverBounce key. ALWAYS two steps: call WITHOUT confirm for a dry-run cost preview (chargeable count, " +
    "connected verifiers, $ estimate) — report it to the user — then call again with confirm:true to run as " +
    "a background job. Defaults to every UNVERIFIED email (has an address, no verdict yet); narrow with " +
    "`filter` or pass `ids`. If no verifier is connected it says so — tell the user to add a MillionVerifier " +
    "or NeverBounce key in Integrations.",
    {
      lead_list_id: z.string().describe("The lead list's UUID."),
      filter: z.object(LEAD_FILTER_SHAPE).optional().describe("Pick leads by attribute. Omit (with no ids) to default to all unverified emails."),
      ids: z.array(z.string()).optional().describe("Explicit lead ids — an alternative to filter."),
      provider: z.enum(["millionverifier", "neverbounce"]).optional().describe("Which verifier to use. Defaults to MillionVerifier, then NeverBounce."),
      confirm: z.boolean().optional().describe("Omit or false = dry-run cost preview only. true = actually run it as a background job."),
    },
    async ({ lead_list_id, filter, ids, provider, confirm }) => {
      const sel = (ids && ids.length) ? { ids } : { filter: filter || { emailStatus: "unverified" } };
      const path = `/api/lead-lists/${encodeURIComponent(lead_list_id)}/verify`;
      try {
        if (!confirm) {
          const r = await post(path, { ...sel, provider, preview: true });
          const lines = [
            `VERIFY PREVIEW — list ${lead_list_id}`,
            `  ${r.total ?? 0} selected · ${r.chargeable ?? 0} chargeable · ${r.reused ?? 0} recently verified (free) · ${r.no_email ?? 0} no email`,
            `  verifier: ${r.provider || "—"}${r.connected_verifiers ? `  (connected: ${r.connected_verifiers.join(", ") || "none"})` : ""}`,
            `  estimated cost: ${fmtCost(r.cost)}`,
            "",
            r.chargeable
              ? "Report this to the user. To run it, call verify_leads again with the same selection and confirm:true."
              : "Nothing chargeable to verify.",
          ];
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }
        const r = await post(path, { ...sel, provider, background: true });
        return { content: [{ type: "text", text:
          `Verification started — job ${r.job_id}, ${r.total} email${r.total === 1 ? "" : "s"} queued via ${r.provider}. It runs in the background; report back to the user.` }] };
      } catch (e) {
        const msg = /no_verifier_connected/.test(e.message)
          ? "No email verifier is connected. Tell the user to add a MillionVerifier or NeverBounce API key in Integrations, then try again."
          : `Couldn't verify: ${e.message}`;
        return { content: [{ type: "text", text: msg }] };
      }
    }
  );

  // ===========================================================================
  // TOOL: get_routing_preferences
  // The routing preferences that make THIS agent default to Nous for GTM. The
  // agent applies them itself in Claude Code (write to CLAUDE.md); for claude.ai
  // the user pastes them into Org preferences. Not applicable to Codex/others.
  // ===========================================================================
  server.tool(
    "get_routing_preferences",
    "Get the routing preferences that make this agent treat Nous as the DEFAULT for GTM — so it " +
    "reaches for get_context / get_account instead of raw CRM or HubSpot / Salesforce / Gong / " +
    "Granola when someone forgets to say \"Nous\". This is an OPTIONAL onboarding step, and " +
    "CLAUDE CODE-specific. If you are running in Claude Code, set it up for the user: ask whether to " +
    "apply it to this project (write the returned text to ./CLAUDE.md) or to all projects " +
    "(~/.claude/CLAUDE.md), then write it there. The user can also paste it into claude.ai → Settings " +
    "→ Organization preferences (Team/Enterprise) or Personal preferences (Pro). If you are NOT Claude " +
    "Code (Codex, Cursor, n8n, …), this does not apply — skip it.",
    {},
    async () => {
      return { content: [{ type: "text", text:
        `Routing preferences (write to the user's CLAUDE.md in Claude Code, or have them paste into ` +
        `claude.ai → Settings → Organization/Personal preferences):\n\n${ROUTING_PREFERENCES}` }] };
    }
  );

  return server;
}

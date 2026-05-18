#!/usr/bin/env node

/**
 * Proply MCP Server — contact intelligence for GTM agents.
 *
 * Required env vars:
 *   PROPLY_API_KEY        — Your Proply API key (Settings → API Keys)
 *
 * Optional:
 *   PROPLY_API_URL        — API base URL (default: https://api.goproply.com)
 *
 * Tools:
 *   get_contact    — full contact profile: identity + activities + facts + summary
 *   get_company    — full company profile: org details + all contacts + company facts
 *   create_contact — add a new contact with full profile fields
 *   update_contact — update profile fields on an existing contact
 *   track          — record that something happened (call, email, meeting, visit)
 *   remember       — store a fact learned about a contact or company
 *   list_contacts  — find contacts by pipeline stage
 *   search         — semantic search across workspace memories
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { validateConfig, get, post, patch, del } from "./client.js";

// ─── Context engineering helpers ──────────────────────────────────────────────

// Activity types with known direction
const ALWAYS_OUT = new Set(["email_sent", "follow_up_sent", "proposal_sent"]);
const ALWAYS_IN  = new Set(["website_visit", "content_download", "trial_started", "email_reply", "linkedin_replied"]);
const OUT_SOURCES = new Set(["agent", "mcp", "sdk", "api"]);

function actDir(a) {
  if (ALWAYS_OUT.has(a.type)) return "out";
  if (ALWAYS_IN.has(a.type))  return "in";
  // LinkedIn webhook captures both sent and received — check description
  if (a.source === "linkedin" && a.type === "linkedin_message") {
    const d = (a.description || "").toLowerCase();
    if (d.startsWith("linkedin message sent") || d.includes(" sent to ")) return "out";
    return "in";
  }
  if (OUT_SOURCES.has(a.source)) return "out";
  if (a.source) return "in"; // any other source = webhook-delivered = inbound
  return "neutral";
}

const ARROW = { out: "→", in: "←", neutral: "↔" };

// Higher = show first when capping 7-30d to top 3
const SIGNAL_WEIGHT = {
  proposal_sent: 10, trial_started: 9, call_held: 8, meeting_held: 8,
  email_reply: 6, email_sent: 6, follow_up_sent: 5,
  linkedin_message: 4, content_download: 4,
  website_visit: 3, linkedin_connected: 3, manual_note: 2,
};

function relAge(ts) {
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  if (d < 1)  return "today";
  if (d === 1) return "1d ago";
  if (d < 30) return `${d}d ago`;
  const m = Math.floor(d / 30);
  if (m < 12) return `${m}mo ago`;
  return `${Math.floor(m / 12)}y ago`;
}

function fmtShortDate(ts) {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtType(t) {
  return t.replace(/_/g, " ");
}

validateConfig();

const server = new McpServer({
  name: "proply",
  version: "0.8.9",
  description: "Proply — contact intelligence for GTM agents. Call get_contact before acting on any person. Call track and remember after every interaction.",
  icons: [
    { src: "https://goproply.com/newlogoP.png", mimeType: "image/png", sizes: ["64x64"] },
  ],
});

// ---------------------------------------------------------------------------
// TOOL: get_contact
// The one call you need. Returns everything known about a contact:
// identity, pipeline stage, memory summary, recent activities, and facts.
// ---------------------------------------------------------------------------
server.tool(
  "get_contact",
  "Get everything known about a contact — identity, pipeline stage, status (are you waiting on them or are they waiting on you?), AI summary, recent activities with direction arrows (← inbound / → outbound), and stored facts. Call this before writing any email, preparing for a call, or making a decision. Also call get_memories for outreach history. Pass email or contact_id.",
  {
    email: z.string().optional().describe("Contact's email address"),
    contact_id: z.string().optional().describe("Contact UUID — use if you already have it"),
  },
  async ({ email, contact_id }) => {
    if (!email && !contact_id) {
      return { content: [{ type: "text", text: "Error: provide either email or contact_id." }] };
    }

    const identifier = encodeURIComponent(contact_id || email);
    const since90 = new Date(Date.now() - 90 * 86400000).toISOString();

    const [c, actData] = await Promise.all([
      get(`/v1/contacts/${identifier}`),
      get(`/v1/contacts/${identifier}/activity`, { limit: 100, since: since90 }).catch(() => ({ activities: [] })),
    ]);

    const contactId = c.id || c.contact_id;
    const name = c.name || c.email;
    const header = [name, c.title, c.company].filter(Boolean).join(" · ");
    const scores = [
      `Stage: ${c.pipeline_stage || "identified"}`,
      c.icp_score != null         ? `ICP: ${c.icp_score}`             : null,
      c.deal_health_score != null ? `Health: ${c.deal_health_score}`  : null,
    ].filter(Boolean).join("  |  ");

    const lines = [header, scores];

    // ── Activity timeline — temporal compression ──────────────────────────────
    const activities = actData.activities ?? [];
    const now = Date.now();
    const ms7  = 7  * 86400000;
    const ms30 = 30 * 86400000;

    const hot  = [];   // 0–7 days  → full body + direction arrow
    const warm = [];   // 7–30 days → description + direction arrow, capped to top 3 by signal weight
    const counts = {}; // 30–90 days → counts by type

    for (const a of activities) {
      const age = now - new Date(a.occurred_at).getTime();
      if (age < ms7)        hot.push(a);
      else if (age < ms30)  warm.push(a);
      else                  counts[a.type] = (counts[a.type] || 0) + 1;
    }

    // ── Status line — derived from most recent activity direction ─────────────
    if (activities.length) {
      const latest = activities[0];
      const dir = actDir(latest);
      const when = relAge(latest.occurred_at);
      if (dir === "in") {
        lines.push(`\nStatus: ← Waiting on your reply · ${when}`);
      } else if (dir === "out") {
        lines.push(`\nStatus: → You reached out · ${when}`);
      } else {
        lines.push(`\nStatus: ↔ Last touch · ${when}`);
      }
    }

    if (c.memory_summary || c.summary) {
      lines.push(`\nSummary: ${c.memory_summary || c.summary}`);
    }

    if (hot.length || warm.length || Object.keys(counts).length) {
      if (hot.length) {
        lines.push(`\nLast 7 days (${hot.length}):`);
        for (const a of hot) {
          const arrow = ARROW[actDir(a)];
          const content = a.body || a.description || null;
          lines.push(`  ${arrow} ${fmtShortDate(a.occurred_at)}  ${fmtType(a.type)}${content ? `: "${content}"` : ""}`);
        }
      }
      if (warm.length) {
        const topWarm = warm
          .slice()
          .sort((a, b) => (SIGNAL_WEIGHT[b.type] ?? 0) - (SIGNAL_WEIGHT[a.type] ?? 0))
          .slice(0, 3);
        lines.push(`\n7–30 days (showing ${topWarm.length} of ${warm.length}):`);
        for (const a of topWarm) {
          const arrow = ARROW[actDir(a)];
          const desc = a.description ? `: ${a.description}` : "";
          lines.push(`  ${arrow} ${fmtShortDate(a.occurred_at)}  ${fmtType(a.type)}${desc}`);
        }
      }
      if (Object.keys(counts).length) {
        const summary = Object.entries(counts)
          .sort(([, a], [, b]) => b - a)
          .map(([t, n]) => `${n}× ${fmtType(t)}`)
          .join(" · ");
        lines.push(`\nHistory (30–90d): ${summary}`);
      }
    } else {
      lines.push("\nNo activity in the last 90 days.");
    }

    // ── Facts — capped at 5, newest first with relative age ──────────────────
    const allFacts = c.facts ?? [];
    const contactFacts = allFacts.filter(f => f.scope !== "company");
    const companyFacts = allFacts.filter(f => f.scope === "company");

    if (contactFacts.length) {
      const shown = contactFacts.slice(0, 5);
      const extra = contactFacts.length - shown.length;
      lines.push(`\nFacts${extra > 0 ? ` (+${extra} more)` : ""}:`);
      for (const f of shown) {
        const age = f.written_at ? ` · ${relAge(f.written_at)}` : "";
        lines.push(`  [${f.category}] ${f.content}${age}`);
      }
    }

    if (companyFacts.length) {
      lines.push(`\nCompany facts:`);
      for (const f of companyFacts) {
        const age = f.written_at ? ` · ${relAge(f.written_at)}` : "";
        lines.push(`  [${f.category}] ${f.content}${age}`);
      }
    }

    const text = lines.join("\n");
    return {
      content: [{
        type: "text",
        text: `${text}\n\n(contact_id: ${contactId}${c.company_id ? ` · company_id: ${c.company_id}` : ""})`,
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// TOOL: track
// Record that something happened — a call, email, meeting, website visit.
// For what you *learned*, also call remember.
// ---------------------------------------------------------------------------

const TRACK_NEXT_STEP = {
  call_held:        "Call remember if you learned something worth keeping.",
  meeting_held:     "Call remember if you learned something worth keeping.",
  email_reply:      "They replied — draft your response or update the pipeline stage.",
  linkedin_replied: "They replied — draft your response or update the pipeline stage.",
  proposal_sent:    "Flag for follow-up if no reply in 3 days.",
  follow_up_sent:   "Consider updating the pipeline stage if they're not engaging.",
  trial_started:    "High-intent signal — consider moving to evaluating stage.",
  linkedin_connected: "Good opener — send an intro message.",
};

server.tool(
  "track",
  "Record an interaction with a contact — email sent, call held, meeting completed, website visit, etc. Pass email or contact_id. If you learned something meaningful, also call remember.",
  {
    email: z.string().optional().describe("Contact's email address"),
    contact_id: z.string().optional().describe("Contact UUID"),
    type: z.enum([
      "email_sent", "email_reply",
      "call_held", "meeting_held",
      "linkedin_message", "linkedin_connected", "linkedin_replied",
      "follow_up_sent", "proposal_sent",
      "website_visit", "content_download", "trial_started",
      "manual_note",
    ]).describe("Activity type"),
    description: z.string().optional().describe("Brief summary of what happened"),
    occurred_at: z.string().optional().describe("ISO timestamp — defaults to now"),
  },
  async ({ email, contact_id, type, description, occurred_at }) => {
    if (!email && !contact_id) {
      return { content: [{ type: "text", text: "Error: provide either email or contact_id." }] };
    }

    const body = { source: "agent", type };
    if (contact_id) body.contact_id = contact_id;
    else body.email = email;
    if (description) body.description = description;
    if (occurred_at) body.occurred_at = occurred_at;

    const result = await post("/v1/track", body);

    const parts = [`Logged \`${type}\`${description ? `: "${description}"` : ""}.`];

    if (result.created_contact) {
      parts.push(`(New contact created — contact_id: ${result.contact_id})`);
    }

    if (result.stage_after && result.stage_before && result.stage_after !== result.stage_before) {
      parts.push(`Stage advanced: ${result.stage_before} → ${result.stage_after}.`);
    }

    const hint = TRACK_NEXT_STEP[type];
    if (hint) parts.push(`Next: ${hint}`);

    return {
      content: [{ type: "text", text: parts.join("\n") }],
    };
  }
);

// ---------------------------------------------------------------------------
// TOOL: remember
// Store a fact you learned — about a person or their company.
// Write facts, not logs. "Concerned about integration complexity" = fact.
// "Sent email on Tuesday" = log (use track for that).
// ---------------------------------------------------------------------------
server.tool(
  "remember",
  "Store a fact — about a contact, their company, or your own workspace (ICP, product, market). Omit email and contact_id to store workspace-level facts. Pass email or contact_id to scope to a person. Set company=true to tag to their whole org. Similar existing facts in the same scope are automatically superseded — no duplicates accumulate.",
  {
    email: z.string().optional().describe("Contact's email — omit for workspace-level facts"),
    contact_id: z.string().optional().describe("Contact UUID — omit for workspace-level facts"),
    fact: z.string().describe("The fact to store — one clear, reusable sentence"),
    category: z.enum(["ICP", "Product", "Pricing", "Market", "Competitors", "Team", "Patterns", "General"])
      .optional()
      .describe("Memory category (default: General)"),
    company: z.boolean().optional().describe("Set true to tag this fact to the whole company, not just this person"),
  },
  async ({ email, contact_id, fact, category = "General", company = false }) => {
    let body = { text: fact, category, source: "agent" };

    if (company && (email || contact_id)) {
      const identifier = encodeURIComponent(contact_id || email);
      const c = await get(`/v1/contact/${identifier}`);
      if (!c.company_id) {
        return { content: [{ type: "text", text: "Cannot scope to company — contact has no company_id. Storing in workspace memory instead." }] };
      }
      body.company_id = c.company_id;
    } else if (contact_id) {
      body.contact_id = contact_id;
    } else if (email) {
      body.email = email;
    }
    // else: no email/contact_id = workspace-level fact

    const result = await post("/v1/remember", body);
    const stored = result.stored ?? 0;

    if (stored === 0) {
      return { content: [{ type: "text", text: "No new facts extracted — already known or too vague." }] };
    }

    const scope = company ? "company memory" : (contact_id || email) ? "contact memory" : "workspace memory";
    const factList = (result.facts ?? []).map(f => {
      const superseded = f.superseded ? " (superseded previous)" : "";
      return `"${f.content}"${superseded}`;
    }).join(", ");

    return {
      content: [{
        type: "text",
        text: `Stored ${stored} fact${stored !== 1 ? "s" : ""} in ${scope} [${category}]: ${factList}`,
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// TOOL: get_company
// Full company profile — org details + every contact at that company + company facts.
// ---------------------------------------------------------------------------
server.tool(
  "get_company",
  "Get the full profile for a company — org details, all contacts at that account, and company-level facts. Pass a company UUID (available on any contact as company_id).",
  {
    company_id: z.string().describe("Company UUID — get this from contact.company_id"),
  },
  async ({ company_id }) => {
    const c = await get(`/v1/company/${encodeURIComponent(company_id)}`);

    const lines = [
      `${c.name}${c.domain ? ` (${c.domain})` : ""}`,
      [
        c.industry         ? `Industry: ${c.industry}` : null,
        c.employee_count   ? `Size: ${c.employee_count}` : null,
        c.deal_health_score != null ? `Health: ${c.deal_health_score}` : null,
      ].filter(Boolean).join("  |  "),
    ];

    const contacts = c.contacts ?? [];
    if (contacts.length) {
      lines.push(`\nContacts (${contacts.length} of ${c.total_contacts ?? contacts.length}):`);
      for (const con of contacts) {
        const role = con.title ? ` · ${con.title}` : "";
        lines.push(`  ${con.name || con.email}${role} — ${con.pipeline_stage || "identified"} (${con.contact_id || con.id})`);
      }
    }

    const facts = c.facts ?? [];
    if (facts.length) {
      lines.push(`\nCompany facts:`);
      for (const f of facts) {
        const age = f.written_at ? ` · ${relAge(f.written_at)}` : "";
        lines.push(`  [${f.category}] ${f.content}${age}`);
      }
    }

    return {
      content: [{ type: "text", text: `${lines.join("\n")}\n\n(company_id: ${c.company_id})` }],
    };
  }
);

// ---------------------------------------------------------------------------
// TOOL: search
// Semantic search across workspace memories. Scope to one contact or search workspace-wide.
// ---------------------------------------------------------------------------
server.tool(
  "search",
  "Semantic search across all stored facts in the workspace. Scope to one contact or company, or omit to search workspace-wide. Useful for finding context before drafting a message or preparing for a call.",
  {
    q: z.string().describe("Search query — e.g. 'budget concerns', 'Salesforce migration'"),
    contact_id: z.string().optional().describe("Scope to one contact — uses lenient matching (threshold 0.45)"),
    company_id: z.string().optional().describe("Scope to one company"),
    limit: z.number().min(1).max(20).optional().describe("Max results (default 10)"),
  },
  async ({ q, contact_id, company_id, limit = 10 }) => {
    const body = { q, limit };
    if (contact_id) body.contact_id = contact_id;
    if (company_id) body.company_id = company_id;

    const data = await post("/v1/search", body);
    const results = data.results ?? [];

    if (!results.length) {
      return { content: [{ type: "text", text: `No memories found for "${q}".` }] };
    }

    const lines = results.map(r => {
      const age = r.written_at ? ` · ${relAge(r.written_at)}` : "";
      const scope = r.scope === "contact" && r.contact_id ? ` · contact:${r.contact_id}`
                  : r.scope === "company" && r.company_id ? ` · company:${r.company_id}`
                  : r.scope === "workspace"               ? ` · workspace`
                  : "";
      return `  [${r.category}]${age}${scope} ${r.content}`;
    });

    return {
      content: [{
        type: "text",
        text: `Search results for "${q}" (${results.length}):\n${lines.join("\n")}`,
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// TOOL: list_contacts
// Find contacts by pipeline stage — useful for identifying who to reach out to next.
// ---------------------------------------------------------------------------
server.tool(
  "list_contacts",
  "List contacts sorted by urgency (high ICP + longest since last touch first). Use stage to focus on a specific pipeline stage. Contacts marked !! are high-ICP and have gone cold — prioritize those.",
  {
    stage: z.enum(["identified", "aware", "interested", "evaluating", "client"])
      .optional()
      .describe("Filter by pipeline stage — omit to list all"),
    filter: z.enum(["hot", "engaged"]).optional()
      .describe("hot = active in last 14d with health≥45; engaged = active in last 60d"),
    limit: z.number().min(1).max(50).optional().describe("Max contacts to return (default 20)"),
  },
  async ({ stage, filter, limit = 20 }) => {
    const params = { limit, sort: "urgency" };
    if (stage)  params.pipeline_stage = stage;
    if (filter) params.filter = filter;

    const data = await get("/v1/contacts", params);
    const contacts = data.contacts ?? [];
    const total    = data.total ?? contacts.length;

    if (!contacts.length) {
      return { content: [{ type: "text", text: stage ? `No contacts in stage "${stage}".` : "No contacts found." }] };
    }

    const daysSince = c => c.last_activity_at
      ? Math.floor((Date.now() - new Date(c.last_activity_at).getTime()) / 86400000)
      : 999;

    const shown = contacts;

    const lines = shown.map(c => {
      const name    = c.name || c.email;
      const company = c.company ? ` @ ${c.company}` : "";
      const icp     = c.icp_score != null ? ` · ICP:${c.icp_score}` : "";
      const d       = daysSince(c);
      const age     = d === 999 ? " · never touched" : ` · ${relAge(c.last_activity_at)}`;
      const flag    = d > 7 && (c.icp_score ?? 0) >= 70 ? "!! " : "   ";
      return `${flag}${name}${company} — ${c.pipeline_stage || "identified"}${icp}${age} (${c.id})`;
    });

    const header = `Contacts${stage ? ` — ${stage}` : ""}${filter ? ` [${filter}]` : ""} (${shown.length} of ${total}, sorted by urgency):`;
    const legend = shown.some(c => daysSince(c) > 7 && (c.icp_score ?? 0) >= 70)
      ? "!! = high ICP, gone cold\n"
      : "";

    return {
      content: [{
        type: "text",
        text: `${header}\n${legend}${lines.join("\n")}`,
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// TOOL: get_memories
// Load all workspace-level facts — ICP, product, market, competitive intel.
// ---------------------------------------------------------------------------
server.tool(
  "get_memories",
  "Load all workspace-level facts — your ICP, product description, pricing, market positioning, and competitive intel. Call this before drafting outreach, preparing a pitch, or any task that requires knowing your own company context. Not for contact or company facts — use get_contact for those.",
  {
    category: z.enum(["ICP", "Product", "Pricing", "Market", "Competitors", "Team", "Patterns", "General"])
      .optional()
      .describe("Filter by category — omit to get all"),
    limit: z.number().min(1).max(200).optional().describe("Max facts to return (default 50)"),
  },
  async ({ category, limit = 50 }) => {
    const params = { limit };
    if (category) params.category = category;

    const data = await get("/v1/memories", params);
    const memories = data.memories ?? [];

    if (!memories.length) {
      return { content: [{ type: "text", text: `No workspace facts stored yet${category ? ` in category "${category}"` : ""}. Use remember (without a contact) to store ICP, product, or market facts.` }] };
    }

    const byCategory = {};
    for (const m of memories) {
      if (!byCategory[m.category]) byCategory[m.category] = [];
      byCategory[m.category].push(m.content);
    }

    const lines = [];
    for (const [cat, facts] of Object.entries(byCategory)) {
      lines.push(`[${cat}]`);
      for (const f of facts) lines.push(`  • ${f}`);
    }

    return {
      content: [{
        type: "text",
        text: `Workspace knowledge (${memories.length} fact${memories.length !== 1 ? "s" : ""}):\n\n${lines.join("\n")}`,
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// TOOL: create_contact
// Add a new contact with full profile fields. Returns the new contact_id.
// ---------------------------------------------------------------------------
server.tool(
  "create_contact",
  "Create a new contact with their full profile — name, title, company, phone, LinkedIn, and notes. Use when you have a new person to add before tracking any activity. Returns an error if the email already exists.",
  {
    email:        z.string().describe("Contact's email address (required, must be unique)"),
    first_name:   z.string().optional().describe("First name"),
    last_name:    z.string().optional().describe("Last name"),
    company:      z.string().optional().describe("Company name"),
    job_title:    z.string().optional().describe("Job title or role"),
    phone:        z.string().optional().describe("Phone number"),
    linkedin_url: z.string().optional().describe("LinkedIn profile URL"),
    notes:        z.string().optional().describe("Free-form notes about this contact"),
  },
  async ({ email, first_name, last_name, company, job_title, phone, linkedin_url, notes }) => {
    const result = await post("/v1/contacts", {
      email, first_name, last_name, company, job_title, phone, linkedin_url, notes,
    });

    const name = result.name || result.email;
    const meta = [result.job_title, result.company].filter(Boolean).join(" · ");
    return {
      content: [{
        type: "text",
        text: [
          `Created contact: ${name}`,
          meta ? meta : null,
          `contact_id: ${result.id}`,
          `Stage: ${result.pipeline_stage}`,
        ].filter(Boolean).join("\n"),
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// TOOL: update_contact
// Update profile fields on an existing contact.
// ---------------------------------------------------------------------------
server.tool(
  "update_contact",
  "Update one or more profile fields on an existing contact — name, title, company, phone, LinkedIn, notes. Pass email or contact_id to identify the contact, then any fields to change. Only provided fields are updated.",
  {
    email:        z.string().optional().describe("Contact's email address (to identify them)"),
    contact_id:   z.string().optional().describe("Contact UUID (alternative to email)"),
    first_name:   z.string().optional().describe("Updated first name"),
    last_name:    z.string().optional().describe("Updated last name"),
    company:      z.string().optional().describe("Updated company name"),
    job_title:    z.string().optional().describe("Updated job title or role"),
    phone:        z.string().optional().describe("Updated phone number"),
    linkedin_url: z.string().optional().describe("Updated LinkedIn profile URL"),
    notes:        z.string().optional().describe("Updated free-form notes"),
  },
  async ({ email, contact_id, first_name, last_name, company, job_title, phone, linkedin_url, notes }) => {
    if (!email && !contact_id) {
      return { content: [{ type: "text", text: "Error: provide either email or contact_id." }] };
    }
    const identifier = encodeURIComponent(contact_id || email);
    const result = await patch(`/v1/contacts/${identifier}`, {
      first_name, last_name, company, job_title, phone, linkedin_url, notes,
    });
    const name = result.name || result.email;
    const meta = [result.job_title, result.company].filter(Boolean).join(" · ");
    return {
      content: [{
        type: "text",
        text: [
          `Updated contact: ${name}`,
          meta ? meta : null,
          `contact_id: ${result.id}`,
        ].filter(Boolean).join("\n"),
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// TOOL: delete_contact
// Permanently remove a contact and all their associated data.
// ---------------------------------------------------------------------------
server.tool(
  "delete_contact",
  "Permanently delete a contact and all their data — activities and memories. Use for duplicates, test entries, or explicit removal requests. Cannot be undone. Pass email or contact_id.",
  {
    email: z.string().optional().describe("Contact's email address"),
    contact_id: z.string().optional().describe("Contact UUID"),
  },
  async ({ email, contact_id }) => {
    if (!email && !contact_id) {
      return { content: [{ type: "text", text: "Error: provide either email or contact_id." }] };
    }

    const identifier = encodeURIComponent(contact_id || email);
    const result = await del(`/v1/contacts/${identifier}`);

    return {
      content: [{
        type: "text",
        text: `Deleted contact ${result.email} (${result.contact_id}).`,
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// TOOL: delete_memory
// Soft-delete a workspace memory by ID (marks is_active: false).
// Use to remove outdated or conflicting facts found via get_memories.
// ---------------------------------------------------------------------------
server.tool(
  "delete_memory",
  "Delete a workspace memory by ID — marks it inactive so it no longer appears in get_memories or search. Use to clean up outdated, conflicting, or incorrect facts. Get the memory ID from get_memories output.",
  {
    memory_id: z.string().describe("Memory UUID — get this from get_memories output"),
  },
  async ({ memory_id }) => {
    const result = await del(`/v1/memory/${encodeURIComponent(memory_id)}`);
    return {
      content: [{
        type: "text",
        text: `Deleted memory (${result.id}): "${result.content}"`,
      }],
    };
  }
);

// ---------------------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);

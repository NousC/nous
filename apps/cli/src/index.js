#!/usr/bin/env node

// Nous CLI — a thin client of the v2 Context API.
//
// You read engineered, epistemics-tagged context and write observations.
// You never overwrite — Nous derives the facts.

import { program, Command } from "commander";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_PATH = join(homedir(), ".nous", "config.json");

function readConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
}

function writeConfig(cfg) {
  const dir = join(homedir(), ".nous");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function apiClient() {
  const cfg = readConfig();
  const apiKey = process.env.NOUS_API_KEY || cfg.apiKey;
  const apiUrl = process.env.NOUS_API_URL || cfg.apiUrl || "https://api.opennous.cloud";

  if (!apiKey) {
    console.error("No API key found. Run: nous auth login --key <your-key>");
    process.exit(1);
  }

  async function request(method, path, { body, query } = {}) {
    const url = new URL(path, apiUrl);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url.toString(), {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      console.error(`Error: ${err.error || err.message}`);
      process.exit(1);
    }
    if (res.status === 204) return {};
    return res.json();
  }

  return {
    get: (path, query) => request("GET", path, { query }),
    post: (path, body) => request("POST", path, { body }),
  };
}

// A name that matches several entities comes back as { status: 'ambiguous' }.
// Print the candidates and stop — the caller re-runs with a precise focus.
function handleAmbiguous(r) {
  if (r && r.status === "ambiguous") {
    console.log("Several entities match that focus — re-run with one of:");
    for (const c of r.candidates ?? []) {
      const detail = c.detail ? ` — ${c.detail}` : "";
      console.log(`  ${c.name || "(unnamed)"}${detail}  [${c.entity_id}]`);
    }
    return true;
  }
  return false;
}

// --value accepts JSON ('{"description":"…"}') or a bare string.
function parseValue(raw) {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// nous auth
// ---------------------------------------------------------------------------
program
  .command("auth")
  .description("Manage authentication")
  .addCommand(
    new Command("login")
      .description("Save your API key")
      .requiredOption("--key <key>", "Your Nous API key")
      .option("--url <url>", "API base URL (default: https://api.opennous.cloud)")
      .action(({ key, url }) => {
        const cfg = readConfig();
        cfg.apiKey = key;
        if (url) cfg.apiUrl = url;
        writeConfig(cfg);
        console.log("✓ Authenticated. Run `nous attention` to verify.");
      })
  )
  .addCommand(
    new Command("status")
      .description("Show current auth status")
      .action(() => {
        const cfg = readConfig();
        const key = process.env.NOUS_API_KEY || cfg.apiKey;
        const url = process.env.NOUS_API_URL || cfg.apiUrl || "https://api.opennous.cloud";
        if (key) {
          console.log(`Logged in\nAPI URL: ${url}\nKey: ${key.slice(0, 8)}...`);
        } else {
          console.log("Not logged in. Run: nous auth login --key <your-key>");
        }
      })
  );

// ---------------------------------------------------------------------------
// nous context <focus> — engineered, intent-shaped context for a task
// ---------------------------------------------------------------------------
program
  .command("context <focus>")
  .description("Engineered context for a task about one person or company")
  .option(
    "--intent <intent>",
    "draft_email | follow_up | meeting_prep | call_prep | account_review",
    "account_review"
  )
  .option("--budget <tokens>", "Token budget for the assembled context")
  .option("--json", "Print the raw JSON response")
  .action(async (focus, { intent, budget, json }) => {
    const api = apiClient();
    const ctx = await api.post("/v2/context", {
      focus,
      intent,
      budget_tokens: budget ? Number(budget) : undefined,
    });
    if (handleAmbiguous(ctx)) return;
    if (json) {
      console.log(JSON.stringify(ctx, null, 2));
      return;
    }
    const lines = [`${ctx.entity.type} ${ctx.entity.id}  ·  intent: ${ctx.intent}`];
    if (ctx.summary) lines.push(`\n${ctx.summary}`);
    if (ctx.claims?.length) {
      lines.push(`\nClaims:`);
      ctx.claims.forEach(c => {
        const val = typeof c.value === "object" ? JSON.stringify(c.value) : c.value;
        lines.push(
          `  ${c.property} = ${val}  (${c.epistemic_class}, ${c.freshness}, ` +
            `conf ${Math.round((c.confidence ?? 0) * 100)}%)`
        );
      });
    }
    if (ctx.timeline?.length) {
      lines.push(`\nTimeline:`);
      ctx.timeline.slice(0, 8).forEach(t => {
        const when = t.when ? new Date(t.when).toLocaleDateString() : "";
        const detail = t.summary ? `: ${t.summary}` : t.count ? ` ×${t.count}` : "";
        lines.push(`  ${when} — ${t.type}${detail}`);
      });
    }
    if (ctx.stakeholders?.length) {
      lines.push(`\nStakeholders:`);
      ctx.stakeholders.forEach(s =>
        lines.push(`  ${s.name || s.entity_id}${s.role ? ` — ${s.role}` : ""}`)
      );
    }
    lines.push(`\n~${ctx.meta?.token_estimate ?? "?"} tokens`);
    console.log(lines.join("\n"));
  });

// ---------------------------------------------------------------------------
// nous account <focus> — the full record: every claim + its epistemics
// ---------------------------------------------------------------------------
program
  .command("account <focus>")
  .description("The full account record — every claim with its epistemics + timeline")
  .option("--json", "Print the raw JSON response")
  .action(async (focus, { json }) => {
    const api = apiClient();
    const rec = await api.get(`/v2/accounts/${encodeURIComponent(focus)}`);
    if (handleAmbiguous(rec)) return;
    if (json) {
      console.log(JSON.stringify(rec, null, 2));
      return;
    }
    const lines = [`${rec.type} ${rec.entity_id}`];
    const claims = Object.entries(rec.claims ?? {});
    if (claims.length) {
      lines.push(`\nClaims:`);
      claims.forEach(([prop, c]) => {
        const val = typeof c.value === "object" ? JSON.stringify(c.value) : c.value;
        lines.push(
          `  ${prop} = ${val}  (${c.epistemic_class}, ${c.freshness}, ` +
            `conf ${Math.round((c.confidence ?? 0) * 100)}%)`
        );
      });
    }
    const obs = rec.recent_observations ?? [];
    if (obs.length) {
      lines.push(`\nRecent observations:`);
      obs.slice(0, 10).forEach(o => {
        const when = o.observed_at ? new Date(o.observed_at).toLocaleDateString() : "";
        lines.push(`  ${when} — [${o.kind}] ${o.property}  (${o.source})`);
      });
    }
    console.log(lines.join("\n"));
  });

// ---------------------------------------------------------------------------
// nous record <focus> — observe what happened; Nous derives the facts
// ---------------------------------------------------------------------------
program
  .command("record <focus>")
  .description("Record an observation. You observe — Nous derives the claims.")
  .requiredOption("--kind <kind>", "event | state")
  .requiredOption("--property <property>", "e.g. interaction.email_sent or job_title")
  .option("--value <value>", "The event detail or fact value (JSON or string)")
  .option("--source <source>", "Where this came from", "cli")
  .option("--method <method>", "How it was observed")
  .option("--observed-at <iso>", "When it was observed (ISO 8601)")
  .action(async (focus, opts) => {
    const api = apiClient();
    const observation = {
      kind: opts.kind,
      property: opts.property,
      value: parseValue(opts.value),
      source: opts.source,
      method: opts.method,
      observed_at: opts.observedAt,
    };
    const result = await api.post("/v2/observations", { focus, observations: [observation] });
    if (handleAmbiguous(result)) return;
    const recomputed = result.claims_recomputed ?? [];
    console.log(
      `✓ Recorded ${result.recorded} observation(s) for ${result.entity_id}` +
        (recomputed.length ? `\n  Claims recomputed: ${recomputed.join(", ")}` : "")
    );
  });

// ---------------------------------------------------------------------------
// nous query — retrieve and summarise a corpus of activity across many people
// ---------------------------------------------------------------------------
program
  .command("query")
  .description("Retrieve and summarise activity across many people")
  .option("--kind <kind>", "event | state")
  .option("--property <prefix>", "Property prefix — e.g. interaction.linkedin")
  .option("--source <source>", "Filter by source")
  .option("--entity <id>", "Restrict to one entity")
  .option("--since <days>", "Look back this many days")
  .option("--limit <n>", "Max results", "20")
  .option("--question <text>", "A question — switches to semantic retrieval")
  .option("--json", "Print the raw JSON response")
  .action(async opts => {
    const api = apiClient();
    const scope = {
      kind: opts.kind,
      property: opts.property,
      source: opts.source,
      entity_id: opts.entity,
      since_days: opts.since ? Number(opts.since) : undefined,
      limit: opts.limit ? Number(opts.limit) : undefined,
    };
    const data = await api.post("/v2/query", { scope, question: opts.question });
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    const items = data.items ?? [];
    if (!items.length) {
      console.log("No matching activity.");
      return;
    }
    items.forEach(it => {
      const when = it.when ? new Date(it.when).toLocaleDateString() : "";
      const who = it.entity_name || it.entity_id;
      const sim = it.similarity != null ? `  ${Math.round(it.similarity * 100)}%` : "";
      console.log(`  ${when} — ${who} — ${it.type}${sim}${it.summary ? `: ${it.summary}` : ""}`);
    });
    console.log(
      `\n${data.returned} of ${data.matched} (${data.mode})` +
        (data.sampled ? " — sampled" : "")
    );
  });

// ---------------------------------------------------------------------------
// nous attention — what needs attention across the workspace
// ---------------------------------------------------------------------------
program
  .command("attention")
  .description("Accounts gone quiet, facts decayed — ranked, with suggested actions")
  .option("--limit <n>", "Max results", "20")
  .option("--json", "Print the raw JSON response")
  .action(async ({ limit, json }) => {
    const api = apiClient();
    const data = await api.get("/v2/attention", { limit });
    if (json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    const items = data.items ?? [];
    if (!items.length) {
      console.log("Nothing needs attention. ✓");
      return;
    }
    items.forEach(it => {
      const who = it.entity_name || it.entity_id;
      console.log(`  [${it.kind}] ${who} — ${it.what} (${it.age_days}d)`);
      console.log(`     → ${it.suggested_action}`);
    });
  });

// ---------------------------------------------------------------------------
// nous verify <focus> <property> — re-check a claim before acting on it
// ---------------------------------------------------------------------------
program
  .command("verify <focus> <property>")
  .description("Re-check a claim before acting on it — the calibration check")
  .action(async (focus, property) => {
    const api = apiClient();
    const r = await api.post("/v2/verify", { focus, property });
    if (handleAmbiguous(r)) return;
    const fmt = c =>
      c
        ? `${typeof c.value === "object" ? JSON.stringify(c.value) : c.value} ` +
          `(${c.freshness}, conf ${Math.round((c.confidence ?? 0) * 100)}%)`
        : "—";
    console.log(`${r.property}`);
    console.log(`  before: ${fmt(r.before)}`);
    console.log(`  after:  ${fmt(r.after)}`);
    if (r.note) console.log(`  ${r.note}`);
  });

// ---------------------------------------------------------------------------
program.name("nous").version("0.2.0").parse();

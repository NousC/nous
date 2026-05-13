#!/usr/bin/env node

import { program, Command } from "commander";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_PATH = join(homedir(), ".proply", "config.json");

function readConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
}

function writeConfig(cfg) {
  const dir = join(homedir(), ".proply");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function apiClient() {
  const cfg = readConfig();
  const apiKey = process.env.PROPLY_API_KEY || cfg.apiKey;
  const apiUrl = process.env.PROPLY_API_URL || cfg.apiUrl || "https://api.goproply.com";

  if (!apiKey) {
    console.error("No API key found. Run: proply auth login");
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
    del: (path) => request("DELETE", path),
  };
}

// ---------------------------------------------------------------------------
// proply auth login
// ---------------------------------------------------------------------------
program
  .command("auth")
  .description("Manage authentication")
  .addCommand(
    new Command("login")
      .description("Save your API key")
      .requiredOption("--key <key>", "Your Proply API key")
      .option("--url <url>", "API base URL (default: https://api.goproply.com)")
      .action(({ key, url }) => {
        const cfg = readConfig();
        cfg.apiKey = key;
        if (url) cfg.apiUrl = url;
        writeConfig(cfg);
        console.log("✓ Authenticated. Run `proply contact list` to verify.");
      })
  )
  .addCommand(
    new Command("status")
      .description("Show current auth status")
      .action(() => {
        const cfg = readConfig();
        const key = process.env.PROPLY_API_KEY || cfg.apiKey;
        const url = process.env.PROPLY_API_URL || cfg.apiUrl || "https://api.goproply.com";
        if (key) {
          console.log(`Logged in\nAPI URL: ${url}\nKey: ${key.slice(0, 8)}...`);
        } else {
          console.log("Not logged in. Run: proply auth login --key <your-key>");
        }
      })
  );

// ---------------------------------------------------------------------------
// proply contact
// ---------------------------------------------------------------------------
const contact = program.command("contact").description("Manage contacts");

contact
  .command("get <email-or-id>")
  .description("Get a contact profile")
  .action(async (identifier) => {
    const api = apiClient();
    const c = await api.get(`/v1/contact/${encodeURIComponent(identifier)}`);
    const lines = [
      `${c.name || c.email}${c.title ? ` · ${c.title}` : ""}${c.company ? ` @ ${c.company}` : ""}`,
      `Stage: ${c.pipeline_stage || "identified"}${c.icp_score != null ? `  ICP: ${c.icp_score}` : ""}`,
    ];
    if (c.summary) lines.push(`\nSummary: ${c.summary}`);
    const facts = c.facts ?? [];
    if (facts.length) {
      lines.push(`\nFacts:`);
      facts.forEach(f => lines.push(`  [${f.category}] ${f.content}`));
    }
    const acts = c.recent_activities ?? [];
    if (acts.length) {
      lines.push(`\nRecent activity:`);
      acts.slice(0, 5).forEach(a => {
        const date = a.occurred_at ? new Date(a.occurred_at).toLocaleDateString() : "";
        lines.push(`  ${date} — ${a.type}${a.description ? `: ${a.description.slice(0, 80)}` : ""}`);
      });
    }
    lines.push(`\nID: ${c.contact_id || c.id}`);
    console.log(lines.join("\n"));
  });

contact
  .command("list")
  .description("List contacts")
  .option("--stage <stage>", "Filter by stage (identified|aware|interested|evaluating|client)")
  .option("--limit <n>", "Max results", "20")
  .action(async ({ stage, limit }) => {
    const api = apiClient();
    const data = await api.get("/v1/contacts", { stage, limit });
    const contacts = data.contacts ?? [];
    if (!contacts.length) { console.log("No contacts found."); return; }
    contacts.forEach(c => {
      const name = c.name || c.email;
      const co = c.company ? ` @ ${c.company}` : "";
      console.log(`${name}${co}  [${c.pipeline_stage || "identified"}]  ${c.id}`);
    });
    console.log(`\n${contacts.length} of ${data.total ?? contacts.length} contacts`);
  });

contact
  .command("create")
  .description("Create a new contact")
  .requiredOption("--email <email>", "Email address")
  .option("--name <name>", "Full name")
  .option("--company <company>", "Company name")
  .option("--title <title>", "Job title")
  .option("--linkedin <url>", "LinkedIn URL")
  .action(async ({ email, name, company, title, linkedin }) => {
    const api = apiClient();
    const [first_name, ...rest] = (name || "").split(" ");
    const result = await api.post("/v1/contacts", {
      email,
      first_name: first_name || undefined,
      last_name: rest.join(" ") || undefined,
      company,
      job_title: title,
      linkedin_url: linkedin,
    });
    console.log(`✓ Created: ${result.name || result.email} (${result.id})`);
  });

// ---------------------------------------------------------------------------
// proply memory
// ---------------------------------------------------------------------------
const memory = program.command("memory").description("Manage workspace memory");

memory
  .command("list")
  .description("List all workspace memories")
  .option("--category <cat>", "Filter by category")
  .action(async ({ category }) => {
    const api = apiClient();
    const data = await api.get("/v1/memories", { category });
    const memories = data.memories ?? [];
    if (!memories.length) { console.log("No memories stored yet."); return; }
    const byCategory = {};
    for (const m of memories) {
      (byCategory[m.category] ??= []).push(m);
    }
    for (const [cat, facts] of Object.entries(byCategory)) {
      console.log(`\n[${cat}]`);
      facts.forEach(f => console.log(`  • ${f.content}  (${f.id})`));
    }
  });

memory
  .command("save <fact>")
  .description("Save a workspace-level fact")
  .option("--category <cat>", "Category", "General")
  .action(async (fact, { category }) => {
    const api = apiClient();
    const result = await api.post("/v1/remember", { text: fact, category, source: "cli" });
    console.log(`✓ Saved ${result.stored ?? 1} fact(s) [${category}]`);
  });

memory
  .command("search <query>")
  .description("Semantic search across workspace memories")
  .option("--limit <n>", "Max results", "10")
  .action(async (q, { limit }) => {
    const api = apiClient();
    const data = await api.post("/v1/search", { q, limit: Number(limit) });
    const results = data.results ?? [];
    if (!results.length) { console.log(`No results for "${q}".`); return; }
    results.forEach(r => {
      const score = `${(r.similarity * 100).toFixed(0)}%`;
      console.log(`  [${r.category}] ${score}  ${r.content}`);
    });
  });

memory
  .command("delete <id>")
  .description("Delete a workspace memory by ID")
  .action(async (id) => {
    const api = apiClient();
    const result = await api.del(`/v1/memory/${encodeURIComponent(id)}`);
    console.log(`✓ Deleted: "${result.content}"`);
  });

// ---------------------------------------------------------------------------
program.name("proply").version("0.1.0").parse();

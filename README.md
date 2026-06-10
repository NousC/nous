<div align="center">
  <img src=".github/assets/logo.svg" alt="Nous" height="80" />
</div>

<div align="center">

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![npm](https://img.shields.io/npm/v/@opennous/mcp)](https://www.npmjs.com/package/@opennous/mcp)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/2Ph4ZYXw)

</div>

<div align="center">
  <strong>Customer graph for GTM agents.</strong><br/>
  Every person, conversation, and touchpoint across your GTM tool stack, in one place.<br/>
  Everything happening inside your GTM, visible to your agents.
</div>

<br/>

<div align="center">
  <a href="https://docs.opennous.cloud">Docs</a> ·
  <a href="https://docs.opennous.cloud/public-api/introduction">Public API</a> ·
  <a href="https://docs.opennous.cloud/mcp/introduction">MCP Server</a> ·
  <a href="https://discord.gg/2Ph4ZYXw">Discord</a>
</div>

---

## What Nous does

Your GTM stack is fragmented. Apollo for prospecting, HubSpot for CRM, Smartlead for sequences, Gmail for email, LinkedIn for social. Each tool holds part of the picture, and none of them are queryable by an agent.

Nous resolves the fragmentation into one customer graph your agents can query.

- **Identity resolution.** Every contact across every tool, merged into one clean record. No duplicates, no gaps.
- **Complete timeline.** Every email, call, LinkedIn message, and CRM event in one place. Know exactly where a prospect stands before you act.
- **Live sync.** Outbound tools, communication tools, and CRM stay in sync.
- **Agent-ready.** Your agents query the full account in a single MCP call. No data wrangling.
- **Revenue attribution.** Tie campaigns, channels, and actions directly to pipeline and closed deals.

## Features

| Feature | What it does |
|---|---|
| **Account record** | Full context and activity history per person across every channel |
| **MCP connector** | One call returns the complete account record to any MCP-compatible agent |
| **ICP scoring** | Scores contacts against your ICP as new signals arrive |
| **Inbound enrichment** | Cleans and enriches inbound leads before they hit your CRM |
| **Pattern analysis** | Reports on wins, losses, and the campaigns actually driving pipeline |
| **CRM sync** | Enriches Salesforce, HubSpot, and Pipedrive while keeping them in sync |

---

## Tech stack

| Layer | Stack |
|---|---|
| API | Node.js (ESM), Express |
| Frontend | Vite, React, shadcn/ui |
| Database | Supabase (PostgreSQL + pgvector) |
| MCP | `@modelcontextprotocol/sdk` |
| AI | Anthropic Claude |
| Package manager | pnpm workspaces |

---

## Self-host

Run the whole stack — API, worker, MCP server, frontend, Redis, and Caddy (automatic HTTPS) — with Docker Compose. You bring an external [Supabase](https://supabase.com) project (Postgres + auth) and an Anthropic API key; everything else runs in containers.

**Prerequisites**

- A Linux server with Docker + Docker Compose
- A [Supabase](https://supabase.com) project (free tier is fine)
- An [Anthropic API key](https://console.anthropic.com)
- Three DNS records — `app`, `api`, `mcp` — pointing at your server

```bash
# 1. Clone
git clone https://github.com/NousC/nous.git
cd nous

# 2. Configure
cp nous.env.example nous.env
#    Fill in: APP_DOMAIN / API_DOMAIN / MCP_DOMAIN, your Supabase URL + keys,
#    and ANTHROPIC_API_KEY. Generate the encryption key:
openssl rand -hex 32      # paste the output into ENCRYPTION_KEY=
#    SELF_HOSTED=true is already set — it unlocks every feature, unmetered.

# 3. Create the database
#    Open supabase/schema.sql in your Supabase SQL editor and run it once.

# 4. Launch (Caddy provisions TLS automatically once your DNS resolves)
docker compose --env-file nous.env up -d --build
```

Open `https://app.yourdomain.com` and create the first account — it becomes the **owner**. You'll land on the **Connect** screen — from here you point your agent at this instance and let it onboard the workspace (see [Connect your agent](#connect-your-agent--and-let-it-onboard-you) below; on self-host, sign in with `npx @opennous/cli login --url https://api.yourdomain.com`). To close public registration afterward, set `DISABLE_SIGNUPS=true` in `nous.env` (and turn off signups in Supabase → Authentication), then re-run `./update.sh`. Invite teammates from **Settings → Team**.

**Updating**

```bash
./update.sh      # pulls latest, rebuilds the containers, flags any new DB migrations
```

CRM Sync and Lead Lists are the only features reserved for [Nous Cloud](https://opennous.cloud) — everything else (the customer graph, MCP server, ICP scoring, enrichment, integrations) is fully open on self-host.

## Local development

For contributing to Nous — runs the apps directly against your Supabase project, no Docker:

```bash
git clone https://github.com/NousC/nous.git
cd nous
cp .env.example .env   # fill in Supabase + Anthropic keys
pnpm install
pnpm dev
```

→ [Full docs](https://docs.opennous.cloud)

---

## Connect your agent — and let it onboard you

Nous is operated by your **agent**, not by clicking through the app. When you sign in you land on a **Connect** screen that stays up until your agent has set the workspace up. Three steps:

**1. Add Nous to your agent**

- **Claude Code** — `/plugin marketplace add NousC/nous` then `/plugin install nous@nous-plugins`
- **Codex** — add to `~/.codex/config.toml`:
  ```toml
  [mcp_servers.nous]
  command = "npx"
  args = ["-y", "@opennous/mcp"]
  ```
- **Cursor / any MCP host** — add to `mcp.json`:
  ```json
  { "mcpServers": { "nous": { "command": "npx", "args": ["-y", "@opennous/mcp"] } } }
  ```

**2. Sign in** — run this once. It opens your browser, mints a workspace key, and saves it (plus your API URL) to `~/.nous/config.json`, which the MCP reads automatically — no key to paste:

```bash
npx @opennous/cli login --url https://api.yourdomain.com   # self-host: your API domain
# On Nous Cloud, drop --url (it defaults to https://api.opennous.cloud)
```

**3. Onboard** — tell your agent:

> Set me up — onboard my workspace and build my playbook.

Your agent reads `get_workspace_status` and walks you through setup **in order**: profile → connect Gmail / LinkedIn / a meeting note-taker → enrichment → webhooks → import your CRM contacts (CSV, on the Accounts page) → build the ICP scoring model from your closed-won/lost deals. The Connect screen unlocks the moment the workspace is onboarded, and drops you on the live Ops log so you can watch what the agent did.

**Prefer to paste a key instead of signing in?** Create one at **Settings → API Keys** and set it directly (the in-app Install page generates this snippet for you):

```json
{
  "mcpServers": {
    "nous": {
      "command": "npx",
      "args": ["-y", "@opennous/mcp"],
      "env": {
        "NOUS_API_KEY": "your-api-key",
        "NOUS_API_URL": "https://api.yourdomain.com"
      }
    }
  }
}
```

`NOUS_API_URL` is your own API domain on self-host, or `https://api.opennous.cloud` on Nous Cloud.

→ [Full MCP docs](https://docs.opennous.cloud/mcp/introduction)

---

## Compliance

- We do not scrape LinkedIn or any third-party platform
- Signal ingestion uses only official OAuth flows and approved webhooks
- No customer data is sent to third parties without explicit configuration

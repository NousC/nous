<div align="center">
  <img src=".github/assets/logo-dark.png#gh-dark-mode-only" alt="Nous" height="60" />
  <img src=".github/assets/logo-light.png#gh-light-mode-only" alt="Nous" height="60" />
</div>

<div align="center">

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![npm](https://img.shields.io/npm/v/@opennous/sdk)](https://www.npmjs.com/package/@opennous/sdk)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/npa59RTgs)

</div>

<div align="center">
  <strong>GTM data infrastructure for agents.</strong><br/>
  Unify Apollo, Salesforce, Smartlead, Gmail, and LinkedIn into one identity-resolved record per human.<br/>
  Your agents query the full account context in a single MCP call.
</div>

<br/>

<div align="center">
  <a href="https://docs.opennous.cloud">Docs</a> ·
  <a href="https://docs.opennous.cloud/public-api/introduction">Public API</a> ·
  <a href="https://docs.opennous.cloud/mcp/introduction">MCP Server</a> ·
  <a href="https://www.npmjs.com/package/@opennous/sdk">Node.js SDK</a> ·
  <a href="https://pypi.org/project/nous/">Python SDK</a> ·
  <a href="https://discord.gg/npa59RTgs">Discord</a>
</div>

---

## What Nous does

Your GTM stack is fragmented — Apollo for prospecting, Salesforce for CRM, Smartlead for sequences, Gmail for email, LinkedIn for social. Each tool has part of the picture. None of them are queryable by an AI agent.

Nous fixes that:

- **Identity resolution** — Every contact across every tool merged into one clean record. No duplicates, no gaps.
- **Complete timeline** — Every email, call, LinkedIn message, and CRM event in one place. Know exactly where a prospect stands before you act.
- **Live sync** — Outbound tools, communication tools, and CRM stay perfectly in sync.
- **Agent-ready** — Agents query the full account context in a single MCP call. No data wrangling.
- **Revenue attribution** — Tie campaigns, channels, and actions directly to pipeline and closed deals.

## Features

| Feature | What it does |
|---|---|
| **Person graph** | Full context and activity history per contact across all channels |
| **MCP connector** | One call returns complete account context to any MCP-compatible agent |
| **ICP scoring** | Automatically scores contacts against your ICP as signals arrive |
| **Inbound enrichment** | Cleans and enriches inbound leads before they hit your CRM |
| **Pattern analysis** | Reports on wins, losses, and what campaigns are actually driving pipeline |
| **CRM sync** | Stays fully in sync with Salesforce, HubSpot, Pipedrive — enriches them, doesn't replace them |

---

## Tech stack

- **API** — Node.js (ESM), Express
- **Frontend** — Vite, React, shadcn/ui
- **Database** — Supabase (PostgreSQL + pgvector)
- **MCP** — `@modelcontextprotocol/sdk`
- **AI** — Anthropic Claude (memory synthesis, ICP scoring)
- **Package manager** — pnpm workspaces

---

## Quick start

→ [Full setup guide](https://docs.opennous.cloud/getting-started/quickstart)

```bash
git clone https://github.com/bennetglinder1/nous.git
cd nous
cp .env.example .env   # fill in Supabase + Anthropic keys
pnpm install
pnpm dev
```

For production: [docs.opennous.cloud/installation/docker](https://docs.opennous.cloud/installation/docker)

---

## MCP setup (30 seconds)

Add to your `mcp.json` (Claude Desktop, Cursor, or any MCP host):

```json
{
  "mcpServers": {
    "nous": {
      "command": "npx",
      "args": ["-y", "@opennous/mcp"],
      "env": {
        "NOUS_API_KEY": "your-api-key",
        "NOUS_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

→ [Full MCP docs](https://docs.opennous.cloud/mcp/introduction)

---

## Compliance

- We do not scrape LinkedIn or any third-party platform
- Signal ingestion uses only official OAuth flows and approved webhooks
- No customer data is sent to third parties without explicit configuration

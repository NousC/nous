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

## Quick start

→ [Full setup guide](https://docs.opennous.cloud/getting-started/quickstart)

```bash
git clone https://github.com/NousC/nous.git
cd nous
cp .env.example .env   # fill in Supabase + Anthropic keys
pnpm install
pnpm dev
```

For production, see [docs.opennous.cloud/installation/docker](https://docs.opennous.cloud/installation/docker).

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

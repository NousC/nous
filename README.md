<div align="center">
  <img src=".github/assets/logo-dark.png#gh-dark-mode-only" alt="Proply CRM" height="60" />
  <img src=".github/assets/logo-light.png#gh-light-mode-only" alt="Proply CRM" height="60" />
</div>

<div align="center">

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![npm](https://img.shields.io/npm/v/@goproply/sdk)](https://www.npmjs.com/package/@goproply/sdk)
[![Discord](https://img.shields.io/discord/YOUR_DISCORD_ID?label=Discord&logo=discord)](https://discord.gg/YOUR_INVITE)

</div>

<div align="center">
  <strong>The CRM built for AI agents, not humans.</strong><br/>
  Give your GTM agents structured memory of every contact, company, and relationship signal.
</div>

<br/>

<div align="center">
  <a href="https://docs.goproply.com">Docs</a> ·
  <a href="https://docs.goproply.com/api">Public API</a> ·
  <a href="https://docs.goproply.com/mcp">MCP Server</a> ·
  <a href="https://www.npmjs.com/package/@goproply/sdk">Node.js SDK</a> ·
  <a href="https://pypi.org/project/proply/">Python SDK</a> ·
  <a href="https://discord.gg/YOUR_INVITE">Discord</a>
</div>

<br/>

<!-- VIDEO: replace href with your YouTube feature walkthrough -->
<div align="center">
  <a href="https://www.youtube.com/watch?v=YOUR_VIDEO_ID">
    <img src=".github/assets/video-thumbnail.png" alt="Watch the intro" width="600" />
  </a>
</div>

---

## ✨ Features

- **MCP Server** — 10 tools for reading contact context, saving facts, and searching memory. Drop it into any Claude, Cursor, or custom agent.
- **Contact & Company Memory** — Three-scoped memory: person-level (private), company-level (shared across stakeholders), workspace-level (ICP, win patterns, positioning).
- **Signal Ingestion** — LinkedIn messages, Gmail, Google Calendar, and public signals (job postings, funding) all flow into a unified activity timeline.
- **Stakeholder Graph** — Map buying committees. Know who influences whom before your agent writes the email.
- **REST API + SDKs** — Full HTTP API with TypeScript and Python SDKs. Integrate from any agent framework.
- **Self-hostable** — One `docker compose up` and it's running on your own infra.

---

## Tech stack

- **API** — Node.js (ESM), Express
- **Frontend** — Vite, React, shadcn/ui
- **Database** — Supabase (PostgreSQL)
- **MCP** — `@modelcontextprotocol/sdk`
- **AI** — Anthropic Claude (memory synthesis, identity resolution)
- **Package manager** — pnpm workspaces

---

## Quick start

→ [Self-hosted setup guide](https://docs.goproply.com/quickstart)

```bash
# 1. Clone and install
git clone https://github.com/goproply/proply-crm.git
cd proply-crm
cp .env.example .env   # fill in your Supabase + Anthropic keys
pnpm install

# 2. Start everything
pnpm dev
```

For production Docker deploy: [docs.goproply.com/installation/docker](https://docs.goproply.com/installation/docker)

---

## MCP setup (30 seconds)

Add to your Claude Desktop / Cursor `mcp.json`:

```json
{
  "mcpServers": {
    "proply": {
      "command": "npx",
      "args": ["-y", "@goproply/mcp"],
      "env": {
        "PROPLY_API_KEY": "your-api-key",
        "PROPLY_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

→ [Full MCP docs](https://docs.goproply.com/mcp)

---

## Sponsors

Support Proply's open-source development:

| Sponsor | Description |
|---------|-------------|
| [Your logo here](https://goproply.com/sponsor) | [Become a sponsor](https://opencollective.com/proply) |

→ [opencollective.com/proply](https://opencollective.com/proply)

---

## Compliance

- We do not scrape LinkedIn or any third-party platform
- Signal ingestion uses only official OAuth flows and approved webhooks
- No customer data is sent to third parties without explicit configuration
- API keys are never logged or stored in plaintext
- All data is stored in your own Supabase instance when self-hosting

---

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=goproply/proply-crm&type=Date)](https://star-history.com/#goproply/proply-crm&Date)

---

## License

[AGPL-3.0](LICENSE) — free to self-host and modify. If you run a modified version as a network service, you must open-source your changes.

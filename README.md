<div align="center">
  <img src=".github/assets/logo.svg" alt="Nous" height="80" />
</div>

<div align="center">

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![npm](https://img.shields.io/npm/v/@opennous/mcp)](https://www.npmjs.com/package/@opennous/mcp)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/2Ph4ZYXw)

</div>

<div align="center">
  <a href="https://docs.opennous.cloud">Docs</a> ·
  <a href="https://docs.opennous.cloud/public-api/introduction">Public API</a> ·
  <a href="https://docs.opennous.cloud/mcp/introduction">MCP Server</a> ·
  <a href="https://discord.gg/2Ph4ZYXw">Discord</a>
</div>

# Nous

**The GTM Context API for agents.** Unify your go-to-market tools into one customer graph and give any agent the whole account in a single call, every person, conversation, and signal, in one record. Open source, and available as a [hosted service](https://opennous.cloud).

_Pst — join our stargazers :)_

---

## Why Nous?

- **One call, the whole account.** Your agent gets the entire identity-resolved account in a single call, instead of stitching six tools together and guessing over raw dumps.
- **LLM-ready context.** Structured, token-budgeted, agent-shaped. Every fact carries its own source, confidence, and freshness.
- **We handle the hard stuff.** Identity resolution across Apollo, HubSpot, Gmail, and LinkedIn into one canonical record per person.
- **Agent ready.** Connect Nous to any agent or MCP client with a single command.
- **25+ integrations.** Your CRM, outbound, email, and LinkedIn, unified into one graph.
- **Open source.** Self-host the whole primitive under AGPL, or skip the setup with Nous Cloud.

## Core endpoints

| Endpoint | What it returns |
|---|---|
| `get_context(domain)` | the right context for a task, token-budgeted for the prompt |
| `get_account(domain)` | the whole account: every contact, touch, and signal |
| `query("...")` | ask the graph in natural language |

## Quick start

Connect Nous to your agent over MCP:

```bash
claude mcp add nous -- npx -y @opennous/mcp
```

Your agent now has `get_context`, `get_account`, and `query`. Ask it for an account and it pulls the whole thing in one call.

### `get_context`

The right context for a task, token-budgeted and agent-shaped. Every fact carries its own confidence and freshness:

```bash
get_context(domain="acme.com", intent="account_review")
```

```json
{
  "entity": { "id": "ent_acme", "type": "account" },
  "summary": "Acme Corp, ~500 employees. Sarah Chen (VP RevOps) promoted 3 months ago. 12 SDR roles posted in the last 7 days. Open deal, $45k, economic buyer not yet identified.",
  "claims": [
    { "property": "company.headcount", "value": 500, "confidence": 0.9, "freshness": "30d", "last_observed_at": "2026-05-30" },
    { "property": "signal.hiring", "value": "12 SDR roles in 7 days", "confidence": 0.95, "freshness": "7d", "last_observed_at": "2026-06-10" }
  ],
  "stakeholders": [
    { "name": "Sarah Chen", "role": "VP RevOps" }
  ],
  "timeline": [
    { "when": "2026-06-05", "type": "call", "summary": "competitor name-dropped" }
  ],
  "predictions": [ { "kind": "icp_fit", "value": "high", "confidence": 0.82 } ],
  "meta": { "token_estimate": 1200, "claims_total": 47, "claims_returned": 12 }
}
```

### `get_account`

The whole account, every contact and signal, in one object.

```bash
get_account(domain="acme.com")
```

### `query`

Ask the graph in natural language.

```bash
query("which accounts went quiet after a positive reply?")
```

Returns the matching accounts, resolved.

## Power your agent

Nous is operated by your **agent**, not by clicking through an app. Add it to your stack in one step:

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

Then sign in once — it opens your browser, mints a workspace key, and saves it to `~/.nous/config.json` (the MCP reads it automatically, no key to paste):

```bash
npx @opennous/cli login    # on self-host, add --url https://api.yourdomain.com
```

Now tell your agent **“Set me up — onboard my workspace and build my playbook,”** and it walks setup in order: profile → connect Gmail / LinkedIn / a note-taker → enrichment → import your CRM contacts.

→ [Full MCP docs](https://docs.opennous.cloud/mcp/introduction)

## Open source vs Cloud

Nous is open source under AGPL-3.0. Self-host runs the open primitive in full, unmetered. **Nous Cloud** adds the team layer on top of the same graph — the part go-to-market teams need, hosted and managed.

<div align="center">
  <img src=".github/assets/open-source-vs-cloud.svg" alt="Nous Open Source vs Cloud" width="760" />
</div>

## Self-host

Run the whole stack — API, worker, MCP server, frontend, Redis, and Caddy (automatic HTTPS) — with Docker Compose, on your own infrastructure. You bring a [Supabase](https://supabase.com) project and an Anthropic API key.

→ **[Follow the self-host guide](https://docs.opennous.cloud/installation/docker-compose)** for the full walkthrough.

## Tech stack

| Layer | Stack |
|---|---|
| API | Node.js (ESM), Express |
| Frontend | Vite, React, shadcn/ui |
| Database | Supabase (PostgreSQL + pgvector) |
| MCP | `@modelcontextprotocol/sdk` |
| AI | Anthropic Claude |
| Package manager | pnpm workspaces |

## Contributing

We love contributions. See the [Contributing Guide](CONTRIBUTING.md) before opening a PR.

## License

Nous is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). You are free to use, modify, and self-host it. If you run a modified version as a network service, the AGPL requires you to make your source available to that service's users. Nous Cloud runs this same open core, hosted and managed, with the team layer (CRM sync, lead lists, the ICP model) added on top. See the [LICENSE](LICENSE) file for the full text.

## Compliance

- We do not scrape LinkedIn or any third-party platform.
- Signal ingestion uses only official OAuth flows and approved webhooks.
- No customer data is sent to third parties without explicit configuration.

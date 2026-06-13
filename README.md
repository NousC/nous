<div align="center">
  <img src=".github/assets/logo.svg" alt="Nous" height="80" />
</div>

<div align="center">

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![npm](https://img.shields.io/npm/v/@opennous/mcp)](https://www.npmjs.com/package/@opennous/mcp)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/2Ph4ZYXw)

</div>

<div align="center">
  <h3>The GTM Context API for agents.</h3>
  Unify your go-to-market tools into one customer graph and give any agent the whole<br/>
  account in a single call — every person, conversation, and signal, resolved and verified.<br/>
  Open source, and available as a hosted service.
</div>

<br/>

<div align="center">
  <a href="https://docs.opennous.cloud">Docs</a> ·
  <a href="https://docs.opennous.cloud/public-api/introduction">Public API</a> ·
  <a href="https://docs.opennous.cloud/mcp/introduction">MCP Server</a> ·
  <a href="https://discord.gg/2Ph4ZYXw">Discord</a>
</div>

<div align="center"><sub>Pst — join our stargazers :)</sub></div>

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

| Also | |
|---|---|
| `verify(fact)` | source, confidence, and freshness on any fact |
| `record(event)` | write an outcome back, and the graph self-heals |

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

Returns the matching accounts, resolved and verified.

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

Nous is open source under AGPL-3.0. Self-host runs the open primitive in full, unmetered: the customer graph, identity resolution, `get_context` / `get_account` / `query`, `verify`, `record`, the MCP server, enrichment, and all 25+ integrations.

**Nous Cloud** adds the team layer on top of the same graph — the part go-to-market teams need, and the part you don't want to run yourself.

| Open source (self-host) | Nous Cloud |
|---|---|
| `get_context` · `get_account` · `query` | everything in open source, plus: |
| Identity resolution · the customer graph | CRM two-way sync |
| `verify` · `record` · MCP server | Lead Lists |
| 25+ integrations · enrichment (BYO keys) | The ICP model (learns from won/loss) |

## Self-host

Run the whole stack — API, worker, MCP server, frontend, Redis, and Caddy (automatic HTTPS) — with Docker Compose. You bring a [Supabase](https://supabase.com) project (Postgres + auth) and an Anthropic API key.

```bash
git clone https://github.com/NousC/nous.git
cd nous
cp nous.env.example nous.env
#   Fill in APP/API/MCP domains, Supabase keys, ANTHROPIC_API_KEY.
#   SELF_HOSTED=true is already set — it runs the open primitive, unmetered.
openssl rand -hex 32        # paste into ENCRYPTION_KEY=
#   Run supabase/schema.sql in your Supabase SQL editor once.
docker compose --env-file nous.env up -d --build
```

Open `https://app.yourdomain.com`, create the first account (it becomes the owner), and point your agent at it. To close signups afterward, set `DISABLE_SIGNUPS=true` and re-run `./update.sh`.

For local development against your Supabase project without Docker:

```bash
git clone https://github.com/NousC/nous.git && cd nous
cp .env.example .env        # Supabase + Anthropic keys
pnpm install && pnpm dev
```

→ [Full self-host guide](https://docs.opennous.cloud)

## Tech stack

Node.js (ESM) + Express · Vite + React · Supabase (Postgres + pgvector) · `@modelcontextprotocol/sdk` · Anthropic Claude · pnpm workspaces.

## Contributing

We love contributions. See the [Contributing Guide](CONTRIBUTING.md) before opening a PR.

## License

AGPL-3.0. Self-host free forever, or skip the setup with [Nous Cloud](https://opennous.cloud).

## Compliance

- We do not scrape LinkedIn or any third-party platform.
- Signal ingestion uses only official OAuth flows and approved webhooks.
- No customer data is sent to third parties without explicit configuration.

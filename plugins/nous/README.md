# Nous plugin for Claude Code

Give Claude one MCP call to the full identity-resolved GTM account record — every tool unified, every claim with its epistemics.

## Install

```bash
# In Claude Code:
/plugin marketplace add bennetglinder1/nous
/plugin install nous@nous-plugins
```

You'll be prompted for your **Nous API key** at install (get one at <https://opennous.cloud> → Settings → API Keys). The key is stored in your OS keychain — never in plaintext.

## What it exposes

Six MCP tools, all backed by the v2 Context API:

| Tool | What it does |
|---|---|
| `get_context` | Engineered context for a task about one person/company — retrieve → rank → connect → compress → tag → budget |
| `get_account` | Full Account Record — entity + claims with epistemics + observation timeline |
| `record` | Record events or state observations. The agent observes; Nous derives the claim |
| `query` | Retrieve + summarise a corpus of observations across many entities |
| `attention` | Workspace-wide: accounts gone quiet, facts decayed — ranked decisions |
| `verify` | Re-check one claim before acting — the calibration check |

Identifiers are universal — pass an email, domain, LinkedIn URL, entity UUID, or a name; ambiguous names return candidates the agent picks from.

## Configuration

| Field | Default | When to override |
|---|---|---|
| `api_key` | (prompted) | Required. Workspace-scoped — no separate workspace ID needed |
| `api_url` | `https://api.opennous.cloud` | Only if you self-host Nous on your own infra |

## Self-host

The whole stack is open source — `git clone https://github.com/bennetglinder1/nous`, `docker compose up`. Then point `api_url` at your instance. AGPL-3.0.

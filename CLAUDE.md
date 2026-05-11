# Proply CRM — AI Agent Guide

This file helps AI coding assistants understand the architecture before making changes.

## What this project is

Proply CRM is the memory layer for GTM AI agents. It stores structured facts about contacts and companies, ingests signals from email/LinkedIn/calendar, and exposes that context via an MCP server and REST API so agents always have full relationship context.

## Monorepo structure

```
apps/
  api/       — Node.js/Express REST API (v1 endpoints — the public surface)
  mcp/       — MCP server (@goproply/mcp, 10 core tools)
  frontend/  — Vite + React + shadcn/ui (Contacts, People, Companies, Memories pages)
  worker/    — Background workers (CalendarPoller, signal ingestion, webhooks)
packages/
  core/      — Shared DB logic, Supabase client, memory types, contact schema
  sdk/       — TypeScript SDK (@goproply/sdk, published to npm)
sdk-python/  — Python SDK (published to PyPI)
```

## Layer rules

- `packages/core` is the single source of truth for DB queries and memory types. All apps import from here — never duplicate DB logic in an app.
- `apps/api` and `apps/mcp` are thin shells: they handle transport (HTTP / MCP protocol) and delegate all business logic to `packages/core`.
- `apps/worker` imports from `packages/core` for DB writes but owns its own polling/scheduling logic.
- `apps/frontend` never calls the DB directly — only calls `apps/api` endpoints.

## Key concepts

**Memory types** (three scopes):
- `contact` — private facts about one person (communication style, pain points, authority level)
- `company` — org-level facts shared across all contacts at that company (budget cycles, procurement, deal history)
- `workspace` — facts with no specific entity (ICP definition, win patterns, positioning)

**Signal types** — everything flows into `contact_activity_log`:
- Private: email, LinkedIn messages, calendar meetings, calls
- Public: job postings, funding rounds, tech stack changes (via webhooks)

**Identity resolution** — when a signal arrives (webhook, calendar event), we resolve it to a contact via a 6-step waterfall: exact email match → email-prefix parse → name+company match → activity-signal tiebreaker. Logic lives in `packages/core/src/identity.ts`.

## Database

Supabase (PostgreSQL). Key tables:
- `contacts` — contact profiles
- `companies` — company profiles
- `workspace_memories` — all memory facts (scoped by contact_id, company_id, or workspace_id in metadata)
- `contact_activity_log` — all signals (email, LinkedIn, calendar, webhooks)
- `workspace_graph_edges` — stakeholder relationships (who → who, relationship type)

All DB access goes through `packages/core/src/db/`. Never write raw Supabase queries in app code.

## MCP tools (apps/mcp)

10 core tools — see `apps/mcp/src/index.js` for the canonical list:
- `get_contact`, `get_contact_activity`, `search_contacts` — read contact data
- `save_contact_memory`, `save_company_memory`, `save_workspace_memory` — write memory
- `get_stakeholder_map` — buying committee for a company
- `search_workspace_memory`, `delete_workspace_memory` — workspace memory CRUD
- `create_contact` — add new contact

## REST API routes (apps/api)

All under `/v1/`:
- `POST /v1/remember` — store a memory fact
- `GET /v1/contact/:identifier` — full contact profile
- `GET /v1/contacts` — list/filter contacts
- `POST /v1/contacts` — create contact
- `DELETE /v1/contact/:identifier` — delete contact
- `GET /v1/company/:id` — company profile
- `GET /v1/memories` — list workspace memories
- `DELETE /v1/memory/:id` — soft-delete a memory
- `POST /v1/search` — semantic search
- `POST /v1/context/get` — full context for an agent call

## Code conventions

- ESM throughout (`"type": "module"` in all package.json files)
- No default exports — use named exports everywhere
- TypeScript in `packages/` and `apps/frontend`; plain `.mjs` is acceptable in `apps/api` and `apps/worker`
- Supabase service role key only in `apps/api` and `apps/worker` — never in frontend or MCP server
- All secrets via environment variables — no hardcoded keys anywhere

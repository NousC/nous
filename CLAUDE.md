# Nous — AI Agent Guide

This file helps AI coding assistants understand the architecture before making changes.

## What this project is

Nous is the customer graph for GTM agents. It resolves every person, conversation, and touchpoint across the GTM tool stack (Apollo, HubSpot, Smartlead, Gmail, LinkedIn) into one account record, ingests signals from email, LinkedIn, and calendar, and exposes that context via an MCP server and REST API so agents always have the full account in a single call.

## Monorepo structure

```
apps/
  api/       — Node.js/Express REST API (the /v2 Context API is the public surface)
  mcp/       — MCP server (@opennous/mcp, 10 tools — stdio bin + hosted HTTP variant)
  frontend/  — Vite + React + shadcn/ui (People, Companies, GTM Context, Lead Lists pages)
  worker/    — Background workers (CalendarPoller, signal ingestion, webhooks)
packages/
  core/      — Shared DB logic, Supabase client, the entity/claim/observation substrate
```

## Layer rules

- `packages/core` is the single source of truth for DB queries and substrate types. All apps import from here — never duplicate DB logic in an app.
- `apps/api` and `apps/mcp` are thin shells: they handle transport (HTTP / MCP protocol) and delegate all business logic to `packages/core`.
- `apps/worker` imports from `packages/core` for DB writes but owns its own polling/scheduling logic.
- `apps/frontend` never calls the DB directly — only calls `apps/api` endpoints.

## Key concepts

**The substrate** — everything reduces to three primitives. Agents never overwrite; they observe, and Nous derives:
- `entities` — canonical, durable anchors (a person or a company). The same person-entity survives a job change or a new email.
- `observations` — append-only log of what happened or was learned (an interaction, or a stated fact). The single write verb.
- `claims` — the current facts Nous *derives* from observations, each carrying a confidence and a freshness.

**Scopes** — a claim is attached to a contact entity, a company entity, or the workspace entity:
- contact — facts about one person (communication style, authority level)
- company — org-level facts shared across contacts at that company (budget cycles, deal history)
- workspace — the user's own GTM profile (ICP, market, pricing, positioning) — see the GTM Context page

**Signals** — email, LinkedIn messages, calendar meetings, calls, plus public signals (job postings, funding, tech-stack changes via webhooks) all land as observations against the resolved entity.

**Focus resolution** — an agent passes whatever it has. A hard identifier (entity UUID, email, LinkedIn URL, or domain) resolves to exactly one entity. A bare name is searched: zero hits → not found, one hit → resolved, several → the caller gets candidates to disambiguate (never auto-merge on name alone). Logic lives in `resolveFocus` in `packages/core/src/db/entities.ts`. Inbound signal matching adds a corroboration step that attaches a known contact's new email only when domain/company corroborates — see `apps/worker/src/utils/identityMatch.mjs`.

## Database

Supabase (PostgreSQL). Key tables (the v2 substrate):
- `entities` — canonical person/company anchors
- `entity_identifiers` — the emails, domains, LinkedIn URLs and external ids that resolve to an entity
- `observations` — append-only log of events and stated facts
- `claims` — the current derived facts per entity (with confidence + freshness)
- `predictions` — derived forecasts, including the latest `icp_fit` score per entity
- `relationships` — entity-to-entity edges (e.g. `works_at`, buying-group ties)
- `contacts` / `companies` — transitional v1 profile rows still read as an overlay on the v2 substrate

All DB access goes through `packages/core/src/db/`. Never write raw Supabase queries in app code.

## MCP tools (apps/mcp)

10 tools — registered in `apps/mcp/src/server.js` (the canonical `createServer()` factory; `index.js` is the stdio bin, `http.js` the hosted variant). The tools are thin clients of the `/v2` Context API. The agent observes; Nous derives — there is no "update" verb.

Read:
- `get_context` — engineered, intent-shaped context for a task (draft_email, follow_up, meeting_prep, …): ranked facts with confidence + freshness, timeline, stakeholders, predictions, and the ICP fit score
- `get_account` — the full account record: every claim + the activity timeline
- `query` — retrieve and summarise activity across many people (group by entity, subtract sets, value rollups)
- `attention` — what needs attention now (accounts gone quiet, facts decayed)
- `verify` — re-check a single fact before acting on it
- `get_gtm_profile` — the user's OWN GTM profile (ICP, market, product, pricing, competitors, positioning). Also registered under the legacy alias `get_workspace_facts`
- `search_notes` — semantic search over saved notes & documents on contacts

Write:
- `record` — record what happened or what you learned (events and state observations); the single write verb
- `update_gtm_profile` — evolve a section of the user's own GTM profile (keeps prior versions as history)
- `save_note` — attach a note/document (meeting brief, transcript, prep) to a contact

## REST API routes (apps/api)

The public surface is the `/v2` Context API (key-authed via `verifyApiKey`). The MCP tools are thin clients of exactly these routes (see `apps/mcp/src/server.js`):
- `POST /v2/context` — engineered context for a task (backs `get_context`)
- `GET  /v2/accounts/:id` — the full account record (backs `get_account`)
- `POST /v2/observations` — record observations, the single write path (backs `record`)
- `POST /v2/query` — retrieve/summarise activity across many entities (backs `query`)
- `GET  /v2/attention` — what needs attention (backs `attention`)
- `POST /v2/verify` — re-derive a single fact (backs `verify`)
- `GET  /v2/workspace/facts` / `POST /v2/workspace/facts` — read/evolve the GTM profile (back `get_gtm_profile` / `update_gtm_profile`)
- `POST /v2/notes` / `POST /v2/notes/search` — save / semantically search notes (back `save_note` / `search_notes`)

Cloud-only routes also mounted under `/v2` include `/v2/people`, `/v2/leads`, `/v2/signals`, and `/v2/dedup`. The browser app's own routes live under `/api/*` and are session-authed, not part of the agent-facing surface.

## Code conventions

- ESM throughout (`"type": "module"` in all package.json files)
- No default exports — use named exports everywhere
- TypeScript in `packages/` and `apps/frontend`; plain `.mjs` is acceptable in `apps/api` and `apps/worker`
- Supabase service role key only in `apps/api` and `apps/worker` — never in frontend or MCP server
- All secrets via environment variables — no hardcoded keys anywhere

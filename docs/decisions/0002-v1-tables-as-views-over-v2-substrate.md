# ADR 0002 — v1 tables as SQL views over the v2 substrate

**Status:** Accepted · 2026-05-23
**Context:** Completion of the v1 → v2 cutover (see `supabase/migrations/phase*.sql`).

## Decision

The application-facing tables `contacts`, `companies`, `leads`, and `lead_lists`
are not tables. They are SQL VIEWs over the v2 evidence substrate (`entities`,
`entity_identifiers`, `claims`, `predictions`, `relationships`,
`collection_entities`, `collections`, `observations`) with `INSTEAD OF`
`INSERT/UPDATE/DELETE` triggers that translate v1-shape writes into v2 ops.

## Why

We needed to retire the legacy v1 storage model without rewriting every
`from('contacts').insert/update/select` site in the codebase (60+ in `contacts`
alone). The SQL view approach lets us:

- **Drop the v1 tables** — the data model is fully unified on the v2 substrate.
- **Keep the app code unchanged** — every existing `from('contacts')` query
  works transparently through the view + triggers.
- **Make every write trace back to evidence** — an `UPDATE contacts SET
  pipeline_stage = 'interested'` translates to a state observation on the
  pipeline_stage property, which derives a claim. The claim has provenance
  back to the observation, which has provenance back to whatever event
  triggered the change. Nothing is overwritten in place.

## Data flow

```
  app code                v1 view                trigger                  v2 substrate
  ────────                ───────                ───────                  ────────────
  INSERT INTO contacts ──▶ contacts ──INSTEAD OF──▶ contacts_insert_handler
                                                       │
                                                       ├─▶ entities (upsert)
                                                       ├─▶ entity_identifiers (per id kind)
                                                       ├─▶ observations (state, per claim-worthy field)
                                                       ├─▶ predictions (if icp_score set)
                                                       └─▶ relationships (if company_id set)
                                                                │
                                                                ▼
                                                       claim_jobs (trigger)
                                                                │
                                                                ▼
                                                       claim-derivation engine
                                                                │
                                                                ▼
                                                            claims
```

Reads work the opposite direction: the view runs correlated subqueries against
identifiers, claims, predictions, relationships, and observations to project
the v1 row shape. Sub-100ms at the workspace scale we operate at; backed by
the `UNIQUE (workspace_id, entity_id, property)` index on `claims`.

## What is and isn't a v1 legacy

Retired (dropped outright):
- `mind_episodes` — superseded by `predictions`
- `workspace_memories` — superseded by `note.<uuid>` asserted claims
- `contact_activity_log` — superseded by event observations

Retired (replaced by views over v2):
- `contacts`, `companies` — Phase 4c
- `leads`, `lead_lists` — Phase 5

Intentionally kept (NOT v1 legacy):
- `workspace_graph_edges` — extracted intelligence layer with labels and node
  types beyond person/company (topic, product, competitor). Different purpose
  from `relationships` (foundational entity edges only).
- `lead_suppressions` — workspace policy table (applies to email/domain
  regardless of entity).
- `entities`, `claims`, `observations`, `predictions`, `relationships`,
  `entity_identifiers`, `collections`, `collection_entities`, `claim_jobs`,
  `scorecard_signals`, `scorecard_runs`, `observation_crm_pushes` — these
  ARE the v2 substrate.

## Conventions

- **`entity.id == v1 row.id`.** The original migration backfilled entity ids
  from contact/company/lead ids; the INSTEAD OF triggers preserve this for new
  inserts. Foreign references that used to point at `contacts.id` continue to
  work as references to `entities.id`.
- **Soft-delete only.** `DELETE FROM contacts` sets `entities.status =
  'merged'`. Claims are invalidated via `invalid_at`, never hard-deleted.
- **Append-only observations.** Every state change creates a new observation;
  the latest determines the current claim value.
- **Identifiers are the lookup key.** `entity_identifiers` (email, linkedin,
  hubspot, etc.) is the resolution index — not `contacts.email` or
  `contacts.linkedin_url`.

## When to write new code

For NEW write paths, prefer v2 primitives directly:
- `getOrCreateEntity(supabase, workspaceId, type, identifiers)` — entity + identifiers
- `recordObservation(supabase, input)` — append a single observation
- `recordObservations(supabase, inputs)` — append many
- `saveNote(supabase, workspaceId, params)` — asserted note claim
- `logActivity(supabase, params)` — event observation + CRM push + pipeline stage
- `scoreAndStake(supabase, workspaceId, entityId, signals)` — score and stake a prediction
- `classifyEmails(supabase, workspaceId, emails)` — pre-flight dedup against engagement state

Avoid adding new `from('contacts')` / `from('companies')` / `from('leads')`
writes in new code. They work, but they obscure the v2 primitives.

## Tradeoffs

- The view's correlated subqueries run per-row at SELECT time. For 100s–1000s
  of rows per workspace this is fine. At hundreds of thousands of rows per
  workspace, the view layer becomes the bottleneck; the resolution is a
  materialized projection refreshed by the claim engine, not a code change.
- Some v1 idioms still leak into the app surface (e.g., `notes` field on the
  contacts view is sourced from a `note` claim, but it's still a singular
  field — multi-note semantics live in the `note.<uuid>` claim family).
- INSTEAD OF triggers carry an exact list of columns. Adding a new column to
  the contacts view requires updating both the view DDL and the trigger
  functions. Document this in `supabase/migrations/` whenever it changes.

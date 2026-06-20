# Relationship graph — org chart + buying committee

Identity resolution gives Nous the **nodes** (a resolved person, a resolved
company) and the `works_at` **edges** between them. This feature derives the next
layer on top of those nodes: the **org chart** and the **buying committee**, so
an agent asking for context sees *the committee with roles*, not five loose
contacts.

Two outputs, derived per company from titles + engagement:

| Output | Where it's stored | Shape |
|---|---|---|
| **Org chart** | `relationships` table, `type = 'reports_to'` | `from_entity_id` reports to `to_entity_id`, temporal (`valid_to` NULL = current) |
| **Committee role** | a `committee_role` **claim** (derived from a state observation) | `champion` / `economic_buyer` / `influencer` / `blocker` / `contact` |

Everything here is **inferred**, never observed — heuristics over titles and
engagement. Confidence on a derived `reports_to` edge is deliberately modest
(`0.5`), and `committee_role` lands as an `inferred` claim.

## How it works

1. **Worker** — `apps/worker/src/workers/relationshipDerivation.mjs`, hourly at
   `:25` (after pipeline-stage derivation at `:15`, so `works_at` edges are
   settled). For each active company it loads the colleagues (`works_at`), their
   title/seniority/department claims, and 90 days of engagement, then:
   - derives `reports_to` edges and upserts them (one current manager per
     person, stale edges expired);
   - classifies each member's committee role and, **only when it changes**,
     writes a `committee_role` state observation. The claim engine then derives
     the `committee_role` claim downstream — the same pattern `stageDerivation`
     uses for `pipeline_stage`.

2. **Derivation logic** — `packages/core/src/relationships.ts` (pure, typed,
   side-effect free):
   - `seniorityRank(title, seniority)` — a 0–100 ladder from title keywords with
     the explicit `seniority` claim folded in.
   - `deriveReportsTo(members)` — each member reports to the nearest strictly
     higher-ranked member, preferring the same department. Acyclic by
     construction (edges only ever point to a strictly higher rank).
   - `classifyCommittee(members)` — champion is **relative** (the most-engaged
     member at the account); the rest fall to absolute rules (VP+ →
     `economic_buyer`, director/engaged → `influencer`, explicit negative →
     `blocker`, else `contact`).

3. **Edge DB helpers** — `packages/core/src/db/relationships.ts`
   (`getEmployer`, `getColleagues`, `getManagers`, `upsertRelationship`,
   `setReportsTo`). All access to the `relationships` table goes through here.

4. **Surfaced to agents** — `loadStakeholders()` in
   `packages/core/src/context.ts` now returns each stakeholder with `title`,
   the committee `role`, and `reports_to` (manager entity id), ordered
   champion → economic_buyer → influencer → blocker → contact. Until the worker
   has run, `role` defaults to `contact` so the shape is always present.

## Scope (v1)

In: `reports_to` org chart + committee roles. Deferred: company-to-company edges
(`competitor_of` / `uses`, need an enrichment source) and warm-intro / prior-
coworker paths (need accumulated job-change history). No schema migration —
`reports_to` already fits the `relationships` table and `committee_role` fits
`claims`.

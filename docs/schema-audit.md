# Schema Audit — Current Build vs. Founding Charter

*Audited against `founding-charter.md`. Judged only on the charter — not on effort already spent. Snapshot: `supabase/schema.sql` (17 sections), migrations through 2026-05-21, SDK surface, identity util.*

---

## Headline verdict

**Nous today is a well-engineered CRM with an intelligence layer bolted on top. The charter says Nous is an evidence substrate. Those are different foundations — and the current one is the wrong one.**

The upper floors were built before the foundation. `mind_episodes` + `scorecard_*` (the compound loop) is the *most* charter-aligned work in the repo — and it was built last, on top of a value-centric core: `contacts` / `companies` as tables of mutable, bare, unprovenanced values, with **email as the identity**. That is precisely the model the charter forbids: "store evidence, not values."

The things built are good engineering. They were built in the wrong *order*, on the wrong *spine*.

## Charter scorecard

| Charter primitive | Today | Verdict |
|---|---|---|
| **Entity / canonical identity** | `contacts` keyed by `UNIQUE(workspace_id, email)`; `companies` by domain | ❌ A person *is* their email. No entity survives a job change. |
| **Observation spine** | `contact_activity_log` (bitemporal, dedup, `raw_data`) | 🟡 Events logged well — state assertions (title, firmographics, enrichment) overwrite columns instead. Half-built. |
| **Claim layer (structured, derived)** | Bare columns on `contacts`/`companies`; `workspace_memories` (free-text only) | ❌ Structured facts are overwritable values. No derived layer. |
| **Provenance** | `source` on memories/activities; `apollo_raw` JSONB dump | 🟡 None on structured facts. |
| **Confidence** | `workspace_graph_edges.confidence` only | 🟡 ~95% of facts carry none. |
| **Decay / freshness** | `decay_pipeline_stages()` for one field | 🟡 Only `pipeline_stage`. |
| **Self-healing loop** | `pipeline_stage` recompute trigger | 🟡 No outcome→fact backprop. A bounce invalidates nothing. |
| **Compound loop** | `mind_episodes` + `scorecard_*` | 🟢 Best part. Immutable snapshots, point-in-time `features`. But learns confidence-blind. |
| **Context API (epistemics-carrying)** | SDK: `getContact`, `updateContact(id,{job_title:'CTO'})` | ❌ CRUD of bare values. `updateContact` *is* the anti-pattern. |
| **Integration coverage** | 14 providers, `webhook_inbox` retry queue, OAuth | 🟢 Real, broad — keep all of it. |

## What is right — do not throw away

- **All integration infrastructure** — `workflow_providers`, `workflow_provider_connections`, `webhook_inbox`, OAuth, the 14 wired sources. Genuine Phase-0 coverage.
- **`contact_activity_log`** — already has `occurred_at` vs `received_at` (bitemporal), `external_id` dedup, `source`, `raw_data`. This is the *seed of the Observation table*. Extend it.
- **`mind_episodes`** — immutable prediction snapshots with point-in-time `features`. Correct instinct. Keep.
- **The bitemporal pattern** (`valid_from`/`invalid_at`) and **`superseded_by`** on `workspace_memories` — right instincts, applied too narrowly.
- **The `pipeline_stage` engine** — derive-from-activity + decay function. The claim-derivation pattern in miniature. Keep as the prototype to generalize.
- **pgvector + semantic search** — reusable for observation/claim embeddings.

## The core structural flaw

Two things, and they cascade into everything:

1. **A contact *is* its current values.** `contacts` / `companies` are rows of bare, mutable columns — `job_title`, `industry`, `icp_score` — with no confidence, no provenance, no decay, no distribution. A new Apollo value overwrites the old; the prior evidence is gone. `apollo_raw` is a dump, not structured observations. **A value-centric store physically cannot compound — it overwrites its own evidence.**
2. **Identity = email.** `UNIQUE(workspace_id, email)` makes email the primary key of a human being. A job change creates a *new* contact. There is no temporal Entity. This makes the charter's deepest moat — temporal identity, the canonical registry, the cross-workspace network effect (everything is `workspace_id`-scoped) — **structurally impossible**, not merely unbuilt.

## The refined structure

Invert the model. The Observation log becomes the spine and system of record. `contacts` / `companies` become derived projections.

**New core tables:**

- **`entities`** — canonical, stable, typed (`person`/`company`/`deal`), status (`active`/`merged`/`split`). *Not* keyed by email. The anchor that survives identity changes.
- **`entity_identifiers`** — email, domain, `linkedin_member_id`, `hubspot_id`, the ~7 external-ID columns now on `contacts` — extracted into reversible, confidence-scored links → entity. The canonical registry.
- **`observations`** — the immutable, append-only spine. `(subject, property, value, source, method, observed_at, ingested_at, raw_ref, source_confidence)`. **Generalizes `contact_activity_log`**: an activity is an observation where `property = interaction`; an Apollo result is an observation where `property = job_title`; a bounce is an observation. Everything that today writes a column becomes an observation insert.
- **`claims`** — derived, regenerable. `(entity, property, value_distribution, confidence, epistemic_class, freshness_state, supporting_observation_ids, last_recomputed)`. Replaces the bare columns and absorbs the structured side of `workspace_memories` (free-text memories survive as a text-claim subtype).
- **`predictions`** — evolve `mind_episodes`: keep the immutable snapshot, but store **each feature's confidence** in the snapshot (confidence-weighted learning).
- **`scorecard_*`** — keep as-is; feed it confidence-weighted episodes.

**What happens to current tables:** `contacts`, `companies`, `leads` become views/projections over `entities` + `claims` — thin caches, not sources of truth. `workspace_graph_edges` folds into `claims` as relationship-claims. Integration tables untouched.

**The Context API:** writes become **observation submissions** (`track` is already this shape; `remember` too). Reads return **claims-with-epistemics** — never a bare value. `updateContact(id,{job_title:'CTO'})` is retired; an agent that knows a new title submits an observation.

## Migration path — staged, not a rewrite

1. **Phase 0** — add `entities`, `entity_identifiers`, `observations` (generalize `contact_activity_log`). **Dual-write**: every column write also emits an observation. Old tables keep working — the bridge.
2. **Phase 1** — add `claims`; build the general "recompute claim for `(entity, property)` on new observation" engine, generalizing the `pipeline_stage` trigger. `contacts`/`companies` become read-through projections.
3. **Phase 2** — flip the API: reads serve claims-with-epistemics; writes are observations.
4. **Phase 3** — wire outcome-backprop (bounces, no-shows → invalidate claims). Generalize decay beyond `pipeline_stage`.
5. **Phase 4** — upgrade `mind_episodes` with feature-confidence; turn on confidence-weighted learning.

## The one thing to do first

**Kill email-as-identity.** Introduce `entities` + `entity_identifiers` and start dual-writing observations now. Everything else — claims, the loop, the network effect — is blocked behind it, and every day on the old model is more evidence overwritten and lost. It is the load-bearing fix.

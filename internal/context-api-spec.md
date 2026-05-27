# Context API — v2 Specification & Build Plan

A review document. The agent-facing API for the evidence substrate (`entities`,
`observations`, `claims`, `relationships`, `predictions`). Companion to
`founding-charter.md`, `schema-audit.md`, `v2-build-plan.md`.

---

## 1. Principle

> **Context engineering:** for a specific agent request, deliver exactly the
> information needed to make the best decision — selected, compressed, ranked,
> trust-tagged, formatted — and nothing else.

The API is **not** a database (resources / `GET /accounts/:id`). It is a
**retrieval-and-assembly service** organised around agent *intent*. Raw access
exists only for human-facing UIs.

Two request shapes drive the read design:

- **Shape A — one entity, a task.** "Draft an email," "draft a follow-up,"
  "prep for this meeting." → `POST /v2/context`
- **Shape B — a corpus, a question.** "Last 10 meetings," "100 non-converting
  emails." → `POST /v2/query`

## 2. Semantic search — what it is, and its role here

Semantic search finds observations and claims by **meaning**, not keywords —
*"budget concerns"* matches *"worried about Q3 spend"* with no shared words. It
works by embedding text into vectors and finding nearest neighbours (pgvector,
already set up).

**Where it sits:** it is **step 2 (Retrieve) of the pipeline** — nothing more.
When an intent recipe says `semantic_probes: ["blockers"]`, or a `/query`
carries a natural-language `question`, the API embeds that and vector-searches
the substrate to pull a candidate set.

**Honest framing:** by the charter's litmus test, embeddings + ANN search are
**commodity, AGI-era infra — not a moat.** We include semantic search for one
reason: budgeted assembly *requires* a pre-filter. We cannot hand an agent
10,000 observations and say "you pick." Semantic search narrows the candidates
so the assembly steps — rank, connect, compress, tag — can do the real context
engineering. **The product is the assembly. Search is plumbing.** Use pgvector,
keep it simple, do not over-invest.

## 3. How agents write — observe, never update

This is the most important thing about how agents write to Nous, and it is what
makes agent writes *safe*.

> **The agent has no `update`. The agent has `observe`.**

There is no `PATCH /accounts/:id`, no "set the field." When an agent learns
something, it appends an **observation** — an immutable, timestamped, sourced
record. The substrate then *derives* the new claim. "Update" is an illusion the
substrate produces; the agent never overwrites anything.

**Worked example — the proposal that dropped from $15k to $10k:**

- *Day 1.* A meeting happens; the Fireflies webhook fires. Nous records two
  observations: `interaction.meeting_held` (event) and an extracted state
  observation `deal.proposal_amount = 15000` — `source: fireflies`,
  `method: extraction`, `observed_at: <meeting date>`. The claim derives → **$15,000**.
- *Day 14.* A GTM engineer reviews the meeting with the agent and says "they
  dropped it to $10k." The agent calls `POST /v2/observations`:
  `deal.proposal_amount = 10000` — `source: agent`, `method: user_input`,
  `observed_at: <today>`.
- *Result.* The substrate now holds **two** state observations for that
  property. Nothing was deleted. `recomputeClaim` runs → the newer observation
  wins → the claim becomes **$10,000**. The $15k observation stays in the
  immutable log; the claim's provenance shows the trajectory:
  *"$15,000 (Fireflies, Day 1) → $10,000 (agent, Day 14)."*

Three things fall out for free:

- **The agent "updated" the proposal — with no update operation.** It observed;
  the substrate derived.
- **The change is free.** The agent recorded only the new *value*. The *drop*
  from $15k is emergent — two observations in a log. The agent never records
  "it dropped."
- **Error vs. real change needs no adjudication.** Whether Fireflies
  mis-transcribed or the price genuinely moved, the handling is identical: keep
  both, recency + source-trust resolve the claim, a human can read the history.
  Append-only is robust *because* it never has to decide.

**Agent writes are tagged like any source.** Every observation — connector or
agent — carries `source`, `method`, `source_confidence`. An agent relaying a
fact a human stated directly (`method: user_input`) can be *more* trustworthy
than an auto-extraction (`method: extraction`); the derivation weighs that, not
just recency. (v1 derivation is recency-first; per-source trust weighting is the
first refinement — see `schema-audit.md`.)

**One write path for everything.** Fireflies extracting facts and an agent
recording what it learned are the *same operation* — an observation. The
substrate does not care where a fact came from; it cares that it is tagged.
Events ("a meeting happened"), state assertions ("title is now VP"), and
corrections (just newer state observations) all go through `POST /v2/observations`.

### Nothing is deleted — validity, not erasure

The flip side of "observe, never update" is: **nothing is ever hard-deleted.**
Deletion destroys evidence, and the evidence is the moat. So "delete" everywhere
becomes "mark no longer valid, as of a date." Two layers, two behaviours:

- **Observations are immutable — never deleted, never even invalidated.** An
  observation records "source S asserted X at time T" — permanently true *as a
  historical record*, even if X later proves wrong. The only edge case (a
  mis-fired webhook, test data) is handled by a **retraction observation** — a
  new `kind:event` observation pointing at the bad one. The original stays in
  the log (auditable); the derivation engine excludes it. Append-only purity is
  never broken — even a retraction is just another observation.

- **Claims carry a validity window** — `valid_from` and `invalid_at`.
  `invalid_at IS NULL` = currently believed true. When evidence positively says
  a fact ended (a person left, an email bounced), `invalid_at` is set to that
  date. The claim row is **not deleted** — an agent reading it sees
  `job_title: "VP Eng" — invalid since 2025-06` and knows it is history.

- **`invalid_at` is not `freshness: expired`.** `expired` = "no fresh
  observation in a long time — *uncertain*" (silence). `invalid_at` = "positive
  evidence it *ended*" (a known close). An agent treats them differently:
  expired → verify; invalid → it is over.

- **How an agent invalidates:** there is no `DELETE`. To say a fact ended, the
  agent records a state observation with `value: null` — "this property no
  longer holds, as of `observed_at`." The derivation sets `invalid_at`. (v1:
  explicit; auto-detecting it from job-change / bounce events is a refinement.)

- `relationships` already carry `valid_from`/`valid_to`; `entities` carry
  `status` (`active`/`merged`). The whole substrate is consistent: immutable
  forever, or validity-dated. (v1's `workspace_memories` already had
  `valid_from`/`invalid_at` — the right instinct; v2 makes it universal and
  drops the redundant `is_active`, which was just `invalid_at IS NULL`.)

- **The one real delete: GDPR erasure.** Legal "right to be forgotten" needs a
  true hard-delete. That is a single, walled-off `purge` admin operation — never
  an agent capability, never on the normal path.

**The payoff — time travel.** Because nothing is destroyed and everything is
dated (`observed_at`, `ingested_at`, `valid_from`, `invalid_at`), the substrate
is **bitemporal**: you can re-derive *what we believed about any account on any
past date*. Free audit, free debugging, and the no-leakage property the compound
loop needs — a prediction scored on what was known *then*, not now.

## 4. The endpoint set

| Endpoint | Purpose | Phase |
|---|---|---|
| `POST /v2/context` | Engineer context for an `intent` on one entity (Shape A) | 1 |
| `POST /v2/observations` | Record what happened / was learned (write) | 1 |
| `GET /v2/accounts/:id` | Full projection — for human UIs & debugging, **not** agents | 1 |
| `POST /v2/query` | Retrieve + summarise a corpus for a question (Shape B) | 2 |
| `GET /v2/attention` | Proactive: what changed, what's at risk | 3 |
| `POST /v2/verify` | Re-check a claim on demand before acting | 3 |

**Is six enough?** Yes — it closes the full agent loop: focused context
(`context`), analytical retrieval (`query`), proactive surfacing (`attention`),
writing (`observations`), on-demand calibration (`verify`), full projection for
UIs (`accounts`).

## 5. The shared pipeline

Every read endpoint runs one pipeline; endpoints differ only at steps 1–2.

1. **Interpret** — parse intent + focus (entity or corpus).
2. **Retrieve** — over-fetch candidates: semantic search (§2) × structured
   filters × recency.
3. **Rank** — score by relevance-to-intent × confidence × freshness; keep top.
4. **Connect** — traverse the entity/relationship graph; pull in stakeholders;
   group claims by theme; co-locate evidence bearing on the same question.
5. **Compress** — temporal tiering on timelines; claims already dedupe N
   observations → 1 belief.
6. **Tag** — every fact carries confidence + freshness + provenance.
7. **Budget & format** — fit the token budget, degrading gracefully (drop
   low-confidence first); return structured + optional prose.

**Connecting the dots:** step 4 *co-locates* connected evidence (champion X's
claim + economic-buyer Y's claim + "X reports to Y") so the agent can reason
"delay = budget, not disinterest." It does **not** do the causal inference —
retrieval and co-location are load-bearing; the reasoning is the agent's.

## 6. Endpoint specs

### `POST /v2/context`  — Shape A

Request:
```jsonc
{ "focus": "sarah@acme.com",        // email | domain | linkedin | entity_id
  "intent": "follow_up",            // see §7 — selects the context recipe
  "budget_tokens": 1500 }           // optional
```
Response:
```jsonc
{ "entity": { "id", "type", "primary_name" },
  "intent": "follow_up",
  "summary": "2–3 sentence derived gist of the account",
  "claims": [
    { "property", "value", "confidence", "freshness", "epistemic_class",
      "theme", "as_of", "source_count", "provenance": ["obs_id", ...] } ],
  "stakeholders": [
    { "entity_id", "name", "role", "key_claims": [ ... ] } ],
  "timeline": [
    { "when", "type", "direction", "summary", "tier": "full|brief|count" } ],
  "open_threads": [ "Waiting on CEO approval", "Co-worker still on the proposal" ],
  "predictions": [ { "kind", "value", "confidence" } ],
  "rendered": "optional prose block",
  "meta": { "token_estimate", "claims_total", "claims_returned" } }
```

### `POST /v2/observations`  — write

Request:
```jsonc
{ "focus": "sarah@acme.com",        // resolve-or-create the entity
  "observations": [
    { "kind": "state", "property": "deal.proposal_amount", "value": 10000,
      "source": "agent", "method": "user_input", "observed_at": "...",
      "external_id": "..." } ] }
```
Response — returns the *effect*, so the agent sees its write landed:
```jsonc
{ "entity_id", "recorded": 1,
  "claims_updated": [
    { "property": "deal.proposal_amount", "value": 10000, "confidence": 0.8 } ] }
```
Resolves-or-creates the entity, appends observations, recomputes the affected
claims **inline** for immediate feedback; the DB trigger + `claim_jobs` queue is
the async backstop. See §3 — this is the agent's only write verb.

### `POST /v2/query`  — Shape B

Request:
```jsonc
{ "scope": { "type": "email", "outcome": "lost", "date_range": "P180D",
             "collection_id": null, "limit": 100 },
  "question": "common objections",   // optional semantic rerank
  "budget_tokens": 4000 }
```
Response:
```jsonc
{ "scope": { ...echoed... },
  "matched": 100, "returned": 42, "sampled": true,
  "items": [
    { "entity_id", "entity_name", "when", "channel", "outcome",
      "summary": "one-line gist", "key_claims": [ ... ] } ],
  "rollups": { "by_outcome": {...}, "by_type": {...} },
  "meta": { "token_estimate" } }
```
Compresses each item to a structured summary (never raw bodies); structural
rollups computed server-side; if `matched > budget`, returns a representative
sample and the true count. The agent does the pattern-finding.

### `GET /v2/accounts/:id`  — full projection (human UIs)

Returns `getAccountRecord` verbatim — entity + every claim + recent timeline,
no intent shaping. For the frontend account page and debugging. **Agents should
use `/context`**, not this.

### `GET /v2/attention`  — proactive

Standing detectors over claims/predictions: claims gone `suspect`/`expired` on
important entities, champion identity changes, new high-confidence signals,
resolved predictions. Returns ranked decisions:
```jsonc
{ "items": [
    { "kind", "entity_id", "entity_name", "what", "why_it_matters",
      "confidence", "suggested_action" } ] }
```

### `POST /v2/verify`  — on-demand calibration

`{ "entity_id", "property" }` → forces a fresh check (re-enrichment / probe),
records the new observation, recomputes, returns `{ "before": {...}, "after": {...} }`.

## 7. Intent recipes

An `intent` is a **declarative context recipe** — not a hardcoded branch.
Stored as config, extensible without code changes:
```jsonc
{ "intent": "follow_up",
  "claim_themes": ["deal_state","objections","commitments","timing"],
  "timeline_window_days": 30,
  "timeline_tiers": [[7,"full"],[30,"brief"]],
  "stakeholder_depth": "buying_group",
  "semantic_probes": ["blockers","next steps","budget"],
  "include_predictions": true,
  "default_budget_tokens": 1500 }
```
Initial set: `draft_email`, `follow_up`, `meeting_prep`, `call_prep`,
`account_review`. New intents = new config rows.

## 8. Use-case mapping

| Agent request | Call |
|---|---|
| Draft an email for this person | `POST /context { intent:"draft_email" }` |
| Reply came in → draft a follow-up | `POST /context { intent:"follow_up" }` |
| Prep me for the meeting | `POST /context { intent:"meeting_prep" }` |
| "They dropped the proposal to $10k" | `POST /observations { state: deal.proposal_amount }` |
| Analyse last 10 meeting patterns | `POST /query { scope:{type:"meeting",limit:10} }` |
| Last 25 LinkedIn chats | `POST /query { scope:{channel:"linkedin",limit:25} }` |
| Learn from 100 non-converting emails | `POST /query { scope:{type:"email",outcome:"lost",limit:100} }` |
| What changed / who's at risk | `GET /attention` |
| Is this fact safe to act on? | `POST /verify` |

## 9. Architecture

- **The HTTP API is the single contract.** The MCP server, the SDK, and the CLI
  are thin clients of it.
- **The pipeline lives in `@nous/core`** — `getAccountRecord`, `recomputeClaim`,
  `resolveEntity`, `recordObservation` exist; add `assembleContext()`,
  `runQuery()`, `getAttention()`.
- Routes in `apps/api/src/routes/v2/`. The MCP re-points its tools at `/v2/*`.
- Context engineering is engineered **once**, in core — never per client.

## 10. Build phasing

- **Phase 1** — `observations`, `context` (`draft_email` / `follow_up` /
  `meeting_prep`), `accounts/:id`. Re-point the MCP. *Unblocks use cases 1–4 +
  the write loop.*
- **Phase 2** — `query` (the analytical corpus endpoint). *Use cases 5–7.*
- **Phase 3** — `attention`, `verify`.

## 11. Open decisions — for senior-dev review

1. **Sync vs async recompute on write** — proposed: inline recompute for the
   written properties (agent feedback) + trigger as async backstop. Confirm.
2. **`context` + `query` as two endpoints vs one** — proposed: two (distinct
   response shapes, cleaner MCP tools). Confirm.
3. **Intent recipes — code config vs DB table** — proposed: start as a code
   config object; move to a DB table when customers need custom intents.
4. **Embeddings** — pgvector is set up; observations/claims get embedded by a
   worker job on insert. Confirm the embedding model + when it runs.
5. **`verify` mechanism** — what it triggers depends on connector work; v1 =
   force re-enrichment of that property. Scope this.
6. **Agent-write trust** — should agent observations get a default
   `source_confidence`, and how should `user_input` vs `extraction` weight in
   derivation? (Recency-first today; source-trust is the first refinement.)
7. **Auth** — reuse the existing per-workspace API-key middleware (`apiKey.mjs`).
8. **Versioning** — `/v2/*` coexists with `/v1/*` through cutover; the MCP
   migrates tool-by-tool.
9. **Cost / rate limits** — `/query` over 100s of items + embeddings has real
   cost; `budget_tokens` caps response size, add a per-key rate limit.

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
survives only as an escape hatch.

Two request shapes drive the whole design:

- **Shape A — one entity, a task.** "Draft an email," "draft a follow-up,"
  "prep for this meeting." → `POST /v2/context`
- **Shape B — a corpus, a question.** "Last 10 meetings," "100 non-converting
  emails." → `POST /v2/query`

## 2. The endpoint set

| Endpoint | Purpose | Phase |
|---|---|---|
| `POST /v2/context` | Engineer context for an `intent` on one entity (Shape A) | 1 |
| `POST /v2/observations` | Record what happened / was learned (write) | 1 |
| `GET /v2/accounts/:id` | Raw projection — primitive / escape hatch | 1 |
| `POST /v2/query` | Retrieve + summarise a corpus for a question (Shape B) | 2 |
| `GET /v2/attention` | Proactive: what changed, what's at risk | 3 |
| `POST /v2/verify` | Re-check a claim on demand before acting | 3 |

**Is six enough?** Yes — it closes the full agent loop: focused context (`context`),
analytical retrieval (`query`), proactive surfacing (`attention`), writing
(`observations`), on-demand calibration (`verify`), raw access (`accounts`).
Nothing in the use cases falls outside it.

## 3. The shared pipeline

Every read endpoint runs one pipeline; endpoints differ only at steps 1–2.

1. **Interpret** — parse intent + focus (entity or corpus).
2. **Retrieve** — over-fetch candidates: semantic search × structured filters ×
   recency. *Semantic search is step 2 of every call, not a separate feature.*
3. **Rank** — score by relevance-to-intent × confidence × freshness; keep top.
4. **Connect** — traverse the entity/relationship graph; pull in stakeholders;
   group claims by theme; co-locate evidence bearing on the same question.
5. **Compress** — temporal tiering on timelines; claims already dedupe N
   observations → 1 belief.
6. **Tag** — every fact carries confidence + freshness + provenance.
7. **Budget & format** — fit the token budget, degrading gracefully (drop
   low-confidence first); return structured + optional prose.

**Connecting the dots:** step 4 *co-locates* connected evidence (champion X's
claim + economic-buyer Y's claim + "X reports to Y") — it does **not** do the
causal "X because Y" inference. Retrieval and co-location are load-bearing;
the reasoning is the agent's. We never build an inference engine.

## 4. Endpoint specs

### `POST /v2/context`  — Shape A

Request:
```jsonc
{ "focus": "sarah@acme.com",        // email | domain | linkedin | entity_id
  "intent": "follow_up",            // see §5 — selects the context recipe
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
Context engineering: the `intent` recipe decides which claim themes surface,
timeline depth, and stakeholder depth. Claims ranked relevance × confidence ×
freshness. Every claim trust-tagged. Stakeholders pulled via the `relationships`
graph so the agent can connect the dots. Sized to `budget_tokens`.

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
Context engineering: retrieves the corpus by structured filter + semantic
rerank; compresses each item to a structured summary (never raw bodies);
structural rollups (counts) are computed server-side; if `matched > budget`,
returns a representative sample and reports the true count. The agent does the
pattern-finding — the API does retrieval + compaction.

### `GET /v2/accounts/:id`  — primitive

Returns `getAccountRecord` verbatim (entity + all claims + recent timeline).
No intent shaping. For agents that genuinely want the raw projection.

### `POST /v2/observations`  — write

Request:
```jsonc
{ "focus": "sarah@acme.com",
  "observations": [
    { "kind": "event", "property": "interaction.email_sent", "value": {...},
      "source": "agent", "method": "api", "observed_at": "...",
      "external_id": "..." } ] }
```
Response:
```jsonc
{ "entity_id", "recorded": 1,
  "claims_updated": [ { "property", "value", "confidence" } ] }
```
Resolves-or-creates the entity, appends observations. Recomputes affected
claims **inline** for the written properties (agent gets immediate feedback);
the DB trigger + `claim_jobs` queue is the async backstop.

### `GET /v2/attention`  — proactive

Runs standing detectors over claims/predictions: claims gone `suspect`/`expired`
on important entities, champion identity changes, new high-confidence signals,
resolved predictions. Returns ranked *decisions*:
```jsonc
{ "items": [
    { "kind", "entity_id", "entity_name", "what", "why_it_matters",
      "confidence", "suggested_action" } ] }
```

### `POST /v2/verify`  — on-demand calibration

`{ "entity_id", "property" }` → forces a fresh check for that property
(re-enrichment / probe), records the new observation, recomputes, returns
`{ "before": {...}, "after": {...} }`. The use-case-4 reliability unlock.

## 5. Intent recipes

An `intent` is a **declarative context recipe** — not a hardcoded branch. Stored
as config, extensible without code changes:
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

## 6. Use-case mapping

| Agent request | Call |
|---|---|
| Draft an email for this person | `POST /context { intent:"draft_email" }` |
| Reply came in → draft a follow-up | `POST /context { intent:"follow_up" }` |
| Prep me for the meeting | `POST /context { intent:"meeting_prep" }` |
| Analyse last 10 meeting patterns | `POST /query { scope:{type:"meeting",limit:10} }` |
| Last 25 LinkedIn chats | `POST /query { scope:{channel:"linkedin",limit:25} }` |
| Learn from 100 non-converting emails | `POST /query { scope:{type:"email",outcome:"lost",limit:100} }` |
| What changed / who's at risk | `GET /attention` |
| Is this fact safe to act on? | `POST /verify` |

## 7. Architecture

- **The HTTP API is the single contract.** The MCP server and the SDK are thin
  clients of it. The CLI too.
- **The pipeline lives in `@nous/core`** — `getAccountRecord`, `recomputeClaim`,
  `resolveEntity` exist; add `assembleContext()`, `runQuery()`, `getAttention()`.
- Routes in `apps/api/src/routes/v2/`. The MCP re-points its tools at `/v2/*`.
- Context engineering is engineered **once**, in core — never per client.

## 8. Build phasing

- **Phase 1** — `observations`, `context` (`draft_email` / `follow_up` /
  `meeting_prep`), `accounts/:id`. Re-point the MCP at them. *Unblocks use
  cases 1–3 + the write loop.*
- **Phase 2** — `query` (the analytical corpus endpoint). *Use cases 4–6.*
- **Phase 3** — `attention`, `verify`.

## 9. Open decisions — for senior-dev review

1. **Sync vs async recompute on write** — proposed: inline recompute for the
   written properties (agent feedback) + trigger as async backstop. Confirm.
2. **`context` + `query` as two endpoints vs one** — proposed: two (distinct
   response shapes, cleaner MCP tools). Confirm.
3. **Intent recipes — code config vs DB table** — proposed: start as a code
   config object; move to a DB table when customers need custom intents.
4. **Embeddings** — pgvector is set up; observations/claims get embedded by a
   worker job on insert. Confirm the embedding model + when it runs.
5. **`verify` mechanism** — what it actually triggers depends on connector
   work; v1 = force re-enrichment of that property. Scope this.
6. **Auth** — reuse the existing per-workspace API-key middleware (`apiKey.mjs`).
7. **Versioning** — `/v2/*` coexists with `/v1/*` through cutover; MCP migrates
   tool-by-tool.
8. **Cost / rate limits** — `/query` over 100s of items + embeddings has real
   cost; `budget_tokens` caps response size, add a per-key rate limit.

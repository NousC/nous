# The Mind — Compound Intelligence

> Status: **design** (not yet implemented). This document describes how Nous's
> passive memory layer becomes a *mind* — a system that observes outcomes,
> judges its own predictions, and rewrites its beliefs so it gets measurably
> better at modern GTM every run.

---

## 1. The idea in one paragraph

Today Nous has **memory**: atomic facts in `workspace_memories`, an ICP scorer
that reads those facts, a knowledge graph. It is *passive* — facts are written
by agents, the API, or humans, and nothing ever generates new memory from what
actually happened. The **Mind** adds the missing half: a closed feedback loop.
Every prediction the system makes (an ICP score, a "who to target" call) is
recorded, joined later against the realized outcome (did they reply, advance,
close), and handed to an LLM judge that rewrites the ICP definition and the
pattern library from evidence. Because `workspace_memories` is already
bi-temporal (`superseded_by`, `valid_from`, `invalid_at`), each rewrite is a new
version with the old one preserved — the Mind has an auditable belief history.
That is the compounding: run N+1 always scores against a sharper ICP than run N.

**Memory → Mind is a reframe, not a rebuild.** The table stays
`workspace_memories`. "Mind" is the product name for *memory + the loop that
improves it*. The UI (`apps/frontend/src/pages/Mind.tsx`) already calls it that.

---

## 2. What exists today (the substrate)

| Piece | Location | Role in the Mind |
|-------|----------|------------------|
| `workspace_memories` | `supabase/schema.sql` §8 | The belief store. Bi-temporal + `superseded_by` already supports versioned rewrites. |
| `/v1/remember` embedding dedup | `apps/api/src/routes/v1/remember.mjs` | Already supersedes near-duplicate facts (0.85 cosine). The judge reuses this write path. |
| `workspace_graph_edges` | `supabase/schema.sql` §9 | Stakeholder/relationship graph — judge can read it, write to it later. |
| `scoreICP()` | `apps/api/src/services/enrichment.mjs:601` | The prediction. Reads `ICP`/`Market`/`Company`/`Product` memories, scores 0–100 with Haiku. |
| `contact_activity_log` | `supabase/schema.sql` | The ground truth lives here — `email_reply`, meeting events, `pipeline_stage`, `deal_stage`. |
| `Mind.tsx` | `apps/frontend/src/pages/Mind.tsx` | UI shell already branded MIND, with PATTERN + ICP memory cards. |
| Worker crons | `apps/worker/src/index.mjs` | Where the nightly `mind:learn` job slots in. |

**The gap:** nothing joins a prediction to its outcome, and nothing learns from
that join. Three things are missing entirely: outcome capture, the judge job,
and a calibration metric.

---

## 3. The loop

```
   scoreICP() ──► contact scored 85 ──► snapshot prediction into mind_episodes
        ▲                                          │
        │                                  (days/weeks pass)
        │                                          ▼
        │                          outcome derived from contact_activity_log:
        │                          reply? pipeline advance? closed/won?
        │                                          │
        │                                          ▼
        │                          mind_episodes row completed:
        │                          (prediction, action, weighted outcome)
        │                                          │
        │                              nightly mind:learn cron
        │                                          ▼
        │                          LLM JUDGE (Opus/Sonnet) reviews cohorts:
        │                          "where was the ICP wrong? what pattern
        │                           predicts a reply the ICP misses?"
        │                                          │
        └───────── supersedes ICP + Pattern memories (versioned) ◄──┘
```

Run N+1 reads the ICP memories run N's judge rewrote. The calibration metric
(§7) moves each run, or the judge's change is the suspect.

---

## 4. New data model

### 4.1 `mind_episodes` — the prediction/outcome ledger

The one genuinely new table. One row per scored contact per scoring run.

```sql
CREATE TABLE mind_episodes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id    UUID REFERENCES contacts(id) ON DELETE SET NULL,
  company_id    UUID REFERENCES companies(id) ON DELETE SET NULL,

  -- The prediction (snapshot at scoring time — never mutated)
  kind          TEXT NOT NULL DEFAULT 'icp_score',  -- 'icp_score' | 'goal_step' | ...
  predicted_score   INT,
  predicted_fit     BOOLEAN,
  predicted_reason  TEXT,
  -- Which memory versions produced this prediction (for attribution)
  basis_memory_ids  UUID[] NOT NULL DEFAULT '{}',
  model         TEXT,
  predicted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The realized outcome (filled in later by the outcome job)
  outcome_replied      BOOLEAN,
  outcome_pipeline_from TEXT,
  outcome_pipeline_to   TEXT,
  outcome_revenue      NUMERIC,         -- closed/won value, if any
  outcome_score        NUMERIC,         -- weighted 0..1 — see §5
  outcome_resolved_at  TIMESTAMPTZ,     -- NULL = still open
  outcome_window_days  INT NOT NULL DEFAULT 30,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX mind_episodes_open
  ON mind_episodes(workspace_id, predicted_at)
  WHERE outcome_resolved_at IS NULL;
CREATE INDEX mind_episodes_resolved
  ON mind_episodes(workspace_id, outcome_resolved_at)
  WHERE outcome_resolved_at IS NOT NULL;
```

`basis_memory_ids` is what makes attribution possible: when the judge sees a
cohort of bad predictions, it knows *which ICP memory versions* produced them.

### 4.2 `Gold` memory category — the eval set

No new table needed. Reuse `workspace_memories` with `category = 'Gold'`:
human-confirmed exemplars — contacts that *definitely* converted, messages that
*definitely* worked. Two uses:

- `scoreICP()` few-shots from Gold examples for sharper scoring.
- The judge calibrates against Gold so the Mind cannot drift away from
  ground truth a human has vouched for.

A Gold memory is created when a human marks an episode "this is a textbook
fit" / "this messaging worked" in the Mind UI.

### 4.3 No schema change to `workspace_memories`

The judge's rewrites are ordinary `category = 'ICP' | 'Pattern'` rows written
through the existing supersede path. The belief history is already there.

---

## 5. Outcome scoring — three signals, weighted

Decision: the Mind learns from **reply, pipeline advancement, and closed/won
revenue together**, with the judge able to re-weight them.

The outcome job (worker cron, runs after the pollers) scans `mind_episodes`
with `outcome_resolved_at IS NULL` whose `predicted_at` is older than the
contact's scoring date, and derives:

| Signal | Source | Default weight |
|--------|--------|---------------|
| `outcome_replied` | `contact_activity_log` — any `email_reply` / inbound LinkedIn / meeting booked within the window | 0.25 |
| pipeline delta | `pipeline_stage` advanced vs. snapshot (`identified→…→client`) | 0.35 |
| `outcome_revenue` | `deal_stage = closed_won` + `deal_value` | 0.40 |

`outcome_score` ∈ [0,1] = weighted sum, normalized. An episode resolves when
either (a) revenue lands, or (b) `outcome_window_days` elapses with whatever
partial signal exists. The weights live in a `Mind`-category memory so the
judge can tune them — e.g. if reply rate turns out to be noise for a given
workspace, it down-weights reply itself.

Because revenue lags weeks–months, episodes resolve in tiers: reply/pipeline
give the judge an *early* signal at 30 days; revenue *upgrades* the episode's
`outcome_score` when it lands. The judge always knows which episodes are
revenue-confirmed vs. early-signal-only and weights its confidence accordingly.

---

## 6. The judge — `mind:learn`

A new worker cron (nightly, `cron.schedule('0 4 * * *', …)` — after the 03:00
pipeline decay). Decision: **auto-apply with history** — the judge supersedes
ICP/Pattern memories directly; bi-temporal history makes every change
auditable and one-click reversible in the UI.

Per workspace, each run:

1. **Gather.** Pull resolved `mind_episodes` since the last run + a standing
   sample of older ones. Pull current `ICP`/`Market`/`Pattern`/`Gold`
   memories. Compute the calibration metric (§7).
2. **Judge.** Send cohorts to **Claude Opus or Sonnet** (heavy reasoning, runs
   once/day — *not* Haiku, which stays for high-volume scoring). Prompt asks:
   - Where did high scores fail and low scores succeed? Which `basis_memory_ids`
     recur in the failures?
   - What attribute predicts a good `outcome_score` that the current ICP does
     not mention?
   - Output: revised ICP criteria, new/retired `Pattern` memories, optional
     re-weighting of §5, and a one-paragraph changelog entry.
3. **Apply.** Write revised facts via the `/v1/remember` supersede path
   (`source = 'mind'`). Old versions become `is_active = false` with
   `superseded_by` set. Append the changelog to a `Mind`-category memory.
4. **Guardrails.** Judge may not contradict an active `Gold` memory; if it
   wants to, it flags for human review instead of auto-applying. Cap the number
   of supersessions per run (avoid thrash). If the calibration metric *worsened*
   for two runs after a change, auto-revert to the pre-change version.

The judge never touches per-contact scores directly — it only edits the
*criteria*. Scores change because the next `scoreICP()` reads better criteria.

---

## 7. The metric — calibration gap

"Compounds every run" must be a number, not a vibe. Per workspace:

```
calibration_gap = avg(outcome_score | predicted_score >= 70)
                − avg(outcome_score | predicted_score <  70)
```

A good ICP scores the contacts who actually convert higher than those who
don't, so the gap is large and positive. The judge's job is to widen it. Plot
it per run on the Mind page — it is the single headline number that says the
Mind is, or is not, getting smarter. Track AUC / Brier score later for rigour.

---

## 8. `/goal` — judged loops

The qualitative-workflow layer on top of the same machinery. A **goal** is:

- a qualitative target — *"book 10 meetings with fintech CFOs at 200–1000-person
  companies"*;
- an LLM-judgeable **definition of done**;
- a loop: an agent acts → a judge scores progress against "done" → loop
  continues or stops.

Each loop iteration writes a `mind_episodes` row with `kind = 'goal_step'`, so
goal outcomes feed the same compounding store. Surface as:

- REST: `POST /v1/goals`, `GET /v1/goals/:id`, `POST /v1/goals/:id/run`.
- MCP: a `run_goal` tool, so an external agent can drive a judged loop.

This is a later phase — it depends on the episode ledger and judge existing
first.

---

## 9. Decisions

- **No Mem0 / external memory provider.** The native store is *better* for
  this: it is relational (joins to contacts, companies, activities), and we own
  the loop. Mem0 is a black box the judge cannot introspect or attribute
  against. The compounding value is in the loop, not the store. Splitting
  "general memory" out fragments the single Mind we are trying to build.
- **Haiku scores, Opus/Sonnet judges.** High-volume prediction stays cheap;
  heavy reasoning runs once per workspace per day.
- **Auto-apply, not propose-and-approve.** Bi-temporal history + the
  Gold guardrail + auto-revert make autonomy safe. A human reviews the
  changelog, not every diff.

---

## 10. Implementation phases

| Phase | Deliverable | Status | Unblocks |
|-------|-------------|--------|----------|
| **1** | `mind_episodes` migration + snapshot a row inside `scoreICP()` | ✅ shipped 2026-05-20 | Everything — without the ledger the judge has nothing to learn from |
| **2** | Outcome-derivation worker job (§5), weighted 3-signal scoring — `apps/worker/src/workers/mindOutcomes.mjs`, daily 03:30 UTC | ✅ shipped 2026-05-20 | Resolved episodes |
| **3** | Calibration-gap metric — `GET /api/mind/calibration` + a CALIBRATION readout on `Mind.tsx` | ✅ shipped 2026-05-20 | Visible proof the loop works |
| **4a** | The evidence set — `lead_lists` + `leads` tables & Lead Lists section, plain-English ICP field, reply classifier + graduation flow | next | Labeled training data exists |
| **4b** | The Scorecard — `scorecard_signals` weighted table; the fit score sums signal weights | — | Explainable, decomposable scores |
| **4c** | The learning loop — nightly `propose → test → keep or drop`, two-gate review | — | The compounding loop closes |
| **5** | `/goal` external runtime + `run_goal` MCP tool | — | Agents can drive judged loops |

Phases 1–3 built the plumbing; Phase 4 — **Adaptive Lead Scoring** — is where the
Mind starts to compound. It is specified in full in its own doc:
**`adaptive-lead-scoring.md`**. Phase 4a is the unblocker — without labeled
leads and a point-in-time feature snapshot, 4b and 4c have nothing to train on.

> **Implementation note (§4.1):** `outcome_pipeline_from` is written by
> `scoreICP()` at *prediction* time (the stage baseline), not by the outcome
> job. The outcome job fills the remaining `outcome_*` columns.

---

## 11. Phase 4 — Adaptive Lead Scoring

Phase 4 is large enough to have its own spec. It supersedes the Phase-4 sketch
in §6. See **`adaptive-lead-scoring.md`** for the full design — Lead Lists, the
Scorecard, and the nightly learning loop.

In short: a workspace's lead lists become labeled evidence; a **Scorecard** of
weighted signals turns each lead into a 0–100 number; and a nightly
`propose → test → keep or drop` loop rewrites the Scorecard from the replies
that actually came back, behind two gates (accuracy + carry-over). The user
states the target once as a plain-English ICP; the loop corrects and extends it
from there.

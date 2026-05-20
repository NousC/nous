# The Mind

The Mind is Nous's self-improving scoring layer. It records every ICP score the system produces, joins each one to what the contact actually did afterward, and measures how well the scores held up. That evidence is what lets scoring improve over time instead of staying a fixed set of rules.

This document covers what is built today: the prediction ledger, outcome resolution, and the calibration metric. Where the scoring engine itself is heading — a self-revising Scorecard — is covered in `adaptive-lead-scoring.md`.

---

## The prediction ledger

**Source:** `apps/api/src/services/enrichment.mjs` (`scoreICP`)

Every time a contact is ICP-scored, a row is written to `mind_episodes` — a snapshot of the prediction, frozen at the moment it was made.

| Column | Holds |
|--------|-------|
| `predicted_score` / `predicted_fit` / `predicted_reason` | The score, the fit verdict, and the one-line reason |
| `basis_memory_ids` | The exact `workspace_memories` rows that fed the score |
| `outcome_pipeline_from` | The contact's pipeline stage at scoring time — the baseline for measuring later movement |
| `model` | The model that produced the score |
| `predicted_at` | When the prediction was made |

`basis_memory_ids` makes a prediction traceable: a later review can see exactly which facts produced a given score. The snapshot is non-fatal — if the ledger write fails, scoring still completes. The `outcome_*` columns are left empty here and filled in later by outcome resolution.

---

## Outcome resolution

**Source:** `apps/worker/src/workers/mindOutcomes.mjs` — daily cron, 03:30 UTC

A nightly job joins each prediction to what actually happened. For every episode whose outcome is still open, it derives three signals from `contact_activity_log` and the contact's current state, and writes a single weighted `outcome_score` between 0 and 1:

| Signal | Weight | Source |
|--------|--------|--------|
| Reply | 0.25 | Any reply or positive engagement within the observation window |
| Pipeline advancement | 0.35 | Stage movement up from `outcome_pipeline_from` |
| Closed-won revenue | 0.40 | A won deal recorded after the prediction |

Resolution is two-tier. An episode resolves when revenue lands or when its observation window (default 30 days) elapses — whichever comes first. An episode resolved on early signal alone (reply, pipeline) still has its `outcome_score` upgraded if revenue arrives later, within 120 days of the prediction.

---

## The calibration metric

**Source:** `apps/api/src/routes/api/mind.mjs` — `GET /api/mind/calibration`

The calibration gap is the single measure of whether scoring is any good:

```
gap = avg(outcome_score | predicted_score >= 70)
    − avg(outcome_score | predicted_score <  70)
```

A well-calibrated score is high for the contacts who go on to convert and low for those who do not, so the gap is large and positive. The endpoint returns the gap, both cohorts, the open and resolved episode counts, and a gap-per-week trend. The Mind page shows it as a `CALIBRATION` readout — `—` until enough episodes resolve, then a signed value.

---

## What this enables

Recording predictions and measuring them is the groundwork. The next stage uses this evidence to rewrite the scoring engine itself — replacing fixed ICP scoring with a deterministic **Scorecard** that revises its own weights from outcomes. That is specified in `adaptive-lead-scoring.md`.

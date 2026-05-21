# The Mind

The Mind is the layer that makes Nous's scoring improve on its own. Every time the system scores a contact it records the prediction; later it checks that prediction against what the contact actually did; and it uses the gap between the two to sharpen how it scores next time. Memory stores what is true about an account — the Mind learns what *predicts*.

---

## Why it exists

Most CRM data is a snapshot: it records the state of an account right now and stops there. An ICP score written that way is a guess that never gets graded — it can be confidently wrong for months and nothing notices.

The Mind closes that gap. It treats every score as a prediction with a consequence: the contact either converts or it doesn't. By recording the prediction and resolving it against the real outcome, the system gets a continuous, honest measure of how good its scoring actually is — and the evidence to improve it. A model that learns from outcomes beats one that only stores rules, because rules go stale and outcomes don't lie.

---

## How it works

The Mind is a loop with four steps:

1. **Score** — a contact is scored for ICP fit. The scoring model is the Scorecard (see `adaptive-lead-scoring.md`).
2. **Record** — the prediction is snapshotted to the `mind_episodes` ledger.
3. **Resolve** — a nightly job joins the prediction to what actually happened.
4. **Refine** — the calibration metric reports whether scoring is working, and the learning loop revises the model from the resolved evidence.

The rest of this document covers steps 2–4. Step 1 — the model itself — is `adaptive-lead-scoring.md`.

---

## The prediction ledger

**Source:** the `mind_episodes` table; written by `scoreICP` in `apps/api/src/services/enrichment.mjs`

Every ICP score writes one row to `mind_episodes` — the prediction, frozen at the moment it was made.

| Column | Holds |
|--------|-------|
| `predicted_score` / `predicted_fit` | The 0–100 score and the fit verdict |
| `features` | The contact's attribute snapshot at scoring time — what the learning loop later re-scores against |
| `outcome_pipeline_from` | The contact's pipeline stage when scored — the baseline for measuring later movement |
| `model` | What produced the score: `scorecard`, or the fallback model |
| `predicted_at` | When the prediction was made |

The snapshot is point-in-time and never rewritten — "what was true when we scored" must not drift, or the loop would learn from the future. The write is non-fatal: if it fails, scoring still completes. The `outcome_*` columns are left empty here and filled in by outcome resolution.

---

## Outcome resolution

**Source:** `apps/worker/src/workers/mindOutcomes.mjs` — nightly, 03:30 UTC

A nightly job joins each open prediction to what the contact actually did. It derives three signals from the activity log and the contact's current state and writes one weighted `outcome_score` between 0 and 1:

| Signal | Weight | What it measures |
|--------|--------|------------------|
| Reply | 0.25 | A reply or positive engagement after the prediction |
| Pipeline advancement | 0.35 | Movement up from `outcome_pipeline_from` |
| Closed-won revenue | 0.40 | A won deal recorded after the prediction |

Resolution is two-tier. An episode resolves when revenue lands or when its 30-day window elapses — whichever comes first. An episode resolved on early signal alone still has its `outcome_score` upgraded if revenue arrives later, within 120 days of the prediction — so a slow-closing deal is not lost to the model.

---

## Calibration

**Source:** `apps/api/src/routes/api/mind.mjs` — `GET /api/mind/calibration`

Calibration is the single number that says whether scoring works:

```
gap = avg(outcome_score | predicted_score ≥ 70)
    − avg(outcome_score | predicted_score < 70)
```

A well-calibrated score is high for the contacts who go on to convert and low for those who don't — so the gap is large and positive. A gap near zero means the score has no predictive power; a negative gap means it is backwards. The endpoint returns the gap, both cohorts, the resolved and open episode counts, and a gap-by-week trend.

---

## The Scorecard

The model that produces each score — and the thing the learning loop refines from the resolved evidence — is the **Scorecard**: a list of weighted signals, rewritten nightly. It has its own document: `adaptive-lead-scoring.md`.

---

## Where you see it

**Source:** `apps/frontend/src/pages/Intelligence.tsx` — the Intelligence page, `/intelligence`

The Intelligence page is the workspace's view of the Mind: the calibration figure, the current Scorecard, the history of learning runs, and the Memory the Mind reasons over.

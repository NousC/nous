# Adaptive Lead Scoring

Adaptive Lead Scoring is the model behind every ICP score. Instead of a fixed set of rules, Nous keeps a **Scorecard** — a short list of weighted signals — and rewrites it every night from real outcomes. It starts from a workspace's stated ICP and gets sharper with each resolved prediction.

This document covers the scoring model and the loop that refines it. The feedback loop it plugs into — how predictions are recorded and graded — is `compound-intelligence-mind.md`.

---

## Why a Scorecard, not a fixed rule set

An ICP written by hand is a hypothesis, and it has two problems. It goes **stale** — the market it described last quarter has moved. And it is **one-sided** — a description of an ideal customer only ever lists reasons to say *yes*, so it cannot separate a likely buyer from an unlikely one. Everything looks good.

A Scorecard fixes both. It is scored from evidence rather than opinion, so it tracks reality as reality changes. And the learning loop is free to add **negative** signals — the reasons an account will *not* convert — which is where real separation comes from. The honest gains come from what the Scorecard learns to rule out.

---

## The Scorecard

**Source:** the `scorecard_signals` table; `packages/core/src/db/scorecard.ts`

The Scorecard is a list of weighted signals:

| Field | Meaning |
|-------|---------|
| `key` | Short identifier — e.g. `recent_funding`, `senior_title` |
| `label` | A plain sentence a human can read |
| `weight` | A positive or negative integer — the score contribution |
| `rule` | How the signal fires against a contact's feature snapshot |
| `coverage` | How many scored contacts it fired on — recomputed every run |
| `active` | Whether it currently counts toward the score |

A contact's score is arithmetic: the sum of the weights of every active signal whose `rule` fires on its features, rescaled to 0–100. There is no model call, so the score is fully decomposable — it can always be traced to the exact signals that produced it. The Scorecard is capped at twelve active signals, which forces the loop to replace weak signals rather than only add new ones.

---

## How a contact is scored

**Source:** `scoreICP` in `apps/api/src/services/enrichment.mjs`

ICP scoring runs after a contact is enriched. It builds the contact's feature snapshot — job title, seniority, department, company, industry, employee count, country — and then:

- **If the workspace has a Scorecard**, the score is the deterministic Scorecard sum described above.
- **If it does not yet**, scoring falls back to a model reading the workspace's ICP memory directly — the original behaviour, documented in `icp-scoring-and-enrichment.md`.

Either way the score, the feature snapshot, and which path produced it are recorded to the prediction ledger (`compound-intelligence-mind.md`).

---

## Seeding from your ICP

**Source:** `apps/api/src/routes/api/mind.mjs` — `POST /api/mind/scorecard/seed`

A Scorecard has to start somewhere, and that somewhere is **Memory**. A workspace's ICP is not a separate field — it is the `ICP`, `Market`, `Product`, `Pricing`, and `Competitors` facts a user has written into Memory. Seeding gathers those facts and translates them into a starting Scorecard.

The seed is deliberately one-sided: it only describes the ideal customer, in positive signals. Separation — the negative signals — comes later, from the loop.

---

## The learning loop

**Source:** `apps/worker/src/workers/scorecardLoop.mjs` — nightly, 04:00 UTC

Each night, per workspace, the loop refines the Scorecard one change at a time. It trains on resolved predictions — real contacts whose outcomes are now known. Each step:

1. **Propose** — a model reviews the predictions the current Scorecard got wrong and proposes one change: add a signal, reweight one, or remove one.
2. **Test** — the change is scored against a held-back, time-split slice of the evidence that the proposer never saw.
3. **Keep or drop** — the change ships only if it clears both gates.

The run continues, change by change, until the calibration gap clears the run's target or the step budget is spent. Every run is recorded in the `scorecard_runs` table — date, gap before and after, and a one-line note on what it found — so the history of how the model learned is auditable.

---

## The two gates

A proposed change reaches the live Scorecard only if it clears both:

| Gate | Question it answers |
|------|---------------------|
| Accuracy | Did the calibration gap on the held-back slice go up? |
| Carry-over | Would the change hold for accounts beyond that slice, or is it overfit? |

The accuracy gate stops changes that don't help. The carry-over gate stops changes that help only on the data they were learned from. A change has to pass both — measured improvement *and* judged generalization — before it touches the model that scores live contacts.

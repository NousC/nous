# Adaptive Lead Scoring

Adaptive Lead Scoring turns a workspace's outreach into a model that improves itself. Lead lists become labeled evidence, a **Scorecard** of weighted signals turns each lead into a 0–100 number, and a nightly loop rewrites the Scorecard from the replies that came back. The user states the target once in plain English; every change after that is the system correcting itself.

> Design reference — describes intended behavior; the feature is not yet built. Phases 1–3 of the Mind (the `mind_episodes` ledger, outcome resolution, the calibration metric) are shipped and documented in `compound-intelligence-mind.md`.

---

## Lead lists and people

Leads and people are stored separately, on purpose.

A **lead** is someone in the outreach universe before any back-and-forth — a name on an imported or scraped list. A **person** (a `contacts` row) is someone who has interacted: a reply, a meeting, a thread. A cold list of 10,000 leads must not swell the People table, and a lead carries outreach fields — which list, which send, which copy variant — that have no place on a contact record.

| Table | Holds |
|-------|-------|
| `lead_lists` | One row per list / campaign — `name`, `source`, workspace |
| `leads` | One row per lead — identity, send record, feature snapshot, score, reply outcome, `contact_id` |
| `lead_suppressions` | Addresses that asked not to be contacted again |

The `leads` table is the evidence set: each row carries a prediction (the Scorecard score) and, once a reply lands, a label (the reply outcome).

---

## The reply flow

**Source:** `apps/worker/src/workers/leadReplies.mjs` *(planned)*

When an inbound message arrives (Instantly, LinkedIn, Gmail), identity resolution checks both `leads` and `contacts`:

| Match | Result |
|-------|--------|
| Sender matches a lead | The reply is classified and recorded on the lead; a `contacts` row is created in People and linked via `leads.contact_id`; the reply is logged as activity on that person |
| Sender matches no lead | Handled as an ordinary inbound contact; no lead list is touched |

A human reply — interested, an objection, or an unsubscribe — creates a person, because a reply is an interaction. A bounce or silence updates the lead only. An unsubscribe also writes to `lead_suppressions`.

A single human can exist in both stores: the lead row is the permanent record of the campaign that first reached them; the person row is the live relationship.

---

## The Scorecard

The Scorecard turns a lead into a number. It is a list of weighted **signals**:

| Field | Meaning |
|-------|---------|
| `key` | Short identifier — `recent_funding`, `repeat_contact`, `role_inbox` |
| `label` | A plain sentence a human can read |
| `weight` | A positive or negative integer — the score contribution |
| `rule` | How the signal fires against a feature snapshot |
| `coverage` | How many leads it fired on (recomputed each run) |
| `active` | Whether it currently counts |

A lead's score is the sum of the weights of every signal whose `rule` fires on its feature snapshot, rescaled to 0–100:

```
raw   = sum of weights of signals whose rule fires on the lead's features
score = clamp(0, 100, rescale(raw))
```

Scoring is arithmetic — there is no model call per lead — so a score always decomposes into the exact signals and weights that produced it. The Scorecard has a **size limit** of 12 active signals, which forces the loop to replace weak signals rather than only add new ones. The same Scorecard scores leads (predicting who will reply) and people (the fit score from Phases 1–3).

---

## Seeding the Scorecard

A Scorecard cannot be learned from an empty evidence set, so the first version comes from the user.

The **ICP** is the user's stated target, written once in a plain-text field — *"VP and Director of RevOps at B2B SaaS companies, 50–500 employees, US, funded in the last year."* The **Scorecard** is the working model translated from it. The user owns the ICP; the Mind owns the Scorecard.

| Stage | State |
|-------|-------|
| Stated | The user writes the ICP; a model translates it into a starting Scorecard — every signal positive, because an ideal-customer description only lists reasons to say yes |
| Untested | Leads score, but the calibration gap sits near zero — the Scorecard cannot separate repliers from non-repliers yet |
| Corrected | Replies come back; the loop reweights the stated signals and adds the negative ones a person would not think to write down |

A wrong starting point is acceptable — correcting it is the loop's job.

---

## The learning loop

**Source:** `apps/worker/src/workers/scorecardLoop.mjs` *(planned)*

A nightly worker run improves the Scorecard one change at a time. Each step:

| Step | Action |
|------|--------|
| Propose | A model reviews the leads the Scorecard scored wrong — high scores that never replied, low scores that did — and suggests one change: add a signal, reweight one, or remove one |
| Test | The candidate change is scored against the held-back set |
| Keep or drop | The change ships only if it clears both gates |

The run continues, change by change, until the calibration gap on the held-back set clears the run's target or the step budget is spent. Each run is recorded in `scorecard_runs` — date, target, step count, calibration gap before and after, signal count, and a one-line note on what it found.

A Scorecard built from an ICP grows one-sided: it accumulates reasons to say yes, because adding an inclusion feels productive while naming an exclusion feels like admitting the list is weak. A Scorecard sharpens by what it rules out — the compounding gains come from the negative signals.

---

## The two gates

A proposed change must clear two independent checks before it ships.

| Gate | Question | Type |
|------|----------|------|
| Accuracy | Did the calibration gap on the held-back set go up? | Arithmetic |
| Carry-over | Would the signal still hold for a campaign not yet run? | Model judgment |

The accuracy gate stops changes that do not help. The carry-over gate stops changes that help only on the list they were learned from — a signal that fits the past perfectly and predicts nothing about the next campaign. Where a second lead list exists, the carry-over gate re-tests the signal against it directly.

---

## The held-back set and feature snapshots

**The held-back set.** Before a run, the evidence set is split by time: older sends train, the most recent sends are held back and never shown to the proposer. The calibration gap is measured on the held-back slice — the honest test is whether the Scorecard predicts the *next* campaign, and only a time split asks it.

**Feature snapshots.** Signals fire on a lead's feature snapshot — funding recency, seniority, location, repeat-contact, hiring activity. The snapshot is frozen on the `leads` row at send time. "Funded recently" means *when the message was sent*; recomputing it later would score the lead on facts from after the prediction.

**Coverage.** A signal that fired on a handful of leads is thin evidence. The loop discounts low-coverage signals and requires a minimum number of leads behind any change.

---

## Example

A workspace selling a RevOps tool imports a 600-lead list and runs a campaign. Its ICP: *"VP/Director of RevOps at B2B SaaS, 50–500 employees, US, funded in the last year."*

The seed Scorecard, translated from the ICP, holds three positive signals:

| Signal | Weight | Coverage |
|--------|--------|----------|
| `recent_funding` | +5 | 31 |
| `senior_revops_title` | +4 | 44 |
| `hiring_sales_roles` | +3 | 22 |

Calibration gap: **0.04** — almost no separation, because every lead the ICP describes looks good.

The first learning run reviews high-scoring leads that never replied and finds two patterns: leads contacted in an earlier campaign, and messages sent to role inboxes rather than a person. It adds two negative signals:

| Signal | Weight | Coverage |
|--------|--------|----------|
| `repeat_contact` | −6 | 18 |
| `role_inbox` | −5 | 11 |

The held-back calibration gap rises to **0.17**; both gates pass.

The second run finds role-inbox leads replied with interest 0 times out of 11 — a bucket that lands entirely on one outcome — and that agency and reseller companies returned `wrong_fit` every time. It adds `agency_company` at −4. The held-back gap rises to **0.24**.

The Scorecard now has six signals, three positive and three negative, and separates repliers from non-repliers — found on its own, from one campaign's replies, in two nightly runs.

---

## Data model

New tables:

| Table | Columns |
|-------|---------|
| `lead_lists` | `id, workspace_id, name, source, created_at` |
| `leads` | `id, lead_list_id, workspace_id, email, name, company, linkedin_url, sent_at, send_variant, is_repeat_contact, features, scorecard_score, reply_outcome, replied_at, status, contact_id, created_at` |
| `lead_suppressions` | `id, workspace_id, email, reason, created_at` |
| `scorecard_signals` | `id, workspace_id, key, label, weight, rule, coverage, added_in, active, created_at, updated_at` |
| `scorecard_runs` | `id, workspace_id, target, steps, gap_before, gap_after, signal_count, note, created_at` |

Changed: `workspaces` gains `icp_text` — the plain-English ICP field.

`reply_outcome` values: `interested`, `objection`, `wrong_fit`, `unsubscribe`. The `mind_episodes` table from Phases 1–3 is unchanged — it remains the People-side fit-score ledger.

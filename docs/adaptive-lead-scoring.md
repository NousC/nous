# Adaptive Lead Scoring

> Status: **design** (not yet implemented). This is the detailed spec for
> Phase 4 of the Mind. For Phases 1–3 and the broader feedback-loop rationale,
> see `compound-intelligence-mind.md`.

Nous can already record a prediction and resolve its outcome (Phases 1–3).
Adaptive Lead Scoring is what turns that record into a model that improves on
its own: a workspace's lead lists become labeled evidence, a **Scorecard** of
weighted signals turns each lead into a number, and a nightly loop rewrites the
Scorecard from what actually happened. The user states a target once in plain
English; everything after that is the system correcting itself.

---

## 1. Two stores — Lead Lists and People

Nous keeps **leads** and **people** in two separate tables, on purpose.

- **A lead** is someone in the outreach universe *before* any back-and-forth —
  a name on a list you bought, scraped, or exported. A list of 10,000 of them
  is normal. Leads live in their own table and never touch the contacts table.
- **A person** (a `contacts` row) is someone you have actually interacted
  with — there is a reply, a meeting, a thread.

Keeping them apart matters. A cold list of 10,000 names must not swell the
People table or the counts on the Mind page, and a lead carries outreach
fields — which list, which send, which copy variant, whether it is a repeat
contact — that have no place on a contact record.

**Tables**

- `lead_lists` — the list itself: `name`, `source` (`linkedin`, `instantly`,
  `csv`, `apollo`, …), workspace, timestamps. A list is the unit of a campaign.
- `leads` — one row per lead, belongs to a `lead_list`. Holds identity (email,
  name, company, LinkedIn), the send record (`sent_at`, `send_variant`,
  `is_repeat_contact`), a frozen **feature snapshot**, the **Scorecard score**,
  the **reply outcome**, and a nullable `contact_id` that stays empty until the
  lead becomes a person.
- `lead_suppressions` — addresses that asked not to be contacted again.

**The leads table is the evidence set.** Each row carries a prediction (the
Scorecard score) and, once a reply lands, a label (the reply outcome) — a
complete training example on one row. The loop reads nothing else.

---

## 2. The reply flow — a lead becomes a person

A lead stays a lead until someone replies. When an inbound message arrives
(Instantly, LinkedIn, Gmail), identity resolution checks both tables:

1. **The sender matches a lead.**
   - Update the lead: classify the reply, set `replied_at`, mark it answered.
   - Create a `contacts` row in People and link it back via `leads.contact_id`.
   - Log the reply as activity on that new person.
   - The lead now carries a label — it has joined the evidence set.
2. **The sender matches no lead.** Handle it as an ordinary inbound contact.
   Nothing is written to any lead list.

A real human reply — interested, an objection, even an unsubscribe — counts as
contact and creates a person, because a reply is an interaction. A bounce or
silence does not; it only updates the lead. An unsubscribe additionally writes
to `lead_suppressions`.

So a single human can exist in both stores at once: the lead row is the
permanent record of the campaign that first reached them; the person row is the
live relationship. One is history, the other is the present.

---

## 3. The Scorecard

The **Scorecard** is how a lead becomes a number. It is a short list of
weighted **signals**:

```
key          'recent_funding', 'repeat_contact', 'role_inbox'
label        a plain sentence a human can read
weight       a positive or negative integer — the score contribution
rule         how the signal fires on a feature snapshot,
               e.g. { feature: 'months_since_funding', op: '<=', value: 6 }
coverage     how many leads it fired on (recomputed every run)
added_in     the learning run that introduced or last changed it
active       whether it currently counts
```

A lead's score is the **sum of the weights of every signal whose rule fires on
its feature snapshot**, rescaled to 0–100. Scoring is plain arithmetic — no
model call per lead. That keeps it cheap, and it keeps it *explainable*: a
score can always be unpacked into the exact signals and weights that produced
it. The Scorecard has a **size limit** (start at 12 active signals) so the loop
is forced to replace weak signals rather than pile new ones on forever.

The same Scorecard scores both leads (to predict who will reply) and people
(the Phase 1–3 fit score) — one model, two audiences.

---

## 4. Seeding the Scorecard — the first version

A model cannot learn from an empty evidence set, so the user provides the first
version. Two things are distinct:

- The **ICP** is the user's stated target, written once in plain English:
  *"VP and Director of RevOps at B2B SaaS companies, 50–500 employees, US, that
  raised a round in the last year."* The user owns this.
- The **Scorecard** is the machine's working model. It begins as a translation
  of the ICP and then grows past it. The Mind owns this.

It comes up in three stages:

1. **Stated.** The user types the ICP into a plain-text field. A model
   translates it into a starting Scorecard — and every starting signal is
   *positive*, because a description of an ideal customer only ever lists
   reasons to say yes.
2. **Untested.** With only that Scorecard, leads still get scored, but the
   calibration gap sits near zero — it cannot separate repliers from
   non-repliers yet, because it has nothing that says *no*.
3. **Corrected.** Once replies come back, the loop reweights the stated signals
   and discovers the negative ones a person would never think to write down.

The user never has to get the ICP right. A rough, even wrong, starting point is
fine — fixing it is the loop's whole job.

---

## 5. The learning loop — propose → test → keep or drop

Once an evidence set exists, a nightly worker run improves the Scorecard one
change at a time. Each step:

1. **Propose.** A model reviews the leads the Scorecard got *wrong* — high
   scores that never replied, low scores that did — and suggests exactly one
   change: add a signal, reweight one, or remove one.
2. **Test.** Before the run, the evidence set is split: older sends are the
   training slice, the most recent sends are **held back** and never shown to
   the proposer. The candidate change is scored against the held-back slice.
3. **Keep or drop.** The change ships only if it passes **both gates** (§6).
   A kept change is written to the Scorecard; the run continues, change by
   change, until the calibration gap on the held-back set clears the run's
   target or the step budget runs out.

Every run is recorded — date, target, number of steps, calibration gap before
and after, signal count, and a one-line note on what it found. That record is
the visible history of how the Mind learned, run by run.

**The core habit:** a Scorecard built from an ICP grows one-sided. It
accumulates reasons to say yes, because adding an inclusion feels productive,
while naming an exclusion feels like admitting the list is bad. A Scorecard
**sharpens by what it rules out** — the compounding gains come from the
negative signals.

---

## 6. The two gates

A proposed change must clear two independent checks before it ships.

- **Accuracy gate** — pure arithmetic. Did the calibration gap on the held-back
  set go *up*? If a change does not separate repliers from non-repliers better
  on leads the proposer never saw, it is dropped, no discussion.
- **Carry-over gate** — judgment. A model reviewer asks whether the signal
  would still hold for a campaign that has not been run yet, or whether it is
  an artifact of this one list. Where a second lead list exists, the signal is
  re-tested against it directly.

Both must pass. The accuracy gate stops changes that do not help; the carry-over
gate stops changes that help *only here* — a signal that fits the past list
perfectly and predicts nothing about the next one.

---

## 7. What the loop quietly depends on

Pieces that are easy to miss but the loop does not work without:

- **The reply classifier.** Raw replies become outcomes — `interested`,
  `objection`, `wrong_fit`, `unsubscribe` — with automatic out-of-office and
  bounce messages filtered out first so they never pollute the evidence set.
- **Point-in-time features.** Signals fire on a lead's feature snapshot
  (funding recency, seniority, location, repeat-contact, hiring activity…). The
  snapshot must be **frozen on the lead row at send time**. "Raised recently"
  has to mean *when the email went out* — recomputing it later trains the loop
  on facts from after the prediction.
- **Coverage weighting.** A signal that fired on six leads is thin evidence.
  The loop must discount low-coverage signals and require a minimum number of
  leads behind any change.
- **A time-based split.** The held-back slice is the *most recent* sends, not a
  random sample. The honest question is "does this predict the next campaign,"
  and only a time split asks it.
- **Cross-list carry-over.** The strongest version of the carry-over gate: a
  signal learned on one list is confirmed on a different one.
- **A graceful cold start.** The first campaign has no negative signals and a
  near-zero calibration gap. The loop must degrade cleanly to the stated
  Scorecard until there is enough evidence.
- **A prescriptive output.** The Scorecard should drive a *next-best-leads*
  view — who to contact, who to skip, what to change next campaign — not just
  report a number.

---

## 8. Worked example

A workspace sells a RevOps tool. Its ICP: *"VP/Director of RevOps at B2B SaaS,
50–500 employees, US, funded in the last year."* It imports a 600-lead list and
runs a campaign.

**Seed Scorecard** (translated from the ICP — all positive):

| Signal | Weight | Coverage | Added | Reads as |
|---|---|---|---|---|
| `recent_funding` | +5 | 31 | seed | Raised a round in the last 6 months |
| `senior_revops_title` | +4 | 44 | seed | VP or Director of RevOps / Sales Ops |
| `hiring_sales_roles` | +3 | 22 | seed | Has open SDR or AE postings now |

Calibration gap: **0.04**. Almost no separation — every lead the ICP describes
"looks good," so the Scorecard cannot tell a replier from a non-replier.

**Learning run 1** (target ≥ 0.15). The proposer looks at leads that scored
high and never answered. Two patterns dominate: leads that were already
contacted in an earlier campaign, and messages sent to role inboxes
(`sales@`, `info@`) rather than a person. It adds two negative signals:

| Signal | Weight | Coverage | Added | Reads as |
|---|---|---|---|---|
| `repeat_contact` | −6 | 18 | run 1 | Contacted in a previous campaign |
| `role_inbox` | −5 | 11 | run 1 | Address is a shared inbox, not a person |

Held-back calibration gap rises to **0.17**. Both gates pass. *Note: the seed
had only reasons to say yes; the first real gain was naming two reasons to say
no.*

**Learning run 2** (target ≥ 0.20). Role inboxes turn out to be a clean case —
0 of 11 replied with interest. A bucket that lands entirely on one outcome is
the cheapest strong signal a Scorecard can hold. The proposer also finds that
leads at agencies and resellers answered `wrong_fit` every time, and adds:

| Signal | Weight | Coverage | Added | Reads as |
|---|---|---|---|---|
| `agency_company` | −4 | 7 | run 2 | Company is an agency or reseller |

Held-back calibration gap rises to **0.24** — past target. Six signals, three
positive and three negative, against a size limit of 12.

The Scorecard now separates. It can say not just who fits the profile, but who
will actually reply — and it found that on its own, from one campaign's
replies, in two nightly runs.

---

## 9. Data model summary

New:

- `lead_lists` — `id, workspace_id, name, source, created_at`
- `leads` — `id, lead_list_id, workspace_id, email, name, company,
  linkedin_url, sent_at, send_variant, is_repeat_contact, features (jsonb),
  scorecard_score, reply_outcome, replied_at, status, contact_id, created_at`
- `lead_suppressions` — `id, workspace_id, email, reason, created_at`
- `scorecard_signals` — `id, workspace_id, key, label, weight, rule (jsonb),
  coverage, added_in, active, created_at, updated_at`
- `scorecard_runs` — `id, workspace_id, target, steps, gap_before, gap_after,
  signal_count, note, created_at`

Changed:

- `workspaces` — add `icp_text` (the plain-English ICP field)

`mind_episodes` (Phases 1–3) is untouched; it stays as the People-side fit-score
ledger.

---

## 10. Build steps

Phase 4 ships in three parts; Phase 4a comes first because the loop and the
Scorecard have nothing to train against until the evidence set exists.

**4a — the evidence set**

| Step | Deliverable |
|---|---|
| 4a.1 | Migration (`lead_lists`, `leads`, `lead_suppressions`, `workspaces.icp_text`) + a `packages/core` DB module |
| 4a.2 | `/api/lead-lists` — create lists, import leads, list/get; ICP-field get/set |
| 4a.3 | Reply classifier + the graduation flow, wired into inbound ingestion |
| 4a.4 | Lead Lists section on the Mind page + the plain-English ICP field |

**4b — the Scorecard**

`scorecard_signals` table; translate `icp_text` into the seed Scorecard; rewrite
the fit score to sum signal weights against each lead's feature snapshot.

**4c — the learning loop**

The nightly `propose → test → keep or drop` run: the held-back split, the two
gates, `scorecard_runs` logging, the next-best-leads view.

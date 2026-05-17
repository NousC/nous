# Deal Health Score

The deal health score is a 0–100 signal indicating how likely an active deal is to close. It is computed from up to 13 signals drawn from activity history, proposal state, meeting transcripts, and stakeholder coverage.

---

## When it runs

**Source:** `apps/api/src/services/enrichment.mjs:689`

`updateDealHealthScore()` is called after any activity is logged for a contact. It skips recomputation for activity types that only affect the `aware` stage (e.g., `email_opened`, `website_visit`) — only `QUALIFIED_TYPES` (interested + evaluating tier signals) and `proposal_viewed` / `proposal_signed` trigger a recompute.

A **30-second debounce** prevents redundant recomputes when multiple activities arrive in quick succession.

---

## Hard rules (short-circuit)

These are evaluated before any signals are calculated:

| Condition | Result |
|-----------|--------|
| Contact is in `client` stage | Score cleared to `null` |
| Fewer than 2 qualified activities total | Score set to `null` (insufficient data) |
| Latest proposal status is `fully_signed` | Score set to `100` |

---

## The 13 signals

Signals marked **conditional** only contribute to `activeMax` when they are applicable to the contact. A contact without meeting transcripts is not penalized for missing S8/S9 — the score is normalized against what's actually observable.

### S1 — Proposal lifecycle (max +25, can be −5)

Evaluates the most recent proposal sent to this contact:

| State | Points |
|-------|--------|
| Status is `partially_signed` | +18 |
| Proposal has been viewed | +18 |
| Sent less than 7 days ago, not yet viewed | +10 |
| Sent 7–21 days ago, not yet viewed | +5 |
| Sent 21+ days ago, not yet viewed | −5 (stalling) |
| No proposal | 0 (signal inactive, not added to activeMax) |

### S2 — They engaged back (max 20)

+20 if any activity of type `email_reply`, `linkedin_message`, `outbound_positive_reply`, `proposal_viewed`, or `meeting_held` exists. Measures whether the prospect has taken any action, not just received outreach.

### S3 — Qualified engagement volume, last 30 days (max 20)

Counts all `QUALIFIED_TYPES` activities in the past 30 days:

| Count | Points |
|-------|--------|
| 0 | 0 |
| 1 | 8 |
| 2 | 14 |
| 3+ | 20 |

### S4 — Recency of last qualified activity (max 15)

Days since the most recent `QUALIFIED_TYPES` event:

| Days ago | Points |
|----------|--------|
| < 7 | 15 |
| 7–13 | 10 |
| 14–29 | 5 |
| 30–59 | 2 |
| 60+ | 0 |

### S5 — Stage velocity penalty (max 0, can be −15)

Only fires when S4 = 0 (no recent engagement). Penalizes contacts that have been sitting in the same stage without activity:

| Days in current stage | Penalty |
|-----------------------|---------|
| > 60 days | −15 |
| > 30 days | −10 |
| > 14 days | −5 |
| ≤ 14 days | 0 |

Does not add to `activeMax` — it is a penalty-only signal.

### S6 — Pipeline stage position (max 10)

| Stage | Points |
|-------|--------|
| `evaluating` | 10 |
| `interested` | 6 |
| `aware` | 3 |
| `identified` | 0 |

### S7 — Deal value defined (max 5)

+5 if `deal_value` is set on the contact. Absence of a deal value is treated as missing information, not a negative signal.

### S8 — Meeting quality (max 15, conditional)

*Only active if the contact has at least one `meeting_held` activity with a non-generic transcript summary.*

Scores each meeting transcript for richness, then takes a recency-weighted average (exponential decay with a 60-day half-life):

| Transcript field present | Points per meeting |
|--------------------------|-------------------|
| Any summary | +1 |
| `pain_points` array non-empty | +2 |
| `budget_signal` present | +3 |
| `timeline` present | +2 |
| **Max per meeting** | **8** |

The weighted average is scaled linearly to a 0–15 range.

### S9 — Next steps clarity (max 10, conditional)

*Only active alongside S8 — requires at least one meeting with a transcript.*

Scores the most recent meeting's `action_items` array:

| Action items | Points |
|--------------|--------|
| 2+ | 10 |
| 1 | 5 |
| 0 | 0 |

### S10 — Website revisit (max 5, conditional)

*Only active if the contact has any `website_revisit` activity (signals RB2B is connected and has fired for this contact).*

+5 if a `website_revisit` occurred within the last 30 days. +0 if it exists historically but not recently.

### S11 — Stakeholder coverage (max 15, conditional)

*Only active if the contact has a `company_id`.*

Counts distinct contacts at the same company with any `QUALIFIED_TYPES` activity in the last 60 days:

| Distinct stakeholders | Points |
|-----------------------|--------|
| 1 | 5 |
| 2 | 10 |
| 3+ | 15 |

### S12 — Decision-maker engagement (max 15, conditional)

*Only active if the contact has a `seniority` value.*

Decision-maker seniority levels: `c_suite`, `vp`, `director`.

| Scenario | Points |
|----------|--------|
| Contact IS a DM and has engaged back (S2 = true) | 15 |
| Contact is IC/manager AND a C-suite or VP at the same company has had qualified activity in the last 60 days | 15 |
| Contact is IC/manager, no senior contact at company | 0 |
| Contact is DM but has not engaged back | 0 |

### S13 — Competitive risk (max 0, can be −15, conditional)

*Only active if there are meeting transcripts within the last 60 days.*

Counts distinct competitors mentioned with `confidence >= 0.7` across recent transcripts:

| Competitors mentioned | Penalty |
|-----------------------|---------|
| 0 | 0 |
| 1 | −10 |
| 2+ | −15 |

Does not add to `activeMax`.

---

## Final calculation

```
netRaw    = sum of positive signals + sum of penalties
score     = clamp(0, 100, round(netRaw / activeMax * 100))
completeness = activeMax / 155   (155 = theoretical max if all signals active)
```

`activeMax` is the sum of the max-point values for only the signals that were applicable and active for this contact. This means a score of 80 from a contact with only basic data is not directly comparable to a score of 80 from a contact with transcripts, multi-stakeholder coverage, and RB2B wired — use `completeness` (stored in `deal_health_breakdown.completeness`) to interpret confidence.

The full breakdown per signal is stored in `contacts.deal_health_breakdown` as JSON, alongside `deal_health_active_max` and `deal_health_computed_at`.

---

## Company-level score

**Source:** `apps/api/src/services/enrichment.mjs:988`

After each contact score is written, `updateCompanyDealHealthScore()` aggregates scores across all non-`client` contacts at the same company using a **seniority-weighted average**:

| Seniority / title | Weight |
|-------------------|--------|
| C-suite, Founder, Owner, President | 3 |
| VP, Director, Head of | 2 |
| Everyone else | 1 |

A disengaged executive drags the company score down even if a champion contact looks healthy. Contacts with `null` deal health scores are excluded from the average.

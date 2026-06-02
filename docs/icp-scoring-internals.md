# ICP scoring internals — enrichment, the Scorecard, and the Mind loop

The deep-dive behind [The ICP Model & GTM Context](./icp-and-gtm-context.md)
(the start-here overview). Three layers: how a contact gets **enriched**, how the
**Scorecard** turns that into a score, and how the **Mind loop** sharpens the
Scorecard from real outcomes. Verified against the code as of 2026-06.

---

## 1. Enrichment — getting the profile data
**Source:** `apps/api/src/services/enrichment.mjs`, `apps/worker/src/utils/enrichContact.mjs`.

Provider priority, evaluated per contact at enrichment time:
1. **Apollo** BYOK — only if connected *and* its "use for enrichment" toggle is on
2. **Prospeo** BYOK — if connected
3. **Nous's platform Prospeo key** — fallback

Apollo calls `POST /v1/people/match`; Prospeo calls `POST /enrich-person`. Both
return job title, seniority, department, phone, city, country, and company info.

**Provenance (recent change — important).** Enriched attributes are written as
**observations tagged with their true source** (`apollo` / `prospeo` / `linkedin`)
via `recordEnrichmentObservations()` (`packages/core/src/db/observations.ts`), and
**stripped from the contact-row update** (the `ENRICH_STRIP` set) so a field's
origin isn't collapsed into the contact's single `source` column. Claims are then
derived from those observations. This is what makes CRM-hygiene's provenance gate
trustworthy — see [CRM Sync](./crm-sync.md). (Older docs that said enrichment
writes straight to the contact row are out of date.)

---

## 2. The Scorecard — features → score
**Source:** `packages/core/src/db/scorecard.ts` (`scoreLead`, signals); learning
loop `apps/worker/src/workers/scorecardLoop.mjs`.

The Scorecard is a short list of **weighted signals** — a transparent sum, no
model call at score time.

- A **signal**: `{ key, label, weight (−10..10), rule, coverage, active }`, where
  `rule = { feature, op (`==` `!=` `>=` `<=` `>` `<` `in` `exists`), value }`.
- **Score**: sum the weights of every active signal whose rule fires on the
  entity's features, then logistic-squash to 0–100: `100 / (1 + exp(−raw/8))`.
- Capped at **12 active signals** — the loop *prunes*, it doesn't only add.
- Seeded from the workspace's stated ICP; refined nightly (§3).

**Features** come from (`packages/core/src/db/predictions.ts` `scoreAndStake`):
the person's claims + the employer's claims (industry, employee_count) +
pipeline-engagement features from the activity log. If none of
{job_title, seniority, department, industry, employee_count} is present, scoring
is **skipped** — no hollow zero that would pollute calibration.

Two places scoring runs, by design:
- **`scoreICP`** (`enrichment.mjs`) — scores right after enrichment and writes
  `icp_score / icp_fit / icp_reasoning` to the contact for **display** (falls back
  to a Claude Haiku read of ICP memories when no Scorecard exists yet).
- **`scoreAndStake`** (`predictions.ts`, run by the `scoreEntities` worker) — the
  **prediction ledger**: stakes a formal `icp_fit` prediction from the entity's
  claims. This is what the Mind loop grades.

---

## 3. The Mind loop — sharpening the Scorecard from outcomes
**Source:** `predictions.ts` (stake), `services/outcomes.ts` (resolve),
`discovery.ts` (discover), `workers/scorecardLoop.mjs` (rewrite),
`workers/mindOutcomes.mjs` (nightly backstop).

Score → **Stake** → **Resolve** → **Discover** → **Re-score**.

**Stake** (`predictions.ts`) — one row per scored entity in the `predictions`
table:
- `predicted_value: { score, fit, reason }`
- `feature_snapshot: { property: { value, confidence } }` — what we knew at bet time
- `model_version` — a fingerprint of the Scorecard used to make the bet

> Note: there is **no** `mind_episodes` table and **no** single weighted
> `outcome_score` — both were superseded by the `predictions` table + structured
> `outcome_value` below.

**Resolve** (`outcomes.ts`) — **event-driven** (fires the moment a qualifying
activity lands), with a nightly backstop:
- **Won** — pipeline reaches `client`, a revenue observation lands, or a
  `deal_won` interaction.
- **Lost** — explicit `deal_lost` / `deal_disqualified` (or timeout past the window).
- **No opportunity** — silence past the window with no revenue path.
- The resolved `outcome_value` is structured —
  `{ replied, pipeline_from, pipeline_to, revenue, score }` — discrete flags, not
  a weighted sum.
- **Late-revenue upgrade** — revenue arriving within the horizon after a bet
  upgrades a closed prediction to `won` and backfills its score.

**Discover + re-score** (`discovery.ts`, `scorecardLoop.mjs`) — nightly per
workspace: contrastive lift over won-vs-lost (≈180-day recency half-life,
volume-weighted confidence, minimum-cohort + generalization gates) proposes **one**
change — add / reweight / remove a signal — tested on a held-back split and kept
only if it improves accuracy and carries over. Then open predictions re-score
under the new Scorecard.

---

For the product-level view, the three feature layers, closed-deal weighting, and
the data model, see [The ICP Model & GTM Context](./icp-and-gtm-context.md).
Forward design: [Rich ICP model](./icp-rich-model.md),
[ICP from closed deals](./icp-from-closed-deals.md).

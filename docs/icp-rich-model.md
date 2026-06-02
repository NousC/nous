# Rich ICP — the whole company *and* the whole deal

**Status:** spec / proposed. **Owner:** GTM Context / the Mind.
**Related:** `docs/icp-from-closed-deals.md` (the contrastive-discovery foundation
this extends), `docs/adaptive-lead-scoring.md`, `docs/compound-intelligence-mind.md`.
Touch points: closed-deals (`/api/mind/closed-deals`), the website extractor
(`apps/api/src/services/websiteSignals.mjs`), scoring (`packages/core/src/db/predictions.ts`,
`scorecard.ts`), the Context page (`apps/frontend/src/pages/Intelligence.tsx`).

---

## 1. The critique we're answering

We shipped "build from closed deals." It reads the won/lost websites, extracts
behavioural signals, and runs contrastive lift. Trying it on one won
(`zevenue.com`) and one lost (`rev-box.com`) exposed that the model is **shallow**:

- It learned `Tech: Claude`, `Tech: Clay`, `pricing_model: enterprise_contact` —
  tool *mentions* on the marketing site — and **nothing about what the company
  actually is**. We never capture industry, size, revenue, geography, or market.
  The one-line "what they do" summary is even extracted by the LLM and then
  **discarded**.
- The closed-deal company is created as a **stranger record**. It is **not**
  linked to the contact we already have at that domain (e.g. `colin@rev-box.com`),
  gets **no** ICP score, and therefore **never appears** in the analyzed table.
- We capture **nothing about the pipeline**: how the lead came in (inbound site,
  outbound Instantly, inbound LinkedIn), how many touches/meetings/discovery
  calls, reply speed, days-to-close. That history is sitting in People; we ignore it.

The founder's instinct (2026-06-01): *a win isn't just who they are, it's how the
deal behaved.* An inbound deal that replied in a day and closed in two calls is a
different ICP than one chased outbound for six months. We're blind to that.

## 2. What stays (loyalty to the existing system)

- **Continuous, native learning.** The Mind already stakes `icp_fit` predictions,
  resolves them on real won/lost events (event-driven, see `services/outcomes.ts`),
  and re-scores open accounts when the model changes (`services/rescore.ts`). We
  enrich the *features*, not the loop.
- **Bet vs. current-fit.** Resolved predictions stay immutable; richer features
  flow into new predictions. No change to that contract.
- **Contrastive lift + small-cohort fallback** (`discoverSignals` /
  `discoverWinnerSignals`) stay as the discovery engines — they just get a far
  richer feature space to work in.

## 3. The model: three layers

A good ICP is the intersection of *who they are*, *how they operate*, and *how
the deal went*. Every feature below is a candidate the discovery engine can find
lift on; none is hand-weighted.

### Layer A — Firmographics (who they are) — MISSING TODAY
- `industry` / `vertical`
- `employee_count` (raw) + `size_band` (1–10, 11–50, 51–200, 201–1k, 1k+)
- `revenue_band`
- `country` / `region` / `hq`
- `funding_stage` (bootstrapped, seed, A, B, C+, public)
- `business_model` (b2b, b2c, b2b2c)
- `what_they_do` — the discarded summary, saved as a claim + embedded for "show me
  more like my winners" retrieval.

### Layer B — Technographics & behavioural (how they operate) — PARTIAL TODAY
- `signal.target_market`, `signal.pricing_model`
- `signal.has_api / has_docs / has_sandbox / self_serve_signup / free_trial`
- `signal.recently_funded`
- `signal.tech.<tool>`, `signal.hiring.<role>`, `signal.compliance.<term>`
- (these already work — keep, but down-rank single-mention `tech.*` noise until
  lift confirms them.)

### Layer C — Pipeline & engagement (how the deal went) — MISSING TODAY
Derived from the account's own activity log (observations), not the website:
- `pipe.lead_source` (inbound_website, inbound_linkedin, outbound_instantly,
  outbound_linkedin, referral, …)
- `pipe.channel_first_touch`, `pipe.inbound` (bool)
- `pipe.n_meetings`, `pipe.n_discovery_calls`, `pipe.n_touches`, `pipe.n_replies`
- `pipe.reply_latency_days` (first outreach → first reply)
- `pipe.days_to_close` (first touch → won/lost)
- `pipe.stage_reached` (the high-water mark)
- `pipe.buyer_seniority` / `pipe.buyer_department` (the role that actually engaged)

These are bucketed into short categoricals/booleans so `discoverSignals` (which
only mines boolean/short-categorical features) can find lift on them — e.g.
"deals that took ≥3 meetings convert 2.1× less", "inbound-website converts 3×".

## 4. Close the loop — the cycle, joined

Today every joint is broken. The target flow for a closed deal:

1. **Identify** — an account is marked closed-lost (or hits `client`/revenue).
2. **Resolve** — the prediction resolves (already event-driven).
3. **Link** — the deal's domain is matched to the contact(s)/company we already
   have (by email domain / existing `works_at`), and reused — never a stranger
   record. This is the "we recognize Colin" step.
4. **Enrich the company** — firmographics + saved summary (Layer A) on the
   *company* entity, shared by every contact at it via `works_at`.
5. **Read the pipeline** — derive Layer-C engagement features from the linked
   account's activity log.
6. **Learn** — the episode now carries A + B + C; contrastive discovery sees the
   full picture, not just website noise.
7. **Surface** — the account appears in the analyzed table with its trail, score,
   and *why* (which firmographic / engagement / tech signals fired).

## 5. Architecture notes (per joint)

- **Linkage.** `getOrCreateEntity` already dedupes by identifier across types, so
  the fix is: before creating a company, look up active contacts whose email
  domain == the deal domain; attach a `works_at` relationship company→those
  people; if a company entity already exists for the domain, reuse it. Then the
  closed-deal episode can read person-level + company-level claims together (the
  way `scoreAndStake` already merges employer claims).
- **Firmographics.** Extend the website-extractor prompt to return
  `industry, size_band, revenue_band, hq_country, funding_stage` and **persist the
  summary** (`signal`-free claim `what_they_do` + embedding). Optionally a hard
  enrichment vendor (Apollo/Clearbit) for size/revenue the site won't state — but
  start with the LLM read; it's free and already running.
- **Pipeline features.** A pure function `pipelineFeatures(activities)` →
  bucketed Layer-C features, computed at scoring time and stored in
  `feature_snapshot` alongside the claim features. Lead source comes from
  observation `source` + first-touch type; counts from grouping the activity log;
  days-to-close from first touch → resolution.
- **Scoring companies / visibility.** Either stake an `icp_fit` prediction on the
  *account* (company + its decision-maker) so closed deals surface in the analyzed
  table, or expand the table to include company-keyed predictions. Keep one score
  per account to avoid double-counting (see the bet-vs-current-fit rule).
- **Feature vocab.** Extend `FEATURE_VOCAB` (mind.mjs) and the discovery
  candidate filter to include Layer-A and Layer-C keys.

## 6. Build order (slices, each independently shippable)

1. **Firmographics + save the summary** — fix the shallow extraction first
   (lowest risk, immediately makes "what is this company" real).
2. **Decision-maker / account linkage** — recognize and reuse the contact/company
   we already have; merge person+company features into the episode.
3. **Pipeline-engagement features** — `pipelineFeatures()` from the activity log
   into the feature space + vocab.
4. **Surface analyzed accounts** — closed deals (company + buyer) show up in the
   table with their firmographic/engagement/tech "why".

## 7. Honest constraints

- **Small-data still bites.** Richer features don't fix 2 deals — they make the
  *winner-extraction fallback* meaningfully better (firmographics + pipeline beat
  random tech mentions), and they make lift discovery far sharper once cohorts
  exist. Keep the "sharpens as more deals close" framing.
- **Don't overfit `tech.*`.** Single-mention tools should need lift confirmation
  before earning weight; the winner-fallback should prefer firmographic +
  engagement candidates over one-off tech names.
- **Enrichment cost.** LLM firmographic read is free-ish (one call already
  happens); a paid vendor is opt-in, not the default.
- **Deferred.** Collapsing the two current-fit stores (`contacts.icp_score` vs
  prediction fit) — tracked separately, not blocking this.

# The ICP Model & GTM Context — how Nous learns who you sell to

**Status:** reference (shipped). **Owner:** GTM Context / the Mind.
**The page:** `apps/frontend/src/pages/Intelligence.tsx` (route `/intelligence`, "Context").
**Deep-dive:** `docs/icp-scoring-internals.md` (enrichment + Scorecard + the Mind loop).
**Specs it implements:** `docs/icp-rich-model.md`, `docs/icp-from-closed-deals.md`.

This is the single overview of two intertwined features: the **GTM Context**
(what your agents know about your business) and the **ICP model** (a scoring
engine that learns who actually buys, from your real outcomes, and keeps
sharpening). One sentence: **describe your business once, then every closed deal
teaches the model who your best customers are — and you can see exactly what it
learned and why.**

---

## 1. GTM Context — the system of record your agents read and write

The Context page is the workspace's source of truth about *your* business. It
holds **context fields** grouped into living sections — ICP, Market, Product,
Pricing, Competitors, Positioning, GTM Motion, Notes. Each field is a `claim`
(epistemic, bi-temporal) carrying a `subject` slot, a `confidence`, and a source
(`you` edited it, `site` drafted it, `Claude` wrote it back from your work).

- **Editable inline** — hover a section, hit `+`, add a line. No "facts" framing;
  these are fields you curate.
- **It evolves, it doesn't pile up.** Re-stating a fact in a slot *supersedes* the
  old value (kept as history) rather than duplicating. Stale/AI-drafted fields are
  flagged "worth revisiting."
- **Agents use it both ways.** MCP tools `get_gtm_profile` / `get_context` read it;
  `update_gtm_profile` / `save_note` write back what they learn — so the context
  compounds from real GTM work, not just onboarding.

The Context is the seed for the ICP model: your plain-English ICP is translated
into an initial weighted signal list, which the learning loop then sharpens.

## 2. The ICP model — a transparent scoring engine

An account's **ICP fit** is a 0–100 score. It is *not* a black box — it is the sum
of weighted **signals** (the Scorecard), rescaled to 0–100. `score >= 70` = a fit.

- A **signal** is `{ rule: feature OP value, weight: −10..10 }` — e.g.
  `industry == fintech → +6`, `pipe.touches_band == 10+ → −4`. The signals *are*
  the ICP model; you can watch them evolve (§6).
- Scoring is a pure function (`packages/core/src/db/scorecard.ts` `scoreLead`): sum
  the weights of every active signal whose rule fires, rescale against the
  catalog's bounds. Deterministic, no LLM at score time.
- Every score is **staked as a prediction** (`scoreAndStake`) — an immutable bet
  with a `feature_snapshot` (the exact features at scoring time) and a real
  `model_version` fingerprint.

### The three feature layers (what it scores on)

A good ICP is the intersection of *who they are*, *how they operate*, and *how the
deal went*:

| Layer | Examples | Source |
|---|---|---|
| **A — Firmographics** (who they are) | industry, size_band, funding_stage, country, "what they do" | website extractor + enrichment |
| **B — Technographics / behavioural** (how they operate) | target_market, pricing_model, has_api, self-serve, `signal.tech.*`, hiring, compliance | website extractor (`websiteSignals.mjs`) |
| **C — Pipeline & engagement** (how the deal went) | `pipe.lead_source`, `pipe.channel`, `pipe.inbound`, `pipe.replied`, `pipe.meetings_band`, `pipe.touches_band` | the activity log (`pipelineFeatures`) |

All three flow into the `feature_snapshot` at scoring time and into closed-deal
episodes, so discovery can learn lift on any of them.

## 3. The learning loop — score → resolve → discover → re-score

The compound-intelligence loop, made of real tables (`observations` → `claims` →
`predictions` → `scorecard_signals`/`scorecard_runs`):

1. **Score** — `scoreAndStake` stakes one `icp_fit` prediction per account.
2. **Resolve (event-driven)** — the moment a won/lost activity lands (stage→client,
   revenue, `deal_lost`), `logActivity` fires `resolveEntityPredictions` and the
   prediction closes to `won` / `lost` / `no_opportunity`. No nightly poll for the
   cases that matter; a thin nightly backstop catches accounts that went quiet.
   (`packages/core/src/services/outcomes.ts`)
3. **Discover** — when there's enough evidence, contrastive lift discovery sweeps
   the won/lost cohort for features that separate winners from losers, proposes the
   strongest as new signals, tests each on a held-back 30% split, and keeps only
   what generalizes. (`packages/core/src/discovery.ts`, `scorecardLoop.mjs`)
4. **Re-score** — when the model changes, every *open* account's current fit is
   recomputed in place from its stored features; the prior score is kept as
   history so the trail reads "Re-scored 35 → Scored 15."
   (`packages/core/src/services/rescore.ts`)

### The one principle: the bet vs. the current fit

- A **resolved prediction is an immutable bet** — "on date X, under model vN, we
  scored them 82." It is never mutated; it is the only honest ground truth for "is
  the model improving?"
- The **current fit** is today's best estimate, recomputed as the model and data
  change. Re-scoring updates the *open* estimate only; resolved bets stay frozen.

## 4. How deals are weighted (the compounding)

Each resolved deal is **one equal vote**. What creates the weight of a *type* is
frequency — and several mechanisms keep outliers from distorting the ICP:

- **Cohort thresholds.** A trait needs **≥4 winners** (and ≥8 deals total) before it
  can become a signal — "small cohorts lie." Close 15 software / 3 agency / 2 local
  → only `industry=software` clears the bar; the 5 outliers are ignored until they
  accumulate. As local grows past 4, it earns its own signal — it *compounds*.
- **Recency decay.** Each deal's vote decays with age (180-day half-life, newest =
  1.0), from `resolved_at`. So a **pivot shifts the ICP faster** — old evidence
  fades instead of voting forever.
- **Volume-weighted confidence.** A signal's weight scales with its (recency-
  weighted) sample size (`withW/(withW+5)`), so a signal backed by 15 deals is
  sturdier than the same lift on 4.
- **Generalization gate.** Every proposed signal must improve calibration on a
  held-back split — outlier-specific signals are rejected.

## 5. Build from closed deals — the cold-start that closes the loop

Paste won + lost domains; Nous runs the whole cycle per account
(`POST /api/mind/closed-deals`):

1. **Read the site** — extract firmographics (Layer A) + behavioural signals
   (Layer B), saving the "what they do" summary.
2. **Recognize the account** — find the contacts you *already have* at that domain
   (via the company record `companies.domain → contacts.company_id`, the contact's
   domain, or email as fallback), link them (`works_at`), and record the won/lost on
   each — so their open prediction resolves and their pipeline history (Layer C)
   joins the deal. Multiple contacts (founder + CEOs) are all recognized; the most
   senior supplies the deal's buyer traits.
3. **Discover** — contrastive lift over the cohort; or, when there are too few deals
   for lift to mean anything, a winner-signal fallback proposes what your winners
   share (with an honest "sharpens as more deals close" note).
4. **Surface** — the closed-deal companies are scored and resolved, so they appear
   in the analyzed table as real won/lost rows.

## 6. Seeing it — the Context page UI

- **Top metrics** — Accounts analyzed · Closed-won · Closed-lost · Signals.
- **Analyzed table** — every account Nous scored: account, ICP fit (click the
  header to sort), outcome, when. Click a row → the full account record.
- **Account record** (People-style, in-page): name + ICP score on top, then tabs —
  **Trail** (every score → outcome → which learning run consumed it), **Company**
  (the firmographics report), **Pipeline** (the engagement report).
- **Signal evolution** — click the *Signals* metric → "Your ICP model": what it
  scores on now (the weighted signals) and a dated timeline of every learning run,
  so you can watch the ICP sharpen over time.

## 7. Data model (where each thing lives)

- `entities` / `entity_identifiers` — people & companies and their keys (email, domain).
- `observations` — the append-only event/state spine (activities, website signals).
- `claims` — bi-temporal beliefs (firmographics, context fields, pipeline_stage).
- `predictions` (`kind='icp_fit'`) — the staked bets: `predicted_value` (score, fit,
  reason, re-score history), `feature_snapshot`, `outcome_value` (disposition),
  `model_version`.
- `scorecard_signals` — the live model. `scorecard_runs` — the learning history.
- `relationships` (`works_at`) — person ↔ company links.

## 8. Honest limits

- Engagement features in a *live* prediction reflect engagement-so-far (frozen at
  scoring time); in a closed-deal episode they reflect the full deal — the held-back
  test guards the difference.
- Two "current fit" stores still coexist (`contacts.icp_score` v1 vs the
  prediction-based fit); collapsing them into one is deferred.
- Single-mention `signal.tech.*` is noisy at low deal counts; lift confirmation and
  the volume weighting are what tame it as deals accumulate.
- Companies are scored only via the closed-deals flow today (not a general
  company-scoring worker); people are scored by `scoreEntities`.

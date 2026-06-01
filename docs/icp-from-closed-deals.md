# ICP from closed deals — live, contrastive signal discovery

**Status:** spec / proposed. **Owner:** GTM Context / the Mind.
**Related:** `docs/adaptive-lead-scoring.md`, `docs/compound-intelligence-mind.md`,
the GTM Context page (`apps/frontend/src/pages/Intelligence.tsx`), the Playbook
(`/api/mind/playbook/*`), the Mind loop (`apps/worker/src/workers/mindOutcomes.mjs`,
`scoreEntities.mjs`, `scorecardLoop`).

---

## 1. Goal

Make the ICP scoring model **start from real outcomes, not a guess**, and keep it
**live** (learning from every deal) and **beautiful** (it speaks in *lift* —
"accounts with X convert 3.2× more"). Absorb the best of two competitors —
Deepline's **contrastive won-vs-lost discovery** and Zevenue's **website
signal-builder** — without becoming either: we own the *model*, not the
enrichment CLI or the outreach sequencer.

The one-line pitch: **"Upload your closed deals; Nous finds the niche signals
that actually predict your revenue — and re-learns them every time you close
another."**

## 2. Why (the critique we're answering)

A founder-described ICP ("Series B SaaS, 100–500 employees") is everyone's ICP —
no differentiation, and it's a guess. The question that matters is *what is
actually different between your closed-won and your closed-lost accounts.* Our
current `scorecard/seed` (Haiku translates a plain-English ICP → firmographic
signals) is exactly the generic filter being criticized. We have the learning
loop they lack; we're missing **rich signals** and **contrastive discovery**.

## 3. What we keep (loyalty to Nous)

- **Continuous, native learning.** Deepline is a one-shot batch on a CSV; our
  Mind already resolves outcomes nightly. We extend the loop, we don't replace it.
- **No CSV required at steady state.** We already store a `feature_snapshot` on
  every prediction and resolve won/lost — the cohorts exist *inside* Nous.
- **Context layer.** Discovered signals seed the Scorecard **and** write back into
  the GTM context; agents read/write the same system of record.
- **Out of scope (stays a free skill, per the charter):** the enrich→score→
  outreach *pipeline* (Lemlist/Smartlead pushes). We own discovery + scoring.

## 4. The model's own lifecycle

| Phase | Trigger | Behaviour |
|---|---|---|
| **Day 1 — intuition** | No deal history | Playbook seeds firmographic signals from the founder's words + site (today's flow, kept as a fallback). |
| **Onboarding — ground truth** | User uploads / connects closed deals | Batch discovery over real won/lost → seed the model from outcomes, not a guess. |
| **Day 30+ — live** | Each new deal closes | Same pipeline runs on that one account; nightly loop re-tunes signals by lift. |

The same engine powers all three; only the trigger differs.

## 5. The pipeline (one path, run batch or per-deal)

```
resolve → enrich → scrape+extract → snapshot features → contrast (lift) → seed/retune
```

1. **Resolve.** Each input row (CSV) or CRM record → a company/contact entity
   (`getOrCreateEntity` / `resolveFocus`).
2. **Enrich.** Firmographics via Apollo/Prospeo (we have). Technographics /
   hiring / funding via a paid source (fast-follow — §8).
3. **Scrape + extract (the differentiator).** Multi-page site scrape + LLM
   extraction — the Zevenue signal-builder method, run by us (§7).
4. **Snapshot features.** Every signal/feature is written as a claim/observation
   so it lands in the entity's `feature_snapshot` at scoring time — this is what
   discovery reads.
5. **Contrast.** Compute **lift** per feature/value across the won vs lost
   cohorts (§6).
6. **Seed / retune.** Surface the top positive + anti-fit signals → through the
   existing propose/test/keep-drop gate → into `scorecard_signals`; mirror the
   plain-English version into GTM context facts.

### Lift math

For a candidate signal `S`:

```
lift(S) = winRate(accounts where S fired) / winRate(accounts where S did NOT fire)
```

- `winRate = won / (won + lost)` within each group.
- **Gate:** require a minimum sample on both sides (e.g. ≥5 fired, ≥5 not) before
  a signal is eligible — small cohorts lie. Surface a confidence from sample size.
- `lift > 1` = fit signal; `lift < 1` = anti-fit. Rank by `|log(lift)|` × confidence.
- This replaces signal-builder's *guessed* 1–10 exclusivity with *measured* lift
  from the customer's own deals — our key improvement over the skill.

## 6. Closing the "lost" gap (prerequisite for clean discovery)

Today Nous knows **won** well (`mindOutcomes.mjs`: pipeline → `client`, or
`deal_won`/`payment_received`/`proposal_signed`) but has **no explicit "lost"** —
it only infers "didn't convert in 30 days" (a timeout), which is noisy (silence ≠
a real loss). Contrastive discovery needs real negatives.

**Add an explicit lost signal:**
- New `LOST_PROPS = ['interaction.deal_lost', 'interaction.deal_disqualified']`
  (counterpart to `WON_PROPS`), plus a `lost`/`disqualified` pipeline stage.
- **Sources of the signal:**
  1. **Upload** — the user labels the CSV (won vs lost). Explicit, easy.
  2. **CRM (continuous)** — wire HubSpot/Salesforce *closed-lost / disqualified*
     stage in `crm_sync` to emit `interaction.deal_lost`.
  3. **Manual / agent** — a "mark as lost" action, or the agent records
     `interaction.deal_lost`.
- **In `mindOutcomes`:** resolve a prediction as **explicit-lost** (a strong
  negative, outcome 0, labelled) vs **timeout-silence** (ambiguous, weak/excluded
  from the contrast). Discovery weights the two differently — explicit losses are
  the gold the anti-signals are built from.

## 7. The website signal extractor (owned, signal-builder style)

We already scrape the homepage in `fetchSiteText` (`mind.mjs`). Extend it:

- **Pages:** homepage, `/about`, `/careers`/`/jobs`, `/pricing`, `/blog`, footer.
- **Extract (one Haiku/structured-output call):** hiring signals (roles posted),
  pricing model (usage-based / seat / enterprise), product signals (developer
  sandbox, API docs, self-serve sign-up), compliance/vertical language, named
  tech mentions, recent triggering events (funding, launches).
- **Store** each as a claim on the entity (e.g. `signal.has_developer_sandbox`,
  `signal.hiring_fraud_lead`) so it flows into `feature_snapshot`.
- **Cost:** ~one LLM call per account — no paid vendor. This is the cheapest path
  to *differentiated* signals and the first thing to build.

## 8. Data sources (layered)

| Layer | Source | When |
|---|---|---|
| Website / behavioural signals | **Our scrape + LLM** | **v1** |
| Firmographics | Apollo / Prospeo (have) | **v1** |
| Technographics (exact stack) | BuiltWith | fast-follow |
| Hiring / funding (structured) | Crustdata | fast-follow |
| Web research (semantic) | Exa | later |

**v1 ships on the two owned layers** and is already differentiated; the paid
layers turn "good ICP" into "signals competitors can't see."

## 9. Onboarding UX

New default door in the Playbook (`Intelligence.tsx`), with the current
read-your-site flow demoted to the fallback:

- **Door 1 (default) — "Build from my closed deals":** upload `closed-won.csv`
  (+ optional `closed-lost.csv`), or connect HubSpot/Salesforce and pick the
  won/lost segments. Minimum columns: company + domain. Progress UI during
  enrich/scrape ("enriching 50 accounts…"). Then a **lift confirm** screen
  (same chip-confirm UX) → seed.
- **Door 2 (fallback) — "Describe my ICP":** today's Playbook, for users with no
  deal history yet.
- **Won-only vs won+lost:** won-only → "common profile" (still a real model);
  won+lost → discriminative lift (the differentiated model). Ask for both, make
  lost optional-but-recommended.

## 10. Beautiful: lift on the "getting smarter" page

Replace calibration-gap jargon with the legible form on the page we just shipped:

- Each signal as **"accounts with [signal] convert N× more"** + sample size +
  confidence.
- A fit / anti-fit split (positive lift vs `<1`), like Deepline's two columns.
- Each discovery shows up in the **"What it's learned"** timeline as a `model`
  learning ("learned: developer-sandbox → 2.5× lift, from 41 closed deals").

## 11. Build phases

1. **Lift legibility** (no new data): compute lift for existing signals from
   resolved predictions; render on the page. *Fast, beautiful, defines the metric.*
2. **`deal_lost` signal**: `LOST_PROPS` + CRM closed-lost wiring + manual/agent +
   `mindOutcomes` explicit-lost vs timeout.
3. **Website signal extractor**: multi-page scrape + LLM extraction → claims →
   `feature_snapshot`. *The differentiation, owned.*
4. **Contrastive discovery job**: extend `scorecardLoop` to sweep won/lost
   snapshots for new lift-ranked signals (works on firmographics first; powerful
   after step 3).
5. **"Build from closed deals" onboarding**: CSV upload / CRM segment pick →
   batch pipeline → lift-confirm → seed. Becomes the default.
6. **Paid enrichment layers**: BuiltWith (technographics), Crustdata
   (hiring/funding), Exa (web).

Steps 1–5 are buildable on owned data/enrichment; step 6 is the premium layer.

## 12. Open decisions

- **Enrichment cost controls** — credits per account; cap batch size, confirm
  before spend (cf. Deepline's ~$40 full-pipeline cost).
- **CRM segment mapping** — how to let the user pick "closed-won" / "closed-lost"
  per their pipeline stage names.
- **Min cohort size** before discovery is trustworthy (and the copy when it isn't
  yet — "need ~20 more resolved deals").
- **Paid source choice** for step 6 (BuiltWith vs Wappalyzer; Crustdata vs PDL).

## 13. Charter check

Enriching and scraping the user's **own clients'** sites to model **their** ICP is
onboarding/research — aligned (passes NOT-ALIGNED #1: not cold-lead scraping). We
model + score (product); turning signals into outreach copy stays a free Claude
skill, not a product feature.

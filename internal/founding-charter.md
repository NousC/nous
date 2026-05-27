# NOUS — Founding Charter

*The anchor document. Read this before you write a line of code, send an email, or take a meeting on our behalf. If a decision doesn't trace back to this, the decision is wrong.*

---

## 1. What this document is

This is not a pitch and not a plan. It is the set of beliefs and tests that decide what we build and what we refuse to build. Founders and early team members are joining a *bet*. This charter is the bet, stated plainly enough that you can hold us to it — and walk away now if you don't believe it.

## 2. The shift we are building for

Within this decade, machine **cognition** — reading, extracting, reasoning, matching, summarizing, querying, writing — becomes effectively **free and abundant**. This is the load-bearing assumption of the entire company. If it is wrong, we revisit everything. Every signal says it is right.

That single shift sorts the world into two piles:

**What becomes obsolete** — anything whose value *is* cognition. Tools that write the email, parse the document, translate a question into a query, infer a missing field, match two records, summarize a call. The model does these natively. Building a company on them is building on sand: every model release erodes you.

**What survives — and grows more valuable:**

- **Contact with reality** — a fresh observation. No intelligence, however great, can know a person changed jobs by reasoning; the information has to physically arrive.
- **Structural commitments** — provenance, a canonical identity registry, an immutable record. A model cannot retroactively know where a fact came from if no one recorded it.
- **The self-improvement loop** — accumulated, graded outcomes. A superintelligence with zero outcome history cannot out-predict a modest model with 100,000 graded episodes. The missing ingredient was never intelligence. It is *evidence*.

**Intelligence is becoming abundant. Evidence stays scarce. We are going to own the evidence.**

## 3. What we believe

1. The bottleneck of AI-native go-to-market is **not smarter agents — it is trustworthy context**. Agents are already smart enough. They are flying blind.
2. **A fact you cannot trust is worse than no fact** — because an agent will act on it, at scale, in seconds.
3. **Data reliability is not a feature. It is the foundation** every other GTM outcome — outreach, scoring, forecasting, agent action — silently stands on.
4. You **cannot bolt reliability on**. It must be the architecture: store evidence, not values; derive beliefs, never assert them.
5. The moat is **not the model and not the schema** — AGI can produce both. The moat is the *lived, accumulating, graded record* of what happened and what predicted.
6. **Build for the agent, not the human.** The unit of truth is a claim with its confidence and provenance — never a bare value.
7. **Vertical depth beats horizontal reach** — because a system that learns needs a hard outcome to learn from, and go-to-market has one: revenue.
8. **Heal toward truth, not toward convenience.** Outcomes are ground truth. Usage is not.

## 4. How we decide — the formula and the three tests

We make every roadmap decision with one formula and three gates. This is our reasoning engine. Memorize it.

> **accuracy ≤ min( cognition , freshness × coverage )**

Today both terms bind. AGI drives the first to ~1. So all durable value lives in the second — freshness, coverage, structure, the loop. We build there, and **only** there.

Every initiative must pass all three gates:

- **The AGI test** — *Does a smarter model make this more valuable, or obsolete?* If obsolete, we do not build it. (The elevated form of this gate is **THE LITMUS TEST** below — our final arbiter.)
- **The compounding test** — *Does every customer, every day, every outcome make this better and harder to replicate?* If not, there is no moat.
- **The coordination test** — *Can this become the standard others must adopt to interoperate?* That is the prize.

If a feature feels productive but fails the AGI test, it is the most dangerous thing on our roadmap. The discipline to kill it is the job.

## 5. THE LITMUS TEST

Before we build anything — a feature, a model, an integration, a pitch, a hire — we run one question. It overrides every other argument: a great demo, a paying customer's request, a quarter already on the roadmap.

> **Take the most capable AI model that will plausibly exist in five years. Does what we're about to build become *more valuable* in its hands — or does it make our work unnecessary?**

- If a smarter model makes it **more valuable** → it lives on the durable side of `min(cognition, freshness × coverage)`. Build it.
- If a smarter model makes it **unnecessary** → its value was cognition, and cognition is becoming free. Do not build it — no matter how well it demos, no matter who asked.

Three ways to say the same thing, so it lands with whoever is in the room:

- *Are we selling intelligence, or evidence?* Intelligence will be abundant. Evidence is lived. **Sell evidence.**
- *Does this get better when the model gets better — or does it get eaten?*
- *In five years, is this our moat — or is it a feature inside someone else's model?*

The test is uncomfortable on purpose. It will tell us to kill things that feel like real progress, things we are proud of, things that work today. That discomfort is the signal that it's working. **The day we are no longer willing to fail our own litmus test is the day we start building the company that AGI deletes.**

When two people disagree, this is the tiebreaker. When the roadmap is crowded, this is the cut. When in doubt, this decides.

## 6. The problem — and the baseline we are honest about

Go-to-market runs on data that is quietly broken. The baseline, stated with its sourcing (vendor-published, directional — these are starting estimates, not gospel; the discipline is to *measure our own*):

- **B2B data is roughly 60–70% accurate at any given moment.** ~70% of CRM data goes stale or inaccurate; surveys show fewer than half of CRM entries are complete *and* accurate.
- **It decays continuously** — ~22–30% per year for contact data; email addresses ~3.6% per month.
- **Current tooling ceilings around ~85%** (waterfall enrichment + periodic cleansing). No one is structurally above it.
- The cost downstream: reps spend **~70% of their time not selling** and ~37% on research; median **forecast accuracy is 70–79%**, with fewer than half of sales leaders confident in their own number.

**Our core metric — DATA ACCURACY:** the % of facts in the model that are *accurate and current* (a once-true-but-now-stale fact counts as wrong).

| | |
|---|---|
| **Baseline** | ~60–70% |
| **Industry ceiling, current tooling** | ~85% |
| **Our target** | **99%+, maintained continuously** |

When agents run GTM, this gets worse, not better — they act faster, broader, and unsupervised on the same broken data. That is the problem we exist to end.

## 7. What we build

**The evidence substrate for go-to-market — the account record built for agents.**

- **Evidence-centric, not value-centric.** We never store "Title = VP Eng." We store every observation that bears on it — immutable, append-only, with provenance — and *derive* the current belief as a distribution with calibrated confidence and a decay state. Three primitives: **Entity, Observation, Claim.**
- **Self-healing.** A new observation recomputes the claims it touches. Reality — bounces, replies, no-shows — is free ground truth that continuously corrects the model.
- **Compounding.** Predictions are claims about the future, frozen with the confidence of the data they were scored on, resolved against real outcomes. Every resolved episode refines the model. Our proof: **prediction error falling as episodes accumulate** — a learning curve no incumbent and no black box can fake.
- **Vertical to GTM** — so the loop has a hard outcome label: revenue, closed-won, reply. This is the precondition for compounding, not a market compromise.
- **The Context API** is an epistemics-carrying read/write contract: agents read claims-with-confidence-and-provenance, never bare values, and write observations back — so every agent that touches the substrate improves it. It is a coordination protocol, not a query translator.
- We **enter over the warehouse and existing tools** (Salesforce, HubSpot, Gong, the rest) — but they are *sources*, never *the source of truth*.

### The Action Layer — and why it is not an exception to the litmus test

The substrate is invisible. Nobody buys it. What runs inside a company and earns the ROI is the **Action Layer** — agents embedded in the real workflow: CRM hygiene, outbound, pre-meeting briefs, deal-risk watch.

This is *not* the "GTM app" the litmus test rejects. The litmus test forbids making the **app the moat**. The Action Layer is the **wedge, the revenue, and the sensor** — the moat still lives in the substrate. The two are inseparable: the substrate makes the agents trustworthy; the agents act in the workflow and feed the substrate the observations and graded outcomes the loop runs on. Without an Action Layer the loop has no data. Without the substrate the agents are untrustworthy.

The stack, top to bottom:

- **Workflow embed** — inside Gmail, Salesforce, Slack, the rep's calendar.
- **Action Layer** — the agents that act. The wedge and the ROI.
- **Context API** — read claims-with-epistemics, write observations.
- **Substrate** — entities · observations · claims. The moat.

**We sell the agent. We moat on the substrate.** See `docs/use-cases.md`.

## 8. Why now, why us, why not the alternatives

**Why now:** the coordination point gets claimed *once*. GTM agents are proliferating today and choosing their default context source today. Being early to *be* that default is the entire game.

**Why not the tempting alternatives** — and we considered each seriously:

- **A GTM application (an AI SDR).** Fundable, demos beautifully. Rejected: the model *becomes* the application; we'd be a wrapper whose value compresses to zero with each release. Fails the litmus test.
- **A horizontal context/semantic layer.** Rejected: its headline feature — translating questions to queries — is cognition AGI commoditizes; and horizontal has *no clean outcome label*, so it cannot compound.
- **A passive store — "a better CRM."** Rejected: storage is commodity; without the outcome loop there is no appreciating asset.
- **Wait and hedge.** Rejected: forfeits the standard position — the most valuable thing on offer.

An application is a **depreciating asset** — model progress erodes it. The substrate is an **appreciating asset** — every customer, day, and outcome makes it better. Model progress is our **tailwind**. We are buying an asset that grows while we sleep. That is the only kind of bet worth a decade.

## 9. Mission & Vision

**Mission** — what we do every day:

> Make go-to-market data reliable enough that agents can act on it without a human checking.

**Vision** — the world if we win:

> Every GTM agent, in every company, runs on a context layer that is true, self-healing, and compounding — and the work of go-to-market is done by agents that can finally be trusted.

## 10. The ROI

**For the customer — three measurable money mechanisms:**

1. **Recovered selling capacity.** Account context in one query instead of a manual rebuild across ten tools. *Metric: rep selling-time %, pipeline per rep.* ROI = rep comp × hours returned.
2. **Agent autonomy unlock — the big one.** Today the trust gap forces human review of every agent output, so net savings ≈ 0. Give agents confidence + provenance on every claim and they act on spot-check, not full review. *Metric: autonomy rate (% of agent actions shipped without human edit).* This is the difference between AI as a copilot and AI as labor — and it does not happen without our layer.
3. **Decision quality.** Accurate data → calibrated scoring → a bottoms-up forecast that is the sum of calibrated per-deal probabilities. *Metrics: conversion lift vs. baseline; forecast variance; bounce / wrong-person rate.*

**For the company:** the moat *appreciates*. Defensibility grows with every customer's observations and graded episodes. The same loop serves more use-cases as the substrate fills, so engineering spend compounds. We become infrastructure — multi-agent, multi-use-case adoption, low churn.

## 11. Our values — how we operate

- **Evidence over opinion.** Every claim traces to an observation. If you can't trace it, you don't assert it — internally or in the product.
- **Truth over convenience.** We heal toward outcomes, never toward what's easy or frequently asked.
- **Calibrated, not confident.** We state uncertainty. We never fake precision — no invented numbers, ever. Cite the source or name the metric.
- **Build on the durable side.** The three tests and the litmus test gate everything. We kill our own clever cognition features before the market does.
- **Compounding over quick wins.** When two paths exist, we take the one whose asset appreciates.
- **Honesty about the bet.** We tell each other, our investors, and our customers what we don't know. The load-bearing assumptions are written down so they can be challenged.

## 12. What we ask of you

If you join, you are signing up to build the unglamorous, foundational layer while others chase the demo. You are betting — with years of your life — that intelligence becomes abundant and evidence stays scarce, and that the company that owns the evidence owns the category.

The mistake that costs us the decade is building on the wrong side of the `min()`. This charter exists so we never do. Hold it against every decision. Including ours.

**Intelligence is becoming abundant. Evidence stays scarce. We are going to own the evidence.**

That's the bet. Welcome.

---

*This is a living anchor: the conclusions are fixed, the load-bearing assumptions are explicit and challengeable. Anyone may question an assumption with evidence. No one may quietly drift from a conclusion.*

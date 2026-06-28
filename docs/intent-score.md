# Intent Score

[ICP fit](./icp-scoring.md) answers *who* you should sell to — a durable judgement about whether an account matches your business. It barely moves week to week. But knowing an account is a great fit doesn't tell you *when* to reach out. That's a different question, with a different shape: it decays. Someone who engaged your post yesterday, replied last week, and has a meeting booked is **warm right now**; the same person silent for three months is not, even though their fit is identical.

The **intent score** is that second axis — a 0–100 measure of *reach out now?*, computed from behavioural signals, recency-weighted so it fades as activity cools. It is deliberately kept **separate from the fit score**: blending them into one number destroys the most useful distinction in outbound — "great fit, quiet" (nurture) versus "great fit, on fire" (work today). Fit filters, intent times.

This document describes the actual infrastructure: the substrate, the scorer and its anti-over-prioritization rules, the signal catalog, the bands and the Fit×Intent play, the worker and cadence, the read overlay across surfaces, and the honest limits. It is precise rather than illustrative, and it points at the code.

---

## 1. The substrate

Intent scoring reuses the same evidence substrate as [identity resolution](./identity-resolution.md) and [ICP scoring](./icp-scoring.md) — `entities`, `observations`, `claims`. It adds **no tables and no migration**.

| Store | Role | Shape |
| --- | --- | --- |
| `observations` (`interaction.*`) | The append-only behavioural spine — every meeting, reply, LinkedIn touch, and (later) website visit, with its timestamp and source. The raw fuel the score decays over. | `entity_id`, `property`, `source`, `observed_at` |
| `claims` (`intent_score`, `intent_band`) | The derived current intent per entity, recomputed each run. Written `epistemic_class: 'inferred'` so it is **refreshable** — never `asserted`, never locked. | `entity_id`, `property`, `value`, `epistemic_class`, `computed_at` |

Two structural facts drive the design:

**Intent is a derived claim, not a bet.** Unlike `icp_fit` (a staked, immutable [prediction](./icp-scoring.md#1-the-substrate) you later grade), intent is a *current reading* — it is meant to be overwritten on every run as signals arrive and decay. So it lives in `claims` with `epistemic_class: 'inferred'`, which the derivation engine is free to supersede (it only refuses to overwrite `asserted` claims). Storing it as a refreshable claim is the whole point.

**The score is a pure, deterministic function — no LLM at score time.** Every input is a timestamped event; the score is weights × saturation × decay, gated. You can trace any intent number to the exact events that produced it.

---

## 2. The scorer

The core is `scoreIntent` (`apps/worker/src/intentScore.mjs`) — pure, given an entity's signal timestamps and the current time. Each signal class contributes `weight × saturate(count) × decay(age)`, capped at its weight; the contributions sum, then a corroboration gate applies.

```js
// scoreIntent — apps/worker/src/intentScore.mjs
const saturate = (n) => 1 - Math.exp(-n / 2);              // diminishing returns
const decay = (ageDays, halfLife) => 0.5 ** (ageDays / halfLife);
contrib[cls] = Math.min(cfg.weight, cfg.weight * saturate(weightedN));
let score = Math.min(100, sum(contrib));
if (activeSignals.length < 2) score = Math.min(score, onlyWebsite ? 49 : 69);
```

### Anti-over-prioritization — the five rules

A naive intent score is dominated by whatever fires most, so one noisy channel (classically: anonymous website visits) fakes readiness. Five rules prevent that, and they are the heart of this design:

1. **Per-signal cap.** Each class contributes *at most* its weight. Fifty visits can't exceed the visit cap.
2. **Saturation on repeats.** `1 − e^(−n/2)`: 1 event ≈ 0.39, 3 ≈ 0.78, 20 ≈ 1.0. The 20th visit adds almost nothing — volume can't run away.
3. **Recency decay.** `0.5^(age/halfLife)`. A visit (half-life 7 days) two weeks old barely counts; the score fades on its own.
4. **Corroboration gate.** A *single* active signal can't reach the top bands — it caps at **Warm (69)**, and a lone *website visit* caps at **Aware (49)**. Hot/Red-hot require **≥2 distinct signal types** (e.g. a visit *and* a reply). One pageview can never look "ready."
5. **Fit overlay.** Intent never overrides fit. `Not-ICP + Hot` is still ignored in the play — a hot signal on a bad-fit account doesn't promote it.

---

## 3. The signal catalog

Each signal carries a weight (max contribution) and a half-life (how fast it decays). Mapped to the standard 1st/2nd/3rd-party framing:

| Signal | Weight | Half-life | Source observation | Party |
| --- | --- | --- | --- | --- |
| `meeting_booked` | 35 | 30d | `interaction.meeting_scheduled` / `_held` (calendar) | 1st |
| `replied` | 35 | 30d | `interaction.email_replied` / `positive_reply` / `reply` / `linkedin_reply` | 1st |
| `linkedin_engaged` | 25 | 14d | `interaction.linkedin_message` / `_connected` / `_post_engagement` | 1st |
| `content_intent` | 20 | 30d | company `signal.intent` ≥6 (from content-scan, inherited) | 2nd |
| `hiring` | 18 | 30d | company `signal.hiring` ≥6 (inherited) | 2nd |
| `momentum` | 12 | 60d | company `signal.momentum` ≥6 (inherited) | 2nd |
| `website_visit` | 40 | 7d | `interaction.website_visit` — **Phase 2 (needs a visitor pixel)** | 1st |

Company `signal.*` claims are **inherited by every person at the company** (resolved via the `works_at` edge / domain identifier), so a hiring surge lifts the whole buying committee's intent. Outbound-only events (`*_sent`), `meeting_cancelled`, and `enrichment_run` are deliberately **not** intent.

---

## 4. The bands, and the Fit × Intent play

The score maps to a band (6sense-style stages):

| Band | Score | Meaning |
| --- | --- | --- |
| Red-hot | ≥85 | acting now |
| Hot | 70–84 | clear, current intent |
| Warm | 50–69 | building |
| Aware | 20–49 | early flickers |
| Dormant | <20 | no live intent |

The point is the **matrix with fit**, not either score alone:

- **Tier-1 + Hot** → work by hand, today.
- **Tier-1 + Dormant** → nurture / queue.
- **Not-ICP + Hot** → still ignore.

Fit says who; intent says when; the cell says what to do.

---

## 5. The worker and cadence

`scoreIntentCron` (`apps/worker/src/intentScore.mjs`) runs every 6 hours (`cron.schedule('15 */6 * * *', …)` in `apps/worker/src/index.mjs`). It finds every entity with a recent `interaction.*` observation (last 180 days) per workspace, gathers its signals plus its company's inherited `signal.*`, scores it, and **upserts the `intent_score`/`intent_band` claims** for anything that clears the floor (`STAKE_FLOOR = 20`, i.e. Aware+). Entities with no live intent are left to default to Dormant at read time — no hollow claims.

Run it by hand for a preview (writes nothing) or to backfill:

```bash
# from apps/worker, with workspace Supabase creds in env
node src/intentScore.mjs                 # preview the default list
LIST_ID=<uuid> node src/intentScore.mjs  # preview one list
node src/intentScore.mjs --write         # stake claims, workspace-wide
```

---

## 6. How it surfaces

One read overlay, `fetchIntentByEntity` (`apps/api/src/lib/icpFit.mjs`) — the sibling of `fetchIcpByEntity` — batch-reads the `intent_score`/`intent_band` claims so every surface shows the same number. Entities with no claim default to **Dormant / 0**.

- **Lead lists** and the **People** page overlay it at read time (`leadLists.mjs`, `contacts.mjs`) and render a coloured band pill; People has an **Intent filter** (Hot / Warm / …).
- **Companies / Accounts** roll it up **max-of-people** (`buildCompanies`, `entities.tsx`) — an account is as hot as its hottest person, the one you'd actually reach.

The same column on every surface means a number that never disagrees across the product.

---

## 7. Honest limits

- **The website-visit signal is wired but inert** — it needs a de-anonymizing visitor pixel (Phase 2). Until then `website_visit` never fires; the highest-weight 1st-party signal is dormant.
- **A cold list reads all-Dormant, correctly.** Intent accrues from engagement; a freshly built list has none yet. That is the right answer, not a bug.
- **No 3rd-party intent** (keyword/competitor research, the "dark funnel") — that needs an external provider and is out of scope.
- **Engagement must be captured as a per-entity event** to count. The LinkedIn engagement worker emits `interaction.linkedin_post_engagement` per engager; sources that only record list membership don't contribute.

---

## 8. The guarantees, and the guards that enforce them

- **Intent never fakes readiness from one channel** — guaranteed by the per-signal cap, saturation, and the corroboration gate (a lone signal can't exceed Warm).
- **Intent never overrides fit** — `Not-ICP` accounts stay suppressed; the score is read alongside the tier, never blended into it.
- **Intent is always current** — the claim is `inferred` (refreshable) and recomputed every 6 hours, so it decays without manual cleanup.
- **No migration, one source** — it rides the generic `claims`/`observations` tables and is read through a single overlay, so the lead list, People, and Companies can never show different intent for the same entity.

---

## 9. What you get

A second, honest axis next to ICP fit: who to sell to *and* when to move. The hot, in-fit accounts surface to the top of every list on their own; the quiet ones wait; the noisy non-fits stay out. Your agents read the band, not a hunch — and act on the cell of the matrix, not a single number.

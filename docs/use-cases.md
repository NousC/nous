# The Action Layer — Embedded GTM Agents

Companion to `founding-charter.md`. The substrate is the moat. The **Action Layer** is the wedge, the revenue, and the sensor that feeds the loop. Nobody buys a substrate — they buy the agent that books the meeting. This document is how we pitch and what we ship.

---

## How to position — problem first, never solution first

Never open with "evidence substrate." Open with a scene the buyer is living *today* → the embedded agent that ends it → the ROI → and only then the reveal: the substrate is why it works, and why it compounds.

## The stack

```
WORKFLOW EMBED   → inside Gmail, Salesforce, Slack, the rep's calendar
ACTION LAYER     → agents that act: hygiene, outbound, briefs, deal-watch   ← wedge · revenue · sensor
CONTEXT API      → read claims-with-epistemics, write observations
SUBSTRATE        → entities · observations · claims                          ← the moat
```

The loop runs **vertically**: agents act in the workflow → the world responds → responses become observations → the substrate learns → agents act better. The Action Layer is the substrate's hands and eyes — without it the loop has no data. **We sell the agent. We moat on the substrate.**

---

## 1 · The Hygiene Agent — the wedge

> **The scene:** Your CRM says this account is in "negotiation," 80% to close. The champion left two months ago. Nobody noticed. The forecast is built on a dead deal.

**The agent:** watches every email, call, and calendar event; writes structured observations; keeps the record true; flags decayed facts and silent deals. It sends nothing — pure background.

**The ROI:** kills the ~300 hrs/rep/yr logging tax; makes the forecast real; surfaces dying deals before they die. *Metrics: rep hours on CRM admin; forecast variance; deals flagged-before-lost.*

**Why it's the wedge:** low-trust — it doesn't act outbound, so an exec says yes fast — and it **fills the substrate with observations from day one.** It is the self-healing loop, customer-facing. Land here; outbound and briefs then build on an already-full substrate.

## 2 · The Outbound Agent — the ROI flagship

> **The scene:** Monday, 9am. Your SDR has 200 accounts. She'll spend the week researching, writing, sending. By Friday — 40 emails out, ~12% bounced on stale data, 3 already in another rep's sequence, two meetings booked. A $90k rep producing two meetings a week.

**The agent:** runs the whole motion continuously — picks accounts, researches them, writes, sends, follows up, handles the replies. Embedded in the existing inbox and sequencer.

**The ROI:** meetings booked per dollar of cost; pipeline generated; the rep redeployed to closing. *Metrics: meetings/week; pipeline per rep; bounce rate; reply rate.*

**Why it needs the substrate:** it doesn't bounce (claims carry freshness), doesn't double-touch (the touch-ledger knows every prior contact), personalizes from real grounded context — and **every send and every reply is an observation and a graded outcome.** It gets measurably sharper every week. A standalone AI SDR cannot; it has no memory and no loop.

## 3 · The Pre-Meeting Brief Agent — the substrate, visible

> **The scene:** 9:55am. Your AE has a 10am with an account he hasn't touched in three weeks. He opens Salesforce, LinkedIn, Gmail, the Gong recording — scrambles for five minutes — walks in cold anyway.

**The agent:** 15 minutes before every meeting, drops a brief into Slack — who's in the room, the full history, what they care about, deal state, what changed since last contact, the suggested next step.

**The ROI:** prep time eliminated; better meetings; higher win rate. *Metrics: rep prep minutes; meeting-to-next-step conversion; win rate.*

**Why it needs the substrate:** the brief *is* a projection of the substrate — entity + observations + claims, assembled on demand. It is the "account record built for agents," made visible to a human. Impossible without the layer underneath.

## 4 · Deal-Risk Watch *(next)*

> **The scene:** Three deals slipped this quarter. Each had a warning weeks earlier — no activity for 30 days, a champion gone quiet, a missing next step. Nobody was watching.

**The agent:** runs over every open deal daily; flags slippage, champion departure, going-dark, missing next steps; routes the alert to the owner. **ROI:** deals saved; forecast accuracy. **Substrate:** needs the unified event ledger + deal-state claims + decay.

## 5 · Inbound-Reply Handler *(next)*

> **The scene:** A hot prospect replies at 6pm. The rep sees it at 10am the next day. The 5-minute window — where conversion is ~20x higher — is long gone.

**The agent:** the moment a reply lands, triages it, qualifies, drafts or books. **ROI:** speed-to-lead; meetings booked. **Substrate:** needs full account context to respond well — and the reply is the cleanest possible outcome label for the loop.

---

## Sequencing & the loop

- **Land with the Hygiene Agent** — fastest yes, no trust barrier, fills the substrate.
- **Lead the ROI story with the Outbound Agent** — clearest money, cleanest fast label.
- **Prove the substrate with the Brief Agent** — it makes the invisible layer visible and felt.

Every agent's actions and outcomes feed the *same* substrate. So every agent makes every other agent better — and the customer's switching cost compounds with each one they turn on. That is the moat, expressed as product.

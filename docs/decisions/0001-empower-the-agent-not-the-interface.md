# 0001 — Empower the agent, not the interface

- **Status:** Accepted
- **Date:** 2026-05-23
- **Anchored in:** the Nous Founding Charter (May 21, 2026)

## Context

Nous is the GTM data infrastructure — the account record agents reason
against, the signal store webhooks land in. As the surface grows, every new
GTM job we look at raises the same question: where does the *workflow* live?
Specifically when we ship things beyond the core MCP — LinkedIn engager
scraping, outbound from signals, inbound triage, reply agents, re-engagement
of dormant leads.

Two architectures were on the table.

## Options considered

### A. A Nous-hosted dashboard

Build a separate UI where users click through pre-built workflows. Nous runs
the workflow code; the user gets a button. Highest perceived ease of use, most
familiar product shape for a GTM tool — every competitor's default move.

**What it would have given us:**
- A 3-click "set up" experience for non-technical users.
- A self-contained brand surface to market.
- A short-term revenue lever (paid hosted-dashboard tier).

**What it would have cost:**
- We become GTM app #16 instead of the layer the other fifteen sit on.
- Ops nightmare: we now run user code, deal with rate limits per workspace,
  handle credentials for every outbound tool the user connects.
- Every minute spent on the runtime is a minute *not* spent on the Account
  Record and the Mind — the only moat that compounds.
- Branding drift: the product becomes the dashboard, not the data layer.

### B. Empower the agent, not the interface

Workflows live as **skills** and **routines** in the user's environment
(Claude Code, their git, their cron / claude.ai routines). Nous holds state
(the account record, signals from webhooks); the user's agent reads it and
acts. We give them the procedures and the API; they run them.

**What it gives up:**
- No "set up in 3 clicks" for non-technical users.
- No standalone dashboard to market.
- No hosted-tier revenue from running workflows.

**What it gives back:**
- We stay the layer, not an app.
- No ops nightmare — we never run user code.
- Engineering bandwidth stays on the substrate (Account Record + Mind).
- A clean marketing wedge: every other GTM tool is shipping more UI; we
  ship less, and that's the product.
- Open source stays observable end-to-end — the user's data lives in their
  database, their workflows run on their account, their code lives in their git.

## Decision

**Option B.** Stay all-in on Claude Code. Skills + routines + the user's own
git. We never run workflow code for the user.

Concretely:

- **Skills** live in the [`gtm-skills`](https://github.com/bennetglinder1/gtm-skills)
  repo. Layout follows the Zevenue pattern: `.claude/skills/<name>/SKILL.md`.
  Users install one with a `curl` one-liner, or clone the repo into a project
  so Claude Code auto-discovers every skill.
- **Routines** are Claude Code routines — packaged configs of a prompt + a
  repo + MCP connectors + triggers (schedule / API / GitHub event). They run
  on Anthropic-managed cloud (or as local Desktop scheduled tasks). We don't
  host them; users create them at `claude.ai/code/routines` or via
  `/schedule` in the CLI. We ship the **prompt + setup recipe**; they create
  the routine on their account.
- **Webhooks** land on Nous as data — observations on entities via
  `/api/public/signals/ingest`. They are **not** workflow triggers. The
  user's routine reads new signals on its next run and acts.
- **Outbound tools** (Lemlist, Smartlead, Instantly, etc.) attach to the
  routine as MCP connectors. Nous never proxies outbound for the user.

## Why (anchored in the charter)

The Nous Founding Charter has two lines that decide this without ambiguity:

> *"Built for agents, not dashboards — the agent is the operator, the MCP
> call is the product; rules out adding UI to paper over a missing
> capability."*
>
> *"Nous is not one of fifteen GTM apps — it is the layer the other fifteen
> sit on, the default account record GTM agents are built on."*

Option A violates both. Option B is the literal expression of both.

## Architecture

```
                ┌──────────────────────────────────────┐
                │   Nous = the state layer             │
                │   • Account Record (entities)        │
                │   • observations (signals)           │
                │   • inbound webhooks land here       │
                │   • the Mind learns from outcomes    │
                └──────────────────┬───────────────────┘
                                   │ MCP / API key
                ┌──────────────────┴───────────────────┐
                │   Claude Code = the worker           │
                │   • skills (the what)                │
                │   • routines (the when + connectors) │
                │   • lives in the user's git + their  │
                │     claude.ai routine config         │
                └──────────────────────────────────────┘
```

Three trigger types map cleanly onto this:

| Trigger | How it works | Whose runtime |
|---|---|---|
| **Schedule** | claude.ai routine → daily / weekly / cron | Anthropic cloud |
| **API**      | per-routine HTTPS endpoint, bearer-token POST | Anthropic cloud |
| **GitHub**   | repo event → routine fires | Anthropic cloud |
| **Webhook (external)** | RB2B / signalbase / Apify / etc. → `POST /api/public/signals/ingest` on Nous → observation lands → next scheduled run picks it up | **Nous = event store, never workflow runtime** |
| **Local schedule** | Desktop scheduled task → `claude -p "/skill"` | the user's machine |

The webhook path is the subtle one: **Nous receives the webhook as data, not
as a trigger.** The user's routine drains the queue on its own cadence. We
stay the state layer; the agent stays the operator.

## What this rules out, going forward

To be deliberate about the trade-off:

- **No hosted dashboard.** Not even a free tier. It is the slow creep into
  being an app.
- **No workflow runtime on Nous infra.** Webhook *ingestion* is fine (it's
  data). Executing user code on our boxes is not.
- **No "Nous-hosted Claude Code".** Same trap, different wrapper.
- **No UI added to paper over a missing capability** — fix the capability.

## Consequences

- The `gtm-skills` repo becomes the lead magnet. Every new GTM job we look at
  ships as a skill or a routine recipe there, never as a Nous feature.
- The MCP is the only product surface that talks to user code. It must stay
  fast, observable, and rich.
- Marketing language hardens: *"You don't need another app. Drop our skills
  into your Claude Code. We hold what's happening; your agent acts on it."*
- One next thing to build (this commit's sibling): the
  `chase-non-responders` routine — a daily Claude Code routine that finds
  leads who went quiet on email or LinkedIn and drafts the follow-up using
  the full Nous account record. Lives in `gtm-skills/routines/`.

## See also

- The Nous Founding Charter (May 21, 2026) — the litmus test this decision
  was checked against.
- Claude Code routines documentation:
  https://code.claude.com/docs/en/routines
- The [`gtm-skills`](https://github.com/bennetglinder1/gtm-skills) repo —
  where skills and routine recipes live.

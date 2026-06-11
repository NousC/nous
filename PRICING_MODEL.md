# Nous Pricing Model — Source of Truth

> Status: **final design, pre-implementation.** This is the agreed model. Code in
> `apps/api/src/lib/plans.mjs` + `access.mjs` partially implements it (ops meter, grace,
> cloud-only gate) and must be updated for the rest (records meter, profile count,
> removal of tier feature-gates). Implementation delta is at the bottom.

---

## 1. Philosophy

Nous is **operated by an agent, not a human at a seat.** So we don't sell seats and we
don't gate the agent's tools behind tiers — an agent that hits "upgrade to use this tool"
mid-task is a broken product. Instead:

- **Meter the work and the stock, not the features.** Two meters do all the tiering.
- **The intelligence brain is always free** — on every tier and on self-host. ICP, scoring,
  context, the self-improving loop. It costs us ~$0 (deterministic or sub-cent Haiku) and
  it's the moat. Charging for it is the Octave mistake (opaque, unforecastable burn).
- **External data is BYOK, zero markup, off-meter.** Your keys, our orchestration, no
  middleman margin. This is the honesty wedge against Clay-style markup.
- **One number per axis, published, with a spend cap and a grace window.** Forecastable.
  This is the thing none of the competitors get right (Clay = two confusing credit types;
  Octave = one opaque credit; ZoomInfo = quote-only).

The whole model is: **2 meters + 2 BYOK passthroughs + 2 gates + 1 grace model.**

---

## 2. The two meters

| Meter | What it is | What lands on it |
|---|---|---|
| **Operations / mo** (the *flow*) | Work the agent + ingest perform | Agent/MCP/SDK/API calls (get_context, record, query, attention, verify…), inbound webhook ingest, scans, signal extraction |
| **Records** (the *stock*) | What the workspace *holds* | Every **unique person + company** = 1 entity. Lead-list people, CRM contacts, scraped LinkedIn engagers, companies — all one unit |

**Why two and not one:** importing 1,200 leads is a *stock* event, not 1,200 operations
(import already logs `billable_ops=0` in code). The agent doing its job is *flow*. They are
different things in the schema and they stay different in pricing.

**The records dedup story (say this loudly):** records counts **unique humans and
companies**, not list rows. The same person in five lead lists, who is also a CRM contact
and a LinkedIn engager, is **one record** — because it's one row in the `entities` table.
Nobody else prices this honestly. ZoomInfo charges per contact-view; we charge per unique
person you actually keep.

---

## 3. The tiers

| | **Free** | **Start** | **Pro** | **Growth** | **Partner** |
|---|---|---|---|---|---|
| **Price** | $0 | $29/mo | $99/mo | $249/mo | $500/mo base + $100/client (5 incl.) |
| **Operations / mo** | 1,000 | 10,000 | 25,000 | 100,000 | 100,000 per client (500k pool @ 5) |
| **Records** (people + companies) | 100 | 1,000 | 10,000 | 100,000 | 100,000 per client |
| **Connected LinkedIn profiles** | 0 | 0 | 1 | 3 | per client |
| **Workspaces** | 1 | 1 | 1 | 3 | 5+ (per client, Stripe qty) |
| **CRM Sync** | cloud ✓ | cloud ✓ | cloud ✓ | cloud ✓ | cloud ✓ |
| **Lead Lists** | cloud ✓ | cloud ✓ | cloud ✓ | cloud ✓ | cloud ✓ |
| **Full intelligence brain** | ✓ | ✓ | ✓ | ✓ | ✓ |
| **BYOK enrichment (Apollo/Prospeo)** | ✓ no markup | ✓ | ✓ | ✓ | ✓ |
| **BYOK Apify (LinkedIn scrape)** | ✓ no markup | ✓ | ✓ | ✓ | ✓ |
| **Support** | community | email | priority | priority | priority + partner |

> **Change from current code:** today `leadLists` is gated Pro+ and `crmSync` is gated
> Growth+ *by tier*. In the final model those tier-gates are **removed** — both are
> available on every **cloud** tier. The **records meter does the tiering** (a Free user
> technically has Lead Lists + CRM Sync but can only hold 100 records, so it's a taste;
> connecting a real CRM blows past 100 instantly → upgrade). The only gate left on these
> two is **cloud-vs-self-host** (see §6).

---

## 4. Records — definition & counting

- **1 record = 1 row in `entities`** where `type IN ('person','company')`.
- Leads, contacts, and CRM accounts are **the same table, different views** (`leads` view =
  entity in a collection; `contacts` view = entity past the interaction gate; CRM account =
  entity with a CRM identifier). One human = one entity = one record regardless of how many
  views they appear in.
- **No per-list, per-view, or per-CRM double counting.** Dedup is structural (the entity id).
- Count is **per team**, summed across the team's workspaces (mirror `team_ops_used`).
- The `ops_accounts_limit` column already exists on `teams` (currently vestigial) — wire the
  records limit through it rather than adding a new column.

---

## 5. LinkedIn engagement scraper — no third meter

The weekly LinkedIn engagement worker resolves entirely onto the existing axes:

1. **Output → records.** Every engager it surfaces is a person entity. Deduped — the same
   engager week after week is **one record**. So scraping naturally fills the records meter:
   the more you scrape, the fuller your book, the faster you approach the limit, the sooner
   you upgrade. **The records meter is the scraper's monetization** — we never price the
   scrape itself, we price the consequence (a bigger book of people). This is a growth
   flywheel, not a leak.
2. **The scrape run → operations.** Each weekly run is a handful of ops. Negligible, never
   blocked.
3. **The connected LinkedIn profile is the gated resource** — a *count of profiles*, not a
   usage meter. It's the agent-era replacement for "seats": the profile is the scarce, risky
   asset (a real LinkedIn session, carrying Apify COGS per run). Gated per tier (0/0/1/3/per-client).
4. **Apify cost → BYOK** (their key, no markup, off-meter), consistent with enrichment. If
   they don't connect a key, the run draws ops. Either way, no new metering machinery.

---

## 6. The two gates

| Gate | What it does | Mechanism |
|---|---|---|
| **Cloud-only** | CRM Sync + Lead Lists are **not available on self-host** (governance / hosted-value line). Everything else on self-host is open + unmetered. | `CLOUD_ONLY_FEATURES = {crmSync, leadLists}` in `access.mjs` (already exists) |
| **Connected-profile count** | How many LinkedIn profiles a plan can connect (0/0/1/3/per-client) | New check at profile-connect time |

There are **no tier feature-gates** beyond these. The agent always has its full toolset on
every plan. Tiering is done by the two meters + the profile count.

---

## 7. What is ALWAYS free (every tier + self-host)

The brain. Never metered, never gated, because it costs us ~$0:

- **ICP scoring** — deterministic scorecard math, $0/lead.
- **Context assembly** — `get_context`, `get_account` — deterministic retrieval, $0.
- **GTM profile** — `get_gtm_profile`, `update_gtm_profile` — pure data layer, $0.
- **The Mind self-improving loop** — nightly, ~$0.004/workspace Haiku, amortized into base.
- **All read/reasoning MCP tools** — `query`, `attention`, `verify`, `lead_coverage`,
  `check_leads`, `save_note`, `search_notes`.
- **The scorecard seed / `build_scoring_model`** — one-shot Haiku on setup, ~$0.001.

(These still *count as operations* when an agent calls them — that's the ops meter doing its
job — but they are never feature-gated and never separately priced.)

---

## 8. Grace model — one model, reused on both meters

Identical shape everywhere (already built for ops in `plans.mjs` / `access.mjs`):

```
under 80%        → ok
80%+ under limit → warn   (banner: "you're close")
at/over limit    → grace  (3 days, everything still works)
grace expired    → restricted
```

**Ingest is NEVER blocked, on either meter.** Captured GTM signal is never lost.

| Meter | What "restricted" blocks | What still works |
|---|---|---|
| **Operations** | Active agent + outbound ops (402 `upgrade_required`) | All inbound ingest (webhooks, pollers) |
| **Records** | **Proactive** record creation: lead-list imports, scraper runs, bulk manual adds | Organic ingest — a reply from a known contact, a webhook, an engager from someone you already talk to, still creates entities |

Message tone (both): *"You're approaching your {ops|record} limit. You have 3 days to
upgrade or trim before {new ops|new imports & scraping} pause — your existing data and live
incoming signal are untouched."* Never destructive, never a wall mid-conversation.

Fail-open: a metering bug must never take down live customer automation (already the case in
`requireOpsBalance`).

---

## 9. Full feature → pricing map

Everything Nous does, and where it sits. **Default is "all tiers, free."** Only the
exceptions (cloud-only, profile-gated, BYOK-cost) are called out.

### Intelligence (always free, all tiers + self-host)
- ICP scorecard & live 0–100 fit scoring · self-improving Mind loop · evolving GTM context
  (8 sections, supersession) · predictions + outcome tracking · attention/care queue · fact
  freshness & confidence · reply classification · stage derivation.

### Agent surface — MCP / SDK / CLI / REST (always available; calls draw ops)
- `get_context`, `get_account`, `record`, `query`, `attention`, `verify`, `get_gtm_profile`,
  `update_gtm_profile`, `get_workspace_status`, `set_workspace_profile`, `build_scoring_model`,
  `record_closed_deals`, `save_note`, `search_notes`, `check_leads`, `lead_coverage`,
  `lead_list_operations`, `connect_integration`, `configure_crm_sync`, `set_trigger`,
  `list_triggers`, `get_routing_preferences`. CLI mirrors the v2 API. Hosted MCP at
  `mcp.opennous.cloud`.

### Records-bearing features (all cloud tiers; tiered by the records meter)
- **Lead Lists** (cloud-only): CSV import, custom columns, per-lead ICP score, email status,
  channel history, reply outcomes, Clean List coverage check, push to Instantly/Lemlist/
  HeyReach/Smartlead. — *records meter tiers usage.*
- **CRM Sync** (cloud-only): bi-directional HubSpot/Pipedrive/Attio, auto-create policy +
  ICP threshold, hygiene reconciliation (weekly/monthly), proposal queue. — *synced contacts
  count as records.*
- **People / Accounts / Companies** views over the unified entity graph.

### LinkedIn engagement (profile-gated)
- Weekly engagers → native list. Output = records. Run = ops. Profiles = 0/0/1/3/per-client.
  Apify = BYOK.

### Integrations (all tiers, free to connect)
- **Enrichment (BYOK, no markup):** Apollo, Prospeo.
- **Sequencers:** Instantly, Lemlist, HeyReach, Smartlead, EmailBison.
- **CRMs (cloud-only sync):** HubSpot, Salesforce, Pipedrive, Attio.
- **Meetings:** Fireflies, Fathom, Cal.com, Calendly.
- **Email:** Gmail (OAuth), SMTP/IMAP.
- **Social/data:** LinkedIn (Unipile), Apify (BYOK).
- **Product/PLG:** Stripe, Nous CLI event tracking, RB2B.
- Inbound webhooks + outbound triggers (event catalog).

### Skills (free; consume the agent surface + BYOK providers)
- `lead-builder`, `sales-nav-builder`, `meeting-brief`, `linkedin-engagers`, `deep-research`.

### Workspaces
- 1 / 1 / 1 / 3 / (5+ per-client Stripe quantity).

### Operator-only (not a customer tier — internal, ADMIN_EMAILS)
- CMS, Changelog, Roadmap, Updates, Media, Resources, Support dashboard, Affiliates.
  Empty allowlist on self-host (operators don't get Bennet's admin surface).

---

## 10. The two BYOK passthroughs (off-meter, zero markup, every tier)

| Passthrough | Provider | Cost path |
|---|---|---|
| **Enrichment** (verify email / enrich) | Apollo, Prospeo, etc. | Customer's own key, pays provider directly. `enrichmentsPerMonth: 0` on all plans → `requireEnrichmentQuota` passes through. |
| **LinkedIn scrape** | Apify | Customer's own key, pays Apify directly. No markup. |

Both keep all external-data COGS off our P&L. This is the "your keys, our orchestration, no
markup" pitch — the differentiator against Clay's 150-provider marketplace margin.

---

## 11. Implementation delta (from current code → this model)

Current state (`plans.mjs`, `access.mjs`) already has: the ops meter, `team_ops_used`, the
warn→grace→restrict machinery, the cloud-only gate, BYOK enrichment passthrough, the Partner
per-client Stripe-quantity model. **Reuse all of it.** What changes:

1. **Add the records meter.**
   - Add `recordsLimit` to each plan in `plans.mjs`: `free:100, starter:1_000, pro:10_000,
     growth:100_000, scale:100_000` (per client).
   - `getTeamRecordsUsage()` — `count(entities where type in person/company)` across the
     team's workspaces (parallel to `getTeamEnrichmentUsage`). Wire through the existing
     vestigial `teams.ops_accounts_limit` column.
   - `getTeamRecordsState()` — clone `getTeamOpsState`, reuse `OPS_GRACE_DAYS` /
     `OPS_WARN_PCT`; new `team_records_grace` table (clone `team_ops_grace`).
   - `requireRecordsBalance` middleware — clone `requireOpsBalance`, but **only gate
     proactive record creation** (lead-list import, scraper enqueue, bulk add). Never gate
     organic ingest.

2. **Remove the tier feature-gates on Lead Lists + CRM Sync.**
   - Set `leadLists: true` and `crmSync: true` on **all** plans (Free → Partner). They stay
     in `CLOUD_ONLY_FEATURES`, so self-host still can't use them; cloud tiers all can.
   - The records meter now does the tiering that the feature flags used to.

3. **Add the connected-profile count.**
   - Add `linkedinProfiles` to plans: `free:0, starter:0, pro:1, growth:3, scale:per-client`.
   - Enforce at profile-connect time (count connected Unipile/LinkedIn integrations vs limit).

4. **Expose both meters** in `/usage` UI + the public pricing page (ops + records bars,
   profile count, what's BYOK).

5. **Keep:** ops allowances (revisit Pro 25k — may be low for an all-day agent), Partner
   per-client billing, fail-open, self-host bypass.

---

## 12. One-line summary

**Two meters (operations + records), two BYOK passthroughs (enrichment + Apify), two gates
(cloud-only + connected-profile count), one grace model — and the entire intelligence brain
free on every tier.** Sophisticated enough to monetize scale fairly, simple enough that a
buyer reasons about exactly two numbers.
</content>
</invoke>

# Multi-Account Foundation — Scope

> Status: **design scope, pre-build.** Companion to [PRICING_MODEL.md](./PRICING_MODEL.md).
> Goal: let one workspace run multiple operating identities (reps) — each with their own
> LinkedIn account and mailbox(es) — over a single shared, deduped customer graph, with
> every interaction attributed to the rep it came through. Plus the one gate we keep:
> connected-LinkedIn-account count per plan.

---

## 1. The model decision (settled)

A GTM agency with 6 reps, each with their own LinkedIn + email, is **one workspace** — not
six. Reps are **connected accounts inside** a workspace, not separate workspaces.

- **The shared graph is the product.** Six per-rep workspaces = six siloed graphs. If two
  reps touch the same company, the agency must see one relationship (kills the "two reps
  cold-emailing the same buyer" problem). Sharding by employee destroys identity resolution.
- **Dedup / records meter.** One shared book = a lead is one entity, bought once. Six
  workspaces = the same lead bought six times, 6× enrichment spend, inflated record count.
- **Attribution, not separation.** "Whose relationship is this?" is answered by tagging each
  interaction to the rep's account — not by giving each rep their own silo.

**Two orthogonal axes:**

| Axis | Unit | Billing |
|---|---|---|
| Clients / brands | **workspace** | Partner ($100/client) |
| Reps (their LinkedIn + mailbox) | **connected account** inside a workspace | LinkedIn count gate (below) |

So: agency's *own* outbound, 6 reps → **one workspace**, 6 connected accounts. Agency running
GTM for 6 *clients* → **Partner, 6 client workspaces**, each with its reps' accounts connected.

---

## 2. The one gate we keep: connected-LinkedIn count per plan

We removed all feature tier-gates except this one. LinkedIn accounts are gated **because they
cost** (real Unipile/Apify spend + risk per connected session) — so the number a workspace can
connect is the plan lever.

| | Free | Start | Pro | Growth | Partner |
|---|---|---|---|---|---|
| **Connected LinkedIn accounts** (per workspace) | 0 | 1 | 1 | **5** | 1 per client workspace |
| **Connected mailboxes** | unlimited | unlimited | unlimited | unlimited | unlimited |

- **Hard gate at connect time**, no grace window (it's a "buy the plan" gate, like a feature —
  not a usage meter). Trying to connect an Nth LinkedIn over the limit → blocked with an
  upgrade prompt.
- **Over Growth's 5 → "talk to us."** No self-serve per-additional-profile pricing —
  explicitly out of scope (see §6). The block message routes to contact, not a checkout.
- **Mailboxes are ungated** — connect as many as you want on any cloud plan. LinkedIn is the
  only count-gated resource.
- The gate is **per workspace**, so Partner's many client workspaces each get their own 3.
- Cloud-only (LinkedIn engagement is already cloud-only); self-host is unaffected.

---

## 3. Schema reality today (what blocks this)

1. **LinkedIn is hard-capped at 1 per workspace** — `workspace_linkedin_connections` has
   `UNIQUE (workspace_id)`. Multi-LinkedIn literally can't exist until this is lifted.
2. **Mailboxes already support multiple** — `workflow_provider_connections` is unique on
   `(workspace_id, provider_id, name)`, so N Gmail accounts coexist. ✅ no change needed.
3. **Observations carry no rep/account owner.** `observations` has `source` ('gmail','agent')
   and `method` ('webhook'), but nothing says *which* mailbox/LinkedIn it came through. The
   graph is shared but unattributed. This is the gap behind "tag everything to a person."

---

## 4. Build plan

### Phase 1 — Multi-LinkedIn + the count gate (delivers the ask)

**Schema** (`supabase/migrations/…_multi_linkedin.sql`):
- `ALTER TABLE workspace_linkedin_connections DROP CONSTRAINT … UNIQUE (workspace_id)`.
- Add `UNIQUE (workspace_id, unipile_account_id)` (prevent connecting the *same* account
  twice), `label TEXT`, `owner_user_id UUID REFERENCES users(id)`, `is_active BOOLEAN DEFAULT true`.
- Keep the existing index on `workspace_id`.

**Plan config** (`plans.mjs` + `plans.ts`):
- Add `linkedinProfiles`: free 0, starter 1, pro 1, growth 5, scale 1 (per client workspace).

**Gate** (`access.mjs` + the connect route in `apps/api/src/services/linkedin.mjs`,
~line 637 where the row is upserted):
- New `assertLinkedinSlot(workspaceId, plan)`: count active rows in
  `workspace_linkedin_connections` for the workspace; if `count >= plan.linkedinProfiles`,
  throw `linkedin_limit_reached` (402) with an upgrade/contact message. Check it **before**
  starting the Unipile connect, so the user is stopped before a half-finished link.
- `linkedinProfiles: 0` (Free/Start) → connect blocked entirely.

**Worker** (`apps/worker/src/workers/linkedinEngagement.mjs`, reads at ~line 279):
- Iterate **all** active connections for the workspace instead of the single row; run the
  weekly engagement scrape per connected account. Each scraped engager is still one entity
  (deduped) → flows into the records meter as today.

**Touch-ups:** `routes/api/linkedin.mjs` (the delete at line 74 currently nukes *all* rows
for a workspace — make it target a specific `unipile_account_id`); `webhooks.mjs:149` and
`workspaceStatus.mjs:92` (presence checks) → "has ≥1 active connection".

> After Phase 1: a Growth workspace can connect 3 LinkedIn accounts; Free/Start none; over
> the limit is blocked. The agency's 6 reps connect their mailboxes freely and up to 3
> LinkedIn accounts per workspace.

### Phase 2 — Per-rep attribution ("tag everything to a person")

**Unified operating-identity table** `workspace_accounts`:
```
workspace_accounts (
  id           uuid pk,
  workspace_id uuid fk,
  channel      text check (channel in ('email','linkedin')),
  external_id  text,          -- email address OR unipile_account_id
  label        text,          -- "Sarah Chen"
  owner_user_id uuid null,    -- optional link to a Nous login
  is_active    bool default true,
  connected_at timestamptz default now(),
  unique (workspace_id, channel, external_id)
)
```
LinkedIn connections and mailboxes both register a `workspace_accounts` row (the LinkedIn
table can keep its Unipile detail and link by `external_id`).

**Attribution on observations:**
- Add `observations.via_account_id UUID REFERENCES workspace_accounts(id)` (nullable — null
  for non-channel obs like enrichment).
- Populate it in the ingestion handlers: the LinkedIn webhook already carries
  `unipile_account_id`; the Gmail webhook knows its mailbox → resolve to a `workspace_accounts`
  row and stamp `via_account_id`.

**Surfaces it unlocks:**
- Per-rep filtering on People/Accounts ("show Sarah's pipeline").
- **Relationship owner** = the rep with the most/most-recent interactions on a contact →
  routing ("Sarah owns Acme — don't let Tom email them"), the agency's core anti-collision need.
- Per-rep reporting.

---

## 5. File touchpoints (quick map)

- `supabase/migrations/` — Phase 1 (drop unique + columns), Phase 2 (workspace_accounts +
  observations.via_account_id).
- `apps/api/src/lib/plans.mjs` / `apps/frontend/src/config/plans.ts` — `linkedinProfiles`.
- `apps/api/src/lib/access.mjs` — `assertLinkedinSlot` / `requireLinkedinSlot`.
- `apps/api/src/services/linkedin.mjs` — gate before connect (~637); per-account reads.
- `apps/api/src/routes/api/linkedin.mjs` — per-account connect/delete.
- `apps/worker/src/workers/linkedinEngagement.mjs` — iterate connected accounts.
- Ingestion handlers (`apps/worker/src/webhooks/handlers/linkedin.mjs`, Gmail) — Phase 2 `via_account_id`.

---

## 6. Non-goals (explicit)

- **No per-additional-LinkedIn-profile pricing.** Over the included count is a contact-us
  conversation, not a self-serve add-on. (Owner decision.)
- **No mailbox gating.** Mailboxes stay unlimited on every cloud plan.
- **No per-rep workspaces.** Reps are connected accounts, not workspaces.

---

## 7. One-line summary

One workspace, one shared deduped graph, many reps modeled as connected accounts — LinkedIn
account-count gated per plan (Growth 3, hard gate, no add-on), mailboxes free, and every
interaction tagged to the rep it came through.
</content>

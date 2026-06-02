# CRM Sync

How Nous keeps a connected CRM (HubSpot, Pipedrive, Attio) in step with the
customer graph.

**The wedge.** Every sync tool moves field values. MDM platforms
(Syncari, Openprise) and reverse-ETL (Census, Hightouch) move fields without
reasoning; enrichment tools (Clay, ZoomInfo) write data without provenance.
Nous attaches the **proof** — the signal, the source, the date — to every
proposed change, and a human signs off on the evidence, not just the value.
"Update-with-proof" is the thing no MDM or reverse-ETL platform does, and it is
a direct expression of the evidence substrate. Propose-only is not "we're not
finished" — it's "we show our work."

**Ownership model — field-level split ownership.** Nous is *not* the system of
record for the CRM. The CRM remains the system of record for everything
revenue-shaped: record ownership, pipeline stage, lifecycle, deals, and any
custom properties. Nous owns a **thin slice of contact/account attributes**
(title, seniority, company, industry, ICP score) where it holds first-hand
evidence. Reconciliation is per-field, governed by a **field-ownership matrix**
(§4.1) — which system owns which field. That matrix is the contract; it is
intended to become a first-class, customer-visible config, not a doc appendix.

Data moves four ways — pull, push, create, hygiene. Configuration and the live
event log live on the **CRM Sync** page (`apps/frontend/src/pages/CrmSync.tsx`).
Settings are stored per connection in `crm_sync_configs` (unique on
`workspace_id, provider`). Every action is written to `workspace_system_log`
and shown in the live log.

> **Status legend.** **[Built]** = shipped in code (pending deploy).
> **[Designed]** = specified here, not yet implemented. Read the tags — several
> hygiene mechanics below are design, not behavior.

---

## 1. Pull — read from the CRM · [Built]

**Source:** `packages/core/src/integrations/crm/index.ts` → `syncCrmProvider()`;
worker `apps/worker/src/workers/crmSync.mjs`; cron `0 2 * * *` in
`apps/worker/src/index.mjs`.

When **Auto-sync** is on (`crm_sync_configs.auto_sync`), a daily job pulls
contacts, companies, and deals updated since `last_synced_at` and upserts them.
**Sync now** runs the same path on demand.

- Contacts match by `{provider}_id`, then email; companies by
  `{provider}_company_id`, then domain.
- Logged as `sync_complete` / `sync_partial` / `sync_failed`, e.g.
  `hubspot sync — fetched 45 (c:40 co:5 d:0), 12 new, 8 updated`.

Pull tells Nous what the CRM currently holds. It does **not** decide truth — and
critically, CRM-sourced values must be quarantined so hygiene never proposes
writing the CRM's own data back to it (see §4.4, provenance & loop prevention).

---

## 2. Push — log touchpoints back · [Built]

**Source:** `packages/core/src/services/crmPush.ts` → `pushActivityToAllCrms()`,
fired fire-and-forget from `logActivity` (`packages/core/src/db/activities.ts`).
Controlled by `crm_sync_configs.push_activities`.

When a real milestone happens in outbound, Nous logs it onto the matching CRM
record as a native engagement (HubSpot meeting/email/note, Pipedrive activity,
Attio note). **Only high-signal touchpoints are pushed.** This is the hard
lesson every activity-logging tool (Gong, Dooly, Scratchpad) learned: over-log
and reps revolt. The low-signal noise (every send, every open, every
back-and-forth) stays in the graph and never reaches the CRM.

Pushable types (`PUSHABLE_TYPES`):

```
email_reply / email_received   linkedin_message   linkedin_connected
meeting_scheduled              meeting_held
proposal_sent / viewed / signed
deal_created / deal_won        trial_started
```

Reliability: 15s timeout, retry on 429/5xx with backoff, per-provider
`Promise.allSettled` (one CRM failing never blocks another), and per-activity
idempotency via `observation_crm_pushes` so a webhook replay never double-posts.

---

## 3. Create — only earned records · [Built]

**Source:** `crmPush.ts` — `evaluateCreateGate()` and the find → gate → create
flow in `pushOne()`. Settings: `crm_sync_configs.create_*`.

A prospect not yet in the CRM is created automatically **only** once they clear
a per-workspace gate, so every record is an earned hand-raise rather than CRM
pollution.

1. Use the cached `{provider}_id` → log onto the existing record.
2. Otherwise **search** by email (`findCrmContact`) → if found, log onto it.
3. Still not found → apply the **create gate**; pass → create
   (`createCrmContact`), fail → `creation_skipped` with the reason.

| Setting | Default | Meaning |
|---|---|---|
| `create_in_crm` | `true` | master switch |
| `create_trigger` | `positive_reply_or_meeting` | what promotes a prospect |
| `create_require_icp_fit` | `true` | also require an ICP-fit floor |
| `create_icp_threshold` | `70` | the floor |

`create_trigger` ∈ {`any_reply_or_meeting`, `positive_reply_or_meeting`,
`meeting_only`, `interested_stage`}. Sales events always earn a record.
Reply sentiment is classified once at the worker choke point
(`apps/worker/src/utils/activity.mjs` → `signals/replySentiment.mjs`, Haiku).

> **Known gap — routing.** Create does **not** set an owner or territory. RevOps
> always routes a new record; an unowned contact is a real gap. Owner
> assignment (round-robin / territory rule / leave-to-CRM-workflow) is
> **[Designed]**, not built.

---

## 4. Hygiene — keep attributes reconciled

> **Status (current):** **Built and live-tested against a real Attio workspace.**
> - **Reconcile (propose):** net-new enrich+score, ICP rescore, and free-text
>   field reconcile (job_title/company/phone) — all generate proposals with their
>   evidence + provenance gate. ✅
> - **Apply on approve:** approving a proposal **writes it to the CRM** — field
>   writes (text + structured) and ICP write-back (provisions `nous_icp_*`,
>   writes score/fit/scored_at/reason). Optimistic concurrency; `conflict` never
>   auto-applies; reversible via `current_value`. ✅ (verified: Attio job_title,
>   phone, ICP score all landed live).
> - **Echo suppression:** an applied write isn't re-ingested by the next pull. ✅
> - **Still [Designed]:** the auto-apply ladder (`hygiene_auto_apply` safe/all +
>   dry-run) — today every apply is manual approve. The survivorship engine is the
>   `deriveClaim` confidence model (in use), not a separate module.
>
> **Open follow-ups:** Pipedrive ICP write (custom-field keys); per-provider write
> payloads are verified for Attio, lighter-tested for HubSpot; the "Nous"-branded
> actor on writes needs an Attio/HubSpot **app (OAuth)** connection instead of a
> personal API key (today writes show as the token's owner). See
> [crm-setup.md](./crm-setup.md) for required custom fields per CRM.

**Settings:** `crm_sync_configs.hygiene_enabled`, `hygiene_cadence`
(`weekly` | `monthly`), `hygiene_last_run_at`, `hygiene_auto_apply`.

On a schedule (and via **Run now**), Nous compares the CRM against what it knows
and writes proposed changes to `crm_hygiene_proposals` — each carrying the
current value, the proposed value, and the **evidence**. A human approves before
anything is written.

### 4.1 Field-ownership matrix · [Designed]

The reconciled fields — the *thin slice* Nous may touch. Everything not listed
(owner, pipeline stage, lifecycle, deal fields, custom properties) is
CRM-owned and never touched.

| CRM field | Backed by claim | Write rule | Type handling |
|---|---|---|---|
| job title | `job_title` | fill / update-with-proof | free-text — safe in v1 |
| seniority | `seniority` | fill / update-with-proof | enum — **deferred** (see §4.5) |
| company | `company` | fill / update-with-proof | free-text — safe in v1 |
| industry | `industry` | fill / update-with-proof | picklist — **deferred** (see §4.5) |
| employee count | `employee_count` | fill only | number |
| LinkedIn URL | `linkedin_url` | fill only | free-text |
| phone | `phone` | fill only | free-text |
| ICP score/fit | latest `icp_fit` prediction | write to Nous-owned field (§4.7) | number/enum |
| do-not-contact | observed opt-out signal | **compliance exception** (§4.6) | boolean |

Intended to graduate from this table to a customer-editable matrix (per field:
which system owns it, fill-only vs overwrite, auto vs propose).

### 4.2 Survivorship engine · [Designed]

"Nous wins when it has evidence" is a slogan, not something an engine can run.
The executable rule set (MDM golden-record survivorship, in the
Syncari/Openprise sense):

- **Source-trust ranking.** Claims are not monolithic. An observed opt-out
  (`do_not_contact` from a reply) outranks an enrichment-vendor `job_title`.
  Ladder (high → low): direct human/contact statement → first-party signal
  (reply, meeting) → enrichment vendor → inferred. A proposal carries the
  rank of its backing observation.
- **Recency arbitration — limited by what the CRM APIs expose.** Ideally, if a
  human edited the CRM field *after* our backing observation's date, the human
  wins. But only HubSpot exposes **property-level** history; Pipedrive and Attio
  give **record-level** modified dates, not per-field — so on 2 of 3 providers
  we cannot tell which field the human touched. **v1 rule (honest, sourceable):**
  if the CRM value is non-empty and differs from our claim, treat it as a
  `conflict` and never auto-overwrite — regardless of timestamps. True
  field-level recency arbitration is a HubSpot-only enhancement, not a
  cross-provider guarantee.
- **Confidence thresholds.** `confidence ≥ high` → eligible to propose an
  overwrite; `mid` → fill-only (never overwrite); `< low` → suppress entirely.
  The `confidence` column exists; the thresholds are the missing rule.
- **Rejection memory.** A human-dismissed proposal must not be regenerated next
  run and nag forever. A dismissal records a suppression (entity + field +
  proposed value, or a TTL) that the next run checks before re-proposing.

### 4.3 Proposal kinds (`crm_hygiene_proposals.kind`)

| Kind | Meaning | Status |
|---|---|---|
| `net_new` | a record we didn't create → enrich + score, fold into the graph | [Built] |
| `icp_rescore` | ICP score/fit to write back | [Built] |
| `field_fill` | CRM field empty + we have a claim → fill | [Designed] |
| `field_update` | CRM value differs from a fresher/evidence-backed claim | [Designed] |
| `conflict` | CRM holds a human value edited after our evidence → flagged, never auto-overwritten | [Designed] |
| `milestone_sync` | a high-signal milestone missing from the record | [Designed] |

History sync is **curated** — only milestones a rep wants on the timeline, never
the email firehose.

### 4.4 Provenance & loop prevention · [Designed] — biggest correctness risk

Pull ingests CRM values into the substrate. If those CRM-sourced values can
become claims, hygiene would propose writing the CRM's own data *back* to it — a
circular sync. The rule:

- CRM-sourced observations are tagged with their `source` (e.g. `hubspot`) and
  are **barred from backing a `field_update`/`field_fill` proposal to that same
  provider.** A claim only justifies a write-back if it has at least one
  *non-CRM* backing observation (reply, meeting, enrichment).
- **Echo suppression.** When hygiene (Phase 2) applies a write, it records
  "Nous wrote field X = V at T" (write-state). The next nightly pull will see
  the field as "updated since `last_synced_at`" and must diff against
  write-state to recognize its own echo and not re-ingest it as a fresh human
  edit. This is exactly the state-diff snapshot that Census/Hightouch use; we
  need the same.

### 4.5 Normalization · [Designed]

The field table is not 1:1 string writes. Real CRMs have picklist enums
(HubSpot `industry` is a fixed list), required fields, validation rules, and
custom-field IDs. A free-text `industry` claim either fails the write or creates
garbage. Therefore:

- **v1 writes restricted to free-text fields** (job_title, company, phone,
  linkedin_url). Enum/picklist fields (seniority, industry) are **deferred**
  until a value-mapping layer exists (claim value → CRM picklist option, per the
  category-standard mapping UI).

### 4.6 Compliance — the opt-out exception · [Designed]

Propose-only is correct for hygiene, but **wrong for an observed opt-out**. If
someone replies "do not contact me" and that sits unapplied awaiting approval
while outreach continues, that's a liability. So `do_not_contact` is the one
exception to propose-only:

- On observing an opt-out, Nous **immediately** flags the contact in the graph
  and **excludes them from create and push** (Nous's own surfaces), regardless
  of CRM state.
- Writing the opt-out to the CRM is the single **auto-apply** candidate
  (does not wait for approval). It is the natural first use of
  `hygiene_auto_apply` beyond `off`.

### 4.7 ICP write-back fields · [Designed — not implemented]

> No schema, no property-creation calls, no scope handling exist yet. This
> describes intended behavior.

Nous will **provision and own** a namespaced field set rather than overwrite a
team's own "ICP" field (whose definition and routing belong to their RevOps):

| Field | Type | Holds |
|---|---|---|
| `nous_icp_score` | number 0–100 | the score |
| `nous_icp_fit` | yes/no | above/below threshold |
| `nous_icp_scored_at` | date | freshness |
| `nous_icp_reason` | text | the reasoning |

To be created on first write via each CRM's property API (HubSpot properties,
Pipedrive person fields, Attio attributes), with a per-CRM **"map to an existing
field"** override (default = owned fields; mapping opt-in). Owned fields are
always ours to refresh; a team's own field is never touched unless mapped.

### 4.8 Scale & rate strategy · [Designed]

Push is per-activity and real-time — fine. A weekly scan across a full CRM is
thousands of records against HubSpot's 100/10s + daily caps, Pipedrive's token
budget, and Attio's limits. Required before any mid-size customer:

- **Incremental, not full-scan.** Only reconcile records changed since
  `hygiene_last_run_at` (a hygiene watermark, the way pull uses
  `last_synced_at`). Phase 1a's net-new/ICP passes are bounded by per-run caps;
  field reconcile must be watermark-driven.
- **Batched writes + throttling** that respect each provider's rate limits and
  honor `Retry-After` (the `crmFetch` backoff already does this for single
  calls; hygiene needs batch-level pacing).

### 4.9 Governance maturity · [Partially built]

`hygiene_auto_apply` is the staged-rollout ladder the category uses
(Openprise/Syncari: simulate → review → approve → auto):

- `off` — propose-only. Every change reviewed. **[Built default]**
- `safe` — auto-apply low-risk changes (fill empty fields, ICP score,
  opt-out); propose the rest. **[Designed]**
- `all` — auto-apply everything that passes survivorship. **[Designed]**

Add a **dry-run with an impact count** ("this would change N fields across M
records") before a workspace's first non-`off` apply.

### 4.10 Out of scope (named explicitly)

- **Dedup / merge of CRM-side duplicates** is a whole RevOps category and is
  **not** hygiene's job — it belongs to identity resolution
  (`docs/identity-resolution.md`). Hygiene assumes a resolved entity.
- **Owner/territory routing** on create — see the §3 known gap.

---

## Building blocks reused

- `syncCrmProvider()` — pull / drift fetch
- `getClaims()` / `assembleContext()` (intent `account_review`) — the canonical
  "what do we know about this entity" read
- `enrichContact()` — on-demand enrichment (the front of an enrichment waterfall)
- `listSignals()` + `scoreAndStake()` — on-demand ICP (re)score
- `logWorkerRun()` + `workspace_system_log` — run telemetry and the live log

See also: [The ICP Model & GTM Context](./icp-and-gtm-context.md),
[Identity Resolution](./identity-resolution.md).

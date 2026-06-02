# CRM Hygiene — Phase 2 Spec (Apply / Write-Back)

**Status:** spec, not built. Companion to [crm-sync.md](./crm-sync.md) §4 and
[the Phase 1b spec](./crm-hygiene-phase-1b-spec.md).

**Posture change — read this first.** Every prior phase was read-only against the
CRM. **Phase 2 is the first code that writes to a live customer CRM.** That makes
it outward-facing and hard to reverse. The non-negotiables:

- **Nothing applies without a decision.** Default `hygiene_auto_apply = 'off'`: a
  proposal only writes after a human sets it `approved`. Auto-apply (`safe`/`all`)
  is opt-in per workspace and gated by a dry-run (Task E).
- **`conflict` proposals are never auto-applied** — human-only, always. A conflict
  means a human value disagrees with our evidence; a machine must not resolve it.
- **Every write is reversible.** We store the before-value (`current_value`, which
  proposals already carry) so any applied change can be rolled back.
- **Runtime-verify Phase 1b first.** None of Tasks 0–3 has run against a real CRM.
  Apply should not be built on an unverified read path — confirm proposals look
  correct on a real workspace before wiring writes.

**Scope:** apply `field_fill` / `field_update` (the free-text reconciled fields),
the ICP write-back, and the `do_not_contact` opt-out. Echo suppression so our own
writes don't loop. The `off → safe → all` governance ladder. Enum/picklist writes
stay deferred (crm-sync.md §4.5); dedup stays out (identity resolution).

---

## Task A — Write-back primitives (PATCH per provider) + ICP provisioning · [Partial]

> **Built:** `writeCrmRecordFields(provider, token, recordId, fields)` in
> `integrations/crm/index.ts` — PATCH standard free-text fields (HubSpot
> job_title/company/phone, Pipedrive phone, Attio job_title/phone). Payloads per
> API docs, **NOT runtime-verified** — test on a throwaway record first.
> **Not built:** `nous_icp_*` provisioning (schema API per provider) — so
> `icp_rescore` proposals can't apply yet. Enum/relationship writes still deferred.


The mirror of Phase 1b's `fetchCrmRecordFields`. Read-only's opposite — one
function per provider that PATCHes a record's reconciled fields.

`writeCrmRecordFields(provider, token, recordId, fields)` → ok | error:
- **HubSpot** — `PATCH /crm/v3/objects/contacts/{id}` `{ properties: { jobtitle,
  company, phone } }`.
- **Pipedrive** — `PUT /v1/persons/{id}` `{ phone: [...], ... }`. `company` is the
  org relationship (set via `org_id`, a lookup) — defer to a later pass; `job_title`
  is a custom field — out of scope.
- **Attio** — `PATCH /v2/objects/people/records/{record_id}` `{ data: { values: {
  job_title: [...], phone_numbers: [...] } } }`.

**ICP field provisioning (the `nous_icp_*` fields).** Idempotent ensure-exists on
first write, via each CRM's schema API:
- HubSpot `POST /crm/v3/properties/contacts` (a `nous` property group).
- Pipedrive `POST /v1/personFields`.
- Attio `POST /v2/objects/people/attributes`.
Cache "provisioned" per (workspace, provider) so it runs once. Then write
`nous_icp_score` / `nous_icp_fit` / `nous_icp_scored_at` / `nous_icp_reason`. The
per-CRM "map to an existing field" override (crm-sync.md §4.7) short-circuits
provisioning.

**Map** claim property → CRM property name lives next to the field-ownership
matrix, so read (Phase 1b) and write (here) share one source of truth.

---

## Task B — Apply flow + reversibility · [Built]

> **Built:** `applyProposal(proposal, token)` in `services/crmApply.ts` —
> optimistic concurrency (re-read; bail `stale` if the CRM moved), `conflict`
> never applies, only `field_fill`/`field_update` write today, reversible via
> `current_value`. Wired to the Approve button: approve → write → status
> `applied`/`failed` → `proposal_applied`/`_apply_failed` in the live log →
> frontend toast. Offline-verified (9 fixtures incl. the stale path). NOT
> runtime-verified against a live CRM.


`applyProposal(supabase, deps, proposalId)`:
1. Load the proposal; require `status = 'approved'` (or auto-eligible per Task E).
   Never apply `conflict`.
2. Re-read the CRM's **current** value (`fetchCrmRecordFields`). If it no longer
   matches the proposal's `current_value`, the record moved under us → mark
   `failed` with reason `stale` and stop. (Optimistic concurrency — don't clobber
   a change that happened after the proposal was raised.)
3. `writeCrmRecordFields(...)` the `proposed_value`.
4. On success: `status = 'applied'`, `applied_at = now`, and **record write-state**
   (Task C). On failure: `status = 'failed'`, store the error.

Reversibility: `current_value` is the pre-write value; a revert re-PATCHes it.
A batch apply runs approved proposals throttled (provider rate limits, as Phase 1b
reads do), logging applied/failed/skipped counts to `workspace_system_log`.

---

## Task C — Echo suppression (the load-bearing safety)

When apply writes field X = V to provider P, the next nightly pull sees X as
"updated since `last_synced_at`" and would re-ingest V as a fresh CRM-sourced
observation — noisy, and it would make our own write look like CRM evidence.

**Mechanism — write-state table** `crm_write_state (workspace_id, provider,
crm_record_id, property, value, written_at)`, upserted on every apply. The pull
path consults it: when about to write a CRM-sourced state observation for
(record, property), if it matches write-state value within a window, **skip the
observation** (it's our echo, not new information). The provenance gate already
prevents value-level loops; this is the event-level belt-and-braces the spec
flagged (Phase 1b §4.4). This is the state-diff snapshot Census/Hightouch use.

Open question to resolve in build: whether to skip the observation entirely or
write it with `method = 'echo'` and exclude `echo` from provenance + claim
derivation. Skipping is simpler; tagging keeps an audit trail. Lean tag-and-exclude.

---

## Task D — `do_not_contact` (compliance)

Two independent pieces, decoupled on purpose:
1. **Internal suppression (can ship before the rest of Phase 2).** On observing an
   opt-out, immediately exclude the contact from Nous's own **create** and **push**
   surfaces, regardless of CRM state. This is internal (no CRM write) and is a
   compliance obligation, so it should not wait for the approval queue.
2. **The CRM write** is the single **auto-apply** candidate — written without
   waiting for manual approval (the first legitimate use of `hygiene_auto_apply`
   beyond `off`), because an unapplied opt-out sitting in a review queue while
   outreach continues is a liability.

---

## Task E — Auto-apply ladder + governance

`hygiene_auto_apply`: `off` (default — manual approve each) · `safe` (auto-apply
`field_fill` + `icp_rescore` + `do_not_contact`; propose `field_update` /
`conflict`) · `all` (auto-apply everything that passed survivorship; `conflict`
still never auto-applies).

**Dry-run before the first non-`off` apply.** Show an impact count — "this would
change N fields across M records, by kind" — and require an explicit confirm.
Silent first-time auto-apply across a CRM is exactly the failure mode RevOps
fears (crm-sync.md §4.9). Staged rollout: simulate → review → approve → auto.

---

## Build order (each step is one reviewable PR)

1. **Task D.1** — internal opt-out suppression. No CRM write; compliance; unblocks
   nothing else but is the cheapest real-world win. Can land first.
2. **Task A** — write primitives + ICP provisioning, behind a feature flag, dry
   (no caller yet). Unit-test the field mapping.
3. **Task B** — apply flow with optimistic concurrency, wired to the report's
   Approve button (manual `off` path only).
4. **Task C** — echo suppression + pull integration. Required before any
   auto-apply or before apply runs at volume.
5. **Task E** — auto-apply ladder + dry-run, last. Only after B+C are proven.

## Open verifications before coding

- Confirm exact PATCH/property-create endpoints + payload shapes per provider
  against current API versions (HubSpot v3, Pipedrive v1, Attio v2) — these are
  from memory and must be checked against live docs/sandboxes.
- Confirm the pull path's write site for CRM observations (where Task C hooks in).
- Decide echo handling: skip vs `method='echo'`-and-exclude.
- Confirm OAuth scopes on existing connections allow writes + schema changes
  (read scope ≠ write scope on HubSpot/Pipedrive).

# CRM Hygiene — Phase 1b Spec (Provenance + Survivorship + Propose-only Reconcile)

**Status:** spec, not built. Companion to [crm-sync.md](./crm-sync.md) §4.
**Posture:** every line of Phase 1b is **read-only against the CRM.** No live-CRM
write exists until Phase 2 (apply / echo suppression / auto-apply). Same risk
posture as the create/push work.

**Scope:** detect drift on the **free-text reconciled fields only** —
`job_title`, `company`, `phone`, `linkedin_url`. Enum fields (`seniority`,
`industry`) are deferred until a value-mapping layer exists (crm-sync.md §4.5).
Dedup/merge stays out of scope (it belongs to identity resolution). Multi-CRM
(two providers on one workspace) is out of scope for 1b.

---

## The key architectural decision: reconcile consumes claims, it does not re-derive survivorship

The substrate already resolves "what do we believe for field X" across all
sources. `claims` (`supabase/schema.v2.sql:217`) is **one row per
`(workspace_id, entity_id, property)`**, derived from the append-only
`observations` spine by `deriveClaim()` (`packages/core/src/db/claims.ts:61`),
which already applies recency + corroboration + contradiction + staleness and
exposes:

| Claim field | Use in reconcile |
|---|---|
| `value` (jsonb, argmax) | our believed value for the field |
| `confidence` (real 0–1, calibrated) | gates whether the claim is strong enough to act on |
| `epistemic_class` (`observed`/`inferred`/`predicted`/`asserted`) | `asserted` = human told Nous, sticky; `predicted` is never reconciled |
| `freshness` (`fresh`/`aging`/`suspect`/`expired`) | gates staleness |
| `supporting_observation_ids` (uuid[]) | **the provenance chain — the whole loop rule runs on this** |
| `observation_count` | corroboration strength for the conflict-vs-update decision |
| `last_observed_at` | recency |

Crucially, **the CRM's own value is already in this derivation**: CRM pull writes
the CRM value as an `observation` with `source = provider`, `method = 'crm_sync'`
(`packages/core/src/integrations/crm/index.ts:414`), so `deriveClaim()` already
weighed it. Therefore:

- If the CRM is the newest/only source of a value, `claim.value == CRM value` and
  reconcile emits **nothing** — the loop is prevented at the value level for free.
- `claim.value` differs from the CRM only because some **non-CRM** observation
  out-weighed the CRM one. That is precisely the "we have fresher/independent
  evidence" case reconcile exists to surface.

Reconcile is therefore a **projection decision**, not a survivorship engine:
*read the claim, read the CRM's current value, decide fill / update-with-proof /
conflict / no-op, never write.*

---

## Task 0 (prerequisite) — observation source fidelity · [Built]

**Why it blocks everything:** the provenance gate (Task 1) is only sound if a
field observation's `source` tells the truth about its origin. It did not.

`contacts_update_handler` (`phase4c_contacts_companies_to_views.sql:387`) derives
the emitted observation's `source` from the contacts row's `source` column
(`src := COALESCE(NEW.source, OLD.source, 'v1_compat')`), and the state-obs INSERT
only fires for fields where `new_v IS DISTINCT FROM old_v` (`:458`). Enrichment
(`enrichContact`, worker **and** API) wrote attribute columns but set
`enrichment_source`, never `source` — so its field observations inherited the
**record's origin**. That is worse than "lands as `v1_compat`":

- On a **CRM-pulled** contact (`source='hubspot'`), Apollo's `job_title` landed
  tagged `hubspot` — enrichment data **mis-attributed to the CRM**. The gate then
  sees only CRM support and (correctly) suppresses → reconcile silently
  **under-covers**.
- On a **reply-created** contact (`source='instantly'`), Apollo's `job_title`
  landed tagged `instantly` — third-party data masquerading as a first-party
  signal. It passes the gate under a **falsely high trust tier** — corrupting the
  ladder, not just coverage.

The naive "set `source` on the contacts update" is a trap: it overwrites the
record-origin `source` column (`hubspot`→`apollo`), breaking net_new detection
(filters `source=provider`) and CRM-origin semantics. Root cause: the v1 view has
one `source` column meaning *record origin*, reused by the trigger as
*per-observation source* — two meanings collide.

**Implemented fix:** enrichment writes the reconciled/scoring attributes
**directly as observations** with the true source via
`recordEnrichmentObservations()` (`packages/core/src/db/observations.ts`), then
**strips those fields from the contacts-view update** so the trigger (which only
emits on changed fields, `:458`) does not re-emit a mis-tagged duplicate. Applied
at every enrichment-origin writer: worker `enrichContact` (apollo, prospeo) +
`applyLinkedInProfile` (linkedin), and API `enrichContact` (apollo, prospeo).
`linkedin_url` stays on the view update so the trigger still attaches it as an
identifier — its duplicate state-obs is harmless (fill-only). `scoreICP` and
logging still read the untouched `updates`, so scoring/telemetry are unchanged.
`'v1_compat'` is treated as unknown provenance and never counts as independent
evidence (Task 1, fail-closed).

**Status:** code-complete + compiling + core rebuilt to `dist`; **not**
runtime-verified (needs deploy + a real enrichment run). No migration — pure code.

**Coverage meter (run post-deploy):** count `observations` for the reconciled
properties grouped by `source`. The `v1_compat` count is necessary **but
insufficient** — the mis-tagged-as-provider rows never showed as `v1_compat`. The
real signal: *new* enrichment-origin observations now carry `apollo`/`prospeo`/
`linkedin`, not the record origin. No backfill — historical mis-tagged rows simply
don't qualify as independent evidence (the safe default).

**Out of Task 0 scope (follow-up):** UI/manual edits to contact fields also flow
through the view and inherit the record-origin source rather than `user`, so the
trust ladder's tier-1 `asserted` detection isn't sourced yet. Separate writer from
enrichment — flagged for the survivorship work (Task 2).

---

## Task 1 — Provenance gate + source-trust ladder · [Built]

**As built** (`packages/core/src/services/crmProvenance.ts`, pure + unit-checked):
`passesProvenanceGate(sources)`, `bestIndependentSource(sources)`,
`sourceTrustRank`, `isIndependentSource`, and `evaluateProvenance(supabase, ws,
supportingObservationIds)` which loads sources via the new
`getObservationsByIds()` and runs the gate. **Gap found & closed:** the general
`getClaims` SELECT omits `supporting_observation_ids`, so a dedicated
`getClaimsForReconcile()` (`db/claims.ts`) returns it plus the gating fields —
the common claim read is left unbloated. No test harness in the repo, so the
pure functions were verified with 17 fixture assertions (fail-closed on
empty/CRM-only/`v1_compat`-only; independence detection; trust-rank ordering) —
all pass. Not runtime-verified against live claims.


### Loop-prevention gate (the hard rule)

> A reconcile proposal that would write value `V` for property `X` to provider
> `P` is permitted **only if** the claim for `(entity, X)` is supported by **≥1
> observation whose `source` is not any CRM provider** (`source ∉ {hubspot,
> pipedrive, attio}`) **and** whose source is not `'v1_compat'`.

Operationally: load `claim.supporting_observation_ids`, fetch their `source`
values, require at least one that is neither a CRM provider nor `'v1_compat'`.
If the only support is CRM-sourced (or unknown), **suppress** — Nous would just
be laundering the CRM's own data back to it (an echo), and has no independent
evidence to stand on. Fail-closed: unknown provenance never satisfies the gate.

This rule alone prevents: (a) writing CRM data back to the same CRM, (b)
cross-CRM laundering, (c) acting on `v1_compat` rows of unknown origin.

### Source-trust ladder (used to break ties, not to gate)

The gate above decides *whether* we may propose. The ladder decides, when the
claim and CRM disagree, *how confident* the proof is — and feeds the
update-vs-conflict call in Task 2. Trust for **state attributes** (the four
reconciled fields), highest first:

| Tier | Sources | Rationale |
|---|---|---|
| 1 — human-asserted | `user`, `manual` (→ `epistemic_class='asserted'`) | a human told Nous directly; sticky |
| 2 — observed from the subject | `gmail`, `smtp` (signatures), `fathom`, `fireflies` (transcripts), `signal_extraction` (their own LinkedIn) | first-party behavioral evidence |
| 3 — CRM (reference, not authority for write-back) | `hubspot`, `pipedrive`, `attio` | human-curated, but it is the projection target |
| 4 — third-party enrichment | `apollo`, `prospeo` | independent but can be stale/wrong |
| 5 — inferred | `agent`, `mind`, `inferred` | model-derived, weakest |
| — unknown | `v1_compat` | never counts as independent evidence (Task 0) |

The ladder is a config constant, not hard-coded per call site, so RevOps can
later reorder it per workspace.

---

## Task 2 — Reconcile decision function (propose-only) · [Built]

**As built** (`packages/core/src/services/crmReconcile.ts`, pure + 16 fixtures):
`decideReconcile(input) → ReconcileDecision | null` implements the gate + decide
logic below; `isSuppressedByRejection()` is the rejection memory (90-day window,
matches on normalized `proposed_value`); `normalizeFieldValue()` is the free-text
comparison. `evaluateProvenance` (Task 1) was extended to also return the
independent supporting observations as the proof payload. Fixtures caught one bug
(empty-string CRM value stored as `""` not `null` on `field_fill` — fixed).

> **Confidence-model interaction (deliberate, tunable).** `deriveClaim` assigns a
> **single-source** claim `confidence = 0.55`. With default `τ = 0.6`, single-source
> enrichment values are **held back** — only corroborated (≥2 obs → 0.63) or
> otherwise-boosted claims clear the gate. Safe/conservative, but it limits
> coverage and many enrichments are single-source. `τ` is per-field overridable;
> revisit whether fill-only fields should use ~0.55. Default left at 0.6 per spec.


Input: a claim `C` for a reconciled field, and the CRM's **current** value
`V_crm` (read live or from the latest provider observation). Output: zero or one
`crm_hygiene_proposals` row. **Never writes to the CRM.**

```
gate:
  - C exists, C.epistemic_class ∈ {observed, asserted}      (predicted/inferred → skip)
  - C.confidence ≥ τ   (τ = 0.6 default, per-field overridable)
  - C.freshness ∈ {fresh, aging}                            (suspect/expired → skip)
  - provenance gate (Task 1) passes
  if any fail → no proposal

decide:
  V_claim = normalize(C.value); V_crm = normalize(V_crm)
  if V_crm is empty/null                          → field_fill   (proof = non-CRM supporting obs)
  if V_crm == V_claim                             → no-op
  if V_crm != V_claim:
      strong = (C.epistemic_class == 'asserted')
               OR (C.observation_count ≥ 2 AND C.freshness == 'fresh')
      if strong  → field_update   (proof attached; 'asserted' → high priority)
      else       → conflict       (flag, never imply silent overwrite)
```

### The honest conflict rule (why we lean conservative)

We **softened the recency promise on purpose** (recorded in crm-sync.md): CRM
`updated_at` is record-level, not field-level, on Pipedrive and Attio (and is
unreliable as a per-field signal even on HubSpot). So a CRM record touched for an
unrelated field can make its `job_title` observation look spuriously "newest."
We therefore do **not** claim "human edited this field after our evidence" from
timestamps. Instead: a non-empty CRM value that differs is a **`conflict`** by
default, and only escalates to `field_update` when our side is independently
*strong* (human-asserted, or corroborated-and-fresh). When in doubt → `conflict`,
never a confident overwrite. This is the conservative reading the data supports.

### Rejection memory (no nagging)

Before emitting, check `crm_hygiene_proposals` for an existing row matching
`(workspace_id, provider, entity_id, field, proposed_value)` with
`status='dismissed'`:
- exact `proposed_value` previously dismissed → **suppress** (within a
  suppression window, e.g. 90 days).
- `proposed_value` has changed since dismissal → **re-propose** (new evidence
  earns a new look).

Persisted via the existing `status` enum (`proposed/approved/applied/dismissed/
failed`). No new table needed.

### Proof payload (`evidence` jsonb)

For `field_fill` / `field_update`, attach the non-CRM supporting observations
that justify the value: `[{source, observed_at, method, snippet/value}]`. This is
the wedge — every proposal carries its proof. Confidence written to the proposal
is `C.confidence` on the **0–1 scale** (align the `crm_hygiene_proposals.confidence`
NUMERIC to 0–1 to match claims; do not mix with the 0–100 ICP scale).

---

## Task 3 — Watermark-incremental, propose-only reconcile loop · [Built]

**As built** (`crmHygiene.ts` `reconcileEntity`/`runReconcilePass`, wired into
`runHygieneForConfig` via `deps.crmToken`; `fetchCrmRecordFields` in
`integrations/crm/index.ts`):
- **Richer CRM read** — `fetchCrmRecordFields(provider, token, recordId)` GETs one
  record's standard free-text fields. Honest per-provider coverage: HubSpot
  `job_title`+`company`+`phone`, Pipedrive `company`+`phone` (job title is a
  custom field — omitted), Attio `job_title`+`phone` (company is a relationship —
  omitted). A property is only reconciled where the provider returns it. Read-only.
- **Watermark** — candidates = entities with a reconciled-field observation
  ingested since `hygiene_last_run_at` (captured before it advances); bounded to
  100 entities/run, throttled 120ms between GETs, `capped` logged (no silent
  truncation). Only entities already linked to the CRM (`{provider}_id`) are read.
- **Compose** — per entity: `getClaimsForReconcile` → `evaluateProvenance` →
  `decideReconcile` → `hasOpenProposal`/`isSuppressedByRejection` →
  `insertHygieneProposals`. Proposals carry the proof (`evidence.observations`).
- **Wiring** — worker sweep + API `/hygiene/run` resolve+decrypt the CRM token and
  pass `crmToken`; without it, net-new + ICP still run. Proposals surface in the
  existing HYGIENE REPORT (Phase 1a) — `field_fill`/`field_update`/`conflict`
  labels already present.
- **Status:** code-complete + compiling + dist; **not** runtime-verified (needs a
  live CRM + deploy; per-provider field reads untested against real data).


Driven by `hygiene_enabled` + `hygiene_cadence` (weekly/monthly) and **Run now**.
Never a full-table scan.

1. **Candidate set = entities with reconciled-field activity since
   `hygiene_last_run_at`.** Derive from `observations` where
   `property IN (job_title, company, phone, linkedin_url)` and
   `ingested_at > hygiene_last_run_at` — i.e. only entities whose claims could
   have moved. This is the watermark; advance it only on successful completion.
2. For each candidate, load the claim(s) for the four fields and read the CRM's
   current value (batch reads; respect per-provider rate budgets — HubSpot
   100/10s, Pipedrive token budget, Attio limits). Throttle; never burst the
   whole candidate set.
3. Run the Task 2 decision per field; insert proposals (de-duplicated via
   rejection memory).
4. Write a `run_id`, counts, and any skipped-for-rate-limit remainder to
   `workspace_system_log` (reuse `logWorkerRun()`); if the run is bounded
   (rate-limited remainder, sampling), **log what was dropped** — silent
   truncation reads as "covered everything" when it didn't.
5. Advance `hygiene_last_run_at`.

No worker/cron exists yet (crm-sync.md §4 confirms). Add one
`apps/worker/src/workers/crmHygiene.mjs` + a cron entry mirroring the pull job's
shape, gated on `hygiene_enabled`.

---

## Explicitly held for Phase 2 (because they only matter once apply writes back)

- **Echo suppression** (write-state diffing so the next pull doesn't re-ingest
  Nous's own write). Note: the Task 1 provenance gate already prevents *value-level*
  loops; echo suppression is the *event-level* belt-and-braces needed once apply
  exists.
- **Auto-apply** (`hygiene_auto_apply` `safe`/`all`) and the dry-run + impact-count
  gate before the first non-`off` apply.
- **The `do_not_contact` write** to the CRM. **But:** `do_not_contact`'s
  suppression of *Nous's own* create/push is internal (not a CRM write) and can
  land earlier — it should, on compliance grounds (crm-sync.md §4.6).

---

## Build order (each step ships independently, all read-only)

1. **Task 0** — source fidelity. **[Built]** — enrichment writes attributes as
   observations with true source + strips them from the view update. (Turned out
   to be a real audit, not a one-liner: the view's single `source` column made the
   naive fix a trap; see the Task 0 section.)
2. **Task 1** — provenance gate + trust-ladder constant. **[Built]** — pure logic
   in `crmProvenance.ts` + `getClaimsForReconcile`/`getObservationsByIds`;
   17 fixture assertions pass.
3. **Task 2** — decision function. **[Built]** — pure `decideReconcile` +
   `isSuppressedByRejection` in `crmReconcile.ts`; 16 fixtures pass.
4. **Task 3** — watermark loop + CRM field read + worker/API wiring. **[Built]** —
   reads CRM (GET only), writes proposals, writes nothing to CRM.

## Open verifications — RESOLVED

- **Source `enrichContact()` passes:** *none* — both writers set `enrichment_source`,
  not `source`, so field observations inherited the record origin (often a CRM
  provider, sometimes `v1_compat`). Fixed in Task 0. Other state-field writers:
  `applyLinkedInProfile` had the same gap (fixed → `linkedin`); **UI/manual edits
  still inherit record origin → `user` not sourced** (follow-up, Task 2). CRM pull
  is correct (`source=provider`).
- **`crm_hygiene_proposals.confidence` scale:** already 0–1 in Phase 1a code
  (`icp_score / 100`), consistent with `claims`. No change needed.

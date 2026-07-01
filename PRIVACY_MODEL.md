# Per-Member Privacy — Scope

> Status: **design scope, pre-build.** Companion to [MULTI_ACCOUNT_FOUNDATION.md](./MULTI_ACCOUNT_FOUNDATION.md).
> Goal: in a shared workspace, keep each rep's **raw conversations** (email bodies, LinkedIn
> DMs, meeting transcripts) private to that rep and to admins, while the **shared picture**
> (the account map, extracted intel, attribution, scores) stays visible to the whole team —
> and enforce it in the read layer so the **agent cannot retrieve what a member may not see**.

---

## 1. The problem

Two requirements that look like they conflict:

1. **Privacy must be enforced where data is read, not in the UI.** The agent reads through the
   MCP/REST layer; hiding a thread in the frontend is theater. If a read resolver returns
   rep A's private DM to rep B's agent, it leaked — regardless of what the UI shows.
2. **We cannot shard reps into separate workspaces.** The whole value is the shared graph:
   three reps touching one company, one rep on the founder and another on the head of growth,
   and seeing how it all relates. Per-member workspaces destroy identity resolution and dedup
   (see MULTI_ACCOUNT_FOUNDATION §1).

The resolution: **do not split by person — split by layer of the graph, and scope each layer.**

---

## 2. The model: share the map, scope the mailbox

The graph has natural layers by sensitivity. We scope the raw layer to its owner and leave the
derived layers shared.

| Layer | Examples | Default visibility |
|---|---|---|
| **Raw observations** | the email body, the LinkedIn message text, meeting transcript | **owner-scoped** — the rep it came through, plus owner/admin |
| **Raw documents** | `doc_type` = `transcript`, `meeting_notes` | **owner-scoped** |
| **Extracted claims** | goal, pain, budget, stack (the Intel tab facts) | **shared** |
| **Attribution** | `relationship_owner` (who owns which account) | **shared** |
| **Entities + relationships** | accounts, works_at, the company map | **shared** |
| **Predictions / scores** | ICP fit, signals | **shared** |

Net effect for rep B looking at an account rep A works: B sees *the account exists, A owns the
founder, the budget is ~$50k, they're evaluating Clay* — the full coordination picture — but
**not** A's actual emails or transcript. The intel distilled from A's private thread is shared;
the raw thread is not. This is the line the workspace owner chose (share map + intel, scope raw).

---

## 3. The blocker, and the change that unblocks it

**An MCP session identifies a workspace only, never a member** (`apps/api/src/middleware/apiKey.mjs`
resolves a `pk_` key to `workspace_id` + `apiKeyId`, no user). So today an agent read cannot know
"the current viewer is user X." The frontend path DOES know the viewer
(`verifySupabaseAuth` → `req.internalUserId`, `apps/api/src/middleware/supabaseAuth.mjs`).

Also: the app runs on the Supabase **service-role key** (`packages/core/src/db/client.ts`), which
**bypasses RLS**. So RLS will not enforce this — it must live in the app read layer.

**The unblock: per-member API keys.** A member's key acts *as that member*.

- Add `owner_user_id UUID` (the member the key acts as) and `scope TEXT` (`member` | `admin`) to
  `api_keys` (the table already carries `created_by_user_id`, the issuer — not sufficient).
- `verifyApiKey` selects `owner_user_id, scope` and sets `req.memberUserId` + `req.viewerScope`.
- A **member key** → the agent reads as that member (raw scoped to them). An **admin/workspace
  key** (`scope = 'admin'`, `owner_user_id` null) → the agent sees all raw (for the owner's own
  automations and admin tooling).
- Onboarding mints one member key per seat; the install command carries it. This is the natural
  model — the key *is* the member's identity to the agent.

Without per-member keys, the only honest options are "agent sees all raw" or "agent sees none" —
neither is what we want. Per-member keys make the agent path enforce the same rule as the UI.

---

## 4. Attribute raw at write time

Raw content cannot be scoped by owner unless each raw row knows its owner. The owner is **already
resolved at ingest** — it just is not persisted.

**Schema:**
- `ALTER TABLE observations ADD COLUMN owner_user_id UUID REFERENCES users(id)` (nullable). Null =
  system/derived/shared (enrichment, non-channel events); a value = a specific rep's raw touch.
- Documents are `note.<uuid>` claims; stamp `value.metadata.owner_user_id` in `saveDocument` for
  transcripts/meeting_notes.

**Writers (owner already in hand, just pass it through):**
- `logActivity` (`packages/core/src/db/activities.ts:163`) gains an `ownerUserId` param, written to
  the new column.
- Gmail poller (`apps/worker/src/pollers/gmail.mjs:129`) already computes
  `connectedAccountOwnerByEmail(...)`; pass it to `logActivity`.
- LinkedIn handler (`linkedin.mjs:334/445`) already computes `connectedLinkedinOwner(...)`; pass it.
- Fireflies/Fathom (`fireflies.mjs`, `fathom.mjs`) already resolve the host owner; pass it to
  `logActivity` and stamp it on the `saveDocument` transcript.
- A one-time backfill stamps `owner_user_id` on historical observations/documents from `raw.from` /
  `raw.to` (same mapping the attribution backfill used), where resolvable.

---

## 5. Enforcement: one viewer context, one filter, every read path

**Viewer context.** Introduce a `ReadContext = { workspaceId, viewerUserId, viewerScope }` threaded
into the core readers (today every reader is `(supabase, workspaceId, …)` with no viewer).

- Frontend: `viewerUserId = req.internalUserId`, `viewerScope` from `workspace_members.role`
  (`owner`/`admin` → `admin`, else `member`). `verifySupabaseAuth` must additionally select `role`
  (it selects membership but not role today).
- MCP/API-key: `viewerUserId = req.memberUserId`, `viewerScope = req.viewerScope` (from §3).

**One filter helper**, used at every leak-critical reader so there is a single audited chokepoint:

```
rawVisible(row, ctx) =
  ctx.viewerScope === 'admin'            // owner/admin see all raw
  || row.owner_user_id == null           // system/derived/shared, not a private thread
  || row.owner_user_id === ctx.viewerUserId
```

**Leak-critical readers to apply it in** (from the read-surface audit):
`getObservations`, `getAccountRecord` (its `recent_observations` + document `facts`),
`assembleContext` (timeline + documents), `runQuery` (per-observation summaries + facts corpus),
`getAttention` (meeting labels), `listActivities` (v1 rows incl. `raw_data`), `listNotes`/`getNote`
and the `search_notes` route (documents by `doc_type`).

**Left unfiltered (shared by design):** `getClaims`/`getClaim` (derived intel), entities,
relationships, `relationship_owner`, predictions/scores, and non-document facts. This is what keeps
the map + intel + coordination visible to everyone.

**Documents split:** filter applies to notes WITH `doc_type` in (`transcript`, `meeting_notes`)
scoped by their stamped `owner_user_id`; notes WITHOUT `doc_type` (extracted facts) stay shared.

---

## 6. Rollout safety

- Today the workspace is single-member (owner). With `viewerScope = admin` for owner, scoping
  changes nothing until a second member joins — so this ships dark and activates on multi-member.
- Default for un-attributed rows is **shared** (null owner), so nothing that exists today
  disappears; only newly-attributed raw touches become scoped.
- Fail closed on ambiguity: if `viewerUserId` is unknown on a path that should have it, treat as a
  member with no matching owner (sees only null-owner shared rows), never as admin.

---

## 7. Leak-path test plan (must pass before ship)

Set up members A, B (both `member`) and O (`owner`), each with their own key. A's mailbox ingests a
thread with prospect P; A hosts a recorded meeting with P.

1. **B's agent** `get_account(P)` → sees P exists, the shared claims, `relationship_owner` = A, the
   score — and **zero** raw: no email body, no transcript, no timeline snippet/subject from A's
   thread, no meeting_notes document.
2. **B's agent** `get_context(P)`, `query`, `attention`, `search_notes` → same: shared layers yes,
   A's raw no.
3. **A's agent** → sees A's own raw + all shared.
4. **O's (owner) agent** → sees everything.
5. **Shared map intact:** B still sees P, that A owns it, and the extracted intel — coordination is
   not broken.
6. **Frontend parity:** the same matrix holds for B/A/O logged into the UI (same core readers).

A single missed reader fails the suite (that's the point of the shared chokepoint).

---

## 8. File touchpoints

- `supabase/migrations/…_observation_owner.sql` — `observations.owner_user_id` (+ index); backfill.
- `supabase/migrations/…_api_key_member.sql` — `api_keys.owner_user_id`, `scope`.
- `apps/api/src/middleware/apiKey.mjs` — select + set `req.memberUserId`, `req.viewerScope`.
- `apps/api/src/middleware/supabaseAuth.mjs` — select `role` → `req.workspaceRole`/viewerScope.
- `packages/core/src/db/activities.ts` (`logActivity`) — `ownerUserId` param → column.
- Ingestion writers (`gmail.mjs`, `linkedin.mjs`, `fireflies.mjs`, `fathom.mjs`) — pass owner.
- `packages/core/src/db/{observations,claims,notes,activities}.ts`, `context.ts`, `query.ts`,
  `attention.ts` — thread `ReadContext`, apply `rawVisible` in the leak-critical readers.
- The MCP tool routes + v2 routes — pass the viewer context through.
- One-time backfill script for historical `owner_user_id`.

---

## 9. Non-goals (for this pass)

- **No manager tier** ("see my reports' threads"). Owner/admin-all + member-own only. Later.
- **No per-thread manual sharing/hiding toggles.** Ownership is the only axis for now.
- **No RLS rewrite.** Service-role bypasses it; enforcement is app-layer. RLS stays as
  defense-in-depth for direct DB access.
- **No change to what's shared** (claims, map, attribution, scores stay workspace-visible).

---

## 10. One-line summary

Split the graph by sensitivity, not by person: raw conversations are stamped with the rep they came
through and scoped to that rep + admins in every read resolver, while the account map, extracted
intel, attribution, and scores stay shared — and per-member API keys give the agent a viewer so it
enforces the same rule as the UI.

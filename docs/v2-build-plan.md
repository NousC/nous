# v2 Build Plan — the evidence-model rebuild

How we move from the value-centric v1 to the evidence substrate, on one repo, with a clean result. Companion to `schema-audit.md` and `founding-charter.md`.

**Principle:** branch, don't fork. The hybrid exists only on the `v2` branch; `main` (v1) stays deployable until cutover; the shipped artifact is *always* one clean schema. See `schema-audit.md` for the why.

---

## Pre-flight — `main` must be clean before v2 is cut

The working tree currently has uncommitted WIP (modified `apps/api`, deleted/added frontend pages) plus the new `docs/`. Before anything:

1. Land or stash the in-flight WIP so `main` is a known-good committed state.
2. Commit the `docs/` (charter, diagrams, audit, use-cases, this plan) to `main` — they are company docs and belong on both v1 and v2.

v2 must branch from a clean commit, not from half-finished work.

## Cutting the branch

```bash
git checkout main && git pull
git checkout -b v2
```

`main` stays v1 — deployable, frozen except critical fixes — for the entire build.

## Commit 1 — the deletion + the clean schema (the decision record)

The first commit on `v2` is an aggressive, deliberate deletion. Its diff *is* the record of what we chose to drop. After this commit, nothing value-centric remains.

**DELETE — the value-centric core:**

- Schema: `contacts`, `companies`, `contact_activity_log`, `workspace_memories`, `workspace_graph_edges`, `leads`, `lead_lists`, `lead_suppressions`, `mind_episodes`, the `pipeline_stage` plpgsql engine, and all of `supabase/migrations/*` (v1 incremental history — v2 ships one clean `schema.sql`).
- Code: `packages/core/src/db/{contacts,companies,leads,memories,activities}.ts`.
- SDK: the `contacts` resource and `updateContact` value-overwrite path.
- `supabase/schema.v2.sql` → renamed to `supabase/schema.sql`.

**PORT — deliberately copied, then tidied (clean already, keep):**

- All integration tables: `workflow_providers`, `workflow_provider_connections`, `crm_sync_configs`, `workspace_webhook_subscriptions`, `webhook_inbox`, `workspace_linkedin_connections`, `workspace_system_log`.
- Tenancy: `workspaces`, `workspace_members`, `teams`, `api_keys`; billing migration (hosted-only).
- `apps/worker` connector code for the 14 providers (Gmail/Calendar, Slack, Instantly, Fireflies, Fathom, Calendly, Cal.com, HubSpot, Salesforce, Pipedrive, Attio, Apollo, Prospeo, RB2B/LinkedIn).
- `scorecard_signals` / `scorecard_runs` + `packages/core/src/db/scorecard.ts`.
- `packages/core/src/utils/{encryption,identity,linkedin}.ts`; `services/crmPush.ts`.
- App shells: `apps/{api,frontend,mcp,cli,worker}` stay — only their data layer is rewired.

**REBUILD — the heart:**

- The evidence schema (`schema.v2.sql`, drafted — see `supabase/schema.v2.sql`).
- `packages/core/src/db/{entities,observations,claims}.ts`.
- The claim-derivation engine (in `apps/worker`).
- The Context API (`apps/api` + `apps/mcp`): read claims-with-epistemics, write observations.
- The SDK: `submitObservation`, `getClaim`, the account-record projection.
- The one-shot `v1 → v2` data migration script.

## Build order on the `v2` branch

1. **Commit 1** — deletion + clean `schema.sql` (above).
2. **Schema live** — evidence tables, RLS, the observation immutability guard, the claim-recompute queue.
3. **Core db modules** — `entities`, `observations`, `claims` (clean, one module per primitive).
4. **Ingestion** — rewire the worker connectors: every connector now *emits observations* instead of writing columns.
5. **Claim-derivation engine** — generalize the v1 `pipeline_stage` trigger into "recompute claim for `(entity, property)`."
6. **Context API + SDK** — reads serve claims-with-epistemics; writes are observations.
7. **`v1 → v2` migration script** — one-shot, dated, in a `migrations/releases/` folder; never woven into the app.
8. **The loops** — outcome-backprop (bounces invalidate claims), generalized decay, `predictions` + confidence-weighted scorecard.
9. **Frontend** — rewired to the projection API.

Each step is independently shippable on the branch and reviewable.

## Cutover

When v2 is ready: tag the last v1 commit (`v1.x-final`), keep a `v1` branch for critical fixes until self-hosters have migrated, then **promote `v2` to `main`**. The working tree is now pure v2; history stays in the log (harmless and invisible to self-hosters).

## Self-host story

- New installs run the clean v2 `schema.sql` — ~6 evidence tables, one uniform pattern, readable in five minutes.
- Existing instances run the documented one-shot `v1 → v2` migration.
- The migration script never enters `schema.sql`. The published artifact is always one clean model.

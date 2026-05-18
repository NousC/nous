# Supabase migrations

`schema.sql` in the parent directory is the **complete schema** — fresh self-hosters can run it once and get the latest state. Files here are **incremental migrations** for existing deployments that have an older schema applied.

## When to run which

- **Fresh install** → run `../schema.sql` once in the Supabase SQL editor. Done.
- **Existing install** → run the migration files in date order. They're all idempotent (`IF NOT EXISTS` guards), so running one twice is safe.

## How to run

Paste each file into the Supabase SQL editor and click Run. Or via psql:

```bash
psql "$DATABASE_URL" -f supabase/migrations/<file>.sql
```

## Migration log

| Date | File | What it adds |
|---|---|---|
| 2026-05-18 | `2026_05_18_add_salesforce_provider.sql` | Seeds the `salesforce` row in `workflow_providers` so the OAuth flow can resolve a provider_id |
| 2026-05-18 | `2026_05_18_crm_activity_push.sql` | Identity-cache columns (`pipedrive_id`, `attio_id`, `salesforce_id`) on `contacts` + `push_activities` toggle on `crm_sync_configs` |
| 2026-05-18 | `2026_05_18_crm_push_idempotency.sql` | `pushed_to_crms` JSONB on `contact_activity_log` to prevent duplicate engagements |

Each migration is also reflected in `../schema.sql` so a fresh install never needs to touch this folder.

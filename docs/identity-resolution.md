# Identity Resolution

Every inbound signal — a webhook, a CSV row, a calendar event, a LinkedIn message — must be matched to an existing contact or a new one must be created. This document describes exactly how that works.

---

## Core waterfall (`resolveContact`)

**Source:** `apps/api/src/services/enrichment.mjs:81`

All resolution runs through a single shared function. It stops at the first successful match.

### Step 1 — External integration ID

Checks `hubspot_id`, `pipedrive_id`, `apollo_id`, `rb2b_id`, `attio_id` in order. Each is an exact equality match against the contacts table. This is the fastest path and is used whenever a CRM or tool provides its own stable identifier.

### Step 2 — Email (ground truth)

If an email is present, it is lowercased and trimmed, then matched against `contacts.email`. Email is considered authoritative: if it matches, no further steps run.

### Step 3 — LinkedIn URL

Matched via exact equality on `contacts.linkedin_url`. The URL is not normalized at this step — normalization happens on write (via `normaliseLinkedInUrl()`).

### Step 3.5 — Name self-heal

Only triggers when the incoming payload has **both an email and a parseable full name**, and when no match was found in steps 1–3.

Queries for contacts where:
- `email IS NULL`
- `first_name ILIKE <first>`
- `last_name ILIKE <last>`

If exactly **one** match is returned, the newly discovered email is written back to that contact and the merge proceeds. If two or more match, the step is skipped entirely — ambiguity is treated as no-match to avoid false positives.

This is the "self-heal" path: a contact entered manually (or via LinkedIn) without an email gets their email populated the first time Gmail, Calendly, or another email-bearing source sees them.

### Step 4 — Create or reject

If no match found:
- `createIfMissing=false` → return `{ contact: null, created: false }`. The incoming signal is dropped.
- `createIfMissing=true` → a new contact is inserted. Requires at least an `email` or `linkedin_url`; if neither is present, creation is rejected with a warning.

On creation, `company_name` and `company_domain` are used to upsert the company record and link `company_id`.

---

## Two caller tiers

| Tier | `createIfMissing` | Sources |
|------|-------------------|---------|
| Level 1 — Creates | `true` | Instantly (outbound), RB2B (website visitor ID), LinkedIn inbound, CRM bootstrap |
| Level 2/3 — Updates only | `false` | Gmail, Fireflies, Fathom, Calendly, Google Calendar |

Level 2/3 sources are "enrichers": they add signal to contacts that already exist, but they never introduce new contacts into the system.

---

## Field-level merge (`mergeContact`)

When a contact is matched (steps 1–3.5), incoming fields are merged using a **fill-only** strategy: a field is only written if the incoming value is non-null and the existing field is null or empty. Existing data is never overwritten.

Fields merged: `first_name`, `last_name`, `job_title`, `phone`, `linkedin_url`, `company`, `domain`, `hubspot_id`, `pipedrive_id`, `apollo_id`, `rb2b_id`, `attio_id`.

Company linking is attempted in the background (fire-and-forget) when the existing contact has no `company_id` but the incoming data has a company name or domain.

---

## LinkedIn / Unipile resolution (`matchContact`)

**Source:** `apps/api/src/services/linkedin.mjs:145`

LinkedIn-specific matching runs alongside the core waterfall for all Unipile-sourced events (connection syncs, conversation syncs, inbound webhook messages). It uses a 3-step sub-waterfall:

1. **Normalized LinkedIn URL** — `ilike contacts.linkedin_url LIKE '<normalized_url>%'`. Handles trailing slash variants.
2. **Unipile member ID (`ACoAA...` format)** — checks `contacts.linkedin_member_id` directly, then falls back to `contacts.channels->>linkedin->>member_id` (for contacts populated via the history backfill).
3. **Full name fallback** — `first_name ILIKE` + `last_name ILIKE` with `maybeSingle()`. Only fires if both first and last name are available. If more than one contact matches, it returns null (ambiguous).

LinkedIn activity deduplication: for each `(contact_id, activity_type, source='linkedin')` combination, only one event per calendar day is logged.

---

## CSV / bulk import

**Source:** `apps/api/src/routes/api/contacts.mjs:243`

The import endpoint accepts up to **2,000 rows** per request. Each row must have a valid email address or a `linkedin_url` — rows with neither are counted as `skipped`.

### Deduplication

The import does NOT use `resolveContact`. Instead it runs two bulk set lookups before touching the database:

- Email rows: fetches all existing contacts in the workspace with matching emails → builds a `Set` of known emails.
- LinkedIn-only rows: fetches existing contacts with matching `linkedin_url` values → builds a `Set`.

Rows not in either set are **inserted** (batch `INSERT`). Rows already in a set are **updated** (field-by-field, same fill-only logic as `mergeContact`).

### Fields accepted from CSV

`first_name`, `last_name`, `company`, `job_title`, `linkedin_url`, `phone`, `domain`, `notes`, `seniority`, `department`, `deal_stage`, `pipeline_stage`, `source`.

`pipeline_stage` from a CSV row is written directly — no trigger validation at import time, so values outside the valid set will fail the DB constraint.

### Post-import enrichment

After inserts and updates complete, all contact IDs (new + updated) are passed to `enrichContactHistory()` as an async background job. This backfills Gmail history, LinkedIn message history, and meeting notes for every imported contact.

---

## Google Calendar polling

**Source:** `apps/api/src/routes/api/oauthGoogle.mjs` (calendar scope)

The calendar poller runs on a 10-minute cron, looking back 7 days and forward 30 days. For each calendar event, attendees are resolved against existing contacts using the core `resolveContact` waterfall (`createIfMissing=false`). Meetings with matched contacts are logged as `meeting_scheduled` or `meeting_held` activities.

---

## Fake email detection

During Prospeo enrichment, emails matching placeholder domains are treated as absent:

```
/\.(import|csv|fake|test|example|placeholder|noemail)$/i
```

This prevents enrichment calls for contacts imported with synthetic emails like `name@airtable.import`.

---

## Summary: what resolves what

| Source | Method | Creates new contacts? |
|--------|--------|----------------------|
| Instantly webhook | Core waterfall | Yes |
| RB2B visitor signal | Core waterfall | Yes |
| LinkedIn inbound webhook | Unipile `matchContact` | No (logs to matched contact) |
| LinkedIn connection sync | Unipile `matchContact` | No |
| LinkedIn conversation sync | Unipile `matchContact` | No |
| CSV import | Bulk email/LinkedIn set lookup | Yes |
| Gmail history backfill | Core waterfall (`createIfMissing=false`) | No |
| Google Calendar | Core waterfall (`createIfMissing=false`) | No |
| Fireflies / Fathom / Calendly | Core waterfall (`createIfMissing=false`) | No |
| CRM bootstrap (HubSpot) | Core waterfall | Yes |

---

## Lead-list matching (planned)

There is a `leads` table — the cold outreach universe, kept separate from `contacts` (scoring covered in `icp-and-gtm-context.md`). When it ships, inbound resolution also checks `leads`: a reply from someone on a lead list updates that lead and graduates them into `contacts` through the waterfall above. A reply that matches no lead is handled exactly as today. The waterfall itself does not change — lead-list matching runs alongside it.

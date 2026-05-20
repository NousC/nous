# ICP Scoring & Contact Enrichment

This document covers the full enrichment pipeline — how contacts get profile data — and the ICP scoring that runs after enrichment completes.

---

## Enrichment overview

**Source:** `apps/api/src/services/enrichment.mjs:265`

Enrichment adds structured profile data (job title, seniority, department, company info, location, phone, LinkedIn URL) to a contact. It is triggered:

- Automatically when a new contact is created via webhook (source: Instantly, RB2B, LinkedIn)
- Manually via the "Enrich" button on a contact page (`POST /api/contacts/:id/enrich`)
- In bulk after a CSV/Airtable import via `enrichContactHistory()`

A contact requires at least an **email** or a **LinkedIn URL** to be enriched. If neither is present, enrichment is skipped.

---

## Provider priority

```
Apollo BYOK (if toggled on for enrichment)
  → Prospeo BYOK (if connected)
    → Nous's built-in Prospeo key
```

Provider selection is evaluated per-contact at enrichment time. A workspace's Apollo key is only used if it is connected **and** the "use for enrichment" toggle is enabled. Prospeo BYOK is always used for enrichment when connected. If neither workspace key is available, the system falls back to the platform-level Prospeo API key.

---

## Apollo enrichment path

**Source:** `apps/api/src/services/enrichment.mjs:280`

Calls `POST https://api.apollo.io/v1/people/match` with the contact's email.

Fields written to the contact on success:

| Field | Apollo source |
|-------|---------------|
| `enrichment_status` | `'complete'` |
| `enrichment_source` | `'apollo'` |
| `apollo_id` | `person.id` |
| `linkedin_url` | `person.linkedin_url` |
| `job_title` | `person.title` |
| `seniority` | `person.seniority` (normalized) |
| `department` | `person.departments[0]` (normalized) |
| `phone` | `person.phone_numbers[0].raw_number` |
| `city` | `person.city` |
| `country` | `person.country` |
| `company_id` | upserted from `person.organization` |

Company data written via `upsertCompany()`: `name`, `domain`, `industry`, `employee_count`, `location`, `tech_stack`, `apollo_account_id`.

On failure, `enrichment_status` is set to `'failed'` and the error is logged as an `enrichment_run` activity.

---

## Prospeo enrichment path

**Source:** `apps/api/src/services/enrichment.mjs:369`

Calls `POST https://api.prospeo.io/enrich-person` with email, first name, last name, and LinkedIn URL (whichever are available).

### Fake email detection

Before calling the API, placeholder emails are stripped. Any email whose domain matches:
```
/\.(import|csv|fake|test|example|placeholder|noemail)$/i
```
is treated as absent. If neither a real email nor a LinkedIn URL remains, enrichment is skipped and `enrichment_status` is set to `'not_found'`.

### Fields written on success

| Field | Prospeo source |
|-------|----------------|
| `enrichment_status` | `'complete'` |
| `enrichment_source` | `'prospeo'` |
| `apollo_id` | `person.person_id` (Prospeo's internal ID stored in same field) |
| `linkedin_url` | `person.linkedin_url` |
| `job_title` | `person.current_job_title` |
| `seniority` | `person.job_history[current].seniority` (normalized) |
| `department` | `person.job_history[current].departments[0]` (normalized) |
| `phone` | `person.mobile.mobile` |
| `city` | `person.location.city` |
| `country` | `person.location.country` |
| `company_id` | upserted from `body.company` |

Company data written: `name`, `domain`, `industry`, `employee_count`, `location`, `tech_stack`, `apollo_account_id`.

`NO_MATCH` from Prospeo sets `enrichment_status = 'not_found'` and logs a descriptive activity entry. Other errors set `enrichment_status = 'failed'`.

---

## Seniority normalization

**Source:** `apps/api/src/services/enrichment.mjs:1023`

Raw seniority strings from both Apollo and Prospeo are normalized to a controlled vocabulary:

| Output | Matches |
|--------|---------|
| `c_suite` | contains `c_suite`, `founder`, `owner`, `c-suite` |
| `vp` | contains `vp`, `vice` |
| `director` | contains `director` |
| `manager` | contains `manager` |
| `ic` | anything else |

## Department normalization

| Output | Matches |
|--------|---------|
| `sales` | contains `sales` |
| `marketing` | contains `marketing` |
| `engineering` | contains `engineering` or `product` |
| `ops` | contains `operations` |
| (raw) | anything else — passed through unchanged |

---

## Company enrichment

**Source:** `apps/api/src/services/enrichment.mjs:516`

Companies can be independently enriched via `enrichCompany(supabase, workspaceId, domain)`, which calls `POST https://api.prospeo.io/enrich-company`. This is not called automatically during person enrichment (Prospeo returns company data alongside person data, so the company record is populated from that response). A separate manual trigger on the company detail page can fetch deeper company data if needed.

Company upsert (`upsertCompany`) matches first on `domain`, then on `hubspot_company_id`. It merges fields using a fill-and-override strategy (enriched fields always overwrite existing, unlike contact merge which is fill-only).

---

## ICP scoring

**Source:** `apps/api/src/services/enrichment.mjs:601`

ICP scoring runs automatically **after every successful enrichment** (both Apollo and Prospeo paths call `scoreICP()` on completion). It can also be triggered manually via the Integrations page.

### Input

Builds a contact summary from: `job_title`, `seniority`, `department`, `company`. If none of these fields are present, scoring is skipped — there is nothing to score against.

### Two scoring modes

**Mode 1 — Workspace ICP criteria (preferred)**

Fetches up to 60 active `workspace_memories` where `category IN ('ICP', 'Market', 'Company', 'Product')`. These are facts the workspace owner has saved via the `remember` MCP tool or through the app (e.g., "ICP: technical founders of AI sales tools, 2–20 people").

The contact profile and all retrieved criteria are sent to Claude with a prompt asking for a 0–100 score, a boolean fit judgment, and a one-sentence reason.

**Mode 2 — Generic fallback (no criteria configured)**

When no ICP memories exist in the workspace, scoring falls back to seniority-based heuristics:

| Seniority | Score range |
|-----------|-------------|
| C-suite, VP, Director | 75–95 |
| Manager, Senior | 45–70 |
| IC or unknown | 20–40 |

The model is explicitly told these are heuristics and that no specific criteria are configured.

### Model

`claude-haiku-4-5-20251001`, `max_tokens: 200`. Response is parsed as JSON: `{ score: int, fit: bool, reasoning: string }`.

### Output written to contact

| Field | Value |
|-------|-------|
| `icp_score` | 0–100 integer |
| `icp_fit` | boolean (`json.fit` if present, else `score >= 70`) |
| `icp_reasoning` | one-sentence string |
| `icp_scored_at` | ISO timestamp |

### Score labels

| Score | Label |
|-------|-------|
| 75–100 | Strong fit |
| 50–74 | Potential fit |
| 0–49 | Weak fit |

An `icp_scored` activity is logged and a system log entry is written for every score run.

### Improving ICP scoring accuracy

The quality of Mode 1 scoring is entirely dependent on what workspace memories are stored under the `ICP` category. Save memories like:

- `ICP: technical founders at B2B SaaS companies, 10–100 employees`
- `ICP: RevOps leads at outbound agencies running 50+ seats`
- `Market: US and Canada only, no enterprise`

Use `nous.remember({ text: '...', category: 'ICP' })` via the MCP tool, or the Memories page in the app.

---

## The Mind — adaptive scoring

ICP scoring is the first link in a larger feedback loop. The Mind records each score as a prediction, joins it to what the contact actually did, and uses the result to improve scoring over time. The behavior described above is the current implementation; two design documents cover where it is heading:

- **`compound-intelligence-mind.md`** — the feedback loop: every prediction is written to the `mind_episodes` ledger, resolved against the realized outcome (reply, pipeline movement, revenue), and surfaced as a calibration metric.
- **`adaptive-lead-scoring.md`** — the next stage: a deterministic, self-revising **Scorecard** of weighted signals replaces the model-reads-memories scoring described above, and a single plain-English ICP field replaces `ICP`-category memories as the way a workspace states its target.

Until those land, ICP scoring works exactly as documented here.

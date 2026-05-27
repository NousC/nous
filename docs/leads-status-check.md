# Leads status check — `POST /v2/leads/check`

**Status:** Design (not yet shipped) · 2026-05-23
**Auth:** API key (`X-Api-Key` or `Bearer pk_*`)
**Use case:** [`/resources/use-cases/clean-every-list`](https://opennous.cloud/resources/use-cases/clean-every-list)

The central suppression endpoint. Before any agent — or any human — imports
a list into a sequencer, this returns the status of every lead in one call:
contacted, replied, bounced, unsubscribed, DNC, or unknown.

## Why

Outbound spend leaks at three checkpoints — all from the same blindness: no
cross-tool visibility across your campaigns and clients. This endpoint is
the one HTTP call that closes the loop at whichever stage the caller can
plug it in.

The realistic checkpoints, in decreasing dollar value:

**1. Pre-reveal — by LinkedIn URL.** Largest dollar saving, smallest user
base. Available to callers whose sourcing flow exposes LinkedIn URLs *before*
they pay for email reveals: Clay tables, Apollo Pro/Org users who can
export pre-reveal, custom pipelines on the major data APIs. At 10–30%
overlap on a typical agency list, this is hundreds of dollars saved per
campaign. **Not all users can take this path** — Apollo's standard UI
gates URL export behind reveal credits on lower tiers. Be honest about that
on the marketing copy; don't promise URL-pre-reveal as universal.

**2. Pre-import — by email.** Universal. Every outbound caller has email
addresses before importing to a sequencer. The savings here aren't headline
dollar numbers — they're reputation, deliverability, reply correctness, and
the avoided embarrassment of double-sending to someone who already replied.
Long-term reputation cost dwarfs the per-send saving for any team running
serious volume.

**3. Pre-source — by domain.** Sophisticated agencies asking *"what do I
already have at these 50 companies?"* before commissioning a new lift.
Out of scope for v1; possible follow-up as `/v2/companies/lookup`.

The endpoint is **identifier-agnostic** — accepts `email`, `linkedin_url`,
or both per row. The caller picks the checkpoint that fits their stack.
Don't optimize for one identifier; optimize for catching the duplicate
wherever it surfaces.

## Endpoint

```
POST /v2/leads/check
Authorization: Bearer pk_…        (or X-Api-Key)
Content-Type: application/json
```

### Request

```json
{
  "leads": [
    { "email": "alice@acme.com" },
    { "email": "bob@beta.com", "linkedin_url": "https://www.linkedin.com/in/bob" },
    { "linkedin_url": "https://www.linkedin.com/in/carla" }
  ],
  "lookback_days": 90
}
```

| Field | Type | Notes |
|---|---|---|
| `leads` | array, required, max **1 000** | Each item needs at least one of `email` / `linkedin_url`. |
| `leads[].email` | string \| null | Case-insensitive, trimmed server-side. |
| `leads[].linkedin_url` | string \| null | Normalized server-side (lowercase, drop `www.`, strip query / fragment / trailing slash). Same normalization as `insertLeads`. |
| `lookback_days` | integer, optional | 1–365. Default 90. Affects the `contacted` rule only. |

### Response

```json
{
  "leads": [
    {
      "email": "alice@acme.com",
      "linkedin_url": null,
      "status": "contacted",
      "last_interaction_at": "2026-05-01T10:00:00Z",
      "last_interaction_property": "interaction.email_sent",
      "lead_list_ids": ["abc", "def"]
    },
    {
      "email": "bob@beta.com",
      "linkedin_url": "https://linkedin.com/in/bob",
      "status": "bounced",
      "last_interaction_at": "2026-03-12T14:30:00Z",
      "last_interaction_property": "interaction.email_bounced",
      "lead_list_ids": ["abc"]
    },
    {
      "email": null,
      "linkedin_url": "https://linkedin.com/in/carla",
      "status": "unknown"
    }
  ],
  "summary": {
    "total": 3,
    "by_status": {
      "unknown": 1,
      "known": 0,
      "contacted": 1,
      "replied": 0,
      "bounced": 1,
      "unsubscribed": 0,
      "dnc": 0
    },
    "lookback_days": 90
  }
}
```

Response order matches request order one-to-one.

### Status enum

Returned in precedence order — the **first match wins** when a lead has
evidence for several:

| Status | Driven by | Meaning |
|---|---|---|
| `dnc` | `dnc_entries` (new — see below) or `lead.is_dnc` flag | Hard suppress, always. |
| `unsubscribed` | observation `interaction.unsubscribed` OR `lead.reply_outcome = 'unsubscribed'` | Opted out. |
| `bounced` | observation `interaction.email_bounced` | Email bounced (any time). |
| `replied` | observation `interaction.email_reply` OR incoming `interaction.linkedin_message` | Got a reply. |
| `contacted` | any outbound interaction within `lookback_days` (`interaction.email_sent`, outgoing `interaction.linkedin_message`, `interaction.call`, etc.) | Active sequence; suppress to avoid double-touch. |
| `known` | lead row exists in workspace, no qualifying interaction | In our system but never reached; safe to add if you choose. |
| `unknown` | no row in `leads`, no matching `entity_identifier` | Not in our system; default-safe to add. |

The caller decides which statuses to skip. The conventional agency filter is
`status in {unknown, known}` → import; anything else → drop.

## Implementation

### Files to add

```
apps/api/src/routes/v2/leads.mjs          # new — Express router
packages/core/src/db/leads-status.ts      # new — checkLeadStatuses()
```

### Route (`leads.mjs`)

```js
import { Router } from 'express';
import { getSupabaseClient, checkLeadStatuses } from '@nous/core';

export const leadsV2Router = Router();

const MAX = 1000;

leadsV2Router.post('/check', async (req, res) => {
  try {
    const workspaceId = req.workspaceId; // set by verifyApiKey
    const { leads, lookback_days } = req.body ?? {};
    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'leads array required' });
    }
    if (leads.length > MAX) {
      return res.status(400).json({ error: `too many leads — max ${MAX} per request` });
    }
    const lookback = Number.isInteger(lookback_days) && lookback_days >= 1 && lookback_days <= 365
      ? lookback_days
      : 90;
    const result = await checkLeadStatuses(getSupabaseClient(), workspaceId, leads, { lookback });
    return res.json(result);
  } catch (err) {
    console.error('[POST /v2/leads/check]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});
```

### Mount (`index.mjs`)

```js
import { leadsV2Router } from './routes/v2/leads.mjs';
…
app.use('/v2/leads', verifyApiKey, leadsV2Router);
```

### Core (`leads-status.ts`)

Three batched queries, two passes:

1. **Match leads.** Normalize email + linkedin_url on the input. Query
   `leads` once: `WHERE workspace_id = $1 AND (email IN (...) OR linkedin_url IN (...))`. Build two lookup maps:
   `byEmail[email] = lead`, `byNormUrl[normalizedUrl] = lead`.
2. **Pull qualifying interactions.** For matched lead contact_ids, one query:
   `WHERE workspace_id = $1 AND contact_id IN (...) AND property IN (<suppression properties>) ORDER BY occurred_at DESC`.
   Keep the most recent observation per (contact_id, property bucket).
3. **Compute status per input lead.** Walk the precedence table top-down.
   If no row matched → `unknown`. If matched but no qualifying observation
   → `known`. Else the highest-precedence observation wins.

The whole thing is two SELECTs and a fold. No per-lead query loops; latency
is roughly constant in batch size.

Reuse `normalizeLinkedInUrl` from `leads.ts` so import-dedup and check-status
match exactly. Drift between the two would be a silent correctness bug.

## Open questions

- **`dnc` table.** No explicit DNC table exists today. Two options:
  (a) `dnc_entries (workspace_id, email, linkedin_url, reason, added_at)` —
  small, focused; (b) `lead.is_dnc` boolean flag — denormalized. (a) is the
  cleaner answer and avoids merging suppression into the leads schema.
  Ship the endpoint without `dnc` status v1 (return 0); add the table +
  status in a follow-up.
- **Workspace-only vs. shared.** Today, every workspace sees only its own
  leads. Agencies running multi-client workspaces would want suppression
  scoped *per client* by default but *cross-client* on opt-in. Out of scope
  for v1.
- **`account` as the heavy alternative.** The existing v2 `account` verb
  returns full identity-resolved data on one lead. `check` is the
  high-throughput batched equivalent that returns only the suppression
  status. They're complementary — keep both.

## Out of scope (intentional)

- Marking leads as DNC via this endpoint. Use a separate
  `POST /v2/leads/dnc` (also new) when DNC ships.
- Returning enrichment fields. That's `account`/`record`. Keep `check`
  fast and lean.
- Returning the full interaction history. Same.

## Test plan

- 0 leads → 400.
- 1001 leads → 400.
- Lead matches by email only → status correct.
- Lead matches by URL only → URL normalization correct.
- Lead matches by both → returned once.
- Lookback boundary: an `interaction.email_sent` exactly `lookback_days` ago
  → `contacted`; one day older → `known`.
- Precedence: bounced + replied on same contact → `bounced` wins (higher
  precedence).
- Authn: missing API key → 401; bogus key → 401; valid key, wrong workspace
  → returns no matches (not 403).

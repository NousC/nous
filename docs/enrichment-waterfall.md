# Enrichment Waterfall

Enrichment takes a thin contact — a name, a domain, maybe a LinkedIn URL — and fills in the firmographics (title, seniority, department, company, location, phone) and, when missing, a work email. It then re-scores the contact's ICP fit from what it learned.

This document describes the **principle** behind how we enrich and the **exact mechanics** of the deployed code. Read it alongside [Identity Resolution](./identity-resolution.md) (which decides *which* contact a signal belongs to) and [ICP & GTM Context](./icp-and-gtm-context.md) (which decides *how* a contact scores).

---

## The principle: two waterfalls, not one

People say "waterfall enrichment" loosely. In Nous it means two distinct cascades, and it's worth being precise about both:

1. **The identifier waterfall** — for a single lead, use the *best identifier available* to ask a provider for a match. Email is strongest, then a usable LinkedIn URL, then name + company domain. We pass everything we hold and let the provider match on the strongest key, and we **drop identifiers that are known to be useless** (see member-URN URLs below) so they never poison a lookup.

2. **The provider precedence ladder** — choose *one* provider to do that lookup, in priority order: a workspace's own Apollo key, then its own Prospeo key, then Nous's built-in Prospeo key. The first available provider runs.

> **Important — there is currently no cross-provider fall-through.** The ladder *selects* one provider; it does not try Apollo, then retry with Prospeo on a miss. If the selected provider returns `NO_MATCH`, the lead is marked `not_found` and enrichment stops. Cross-provider fall-through and a third provider (Findymail) are on the [roadmap](#roadmap--not-yet-implemented), not in the deployed code.

Everything a provider returns is written as a **provenance-tagged observation** (which provider said it, and when), never a bare column overwrite. That is what lets a later agent trust — or distrust — a fact.

---

## Where it runs

The exact same logic lives in two places, because enrichment is triggered from two kinds of context:

| Path | Source | Triggered by |
|------|--------|--------------|
| **API (synchronous)** | `apps/api/src/services/enrichment.mjs` → `enrichContact()` | The **Enrich** button on a record, `POST /api/contacts/:id/enrich` |
| **Worker (background)** | `apps/worker/src/utils/enrichContact.mjs` → `enrichContact()` | New-contact creation, and **bulk** lead-list enrich jobs |

Keep them in sync. Any change to the dispatcher, the provider calls, or the gate must be made in **both** files.

---

## Step 1 — The gate (is this lead enrichable?)

```js
const hasNameDomain = !!(contact.first_name && contact.last_name && contact.domain);
if (!contact.email && !usableLinkedInUrl(contact.linkedin_url) && !hasNameDomain) return;
```

A lead is enrichable only if it has at least one **usable** key:

- a real **email**, or
- a **usable LinkedIn URL** (not a member-URN — see below), or
- a **full name + company domain** (the Apollo name+domain path).

A bare name with no email, no usable URL, and no domain is **un-enrichable** — we return early and spend nothing.

### Member-URN LinkedIn URLs are not usable

`packages/core/src/utils/identity.ts` → `isMemberUrnLinkedInUrl()`

A URL like `linkedin.com/in/ACoAA…` wraps LinkedIn's internal, opaque member id. It resolves in a logged-in browser but is **not** a stable public vanity handle, and external finders (Prospeo especially) return nothing for it. The guard:

```js
export function isMemberUrnLinkedInUrl(raw) {
  const slug = String(raw).match(/\/in\/([^/?#]+)/i)?.[1];
  return !!slug && /^acoaa/i.test(slug);   // case-insensitive; dashes don't matter
}
```

`usableLinkedInUrl()` returns `null` for these, so a member-URN URL never counts as a reason to enrich, and is never sent to a provider. The real public URL is recovered separately via [URL healing](#url-healing--the-free-linkedin-path).

---

## Step 2 — Provider precedence

```js
const apolloKey = await getProviderKey(ws, 'apollo', /* requireEnrichmentToggle */ true);
if (apolloKey) return enrichViaApollo(...);

const prospeoKey = await getProviderKey(ws, 'prospeo');
return enrichViaProspeo(..., prospeoKey || process.env.PROSPERO_API_KEY);
```

The ladder, in order:

1. **Apollo (BYOK)** — only if the workspace connected Apollo **and** toggled `use_for_enrichment` on. Apollo is preferred because it matches on name+domain well and returns rich firmographics.
2. **Prospeo (BYOK)** — the workspace's own Prospeo key.
3. **Built-in Prospeo** — Nous's `PROSPERO_API_KEY`, the safety net so Cloud enrichment works before a customer brings any key.

The first one with a key runs, and only that one. See the [no-fall-through note](#the-principle-two-waterfalls-not-one).

All keys are **BYOK**, stored encrypted per workspace in `workflow_provider_connections` and resolved through `workflow_providers`. The Apollo connection carries a `use_for_enrichment` flag so a workspace can connect Apollo for other uses without spending enrichment credits on it.

---

## Step 3 — The identifier match (inside the provider)

### Apollo — `enrichViaApollo()`

Builds a `people/match` request from **every key it holds**, so a no-email lead with a real domain still matches on name+domain:

```js
const match = { reveal_personal_emails: false, reveal_phone_number: false };
if (contact.email)      match.email             = contact.email;
if (usableUrl)          match.linkedin_url       = usableUrl;   // member-URN dropped
if (contact.first_name) match.first_name         = contact.first_name;
if (contact.last_name)  match.last_name          = contact.last_name;
if (contact.domain)     match.domain             = contact.domain;
if (contact.company)    match.organization_name  = contact.company;

const canMatch = match.email || match.linkedin_url
  || (match.first_name && match.last_name && (match.domain || match.organization_name));
```

If there's nothing Apollo can match on, the lead is set `not_found` and no call is made.

### Prospeo — `enrichViaProspeo()`

Prospeo resolves from a **real email** or a **usable LinkedIn URL** (plus name as a hint). Placeholder import emails (`@…​.import`, `.csv`, `.test`, …) are stripped to `null` first, so they never masquerade as a real address:

```js
const realEmail = contact.email && !FAKE_DOMAINS.test(domainOf(contact.email)) ? contact.email : null;
const liUrl = usableLinkedInUrl(contact.linkedin_url);
if (!realEmail && !liUrl) { mark not_found; return; }
```

Prospeo has **no name+domain-only path** — without an email or a usable URL it returns early. (This is why a small-company lead with only name+domain needs Apollo.)

---

## Step 4 — Record with provenance

A successful match never blind-writes columns. Each attribute is written as an **observation tagged with the true provider**:

```js
await recordEnrichmentObservations(ws, contact.id, 'apollo' | 'prospeo' | 'linkedin', updates);
```

Then the enrichment attributes are **stripped from the contacts-view update** so the view trigger doesn't re-tag them with the record's origin source and erase provenance:

```js
const ENRICH_STRIP = ['job_title','seniority','department','company','phone','city','country'];
```

A discovered **email** is registered as an `entity_identifier` (kind `email`), not just a column — so identity resolution can key off it afterward. The claims layer derives each field's current value, source, and freshness from this observation history.

---

## Step 5 — Re-score ICP

After every successful enrichment, `scoreICP()` runs (`apps/worker/src/utils/enrichContact.mjs` and the API equivalent). It is gated on having at least one firmographic field (title / seniority / department / company), so **email alone never moves the score** — firmographics do. The contact's `icp_score`, `icp_fit`, and `icp_reasoning` are updated in place. Scoring is its own subsystem; see [ICP & GTM Context](./icp-and-gtm-context.md).

---

## URL healing & the free LinkedIn path

`apps/worker/src/utils/enrichContact.mjs` → `applyLinkedInProfile()`

This is a separate, **no-paid-provider** enrichment that runs when we have a Unipile LinkedIn profile (e.g. from a connected LinkedIn account):

- **Fill from the profile** — title, company, photo, phone — only into empty fields, never overwriting a paid provider or user-set value.
- **Headline fallback** — when the cheap parse can't find a clean "Role @ Company", Haiku extracts the current role from the free-text headline. We already pay for a Haiku call to score ICP, so this adds no new vendor and no email spend.
- **URL healing** — if the contact's `linkedin_url` is a member-URN (or missing), and Unipile gives us the `public_identifier`, we rewrite it to the real `https://www.linkedin.com/in/<handle>` and store it as an identifier. This is what makes a Sales-Navigator-sourced lead enrichable: the encoded URL becomes a scrapeable public one, while `member_id` stays the matching anchor.
- **Score** — a LinkedIn-only contact with a title is now scoreable without ever spending on email.

---

## Bulk & agent surfaces

### Lead-list bulk enrich

`apps/api/src/routes/api/leadLists.mjs` → `POST /api/lead-lists/:id/enrich`

- **Selection** by explicit `ids` or by `filter` (e.g. "all leads missing an email"), so the agent never has to enumerate ids.
- **Classification** per lead before spending: `chargeable`, `reused` (already enriched within the reuse window), or `no_identifier`.
- **Reuse gate** — a lead enriched within the last **90 days** (read off the append-only enrichment observations) is never re-charged.
- **Dry-run preview** (`preview: true`) returns chargeable count, the provider that would lead, and a `$` estimate — report it to the user **before** spending.
- **Background jobs** for large selections, drained by the worker, with per-run summaries in the operations log.

### Agent tools (MCP)

`apps/mcp/src/server.js` → `enrich_leads` / `verify_leads`

Both are **two-step**: call without `confirm` for a cost preview, then with `confirm: true` to run as a background job. The agent has full parity with the in-app buttons because both call the same endpoints.

---

## Enrich vs Verify — the clean split

These are **separate verbs and must stay separate**:

- **Enrich** *finds* missing values (email, firmographics). The only thing that writes a new email.
- **Verify** *validates deliverability* of an email we already hold — MillionVerifier → NeverBounce (this one **does** fall through) — and writes a `reachability_status` (`VERIFIED` / `RISKY` / `UNAVAILABLE`). It never changes the email and never enriches.

A bad email therefore shows as `invalid` and simply stays there until someone deliberately re-enriches — Verify has no hidden side effects, which is also what makes it safe for an agent to run.

---

## Statuses

`contacts.enrichment_status` moves through:

| Status | Meaning |
|--------|---------|
| `queued` | A provider call is in flight. |
| `complete` | A provider matched and attributes were written. |
| `not_found` | No usable identifier, or the provider returned `NO_MATCH`. |
| `failed` | The provider errored (HTTP error, bad key). |
| `no_integration` | No Prospeo key available at all (self-host without a key). |

---

## Roadmap — not yet implemented

These are intentionally called out so the doc isn't read as describing them:

- **Cross-provider fall-through.** Today the ladder selects one provider. The intended evolution is a true fall-through: on a `NO_MATCH`, try the next rung (e.g. Apollo → Findymail → Prospeo) and stop on the first verified hit, so a lead one provider lacks is caught by another.
- **Findymail as a third rung** — a founder/agency-focused email finder that only charges for valid emails.
- **Negative cache** — recording a provider's *miss* so a re-run doesn't re-pay for a known-dead lookup (the 90-day reuse gate covers part of this today).

When implemented, the dispatcher returns a hit/miss signal per provider and the ladder iterates instead of selecting.

---

## Source map

| Concern | File |
|---------|------|
| API dispatcher + Apollo/Prospeo paths | `apps/api/src/services/enrichment.mjs` |
| Worker dispatcher + paths + LinkedIn/URL healing | `apps/worker/src/utils/enrichContact.mjs` |
| Member-URN guard | `packages/core/src/utils/identity.ts` (`isMemberUrnLinkedInUrl`) |
| Provenance observations | `packages/core` (`recordEnrichmentObservations`) |
| Bulk enrich + reuse gate + cost preview | `apps/api/src/routes/api/leadLists.mjs` |
| Agent tools | `apps/mcp/src/server.js` (`enrich_leads`, `verify_leads`) |
| Per-record cost estimates | `apps/api/src/lib/providerPricing.mjs` |
| Email verification | `apps/api/src/services/verification.mjs` |

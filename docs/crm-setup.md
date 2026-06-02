# CRM Setup Guide

What each CRM needs before Nous can sync fully. Most of it is automatic; the one
manual step is the ICP custom fields, which some CRMs/tokens can't auto-create.

## What needs no setup
Nous reconciles **standard** contact fields (`job_title`, `company`, `phone`)
that already exist in every CRM — nothing to create. Pull, push, and contact
creation also need no setup beyond the connection.

## What may need setup — the `nous_icp_*` fields
Nous writes its ICP score to **its own namespaced fields** (so it never
overwrites your team's own ICP field). It tries to create them automatically on
first write; if your API token lacks schema-write permission, create them once
by hand using the specs below. After they exist, the auto-create step just
no-ops ("already exists").

### Attio — People object
| Attribute | Type | Slug |
|---|---|---|
| Nous ICP Score | Number | `nous_icp_score` |
| Nous ICP Fit | Checkbox | `nous_icp_fit` |
| Nous ICP Scored At | Timestamp | `nous_icp_scored_at` |
| Nous ICP Reason | Text | `nous_icp_reason` |
Auto-create needs the token to have **object-configuration write** access. If the
apply log shows `field provisioning failed: … 403/permission`, create them by hand.

### HubSpot — Contact properties (group: Contact information)
| Property | Type / Field type | Internal name |
|---|---|---|
| Nous ICP Score | Number / number | `nous_icp_score` |
| Nous ICP Fit | Single-line text / text | `nous_icp_fit` |
| Nous ICP Scored At | Date picker / date | `nous_icp_scored_at` |
| Nous ICP Reason | Single-line text / text | `nous_icp_reason` |
Auto-create needs the `crm.schemas.contacts.write` scope on the private-app token.

### Pipedrive — Person custom fields
Pipedrive custom fields use hashed keys, so Nous does **not** auto-write ICP to
Pipedrive yet (deferred). Field reconcile (`phone`) and contact create/push work.

### Salesforce
Not integrated yet.

## Standard reconciled fields per provider (no setup)
| Field | HubSpot | Pipedrive | Attio |
|---|---|---|---|
| job_title | ✅ `jobtitle` | — (custom) | ✅ `job_title` |
| company | ✅ | ✅ (org) | — (relationship) |
| phone | ✅ | ✅ | ✅ |

## Verifying
Approve a **field** proposal first (job_title/company/phone) — those hit standard
fields and prove the write path with no setup. Then approve an **ICP** proposal;
if it fails with "Cannot find attribute/property", create the `nous_icp_*` fields
above and retry.

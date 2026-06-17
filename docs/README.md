# Nous docs

Grouped by area. Each group has a **start-here** doc; the rest are deep-dives.

## CRM sync
- **[CRM Sync](./crm-sync.md)** — start here. How Nous keeps a connected CRM
  (HubSpot, Pipedrive, Attio) in step with the customer graph: pull, push,
  create, and hygiene (reconcile + apply-on-approve + ICP write-back + echo).
- [CRM Setup Guide](./crm-setup.md) — per-CRM custom fields to create before
  ICP write-back works.

## ICP & GTM Context
- **[The ICP Model & GTM Context](./icp-and-gtm-context.md)** — the single ICP
  doc: GTM Context, the Scorecard, enrichment, the Mind learning loop, and
  build-from-closed-deals.

## Platform mechanics
- [Identity Resolution](./identity-resolution.md) — matching every inbound signal
  to the right contact/entity.
- [Pipeline Stages](./pipeline-stages.md) — behavior-driven stage advancement and
  decay.
- [Claude org preferences](./claude-org-preferences.md) — route GTM work through
  your Nous workspace by default.

## Decisions (ADRs)
- [0001 — Empower the agent, not the interface](./decisions/0001-empower-the-agent-not-the-interface.md)
- [0002 — v1 tables as views over the v2 substrate](./decisions/0002-v1-tables-as-views-over-v2-substrate.md)

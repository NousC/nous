# Nous docs

Grouped by area. Each group has a **start-here** doc; the rest are deep-dives.

## ICP & GTM Context
- **[ICP Scoring & GTM Context](./icp-scoring.md)** — the single ICP doc: the
  substrate, the scorer, the three feature layers, the per-person score and its
  history trail, win/loss resolution, the Mind learning loop, build-from-closed-
  deals, GTM Context + ICP file symbiosis, and Playbooks.

## Platform mechanics
- **[Identity Resolution](./identity-resolution.md)** — how Nous folds every
  signal into one record per person: one person many identifiers, how a match is
  made, meetings via the calendar, enrich-don't-erase, and the bias against false
  merges.
- [Enrichment Waterfall](./enrichment-waterfall.md) — how a thin lead gets its
  firmographics and email: the identifier waterfall, provider precedence
  (Apollo → Prospeo), member-URN handling, URL healing, and provenance.
- [Claude org preferences](./claude-org-preferences.md) — route GTM work through
  your Nous workspace by default.

## Decisions (ADRs)
- [0001 — Empower the agent, not the interface](./decisions/0001-empower-the-agent-not-the-interface.md)
- [0002 — v1 tables as views over the v2 substrate](./decisions/0002-v1-tables-as-views-over-v2-substrate.md)

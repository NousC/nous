// @proply/core — shared DB logic, memory types, identity resolution
// All apps import from here. Never duplicate DB queries in app code.

// TODO: migrate from assetly-blueprint/server/services/
// Key files to port:
//   - ContactIntegrationService.js  → contact CRUD + signal writing
//   - ContactHistoryEnricher.mjs    → activity timeline enrichment
//   - identity resolution waterfall  → src/identity.ts

export {};

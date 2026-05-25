-- ============================================================
-- NOUS v2 — Evidence Substrate Schema
--
-- The whole model in one idea: store evidence, not values.
-- You never store "title = VP Eng". You store every OBSERVATION
-- that bears on the title — immutably — and DERIVE the current
-- belief (a CLAIM) with confidence, provenance, and decay.
--
-- One fact pattern, applied everywhere:  observation -> claim.
-- The core is append-only; claims are a regenerable cache of
-- inference. Throw away every claim, keep every observation,
-- and the whole model rebuilds.
--
-- Run once on a fresh Supabase project (auth.users enabled).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Shared helpers ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- One workspace-membership check, used by every RLS policy.
-- Parameter name `workspace_uuid` is kept stable: CREATE OR REPLACE
-- cannot rename an input parameter on an existing function.
CREATE OR REPLACE FUNCTION is_workspace_member(workspace_uuid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = workspace_uuid AND user_id = auth.uid()
  );
$$;

-- Observations are append-only. DELETE is never permitted. UPDATE is permitted
-- ONLY to fill the derived `embedding` index — the evidence itself (subject,
-- property, value, source, observed_at, …) can never change.
CREATE OR REPLACE FUNCTION reject_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE probe observations%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'observations are append-only — DELETE is not permitted';
  END IF;
  probe := NEW;
  probe.embedding := OLD.embedding;          -- exempt the embedding index from the check
  IF ROW(probe.*) IS DISTINCT FROM ROW(OLD.*) THEN
    RAISE EXCEPTION 'observations are append-only — only the embedding index may change';
  END IF;
  RETURN NEW;
END; $$;


-- ============================================================
-- TENANCY  (ported unchanged from v1 — already clean)
-- ============================================================

CREATE TABLE teams (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    UUID REFERENCES teams(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

CREATE TABLE workspace_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX workspace_members_user ON workspace_members(user_id);
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY wm_select ON workspace_members FOR SELECT USING (user_id = auth.uid());
CREATE POLICY ws_select ON workspaces FOR SELECT USING (is_workspace_member(id));

CREATE TABLE api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL UNIQUE,            -- SHA-256 of the raw key
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX api_keys_hash ON api_keys(key_hash);
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY ak_select ON api_keys FOR SELECT USING (is_workspace_member(workspace_id));


-- ============================================================
-- 1. ENTITIES  — canonical, temporal anchors
--
-- An entity holds almost no data. It is the thing observations
-- attach to and the thing that SURVIVES identity change: the
-- same person-entity persists across a job change or new email.
-- The workspace itself is an entity (type 'workspace') so that
-- ICP / product / pricing are just claims like any other.
-- ============================================================

CREATE TABLE entities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('person','company','deal','workspace')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','merged')),
  merged_into  UUID REFERENCES entities(id),    -- set when status='merged' (reversible)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX entities_workspace ON entities(workspace_id, type) WHERE status = 'active';
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY ent_select ON entities FOR SELECT USING (is_workspace_member(workspace_id));
CREATE TRIGGER entities_touch BEFORE UPDATE ON entities
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- ============================================================
-- 2. ENTITY_IDENTIFIERS  — the canonical registry
--
-- Maps external identifiers (email, domain, LinkedIn id, CRM
-- ids) to an entity. Identity is NOT a natural key — email is
-- just one identifier among many, and links are reversible
-- (status 'retired') so a bad merge or a reused email is fixable.
-- ============================================================

CREATE TABLE entity_identifiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_id     UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,        -- 'email'|'domain'|'linkedin_member_id'|'linkedin_url'|'phone'|'hubspot'|'salesforce'|'pipedrive'|'attio'|'apollo'|'crm'
  value         TEXT NOT NULL,        -- normalized (lowercased email, bare domain, …)
  confidence    REAL NOT NULL DEFAULT 1.0,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One active entity per identifier value.
CREATE UNIQUE INDEX entity_identifiers_active
  ON entity_identifiers(workspace_id, kind, value) WHERE status = 'active';
CREATE INDEX entity_identifiers_entity ON entity_identifiers(entity_id);
ALTER TABLE entity_identifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY eid_select ON entity_identifiers FOR SELECT USING (is_workspace_member(workspace_id));


-- ============================================================
-- 3. OBSERVATIONS  — the immutable, append-only spine
--
-- The atomic unit and the system of record. Every enrichment
-- result, every email, every reply, every bounce, every agent
-- action is ONE observation. kind 'state' = an assertion about
-- a property ("title is X"); kind 'event' = something happened
-- ("email sent"). Observations NEVER mutate and NEVER decay —
-- a meeting on May 10 happened, forever.
-- ============================================================

CREATE TABLE observations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_id         UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('state','event')),
  property          TEXT NOT NULL,         -- 'job_title' | 'industry' | 'interaction.email_sent' | 'email.bounced' | …
  value             JSONB NOT NULL,        -- scalar or structured; for events, the event payload
  source            TEXT NOT NULL,         -- 'apollo'|'gmail'|'hubspot'|'instantly'|'agent'|'user'|…
  method            TEXT NOT NULL,         -- 'api'|'webhook'|'extraction'|'inference'|'user_input'
  source_confidence REAL,                  -- the source's own stated confidence, if any
  observed_at       TIMESTAMPTZ NOT NULL,  -- when it was true / when it happened
  ingested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  external_id       TEXT,                  -- source's own event id, for dedup
  raw               JSONB,                 -- raw payload, kept for provenance & replay
  content_hash      TEXT,
  embedding         VECTOR(1536),          -- semantic search over evidence
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX observations_dedup
  ON observations(workspace_id, source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX observations_claim_input
  ON observations(entity_id, property, observed_at DESC);   -- feeds claim derivation
CREATE INDEX observations_timeline
  ON observations(entity_id, observed_at DESC);             -- the account timeline
CREATE INDEX observations_embedding
  ON observations USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Append-only: no UPDATE, no DELETE, ever.
CREATE TRIGGER observations_immutable
  BEFORE UPDATE OR DELETE ON observations
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY obs_select ON observations FOR SELECT USING (is_workspace_member(workspace_id));
-- Writes are service-role only (the ingestion worker / API).


-- ============================================================
-- 4. CLAIMS  — the derived layer
--
-- The current best belief about (entity, property): a value, a
-- calibrated confidence, an epistemic class, a freshness state,
-- and pointers to the observations that produced it. Claims are
-- NEVER written directly — they are computed from observations
-- and are fully regenerable. This replaces every bare column
-- that lived on v1's `contacts` / `companies`.
-- ============================================================

CREATE TABLE claims (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id               UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_id                  UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  property                   TEXT NOT NULL,
  value                      JSONB NOT NULL,                  -- current best value (argmax)
  distribution               JSONB,                           -- candidate values + probabilities
  confidence                 REAL NOT NULL,                   -- calibrated 0..1
  epistemic_class            TEXT NOT NULL CHECK (epistemic_class IN ('observed','inferred','predicted','asserted')),
  freshness                  TEXT NOT NULL DEFAULT 'fresh' CHECK (freshness IN ('fresh','aging','suspect','expired')),
  decays_at                  TIMESTAMPTZ,                     -- predicted staleness time (decay model)
  valid_from                 TIMESTAMPTZ,                     -- when the value became true (real-world time)
  invalid_at                 TIMESTAMPTZ,                     -- positive evidence the fact ended; NULL = still valid.
                                                              -- distinct from freshness='expired' (uncertainty from silence).
                                                              -- Claims are never deleted — only invalidated.
  supporting_observation_ids UUID[] NOT NULL DEFAULT '{}',     -- provenance
  observation_count          INT  NOT NULL DEFAULT 0,
  last_observed_at           TIMESTAMPTZ,
  embedding                  VECTOR(1536),
  computed_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, entity_id, property)                  -- one current claim per property
);
CREATE INDEX claims_entity   ON claims(entity_id);
CREATE INDEX claims_property ON claims(workspace_id, property);
CREATE INDEX claims_decay    ON claims(decays_at) WHERE freshness <> 'expired';
CREATE INDEX claims_embedding
  ON claims USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY clm_select ON claims FOR SELECT USING (is_workspace_member(workspace_id));


-- ============================================================
-- 5. RELATIONSHIPS  — derived entity-to-entity edges
--
-- Same evidence pattern as claims (derived, confidence,
-- provenance) but shaped for two entities: works_at, reports_to,
-- competitor_of, uses. Temporal — valid_to NULL means current.
-- ============================================================

CREATE TABLE relationships (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id               UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  from_entity_id             UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  to_entity_id               UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  type                       TEXT NOT NULL,    -- 'works_at'|'reports_to'|'competitor_of'|'uses'|…
  confidence                 REAL NOT NULL DEFAULT 1.0,
  valid_from                 TIMESTAMPTZ,
  valid_to                   TIMESTAMPTZ,      -- NULL = current
  supporting_observation_ids UUID[] NOT NULL DEFAULT '{}',
  computed_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, from_entity_id, to_entity_id, type)
);
CREATE INDEX relationships_from ON relationships(from_entity_id) WHERE valid_to IS NULL;
CREATE INDEX relationships_to   ON relationships(to_entity_id)   WHERE valid_to IS NULL;
ALTER TABLE relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY rel_select ON relationships FOR SELECT USING (is_workspace_member(workspace_id));


-- ============================================================
-- 6. PREDICTIONS  — the compound-intelligence loop
--
-- A prediction is a claim about the FUTURE. The prediction half
-- is an immutable snapshot — including feature_snapshot, which
-- stores each scored feature WITH its confidence at scoring time
-- (so the loop can weight learning by data reliability). The
-- resolution half is written once, later, by the outcome job.
-- A (prediction, outcome) pair is one graded Episode.
-- ============================================================

CREATE TABLE predictions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_id              UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  kind                   TEXT NOT NULL,        -- 'icp_fit'|'will_reply'|'will_convert'|'deal_close'|…

  -- Prediction (immutable snapshot — never updated)
  predicted_value        JSONB NOT NULL,
  predicted_confidence   REAL  NOT NULL,
  feature_snapshot       JSONB NOT NULL DEFAULT '{}',   -- {feature: {value, confidence}} at scoring time
  model_version          TEXT,
  predicted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Resolution (written once by the outcome job)
  outcome_value          JSONB,
  outcome_observation_id UUID REFERENCES observations(id),
  resolved_at            TIMESTAMPTZ,           -- NULL = still open
  resolution_window_days INT NOT NULL DEFAULT 30,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX predictions_open
  ON predictions(workspace_id, predicted_at) WHERE resolved_at IS NULL;
CREATE INDEX predictions_resolved
  ON predictions(workspace_id, kind, resolved_at) WHERE resolved_at IS NOT NULL;
CREATE INDEX predictions_entity ON predictions(entity_id);
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY prd_select ON predictions FOR SELECT USING (is_workspace_member(workspace_id));


-- ============================================================
-- 7. SCORECARD  — adaptive scoring model  (ported from v1)
--
-- A weighted list of signals; a score is the arithmetic sum of
-- firing signals. Decomposable on purpose — every score traces
-- to its signals. The nightly loop proposes one change, tests
-- it on held-back evidence, keeps it only if it generalises.
-- ============================================================

CREATE TABLE scorecard_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'icp_fit',
  gap_before   NUMERIC,
  gap_after    NUMERIC,
  signal_count INT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX scorecard_runs_ws ON scorecard_runs(workspace_id, created_at DESC);

CREATE TABLE scorecard_signals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'icp_fit',
  key          TEXT NOT NULL,
  label        TEXT NOT NULL,
  weight       INT  NOT NULL DEFAULT 0,
  rule         JSONB NOT NULL DEFAULT '{}',     -- fires against an entity's claims
  coverage     INT  NOT NULL DEFAULT 0,
  added_in     UUID REFERENCES scorecard_runs(id) ON DELETE SET NULL,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, kind, key)
);
CREATE INDEX scorecard_signals_ws ON scorecard_signals(workspace_id, kind, active);
CREATE TRIGGER scorecard_signals_touch BEFORE UPDATE ON scorecard_signals
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- ============================================================
-- 7b. WORKER RUNS  — transparency on the compound-intelligence loop
--
-- Every nightly/periodic worker writes a row after each invocation
-- so the Intelligence page can show, at a glance, whether the loop
-- is alive. Per-workspace rows for workspace-scoped workers
-- (mind_outcomes, scorecard_loop, score_entities, crm_sync);
-- workspace_id IS NULL for system-wide workers (claim_engine,
-- embeddings, pipeline_decay, lead_replies).
-- ============================================================

CREATE TABLE worker_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES workspaces(id) ON DELETE CASCADE,  -- NULL = system-wide
  worker        TEXT NOT NULL,
  status        TEXT NOT NULL,                                     -- 'success' | 'error' | 'no_op'
  summary       TEXT,
  details       JSONB NOT NULL DEFAULT '{}',
  error         TEXT,
  duration_ms   INT,
  started_at    TIMESTAMPTZ NOT NULL,
  finished_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX worker_runs_workspace ON worker_runs(workspace_id, finished_at DESC);
CREATE INDEX worker_runs_worker    ON worker_runs(worker, finished_at DESC);
CREATE INDEX worker_runs_finished  ON worker_runs(finished_at DESC);


-- ============================================================
-- 8. COLLECTIONS  — saved groupings of entities
--
-- Replaces v1's `lead_lists` / `leads`. A "lead list" is just a
-- collection of person-entities; a 10k cold CSV import is a
-- collection. There is no separate `leads` table — a lead is an
-- entity, its outreach is observations, its score a prediction.
-- ============================================================

CREATE TABLE collections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'list',   -- 'list'|'segment'
  source       TEXT,                           -- 'csv'|'apollo'|'linkedin'|…
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY col_select ON collections FOR SELECT USING (is_workspace_member(workspace_id));

CREATE TABLE collection_entities (
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  entity_id     UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, entity_id)
);


-- ============================================================
-- 9. CLAIM_JOBS  — the recompute queue (self-healing)
--
-- Every observation insert enqueues a recompute for its
-- (entity, property). The worker drains the queue and re-derives
-- the claim. This is the self-healing loop: a new observation
-- always pulls the affected belief back toward truth.
-- ============================================================

CREATE TABLE claim_jobs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_id    UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  property     TEXT NOT NULL,
  enqueued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  picked_at    TIMESTAMPTZ
);
CREATE INDEX claim_jobs_pending ON claim_jobs(enqueued_at) WHERE picked_at IS NULL;

CREATE OR REPLACE FUNCTION enqueue_claim_recompute()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO claim_jobs (workspace_id, entity_id, property)
  VALUES (NEW.workspace_id, NEW.entity_id, NEW.property);
  RETURN NEW;
END; $$;

CREATE TRIGGER observations_enqueue_recompute
  AFTER INSERT ON observations
  FOR EACH ROW EXECUTE FUNCTION enqueue_claim_recompute();


-- ============================================================
-- 10. INTEGRATIONS  (ported unchanged from v1 — already clean)
--
-- Provider catalogue + per-workspace connections, CRM sync
-- config, the inbound-webhook retry queue, LinkedIn (Unipile),
-- and the system/ops log. Coverage is a real asset — kept as-is.
-- ============================================================

CREATE TABLE workflow_providers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO workflow_providers (name, display_name, category) VALUES
  ('gmail_oauth','Google Calendar / Gmail','communication'),
  ('smtp','Custom SMTP / IMAP','communication'),
  ('slack','Slack','communication'),
  ('instantly','Instantly','outbound'),
  ('fireflies','Fireflies.ai','meetings'),
  ('fathom','Fathom','meetings'),
  ('calendly','Calendly','meetings'),
  ('cal_com','Cal.com','meetings'),
  ('hubspot','HubSpot','crm'),
  ('salesforce','Salesforce','crm'),
  ('pipedrive','Pipedrive','crm'),
  ('attio','Attio','crm'),
  ('apollo','Apollo.io','enrichment'),
  ('prospeo','Prospeo','enrichment')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE workflow_provider_connections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_id           UUID NOT NULL REFERENCES workflow_providers(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL DEFAULT 'Default',
  encrypted_credentials JSONB NOT NULL DEFAULT '{}',
  is_verified           BOOLEAN DEFAULT false,
  last_used_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider_id, name)
);
CREATE INDEX wpc_workspace ON workflow_provider_connections(workspace_id);
ALTER TABLE workflow_provider_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY wpc_all ON workflow_provider_connections
  FOR ALL USING (is_workspace_member(workspace_id));
CREATE TRIGGER wpc_touch BEFORE UPDATE ON workflow_provider_connections
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE crm_sync_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id   UUID REFERENCES workflow_provider_connections(id) ON DELETE SET NULL,
  provider        TEXT NOT NULL,
  auto_sync       BOOLEAN DEFAULT false,
  push_activities BOOLEAN DEFAULT true,
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider)
);
ALTER TABLE crm_sync_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY csc_all ON crm_sync_configs FOR ALL USING (is_workspace_member(workspace_id));

CREATE TABLE workspace_webhook_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source)
);
ALTER TABLE workspace_webhook_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY wws_all ON workspace_webhook_subscriptions
  FOR ALL USING (is_workspace_member(workspace_id));

-- Inbound-webhook retry queue. Failed deliveries land here; a
-- worker cron retries with backoff. Happy paths never insert.
CREATE TABLE webhook_inbox (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source          TEXT NOT NULL,
  payload         JSONB NOT NULL,
  headers         JSONB,
  status          TEXT NOT NULL DEFAULT 'pending',
  attempts        INT NOT NULL DEFAULT 0,
  last_error      TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ
);
CREATE INDEX webhook_inbox_pending ON webhook_inbox(next_attempt_at) WHERE status = 'pending';

CREATE TABLE workspace_linkedin_connections (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  unipile_account_id TEXT NOT NULL,
  linkedin_name      TEXT,
  connected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id)
);
ALTER TABLE workspace_linkedin_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY wlc_all ON workspace_linkedin_connections
  FOR ALL USING (is_workspace_member(workspace_id));

-- System / ops log. On cloud, billable_ops is the metering unit.
CREATE TABLE workspace_system_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source       TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  summary      TEXT,
  entity_id    UUID REFERENCES entities(id) ON DELETE SET NULL,
  metadata     JSONB NOT NULL DEFAULT '{}',
  billable_ops INT  NOT NULL DEFAULT 1,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX wsl_workspace ON workspace_system_log(workspace_id, occurred_at DESC);
ALTER TABLE workspace_system_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY wsl_select ON workspace_system_log
  FOR SELECT USING (is_workspace_member(workspace_id));


-- ============================================================
-- 11. SEMANTIC SEARCH  — agents query meaning x epistemics
--
-- Agents search the substrate in natural language. Results carry
-- their epistemics (a claim's confidence/freshness) so the agent
-- can decide to act, verify, or abstain — never a bare value.
-- ============================================================

CREATE OR REPLACE FUNCTION search_claims(
  p_workspace_id UUID,
  p_embedding    VECTOR(1536),
  p_threshold    FLOAT,
  p_limit        INT
)
RETURNS TABLE (
  id UUID, entity_id UUID, property TEXT, value JSONB,
  confidence REAL, freshness TEXT, similarity FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.entity_id, c.property, c.value,
         c.confidence, c.freshness,
         (1 - (c.embedding <=> p_embedding))::FLOAT AS similarity
  FROM claims c
  WHERE c.workspace_id = p_workspace_id
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> p_embedding) >= p_threshold
  ORDER BY c.embedding <=> p_embedding
  LIMIT p_limit;
$$;

-- Semantic search over observations, with structured pre-filters. Powers the
-- question-driven path of POST /v2/query.
CREATE OR REPLACE FUNCTION search_observations(
  p_workspace_id    UUID,
  p_embedding       VECTOR(1536),
  p_kind            TEXT        DEFAULT NULL,
  p_property_prefix TEXT        DEFAULT NULL,
  p_source          TEXT        DEFAULT NULL,
  p_since           TIMESTAMPTZ DEFAULT NULL,
  p_limit           INT         DEFAULT 50
)
RETURNS TABLE (
  id UUID, entity_id UUID, property TEXT, value JSONB,
  source TEXT, observed_at TIMESTAMPTZ, similarity FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT o.id, o.entity_id, o.property, o.value, o.source, o.observed_at,
         (1 - (o.embedding <=> p_embedding))::FLOAT AS similarity
  FROM observations o
  WHERE o.workspace_id = p_workspace_id
    AND o.embedding IS NOT NULL
    AND (p_kind            IS NULL OR o.kind = p_kind)
    AND (p_property_prefix IS NULL OR o.property ILIKE p_property_prefix || '%')
    AND (p_source          IS NULL OR o.source = p_source)
    AND (p_since           IS NULL OR o.observed_at >= p_since)
  ORDER BY o.embedding <=> p_embedding
  LIMIT p_limit;
$$;


-- ============================================================
-- Done.
--
-- The whole model: entities are anchors; observations are
-- immutable evidence; claims are derived, confidence-scored
-- belief; relationships are derived edges; predictions are
-- claims about the future that get graded by outcomes.
-- One pattern — observation -> claim — applied everywhere.
--
-- The account record is not a table. It is a projection:
-- entity + its observations + its current claims + open
-- predictions, assembled on demand by the Context API.
-- ============================================================

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
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                       TEXT NOT NULL,
  slug                       TEXT UNIQUE,
  stripe_customer_id         TEXT UNIQUE,
  lifetime_deal_dismissed_at TIMESTAMPTZ,
  -- Usage credits / metering. Cloud billing fields; inert on self-host
  -- (nothing decrements them unless the metering worker is wired up).
  ops_balance                INTEGER NOT NULL DEFAULT 5000,
  ops_accounts_limit         INTEGER NOT NULL DEFAULT 50,
  ops_total_purchased        INTEGER NOT NULL DEFAULT 0,
  ops_topup_balance          BIGINT  NOT NULL DEFAULT 0,
  auto_topup_enabled         BOOLEAN NOT NULL DEFAULT false,
  auto_topup_threshold       INTEGER NOT NULL DEFAULT 1000,
  auto_topup_pack_id         TEXT,
  stripe_payment_method_id   TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_teams_ops_balance        ON teams(ops_balance);
CREATE INDEX idx_teams_stripe_customer_id ON teams(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

CREATE TABLE workspaces (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                      UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name                         TEXT NOT NULL,
  slug                         TEXT UNIQUE,
  icon                         TEXT,
  website                      TEXT,
  country                      VARCHAR(2),
  industry                     TEXT DEFAULT 'agency' CHECK (industry IN ('agency','startup','software','consultancy')),
  business_type                TEXT CHECK (business_type IS NULL OR business_type IN ('service','software')),
  icp_text                     TEXT,
  -- Brand / proposal config (used by the generation surfaces)
  brand_theme                  JSONB DEFAULT '{}',
  target_audience              JSONB DEFAULT '{}',
  design_style                 TEXT DEFAULT 'corporate' CHECK (design_style IN ('corporate','creative','minimalist','bold','elegant','modern','classic')),
  reference_images             JSONB DEFAULT '[]',
  default_language             TEXT DEFAULT 'en',
  proposal_flow_config         JSONB DEFAULT '{"invoice": {"enabled": false}, "landing_page": {"enabled": false, "message": "", "video_url": "", "button_text": "Open Proposal"}, "post_signature": {"enabled": true, "message": "", "video_url": "", "meeting_url": "", "meeting_label": "Book Onboarding Call"}, "legal_documents": []}'::jsonb,
  -- Billing / signup routing
  plan_model                   TEXT CHECK (plan_model IS NULL OR plan_model IN ('free_plan','free_trial','both','paid_only')),
  default_signup_stage         TEXT,
  stripe_subscription_item_id  TEXT,
  default_stripe_connection_id UUID,
  playbook_rebuild_count       INTEGER NOT NULL DEFAULT 0,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   DATE
);
CREATE INDEX idx_workspaces_team_id        ON workspaces(team_id);
CREATE INDEX idx_workspaces_brand_theme    ON workspaces USING gin (brand_theme);
CREATE INDEX idx_workspaces_target_audience ON workspaces USING gin (target_audience);
CREATE INDEX workspaces_country_idx        ON workspaces(country) WHERE country IS NOT NULL;
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
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key_hash           TEXT NOT NULL,                  -- SHA-256 of the raw key
  name               TEXT NOT NULL,
  created_by_user_id UUID,                           -- FK to users added after users is defined
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at       TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  UNIQUE (workspace_id, name)
);
CREATE INDEX api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_workspace_id     ON api_keys(workspace_id);
CREATE INDEX idx_api_keys_created_by       ON api_keys(created_by_user_id);
CREATE INDEX idx_api_keys_last_used_at     ON api_keys(last_used_at DESC);
CREATE INDEX idx_api_keys_workspace_revoked ON api_keys(workspace_id, revoked_at) WHERE revoked_at IS NULL;
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
  target       NUMERIC,
  steps        INTEGER NOT NULL DEFAULT 0,
  gap_before   NUMERIC,
  gap_after    NUMERIC,
  signal_count INTEGER,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX scorecard_runs_ws ON scorecard_runs(workspace_id, created_at DESC);

CREATE TABLE scorecard_signals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  label        TEXT NOT NULL,
  weight       INTEGER NOT NULL DEFAULT 0,
  rule         JSONB NOT NULL DEFAULT '{}',     -- fires against an entity's claims
  coverage     INTEGER NOT NULL DEFAULT 0,
  added_in     UUID REFERENCES scorecard_runs(id) ON DELETE SET NULL,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);
CREATE INDEX scorecard_signals_ws ON scorecard_signals(workspace_id, active);
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
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata     JSONB NOT NULL DEFAULT '{}'     -- list import config, e.g. {"columns": [...]}
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
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL UNIQUE,
  display_name     TEXT NOT NULL,
  description      TEXT,
  logo_url         TEXT,
  category         TEXT,
  api_docs_url     TEXT,
  api_docs_summary JSONB,
  auth_type        TEXT,
  auth_fields      JSONB,
  is_active        BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_workflow_providers_category ON workflow_providers(category);
CREATE INDEX idx_workflow_providers_active   ON workflow_providers(is_active) WHERE is_active = true;
INSERT INTO workflow_providers (name, display_name, category) VALUES
  ('gmail_oauth','Google Calendar / Gmail','communication'),
  ('smtp','Custom SMTP / IMAP','communication'),
  ('slack','Slack','communication'),
  ('instantly','Instantly','outbound'),
  ('emailbison','EmailBison','outbound'),
  ('heyreach','HeyReach','outbound'),
  ('smartlead','Smartlead','outbound'),
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
  created_by            UUID NOT NULL,          -- FK to users added after users is defined
  is_verified           BOOLEAN DEFAULT false,
  last_used_at          TIMESTAMPTZ,
  last_test_at          TIMESTAMPTZ,
  mcp_endpoint          TEXT,                   -- for MCP-backed providers
  mcp_transport         TEXT DEFAULT 'streamable_http',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider_id, name)
);
CREATE INDEX wpc_workspace ON workflow_provider_connections(workspace_id);
CREATE INDEX idx_workflow_connections_provider ON workflow_provider_connections(provider_id);
CREATE INDEX idx_workflow_connections_verified ON workflow_provider_connections(is_verified);
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
  contacts_synced INTEGER DEFAULT 0,
  push_activities BOOLEAN DEFAULT true,
  -- Create policy: WHEN a prospect earns a brand-new record in the CRM.
  create_in_crm          BOOLEAN NOT NULL DEFAULT true,
  create_trigger         TEXT    NOT NULL DEFAULT 'positive_reply_or_meeting'
                         CHECK (create_trigger IN ('any_reply_or_meeting', 'positive_reply_or_meeting', 'meeting_only', 'interested_stage')),
  create_require_icp_fit BOOLEAN NOT NULL DEFAULT true,
  create_icp_threshold   INTEGER NOT NULL DEFAULT 70,
  -- Hygiene: a scheduled routine reconciling the CRM with the customer graph.
  hygiene_enabled     BOOLEAN     NOT NULL DEFAULT true,
  hygiene_cadence     TEXT        NOT NULL DEFAULT 'weekly' CHECK (hygiene_cadence IN ('weekly', 'monthly')),
  hygiene_last_run_at TIMESTAMPTZ,
  hygiene_auto_apply  TEXT        NOT NULL DEFAULT 'off' CHECK (hygiene_auto_apply IN ('off', 'safe', 'all')),
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider)
);
ALTER TABLE crm_sync_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY csc_all ON crm_sync_configs FOR ALL USING (is_workspace_member(workspace_id));

-- One proposed hygiene change per row. v1 is propose-only; approving applies (Phase 2).
CREATE TABLE crm_hygiene_proposals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id         UUID,
  provider       TEXT NOT NULL,
  entity_id      UUID,
  crm_record_id  TEXT,
  kind           TEXT NOT NULL CHECK (kind IN ('field_fill', 'field_update', 'conflict', 'net_new', 'icp_rescore', 'milestone_sync')),
  field          TEXT,
  current_value  JSONB,
  proposed_value JSONB,
  evidence       JSONB,
  confidence     NUMERIC,
  reason         TEXT,
  status         TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'applied', 'dismissed', 'failed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at     TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX crm_hygiene_proposals_ws_status_idx ON crm_hygiene_proposals (workspace_id, status, created_at DESC);
CREATE INDEX crm_hygiene_proposals_run_idx       ON crm_hygiene_proposals (run_id);
ALTER TABLE crm_hygiene_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY chp_all ON crm_hygiene_proposals FOR ALL USING (is_workspace_member(workspace_id));
CREATE TRIGGER touch_crm_hygiene_proposals BEFORE UPDATE ON crm_hygiene_proposals
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Echo suppression: what Nous wrote to a CRM, so the next pull doesn't re-ingest it.
CREATE TABLE crm_write_state (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  crm_record_id TEXT NOT NULL,
  property      TEXT NOT NULL,
  value         JSONB,
  written_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider, crm_record_id, property)
);
CREATE INDEX crm_write_state_lookup_idx ON crm_write_state (workspace_id, provider, crm_record_id, property);
ALTER TABLE crm_write_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY cws_all ON crm_write_state FOR ALL USING (is_workspace_member(workspace_id));

CREATE TABLE workspace_webhook_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  tested_at    TIMESTAMPTZ,
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
  unipile_account_id   TEXT NOT NULL,
  linkedin_name        TEXT,
  linkedin_headline    TEXT,
  linkedin_profile_url TEXT,
  connected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
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
  summary      TEXT NOT NULL,
  contact_id   UUID,
  metadata     JSONB NOT NULL DEFAULT '{}',
  billable_ops INTEGER NOT NULL DEFAULT 1,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX wsl_workspace   ON workspace_system_log(workspace_id, occurred_at DESC);
CREATE INDEX wsl_source      ON workspace_system_log(workspace_id, source);
CREATE INDEX wsl_billing_idx ON workspace_system_log(workspace_id, occurred_at DESC) WHERE billable_ops > 0;
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
-- 12. TRIGGERS  — outbound webhooks (the "agent gets paged" surface)
--
-- The flip side of observation-in: event-out. A subscriber registers a
-- URL + event list; whenever a tracked interaction lands, the worker
-- POSTs a signed payload. Per-(event, subscription) fan-out at enqueue
-- time so one bad URL doesn't block the others; HMAC-SHA256 signing on
-- the raw body; exponential-backoff retry, dead-letter after 3 tries.
-- ============================================================

CREATE TABLE trigger_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  url             TEXT NOT NULL,
  events          TEXT[] NOT NULL,           -- e.g. ['interaction.email_received', ...]
  signing_secret  TEXT NOT NULL,             -- shown ONCE in the create response
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX trigger_subs_workspace ON trigger_subscriptions(workspace_id) WHERE active;
CREATE INDEX trigger_subs_events    ON trigger_subscriptions USING GIN (events) WHERE active;
ALTER TABLE trigger_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY trs_select ON trigger_subscriptions FOR SELECT USING (is_workspace_member(workspace_id));

CREATE TABLE outbound_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subscription_id   UUID NOT NULL REFERENCES trigger_subscriptions(id) ON DELETE CASCADE,
  entity_id         UUID REFERENCES entities(id) ON DELETE SET NULL,
  event_type        TEXT NOT NULL,
  payload           JSONB NOT NULL,                                     -- the signed POST body
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- delivery state
  delivered_at      TIMESTAMPTZ,
  attempts          INT NOT NULL DEFAULT 0,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_status_code  INT,
  last_error        TEXT,
  dead_lettered_at  TIMESTAMPTZ,
  external_id       TEXT                                                -- source event id, for dedup
);
CREATE UNIQUE INDEX outbound_events_dedup
  ON outbound_events(workspace_id, subscription_id, external_id);
CREATE INDEX outbound_pending
  ON outbound_events(next_attempt_at)
  WHERE delivered_at IS NULL AND dead_lettered_at IS NULL;
CREATE INDEX outbound_workspace
  ON outbound_events(workspace_id, occurred_at DESC);
ALTER TABLE outbound_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY oe_select ON outbound_events FOR SELECT USING (is_workspace_member(workspace_id));


-- ============================================================
-- 13. ACCOUNTS & BILLING  — the application identity layer
--
-- `workspace_members` (above) is the RLS anchor, keyed on
-- auth.users. This section is the app's own account model that
-- sits on top of it: a public `users` profile row per auth user,
-- team membership/invites, and the Stripe-backed subscription.
-- `is_admin` / `is_vip` are the operator flags — the API only
-- ever reports is_admin=true for an allowlisted email
-- (ADMIN_EMAILS), which is empty on self-host, so the operator
-- surface (CMS/Roadmap/Changelog, see schema.cloud.sql) is
-- unreachable for self-hosters by construction.
-- ============================================================

-- One profile row per Supabase auth user. `id` is the app id;
-- `supabase_user_id` links to auth.users. `team_id` is the
-- account the user belongs to.
CREATE TABLE users (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                     TEXT NOT NULL,
  name                      TEXT,
  team_id                   UUID NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  onboarding_completed_at   TIMESTAMPTZ,
  use_case                  TEXT,
  supabase_user_id          UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  is_admin                  BOOLEAN DEFAULT false,   -- operator flag (gated by ADMIN_EMAILS allowlist)
  profile_picture_url       TEXT,
  company_name              TEXT,
  default_signature         TEXT,
  default_signature_type    TEXT DEFAULT 'type' CHECK (default_signature_type IN ('draw','type','upload')),
  is_vip                    BOOLEAN DEFAULT false,   -- operator flag (gated by VIP_EMAILS allowlist)
  website_url               TEXT,
  account_setup_completed_at TIMESTAMPTZ,
  referred_by_code          TEXT,
  referred_by_affiliate_id  UUID,
  how_heard_about_us        TEXT,
  acquisition_referral_code TEXT,
  use_cases                 TEXT[],
  welcome_email_sent_at     TIMESTAMPTZ
);
CREATE INDEX idx_users_supabase_user_id  ON users(supabase_user_id);
CREATE INDEX idx_users_team_id           ON users(team_id);
CREATE INDEX idx_users_is_vip            ON users(id) WHERE is_vip = true;
CREATE INDEX idx_users_referred_by_code  ON users(referred_by_code) WHERE referred_by_code IS NOT NULL;
CREATE INDEX idx_users_default_signature ON users(id) WHERE default_signature IS NOT NULL;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_service_role ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY users_select_own   ON users FOR SELECT USING (id = auth.uid());
CREATE POLICY users_update_own   ON users FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Deferred FKs: these tables are defined earlier in the file (before `users`
-- existed), so their references to users(id) are wired up here.
ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES users(id);
ALTER TABLE workflow_provider_connections
  ADD CONSTRAINT workflow_provider_connections_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES users(id);

CREATE TABLE team_members (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id   UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('founder','owner','admin','member','viewer')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);
CREATE INDEX idx_team_members_team_id ON team_members(team_id);
CREATE INDEX idx_team_members_user_id ON team_members(user_id);
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_members_view_own ON team_members FOR SELECT USING (user_id = auth.uid());
CREATE POLICY team_members_view_team ON team_members FOR SELECT USING (
  EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = team_members.team_id AND tm.user_id = auth.uid())
);
CREATE POLICY team_members_admin_delete ON team_members FOR DELETE USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM team_members tm
             WHERE tm.team_id = team_members.team_id AND tm.user_id = auth.uid()
               AND tm.role IN ('founder','owner','admin'))
);

CREATE TABLE team_invitations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id            UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email              TEXT NOT NULL,
  token              TEXT NOT NULL UNIQUE,
  invited_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role               TEXT NOT NULL DEFAULT 'member'  CHECK (role IN ('owner','admin','member','viewer')),
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','cancelled')),
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  accepted_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_team_invitations_team_id    ON team_invitations(team_id);
CREATE INDEX idx_team_invitations_email      ON team_invitations(email);
CREATE INDEX idx_team_invitations_status     ON team_invitations(status);
CREATE INDEX idx_team_invitations_expires_at ON team_invitations(expires_at);
CREATE UNIQUE INDEX idx_team_invitations_unique_pending
  ON team_invitations(team_id, email) WHERE status = 'pending';
ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_invitations_own ON team_invitations FOR ALL USING (invited_by_user_id = auth.uid());

-- One Stripe-backed subscription per team. `is_comp` flags a
-- comped account; lifetime_credits_* back the lifetime plans.
CREATE TABLE subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                UUID NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
  plan_id                TEXT NOT NULL,
  plan_name              TEXT NOT NULL DEFAULT 'starter',
  status                 TEXT NOT NULL DEFAULT 'trial',
  is_comp                BOOLEAN NOT NULL DEFAULT false,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT false,
  current_period_start   TIMESTAMPTZ DEFAULT now(),
  current_period_end     TIMESTAMPTZ DEFAULT (now() + INTERVAL '1 month'),
  trial_ends_at          TIMESTAMPTZ,
  stripe_subscription_id TEXT UNIQUE,
  stripe_price_id        TEXT,
  stripe_customer_id     TEXT,
  lifetime_credits_total INTEGER,
  lifetime_credits_used  INTEGER DEFAULT 0,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_service_role ON subscriptions FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY subscriptions_member_read ON subscriptions FOR SELECT USING (
  team_id IN (SELECT w.team_id FROM workspaces w
              JOIN workspace_members wm ON wm.workspace_id = w.id
              WHERE wm.user_id = auth.uid())
);


-- ============================================================
-- 14. WORKSPACE GRAPH  — lightweight extracted relationship edges
--
-- A flat (subject)-[relationship]->(object) edge store, separate
-- from the derived `relationships` table: this captures free-text
-- facts pulled from memory ("Acme uses Salesforce") to answer
-- get_workspace_facts, keyed by label so it works before an edge
-- is resolved to a canonical entity.
-- ============================================================

CREATE TABLE workspace_graph_edges (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subject_type     TEXT NOT NULL,
  subject_id       UUID,
  subject_label    TEXT NOT NULL,
  relationship     TEXT NOT NULL,
  object_type      TEXT NOT NULL,
  object_id        UUID,
  object_label     TEXT NOT NULL,
  confidence       DOUBLE PRECISION DEFAULT 1.0,
  source           TEXT DEFAULT 'extraction',
  source_memory_id UUID,
  metadata         JSONB DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id, subject_label, relationship, object_label)
);
CREATE INDEX idx_wge_workspace     ON workspace_graph_edges(workspace_id);
CREATE INDEX idx_wge_subject_label ON workspace_graph_edges(workspace_id, lower(subject_label));
CREATE INDEX idx_wge_object_label  ON workspace_graph_edges(workspace_id, lower(object_label));
CREATE INDEX idx_wge_subject_id    ON workspace_graph_edges(workspace_id, subject_id) WHERE subject_id IS NOT NULL;
CREATE INDEX idx_wge_object_id     ON workspace_graph_edges(workspace_id, object_id)  WHERE object_id IS NOT NULL;
CREATE INDEX idx_wge_relationship  ON workspace_graph_edges(workspace_id, relationship);
ALTER TABLE workspace_graph_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_graph_edges_select ON workspace_graph_edges
  FOR SELECT USING (is_workspace_member(workspace_id));
CREATE POLICY workspace_graph_edges_service_all ON workspace_graph_edges
  FOR ALL USING (auth.role() = 'service_role');


-- ============================================================
-- 15. PRODUCT SURFACES  — usage log, playground, outbound
--
-- Operational tables behind specific product features: the SDK/MCP
-- usage log, the in-app agent playground, the campaign-copy store
-- that powers the Campaign Writer, the outbound suppression list,
-- and CRM-push idempotency. All workspace- or team-scoped.
-- ============================================================

-- Every SDK/MCP memory operation, for usage metering & the activity feed.
CREATE TABLE memory_ops_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      UUID NOT NULL,
  workspace_id UUID,
  op_type      TEXT NOT NULL,
  entity_type  TEXT,
  source       TEXT NOT NULL DEFAULT 'sdk',
  api_key_id   UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX memory_ops_log_team_created_idx ON memory_ops_log(team_id, created_at DESC);
CREATE INDEX memory_ops_log_api_key_id_idx   ON memory_ops_log(api_key_id);
ALTER TABLE memory_ops_log ENABLE ROW LEVEL SECURITY;

-- In-app agent playground: one thread per conversation, its messages.
CREATE TABLE playground_threads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX playground_threads_workspace_user_updated_idx
  ON playground_threads(workspace_id, user_id, updated_at DESC);
ALTER TABLE playground_threads ENABLE ROW LEVEL SECURITY;

CREATE TABLE playground_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  UUID NOT NULL REFERENCES playground_threads(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL DEFAULT '',
  tool_calls JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX playground_messages_thread_created_idx ON playground_messages(thread_id, created_at);
ALTER TABLE playground_messages ENABLE ROW LEVEL SECURITY;

-- Campaign-copy store: the per-step/variant outbound message bodies,
-- keyed by provider campaign, that the Campaign Writer reads & writes.
CREATE TABLE campaign_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL DEFAULT 'unknown',
  campaign_id   TEXT NOT NULL,
  campaign_name TEXT,
  step          TEXT NOT NULL DEFAULT '',
  variant       TEXT NOT NULL DEFAULT '',
  subject       TEXT,
  body          TEXT,
  source        TEXT NOT NULL DEFAULT 'webhook',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider, campaign_id, step, variant)
);
CREATE INDEX campaign_messages_ws ON campaign_messages(workspace_id, created_at DESC);
ALTER TABLE campaign_messages ENABLE ROW LEVEL SECURITY;

-- Outbound suppression list: emails we must never contact.
CREATE TABLE lead_suppressions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);
ALTER TABLE lead_suppressions ENABLE ROW LEVEL SECURITY;

-- CRM-push idempotency: which observation was pushed to which CRM,
-- so an activity is never double-written. (See crm_write_state for
-- the inverse: echo suppression on the pull side.)
CREATE TABLE observation_crm_pushes (
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  observation_id UUID NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL,
  engagement_id  TEXT NOT NULL,
  pushed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (observation_id, provider)
);
CREATE INDEX observation_crm_pushes_ws ON observation_crm_pushes(workspace_id);
ALTER TABLE observation_crm_pushes ENABLE ROW LEVEL SECURITY;
CREATE POLICY ocp_select ON observation_crm_pushes FOR SELECT USING (is_workspace_member(workspace_id));


-- ============================================================
-- 16. BACK-COMPAT VIEWS  — the v1 surface, projected from v2
--
-- The application still reads the flat v1 shapes (`contacts`,
-- `companies`, `leads`, `lead_lists`). In v2 those are no longer
-- tables — they are VIEWS that re-assemble each row on the fly
-- from the evidence substrate: identifiers from entity_identifiers,
-- current values from claims (invalid_at IS NULL = still valid),
-- activity from observations, ICP from the latest prediction, and
-- list membership from collections. They are read-only; all writes
-- go through observations -> claims. Keep these until every caller
-- is migrated to the entity/claim API.
-- ============================================================

CREATE VIEW companies AS
 SELECT
   id,
   workspace_id,
   created_at,
   (SELECT value FROM entity_identifiers WHERE entity_id = e.id AND kind = 'domain' AND status = 'active' LIMIT 1) AS domain,
   (SELECT value FROM entity_identifiers WHERE entity_id = e.id AND kind = 'hubspot_company' AND status = 'active' LIMIT 1) AS hubspot_company_id,
   (SELECT value FROM entity_identifiers WHERE entity_id = e.id AND kind = 'apollo_account' AND status = 'active' LIMIT 1) AS apollo_account_id,
   (SELECT value FROM entity_identifiers WHERE entity_id = e.id AND kind = 'pipedrive_org' AND status = 'active' LIMIT 1) AS pipedrive_org_id,
   (SELECT value FROM entity_identifiers WHERE entity_id = e.id AND kind = 'attio_company' AND status = 'active' LIMIT 1) AS attio_company_id,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'name' AND invalid_at IS NULL LIMIT 1) AS name,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'industry' AND invalid_at IS NULL LIMIT 1) AS industry,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'employee_count' AND invalid_at IS NULL LIMIT 1))::integer AS employee_count,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'location' AND invalid_at IS NULL LIMIT 1) AS location,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'revenue_range' AND invalid_at IS NULL LIMIT 1) AS revenue_range,
   (SELECT CASE WHEN jsonb_typeof(value) = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(value)) ELSE NULL::text[] END
      FROM claims WHERE entity_id = e.id AND property = 'tech_stack' AND invalid_at IS NULL LIMIT 1) AS tech_stack,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'enrichment_status' AND invalid_at IS NULL LIMIT 1) AS enrichment_status,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'enriched_at' AND invalid_at IS NULL LIMIT 1))::timestamptz AS enriched_at,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'icp_score' AND invalid_at IS NULL LIMIT 1))::integer AS icp_score,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'icp_fit' AND invalid_at IS NULL LIMIT 1))::boolean AS icp_fit,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'icp_reasoning' AND invalid_at IS NULL LIMIT 1) AS icp_reasoning,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'icp_scored_at' AND invalid_at IS NULL LIMIT 1))::timestamptz AS icp_scored_at,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'deal_health_score' AND invalid_at IS NULL LIMIT 1))::integer AS deal_health_score,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'deal_health_computed_at' AND invalid_at IS NULL LIMIT 1))::timestamptz AS deal_health_computed_at,
   (SELECT max(observed_at) FROM observations WHERE entity_id = e.id AND kind = 'event' AND observed_at <= now()) AS last_activity_at,
   (SELECT value FROM claims WHERE entity_id = e.id AND property = 'apollo_raw' AND invalid_at IS NULL LIMIT 1) AS apollo_raw,
   COALESCE((SELECT max(computed_at) FROM claims WHERE entity_id = e.id), created_at) AS updated_at
 FROM entities e
 WHERE type = 'company' AND status = 'active';

CREATE VIEW contacts AS
 SELECT
   id,
   workspace_id,
   created_at,
   (SELECT value FROM entity_identifiers WHERE entity_id = e.id AND kind = 'email' AND status = 'active' LIMIT 1) AS email,
   (SELECT value FROM entity_identifiers WHERE entity_id = e.id AND kind = 'linkedin_url' AND status = 'active' LIMIT 1) AS linkedin_url,
   (SELECT value FROM entity_identifiers WHERE entity_id = e.id AND kind = 'linkedin_member_id' AND status = 'active' LIMIT 1) AS linkedin_member_id,
   (SELECT value FROM entity_identifiers WHERE entity_id = e.id AND kind = 'hubspot' AND status = 'active' LIMIT 1) AS hubspot_id,
   (SELECT value FROM entity_identifiers WHERE entity_id = e.id AND kind = 'pipedrive' AND status = 'active' LIMIT 1) AS pipedrive_id,
   (SELECT value FROM entity_identifiers WHERE entity_id = e.id AND kind = 'apollo' AND status = 'active' LIMIT 1) AS apollo_id,
   (SELECT value FROM entity_identifiers WHERE entity_id = e.id AND kind = 'rb2b' AND status = 'active' LIMIT 1) AS rb2b_id,
   (SELECT value FROM entity_identifiers WHERE entity_id = e.id AND kind = 'attio' AND status = 'active' LIMIT 1) AS attio_id,
   (SELECT value FROM entity_identifiers WHERE entity_id = e.id AND kind = 'salesforce' AND status = 'active' LIMIT 1) AS salesforce_id,
   (SELECT value FROM entity_identifiers WHERE entity_id = e.id AND kind = 'crm' AND status = 'active' LIMIT 1) AS crm_record_id,
   (SELECT value FROM entity_identifiers WHERE entity_id = e.id AND kind = 'stripe' AND status = 'active' LIMIT 1) AS stripe_customer_id,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'first_name' AND invalid_at IS NULL LIMIT 1) AS first_name,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'last_name' AND invalid_at IS NULL LIMIT 1) AS last_name,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'job_title' AND invalid_at IS NULL LIMIT 1) AS job_title,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'seniority' AND invalid_at IS NULL LIMIT 1) AS seniority,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'department' AND invalid_at IS NULL LIMIT 1) AS department,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'city' AND invalid_at IS NULL LIMIT 1) AS city,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'country' AND invalid_at IS NULL LIMIT 1) AS country,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'phone' AND invalid_at IS NULL LIMIT 1) AS phone,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'company' AND invalid_at IS NULL LIMIT 1) AS company,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'photo_url' AND invalid_at IS NULL LIMIT 1) AS photo_url,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'domain' AND invalid_at IS NULL LIMIT 1) AS domain,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'industry' AND invalid_at IS NULL LIMIT 1) AS industry,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'company_size' AND invalid_at IS NULL LIMIT 1) AS company_size,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'connection_strength' AND invalid_at IS NULL LIMIT 1) AS connection_strength,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'pipeline_stage' AND invalid_at IS NULL LIMIT 1) AS pipeline_stage,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'pipeline_stage_source' AND invalid_at IS NULL LIMIT 1) AS pipeline_stage_source,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'pipeline_stage_updated_at' AND invalid_at IS NULL LIMIT 1))::timestamptz AS pipeline_stage_updated_at,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'source' AND invalid_at IS NULL LIMIT 1) AS source,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'source_tag' AND invalid_at IS NULL LIMIT 1) AS source_tag,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'status' AND invalid_at IS NULL LIMIT 1) AS status,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'lead_source' AND invalid_at IS NULL LIMIT 1) AS lead_source,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'first_seen_at' AND invalid_at IS NULL LIMIT 1))::timestamptz AS first_seen_at,
   (SELECT max(observed_at) FROM observations WHERE entity_id = e.id AND kind = 'event' AND observed_at <= now()) AS last_activity_at,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'last_interaction_at' AND invalid_at IS NULL LIMIT 1))::timestamptz AS last_interaction_at,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'last_document_at' AND invalid_at IS NULL LIMIT 1))::timestamptz AS last_document_at,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'deal_health_score' AND invalid_at IS NULL LIMIT 1))::integer AS deal_health_score,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'deal_health_active_max' AND invalid_at IS NULL LIMIT 1))::integer AS deal_health_active_max,
   (SELECT value FROM claims WHERE entity_id = e.id AND property = 'deal_health_breakdown' AND invalid_at IS NULL LIMIT 1) AS deal_health_breakdown,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'deal_health_computed_at' AND invalid_at IS NULL LIMIT 1))::timestamptz AS deal_health_computed_at,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'deal_stage' AND invalid_at IS NULL LIMIT 1) AS deal_stage,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'deal_value' AND invalid_at IS NULL LIMIT 1))::numeric AS deal_value,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'deal_closed_at' AND invalid_at IS NULL LIMIT 1))::timestamptz AS deal_closed_at,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'deal_sent_at' AND invalid_at IS NULL LIMIT 1))::timestamptz AS deal_sent_at,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'enrichment_status' AND invalid_at IS NULL LIMIT 1) AS enrichment_status,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'enrichment_source' AND invalid_at IS NULL LIMIT 1) AS enrichment_source,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'enriched_at' AND invalid_at IS NULL LIMIT 1))::timestamptz AS enriched_at,
   ((SELECT predicted_value ->> 'score' FROM predictions WHERE entity_id = e.id AND kind = 'icp_fit' ORDER BY predicted_at DESC LIMIT 1))::integer AS icp_score,
   ((SELECT predicted_value ->> 'fit' FROM predictions WHERE entity_id = e.id AND kind = 'icp_fit' ORDER BY predicted_at DESC LIMIT 1))::boolean AS icp_fit,
   (SELECT predicted_value ->> 'reason' FROM predictions WHERE entity_id = e.id AND kind = 'icp_fit' ORDER BY predicted_at DESC LIMIT 1) AS icp_reasoning,
   (SELECT predicted_at FROM predictions WHERE entity_id = e.id AND kind = 'icp_fit' ORDER BY predicted_at DESC LIMIT 1) AS icp_scored_at,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'memory_summary' AND invalid_at IS NULL LIMIT 1) AS memory_summary,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'summary_generated_at' AND invalid_at IS NULL LIMIT 1))::timestamptz AS summary_generated_at,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'notes' AND invalid_at IS NULL LIMIT 1) AS notes,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'keywords' AND invalid_at IS NULL LIMIT 1) AS keywords,
   (SELECT value FROM claims WHERE entity_id = e.id AND property = 'channels' AND invalid_at IS NULL LIMIT 1) AS channels,
   (SELECT value FROM claims WHERE entity_id = e.id AND property = 'tags' AND invalid_at IS NULL LIMIT 1) AS tags,
   (SELECT value FROM claims WHERE entity_id = e.id AND property = 'apollo_raw' AND invalid_at IS NULL LIMIT 1) AS apollo_raw,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'interaction_count' AND invalid_at IS NULL LIMIT 1))::integer AS interaction_count,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'incoming_contacts_count' AND invalid_at IS NULL LIMIT 1))::integer AS incoming_contacts_count,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'total_documents_count' AND invalid_at IS NULL LIMIT 1))::integer AS total_documents_count,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'total_income' AND invalid_at IS NULL LIMIT 1))::numeric AS total_income,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'total_income_source' AND invalid_at IS NULL LIMIT 1) AS total_income_source,
   (SELECT to_entity_id FROM relationships WHERE from_entity_id = e.id AND type = 'works_at' AND valid_to IS NULL LIMIT 1) AS company_id,
   NULL::uuid AS created_by,
   COALESCE((SELECT max(computed_at) FROM claims WHERE entity_id = e.id), created_at) AS updated_at
 FROM entities e
 WHERE type = 'person' AND status = 'active';

CREATE VIEW lead_lists AS
 SELECT
   id,
   workspace_id,
   name,
   source,
   COALESCE(metadata -> 'columns', '[]'::jsonb) AS columns,
   created_at,
   (SELECT max(ce.added_at) FROM collection_entities ce WHERE ce.collection_id = c.id) AS updated_at
 FROM collections c
 WHERE kind = 'list';

CREATE VIEW leads AS
 SELECT
   e.id,
   ce.collection_id AS lead_list_id,
   e.workspace_id,
   (SELECT value FROM entity_identifiers WHERE entity_id = e.id AND kind = 'email' AND status = 'active' LIMIT 1) AS email,
   TRIM(BOTH ' ' FROM concat(
     COALESCE((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'first_name' AND invalid_at IS NULL LIMIT 1), ''),
     ' ',
     COALESCE((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'last_name' AND invalid_at IS NULL LIMIT 1), ''))) AS name,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'company' AND invalid_at IS NULL LIMIT 1) AS company,
   (SELECT value FROM entity_identifiers WHERE entity_id = e.id AND kind = 'linkedin_url' AND status = 'active' LIMIT 1) AS linkedin_url,
   (SELECT min(observed_at) FROM observations WHERE entity_id = e.id AND property = 'interaction.email_sent') AS sent_at,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'send_variant' AND invalid_at IS NULL LIMIT 1) AS send_variant,
   COALESCE(((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'is_repeat_contact' AND invalid_at IS NULL LIMIT 1))::boolean, false) AS is_repeat_contact,
   COALESCE((SELECT value FROM claims WHERE entity_id = e.id AND property = 'features' AND invalid_at IS NULL LIMIT 1), '{}'::jsonb) AS features,
   COALESCE((SELECT value FROM claims WHERE entity_id = e.id AND property = 'fields' AND invalid_at IS NULL LIMIT 1), '{}'::jsonb) AS fields,
   ((SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'scorecard_score' AND invalid_at IS NULL LIMIT 1))::integer AS scorecard_score,
   (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'sentiment' AND invalid_at IS NULL LIMIT 1) AS reply_outcome,
   (SELECT max(observed_at) FROM observations WHERE entity_id = e.id AND property = ANY (ARRAY['interaction.reply','interaction.positive_reply','interaction.negative_reply'])) AS replied_at,
   COALESCE(
     CASE
       WHEN (SELECT value #>> '{}'::text[] FROM claims WHERE entity_id = e.id AND property = 'reachability_status' AND invalid_at IS NULL LIMIT 1) = 'bounced' THEN 'bounced'
       WHEN EXISTS (SELECT 1 FROM observations WHERE entity_id = e.id AND property = ANY (ARRAY['interaction.reply','interaction.positive_reply','interaction.negative_reply'])) THEN 'replied'
       WHEN EXISTS (SELECT 1 FROM observations WHERE entity_id = e.id AND property = 'interaction.email_sent') THEN 'sent'
       ELSE 'pending'
     END, 'pending') AS status,
   CASE WHEN EXISTS (SELECT 1 FROM observations WHERE entity_id = e.id LIMIT 1) THEN e.id ELSE NULL::uuid END AS contact_id,
   ce.added_at AS created_at,
   COALESCE((SELECT max(computed_at) FROM claims WHERE entity_id = e.id), ce.added_at) AS updated_at
 FROM entities e
   JOIN collection_entities ce ON ce.entity_id = e.id
   JOIN collections c ON c.id = ce.collection_id AND c.kind = 'list'
 WHERE e.type = 'person' AND e.status = 'active';


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

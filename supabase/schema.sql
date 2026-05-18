-- ============================================================
-- Nous CRM — Complete Database Schema
-- Run once in your Supabase SQL editor to set up a fresh instance.
--
-- Prerequisites: Supabase project with auth.users already enabled.
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;       -- pgvector for memory embeddings
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- gen_random_uuid() fallback

-- ── Shared trigger helper ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 1. WORKSPACES
-- ============================================================

CREATE TABLE IF NOT EXISTS workspaces (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  slug        TEXT        UNIQUE,
  industry    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS workspaces_updated_at ON workspaces;
CREATE TRIGGER workspaces_updated_at
  BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 2. WORKSPACE MEMBERS  (user ↔ workspace, auth bridge)
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_members (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         TEXT        NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS workspace_members_user      ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS workspace_members_workspace ON workspace_members(workspace_id);

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_members_select ON workspace_members
  FOR SELECT USING (user_id = auth.uid());


-- ============================================================
-- 3. API KEYS  (external / agent access — SHA-256 hashed)
-- ============================================================

CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key_hash     TEXT        NOT NULL UNIQUE,   -- SHA-256 of the raw key
  name         TEXT        NOT NULL,
  created_by   UUID        REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_keys_workspace ON api_keys(workspace_id);
CREATE INDEX IF NOT EXISTS api_keys_hash      ON api_keys(key_hash);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_keys_select ON api_keys
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );


-- ============================================================
-- 4. COMPANIES
-- ============================================================

CREATE TABLE IF NOT EXISTS companies (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Identity
  name                 TEXT        NOT NULL,
  domain               TEXT,                       -- normalized: no www, lowercase

  -- Firmographics
  industry             TEXT,
  employee_count       INT,
  revenue_range        TEXT,                       -- '<1M' | '1-10M' | '10-50M' | '50M+'
  location             TEXT,
  tech_stack           TEXT[]      DEFAULT '{}',

  -- External IDs
  hubspot_company_id   TEXT,
  apollo_account_id    TEXT,
  attio_company_id     TEXT,
  pipedrive_org_id     TEXT,

  -- ICP scoring
  icp_fit              BOOLEAN,
  icp_score            INT,
  icp_reasoning        TEXT,
  icp_scored_at        TIMESTAMPTZ,

  -- Enrichment
  enrichment_status    TEXT        NOT NULL DEFAULT 'none'
                                   CHECK (enrichment_status IN ('none','queued','partial','complete','failed')),
  enriched_at          TIMESTAMPTZ,
  apollo_raw           JSONB,

  -- Deal health (rolled up from contacts)
  deal_health_score       INT,
  deal_health_computed_at TIMESTAMPTZ,

  last_activity_at     TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, domain)
);

CREATE INDEX IF NOT EXISTS companies_workspace       ON companies(workspace_id);
CREATE INDEX IF NOT EXISTS companies_domain          ON companies(domain);
CREATE INDEX IF NOT EXISTS companies_hubspot_id      ON companies(hubspot_company_id);
CREATE INDEX IF NOT EXISTS companies_last_activity   ON companies(workspace_id, last_activity_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS companies_deal_health     ON companies(deal_health_score);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY companies_select ON companies FOR SELECT USING (
  workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
);
CREATE POLICY companies_insert ON companies FOR INSERT WITH CHECK (
  workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
);
CREATE POLICY companies_update ON companies FOR UPDATE USING (
  workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
);
CREATE POLICY companies_delete ON companies FOR DELETE USING (
  workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
);

DROP TRIGGER IF EXISTS companies_updated_at ON companies;
CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 5. CONTACTS
-- ============================================================

CREATE TABLE IF NOT EXISTS contacts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id    UUID        REFERENCES companies(id) ON DELETE SET NULL,

  -- Core identity
  email         TEXT,                             -- nullable: may be unknown initially
  first_name    TEXT,
  last_name     TEXT,
  phone         TEXT,
  company       TEXT,                             -- free-text company name (before company_id link)
  job_title     TEXT,
  photo_url     TEXT,

  -- Location
  city          TEXT,
  country       TEXT,
  domain        TEXT,

  -- Social
  linkedin_url       TEXT,
  linkedin_member_id TEXT,                            -- permanent Unipile/LinkedIn numeric ID (ACoAA... format)

  -- Professional (from enrichment)
  seniority     TEXT,                             -- 'c_suite'|'vp'|'director'|'manager'|'ic'
  department    TEXT,                             -- 'sales'|'marketing'|'engineering'|'ops'

  -- External IDs (one per integration — fastest lookup path)
  hubspot_id    TEXT,
  pipedrive_id  TEXT,
  attio_id      TEXT,
  salesforce_id TEXT,
  apollo_id     TEXT,
  rb2b_id       TEXT,
  crm_record_id TEXT,                             -- generic CRM ID for any source

  -- Enrichment
  enrichment_status  TEXT NOT NULL DEFAULT 'none'
    CHECK (enrichment_status IN ('none','queued','partial','complete','failed','no_integration')),
  enriched_at        TIMESTAMPTZ,
  enrichment_source  TEXT,
  apollo_raw         JSONB,

  -- ICP
  icp_fit        BOOLEAN,
  icp_score      INT,
  icp_reasoning  TEXT,
  icp_scored_at  TIMESTAMPTZ,

  -- Pipeline stage (auto-computed from activity)
  pipeline_stage            TEXT DEFAULT 'identified'
    CHECK (pipeline_stage IN ('identified','aware','interested','evaluating','client')),
  pipeline_stage_updated_at TIMESTAMPTZ,
  pipeline_stage_source     TEXT DEFAULT 'auto'
    CHECK (pipeline_stage_source IN ('auto','manual')),

  -- Deal health
  deal_health_score       INT        DEFAULT 0,
  deal_health_breakdown   JSONB,
  deal_health_active_max  INT,
  deal_health_computed_at TIMESTAMPTZ,

  -- AI-generated memory summary
  memory_summary       TEXT,
  summary_generated_at TIMESTAMPTZ,

  -- Misc
  tags            JSONB       DEFAULT '[]',
  notes           TEXT,
  source          TEXT        DEFAULT 'manual',
  status          TEXT,
  last_activity_at TIMESTAMPTZ,
  first_seen_at    TIMESTAMPTZ DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID        REFERENCES auth.users(id),

  UNIQUE (workspace_id, email)
);

CREATE INDEX IF NOT EXISTS contacts_workspace       ON contacts(workspace_id);
CREATE INDEX IF NOT EXISTS contacts_email           ON contacts(email);
CREATE INDEX IF NOT EXISTS contacts_company_id      ON contacts(company_id);
CREATE INDEX IF NOT EXISTS contacts_pipeline_stage  ON contacts(workspace_id, pipeline_stage);
CREATE INDEX IF NOT EXISTS contacts_last_activity   ON contacts(workspace_id, last_activity_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS contacts_deal_health     ON contacts(deal_health_score);
CREATE INDEX IF NOT EXISTS contacts_hubspot_id        ON contacts(hubspot_id)        WHERE hubspot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_pipedrive_id      ON contacts(pipedrive_id)      WHERE pipedrive_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_attio_id          ON contacts(attio_id)          WHERE attio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_salesforce_id     ON contacts(salesforce_id)     WHERE salesforce_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_apollo_id         ON contacts(apollo_id)         WHERE apollo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_linkedin_member_id ON contacts(workspace_id, linkedin_member_id) WHERE linkedin_member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_rb2b_id         ON contacts(rb2b_id)         WHERE rb2b_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_crm_record_id   ON contacts(workspace_id, crm_record_id) WHERE crm_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_domain          ON contacts(domain)           WHERE domain IS NOT NULL;

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY contacts_select ON contacts FOR SELECT USING (
  workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
);
CREATE POLICY contacts_insert ON contacts FOR INSERT WITH CHECK (
  workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
);
CREATE POLICY contacts_update ON contacts FOR UPDATE USING (
  workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
);
CREATE POLICY contacts_delete ON contacts FOR DELETE USING (
  workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
);

DROP TRIGGER IF EXISTS contacts_updated_at ON contacts;
CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 6. CONTACT ACTIVITY LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_activity_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    UUID        NOT NULL REFERENCES contacts(id)  ON DELETE CASCADE,
  workspace_id  UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id    UUID        REFERENCES companies(id)  ON DELETE SET NULL,

  -- What happened
  activity_type TEXT        NOT NULL,             -- open-ended; see pipeline stage taxonomy below
  description   TEXT        NOT NULL,
  summary       TEXT,

  -- When it happened vs. when we received it
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Where it came from
  source        TEXT        NOT NULL DEFAULT 'nous',
  external_id   TEXT,                             -- dedup: source's own event ID
  raw_data      JSONB,

  -- Per-provider engagement IDs after CRM push. Prevents double-pushing on retries
  -- and gives us back-references like { hubspot: "12345", attio: "rec_abc" }.
  pushed_to_crms JSONB       NOT NULL DEFAULT '{}'::jsonb,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedup: same external event never inserted twice
CREATE UNIQUE INDEX IF NOT EXISTS contact_activity_external_dedup
  ON contact_activity_log(workspace_id, source, external_id)
  WHERE external_id IS NOT NULL;

-- Fast timeline query per contact
CREATE INDEX IF NOT EXISTS contact_activity_timeline
  ON contact_activity_log(contact_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS contact_activity_workspace
  ON contact_activity_log(workspace_id);

CREATE INDEX IF NOT EXISTS contact_activity_company
  ON contact_activity_log(company_id, occurred_at DESC) WHERE company_id IS NOT NULL;

ALTER TABLE contact_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY contact_activity_select ON contact_activity_log
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

-- Service role inserts directly (bypasses RLS via service key)
CREATE POLICY contact_activity_insert ON contact_activity_log
  FOR INSERT WITH CHECK (true);


-- ============================================================
-- 7. PIPELINE STAGE ENGINE  (auto-computed from activity)
--
-- Stage taxonomy:
--   AWARE:      website_visit, email_opened, linkedin_view,
--               social_engagement, ad_impression, newsletter_signup
--   INTERESTED: email_reply, linkedin_message, linkedin_connected,
--               content_download, community_joined, event_attended,
--               website_revisit
--   EVALUATING: meeting_held, pricing_page_visit, proposal_sent,
--               proposal_viewed, outbound_positive_reply,
--               deal_created, trial_started
--   CLIENT:     proposal_signed, deal_won, payment_received
-- ============================================================

CREATE OR REPLACE FUNCTION compute_contact_pipeline_stage(p_contact_id UUID)
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM contact_activity_log
    WHERE contact_id = p_contact_id
      AND activity_type IN ('proposal_signed','deal_won','payment_received')
  ) THEN RETURN 'client'; END IF;

  IF EXISTS (
    SELECT 1 FROM contact_activity_log
    WHERE contact_id = p_contact_id
      AND activity_type IN (
        'meeting_held','pricing_page_visit','proposal_sent','proposal_viewed',
        'outbound_positive_reply','deal_created','trial_started'
      )
      AND occurred_at >= now() - interval '60 days'
  ) THEN RETURN 'evaluating'; END IF;

  IF EXISTS (
    SELECT 1 FROM contact_activity_log
    WHERE contact_id = p_contact_id
      AND activity_type IN (
        'email_reply','linkedin_message','linkedin_connected','content_download',
        'community_joined','event_attended','website_revisit'
      )
      AND occurred_at >= now() - interval '30 days'
  ) THEN RETURN 'interested'; END IF;

  IF EXISTS (
    SELECT 1 FROM contact_activity_log
    WHERE contact_id = p_contact_id
      AND activity_type IN (
        'website_visit','email_opened','linkedin_view','social_engagement',
        'ad_impression','newsletter_signup'
      )
      AND occurred_at >= now() - interval '30 days'
  ) THEN RETURN 'aware'; END IF;

  RETURN 'identified';
END;
$$;

-- Trigger: recompute stage + last_activity_at on every new activity row
CREATE OR REPLACE FUNCTION trigger_recompute_pipeline_stage()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_new_stage  TEXT;
  v_cur_stage  TEXT;
  v_cur_source TEXT;
BEGIN
  -- Housekeeping events don't count as real interactions
  IF NEW.activity_type IN ('airtable_imported','airtable_synced','airtable_pushed','contact_created') THEN
    RETURN NEW;
  END IF;

  SELECT pipeline_stage, pipeline_stage_source
  INTO v_cur_stage, v_cur_source
  FROM contacts WHERE id = NEW.contact_id;

  IF v_cur_stage = 'client' THEN
    RETURN NEW;
  END IF;

  v_new_stage := compute_contact_pipeline_stage(NEW.contact_id);

  IF v_cur_source = 'auto'
     OR (v_cur_source = 'manual' AND v_new_stage = 'client')
     OR (v_cur_source = 'manual' AND (
           (v_new_stage = 'evaluating' AND v_cur_stage IN ('identified','aware','interested'))
        OR (v_new_stage = 'interested' AND v_cur_stage IN ('identified','aware'))
        OR (v_new_stage = 'aware'      AND v_cur_stage = 'identified')
     ))
  THEN
    UPDATE contacts SET
      pipeline_stage            = v_new_stage,
      pipeline_stage_updated_at = now(),
      pipeline_stage_source     = 'auto',
      last_activity_at          = GREATEST(COALESCE(last_activity_at, NEW.occurred_at), NEW.occurred_at)
    WHERE id = NEW.contact_id;
  ELSE
    UPDATE contacts SET
      last_activity_at = GREATEST(COALESCE(last_activity_at, NEW.occurred_at), NEW.occurred_at)
    WHERE id = NEW.contact_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pipeline_stage_on_activity ON contact_activity_log;
CREATE TRIGGER trg_pipeline_stage_on_activity
  AFTER INSERT ON contact_activity_log
  FOR EACH ROW EXECUTE FUNCTION trigger_recompute_pipeline_stage();

-- Decay function: call daily (e.g. pg_cron or a cron job in apps/worker)
CREATE OR REPLACE FUNCTION decay_pipeline_stages()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE contacts SET
    pipeline_stage = 'interested', pipeline_stage_updated_at = now(), pipeline_stage_source = 'auto'
  WHERE pipeline_stage = 'evaluating' AND NOT EXISTS (
    SELECT 1 FROM contact_activity_log WHERE contact_id = contacts.id
      AND activity_type IN ('meeting_held','pricing_page_visit','proposal_sent','proposal_viewed',
        'outbound_positive_reply','deal_created','trial_started')
      AND occurred_at >= now() - interval '60 days'
  );

  UPDATE contacts SET
    pipeline_stage = 'aware', pipeline_stage_updated_at = now(), pipeline_stage_source = 'auto'
  WHERE pipeline_stage = 'interested' AND NOT EXISTS (
    SELECT 1 FROM contact_activity_log WHERE contact_id = contacts.id
      AND activity_type IN ('email_reply','linkedin_message','linkedin_connected','content_download',
        'community_joined','event_attended','website_revisit')
      AND occurred_at >= now() - interval '30 days'
  );

  UPDATE contacts SET
    pipeline_stage = 'identified', pipeline_stage_updated_at = now(), pipeline_stage_source = 'auto'
  WHERE pipeline_stage = 'aware' AND NOT EXISTS (
    SELECT 1 FROM contact_activity_log WHERE contact_id = contacts.id
      AND activity_type IN ('website_visit','email_opened','linkedin_view','social_engagement',
        'ad_impression','newsletter_signup')
      AND occurred_at >= now() - interval '30 days'
  );
END;
$$;

-- UI helper: manually override stage without it being wiped by auto-compute
CREATE OR REPLACE FUNCTION set_contact_pipeline_stage(p_contact_id UUID, p_stage TEXT)
RETURNS VOID LANGUAGE SQL SECURITY DEFINER AS $$
  UPDATE contacts
  SET pipeline_stage = p_stage, pipeline_stage_updated_at = now(), pipeline_stage_source = 'manual'
  WHERE id = p_contact_id
    AND p_stage IN ('identified','aware','interested','evaluating','client');
$$;


-- ============================================================
-- 8. WORKSPACE MEMORIES  (atomic facts + pgvector)
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_memories (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id   UUID        REFERENCES contacts(id)  ON DELETE SET NULL,
  company_id   UUID        REFERENCES companies(id) ON DELETE SET NULL,

  category     TEXT        NOT NULL DEFAULT 'General',
  content      TEXT        NOT NULL,
  embedding    vector(1536),

  -- Bi-temporal: when the fact was true vs. when we wrote it
  valid_from   TIMESTAMPTZ NOT NULL DEFAULT now(),
  invalid_at   TIMESTAMPTZ,                        -- NULL = still valid

  source       TEXT        NOT NULL DEFAULT 'manual',   -- 'manual'|'agent'|'api'
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  superseded_by UUID       REFERENCES workspace_memories(id),
  metadata     JSONB       NOT NULL DEFAULT '{}',

  created_by   UUID        REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_memories_workspace_active
  ON workspace_memories(workspace_id, is_active);

CREATE INDEX IF NOT EXISTS workspace_memories_category
  ON workspace_memories(workspace_id, category, is_active);

CREATE INDEX IF NOT EXISTS workspace_memories_contact
  ON workspace_memories(contact_id) WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS workspace_memories_company
  ON workspace_memories(company_id) WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS workspace_memories_valid
  ON workspace_memories(workspace_id, invalid_at) WHERE invalid_at IS NULL;

-- IVFFlat vector index (needs ≥100 rows to be useful)
CREATE INDEX IF NOT EXISTS workspace_memories_embedding
  ON workspace_memories USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE workspace_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_memories_select ON workspace_memories
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );
CREATE POLICY workspace_memories_insert ON workspace_memories
  FOR INSERT WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );
CREATE POLICY workspace_memories_update ON workspace_memories
  FOR UPDATE USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

DROP TRIGGER IF EXISTS workspace_memories_updated_at ON workspace_memories;
CREATE TRIGGER workspace_memories_updated_at
  BEFORE UPDATE ON workspace_memories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Semantic search RPC (called by packages/core db/memories.ts)
CREATE OR REPLACE FUNCTION match_workspace_memories(
  p_workspace_id UUID,
  p_embedding    vector(1536),
  p_threshold    FLOAT,
  p_limit        INT
)
RETURNS TABLE(id UUID, content TEXT, category TEXT, source TEXT, metadata JSONB, similarity FLOAT)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id, m.content, m.category, m.source, m.metadata,
    (1 - (m.embedding <=> p_embedding))::FLOAT AS similarity
  FROM workspace_memories m
  WHERE m.workspace_id = p_workspace_id
    AND m.is_active = true
    AND m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> p_embedding) >= p_threshold
  ORDER BY m.embedding <=> p_embedding
  LIMIT p_limit;
END;
$$;


-- ============================================================
-- 9. WORKSPACE GRAPH EDGES  (knowledge graph)
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_graph_edges (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  subject_type    TEXT        NOT NULL,   -- 'contact'|'company'|'product'|'competitor'|'topic'
  subject_id      UUID,
  subject_label   TEXT        NOT NULL,

  relationship    TEXT        NOT NULL,   -- 'USES'|'EVALUATING'|'COMPETES_WITH'|'WORKS_AT'|…

  object_type     TEXT        NOT NULL,
  object_id       UUID,
  object_label    TEXT        NOT NULL,

  confidence      FLOAT       DEFAULT 1.0,
  source          TEXT        DEFAULT 'extraction',
  source_memory_id UUID       REFERENCES workspace_memories(id) ON DELETE SET NULL,
  metadata        JSONB       DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT unique_graph_edge UNIQUE (workspace_id, subject_label, relationship, object_label)
);

CREATE INDEX IF NOT EXISTS idx_wge_workspace     ON workspace_graph_edges(workspace_id);
CREATE INDEX IF NOT EXISTS idx_wge_subject_id    ON workspace_graph_edges(workspace_id, subject_id)   WHERE subject_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wge_object_id     ON workspace_graph_edges(workspace_id, object_id)    WHERE object_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wge_relationship  ON workspace_graph_edges(workspace_id, relationship);

ALTER TABLE workspace_graph_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_graph_edges_select ON workspace_graph_edges
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );


-- ============================================================
-- 10. INBOUND WEBHOOKS  (RB2B, Fireflies, LinkedIn/Unipile)
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_webhook_subscriptions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source       TEXT        NOT NULL,        -- 'rb2b'|'fireflies'|'linkedin'
  status       TEXT        NOT NULL DEFAULT 'pending',
  tested_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id, source)
);

ALTER TABLE workspace_webhook_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY webhook_subscriptions_select ON workspace_webhook_subscriptions
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );
CREATE POLICY webhook_subscriptions_all ON workspace_webhook_subscriptions
  FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );


-- ============================================================
-- 11. LINKEDIN CONNECTIONS  (Unipile OAuth)
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_linkedin_connections (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  unipile_account_id   TEXT        NOT NULL,
  linkedin_name        TEXT,
  linkedin_headline    TEXT,
  linkedin_profile_url TEXT,
  connected_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id)
);

ALTER TABLE workspace_linkedin_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY linkedin_connections_select ON workspace_linkedin_connections
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );
CREATE POLICY linkedin_connections_all ON workspace_linkedin_connections
  FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );


-- ============================================================
-- 12. INTEGRATION PROVIDER CONNECTIONS  (Google Calendar, Gmail)
--     Used by apps/worker calendar poller.
-- ============================================================

CREATE TABLE IF NOT EXISTS workflow_providers (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL UNIQUE,   -- 'gmail_oauth' | 'google_calendar' | etc.
  display_name TEXT        NOT NULL,
  category     TEXT,
  logo_url     TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Seed the providers used by the calendar poller
INSERT INTO workflow_providers (name, display_name, category)
VALUES
  ('gmail_oauth',      'Google Calendar / Gmail', 'communication'),
  ('smtp',             'Custom SMTP / IMAP',      'communication'),
  ('slack',            'Slack',                   'communication'),
  ('instantly',        'Instantly',               'outbound'),
  ('fireflies',        'Fireflies.ai',            'meetings'),
  ('fathom',           'Fathom',                  'meetings'),
  ('calendly',         'Calendly',                'meetings'),
  ('cal_com',          'Cal.com',                 'meetings'),
  ('hubspot',          'HubSpot',                 'crm'),
  ('salesforce',       'Salesforce',              'crm'),
  ('pipedrive',        'Pipedrive',               'crm'),
  ('attio',            'Attio',                   'crm'),
  ('apollo',           'Apollo.io',               'enrichment'),
  ('prospeo',          'Prospeo',                 'enrichment')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS workflow_provider_connections (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_id           UUID        NOT NULL REFERENCES workflow_providers(id) ON DELETE CASCADE,
  name                  TEXT        NOT NULL DEFAULT 'Default',
  encrypted_credentials JSONB       NOT NULL DEFAULT '{}',
  is_verified           BOOLEAN     DEFAULT false,
  last_test_at          TIMESTAMPTZ,
  last_used_at          TIMESTAMPTZ,
  created_by            UUID        REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id, provider_id, name)
);

CREATE INDEX IF NOT EXISTS wpc_workspace  ON workflow_provider_connections(workspace_id);
CREATE INDEX IF NOT EXISTS wpc_provider   ON workflow_provider_connections(provider_id);

ALTER TABLE workflow_provider_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY wpc_select ON workflow_provider_connections
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );
CREATE POLICY wpc_all ON workflow_provider_connections
  FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

DROP TRIGGER IF EXISTS wpc_updated_at ON workflow_provider_connections;
CREATE TRIGGER wpc_updated_at
  BEFORE UPDATE ON workflow_provider_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 13. CRM SYNC CONFIGS  (HubSpot / Pipedrive import)
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_sync_configs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id   UUID        REFERENCES workflow_provider_connections(id) ON DELETE SET NULL,
  provider        TEXT        NOT NULL,   -- 'hubspot' | 'pipedrive' | 'attio' | 'salesforce'
  auto_sync       BOOLEAN     DEFAULT false,
  push_activities BOOLEAN     DEFAULT true,  -- push Nous touchpoints → CRM as engagements
  last_synced_at  TIMESTAMPTZ,
  contacts_synced INT         DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id, provider)
);

ALTER TABLE crm_sync_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_sync_configs_all ON crm_sync_configs
  FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

DROP TRIGGER IF EXISTS crm_sync_configs_updated_at ON crm_sync_configs;
CREATE TRIGGER crm_sync_configs_updated_at
  BEFORE UPDATE ON crm_sync_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 14. WORKSPACE SYSTEM LOG  (Activity Log UI feed)
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_system_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source       TEXT        NOT NULL,   -- 'linkedin'|'gmail'|'slack'|'fireflies'|'rb2b'|etc.
  event_type   TEXT        NOT NULL,   -- 'webhook_received'|'sync_complete'|'error'|etc.
  summary      TEXT,
  contact_id   UUID        REFERENCES contacts(id) ON DELETE SET NULL,
  metadata     JSONB       DEFAULT '{}',
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wsl_workspace   ON workspace_system_log(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS wsl_source      ON workspace_system_log(workspace_id, source);
CREATE INDEX IF NOT EXISTS wsl_contact     ON workspace_system_log(contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE workspace_system_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY wsl_select ON workspace_system_log
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

-- Service role writes directly — no insert policy needed for RLS bypass.

-- ============================================================
-- Done.
--
-- Next steps:
--   1. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env
--   2. Run `pnpm install` from the repo root
--   3. Start the stack: `pnpm dev` (or `docker compose up`)
--
-- The service role key bypasses RLS — the API validates
-- workspace membership before every write, so this is safe.
-- ============================================================

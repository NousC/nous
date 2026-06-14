-- ─────────────────────────────────────────────────────────────────────────────
-- Self-host patch — functions the app calls that were defined ONLY in migrations,
-- not in supabase/schema.sql. If you bootstrapped a fresh Supabase from schema.sql
-- alone (the documented path), run this ONCE in the SQL editor. Safe to re-run.
--
-- Folded into schema.sql on 2026-06-14, so fresh installs after that don't need it.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) team_ops_used — ops-usage rollup. Cosmetic on self-host (ops metering is
--    bypassed), but the Ops/usage display calls it, so its absence logs errors.
CREATE OR REPLACE FUNCTION team_ops_used(p_team_id uuid, p_since timestamptz)
RETURNS bigint
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(SUM(wsl.billable_ops), 0)::bigint
  FROM workspace_system_log wsl
  JOIN workspaces w ON w.id = wsl.workspace_id
  WHERE w.team_id = p_team_id
    AND wsl.billable_ops > 0
    AND wsl.occurred_at >= p_since;
$$;

-- 2) decay_pipeline_stages — hourly worker job. Decays stale pipeline stages by
--    INSERTing a lower-stage observation; the claim engine recomputes the claim.
--    Manual overrides (pipeline_stage_source = 'manual') are excluded.
CREATE OR REPLACE FUNCTION decay_pipeline_stages()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- evaluating → interested  (no qualifying activity in 60d)
  INSERT INTO observations (workspace_id, entity_id, kind, property, value, source, method, observed_at)
  SELECT c.workspace_id, c.entity_id, 'state', 'pipeline_stage', '"interested"'::jsonb,
         'system', 'inference', now()
  FROM claims c
  LEFT JOIN claims src
    ON src.workspace_id = c.workspace_id
   AND src.entity_id    = c.entity_id
   AND src.property     = 'pipeline_stage_source'
   AND src.invalid_at   IS NULL
  WHERE c.property   = 'pipeline_stage'
    AND c.invalid_at IS NULL
    AND (c.value #>> '{}') = 'evaluating'
    AND (src.value #>> '{}') IS DISTINCT FROM 'manual'
    AND NOT EXISTS (
      SELECT 1 FROM observations o
      WHERE o.entity_id  = c.entity_id
        AND o.property IN (
          'interaction.meeting_held',
          'interaction.pricing_page_visit',
          'interaction.proposal_sent',
          'interaction.proposal_viewed',
          'interaction.outbound_positive_reply',
          'interaction.deal_created',
          'interaction.trial_started'
        )
        AND o.observed_at >= now() - interval '60 days'
    );

  -- interested → aware  (no qualifying activity in 30d)
  INSERT INTO observations (workspace_id, entity_id, kind, property, value, source, method, observed_at)
  SELECT c.workspace_id, c.entity_id, 'state', 'pipeline_stage', '"aware"'::jsonb,
         'system', 'inference', now()
  FROM claims c
  LEFT JOIN claims src
    ON src.workspace_id = c.workspace_id
   AND src.entity_id    = c.entity_id
   AND src.property     = 'pipeline_stage_source'
   AND src.invalid_at   IS NULL
  WHERE c.property   = 'pipeline_stage'
    AND c.invalid_at IS NULL
    AND (c.value #>> '{}') = 'interested'
    AND (src.value #>> '{}') IS DISTINCT FROM 'manual'
    AND NOT EXISTS (
      SELECT 1 FROM observations o
      WHERE o.entity_id  = c.entity_id
        AND o.property IN (
          'interaction.email_reply',
          'interaction.linkedin_message',
          'interaction.linkedin_connected',
          'interaction.content_download',
          'interaction.community_joined',
          'interaction.event_attended',
          'interaction.website_revisit'
        )
        AND o.observed_at >= now() - interval '30 days'
    );

  -- aware → identified  (no qualifying activity in 30d)
  INSERT INTO observations (workspace_id, entity_id, kind, property, value, source, method, observed_at)
  SELECT c.workspace_id, c.entity_id, 'state', 'pipeline_stage', '"identified"'::jsonb,
         'system', 'inference', now()
  FROM claims c
  LEFT JOIN claims src
    ON src.workspace_id = c.workspace_id
   AND src.entity_id    = c.entity_id
   AND src.property     = 'pipeline_stage_source'
   AND src.invalid_at   IS NULL
  WHERE c.property   = 'pipeline_stage'
    AND c.invalid_at IS NULL
    AND (c.value #>> '{}') = 'aware'
    AND (src.value #>> '{}') IS DISTINCT FROM 'manual'
    AND NOT EXISTS (
      SELECT 1 FROM observations o
      WHERE o.entity_id  = c.entity_id
        AND o.property IN (
          'interaction.website_visit',
          'interaction.email_opened',
          'interaction.linkedin_view',
          'interaction.social_engagement',
          'interaction.ad_impression',
          'interaction.newsletter_signup'
        )
        AND o.observed_at >= now() - interval '30 days'
    );
END;
$$;

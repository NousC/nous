-- Outbound capture + coordination gate (Warmly-audit build).
--
-- #4  predictions.fired_signals — persist the EXACT signals that fired at scoring
--     time. scoreLead already computes them; we were throwing them away (keeping
--     only a count + text). Storing the array turns the predict→resolve loop into
--     a labeled signal→outcome dataset the discovery model can learn causally from.
ALTER TABLE predictions
  ADD COLUMN IF NOT EXISTS fired_signals JSONB NOT NULL DEFAULT '[]'::jsonb;

-- #3B workspaces.outreach_cooldowns — the configurable cooldown policy the
--     can_contact() guardrail reads. Defaults match sensible outbound hygiene
--     (email 72h, LinkedIn 48h, any-channel 24h). Per-workspace overridable.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS outreach_cooldowns JSONB NOT NULL
  DEFAULT '{"email_hours":72,"linkedin_hours":48,"any_hours":24}'::jsonb;

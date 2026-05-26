import { Router } from 'express';
import { getSupabaseClient } from '@nous/core';

export const webhooksRouter = Router();

const VALID_SOURCES = ['gmail', 'linkedin', 'calendar', 'rb2b', 'hubspot'];

// GET /api/webhooks/subscriptions
webhooksRouter.get('/subscriptions', async (req, res) => {
  try {
    const workspaceId = req.workspaceId || req.query.workspaceId;
    if (!workspaceId) return res.json({ subscriptions: [] });

    const { data, error } = await getSupabaseClient()
      .from('workspace_webhook_subscriptions')
      .select('source, status, created_at, tested_at')
      .eq('workspace_id', workspaceId);

    if (error) {
      // Fall back to old table name if new one doesn't exist
      const { data: fallback } = await getSupabaseClient()
        .from('webhook_subscriptions')
        .select('source, is_active, created_at')
        .eq('workspace_id', workspaceId);
      return res.json({ subscriptions: fallback || [] });
    }
    return res.json({ subscriptions: data || [] });
  } catch (err) {
    console.error('[GET /api/webhooks/subscriptions]', err);
    return res.json({ subscriptions: [] });
  }
});

// POST /api/webhooks/subscriptions
webhooksRouter.post('/subscriptions', async (req, res) => {
  try {
    const { source } = req.body;
    if (!source || !VALID_SOURCES.includes(source)) {
      return res.status(400).json({ error: 'invalid_source', valid: VALID_SOURCES });
    }

    const { data, error } = await getSupabaseClient()
      .from('webhook_subscriptions')
      .upsert({ workspace_id: req.workspaceId, source, is_active: true }, { onConflict: 'workspace_id,source' })
      .select('id, source, is_active, created_at')
      .single();

    if (error) throw error;
    return res.status(201).json(data);
  } catch (err) {
    console.error('[POST /api/webhooks/subscriptions]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// DELETE /api/webhooks/subscriptions/:source
webhooksRouter.delete('/subscriptions/:source', async (req, res) => {
  try {
    await getSupabaseClient()
      .from('webhook_subscriptions')
      .update({ is_active: false })
      .eq('workspace_id', req.workspaceId)
      .eq('source', req.params.source);

    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/webhooks/subscriptions/:source]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/webhooks/urls — inbound webhook URLs for each source, enriched
// with proof-of-life telemetry so the UI can give the user real confidence
// that a webhook is wired up. For each source we return:
//   - url:             where to paste / where events come in
//   - auto_registered: true only when we've stored proof that the provider's
//                      webhook-create API actually accepted our subscription
//                      (i.e. evidence-based, not aspirational)
//   - last_event_at:   ISO timestamp of the most recent inbound webhook
//   - status:          'live' (≤7d) | 'stale' (>7d) | 'pending' (never)
webhooksRouter.get('/urls', async (req, res) => {
  const workspaceId = req.workspaceId || req.query.workspaceId || req.query.workspace_id;
  const base = process.env.WORKER_URL
    || process.env.API_URL
    || (process.env.API_DOMAIN ? `https://${process.env.API_DOMAIN}` : null)
    || `http://localhost:${process.env.PORT || 3000}`;
  const b = base.replace(/\/+$/, '');

  const baseUrls = [
    { source: 'linkedin',   url: `${b}/api/linkedin/webhook` },
    { source: 'rb2b',       url: `${b}/inbound/rb2b/${workspaceId}` },
    { source: 'instantly',  url: `${b}/inbound/instantly/${workspaceId}` },
    { source: 'emailbison', url: `${b}/inbound/emailbison/${workspaceId}` },
    { source: 'heyreach',   url: `${b}/inbound/heyreach/${workspaceId}` },
    { source: 'smartlead',  url: `${b}/inbound/smartlead/${workspaceId}` },
    { source: 'fireflies',  url: `${b}/inbound/fireflies/${workspaceId}` },
    { source: 'fathom',     url: `${b}/inbound/fathom/${workspaceId}` },
    { source: 'calendly',   url: `${b}/inbound/calendly/${workspaceId}` },
    { source: 'cal_com',    url: `${b}/inbound/cal_com/${workspaceId}` },
  ];

  if (!workspaceId) return res.json({ urls: baseUrls });

  const supabase = getSupabaseClient();

  // ── Last received event per source ──────────────────────────────────────
  // Pull the most-recent webhook log rows ordered by occurred_at DESC and
  // keep the first hit for each source. The (workspace_id, occurred_at DESC)
  // index on workspace_system_log makes this O(scan-prefix).
  const lastBySource = {};
  try {
    const { data: logs } = await supabase
      .from('workspace_system_log')
      .select('source, occurred_at')
      .eq('workspace_id', workspaceId)
      .in('event_type', ['webhook_received', 'webhook_unknown_event'])
      .order('occurred_at', { ascending: false })
      .limit(500);
    for (const row of logs || []) {
      if (!lastBySource[row.source]) lastBySource[row.source] = row.occurred_at;
    }
  } catch { /* table may not exist on fresh installs — fall through */ }

  // ── Proven auto-registration ────────────────────────────────────────────
  // A provider counts as "auto-registered" only when we have stored evidence
  // that its webhook-create API succeeded. LinkedIn is the exception: Unipile
  // handles registration on the OAuth callback, so connection presence is the
  // best proof we have without probing Unipile.
  const proven = new Set();
  try {
    const { data: conns } = await supabase
      .from('workflow_provider_connections')
      .select('encrypted_credentials, provider:workflow_providers(name)')
      .eq('workspace_id', workspaceId);
    for (const c of conns || []) {
      const name  = c.provider?.name;
      const creds = c.encrypted_credentials || {};
      if (name === 'calendly' && creds.webhook_subscription_uri) proven.add('calendly');
      if (name === 'cal_com'  && creds.webhook_id)               proven.add('cal_com');
      if (name === 'heyreach' && Array.isArray(creds.webhook_ids) && creds.webhook_ids.length) {
        proven.add('heyreach');
      }
    }
  } catch { /* fall through */ }

  // LinkedIn auto-registration is handled by Unipile during the OAuth flow.
  // Treat a row in workspace_linkedin_connections as proof that the link is
  // live; once Unipile has the account, webhooks fire on /api/linkedin/webhook.
  try {
    const { count } = await supabase
      .from('workspace_linkedin_connections')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId);
    if ((count || 0) > 0) proven.add('linkedin');
  } catch { /* table may not exist — fall through */ }

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const urls = baseUrls.map(entry => {
    const last = lastBySource[entry.source] || null;
    let status = 'pending';
    if (last) {
      const ageMs = Date.now() - new Date(last).getTime();
      status = ageMs <= SEVEN_DAYS_MS ? 'live' : 'stale';
    }
    return {
      ...entry,
      auto_registered: proven.has(entry.source),
      last_event_at:   last,
      status,
    };
  });

  return res.json({ urls });
});

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

// GET /api/webhooks/urls — inbound webhook URLs for each source
webhooksRouter.get('/urls', async (req, res) => {
  const workspaceId = req.workspaceId || req.query.workspaceId || req.query.workspace_id;
  const base = process.env.WORKER_URL
    || process.env.API_URL
    || (process.env.API_DOMAIN ? `https://${process.env.API_DOMAIN}` : null)
    || `http://localhost:${process.env.PORT || 3000}`;
  const b = base.replace(/\/+$/, '');
  // Each entry is either paste-required (user copies the URL into the tool's
  // webhook UI) or auto_registered (Nous registers the subscription via the
  // provider's API on connect — URL is shown for transparency/debugging only).
  const urls = [
    { source: 'linkedin',  url: `${b}/api/linkedin/webhook`, auto_registered: true },
    { source: 'rb2b',      url: `${b}/inbound/rb2b/${workspaceId}` },
    { source: 'instantly', url: `${b}/inbound/instantly/${workspaceId}` },
    { source: 'emailbison', url: `${b}/inbound/emailbison/${workspaceId}` },
    { source: 'heyreach', url: `${b}/inbound/heyreach/${workspaceId}`, auto_registered: true },
    { source: 'smartlead', url: `${b}/inbound/smartlead/${workspaceId}` },
    { source: 'fireflies', url: `${b}/inbound/fireflies/${workspaceId}` },
    { source: 'fathom',    url: `${b}/inbound/fathom/${workspaceId}` },
    { source: 'calendly',  url: `${b}/inbound/calendly/${workspaceId}`, auto_registered: true },
    { source: 'cal_com',   url: `${b}/inbound/cal_com/${workspaceId}`,  auto_registered: true },
  ];
  return res.json({ urls });
});

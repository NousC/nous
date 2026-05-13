import { Router } from 'express';
import { getSupabaseClient } from '@proply/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';

export const linkedinRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

linkedinRouter.get('/status', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { workspaceId } = req.query;
    if (!workspaceId || !UUID.test(workspaceId))
      return res.status(400).json({ error: 'invalid_workspace_id' });

    const { data } = await supabase
      .from('workspace_linkedin_connections')
      .select('id, linkedin_name, linkedin_headline, linkedin_profile_url, connected_at')
      .eq('workspace_id', workspaceId)
      .single();

    return res.json({ connected: !!data, connection: data || null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

linkedinRouter.get('/connect', verifySupabaseAuth, async (req, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId || !UUID.test(workspaceId))
      return res.status(400).json({ error: 'invalid_workspace_id' });

    if (!process.env.UNIPILE_API_KEY || !process.env.UNIPILE_DSN)
      return res.status(503).json({ error: 'linkedin_not_configured' });

    const dsn = process.env.UNIPILE_DSN;
    const apiKey = process.env.UNIPILE_API_KEY;
    const baseUrl = `https://${dsn}`;

    const response = await fetch(`${baseUrl}/api/v1/hosted/accounts/link`, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'create',
        providers: ['LINKEDIN'],
        api_url: `${process.env.APP_URL}/api/linkedin/callback?workspace_id=${workspaceId}`,
        success_redirect_url: `${process.env.APP_URL}/api/linkedin/callback?workspace_id=${workspaceId}`,
        failure_redirect_url: `${process.env.APP_URL}/integrations?linkedin=error`,
        notify_url: `${process.env.APP_URL}/api/linkedin/webhook`,
      }),
    });
    const data = await response.json();
    if (!data.url) return res.status(500).json({ error: 'failed_to_create_auth_link' });
    return res.json({ url: data.url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

linkedinRouter.get('/disconnect', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { workspaceId } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    await supabase.from('workspace_linkedin_connections').delete().eq('workspace_id', workspaceId);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

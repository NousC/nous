import { Router } from 'express';
import { getSupabaseClient } from '@nous/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';
import crypto from 'crypto';

export const workflowProvidersRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  ? Buffer.from(process.env.ENCRYPTION_KEY.slice(0, 64).padEnd(64, '0'), 'hex')
  : null;

function decrypt(encryptedValue) {
  if (!encryptedValue || typeof encryptedValue !== 'string') return encryptedValue ?? null;
  const parts = encryptedValue.split(':');
  // Recognized formats: CBC (iv:data) or legacy GCM (iv:data:tag). Plain strings
  // (instance_url, scope, token_type) flow through unchanged.
  const isCBC = parts.length === 2 && /^[0-9a-f]{32}$/i.test(parts[0]);
  const isGCM = parts.length === 3 && /^[0-9a-f]{32}$/i.test(parts[0]) && /^[0-9a-f]{32}$/i.test(parts[2]);
  if (!ENCRYPTION_KEY || (!isCBC && !isGCM)) return encryptedValue;
  try {
    if (isCBC) {
      const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, Buffer.from(parts[0], 'hex'));
      return decipher.update(parts[1], 'hex', 'utf8') + decipher.final('utf8');
    }
    const [ivHex, dataHex, tagHex] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(dataHex, 'hex', 'utf8') + decipher.final('utf8');
  } catch { return encryptedValue; }
}

// GET /api/workflow-providers
workflowProvidersRouter.get('/', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { category, search } = req.query;
    let query = supabase.from('workflow_providers').select('*').eq('is_active', true).order('display_name');
    if (category) query = query.eq('category', category);
    if (search) query = query.or(`display_name.ilike.%${search}%,description.ilike.%${search}%`);
    const { data: providers, error } = await query;
    if (error) throw error;
    return res.json({ providers: providers || [] });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/workflow-providers/connections — must be before /:id
workflowProvidersRouter.get('/connections', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { workspace_id, provider_id } = req.query;
    if (!workspace_id) return res.status(400).json({ error: 'workspace_id_required' });

    let query = supabase
      .from('workflow_provider_connections')
      .select(`
        id, workspace_id, provider_id, name, created_at, last_used_at,
        is_verified, last_test_at, encrypted_credentials,
        provider:workflow_providers(id, name, display_name, logo_url, auth_type, auth_fields, category)
      `)
      .eq('workspace_id', workspace_id)
      .order('created_at', { ascending: false });

    if (provider_id) query = query.eq('provider_id', provider_id);
    const { data: connections, error } = await query;
    if (error) throw error;

    const processed = (connections || []).map(conn => {
      const hints = {};
      if (conn.encrypted_credentials) {
        for (const [key, val] of Object.entries(conn.encrypted_credentials)) {
          const dec = decrypt(val);
          if (dec && dec.length >= 12) hints[key] = dec.slice(0, 8) + '...' + dec.slice(-4);
          else if (dec && dec.length > 4) hints[key] = dec.slice(0, 4) + '...';
          else hints[key] = '••••••••';
        }
      }
      // Non-secret status flags derived from encrypted_credentials before stripping.
      // Calendly stores subscription_uri, Cal.com stores webhook_id — either means registered.
      const webhook_registered =
        !!conn.encrypted_credentials?.webhook_subscription_uri
        || !!conn.encrypted_credentials?.webhook_id;
      const { encrypted_credentials: _, ...rest } = conn;
      return { ...rest, credential_hints: hints, webhook_registered };
    });

    return res.json({ connections: processed });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/workflow-providers/connections
workflowProvidersRouter.post('/connections', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { workspace_id, provider_id, name, credentials, is_verified } = req.body;
    if (!workspace_id || !provider_id) return res.status(400).json({ error: 'workspace_id and provider_id required' });

    const encrypted_credentials = {};
    if (credentials && ENCRYPTION_KEY) {
      for (const [key, val] of Object.entries(credentials)) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        encrypted_credentials[key] = iv.toString('hex') + ':' + cipher.update(String(val), 'utf8', 'hex') + cipher.final('hex');
      }
    }

    // Upsert so re-saving the same provider doesn't 23505 on the unique
    // (workspace_id, provider_id, name) constraint. Honour is_verified from
    // the body when the client has just passed a test connection.
    const { data, error } = await supabase
      .from('workflow_provider_connections')
      .upsert({
        workspace_id,
        provider_id,
        name: name || 'Connection',
        encrypted_credentials,
        created_by: req.internalUserId,
        is_verified: is_verified === true,
        last_test_at: is_verified === true ? new Date().toISOString() : null,
      }, { onConflict: 'workspace_id,provider_id,name' })
      .select('id, workspace_id, provider_id, name, created_at, is_verified')
      .single();

    if (error) throw error;
    return res.json({ connection: data });
  } catch (err) {
    console.error('[POST /api/workflow-providers/connections]', err.message, err.code);
    return res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// Shared: test raw credentials against a provider
async function testProviderCredentials(provider, credentials) {
  const token = credentials.access_token || credentials.api_key || credentials.api_token || Object.values(credentials).find(Boolean);

  try {
    const p = (provider || '').toLowerCase();
    if (p === 'hubspot') {
      if (!token) return { verified: false, message: 'No credentials provided' };
      const r = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) return { verified: true, message: 'Connected to HubSpot' };
      const e = await r.json().catch(() => ({}));
      return { verified: false, message: e.message || `HubSpot returned ${r.status}` };
    }
    if (p === 'pipedrive') {
      if (!token) return { verified: false, message: 'No credentials provided' };
      const r = await fetch(`https://api.pipedrive.com/v1/users/me?api_token=${token}`);
      if (r.ok) return { verified: true, message: 'Connected to Pipedrive' };
      return { verified: false, message: `Pipedrive returned ${r.status}` };
    }
    if (p === 'attio') {
      if (!token) return { verified: false, message: 'No credentials provided' };
      const r = await fetch('https://api.attio.com/v2/self', { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) return { verified: true, message: 'Connected to Attio' };
      const e = await r.json().catch(() => ({}));
      return { verified: false, message: e.message || `Attio returned ${r.status}` };
    }
    if (p === 'instantly') {
      if (!token) return { verified: false, message: 'No credentials provided' };
      const r = await fetch('https://api.instantly.ai/api/v2/campaigns?limit=1', { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) return { verified: true, message: 'Connected to Instantly' };
      return { verified: false, message: `Instantly returned ${r.status} — check your API key` };
    }
    if (p === 'emailbison') {
      if (!token) return { verified: false, message: 'No credentials provided' };
      // /api/users is what the EmailBison docs call out as the sample connectivity test
      const r = await fetch('https://dedi.emailbison.com/api/users', {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (r.ok) return { verified: true, message: 'Connected to EmailBison' };
      if (r.status === 401) return { verified: false, message: 'Invalid EmailBison API key' };
      return { verified: false, message: `EmailBison returned ${r.status} — check your API key` };
    }
    if (p === 'heyreach') {
      if (!token) return { verified: false, message: 'No credentials provided' };
      const r = await fetch('https://api.heyreach.io/api/public/auth/CheckApiKey', {
        headers: { 'X-API-KEY': token, Accept: 'text/plain' },
      });
      if (r.ok) return { verified: true, message: 'Connected to HeyReach' };
      if (r.status === 401) return { verified: false, message: 'Invalid HeyReach API key' };
      return { verified: false, message: `HeyReach returned ${r.status} — check your API key` };
    }
    if (p === 'smartlead') {
      if (!token) return { verified: false, message: 'No credentials provided' };
      const r = await fetch(`https://server.smartlead.ai/api/v1/campaigns/?api_key=${encodeURIComponent(token)}&limit=1`);
      if (r.ok) return { verified: true, message: 'Connected to Smartlead' };
      if (r.status === 401 || r.status === 403) return { verified: false, message: 'Invalid Smartlead API key' };
      return { verified: false, message: `Smartlead returned ${r.status} — check your API key` };
    }
    if (p === 'fireflies') {
      if (!token) return { verified: false, message: 'No credentials provided' };
      const r = await fetch('https://api.fireflies.ai/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ query: '{ user { name email } }' }),
      });
      const d = await r.json().catch(() => ({}));
      if (d.data?.user?.email) return { verified: true, message: `Connected as ${d.data.user.email}` };
      return { verified: false, message: d.errors?.[0]?.message || 'Invalid Fireflies API key' };
    }
    if (p === 'fathom') {
      if (!token) return { verified: false, message: 'No credentials provided' };
      const r = await fetch('https://api.fathom.ai/external/v1/meetings?limit=1', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) return { verified: true, message: 'Connected to Fathom' };
      return { verified: false, message: `Fathom returned ${r.status} — check your API key` };
    }
    if (p === 'salesforce') {
      const access = credentials.access_token;
      const instance = credentials.instance_url;
      if (!access || !instance) return { verified: false, message: 'Salesforce token or instance URL missing — reconnect via OAuth' };
      const r = await fetch(`${instance.replace(/\/$/, '')}/services/data/v59.0/sobjects/`, {
        headers: { Authorization: `Bearer ${access}` },
      });
      if (r.ok) return { verified: true, message: `Connected to Salesforce (${new URL(instance).host})` };
      if (r.status === 401) return { verified: false, message: 'Salesforce token expired — reconnect via OAuth' };
      return { verified: false, message: `Salesforce returned ${r.status}` };
    }
    if (p === 'calendly') {
      if (!token) return { verified: false, message: 'No credentials provided' };
      const r = await fetch('https://api.calendly.com/users/me', {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (r.ok) {
        const d = await r.json().catch(() => ({}));
        const name = d.resource?.name || d.resource?.email || 'Calendly user';
        return { verified: true, message: `Connected as ${name}` };
      }
      return { verified: false, message: `Calendly returned ${r.status} — check your personal access token` };
    }
    if (p === 'smtp') {
      const host     = credentials.host;
      const username = credentials.username;
      const password = credentials.password;
      if (!host || !username || !password) {
        return { verified: false, message: 'host, username, and password are required' };
      }

      // The user case this provider serves is inbound email reception via IMAP.
      // Verify the IMAP side specifically so the test exercises the same path
      // the worker poller uses. Derive the IMAP host from the SMTP-style host
      // unless the user provided imap_host explicitly.
      const imapHost = credentials.imap_host
        || (/office365\.com|smtp-mail\.outlook\.com/i.test(host) ? 'outlook.office365.com' : host.replace(/^smtp\./i, 'imap.'));
      const imapPort = parseInt(credentials.imap_port || '993');

      try {
        const { ImapFlow } = await import('imapflow');
        const client = new ImapFlow({
          host: imapHost,
          port: imapPort,
          secure: imapPort === 993,
          auth: { user: username, pass: password },
          logger: false,
        });
        await client.connect();
        await client.logout();
        return { verified: true, message: `IMAP connected (${username} via ${imapHost})` };
      } catch (err) {
        return { verified: false, message: `IMAP connection failed: ${err.message || err.code || 'unknown'}` };
      }
    }
    if (!token) return { verified: false, message: 'No credentials provided' };
    // Generic: just confirm token exists
    return { verified: true, message: 'Credentials saved' };
  } catch (err) {
    const msg = err.message || 'Connection failed';
    return { verified: false, message: msg.includes('ECONNREFUSED') ? `Cannot connect to SMTP server — check host and port` : msg };
  }
}

// POST /api/workflow-providers/connections/test  (test before saving — no existing connection)
workflowProvidersRouter.post('/connections/test', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { provider_id, credentials } = req.body;
    if (!provider_id || !credentials) return res.status(400).json({ error: 'provider_id and credentials required' });

    const { data: provider } = await supabase.from('workflow_providers').select('name').eq('id', provider_id).single();
    const result = await testProviderCredentials(provider?.name, credentials);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ verified: false, message: 'internal_error' });
  }
});

// GET /api/workflow-providers/connections/:id
workflowProvidersRouter.get('/connections/:id', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { id } = req.params;
    if (!UUID.test(id)) return res.status(400).json({ error: 'invalid_id' });
    const { data, error } = await supabase
      .from('workflow_provider_connections')
      .select('id, workspace_id, provider_id, name, is_verified, last_test_at, created_at, provider:workflow_providers(id, name, display_name, logo_url, auth_type, auth_fields, category)')
      .eq('id', id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'not_found' });

    const hints = {};
    const { data: full } = await supabase.from('workflow_provider_connections').select('encrypted_credentials').eq('id', id).single();
    if (full?.encrypted_credentials) {
      for (const [key, val] of Object.entries(full.encrypted_credentials)) {
        const dec = decrypt(val);
        if (dec && dec.length >= 12) hints[key] = dec.slice(0, 8) + '...' + dec.slice(-4);
        else if (dec && dec.length > 4) hints[key] = dec.slice(0, 4) + '...';
        else hints[key] = '••••••••';
      }
    }
    return res.json({ connection: { ...data, credential_hints: hints } });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/workflow-providers/connections/:id/test
workflowProvidersRouter.post('/connections/:id/test', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { id } = req.params;
    if (!UUID.test(id)) return res.status(400).json({ error: 'invalid_id' });
    const { data: conn } = await supabase
      .from('workflow_provider_connections')
      .select('encrypted_credentials, provider:workflow_providers(name)')
      .eq('id', id).single();
    if (!conn) return res.status(404).json({ error: 'not_found' });

    const creds = {};
    for (const [k, v] of Object.entries(conn.encrypted_credentials || {})) {
      creds[k] = decrypt(v);
    }

    const result = await testProviderCredentials(conn.provider?.name, creds);
    await supabase.from('workflow_provider_connections')
      .update({ is_verified: result.verified, last_test_at: new Date().toISOString() })
      .eq('id', id);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ verified: false, message: 'internal_error' });
  }
});

// PATCH /api/workflow-providers/connections/:id  (update credentials)
workflowProvidersRouter.patch('/connections/:id', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { id } = req.params;
    if (!UUID.test(id)) return res.status(400).json({ error: 'invalid_id' });
    const { credentials } = req.body;
    if (!credentials || !Object.keys(credentials).length) return res.status(400).json({ error: 'credentials required' });

    const { data: existing } = await supabase.from('workflow_provider_connections').select('encrypted_credentials').eq('id', id).single();
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const merged = { ...(existing.encrypted_credentials || {}) };
    if (ENCRYPTION_KEY) {
      for (const [key, val] of Object.entries(credentials)) {
        if (!val) continue;
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        merged[key] = iv.toString('hex') + ':' + cipher.update(String(val), 'utf8', 'hex') + cipher.final('hex');
      }
    }

    await supabase.from('workflow_provider_connections').update({ encrypted_credentials: merged, is_verified: false }).eq('id', id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// PATCH /api/workflow-providers/connections/:id/enrichment-toggle
workflowProvidersRouter.patch('/connections/:id/enrichment-toggle', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { id } = req.params;
    if (!UUID.test(id)) return res.status(400).json({ error: 'invalid_id' });
    const { enabled, workspace_id } = req.body;

    const { data: existing } = await supabase
      .from('workflow_provider_connections')
      .select('encrypted_credentials, workspace_id, provider:workflow_providers(category)')
      .eq('id', id).single();
    if (!existing) return res.status(404).json({ error: 'not_found' });

    // If enabling an enrichment provider, disable all other enrichment connections in this workspace
    if (enabled && existing.provider?.category === 'enrichment') {
      const wid = workspace_id || existing.workspace_id;
      const { data: others } = await supabase
        .from('workflow_provider_connections')
        .select('id, encrypted_credentials')
        .eq('workspace_id', wid)
        .neq('id', id)
        .eq('provider.category', 'enrichment');
      for (const other of others || []) {
        if (other.encrypted_credentials?.use_for_enrichment) {
          await supabase.from('workflow_provider_connections')
            .update({ encrypted_credentials: { ...other.encrypted_credentials, use_for_enrichment: false } })
            .eq('id', other.id);
        }
      }
    }

    const updated = { ...(existing.encrypted_credentials || {}), use_for_enrichment: !!enabled };
    await supabase.from('workflow_provider_connections').update({ encrypted_credentials: updated }).eq('id', id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// DELETE /api/workflow-providers/connections/:id
workflowProvidersRouter.delete('/connections/:id', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { id } = req.params;
    if (!UUID.test(id)) return res.status(400).json({ error: 'invalid_id' });

    // Look up provider + credentials before deleting so we can clean up
    // external state (Calendly webhook subscription) where applicable.
    const { data: conn } = await supabase
      .from('workflow_provider_connections')
      .select('encrypted_credentials, workflow_providers!inner(name)')
      .eq('id', id)
      .maybeSingle();

    if (conn?.workflow_providers?.name === 'calendly') {
      const pat = decrypt(conn.encrypted_credentials?.api_key || '');
      const subUri = conn.encrypted_credentials?.webhook_subscription_uri;
      if (pat && subUri) await unsubscribeCalendlyWebhook(pat, subUri);
    }

    if (conn?.workflow_providers?.name === 'cal_com') {
      const pat = decrypt(conn.encrypted_credentials?.api_key || '');
      const wid = conn.encrypted_credentials?.webhook_id;
      if (pat && wid) await unsubscribeCalComWebhook(pat, wid);
    }

    if (conn?.workflow_providers?.name === 'heyreach') {
      const pat = decrypt(conn.encrypted_credentials?.api_key || '');
      const ids = conn.encrypted_credentials?.webhook_ids;
      if (pat && Array.isArray(ids)) {
        for (const wid of ids) await unsubscribeHeyReachWebhook(pat, wid);
      }
    }

    if (conn?.workflow_providers?.name === 'lemlist') {
      const pat = decrypt(conn.encrypted_credentials?.api_key || '');
      const wid = conn.encrypted_credentials?.webhook_id;
      if (pat && wid) await unsubscribeLemlistWebhook(pat, wid);
    }

    await supabase.from('workflow_provider_connections').delete().eq('id', id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/workflow-providers/slack/channels  — list channels for a saved Slack connection
workflowProvidersRouter.get('/slack/channels', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { connection_id } = req.query;
    if (!connection_id) return res.status(400).json({ error: 'connection_id_required' });

    const { data: conn } = await supabase
      .from('workflow_provider_connections')
      .select('encrypted_credentials')
      .eq('id', connection_id)
      .single();
    if (!conn) return res.status(404).json({ error: 'not_found' });

    const token = decrypt(conn.encrypted_credentials?.bot_token || conn.encrypted_credentials?.access_token || conn.encrypted_credentials?.token || '');
    if (!token) return res.status(400).json({ error: 'no_token' });

    const slackRes = await fetch('https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=200', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await slackRes.json();
    if (!data.ok) return res.status(400).json({ error: data.error || 'slack_error' });

    const channels = (data.channels || []).map(c => ({ id: c.id, name: c.name, is_private: c.is_private }));
    return res.json({ channels });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Providers connectable via the simplified /:name/test + /:name/connect endpoints
// (used by the Mind popup quick-connect flow). Anything not in this list still works
// via the generic /connections endpoint used by Settings → Integrations.
const NAMED_PROVIDERS = ['apollo', 'instantly', 'lemlist', 'emailbison', 'heyreach', 'smartlead', 'prospeo', 'hubspot', 'pipedrive', 'attio', 'calendly', 'fireflies', 'fathom', 'cal_com'];

const CAL_COM_API_VERSION = '2026-05-01';

function workerBaseUrl() {
  return (process.env.WORKER_URL
    || process.env.API_URL
    || (process.env.API_DOMAIN ? `https://${process.env.API_DOMAIN}` : null)
    || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
}

// Subscribes to Calendly's webhook API for invitee.created / invitee.canceled.
// Returns { subscription_uri, signing_key } on success, or { error } on failure.
// signing_key is a freshly-generated random 64-char hex we hand to Calendly so
// they sign every payload with it — we verify on inbound at /inbound/calendly.
async function subscribeCalendlyWebhook(pat, workspaceId) {
  try {
    const meRes = await fetch('https://api.calendly.com/users/me', {
      headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    });
    if (!meRes.ok) return { error: `calendly_users_me_failed_${meRes.status}` };
    const meBody = await meRes.json();
    const userUri = meBody.resource?.uri;
    const orgUri  = meBody.resource?.current_organization;
    if (!userUri || !orgUri) return { error: 'calendly_user_or_org_uri_missing' };

    const callbackUrl = `${workerBaseUrl()}/inbound/calendly/${workspaceId}`;
    const signingKey  = crypto.randomBytes(32).toString('hex');

    const subRes = await fetch('https://api.calendly.com/webhook_subscriptions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        url:          callbackUrl,
        events:       ['invitee.created', 'invitee.canceled'],
        organization: orgUri,
        user:         userUri,
        scope:        'user',
        signing_key:  signingKey,
      }),
    });

    if (!subRes.ok) {
      const errBody = await subRes.json().catch(() => ({}));
      return { error: `calendly_subscribe_failed_${subRes.status}`, detail: errBody };
    }

    const subBody = await subRes.json();
    return { subscription_uri: subBody.resource?.uri, signing_key: signingKey };
  } catch (err) {
    return { error: 'calendly_subscribe_exception', message: err.message };
  }
}

async function unsubscribeCalendlyWebhook(pat, subscriptionUri) {
  if (!subscriptionUri) return;
  try {
    await fetch(subscriptionUri, {
      method:  'DELETE',
      headers: { Authorization: `Bearer ${pat}` },
    });
  } catch (err) {
    console.warn('[CALENDLY_UNSUBSCRIBE]', err.message);
  }
}

// Cal.com webhook subscription — POST /v2/webhooks. Triggers covered:
// BOOKING_CREATED, BOOKING_CANCELLED, BOOKING_RESCHEDULED.
// Signature on inbound: x-cal-signature-256: <hex_hmac_sha256(body, secret)>
async function subscribeCalComWebhook(pat, workspaceId) {
  try {
    const callbackUrl = `${workerBaseUrl()}/inbound/cal_com/${workspaceId}`;
    const signingKey  = crypto.randomBytes(32).toString('hex');

    const res = await fetch('https://api.cal.com/v2/webhooks', {
      method:  'POST',
      headers: {
        Authorization:     `Bearer ${pat}`,
        'Content-Type':    'application/json',
        'cal-api-version': CAL_COM_API_VERSION,
      },
      body: JSON.stringify({
        active:        true,
        subscriberUrl: callbackUrl,
        triggers:      ['BOOKING_CREATED', 'BOOKING_CANCELLED', 'BOOKING_RESCHEDULED'],
        secret:        signingKey,
      }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return { error: `cal_com_subscribe_failed_${res.status}`, detail: errBody };
    }

    const body = await res.json();
    // Cal.com v2 wraps payloads in `data`. Webhook ID may live at body.data.id
    // or body.id depending on version — accept both.
    const webhookId = body?.data?.id ?? body?.id ?? null;
    if (!webhookId) return { error: 'cal_com_webhook_id_missing', detail: body };

    return { webhook_id: String(webhookId), signing_key: signingKey };
  } catch (err) {
    return { error: 'cal_com_subscribe_exception', message: err.message };
  }
}

async function unsubscribeCalComWebhook(pat, webhookId) {
  if (!webhookId) return;
  try {
    await fetch(`https://api.cal.com/v2/webhooks/${webhookId}`, {
      method:  'DELETE',
      headers: { Authorization: `Bearer ${pat}`, 'cal-api-version': CAL_COM_API_VERSION },
    });
  } catch (err) {
    console.warn('[CAL_COM_UNSUBSCRIBE]', err.message);
  }
}

// HeyReach — one webhook per event type. We register N webhooks on connect and
// store their ids on the connection for cleanup on disconnect.
//
// EVENT SELECTION
// ---------------
// HeyReach has 12 event types. Four of them — MESSAGE_REPLY_RECEIVED,
// INMAIL_REPLY_RECEIVED, CONNECTION_REQUEST_ACCEPTED, EVERY_MESSAGE_REPLY_RECEIVED
// — describe things that happen *to* the user (someone replied, someone
// accepted). Those land in the LinkedIn inbox itself, so Unipile (our native
// LinkedIn integration) is already the system of record for them. Subscribing
// to them via HeyReach too would just produce duplicate timeline entries.
//
// The remaining 8 events describe things HeyReach *did on the user's behalf*
// (sent a request, sent a message, followed someone, liked a post, ...) plus
// HeyReach-internal events (CAMPAIGN_COMPLETED, LEAD_TAG_UPDATED). Unipile
// can't see these as discrete real-time signals, so HeyReach is the only
// system of record for them — subscribe to all 8.
//
// REQUEST BODY NOTES
// ------------------
// - `campaignIds` is required by HeyReach even when targeting all campaigns;
//   pass an empty array to mean "all campaigns".
// - `webhookName` has a 25-char limit. Short labels are mapped per-event below.
const HEYREACH_EVENTS = [
  { type: 'CONNECTION_REQUEST_SENT', name: 'Nous · CR Sent' },
  { type: 'MESSAGE_SENT',            name: 'Nous · Msg Sent' },
  { type: 'INMAIL_SENT',             name: 'Nous · InMail Sent' },
  { type: 'FOLLOW_SENT',             name: 'Nous · Follow' },
  { type: 'LIKED_POST',              name: 'Nous · Liked Post' },
  { type: 'VIEWED_PROFILE',          name: 'Nous · Viewed Profile' },
  { type: 'CAMPAIGN_COMPLETED',      name: 'Nous · Campaign Done' },
  { type: 'LEAD_TAG_UPDATED',        name: 'Nous · Tag Updated' },
];

async function subscribeHeyReachWebhooks(apiKey, workspaceId) {
  const callbackUrl = `${workerBaseUrl()}/inbound/heyreach/${workspaceId}`;
  const created = [];
  for (const { type, name } of HEYREACH_EVENTS) {
    try {
      const res = await fetch('https://api.heyreach.io/api/public/webhooks/CreateWebhook', {
        method:  'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookName: name,
          webhookUrl:  callbackUrl,
          eventType:   type,
          campaignIds: [],          // required by HeyReach; [] means "all campaigns"
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        // Roll back what we already created so the user doesn't get half-subscribed
        for (const id of created) await unsubscribeHeyReachWebhook(apiKey, id);
        return { error: `heyreach_subscribe_failed_${res.status}`, detail, eventType: type };
      }
      const body = await res.json().catch(() => ({}));
      const id = body?.id ?? body?.webhookId ?? body?.data?.id;
      if (id != null) created.push(String(id));
    } catch (err) {
      for (const id of created) await unsubscribeHeyReachWebhook(apiKey, id);
      return { error: 'heyreach_subscribe_exception', message: err.message, eventType: type };
    }
  }
  return { webhook_ids: created };
}

async function unsubscribeHeyReachWebhook(apiKey, webhookId) {
  if (!webhookId) return;
  try {
    await fetch(`https://api.heyreach.io/api/public/webhooks/DeleteWebhook?webhookId=${encodeURIComponent(webhookId)}`, {
      method:  'DELETE',
      headers: { 'X-API-KEY': apiKey },
    });
  } catch (err) {
    console.warn('[HEYREACH_UNSUBSCRIBE]', err.message);
  }
}

// Lemlist — POST /api/hooks accepts an optional `type` field. Omitting it means
// "send every event", so a single webhook covers all activity for a workspace
// (no per-event-type fan-out like HeyReach). We generate a per-connection
// secret and store it; Lemlist echoes it back in body.secret on every delivery
// for the handler to verify.
function lemlistBasicAuth(apiKey) {
  return `Basic ${Buffer.from(`:${apiKey}`).toString('base64')}`;
}

async function subscribeLemlistWebhook(apiKey, workspaceId) {
  const callbackUrl = `${workerBaseUrl()}/inbound/lemlist/${workspaceId}`;
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    const res = await fetch('https://api.lemlist.com/api/hooks', {
      method:  'POST',
      headers: {
        Authorization:    lemlistBasicAuth(apiKey),
        'Content-Type':   'application/json',
      },
      body: JSON.stringify({
        targetUrl: callbackUrl,
        secret,
        // `type` omitted on purpose — Lemlist sends every event on this one webhook.
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { error: `lemlist_subscribe_failed_${res.status}`, detail };
    }
    const body = await res.json().catch(() => ({}));
    const id = body?._id ?? body?.id ?? null;
    if (!id) return { error: 'lemlist_webhook_id_missing', detail: body };
    return { webhook_id: String(id), webhook_secret: secret };
  } catch (err) {
    return { error: 'lemlist_subscribe_exception', message: err.message };
  }
}

async function unsubscribeLemlistWebhook(apiKey, hookId) {
  if (!hookId) return;
  try {
    await fetch(`https://api.lemlist.com/api/hooks/${encodeURIComponent(hookId)}`, {
      method:  'DELETE',
      headers: { Authorization: lemlistBasicAuth(apiKey) },
    });
  } catch (err) {
    console.warn('[LEMLIST_UNSUBSCRIBE]', err.message);
  }
}

async function testNamedProvider(name, apiKey) {
  if (!apiKey) return { verified: false, message: 'API key is required' };

  if (name === 'apollo') {
    const r = await fetch('https://api.apollo.io/v1/people/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ reveal_personal_emails: false }),
    });
    if (r.status === 401 || r.status === 403) return { verified: false, message: 'Invalid Apollo API key' };
    return { verified: true, message: 'Apollo API key verified' };
  }

  if (name === 'instantly') {
    const r = await fetch('https://api.instantly.ai/api/v2/campaigns?limit=1', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (r.ok) return { verified: true, message: 'Connected to Instantly' };
    return { verified: false, message: `Instantly returned ${r.status} — check your API key` };
  }

  if (name === 'emailbison') {
    // /api/users is what the EmailBison docs call out as the sample connectivity test
    const r = await fetch('https://dedi.emailbison.com/api/users', {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (r.ok) return { verified: true, message: 'Connected to EmailBison' };
    if (r.status === 401) return { verified: false, message: 'Invalid EmailBison API key' };
    return { verified: false, message: `EmailBison returned ${r.status} — check your API key` };
  }

  if (name === 'heyreach') {
    const r = await fetch('https://api.heyreach.io/api/public/auth/CheckApiKey', {
      headers: { 'X-API-KEY': apiKey, Accept: 'text/plain' },
    });
    if (r.ok) return { verified: true, message: 'Connected to HeyReach' };
    if (r.status === 401) return { verified: false, message: 'Invalid HeyReach API key' };
    return { verified: false, message: `HeyReach returned ${r.status} — check your API key` };
  }

  if (name === 'smartlead') {
    const r = await fetch(`https://server.smartlead.ai/api/v1/campaigns/?api_key=${encodeURIComponent(apiKey)}&limit=1`);
    if (r.ok) return { verified: true, message: 'Connected to Smartlead' };
    if (r.status === 401 || r.status === 403) return { verified: false, message: 'Invalid Smartlead API key' };
    return { verified: false, message: `Smartlead returned ${r.status} — check your API key` };
  }

  if (name === 'lemlist') {
    const r = await fetch('https://api.lemlist.com/api/team', {
      headers: { Authorization: `Basic ${Buffer.from(`:${apiKey}`).toString('base64')}` },
    });
    if (r.ok) return { verified: true, message: 'Connected to Lemlist' };
    return { verified: false, message: `Lemlist returned ${r.status} — check your API key` };
  }

  if (name === 'prospeo') {
    const r = await fetch('https://api.prospeo.io/domain-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-KEY': apiKey },
      body: JSON.stringify({ company: 'test.com', limit: 1 }),
    });
    if (r.status === 401 || r.status === 403) return { verified: false, message: 'Invalid Prospeo API key' };
    return { verified: true, message: 'Prospeo API key verified' };
  }

  if (name === 'hubspot') {
    const r = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (r.ok) return { verified: true, message: 'Connected to HubSpot' };
    const e = await r.json().catch(() => ({}));
    return { verified: false, message: e.message || `HubSpot returned ${r.status} — check your private-app token` };
  }

  if (name === 'pipedrive') {
    const r = await fetch(`https://api.pipedrive.com/v1/users/me?api_token=${encodeURIComponent(apiKey)}`);
    if (r.ok) {
      const d = await r.json().catch(() => ({}));
      const name = d.data?.name || d.data?.email || 'Pipedrive user';
      return { verified: true, message: `Connected as ${name}` };
    }
    return { verified: false, message: `Pipedrive returned ${r.status} — check your API token` };
  }

  if (name === 'attio') {
    const r = await fetch('https://api.attio.com/v2/self', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (r.ok) return { verified: true, message: 'Connected to Attio' };
    const e = await r.json().catch(() => ({}));
    return { verified: false, message: e.message || `Attio returned ${r.status} — check your API key` };
  }

  if (name === 'calendly') {
    const r = await fetch('https://api.calendly.com/users/me', {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (r.ok) {
      const d = await r.json().catch(() => ({}));
      const who = d.resource?.name || d.resource?.email || 'Calendly user';
      return { verified: true, message: `Connected as ${who}` };
    }
    return { verified: false, message: `Calendly returned ${r.status} — check your personal access token` };
  }

  if (name === 'fireflies') {
    const r = await fetch('https://api.fireflies.ai/graphql', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body:    JSON.stringify({ query: '{ user { name email } }' }),
    });
    const d = await r.json().catch(() => ({}));
    if (d.data?.user?.email) return { verified: true, message: `Connected as ${d.data.user.email}` };
    return { verified: false, message: d.errors?.[0]?.message || 'Invalid Fireflies API key' };
  }

  if (name === 'fathom') {
    const r = await fetch('https://api.fathom.ai/external/v1/meetings?limit=1', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (r.ok) return { verified: true, message: 'Connected to Fathom' };
    return { verified: false, message: `Fathom returned ${r.status} — check your API key` };
  }

  if (name === 'cal_com') {
    const r = await fetch('https://api.cal.com/v2/me', {
      headers: {
        Authorization:     `Bearer ${apiKey}`,
        'cal-api-version': CAL_COM_API_VERSION,
      },
    });
    if (r.ok) {
      const d = await r.json().catch(() => ({}));
      const me = d.data || d;
      const who = me.email || me.username || me.name || 'Cal.com user';
      return { verified: true, message: `Connected as ${who}` };
    }
    return { verified: false, message: `Cal.com returned ${r.status} — check your API key` };
  }

  return { verified: false, message: 'Unknown provider' };
}

// POST /api/workflow-providers/:name/test  (apollo, instantly, lemlist, prospeo, signalbase)
workflowProvidersRouter.post('/:name/test', verifySupabaseAuth, async (req, res) => {
  const { name } = req.params;
  if (!NAMED_PROVIDERS.includes(name)) return res.status(404).json({ error: 'not_found' });
  try {
    const { api_key } = req.body;
    const result = await testNamedProvider(name, api_key);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ verified: false, message: err.message || 'internal_error' });
  }
});

// POST /api/workflow-providers/:name/connect  (apollo, instantly, lemlist, prospeo, signalbase)
workflowProvidersRouter.post('/:name/connect', verifySupabaseAuth, async (req, res) => {
  const { name } = req.params;
  if (!NAMED_PROVIDERS.includes(name)) return res.status(404).json({ error: 'not_found' });
  try {
    const supabase = getSupabaseClient();
    const { workspace_id, name: connName, api_key } = req.body;
    if (!workspace_id || !api_key) return res.status(400).json({ error: 'workspace_id and api_key required' });

    const { data: provider } = await supabase
      .from('workflow_providers')
      .select('id')
      .eq('name', name)
      .maybeSingle();
    if (!provider?.id) return res.status(404).json({ error: `provider_not_found: ${name}` });

    const encryptValue = (v) => {
      if (!ENCRYPTION_KEY || !v) return v;
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
      return iv.toString('hex') + ':' + cipher.update(v, 'utf8', 'hex') + cipher.final('hex');
    };

    const credentials = { api_key: encryptValue(api_key) };

    // For Calendly, also register a webhook subscription so events fire into
    // our worker at /inbound/calendly/:workspaceId. Store the subscription URI
    // (so we can unsubscribe on delete) and the signing key (encrypted, used
    // by the worker to verify Calendly-Webhook-Signature on every inbound).
    //
    // Calendly gates this API to paid tiers (Standard+). Free accounts get
    // 403 — we still save the connection so backfill scans work; the user
    // just won't get realtime booking notifications.
    let webhookNote = null;
    if (name === 'calendly') {
      const sub = await subscribeCalendlyWebhook(api_key, workspace_id);
      if (sub.error) {
        console.error('[CALENDLY_CONNECT] subscribe failed:', sub.error, sub.detail || sub.message);
        const planGated = sub.detail?.message?.toLowerCase().includes('upgrade')
          || sub.error?.includes('403');
        webhookNote = planGated
          ? 'Connected. Note: Calendly webhook subscriptions require a Standard plan or higher — realtime booking notifications are disabled, but past meetings still backfill on CSV import.'
          : `Connected, but webhook subscription failed: ${sub.detail?.message || sub.message || sub.error}`;
      } else {
        credentials.webhook_subscription_uri = sub.subscription_uri;
        credentials.webhook_signing_key      = encryptValue(sub.signing_key);
      }
    }

    // Cal.com — same auto-subscribe pattern. webhook_id (string) is what we
    // pass to DELETE /v2/webhooks/<id> on cleanup.
    if (name === 'cal_com') {
      const sub = await subscribeCalComWebhook(api_key, workspace_id);
      if (sub.error) {
        console.error('[CAL_COM_CONNECT] subscribe failed:', sub.error, sub.detail || sub.message);
        webhookNote = `Connected, but webhook subscription failed: ${sub.detail?.message || sub.message || sub.error}`;
      } else {
        credentials.webhook_id          = sub.webhook_id;
        credentials.webhook_signing_key = encryptValue(sub.signing_key);
      }
    }

    // HeyReach — register N webhooks (one per event type) and store their ids.
    // No signing secret in the HeyReach API, so we use the workspace-scoped URL
    // and rely on the optional HEYREACH_WEBHOOK_SECRET shared-secret check in
    // the worker for extra protection.
    if (name === 'heyreach') {
      const sub = await subscribeHeyReachWebhooks(api_key, workspace_id);
      if (sub.error) {
        console.error('[HEYREACH_CONNECT] subscribe failed:', sub.error, sub.detail || sub.message);
        webhookNote = `Connected, but webhook subscription failed: ${sub.detail || sub.message || sub.error}`;
      } else {
        credentials.webhook_ids = sub.webhook_ids;   // JSON-serialized array on save below
      }
    }

    // Lemlist — single webhook covers every event (Lemlist's `type` field is
    // optional on POST /api/hooks). We generate a per-workspace secret and
    // store it encrypted; Lemlist echoes it back in body.secret on every
    // delivery for the worker to verify.
    if (name === 'lemlist') {
      const sub = await subscribeLemlistWebhook(api_key, workspace_id);
      if (sub.error) {
        console.error('[LEMLIST_CONNECT] subscribe failed:', sub.error, sub.detail || sub.message);
        webhookNote = `Connected, but webhook subscription failed: ${sub.detail || sub.message || sub.error}`;
      } else {
        credentials.webhook_id     = sub.webhook_id;
        credentials.webhook_secret = encryptValue(sub.webhook_secret);
      }
    }

    // Upsert (not insert) — re-saving the same provider name updates instead
    // of failing with a unique-constraint violation.
    const { data, error } = await supabase
      .from('workflow_provider_connections')
      .upsert({
        workspace_id,
        provider_id: provider.id,
        name: connName || name,
        encrypted_credentials: credentials,
        created_by: req.internalUserId,
        is_verified: true,
        last_test_at: new Date().toISOString(),
      }, { onConflict: 'workspace_id,provider_id,name' })
      .select('id, workspace_id, provider_id, name, created_at, is_verified')
      .single();

    if (error) throw error;
    return res.json({ connection: data, note: webhookNote });
  } catch (err) {
    console.error(`[POST /:name/connect ${req.params.name}]`, err.message, err.code);
    return res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// GET /api/workflow-providers/:id
workflowProvidersRouter.get('/:id', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { id } = req.params;
    const { data, error } = await supabase.from('workflow_providers').select('*').eq('id', id).single();
    if (error) return res.status(404).json({ error: 'not_found' });
    return res.json({ provider: data });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

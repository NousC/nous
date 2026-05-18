import { Router } from 'express';
import { getSupabaseClient } from '@proply/core';
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
      const webhook_registered = !!conn.encrypted_credentials?.webhook_subscription_uri;
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
    const { workspace_id, provider_id, name, credentials } = req.body;
    if (!workspace_id || !provider_id) return res.status(400).json({ error: 'workspace_id and provider_id required' });

    const encrypted_credentials = {};
    if (credentials && ENCRYPTION_KEY) {
      for (const [key, val] of Object.entries(credentials)) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        encrypted_credentials[key] = iv.toString('hex') + ':' + cipher.update(String(val), 'utf8', 'hex') + cipher.final('hex');
      }
    }

    const { data, error } = await supabase
      .from('workflow_provider_connections')
      .insert({ workspace_id, provider_id, name: name || 'Connection', encrypted_credentials, created_by: req.internalUserId, is_verified: false })
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
      const port     = parseInt(credentials.port || '587');
      const username = credentials.username;
      const password = credentials.password;
      if (!host || !username || !password) {
        return { verified: false, message: 'host, username, and password are required' };
      }
      const { default: nodemailer } = await import('nodemailer');
      const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user: username, pass: password } });
      await transporter.verify();
      return { verified: true, message: `SMTP connected (${username} via ${host})` };
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
const NAMED_PROVIDERS = ['apollo', 'instantly', 'lemlist', 'prospeo', 'hubspot', 'pipedrive', 'attio', 'calendly', 'fireflies', 'fathom'];

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
    if (name === 'calendly') {
      const sub = await subscribeCalendlyWebhook(api_key, workspace_id);
      if (sub.error) {
        console.error('[CALENDLY_CONNECT] subscribe failed:', sub.error, sub.detail || sub.message);
      } else {
        credentials.webhook_subscription_uri = sub.subscription_uri;
        credentials.webhook_signing_key      = encryptValue(sub.signing_key);
      }
    }

    const { data, error } = await supabase
      .from('workflow_provider_connections')
      .insert({
        workspace_id,
        provider_id: provider.id,
        name: connName || name,
        encrypted_credentials: credentials,
        created_by: req.internalUserId,
        is_verified: true,
        last_test_at: new Date().toISOString(),
      })
      .select('id, workspace_id, provider_id, name, created_at, is_verified')
      .single();

    if (error) throw error;
    return res.json({ connection: data });
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

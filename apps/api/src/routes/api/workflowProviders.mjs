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
  if (!ENCRYPTION_KEY || !encryptedValue || typeof encryptedValue !== 'string') return null;
  const parts = encryptedValue.split(':');
  try {
    if (parts.length === 2 && /^[0-9a-f]{32}$/i.test(parts[0])) {
      // AES-256-CBC: iv(16B=32hex):data
      const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, Buffer.from(parts[0], 'hex'));
      return decipher.update(parts[1], 'hex', 'utf8') + decipher.final('utf8');
    }
    if (parts.length === 3 && /^[0-9a-f]{32}$/i.test(parts[0]) && /^[0-9a-f]{32}$/i.test(parts[2])) {
      // Old AES-256-GCM (api/utils/encryption.js): iv(16B=32hex):data:tag(16B=32hex)
      const [ivHex, dataHex, tagHex] = parts;
      const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      return decipher.update(dataHex, 'hex', 'utf8') + decipher.final('utf8');
    }
    return null;
  } catch { return null; }
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
      const { encrypted_credentials: _, ...rest } = conn;
      return { ...rest, credential_hints: hints };
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
      .insert({ workspace_id, provider_id, name: name || 'Connection', encrypted_credentials, is_verified: false })
      .select('id, workspace_id, provider_id, name, created_at, is_verified')
      .single();

    if (error) throw error;
    return res.json({ connection: data });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
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

const NAMED_PROVIDERS = ['apollo', 'instantly', 'lemlist', 'prospeo', 'signalbase'];

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

  if (name === 'signalbase') {
    const r = await fetch('https://api.signalbase.io/v1/account', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (r.ok) return { verified: true, message: 'Connected to SignalBase' };
    return { verified: false, message: `SignalBase returned ${r.status} — check your API key` };
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

    const encryptedKey = (() => {
      if (!ENCRYPTION_KEY) return api_key;
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
      return iv.toString('hex') + ':' + cipher.update(api_key, 'utf8', 'hex') + cipher.final('hex');
    })();

    const { data, error } = await supabase
      .from('workflow_provider_connections')
      .insert({
        workspace_id,
        provider_id: provider.id,
        name: connName || name,
        encrypted_credentials: { api_key: encryptedKey },
        is_verified: true,
        last_test_at: new Date().toISOString(),
      })
      .select('id, workspace_id, provider_id, name, created_at, is_verified')
      .single();

    if (error) throw error;
    return res.json({ connection: data });
  } catch (err) {
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

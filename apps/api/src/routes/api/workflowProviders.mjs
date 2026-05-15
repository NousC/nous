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
  if (!ENCRYPTION_KEY || !encryptedValue) return null;
  try {
    const [ivHex, encrypted] = encryptedValue.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
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
    const { enabled } = req.body;

    const { data: existing } = await supabase.from('workflow_provider_connections').select('encrypted_credentials').eq('id', id).single();
    if (!existing) return res.status(404).json({ error: 'not_found' });

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

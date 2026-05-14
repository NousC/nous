import { Router } from 'express';
import { getSupabaseClient, logActivity } from '@proply/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';
import crypto from 'crypto';

export const crmRouter = Router();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  ? Buffer.from(process.env.ENCRYPTION_KEY.slice(0, 64).padEnd(64, '0'), 'hex')
  : null;

function decryptCred(encryptedValue) {
  if (!ENCRYPTION_KEY || !encryptedValue) return null;
  try {
    const [ivHex, encrypted] = encryptedValue.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
  } catch { return null; }
}

async function fetchHubSpotRecords(accessToken, type, search) {
  const obj = type === 'contact' ? 'contacts' : type === 'company' ? 'companies' : 'deals';
  const propsMap = {
    contacts: 'firstname,lastname,email,company,phone,hubspot_owner_id',
    companies: 'name,domain,industry,city,country,phone',
    deals: 'dealname,amount,dealstage,closedate,pipeline,hubspot_owner_id',
  };
  const params = new URLSearchParams({ limit: '100', properties: propsMap[obj] });
  if (search) params.set('query', search);
  const endpoint = search
    ? `https://api.hubapi.com/crm/v3/objects/${obj}/search`
    : `https://api.hubapi.com/crm/v3/objects/${obj}?${params}`;

  const res = search
    ? await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: search, limit: 100, properties: propsMap[obj].split(',') }) })
    : await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });

  if (!res.ok) throw new Error(`HubSpot ${res.status}`);
  const d = await res.json();
  return (d.results || []).map(r => {
    const p = r.properties || {};
    if (type === 'contact') return { id: r.id, name: [p.firstname, p.lastname].filter(Boolean).join(' ') || '(No name)', email: p.email, company: p.company, ownerName: p.hubspot_owner_id || null };
    if (type === 'company') return { id: r.id, name: p.name || '(No name)', domain: p.domain, industry: p.industry, city: p.city, country: p.country };
    return { id: r.id, name: p.dealname || '(No name)', dealValue: p.amount ? parseFloat(p.amount) : null, dealCurrency: '$', dealStage: p.dealstage, ownerName: p.hubspot_owner_id || null };
  });
}

async function fetchPipedriveRecords(apiToken, type, search) {
  const endpoint = type === 'contact' ? 'persons' : type === 'company' ? 'organizations' : 'deals';
  const params = new URLSearchParams({ api_token: apiToken, limit: '100', ...(search ? { term: search } : {}) });
  const base = search
    ? `https://api.pipedrive.com/v1/${endpoint}/search?${params}`
    : `https://api.pipedrive.com/v1/${endpoint}?${params}`;
  const res = await fetch(base);
  if (!res.ok) throw new Error(`Pipedrive ${res.status}`);
  const d = await res.json();
  const items = search ? (d.data?.items || []).map(i => i.item) : (d.data || []);
  return items.map(r => {
    if (type === 'contact') return { id: String(r.id), name: r.name || '(No name)', email: r.email?.[0]?.value || r.primary_email || null, company: r.org_name || r.organization?.name || null, ownerName: r.owner_name || null };
    if (type === 'company') return { id: String(r.id), name: r.name || '(No name)', domain: r.cc_email || null, industry: null, city: r.address_city || null, country: r.address_country || null };
    return { id: String(r.id), name: r.title || '(No name)', dealValue: r.value || null, dealCurrency: r.currency || '$', dealStage: r.stage_name || r.stage?.name || null, ownerName: r.owner_name || null };
  });
}

async function fetchAttioRecords(apiKey, type, search) {
  const obj = type === 'contact' ? 'people' : type === 'company' ? 'companies' : 'deals';
  const body = { limit: 100, ...(search ? { filter: { any: [{ name: { $contains: search } }] } } : {}) };
  const res = await fetch(`https://api.attio.com/v2/objects/${obj}/records/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Attio ${res.status}`);
  const d = await res.json();
  return (d.data || []).map(r => {
    const v = (field) => r.values?.[field]?.[0]?.value ?? r.values?.[field]?.[0]?.target?.record?.record_id ?? null;
    const str = (field) => { const val = r.values?.[field]?.[0]; return val?.value || val?.first_name || null; };
    if (type === 'contact') {
      const first = r.values?.name?.[0]?.first_name || '';
      const last = r.values?.name?.[0]?.last_name || '';
      return { id: r.id?.record_id || r.id, name: [first, last].filter(Boolean).join(' ') || '(No name)', email: r.values?.email_addresses?.[0]?.email_address || null, company: r.values?.primary_affiliation?.[0]?.target?.record?.record_id || null, ownerName: null };
    }
    if (type === 'company') return { id: r.id?.record_id || r.id, name: r.values?.name?.[0]?.value || '(No name)', domain: r.values?.domains?.[0]?.domain || null, industry: r.values?.categories?.[0]?.value || null, city: null, country: null };
    return { id: r.id?.record_id || r.id, name: r.values?.name?.[0]?.value || '(No name)', dealValue: r.values?.value?.[0]?.value?.amount || null, dealCurrency: r.values?.value?.[0]?.value?.currency_code || '$', dealStage: r.values?.stage?.[0]?.value || null, ownerName: null };
  });
}

// ── Import helpers ────────────────────────────────────────────────────────────

async function fetchDealContactEmails(provider, creds, dealId) {
  const token = creds.access_token || creds.api_key || creds.api_token || Object.values(creds).find(Boolean);
  if (!token) return [];

  if (provider === 'hubspot') {
    const assocRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/deals/${dealId}/associations/contacts`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!assocRes.ok) return [];
    const assocData = await assocRes.json();
    const contactIds = (assocData.results || []).map(r => r.id).slice(0, 5);
    const emails = [];
    for (const cid of contactIds) {
      const r = await fetch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${cid}?properties=email,firstname,lastname`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) continue;
      const c = await r.json();
      const p = c.properties || {};
      if (p.email) emails.push({ email: p.email, name: [p.firstname, p.lastname].filter(Boolean).join(' ') });
    }
    return emails;
  }

  if (provider === 'pipedrive') {
    const r = await fetch(`https://api.pipedrive.com/v1/deals/${dealId}/persons?api_token=${token}`);
    if (!r.ok) return [];
    const d = await r.json();
    return (d.data || []).flatMap(p => {
      const email = p.email?.find(e => e.primary)?.value || p.email?.[0]?.value;
      return email ? [{ email, name: p.name || '' }] : [];
    });
  }

  return [];
}

async function upsertContactForImport(supabase, workspaceId, provider, { email, name, company }) {
  if (!email) return null;
  const normalizedEmail = email.toLowerCase().trim();
  const nameParts = (name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || null;
  const lastName = nameParts.slice(1).join(' ') || null;

  const { data: existing } = await supabase
    .from('contacts')
    .select('id, company_id')
    .eq('workspace_id', workspaceId)
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existing) return existing;

  const { data: created, error } = await supabase
    .from('contacts')
    .insert({
      workspace_id: workspaceId,
      email: normalizedEmail,
      first_name: firstName,
      last_name: lastName,
      company: company || null,
      source: provider,
      pipeline_stage: 'identified',
    })
    .select('id, company_id')
    .single();

  if (error) throw error;
  return created;
}

// GET /api/crm/sync-config
crmRouter.get('/sync-config', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { workspaceId, provider } = req.query;
    if (!workspaceId || !provider) return res.status(400).json({ error: 'workspaceId and provider required' });
    const { data } = await supabase.from('crm_sync_configs').select('*').eq('workspace_id', workspaceId).eq('provider', provider).maybeSingle();
    return res.json({ config: data || null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/sync-config
crmRouter.post('/sync-config', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { workspaceId, connectionId, provider, autoSync } = req.body;
    if (!workspaceId || !connectionId || !provider) return res.status(400).json({ error: 'missing fields' });
    const { data, error } = await supabase.from('crm_sync_configs').upsert({
      workspace_id: workspaceId, connection_id: connectionId, provider, auto_sync: autoSync === true, updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,provider' }).select().single();
    if (error) throw error;
    return res.json({ ok: true, config: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/crm/sync-now
crmRouter.post('/sync-now', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { workspaceId, provider = 'hubspot' } = req.body;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });

    const { data: cfg } = await supabase.from('crm_sync_configs').select('*').eq('workspace_id', workspaceId).eq('provider', provider).maybeSingle();
    if (!cfg) return res.status(404).json({ error: 'Sync not configured' });

    const { data: conn } = await supabase.from('workflow_provider_connections').select('encrypted_credentials').eq('id', cfg.connection_id).single();
    if (!conn) return res.status(404).json({ error: 'Connection not found' });

    // Return acknowledgement — actual sync runs async in the worker
    return res.json({ ok: true, message: 'Sync triggered' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/crm/records
crmRouter.get('/records', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { provider, type, connectionId, workspaceId, search } = req.query;
    if (!provider || !type || !connectionId || !workspaceId) return res.status(400).json({ error: 'provider, type, connectionId, workspaceId required' });

    const { data: connection } = await supabase.from('workflow_provider_connections').select('encrypted_credentials').eq('id', connectionId).eq('workspace_id', workspaceId).single();
    if (!connection) return res.status(404).json({ error: 'connection_not_found' });

    const creds = {};
    for (const [k, v] of Object.entries(connection.encrypted_credentials || {})) {
      creds[k] = decryptCred(v);
    }

    const firstCred = Object.values(creds).find(Boolean);

    let records = [];
    if (provider === 'hubspot') {
      const token = creds.access_token || creds.api_key || firstCred;
      if (!token) return res.status(400).json({ error: 'missing_credentials' });
      records = await fetchHubSpotRecords(token, type, search);
    } else if (provider === 'pipedrive') {
      const token = creds.api_token || creds.api_key || firstCred;
      if (!token) return res.status(400).json({ error: 'missing_credentials' });
      records = await fetchPipedriveRecords(token, type, search);
    } else if (provider === 'attio') {
      const token = creds.api_key || creds.access_token || firstCred;
      if (!token) return res.status(400).json({ error: 'missing_credentials' });
      records = await fetchAttioRecords(token, type, search);
    }

    return res.json({ records });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/crm/import — import selected records into Proply contacts + log deal signals
crmRouter.post('/import', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { workspaceId, provider, connectionId, records } = req.body;
    if (!workspaceId || !provider || !connectionId || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'workspaceId, provider, connectionId, and records required' });
    }

    const { data: connection } = await supabase
      .from('workflow_provider_connections')
      .select('encrypted_credentials')
      .eq('id', connectionId)
      .eq('workspace_id', workspaceId)
      .single();
    if (!connection) return res.status(404).json({ error: 'connection_not_found' });

    const creds = {};
    for (const [k, v] of Object.entries(connection.encrypted_credentials || {})) {
      creds[k] = decryptCred(v);
    }

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (const record of records) {
      try {
        if (record.type === 'contact') {
          const contact = await upsertContactForImport(supabase, workspaceId, provider, {
            email: record.email,
            name: record.name,
            company: record.company,
          });
          if (contact) imported++; else skipped++;

        } else if (record.type === 'company') {
          if (!record.name?.trim()) { skipped++; continue; }
          const { data: existing } = await supabase.from('companies').select('id').eq('workspace_id', workspaceId).ilike('name', record.name.trim()).maybeSingle();
          if (!existing) {
            await supabase.from('companies').insert({ workspace_id: workspaceId, name: record.name.trim(), domain: record.domain || null });
          }
          imported++;

        } else if (record.type === 'deal') {
          const contacts = await fetchDealContactEmails(provider, creds, record.id);
          if (contacts.length === 0) { skipped++; continue; }
          const isWon = /won|closed[\s-]?won/i.test(record.dealStage || '');
          for (const { email, name } of contacts) {
            const contact = await upsertContactForImport(supabase, workspaceId, provider, { email, name });
            if (!contact) continue;
            await logActivity(supabase, {
              workspaceId,
              contactId: contact.id,
              companyId: contact.company_id || null,
              type: isWon ? 'deal_won' : 'deal_created',
              source: provider,
              externalId: `${provider}_deal_${record.id}`,
              occurredAt: new Date().toISOString(),
              description: record.name || 'CRM deal',
              rawData: { deal_name: record.name, deal_value: record.dealValue, deal_stage: record.dealStage },
            });
          }
          imported++;
        }
      } catch (err) {
        errors.push({ id: record.id, error: err.message });
      }
    }

    return res.json({ imported, skipped, errors });
  } catch (err) {
    console.error('[POST /api/crm/import]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

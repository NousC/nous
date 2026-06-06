// Push leads from a Nous list into an outbound sequencer's campaign.
// Supports Instantly + Lemlist (email) and HeyReach (LinkedIn). Each provider's
// add-lead shape differs; listCampaigns/pushLeads fan out per provider.
import { decrypt } from '../utils/encryption.js';

export const SEQUENCERS = ['instantly', 'heyreach', 'lemlist'];

// Email providers push by email; LinkedIn providers push by profile URL. Drives
// which leads are skipped and the "no email / no LinkedIn" copy in the UI.
export const SEQUENCER_KIND = { instantly: 'email', lemlist: 'email', heyreach: 'linkedin' };

// Decrypted API key for a connected, verified provider (null if not connected).
async function getProviderApiKey(supabase, workspaceId, providerName) {
  const { data: provider } = await supabase
    .from('workflow_providers').select('id').eq('name', providerName).maybeSingle();
  if (!provider?.id) return null;
  const { data } = await supabase
    .from('workflow_provider_connections').select('encrypted_credentials')
    .eq('workspace_id', workspaceId).eq('provider_id', provider.id).eq('is_verified', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data?.encrypted_credentials?.api_key) return null;
  try { return decrypt(data.encrypted_credentials.api_key); } catch { return null; }
}

async function httpJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 180)}`);
  return body;
}

// ── Instantly v2 (Bearer) ───────────────────────────────────────────────────
const instantly = (key, path, opts = {}) => httpJson(`https://api.instantly.ai${path}`, {
  ...opts, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
});

// ── HeyReach (X-API-KEY) ────────────────────────────────────────────────────
const heyreach = (key, path, opts = {}) => httpJson(`https://api.heyreach.io/api/public${path}`, {
  ...opts, headers: { 'X-API-KEY': key, 'Content-Type': 'application/json', ...(opts.headers || {}) },
});

// ── Lemlist (HTTP Basic, key as password) ───────────────────────────────────
const lemlist = (key, path, opts = {}) => httpJson(`https://api.lemlist.com/api${path}`, {
  ...opts, headers: { Authorization: `Basic ${Buffer.from(`:${key}`).toString('base64')}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
});

// List campaigns for the picker. Returns { connected, campaigns: [{id, name, status}] }.
export async function listCampaigns(supabase, workspaceId, provider) {
  const key = await getProviderApiKey(supabase, workspaceId, provider);
  if (!key) return { connected: false, campaigns: [] };
  try {
    if (provider === 'instantly') {
      const d = await instantly(key, '/api/v2/campaigns?limit=100');
      const items = d?.items || d?.data || (Array.isArray(d) ? d : []);
      return { connected: true, campaigns: items.map(c => ({ id: c.id, name: c.name, status: c.status })) };
    }
    if (provider === 'heyreach') {
      const d = await heyreach(key, '/campaign/GetAll', { method: 'POST', body: JSON.stringify({ offset: 0, limit: 100 }) });
      const items = d?.items || (Array.isArray(d) ? d : []);
      return { connected: true, campaigns: items.map(c => ({ id: String(c.id), name: c.name, status: c.status })) };
    }
    if (provider === 'lemlist') {
      const d = await lemlist(key, '/campaigns?limit=100');
      const items = d?.campaigns || (Array.isArray(d) ? d : []);
      return { connected: true, campaigns: items.map(c => ({ id: c._id || c.id, name: c.name, status: c.status })) };
    }
  } catch (e) {
    // Connected but the list call failed (bad key, provider down) — surface as not connected.
    console.warn(`[SEQ_PUSH] ${provider} listCampaigns failed`, e.message);
    return { connected: false, campaigns: [] };
  }
  return { connected: false, campaigns: [] };
}

// Push leads (each: {email, linkedin_url, first_name, last_name, company}) into a campaign.
export async function pushLeads(supabase, workspaceId, provider, campaignId, leads) {
  const key = await getProviderApiKey(supabase, workspaceId, provider);
  if (!key) return { ok: false, error: 'not_connected', pushed: 0, skipped: 0 };
  let pushed = 0, skipped = 0;

  if (provider === 'instantly') {
    for (const l of leads) {
      if (!l.email) { skipped++; continue; }
      try {
        await instantly(key, '/api/v2/leads/add', { method: 'POST', body: JSON.stringify({
          campaign_id: campaignId, email: l.email,
          first_name: l.first_name || undefined, last_name: l.last_name || undefined, company_name: l.company || undefined,
        }) });
        pushed++;
      } catch (e) { console.warn('[SEQ_PUSH] instantly add failed', l.email, e.message); skipped++; }
    }
    return { ok: true, pushed, skipped };
  }

  if (provider === 'lemlist') {
    // One POST per lead, email in the path: /campaigns/:id/leads/:email.
    for (const l of leads) {
      if (!l.email) { skipped++; continue; }
      try {
        await lemlist(key, `/campaigns/${campaignId}/leads/${encodeURIComponent(l.email)}`, { method: 'POST', body: JSON.stringify({
          firstName: l.first_name || undefined, lastName: l.last_name || undefined, companyName: l.company || undefined,
        }) });
        pushed++;
      } catch (e) { console.warn('[SEQ_PUSH] lemlist add failed', l.email, e.message); skipped++; }
    }
    return { ok: true, pushed, skipped };
  }

  if (provider === 'heyreach') {
    // LinkedIn campaign — leads need a profile URL; senders auto-assign from the
    // campaign. Batched into one AddLeadsToCampaignV2 call.
    const pairs = leads
      .filter(l => l.linkedin_url)
      .map(l => ({ lead: {
        profileUrl: l.linkedin_url,
        firstName: l.first_name || undefined, lastName: l.last_name || undefined, companyName: l.company || undefined,
      } }));
    skipped = leads.length - pairs.length;
    if (pairs.length) {
      try {
        await heyreach(key, '/campaign/AddLeadsToCampaignV2', { method: 'POST', body: JSON.stringify({
          campaignId: Number(campaignId), accountLeadPairs: pairs,
        }) });
        pushed = pairs.length;
      } catch (e) { console.warn('[SEQ_PUSH] heyreach add failed', e.message); return { ok: false, error: 'provider_error', message: e.message, pushed: 0, skipped: leads.length }; }
    }
    return { ok: true, pushed, skipped };
  }

  return { ok: false, error: 'unsupported_provider', pushed: 0, skipped: 0 };
}

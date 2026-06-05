// Push leads from a Nous list into an outbound sequencer's campaign.
// v1: Instantly (documented v2 API). HeyReach + Lemlist slot in behind the same
// shape once their exact add-lead bodies are confirmed.
import { decrypt } from '../utils/encryption.js';

export const SEQUENCERS = ['instantly'];

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

// ── Instantly v2 ──────────────────────────────────────────────────────────────
async function instantly(key, path, opts = {}) {
  const res = await fetch(`https://api.instantly.ai${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (!res.ok) throw new Error(`instantly ${res.status} ${text.slice(0, 180)}`);
  return body;
}

// List campaigns for the picker. Returns [{id, name, status}].
export async function listCampaigns(supabase, workspaceId, provider) {
  const key = await getProviderApiKey(supabase, workspaceId, provider);
  if (!key) return { connected: false, campaigns: [] };
  if (provider === 'instantly') {
    const d = await instantly(key, '/api/v2/campaigns?limit=100');
    const items = d?.items || d?.data || (Array.isArray(d) ? d : []);
    return { connected: true, campaigns: items.map(c => ({ id: c.id, name: c.name, status: c.status })) };
  }
  return { connected: false, campaigns: [] };
}

// Push leads (each: {email, first_name, last_name, company}) into a campaign.
export async function pushLeads(supabase, workspaceId, provider, campaignId, leads) {
  const key = await getProviderApiKey(supabase, workspaceId, provider);
  if (!key) return { ok: false, error: 'not_connected', pushed: 0, skipped: 0 };
  let pushed = 0, skipped = 0;
  if (provider === 'instantly') {
    // Documented body is flat per lead (campaign_id + email + names + company_name).
    for (const l of leads) {
      if (!l.email) { skipped++; continue; }
      try {
        await instantly(key, '/api/v2/leads/add', {
          method: 'POST',
          body: JSON.stringify({
            campaign_id: campaignId, email: l.email,
            first_name: l.first_name || undefined, last_name: l.last_name || undefined,
            company_name: l.company || undefined,
          }),
        });
        pushed++;
      } catch (e) { console.warn('[SEQ_PUSH] instantly add failed', l.email, e.message); skipped++; }
    }
  }
  return { ok: true, pushed, skipped };
}

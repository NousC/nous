// Contact enrichment + ICP scoring — fires after new contact creation.
// Priority: Apollo BYOK (if enabled) → Prospeo BYOK → built-in Prospeo key.
// scoreICP runs after every successful enrichment.

import Anthropic, { setUser } from 'useleak';
import { listNotes } from '@nous/core';
import { logActivity } from './activity.mjs';
import { upsertCompany } from './resolveContact.mjs';
import { decrypt } from './encryption.mjs';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function logSysEvent(supabase, workspaceId, source, eventType, summary, contactId, metadata) {
  try {
    await supabase.from('workspace_system_log').insert({
      workspace_id: workspaceId, source, event_type: eventType,
      summary: summary || null, contact_id: contactId || null,
      metadata: metadata || {}, occurred_at: new Date().toISOString(),
    });
  } catch { /* non-critical */ }
}

async function getProviderKey(supabase, workspaceId, providerName, requireEnrichmentToggle = false) {
  const { data: provider } = await supabase.from('workflow_providers')
    .select('id').eq('name', providerName).maybeSingle();
  if (!provider?.id) return null;

  const { data } = await supabase.from('workflow_provider_connections')
    .select('encrypted_credentials')
    .eq('workspace_id', workspaceId).eq('provider_id', provider.id).eq('is_verified', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data?.encrypted_credentials) return null;
  if (requireEnrichmentToggle && !data.encrypted_credentials.use_for_enrichment) return null;

  try { return decrypt(data.encrypted_credentials.api_key) || null; } catch { return null; }
}

// ── ICP scoring ───────────────────────────────────────────────────────────────

export async function scoreICP(supabase, workspaceId, contact) {
  setUser({ id: String(workspaceId) });
  const profileLines = [
    contact.job_title  && `Title: ${contact.job_title}`,
    contact.seniority  && `Seniority: ${contact.seniority}`,
    contact.department && `Department: ${contact.department}`,
    contact.company    && `Company: ${contact.company}`,
  ].filter(Boolean);
  if (!profileLines.length) return;

  const memories = await listNotes(supabase, workspaceId, {
    categories: ['ICP', 'Market', 'Company', 'Product'],
    limit: 60,
  });

  const profile = profileLines.join('\n');
  const prompt = memories.length
    ? `Workspace ICP criteria:\n${memories.map(m => `[${m.category}] ${m.content}`).join('\n')}\n\nContact:\n${profile}\n\nScore 0-100 and give a one-sentence reason. JSON only: {"score":<int>,"fit":<bool>,"reasoning":"<sentence>"}`
    : `Contact:\n${profile}\n\nScore this B2B contact's ICP fit 0-100 based on role alone. C-suite/VP/Director=high(75-95), Manager/Senior=medium(45-70), IC/unknown=low(20-40). JSON only: {"score":<int>,"fit":<bool>,"reasoning":"<sentence>"}`;

  try {
    const msg = await anthropic.messages.create({
      feature: 'icp-score-on-enrich',
      model: 'claude-haiku-4-5-20251001', max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });
    const json = JSON.parse(msg.content[0].text.trim().match(/\{[\s\S]*\}/)?.[0] || '{}');
    if (typeof json.score !== 'number') return;

    const fitLabel = json.score >= 75 ? 'Strong fit' : json.score >= 50 ? 'Potential fit' : 'Weak fit';
    await supabase.from('contacts').update({
      icp_score:     json.score,
      icp_fit:       json.fit ?? json.score >= 70,
      icp_reasoning: json.reasoning,
      icp_scored_at: new Date().toISOString(),
    }).eq('id', contact.id);

    await logActivity(supabase, {
      workspaceId, contactId: contact.id, companyId: contact.company_id || null,
      type: 'icp_scored', source: 'system',
      externalId: `icp_${contact.id}_${new Date().toISOString().slice(0, 10)}`,
      occurredAt: new Date().toISOString(),
      description: `ICP score: ${json.score}/100 — ${fitLabel}`,
      summary: json.reasoning || null,
    }).catch(() => {});

    console.log(`[ICP_SCORE] contact=${contact.id} score=${json.score} fit=${json.fit} (${memories.length ? 'workspace criteria' : 'generic'})`);
  } catch (e) {
    console.warn('[ICP_SCORE] Failed:', e.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeSeniority(raw) {
  if (!raw) return null;
  const r = raw.toLowerCase();
  if (r.includes('c_suite') || r.includes('founder') || r.includes('owner') || r.includes('c-suite')) return 'c_suite';
  if (r.includes('vp') || r.includes('vice')) return 'vp';
  if (r.includes('director')) return 'director';
  if (r.includes('manager')) return 'manager';
  return 'ic';
}

function normalizeDepartment(raw) {
  if (!raw) return null;
  const r = raw.toLowerCase();
  if (r.includes('sales'))     return 'sales';
  if (r.includes('marketing')) return 'marketing';
  if (r.includes('engineering') || r.includes('product')) return 'engineering';
  if (r.includes('operations')) return 'ops';
  return raw;
}

// ── Apollo path ───────────────────────────────────────────────────────────────

async function enrichViaApollo(supabase, contact, apolloKey) {
  const workspaceId = contact.workspace_id;
  await supabase.from('contacts').update({ enrichment_status: 'queued' }).eq('id', contact.id);
  try {
    const res = await fetch('https://api.apollo.io/v1/people/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apolloKey },
      body: JSON.stringify({ email: contact.email, reveal_personal_emails: false, reveal_phone_number: false }),
    });
    if (!res.ok) throw new Error(`Apollo ${res.status}: ${await res.text().catch(() => '')}`);
    const body = await res.json();
    const person = body.person;
    if (!person) throw new Error('No person in Apollo response');

    const org = person.organization || {};
    const updates = {
      enrichment_status: 'complete', enriched_at: new Date().toISOString(), enrichment_source: 'apollo',
      apollo_raw:  person,
      apollo_id:   person.id             || contact.apollo_id,
      linkedin_url: person.linkedin_url  || contact.linkedin_url,
      job_title:   person.title          || contact.job_title,
      seniority:   normalizeSeniority(person.seniority),
      department:  normalizeDepartment(person.departments?.[0]),
      phone:       person.phone_numbers?.[0]?.raw_number || contact.phone,
      city:        person.city    || null,
      country:     person.country || null,
    };

    if (org.name || org.primary_domain) {
      const co = await upsertCompany(supabase, workspaceId, { name: org.name, domain: org.primary_domain });
      if (co) { updates.company_id = co.id; updates.company = org.name; }
    }

    await supabase.from('contacts').update(updates).eq('id', contact.id);
    await logActivity(supabase, {
      workspaceId, contactId: contact.id, companyId: updates.company_id || contact.company_id || null,
      type: 'enrichment_run', source: 'apollo',
      externalId: `apollo_enrich_${contact.id}`,
      occurredAt: new Date().toISOString(),
      description: 'Profile enriched via Apollo',
      summary: [updates.job_title, org.name].filter(Boolean).join(' at ') || null,
    }).catch(() => {});
    logSysEvent(supabase, workspaceId, 'apollo', 'enrichment_run',
      `Enriched: ${[person.name, updates.job_title, org.name].filter(Boolean).join(' · ')}`,
      contact.id, { status: 'success' }).catch(() => {});

    await scoreICP(supabase, workspaceId, { ...contact, ...updates });
  } catch (err) {
    console.error('[ENRICH_APOLLO]', contact.email, err.message);
    await supabase.from('contacts').update({ enrichment_status: 'failed' }).eq('id', contact.id);
    logSysEvent(supabase, workspaceId, 'apollo', 'enrichment_run',
      `Enrichment error: ${err.message}`, contact.id, { status: 'error' }).catch(() => {});
  }
}

// ── Prospeo path ──────────────────────────────────────────────────────────────

const FAKE_DOMAINS = /\.(import|csv|fake|test|example|placeholder|noemail)$/i;

async function enrichViaProspeo(supabase, contact, prospeoKey) {
  if (!prospeoKey) {
    await supabase.from('contacts').update({ enrichment_status: 'no_integration' }).eq('id', contact.id);
    return;
  }
  const workspaceId = contact.workspace_id;
  const realEmail = contact.email && !FAKE_DOMAINS.test(contact.email.split('@')[1] || '') ? contact.email : null;
  if (!realEmail && !contact.linkedin_url) {
    await supabase.from('contacts').update({ enrichment_status: 'not_found' }).eq('id', contact.id);
    return;
  }

  await supabase.from('contacts').update({ enrichment_status: 'queued' }).eq('id', contact.id);
  try {
    const reqData = {};
    if (realEmail)            reqData.email        = realEmail;
    if (contact.first_name)   reqData.first_name   = contact.first_name;
    if (contact.last_name)    reqData.last_name    = contact.last_name;
    if (contact.linkedin_url) reqData.linkedin_url = contact.linkedin_url;

    const res = await fetch('https://api.prospeo.io/enrich-person', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-KEY': prospeoKey },
      body: JSON.stringify({ data: reqData }),
    });
    const body = await res.json();

    if (body.error) {
      if (body.error_code === 'NO_MATCH') {
        await supabase.from('contacts').update({ enrichment_status: 'not_found' }).eq('id', contact.id);
        return;
      }
      throw new Error(`Prospeo ${body.error_code || res.status}`);
    }

    const person = body.person;
    if (!person) throw new Error('No person in Prospeo response');

    const currentJob = person.job_history?.find(j => j.current) || person.job_history?.[0];
    const updates = {
      enrichment_status: 'complete', enriched_at: new Date().toISOString(), enrichment_source: 'prospeo',
      apollo_raw:  person,
      apollo_id:   person.person_id      || contact.apollo_id,
      linkedin_url: person.linkedin_url  || contact.linkedin_url,
      job_title:   person.current_job_title || contact.job_title,
      seniority:   normalizeSeniority(currentJob?.seniority),
      department:  normalizeDepartment(currentJob?.departments?.[0]),
      phone:       person.mobile?.mobile || contact.phone,
      city:        person.location?.city    || null,
      country:     person.location?.country || null,
    };

    const co = body.company;
    if (co?.name || co?.website || co?.domain) {
      const rawDomain = co.domain || co.website?.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null;
      const company = await upsertCompany(supabase, workspaceId, { name: co.name, domain: rawDomain });
      if (company) { updates.company_id = company.id; updates.company = co.name; }
    }

    await supabase.from('contacts').update(updates).eq('id', contact.id);
    await logActivity(supabase, {
      workspaceId, contactId: contact.id, companyId: updates.company_id || contact.company_id || null,
      type: 'enrichment_run', source: 'prospeo',
      externalId: `prospeo_enrich_${contact.id}`,
      occurredAt: new Date().toISOString(),
      description: 'Profile enriched via Prospeo',
      summary: [updates.job_title, updates.company].filter(Boolean).join(' at ') || null,
    }).catch(() => {});
    logSysEvent(supabase, workspaceId, 'prospeo', 'enrichment_run',
      `Enriched: ${[[contact.first_name, contact.last_name].filter(Boolean).join(' '), updates.job_title, updates.company].filter(Boolean).join(' · ')}`,
      contact.id, { status: 'success' }).catch(() => {});

    await scoreICP(supabase, workspaceId, { ...contact, ...updates });
  } catch (err) {
    console.error('[ENRICH_PROSPEO]', contact.email, err.message);
    await supabase.from('contacts').update({ enrichment_status: 'failed' }).eq('id', contact.id);
    logSysEvent(supabase, workspaceId, 'prospeo', 'enrichment_run',
      `Enrichment error: ${err.message}`, contact.id, { status: 'error' }).catch(() => {});
  }
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

export async function enrichContact(supabase, contact) {
  if (!contact?.id || !contact?.workspace_id) return;
  if (!contact.email && !contact.linkedin_url) return;

  const apolloKey = await getProviderKey(supabase, contact.workspace_id, 'apollo', true);
  if (apolloKey) return enrichViaApollo(supabase, contact, apolloKey);

  const prospeoKey = await getProviderKey(supabase, contact.workspace_id, 'prospeo');
  return enrichViaProspeo(supabase, contact, prospeoKey || process.env.PROSPERO_API_KEY || null);
}

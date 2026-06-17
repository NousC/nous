// ============================================================
// Enrichment pipeline — Prospeo (default) or Apollo (user opt-in)
// Called on every new contact, and after any identity resolution
// ============================================================

import Anthropic from 'useleak';
import {
  logActivity, listSignals, scoreLead,
  listNotes,
  resolveEntity, getOrCreateEntity, identifiersFromContactData,
  recordEnrichmentObservations,
  companyDomainFromEmail, isFreeEmailDomain, isMemberUrnLinkedInUrl, upsertIdentifier,
} from '@nous/core';
import { decrypt } from '../utils/encryption.js';

// A LinkedIn "member URN" URL (/in/ACoAA…) is an encoded member id, not a
// resolvable public profile — external email-finders (Prospeo especially) choke
// on it and return nothing. Treat it as "no usable URL" so we fall back to
// name+domain matching instead of burning a lookup on a dead URL.
function usableLinkedInUrl(url) {
  return url && !isMemberUrnLinkedInUrl(url) ? url : null;
}

// Attribute fields written as observations with the TRUE enrichment source, and
// therefore stripped from the contacts-view update so the view trigger doesn't
// re-emit them tagged with the record's origin source (provenance erasure).
// linkedin_url stays on the update for identifier attachment.
// See docs/crm-hygiene-phase-1b-spec.md Task 0.
const ENRICH_STRIP = ['job_title', 'seniority', 'department', 'company', 'phone', 'city', 'country'];

async function logSysEvent(supabase, workspaceId, source, eventType, summary, contactId, metadata) {
  try {
    await supabase.from('workspace_system_log').insert({
      workspace_id: workspaceId, source, event_type: eventType,
      summary: summary || null, contact_id: contactId || null,
      metadata: metadata || {}, occurred_at: new Date().toISOString(),
    });
  } catch { /* non-critical */ }
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROSPEO_BASE = 'https://api.prospeo.io';

function prospeoHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-KEY': process.env.PROSPERO_API_KEY,
  };
}

// Returns the workspace's Apollo key only if connected AND toggled on for enrichment.
export async function getApolloEnrichmentKey(supabase, workspaceId) {
  return _getProviderKey(supabase, workspaceId, 'apollo', { requireEnrichmentToggle: true });
}

// Returns the workspace's Prospeo BYOK key if connected (always used for enrichment when present).
export async function getProspeoEnrichmentKey(supabase, workspaceId) {
  return _getProviderKey(supabase, workspaceId, 'prospeo', { requireEnrichmentToggle: false });
}

// Returns the workspace's SignalBase key if connected.
export async function getSignalBaseKey(supabase, workspaceId) {
  return _getProviderKey(supabase, workspaceId, 'signalbase', { requireEnrichmentToggle: false });
}

// Generic accessor for any workflow provider's decrypted API key (BYOK), used
// by sibling services (e.g. email verification) that follow the same
// connect-once-then-use pattern. No enrichment toggle by default.
export async function getProviderApiKey(supabase, workspaceId, providerName) {
  return _getProviderKey(supabase, workspaceId, providerName, { requireEnrichmentToggle: false });
}

async function _getProviderKey(supabase, workspaceId, providerName, { requireEnrichmentToggle }) {
  const { data: provider } = await supabase
    .from('workflow_providers')
    .select('id')
    .eq('name', providerName)
    .maybeSingle();

  if (!provider?.id) return null;

  const { data } = await supabase
    .from('workflow_provider_connections')
    .select('encrypted_credentials')
    .eq('workspace_id', workspaceId)
    .eq('provider_id', provider.id)
    .eq('is_verified', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.encrypted_credentials) return null;
  if (requireEnrichmentToggle && !data.encrypted_credentials.use_for_enrichment) return null;

  try {
    return decrypt(data.encrypted_credentials.api_key);
  } catch {
    return null;
  }
}

// ── Identity resolution ──────────────────────────────────────────────────────
// Waterfall: external_id → email → linkedin → name+domain → create new
// Returns { contact, created: bool }

// createIfMissing=true  → Level 1 (Instantly, RB2B, LinkedIn, CRM bootstrap) — creates new contacts
// createIfMissing=false → Level 2/3 (Gmail, Fireflies, Fathom, Calendly) — update only, never create
export async function resolveContact(supabase, workspaceId, data, { createIfMissing = true } = {}) {
  const {
    email, full_name, first_name, last_name, linkedin_url, company_domain,
    hubspot_id, pipedrive_id, apollo_id, rb2b_id, attio_id,
    job_title, phone, source,
    company_name,
  } = data;

  const identifiers = identifiersFromContactData({
    email, linkedin_url, hubspot_id, pipedrive_id, apollo_id, rb2b_id, attio_id,
  });

  // Step 1 — resolve via entity_identifiers; fetch the contact row by id
  // (entity.id == contact.id under the migration convention).
  for (const ident of identifiers) {
    const entityId = await resolveEntity(supabase, workspaceId, ident);
    if (!entityId) continue;
    const { data: match } = await supabase.from('contacts').select('*').eq('id', entityId).maybeSingle();
    if (match) return { contact: await mergeContact(supabase, match, data), created: false };
  }

  // Step 2 — name heal: contact with matching name but no email → patch in.
  // Names aren't v2 identifiers; this is a contacts-only fallback Phase 4 retires.
  if (email) {
    const name = full_name || [first_name, last_name].filter(Boolean).join(' ') || null;
    if (name) {
      const parts = name.trim().split(/\s+/);
      const fn = parts[0];
      const ln = parts.slice(1).join(' ');
      if (fn && ln) {
        const { data: nameMatches } = await supabase
          .from('contacts').select('*')
          .eq('workspace_id', workspaceId).is('email', null)
          .ilike('first_name', fn).ilike('last_name', ln);
        if (nameMatches?.length === 1) {
          const cleanEmail = email.toLowerCase().trim();
          await supabase.from('contacts').update({ email: cleanEmail }).eq('id', nameMatches[0].id);
          await supabase.from('entity_identifiers').insert({
            workspace_id: workspaceId, entity_id: nameMatches[0].id, kind: 'email', value: cleanEmail,
          }).then(() => {}, () => {});
          nameMatches[0].email = cleanEmail;
          console.log(`[IDENTITY] Name resolved "${name}" → ${cleanEmail} (entity ${nameMatches[0].id})`);
          return { contact: await mergeContact(supabase, nameMatches[0], data), created: false };
        }
      }
    }
  }

  // Step 3 — no match → create or reject
  if (!createIfMissing) return { contact: null, created: false };
  if (!email && !linkedin_url) {
    console.warn('[IDENTITY] Cannot create contact without email or linkedin_url, skipping');
    return { contact: null, created: false };
  }

  const name = full_name || [first_name, last_name].filter(Boolean).join(' ') || null;
  const explicitDomain = company_domain?.replace(/^www\./, '').toLowerCase().trim() || null;
  // Personal mailboxes (gmail.com, …) are not employers — keep them out of `domain`.
  const normalizedDomain = (explicitDomain && !isFreeEmailDomain(explicitDomain) ? explicitDomain : null)
    || companyDomainFromEmail(email);

  let companyId = null;
  if (company_name || normalizedDomain) {
    const company = await upsertCompany(supabase, workspaceId, {
      name:   company_name || null,
      domain: normalizedDomain,
    });
    companyId = company?.id || null;
  }

  // Create the v2 entity first; the contact row reuses its id.
  const entityId = await getOrCreateEntity(supabase, workspaceId, 'person', identifiers);

  const { data: created, error } = await supabase
    .from('contacts')
    .insert({
      id: entityId,
      workspace_id: workspaceId,
      email:        email ? email.toLowerCase().trim() : null,
      first_name:   first_name || name?.split(' ')[0] || null,
      last_name:    last_name  || name?.split(' ').slice(1).join(' ') || null,
      job_title, phone, linkedin_url,
      hubspot_id, pipedrive_id, apollo_id, rb2b_id, attio_id,
      company:      company_name || null,
      domain:       normalizedDomain,
      company_id:   companyId,
      source:       source || 'webhook',
      enrichment_status: 'queued',
      first_seen_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      // PK conflict — entity already had a contact row. Fetch + merge.
      const { data: existing } = await supabase.from('contacts').select('*').eq('id', entityId).maybeSingle();
      if (existing) return { contact: await mergeContact(supabase, existing, data), created: false };
    }
    console.error('[IDENTITY] Create contact error:', error);
    return { contact: null, created: false };
  }

  return { contact: created, created: true };
}


// ── Field-level merge ────────────────────────────────────────────────────────

async function mergeContact(supabase, existing, incoming) {
  const updates = {};

  const fill = (field, value) => {
    if (value != null && value !== '' && (existing[field] == null || existing[field] === '')) {
      updates[field] = value;
    }
  };

  fill('first_name',    incoming.first_name);
  fill('last_name',     incoming.last_name);
  fill('job_title',     incoming.job_title);
  fill('phone',         incoming.phone);
  fill('linkedin_url',  incoming.linkedin_url);
  fill('company',       incoming.company_name);
  fill('domain',        (() => {
                          const ed = incoming.company_domain?.replace(/^www\./, '').toLowerCase().trim() || null;
                          return (ed && !isFreeEmailDomain(ed) ? ed : null) || companyDomainFromEmail(incoming.email);
                        })());
  fill('hubspot_id',    incoming.hubspot_id);
  fill('pipedrive_id',  incoming.pipedrive_id);
  fill('apollo_id',     incoming.apollo_id);
  fill('rb2b_id',       incoming.rb2b_id);
  fill('attio_id',      incoming.attio_id);

  if (!existing.company_id && (incoming.company_name || updates.domain)) {
    upsertCompany(supabase, existing.workspace_id, {
      name:   incoming.company_name || null,
      domain: updates.domain || existing.domain,
    }).then(co => {
      if (co?.id) supabase.from('contacts').update({ company_id: co.id }).eq('id', existing.id).then(() => {});
    }).catch(() => {});
  }

  if (Object.keys(updates).length === 0) return existing;

  updates.updated_at = new Date().toISOString();
  const { data: updated } = await supabase
    .from('contacts')
    .update(updates)
    .eq('id', existing.id)
    .select('*')
    .single();

  return updated || existing;
}


// ── Contact enrichment dispatcher ────────────────────────────────────────────
// Priority: Apollo BYOK (if toggled on) → Prospeo BYOK → Nous's built-in Prospeo key

export async function enrichContact(supabase, contact, { apolloKey = undefined } = {}) {
  // Enrichable if we have an email, a USABLE LinkedIn URL, or a name + real
  // company domain (the Apollo name+domain path). A member-URN URL alone is not
  // usable, so it no longer counts as a reason to proceed.
  const hasNameDomain = !!(contact.first_name && contact.last_name && contact.domain);
  if (!contact.email && !usableLinkedInUrl(contact.linkedin_url) && !hasNameDomain) return;

  const apolloK = apolloKey !== undefined
    ? apolloKey
    : await getApolloEnrichmentKey(supabase, contact.workspace_id);
  if (apolloK) return enrichContactViaApollo(supabase, contact, apolloK);

  const prospeoK = await getProspeoEnrichmentKey(supabase, contact.workspace_id);
  return enrichContactViaProspeo(supabase, contact, prospeoK || process.env.PROSPERO_API_KEY);
}


// ── Apollo enrichment path ────────────────────────────────────────────────────

async function enrichContactViaApollo(supabase, contact, apolloKey) {
  await supabase.from('contacts').update({ enrichment_status: 'queued' }).eq('id', contact.id);

  try {
    // Apollo people/match takes any of email / linkedin_url / name + domain.
    // Pass everything we have so a lead with NO email but a real company domain
    // still matches on name+domain (Apollo is strong at this). A member-URN URL
    // is dropped so it never poisons the match.
    const match = { reveal_personal_emails: false, reveal_phone_number: false };
    const liUrl = usableLinkedInUrl(contact.linkedin_url);
    if (contact.email)      match.email             = contact.email;
    if (liUrl)              match.linkedin_url       = liUrl;
    if (contact.first_name) match.first_name         = contact.first_name;
    if (contact.last_name)  match.last_name          = contact.last_name;
    if (contact.domain)     match.domain             = contact.domain;
    if (contact.company)    match.organization_name  = contact.company;

    const canMatch = match.email || match.linkedin_url
      || (match.first_name && match.last_name && (match.domain || match.organization_name));
    if (!canMatch) {
      await supabase.from('contacts').update({ enrichment_status: 'not_found' }).eq('id', contact.id);
      return;
    }

    const res = await fetch('https://api.apollo.io/v1/people/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apolloKey },
      body: JSON.stringify(match),
    });

    if (!res.ok) throw new Error(`Apollo ${res.status}: ${await res.text().catch(() => '')}`);
    const body = await res.json();
    const person = body.person;
    if (!person) throw new Error('No person returned');

    const org = person.organization || {};
    const updates = {
      enrichment_status:  'complete',
      enriched_at:        new Date().toISOString(),
      enrichment_source:  'apollo',
      apollo_raw:         person,
      apollo_id:          person.id || contact.apollo_id,
      linkedin_url:       person.linkedin_url || contact.linkedin_url,
      job_title:          person.title        || contact.job_title,
      seniority:          normalizeSeniority(person.seniority),
      department:         normalizeDepartment(person.departments?.[0]),
      phone:              person.phone_numbers?.[0]?.raw_number || contact.phone,
      city:               person.city    || contact.city    || null,
      country:            person.country || contact.country || null,
    };

    if (org.name || org.primary_domain) {
      const company = await upsertCompany(supabase, contact.workspace_id, {
        name:           org.name,
        domain:         org.primary_domain,
        industry:       org.industry,
        employee_count: org.estimated_num_employees,
        location:       [org.city, org.country].filter(Boolean).join(', '),
        tech_stack:     org.technology_names || [],
        apollo_account_id: org.id,
        apollo_raw:     org,
      });
      if (company) updates.company_id = company.id;
    }

    // Write enriched attributes as observations with the true source (apollo),
    // then strip them from the view update so the trigger doesn't re-tag them
    // with the record's origin source. Other columns still flow via the view.
    await recordEnrichmentObservations(supabase, contact.workspace_id, contact.id, 'apollo', updates);
    const viewUpdate = { ...updates };
    for (const f of ENRICH_STRIP) delete viewUpdate[f];
    if (Object.keys(viewUpdate).length) await supabase.from('contacts').update(viewUpdate).eq('id', contact.id);

    await logActivity(supabase, {
      workspaceId: contact.workspace_id, contactId: contact.id,
      companyId: updates.company_id || contact.company_id || null,
      type: 'enrichment_run', source: 'apollo',
      // Unique per run so the timeline accumulates the full enrichment history.
      externalId: `apollo_enrich_${contact.id}_${Date.now()}`,
      occurredAt: new Date().toISOString(),
      description: 'Profile enriched via Apollo',
      summary: [
        person.email || null,
        [updates.job_title, org.name].filter(Boolean).join(' at ') || null,
      ].filter(Boolean).join(' · ') || null,
      rawData: {
        provider: 'apollo',
        email: person.email || contact.email || null,
        email_status: person.email_status || null,
        job_title: updates.job_title || null,
        company: org.name || null,
        domain: org.primary_domain || null,
      },
    }).catch(() => {});
    logSysEvent(supabase, contact.workspace_id, 'apollo', 'enrichment_run',
      `Enriched: ${[person.name, updates.job_title, org.name].filter(Boolean).join(' · ')}`,
      contact.id, { status: 'success', job_title: updates.job_title, company: org.name }
    ).catch(() => {});

    await scoreICP(supabase, contact.workspace_id, { ...contact, ...updates });

  } catch (err) {
    console.error('[ENRICH] Apollo failed for', contact.email, ':', err.message);
    await supabase.from('contacts').update({ enrichment_status: 'failed' }).eq('id', contact.id);
    await logActivity(supabase, {
      workspaceId: contact.workspace_id, contactId: contact.id,
      companyId: contact.company_id || null,
      type: 'enrichment_run', source: 'apollo',
      externalId: `apollo_err_${contact.id}_${Date.now()}`,
      occurredAt: new Date().toISOString(),
      description: 'Enrichment failed',
      summary: err.message,
    }).catch(() => {});
    logSysEvent(supabase, contact.workspace_id, 'apollo', 'enrichment_run',
      `Enrichment error: ${err.message}`,
      contact.id, { status: 'error' }
    ).catch(() => {});
  }
}


// ── Prospeo enrichment path ───────────────────────────────────────────────────

async function enrichContactViaProspeo(supabase, contact, prospeoKey) {
  if (!prospeoKey) {
    console.warn('[ENRICH] No Prospeo key available (connect Prospeo in Integrations or set PROSPERO_API_KEY)');
    await supabase.from('contacts').update({ enrichment_status: 'no_integration' }).eq('id', contact.id);
    return;
  }

  // Strip placeholder emails injected by Airtable/CSV imports (e.g. georgi@airtable.import)
  const FAKE_EMAIL_DOMAINS = /\.(import|csv|fake|test|example|placeholder|noemail)$/i;
  const realEmail = contact.email && !FAKE_EMAIL_DOMAINS.test(contact.email.split('@')[1] || '')
    ? contact.email : null;
  // Prospeo can't resolve a member-URN URL — only feed it a real public handle.
  const liUrl = usableLinkedInUrl(contact.linkedin_url);

  if (!realEmail && !liUrl) {
    console.warn('[ENRICH_PROSPEO] No real email or usable LinkedIn URL — skipping');
    await supabase.from('contacts').update({ enrichment_status: 'not_found' }).eq('id', contact.id);
    return;
  }

  console.log('[ENRICH_PROSPEO] Starting for', realEmail || liUrl);
  await supabase.from('contacts').update({ enrichment_status: 'queued' }).eq('id', contact.id);

  try {
    const requestData = {};
    if (realEmail)          requestData.email        = realEmail;
    if (contact.first_name) requestData.first_name   = contact.first_name;
    if (contact.last_name)  requestData.last_name    = contact.last_name;
    if (liUrl)              requestData.linkedin_url = liUrl;

    console.log('[ENRICH_PROSPEO] Calling API for:', JSON.stringify(requestData));
    const res = await fetch(`${PROSPEO_BASE}/enrich-person`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-KEY': prospeoKey },
      body: JSON.stringify({ data: requestData }),
    });

    const body = await res.json();
    console.log('[ENRICH_PROSPEO] Response status:', res.status, '| error:', body.error_code || 'none', '| has person:', !!body.person);

    if (body.error) {
      if (body.error_code === 'NO_MATCH') {
        await supabase.from('contacts').update({ enrichment_status: 'not_found' }).eq('id', contact.id);
        await logActivity(supabase, {
          workspaceId: contact.workspace_id, contactId: contact.id,
          companyId: contact.company_id || null,
          type: 'enrichment_run', source: 'prospeo',
          externalId: `prospeo_nomatch_${contact.id}`,
          occurredAt: new Date().toISOString(),
          description: 'Enrichment: no match found',
          summary: `Prospeo searched for ${realEmail || contact.linkedin_url || 'contact'} — no profile found`,
        }).catch(() => {});
        logSysEvent(supabase, contact.workspace_id, 'prospeo', 'enrichment_run',
          `No profile found: ${realEmail || contact.linkedin_url || contact.id}`,
          contact.id, { status: 'no_match' }
        ).catch(() => {});
        return;
      }
      throw new Error(`Prospeo ${body.error_code || res.status}`);
    }

    const person = body.person;
    if (!person) throw new Error('No person returned');

    // Prospeo returns the found email under person.email = { email, status }.
    const _emailObj = person.email;
    const foundEmail = (_emailObj && typeof _emailObj === 'object' ? _emailObj.email : _emailObj) || null;
    const foundEmailStatus = _emailObj && typeof _emailObj === 'object' ? (_emailObj.status || null) : null;
    console.log('[ENRICH_PROSPEO] found email:', foundEmail || '(none)', '| status:', foundEmailStatus || '-');

    const currentJob = person.job_history?.find(j => j.current) || person.job_history?.[0];

    // ENRICH, don't OVERWRITE: only fill fields we don't already have. Provider
    // data can be stale or a secondary role (e.g. a "Fractional Coach" gig over a
    // person's real "Founder @ their-own-company"), so an existing value — manual,
    // LinkedIn, or import — is treated as more authoritative and kept. Asserted
    // claims are already protected in recomputeClaim; this also stops a non-asserted
    // existing value from losing to the newer provider observation on recency.
    const updates = {
      enrichment_status:  'complete',
      enriched_at:        new Date().toISOString(),
      enrichment_source:  'prospeo',
      apollo_raw:         person,
      apollo_id:          person.person_id || contact.apollo_id,
      // never downgrade a real linkedin_url to a provider's; keep what we have
      linkedin_url:       contact.linkedin_url || person.linkedin_url,
      city:               contact.city    || person.location?.city    || null,
      country:            contact.country || person.location?.country || null,
    };
    if (contact.phone == null && person.mobile?.mobile) updates.phone = person.mobile.mobile;
    // Adopt a title only when we have none — and bring its seniority/department with it.
    if (!contact.job_title && person.current_job_title) {
      updates.job_title  = person.current_job_title;
      updates.seniority  = normalizeSeniority(currentJob?.seniority);
      updates.department = normalizeDepartment(currentJob?.departments?.[0]);
    }

    const co = body.company;
    console.log('[ENRICH_PROSPEO] Company data from Prospeo:', co ? `name=${co.name} domain=${co.domain} industry=${co.industry} employees=${co.employee_count} location=${JSON.stringify(co.location)}` : 'none');
    // Only adopt the provider's company when we don't already have one — don't
    // relink a person off their real employer onto a secondary/stale one.
    if (!contact.company && (co?.name || co?.website || co?.domain)) {
      const rawDomain = co.domain
        || co.website?.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null;

      const company = await upsertCompany(supabase, contact.workspace_id, {
        name:              co.name,
        domain:            rawDomain,
        industry:          co.industry,
        employee_count:    co.employee_count,
        location:          [co.location?.city, co.location?.country].filter(Boolean).join(', '),
        tech_stack:        co.technology?.technology_names || [],
        apollo_account_id: co.company_id,
        apollo_raw:        co,
      });

      console.log('[ENRICH_PROSPEO] upsertCompany result:', company ? `id=${company.id} name=${company.name}` : 'null/failed');
      if (company) {
        updates.company_id = company.id;
        updates.company = co.name;
        if (rawDomain && !contact.domain) updates.domain = rawDomain;
      }
    }

    if (foundEmailStatus) updates.reachability_status = foundEmailStatus;
    await recordEnrichmentObservations(supabase, contact.workspace_id, contact.id, 'prospeo', updates);
    const viewUpdate = { ...updates };
    for (const f of ENRICH_STRIP) delete viewUpdate[f];
    if (Object.keys(viewUpdate).length) await supabase.from('contacts').update(viewUpdate).eq('id', contact.id);

    // ADD the found email as an identifier — ALWAYS, even when we already have one.
    // A person legitimately has several addresses; never discard a (verified) one.
    // This does NOT change the primary/displayed email — it's an additive alternate.
    // (upsertIdentifier won't steal an email already active on another entity.)
    if (foundEmail) {
      await upsertIdentifier(supabase, contact.workspace_id, contact.id, 'email', foundEmail);
    }

    await logActivity(supabase, {
      workspaceId: contact.workspace_id, contactId: contact.id,
      companyId: updates.company_id || contact.company_id || null,
      type: 'enrichment_run', source: 'prospeo',
      // Unique per run (not per contact) so the timeline ACCUMULATES every
      // enrichment — that append-only trail is the history: email changes,
      // status changes, company moves, all visible across re-enrichments.
      externalId: `prospeo_enrich_${contact.id}_${Date.now()}`,
      occurredAt: new Date().toISOString(),
      description: 'Profile enriched via Prospeo',
      summary: [
        foundEmail && `${foundEmail}${foundEmailStatus ? ` (${foundEmailStatus})` : ''}`,
        [updates.job_title, updates.company].filter(Boolean).join(' at ') || null,
      ].filter(Boolean).join(' · ') || null,
      rawData: {
        provider: 'prospeo',
        email: foundEmail || contact.email || null,
        email_status: foundEmailStatus || null,
        job_title: updates.job_title || null,
        company: updates.company || null,
        domain: updates.domain || null,
      },
    }).catch(() => {});
    logSysEvent(supabase, contact.workspace_id, 'prospeo', 'enrichment_run',
      `Enriched: ${[person.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' '), updates.job_title, updates.company].filter(Boolean).join(' · ')}`,
      contact.id, { status: 'success', job_title: updates.job_title, company: updates.company }
    ).catch(() => {});

    await scoreICP(supabase, contact.workspace_id, { ...contact, ...updates });

  } catch (err) {
    console.error('[ENRICH] Prospeo failed for', contact.email, ':', err.message);
    await supabase.from('contacts').update({ enrichment_status: 'failed' }).eq('id', contact.id);
    await logActivity(supabase, {
      workspaceId: contact.workspace_id, contactId: contact.id,
      companyId: contact.company_id || null,
      type: 'enrichment_run', source: 'prospeo',
      externalId: `prospeo_err_${contact.id}_${Date.now()}`,
      occurredAt: new Date().toISOString(),
      description: 'Enrichment failed',
      summary: err.message,
    }).catch(() => {});
    logSysEvent(supabase, contact.workspace_id, 'prospeo', 'enrichment_run',
      `Enrichment error: ${err.message}`,
      contact.id, { status: 'error' }
    ).catch(() => {});
  }
}


// ── Prospeo company enrichment ───────────────────────────────────────────────

export async function enrichCompany(supabase, workspaceId, domain) {
  const prospeoKey = process.env.PROSPERO_API_KEY;
  if (!prospeoKey) {
    // Self-host without an enrichment provider — surface a clean "not
    // configured" instead of a generic 500, mirroring how contact enrichment
    // degrades (sets enrichment_status='no_integration' and returns).
    const err = new Error('PROSPERO_API_KEY not set');
    err.code = 'enrichment_not_configured';
    throw err;
  }

  const res = await fetch(`${PROSPEO_BASE}/enrich-company`, {
    method: 'POST',
    headers: prospeoHeaders(),
    body: JSON.stringify({ data: { company_website: domain } }),
  });

  const body = await res.json();
  if (body.error) {
    if (body.error_code === 'NO_MATCH') return null;
    throw new Error(`Prospeo ${body.error_code || res.status}`);
  }

  const co = body.company;
  if (!co) return null;

  const rawDomain = co.domain
    || co.website?.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || domain;

  return upsertCompany(supabase, workspaceId, {
    domain:           rawDomain,
    name:             co.name,
    industry:         co.industry,
    employee_count:   co.employee_count,
    location:         [co.location?.city, co.location?.country].filter(Boolean).join(', '),
    tech_stack:       co.technology?.technology_names || [],
    apollo_account_id: co.company_id,
    apollo_raw:       co,
  });
}


// ── Company upsert ───────────────────────────────────────────────────────────

export async function upsertCompany(supabase, workspaceId, data) {
  const { name, domain, industry, employee_count, location, tech_stack,
          hubspot_company_id, apollo_account_id, apollo_raw, revenue_range } = data;

  let normalizedDomain = domain?.replace(/^www\./, '').toLowerCase().trim() || null;
  // A personal-mailbox domain is never an employer — never key a company on it.
  if (normalizedDomain && isFreeEmailDomain(normalizedDomain)) normalizedDomain = null;

  let existing = null;
  if (normalizedDomain) {
    const { data: m } = await supabase.from('companies').select('*')
      .eq('workspace_id', workspaceId).eq('domain', normalizedDomain).maybeSingle();
    existing = m;
  }
  if (!existing && hubspot_company_id) {
    const { data: m } = await supabase.from('companies').select('*')
      .eq('workspace_id', workspaceId).eq('hubspot_company_id', hubspot_company_id).maybeSingle();
    existing = m;
  }

  const payload = {
    workspace_id:       workspaceId,
    name:               name || existing?.name,
    domain:             normalizedDomain || existing?.domain,
    industry:           industry || existing?.industry,
    employee_count:     employee_count || existing?.employee_count,
    location:           location || existing?.location,
    tech_stack:         tech_stack?.length ? tech_stack : existing?.tech_stack,
    revenue_range:      revenue_range || existing?.revenue_range,
    hubspot_company_id: hubspot_company_id || existing?.hubspot_company_id,
    apollo_account_id:  apollo_account_id || existing?.apollo_account_id,
    apollo_raw:         apollo_raw || existing?.apollo_raw,
    enrichment_status:  'complete',
    enriched_at:        new Date().toISOString(),
  };

  // The `companies` view's INSTEAD OF triggers translate INSERT/UPDATE into
  // v2 ops (entity upsert + identifier upserts + state observations).
  if (existing) {
    const { data: updated } = await supabase.from('companies')
      .update(payload).eq('id', existing.id).select('*').single();
    return updated;
  }
  const { data: created } = await supabase.from('companies')
    .insert(payload).select('*').single();
  return created;
}


// ── ICP scoring ──────────────────────────────────────────────────────────────

export async function scoreICP(supabase, workspaceId, contact) {
  // Point-in-time feature snapshot that drives Scorecard scoring. Company-level
  // features are merged in below once the contact's company is known.
  let features = {
    job_title:  contact.job_title  || null,
    seniority:  contact.seniority  || null,
    department: contact.department || null,
    company:    contact.company    || null,
    country:    contact.country    || null,
  };
  const contactSummary = [
    contact.job_title   && `Title: ${contact.job_title}`,
    contact.seniority   && `Seniority: ${contact.seniority}`,
    contact.department  && `Department: ${contact.department}`,
    contact.company     && `Company: ${contact.company}`,
  ].filter(Boolean).join('\n');

  if (!contactSummary) return; // No profile data yet — skip

  try {
    // Enrich the snapshot with company-level features so signals over
    // industry / employee_count can fire (richer feature snapshot).
    if (contact.company_id) {
      const { data: co } = await supabase
        .from('companies')
        .select('industry, employee_count')
        .eq('id', contact.company_id)
        .maybeSingle();
      if (co) {
        features = {
          ...features,
          industry:       co.industry || null,
          employee_count: co.employee_count ?? null,
        };
      }
    }

    // ── Score ────────────────────────────────────────────────────────────────
    // The Scorecard is the live scorer: a deterministic, decomposable sum of
    // weighted signals, refined nightly by the learning loop. A workspace
    // without a Scorecard yet falls back to the LLM reading ICP memories.
    // See docs/adaptive-lead-scoring.md.
    let score, fit, reasoning, model;
    let basisMemoryIds = [];

    let signals = [];
    try {
      signals = await listSignals(supabase, workspaceId, { activeOnly: true });
    } catch {
      signals = []; // Scorecard unavailable — fall through to the LLM scorer
    }

    if (signals.length > 0) {
      const result = scoreLead(features, signals);
      score = result.score;
      fit = score >= 70;
      reasoning = result.fired.length
        ? `Scorecard: ${result.fired.length} signal${result.fired.length === 1 ? '' : 's'} fired — ${result.fired.slice(0, 4).map(f => f.key).join(', ')}`
        : 'Scorecard: no signals matched this profile';
      model = 'scorecard';
    } else {
      const memories = await listNotes(supabase, workspaceId, {
        categories: ['ICP', 'Market', 'Company', 'Product'],
        limit: 60,
      });

      const prompt = memories.length
        ? `Workspace ICP criteria:\n${memories.map(m => `[${m.category}] ${m.content}`).join('\n')}\n\nContact:\n${contactSummary}\n\nScore this contact's ICP fit 0-100 and give a one-sentence reason. Respond as JSON: {"score": <int>, "fit": <bool>, "reasoning": "<one sentence>"}`
        : `Contact profile:\n${contactSummary}\n\nScore this B2B contact's ICP fit 0-100 based on their role alone. Use seniority as the primary signal: C-suite/VP/Director = high (75-95), Manager/Senior = medium (45-70), IC/unknown = low (20-40). Give a one-sentence reason. Note: no specific ICP criteria configured. Respond as JSON: {"score": <int>, "fit": <bool>, "reasoning": "<one sentence>"}`;

      const msg = await anthropic.messages.create({
        feature: 'icp-score-llm-fallback',
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      });
      const raw = msg.content[0].text.trim();
      const json = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
      score = json.score;
      fit = json.fit ?? json.score >= 70;
      reasoning = json.reasoning || null;
      model = 'claude-haiku-4-5-20251001';
      basisMemoryIds = (memories || []).map(m => m.id);
    }

    if (typeof score !== 'number' || Number.isNaN(score)) {
      console.error('[ICP_SCORE] No score produced for contact', contact.id);
      return;
    }

    // ── Write ────────────────────────────────────────────────────────────────
    await supabase.from('contacts').update({
      icp_score:     score,
      icp_fit:       fit,
      icp_reasoning: reasoning,
      icp_scored_at: new Date().toISOString(),
    }).eq('id', contact.id);

    // The prediction snapshot now lives in the v2 substrate: the scoreEntities
    // worker stakes an `icp_fit` prediction from the entity's claims, and the
    // outcome job resolves it. (Was: a mind_episodes insert here.)

    const fitLabel = score >= 75 ? 'Strong fit' : score >= 50 ? 'Potential fit' : 'Weak fit';
    // ICP scoring is not a timeline-worthy event — it's shown in the contact's
    // Record Details, not the activity feed. Keep the internal sys-event only.
    logSysEvent(supabase, workspaceId, 'system', 'icp_scored',
      `ICP score ${score}/100 — ${fitLabel}: ${(reasoning || '').slice(0, 120)}`,
      contact.id, { score, fit, fit_label: fitLabel, scorer: model }
    ).catch(() => {});

    console.log(`[ICP_SCORE] ${contact.id}: score=${score} fit=${fit} (${model === 'scorecard' ? 'scorecard' : 'memory fallback'})`);
  } catch (e) {
    console.error('[ICP_SCORE] Failed for contact', contact.id, ':', e.message);
  }
}


// ── Connection status (computed, not stored) ──────────────────────────────────

export function connectionStatus(lastActivityAt, totalTouchpoints) {
  if (!lastActivityAt) return 'cold';
  const daysSince = (Date.now() - new Date(lastActivityAt)) / 86400000;
  if (daysSince <= 14 && totalTouchpoints >= 3) return 'hot';
  if (daysSince <= 60 && totalTouchpoints >= 1) return 'warm';
  return 'cold';
}


// ── Helpers ──────────────────────────────────────────────────────────────────

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
  if (r.includes('sales'))       return 'sales';
  if (r.includes('marketing'))   return 'marketing';
  if (r.includes('engineering') || r.includes('product')) return 'engineering';
  if (r.includes('operations'))  return 'ops';
  return raw;
}

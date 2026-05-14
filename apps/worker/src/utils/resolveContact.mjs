// General-purpose identity resolution — ported from assetly-blueprint/server/enrichment.mjs
// Waterfall: external_id → email → linkedin_url → name+email heal → create
// Used by all webhook handlers except LinkedIn (which has its own linkedin_member_id step).

import { getSupabaseClient } from '@proply/core';
import { enrichContact } from './enrichContact.mjs';

// ── Company upsert ────────────────────────────────────────────────────────────

export async function upsertCompany(supabase, workspaceId, { name, domain }) {
  const normalizedDomain = domain?.replace(/^www\./, '').toLowerCase().trim() || null;
  if (!name && !normalizedDomain) return null;

  let existing = null;
  if (normalizedDomain) {
    const { data } = await supabase.from('companies').select('id, name, domain')
      .eq('workspace_id', workspaceId).eq('domain', normalizedDomain).maybeSingle();
    existing = data;
  }
  if (!existing && name) {
    const { data } = await supabase.from('companies').select('id, name, domain')
      .eq('workspace_id', workspaceId).ilike('name', name).maybeSingle();
    existing = data;
  }

  if (existing) {
    const updates = {};
    if (name && !existing.name) updates.name = name;
    if (normalizedDomain && !existing.domain) updates.domain = normalizedDomain;
    if (Object.keys(updates).length) {
      const { data: updated } = await supabase.from('companies').update(updates)
        .eq('id', existing.id).select('id').single();
      return updated || existing;
    }
    return existing;
  }

  const { data: created } = await supabase.from('companies')
    .insert({ workspace_id: workspaceId, name: name || null, domain: normalizedDomain })
    .select('id').single();
  return created;
}

// ── Fill empty fields from incoming data ──────────────────────────────────────

async function mergeContact(supabase, existing, incoming) {
  const updates = {};
  const fill = (field, value) => {
    if (value != null && value !== '' && (existing[field] == null || existing[field] === ''))
      updates[field] = value;
  };

  fill('first_name',   incoming.first_name);
  fill('last_name',    incoming.last_name);
  fill('job_title',    incoming.job_title);
  fill('phone',        incoming.phone);
  fill('linkedin_url', incoming.linkedin_url);
  fill('company',      incoming.company_name);
  fill('hubspot_id',   incoming.hubspot_id);
  fill('pipedrive_id', incoming.pipedrive_id);
  fill('apollo_id',    incoming.apollo_id);

  const incomingDomain = incoming.company_domain?.replace(/^www\./, '').toLowerCase().trim()
    || (incoming.email ? incoming.email.split('@')[1]?.toLowerCase() : null)
    || null;
  fill('domain', incomingDomain);

  // Opportunistically link company_id if missing and we have company data
  if (!existing.company_id && (incoming.company_name || incomingDomain)) {
    upsertCompany(supabase, existing.workspace_id, {
      name:   incoming.company_name || null,
      domain: incomingDomain || existing.domain,
    }).then(co => {
      if (co?.id) supabase.from('contacts').update({ company_id: co.id }).eq('id', existing.id).then(() => {});
    }).catch(() => {});
  }

  if (!Object.keys(updates).length) return existing;
  updates.updated_at = new Date().toISOString();

  const { data: updated } = await supabase.from('contacts')
    .update(updates).eq('id', existing.id).select('id, company_id, email, channels').single();
  return { ...existing, ...updates, ...(updated || {}) };
}

// ── Main resolver ─────────────────────────────────────────────────────────────
// createIfMissing=true  → webhook sources that bootstrap contacts (LinkedIn, RB2B, Apollo)
// createIfMissing=false → update-only sources (Fireflies, Calendly — never create)

export async function resolveContact(supabase, workspaceId, data, { createIfMissing = true } = {}) {
  const {
    email, full_name, first_name, last_name,
    linkedin_url, company_domain, company_name,
    hubspot_id, pipedrive_id, apollo_id, job_title, phone, source,
  } = data;

  const SELECT = 'id, company_id, email, first_name, last_name, channels, linkedin_url, workspace_id';

  // Step 1 — external integration IDs (fastest, zero fuzzy logic)
  for (const [col, val] of [
    ['hubspot_id',   hubspot_id],
    ['pipedrive_id', pipedrive_id],
    ['apollo_id',    apollo_id],
  ]) {
    if (!val) continue;
    const { data: match } = await supabase.from('contacts').select(SELECT)
      .eq('workspace_id', workspaceId).eq(col, val).maybeSingle();
    if (match) return { contact: await mergeContact(supabase, match, data), created: false };
  }

  // Step 2 — email (ground truth)
  if (email) {
    const { data: match } = await supabase.from('contacts').select(SELECT)
      .eq('workspace_id', workspaceId).eq('email', email.toLowerCase().trim()).maybeSingle();
    if (match) return { contact: await mergeContact(supabase, match, data), created: false };
  }

  // Step 3 — LinkedIn URL
  if (linkedin_url) {
    const { data: match } = await supabase.from('contacts').select(SELECT)
      .eq('workspace_id', workspaceId).eq('linkedin_url', linkedin_url).maybeSingle();
    if (match) return { contact: await mergeContact(supabase, match, data), created: false };
  }

  // Step 3.5 — name heal: contact exists with matching name but no email → patch email in
  if (email) {
    const name = full_name || [first_name, last_name].filter(Boolean).join(' ') || null;
    if (name) {
      const parts = name.trim().split(/\s+/);
      const fn = parts[0], ln = parts.slice(1).join(' ');
      if (fn && ln) {
        const { data: nameMatches } = await supabase.from('contacts').select(SELECT)
          .eq('workspace_id', workspaceId).is('email', null)
          .ilike('first_name', fn).ilike('last_name', ln);
        if (nameMatches?.length === 1) {
          const cleanEmail = email.toLowerCase().trim();
          await supabase.from('contacts').update({ email: cleanEmail }).eq('id', nameMatches[0].id);
          console.log(`[IDENTITY] Name heal "${name}" → ${cleanEmail} (contact ${nameMatches[0].id})`);
          return { contact: await mergeContact(supabase, { ...nameMatches[0], email: cleanEmail }, data), created: false };
        }
      }
    }
  }

  // Step 4 — no match
  if (!createIfMissing) return { contact: null, created: false };
  if (!email && !linkedin_url) {
    console.warn('[IDENTITY] Cannot create contact without email or linkedin_url');
    return { contact: null, created: false };
  }

  const name = full_name || [first_name, last_name].filter(Boolean).join(' ') || null;
  const normalizedDomain = company_domain?.replace(/^www\./, '').toLowerCase().trim()
    || (email ? email.split('@')[1]?.toLowerCase() : null) || null;

  let companyId = null;
  if (company_name || normalizedDomain) {
    const co = await upsertCompany(supabase, workspaceId, { name: company_name || null, domain: normalizedDomain });
    companyId = co?.id || null;
  }

  const { data: created, error } = await supabase.from('contacts').insert({
    workspace_id: workspaceId,
    email:        email ? email.toLowerCase().trim() : null,
    first_name:   first_name || name?.split(' ')[0] || null,
    last_name:    last_name  || name?.split(' ').slice(1).join(' ') || null,
    job_title, phone, linkedin_url,
    hubspot_id, pipedrive_id, apollo_id,
    company:    company_name || null,
    domain:     normalizedDomain,
    company_id: companyId,
    source:     source || 'webhook',
    pipeline_stage: 'identified',
    first_seen_at:  new Date().toISOString(),
  }).select(SELECT).single();

  if (error) {
    // Unique constraint on (workspace_id, email) — race condition, fetch existing
    if (error.code === '23505' && email) {
      const { data: existing } = await supabase.from('contacts').select(SELECT)
        .eq('workspace_id', workspaceId).eq('email', email.toLowerCase().trim()).maybeSingle();
      if (existing) return { contact: existing, created: false };
    }
    console.error('[IDENTITY] Create error:', error.message);
    return { contact: null, created: false };
  }

  // Fire-and-forget enrichment — never block the webhook response
  enrichContact(supabase, { ...created, workspace_id: workspaceId }).catch(() => {});

  return { contact: created, created: true };
}

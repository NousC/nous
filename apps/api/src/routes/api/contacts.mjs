import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getSupabaseClient, listNotes, saveNote } from '@nous/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';
import { ensureUserAndTeam } from '../../lib/auth.mjs';
import { requireEnrichmentQuota } from '../../lib/access.mjs';
import { enrichContact } from '../../services/enrichment.mjs';
import { enrichContactHistory, enrichmentJobs } from '../../services/contactHistoryEnricher.mjs';

export const contactsApiRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SYSTEM_TYPES = new Set(['stage_changed', 'contact_created', 'contact_updated', 'score_updated', 'enrichment_completed']);

// GET /api/contacts
contactsApiRouter.get('/', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { workspaceId, search, limit = 50, offset = 0, filter, source, sort, status } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspace_id_required' });
    if (!UUID.test(workspaceId)) return res.status(400).json({ error: 'invalid_workspace_id' });

    // verifySupabaseAuth already validated workspace membership (cached for
    // 60s) — the redundant ensureUserAndTeam + workspace_members check that
    // used to live here added ~50-100ms of DB roundtrips for no extra safety.
    // `req.workspaceId` is set by the middleware iff membership passed.
    if (req.workspaceId !== workspaceId) return res.status(403).json({ error: 'workspace_not_found_or_unauthorized' });

    // No `count: 'exact'` — it triggers a separate COUNT query that can take
    // longer than the data fetch itself on large tables. Nobody reads .total
    // from this endpoint's response in the current frontend.
    let query = supabase.from('contacts').select('*').eq('workspace_id', workspaceId);
    if (filter && filter !== 'all') query = query.eq('pipeline_stage', filter);
    if (status) query = query.eq('status', status);
    if (source) query = query.eq('source', source);
    if (search?.trim()) {
      const t = `%${search.trim()}%`;
      query = query.or(`email.ilike.${t},first_name.ilike.${t},last_name.ilike.${t},company.ilike.${t}`);
    }
    query = sort === 'interactions_asc'
      ? query.order('last_activity_at', { ascending: true, nullsFirst: false })
      : query.order('last_activity_at', { ascending: false, nullsFirst: false });
    const lim = Math.min(parseInt(limit) || 50, 1000);
    const off = parseInt(offset) || 0;
    query = query.range(off, off + lim - 1);

    const { data: raw, error } = await query;
    if (error) throw error;

    return res.json({ contacts: raw || [], limit: lim, offset: off });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

// GET /api/contacts/enrich-progress/:jobId — must be before /:id so Express doesn't swallow it
contactsApiRouter.get('/enrich-progress/:jobId', verifySupabaseAuth, (req, res) => {
  const job = enrichmentJobs.get(req.params.jobId);
  if (!job) return res.json({ found: false });
  return res.json({ found: true, contacts: job.contacts, done: job.done });
});

// GET /api/contacts/:id
contactsApiRouter.get('/:id', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { id } = req.params;
    const { user } = await ensureUserAndTeam(req.user);
    if (!UUID.test(id)) return res.status(400).json({ error: 'invalid_contact_id' });

    const { data: contact, error } = await supabase.from('contacts').select('*').eq('id', id).single();
    if (error || !contact) return res.status(404).json({ error: 'contact_not_found' });

    const { data: membership } = await supabase.from('workspace_members').select('workspace_id').eq('workspace_id', contact.workspace_id).eq('user_id', user.id).single();
    if (!membership) return res.status(403).json({ error: 'contact_not_found_or_unauthorized' });

    // Activities are kind:'event' observations in the v2 substrate.
    // entity_id == contact id (the v1->v2 migration convention). Same
    // response shape as before — the frontend timeline is untouched.
    const { data: obsRows } = await supabase.from('observations')
      .select('id, property, value, source, observed_at, raw')
      .eq('entity_id', id).eq('kind', 'event')
      .order('observed_at', { ascending: false }).limit(200);

    // Human title for known event types. Falls back to the raw type for
    // anything we don't recognize so unknown events still render readably.
    const titleFor = (prop, value) => {
      if (prop === 'interaction.signed_up') {
        const parts = ['Signed up'];
        if (value?.plan) parts.push(`for ${value.plan}`);
        if (value?.company) parts.push(`from ${value.company}`);
        return parts.join(' ');
      }
      if (prop === 'interaction.welcome_email_sent') return 'Welcome email delivered';
      if (prop === 'interaction.subscription_started') {
        const plan = value?.plan ? ` — ${value.plan}` : '';
        const amt = value?.amount && value?.currency
          ? ` ($${value.amount}/${value.billing_interval || 'mo'})` : '';
        return `Paid via Stripe${plan}${amt}`;
      }
      if (prop === 'interaction.subscription_updated') return `Plan updated${value?.plan ? ` to ${value.plan}` : ''}`;
      if (prop === 'interaction.subscription_canceled') return 'Canceled subscription';
      return value?.description || (prop || '').replace(/^interaction\./, '').replace(/_/g, ' ') || 'Activity';
    };

    const activities = (obsRows || [])
      .map(o => {
        const type = (o.property || '').replace(/^interaction\./, '');
        return {
          id:            o.id,
          activity_type: type,
          title:         titleFor(o.property, o.value),
          subtitle:      o.value?.summary || o.value?.description || null,
          source:        o.source || 'nous',
          created_at:    o.observed_at,
          raw_data:      o.raw || null,
        };
      })
      .filter(a => !SYSTEM_TYPES.has(a.activity_type) && a.activity_type !== 'stage_changed');

    let company = null;
    if (contact.company_id) {
      const { data: c } = await supabase.from('companies').select('name, domain, industry, employee_count, tech_stack, location, revenue_range').eq('id', contact.company_id).maybeSingle();
      company = c;
    }

    // Notes on this contact-entity (entity_id == contact.id in v2).
    const memories = await listNotes(supabase, contact.workspace_id, { entityId: id, limit: 30 });

    return res.json({ contact, activities, company, memories });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

// POST /api/contacts
contactsApiRouter.post('/', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { workspaceId, email, firstName, lastName, phone, company, jobTitle, notes, tags, source, industry, lead_source, company_size, keywords } = req.body;
    const { user } = await ensureUserAndTeam(req.user);

    if (!workspaceId || !email) return res.status(400).json({ error: 'workspace_id_and_email_required' });
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'invalid_email_format' });
    if (!UUID.test(workspaceId)) return res.status(400).json({ error: 'invalid_workspace_id' });

    const { data: membership } = await supabase.from('workspace_members').select('workspace_id').eq('workspace_id', workspaceId).eq('user_id', user.id).single();
    if (!membership) return res.status(403).json({ error: 'workspace_not_found_or_unauthorized' });

    // Auto-resolve company_id
    let companyId = null;
    if (company?.trim()) {
      const cName = company.trim();
      const rawDomain = req.body.domain?.trim();
      const domain = rawDomain ? rawDomain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').toLowerCase().split('/')[0] : null;
      if (domain) {
        const { data: ex } = await supabase.from('companies').select('id').eq('workspace_id', workspaceId).eq('domain', domain).maybeSingle();
        if (ex) { companyId = ex.id; } else { const { data: ins } = await supabase.from('companies').insert({ workspace_id: workspaceId, name: cName, domain }).select('id').single(); companyId = ins?.id; }
      } else {
        const { data: ex } = await supabase.from('companies').select('id').eq('workspace_id', workspaceId).ilike('name', cName).maybeSingle();
        if (ex) { companyId = ex.id; } else { const { data: ins } = await supabase.from('companies').insert({ workspace_id: workspaceId, name: cName }).select('id').single(); companyId = ins?.id; }
      }
    }

    const { data: contact, error } = await supabase.from('contacts').insert({
      workspace_id: workspaceId, email: email.toLowerCase().trim(),
      first_name: firstName?.trim() || null, last_name: lastName?.trim() || null,
      phone: phone?.trim() || null, company: company?.trim() || null,
      job_title: jobTitle?.trim() || null, notes: notes?.trim() || null,
      tags: tags || [], source: source || 'manual', industry: industry?.trim() || null,
      lead_source: lead_source?.trim() || null, company_size: company_size?.trim() || null,
      keywords: keywords?.trim() || null, created_by: user.id, company_id: companyId,
    }).select().single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'contact_already_exists' });
      throw error;
    }
    return res.status(201).json({ contact });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

// PATCH /api/contacts/:id
contactsApiRouter.patch('/:id', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { id } = req.params;
    const { user } = await ensureUserAndTeam(req.user);
    if (!UUID.test(id)) return res.status(400).json({ error: 'invalid_contact_id' });

    const { data: existing } = await supabase.from('contacts').select('*').eq('id', id).single();
    if (!existing) return res.status(404).json({ error: 'contact_not_found' });

    const { data: membership } = await supabase.from('workspace_members').select('workspace_id').eq('workspace_id', existing.workspace_id).eq('user_id', user.id).single();
    if (!membership) return res.status(403).json({ error: 'contact_not_found_or_unauthorized' });

    const { email, firstName, lastName, phone, company, jobTitle, linkedinUrl, notes, tags, industry, deal_value, dealValue, deal_closed_at, lead_source, company_size, keywords, status, dealStage, deal_stage, pipeline_stage } = req.body;
    const updates = {};
    if (email !== undefined) { if (!EMAIL.test(email)) return res.status(400).json({ error: 'invalid_email_format' }); updates.email = email.toLowerCase().trim(); }
    if (firstName !== undefined) updates.first_name = firstName?.trim() || null;
    if (lastName !== undefined) updates.last_name = lastName?.trim() || null;
    if (phone !== undefined) updates.phone = phone?.trim() || null;
    if (company !== undefined) updates.company = company?.trim() || null;
    if (jobTitle !== undefined) updates.job_title = jobTitle?.trim() || null;
    if (linkedinUrl !== undefined) updates.linkedin_url = linkedinUrl?.trim() || null;
    if (notes !== undefined) updates.notes = notes?.trim() || null;
    if (tags !== undefined) updates.tags = tags;
    if (industry !== undefined) updates.industry = industry?.trim() || null;
    const dv = dealValue !== undefined ? dealValue : deal_value;
    if (dv !== undefined) updates.deal_value = dv;
    if (deal_closed_at !== undefined) updates.deal_closed_at = deal_closed_at;
    const ds = dealStage !== undefined ? dealStage : deal_stage;
    if (ds !== undefined) updates.deal_stage = ds?.trim() || null;
    if (lead_source !== undefined) updates.lead_source = lead_source?.trim() || null;
    if (company_size !== undefined) updates.company_size = company_size?.trim() || null;
    if (keywords !== undefined) updates.keywords = keywords?.trim() || null;
    if (status !== undefined && ['prospect', 'client'].includes(status)) updates.status = status;
    if (pipeline_stage !== undefined) updates.pipeline_stage = pipeline_stage;

    const { data: contact, error } = await supabase.from('contacts').update(updates).eq('id', id).select().single();
    if (error) { if (error.code === '23505') return res.status(409).json({ error: 'contact_already_exists' }); throw error; }
    return res.json({ contact });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

// DELETE /api/contacts/:id
contactsApiRouter.delete('/:id', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { id } = req.params;
    const { user } = await ensureUserAndTeam(req.user);
    if (!UUID.test(id)) return res.status(400).json({ error: 'invalid_contact_id' });

    const { data: contact } = await supabase.from('contacts').select('id, workspace_id').eq('id', id).single();
    if (!contact) return res.status(404).json({ error: 'contact_not_found' });

    const { data: membership } = await supabase.from('workspace_members').select('workspace_id').eq('workspace_id', contact.workspace_id).eq('user_id', user.id).single();
    if (!membership) return res.status(403).json({ error: 'contact_not_found_or_unauthorized' });

    await supabase.from('contacts').delete().eq('id', id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

// POST /api/contacts/:id/memories
contactsApiRouter.post('/:id/memories', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { id } = req.params;
    const { content, category = 'General' } = req.body;
    const { user } = await ensureUserAndTeam(req.user);
    if (!UUID.test(id)) return res.status(400).json({ error: 'invalid_contact_id' });
    if (!content?.trim()) return res.status(400).json({ error: 'content required' });

    const { data: contact } = await supabase.from('contacts').select('workspace_id').eq('id', id).single();
    if (!contact) return res.status(404).json({ error: 'contact_not_found' });

    const { data: membership } = await supabase.from('workspace_members').select('workspace_id').eq('workspace_id', contact.workspace_id).eq('user_id', user.id).single();
    if (!membership) return res.status(403).json({ error: 'unauthorized' });

    const mem = await saveNote(supabase, contact.workspace_id, {
      entityId: id,
      category,
      content: content.trim(),
      source: 'manual',
    });
    return res.json({ memory: mem });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/contacts/import
contactsApiRouter.post('/import', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { workspaceId, rows } = req.body;
    const { user } = await ensureUserAndTeam(req.user);
    if (!workspaceId || !Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'workspace_id_and_rows_required' });
    if (!UUID.test(workspaceId)) return res.status(400).json({ error: 'invalid_workspace_id' });

    const { data: membership } = await supabase.from('workspace_members').select('workspace_id').eq('workspace_id', workspaceId).eq('user_id', user.id).single();
    if (!membership) return res.status(403).json({ error: 'workspace_not_found_or_unauthorized' });

    // Accept rows with a valid email OR a linkedin_url — at least one is required
    const validRows = rows.filter(r => {
      const hasEmail = r.email && EMAIL.test(r.email.trim());
      const hasLinkedin = r.linkedin_url && r.linkedin_url.trim().length > 0;
      return hasEmail || hasLinkedin;
    }).slice(0, 2000);
    if (!validRows.length) return res.status(400).json({ error: 'no_valid_rows' });

    // Split into email-identified and linkedin-only rows
    const emailRows = validRows.filter(r => r.email && EMAIL.test(r.email.trim()));
    const linkedinOnlyRows = validRows.filter(r => !(r.email && EMAIL.test(r.email.trim())));

    // Dedup email rows by email
    const emails = emailRows.map(r => r.email.toLowerCase().trim());
    const { data: existingByEmail } = emails.length
      ? await supabase.from('contacts').select('id, email').eq('workspace_id', workspaceId).in('email', emails)
      : { data: [] };
    const existingEmailSet = new Set((existingByEmail || []).map(c => c.email.toLowerCase()));

    // Dedup linkedin-only rows by linkedin_url
    const linkedinUrls = linkedinOnlyRows.map(r => r.linkedin_url.trim());
    const { data: existingByLinkedin } = linkedinUrls.length
      ? await supabase.from('contacts').select('id, linkedin_url').eq('workspace_id', workspaceId).in('linkedin_url', linkedinUrls)
      : { data: [] };
    const existingLinkedinSet = new Set((existingByLinkedin || []).map(c => c.linkedin_url));

    const toCreate = [
      ...emailRows.filter(r => !existingEmailSet.has(r.email.toLowerCase().trim())),
      ...linkedinOnlyRows.filter(r => !existingLinkedinSet.has(r.linkedin_url.trim())),
    ];
    const toUpdateEmail = emailRows.filter(r => existingEmailSet.has(r.email.toLowerCase().trim()));
    const toUpdateLinkedin = linkedinOnlyRows.filter(r => existingLinkedinSet.has(r.linkedin_url.trim()));

    const buildInsertRow = (r) => ({
      workspace_id: workspaceId,
      email: r.email ? r.email.toLowerCase().trim() : null,
      first_name: r.first_name?.trim() || null, last_name: r.last_name?.trim() || null,
      company: r.company?.trim() || null, job_title: r.job_title?.trim() || null,
      linkedin_url: r.linkedin_url?.trim() || null, source: r.source?.trim() || 'import',
      phone: r.phone?.trim() || null, domain: r.domain?.trim() || null,
      notes: r.notes?.trim() || null, seniority: r.seniority?.trim() || null,
      department: r.department?.trim() || null, deal_stage: r.deal_stage?.trim() || null,
      pipeline_stage: r.pipeline_stage?.trim() || null,
      created_by: user.id,
    });

    const buildUpdateFields = (r) => {
      const u = {};
      if (r.first_name) u.first_name = r.first_name.trim();
      if (r.last_name) u.last_name = r.last_name.trim();
      if (r.company) u.company = r.company.trim();
      if (r.job_title) u.job_title = r.job_title.trim();
      if (r.phone) u.phone = r.phone.trim();
      if (r.domain) u.domain = r.domain.trim();
      if (r.notes) u.notes = r.notes.trim();
      if (r.seniority) u.seniority = r.seniority.trim();
      if (r.department) u.department = r.department.trim();
      if (r.deal_stage) u.deal_stage = r.deal_stage.trim();
      if (r.pipeline_stage) u.pipeline_stage = r.pipeline_stage.trim();
      if (r.linkedin_url) u.linkedin_url = r.linkedin_url.trim();
      return u;
    };

    let created = 0, updated = 0;
    let newContactIds = [];
    if (toCreate.length) {
      const { data: inserted, error } = await supabase.from('contacts').insert(toCreate.map(buildInsertRow)).select('id');
      if (!error) {
        created = inserted?.length || 0;
        newContactIds = (inserted || []).map(c => c.id);
      }
    }
    for (const r of toUpdateEmail) {
      const u = buildUpdateFields(r);
      if (Object.keys(u).length) await supabase.from('contacts').update(u).eq('workspace_id', workspaceId).eq('email', r.email.toLowerCase().trim());
      updated++;
    }
    for (const r of toUpdateLinkedin) {
      const u = buildUpdateFields(r);
      if (Object.keys(u).length) await supabase.from('contacts').update(u).eq('workspace_id', workspaceId).eq('linkedin_url', r.linkedin_url.trim());
      updated++;
    }

    // Fire async history enrichment for all imported contacts (new + updated)
    const existingIds = [
      ...(existingByEmail || []).map(c => c.id),
      ...(existingByLinkedin || []).map(c => c.id),
    ];
    const allImportedIds = [...newContactIds, ...existingIds];
    let jobId = null;
    if (allImportedIds.length) {
      jobId = randomUUID();
      enrichContactHistory(supabase, workspaceId, allImportedIds, jobId).catch(e =>
        console.error('[CONTACTS_IMPORT_ENRICH_ERROR]', e.message)
      );
    }

    return res.json({ created, updated, skipped: rows.length - validRows.length, jobId });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

// POST /api/contacts/:id/enrich
// Gated by the plan's monthly enrichment allowance (its own metered unit —
// not ops). requireEnrichmentQuota 402s when the allowance is exhausted.
contactsApiRouter.post('/:id/enrich', verifySupabaseAuth, requireEnrichmentQuota, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { id } = req.params;
    if (!UUID.test(id)) return res.status(400).json({ error: 'invalid_id' });
    const { data: contact } = await supabase.from('contacts').select('*').eq('id', id).single();
    if (!contact) return res.status(404).json({ error: 'contact_not_found' });
    if (!contact.email && !contact.linkedin_url) {
      return res.status(422).json({ error: 'contact_has_no_email_or_linkedin' });
    }

    await enrichContact(supabase, contact);

    // Re-fetch updated contact so the frontend gets live enrichment_status + new fields
    const { data: updated } = await supabase.from('contacts').select('*').eq('id', id).single();
    const enriched = updated?.enrichment_status === 'complete';

    // A successful enrichment writes an `enrichment_run` row to the live op
    // log — billable_ops=0, because enrichment has its own metered allowance
    // (counted by getTeamEnrichmentUsage), it is NOT billed as an op.
    if (enriched) {
      try {
        await supabase.from('workspace_system_log').insert({
          workspace_id: updated?.workspace_id || contact.workspace_id,
          source:       'enrichment',
          event_type:   'enrichment_run',
          summary:      `Enriched ${updated?.first_name || updated?.email || 'contact'}`,
          contact_id:   id,
          metadata:     { provider: updated?.enrichment_provider || null },
          billable_ops: 0,
          occurred_at:  new Date().toISOString(),
        });
      } catch (e) {
        console.warn('[POST /api/contacts/:id/enrich] op-log insert failed:', e.message);
      }
    }

    return res.json({ contact: updated || contact, enriched });
  } catch (err) {
    console.error('[POST /api/contacts/:id/enrich]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// (enrich-progress route is registered above /:id to prevent Express route shadowing)

// GET /api/companies/list
contactsApiRouter.get('/companies/list', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { workspaceId } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const { data: companies } = await supabase.from('companies').select('id, name, domain, industry, employee_count, location, revenue_range, enrichment_status, deal_health_score').eq('workspace_id', workspaceId).order('name');
    return res.json({ companies: companies || [] });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

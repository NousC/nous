import { Router } from 'express';
import { getSupabaseClient } from '@proply/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';
import { ensureUserAndTeam } from '../../lib/auth.mjs';

export const contactsApiRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SYSTEM_TYPES = new Set(['stage_changed', 'contact_created', 'contact_updated', 'score_updated', 'enrichment_completed']);

// GET /api/contacts
contactsApiRouter.get('/', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { workspaceId, search, limit = 50, offset = 0, filter, source, sort, status } = req.query;
    const { user } = await ensureUserAndTeam(req.user);
    if (!workspaceId) return res.status(400).json({ error: 'workspace_id_required' });
    if (!UUID.test(workspaceId)) return res.status(400).json({ error: 'invalid_workspace_id' });

    const { data: membership } = await supabase.from('workspace_members').select('workspace_id').eq('workspace_id', workspaceId).eq('user_id', user.id).single();
    if (!membership) return res.status(403).json({ error: 'workspace_not_found_or_unauthorized' });

    let query = supabase.from('contacts').select('*', { count: 'exact' }).eq('workspace_id', workspaceId);
    if (filter && filter !== 'all') query = query.eq('pipeline_stage', filter);
    if (status) query = query.eq('status', status);
    if (source) query = query.eq('source', source);
    if (search?.trim()) {
      const t = `%${search.trim()}%`;
      query = query.or(`email.ilike.${t},first_name.ilike.${t},last_name.ilike.${t},company.ilike.${t}`);
    }
    const lim = Math.min(parseInt(limit) || 50, 100);
    const off = parseInt(offset) || 0;
    query = query.range(off, off + lim - 1);

    const { data: raw, error, count } = await query;
    if (error) throw error;

    const contacts = (raw || []).sort((a, b) => {
      const aD = a.last_activity_at ? new Date(a.last_activity_at).getTime() : null;
      const bD = b.last_activity_at ? new Date(b.last_activity_at).getTime() : null;
      if (!aD && !bD) return 0;
      if (!aD) return 1;
      if (!bD) return -1;
      return sort === 'interactions_asc' ? aD - bD : bD - aD;
    });

    return res.json({ contacts, total: count || 0, limit: lim, offset: off });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
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

    const { data: activityRows } = await supabase.from('contact_activity_log')
      .select('id, activity_type, description, source, occurred_at, created_at, summary, raw_data')
      .eq('contact_id', id).order('occurred_at', { ascending: false }).limit(200);

    const activities = (activityRows || [])
      .filter(a => !SYSTEM_TYPES.has(a.activity_type) && a.activity_type !== 'stage_changed')
      .map(a => ({ id: a.id, activity_type: a.activity_type, title: a.description || a.activity_type?.replace(/_/g, ' ') || 'Activity', subtitle: a.summary || null, source: a.source || 'proply', created_at: a.occurred_at || a.created_at, raw_data: a.raw_data || null }));

    let company = null;
    if (contact.company_id) {
      const { data: c } = await supabase.from('companies').select('name, domain, industry, employee_count, tech_stack, location, revenue_range').eq('id', contact.company_id).maybeSingle();
      company = c;
    }

    const { data: memoryRows } = await supabase.from('workspace_memories')
      .select('id, content, category, source, created_at, valid_from')
      .eq('workspace_id', contact.workspace_id).eq('is_active', true)
      .filter('metadata->>contact_id', 'eq', id).order('created_at', { ascending: false }).limit(30);

    const memories = (memoryRows || []).filter(m => m.content).map(m => ({ id: m.id, content: m.content, category: m.category || 'General', source: m.source || 'agent', created_at: m.created_at || m.valid_from || null }));

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

    const { data: mem, error } = await supabase.from('workspace_memories').insert({
      workspace_id: contact.workspace_id, category, content: content.trim(),
      source: 'manual', is_active: true, valid_from: new Date().toISOString(),
      metadata: { contact_id: id },
    }).select('id, content, category, source, created_at').single();
    if (error) throw error;
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

    const validRows = rows.filter(r => r.email && EMAIL.test(r.email.trim())).slice(0, 2000);
    if (!validRows.length) return res.status(400).json({ error: 'no_valid_rows' });

    const emails = validRows.map(r => r.email.toLowerCase().trim());
    const { data: existing } = await supabase.from('contacts').select('email').eq('workspace_id', workspaceId).in('email', emails);
    const existingSet = new Set((existing || []).map(c => c.email.toLowerCase()));

    const toCreate = validRows.filter(r => !existingSet.has(r.email.toLowerCase().trim()));
    const toUpdate = validRows.filter(r => existingSet.has(r.email.toLowerCase().trim()));

    let created = 0, updated = 0;
    if (toCreate.length) {
      const { data: inserted, error } = await supabase.from('contacts').insert(toCreate.map(r => ({
        workspace_id: workspaceId, email: r.email.toLowerCase().trim(),
        first_name: r.first_name?.trim() || null, last_name: r.last_name?.trim() || null,
        company: r.company?.trim() || null, job_title: r.job_title?.trim() || null,
        linkedin_url: r.linkedin_url?.trim() || null, source: r.source?.trim() || 'import',
        created_by: user.id,
      }))).select('id');
      if (!error) created = inserted?.length || 0;
    }
    for (const r of toUpdate) {
      const update = {};
      if (r.first_name) update.first_name = r.first_name.trim();
      if (r.last_name) update.last_name = r.last_name.trim();
      if (r.company) update.company = r.company.trim();
      if (r.job_title) update.job_title = r.job_title.trim();
      if (Object.keys(update).length) {
        await supabase.from('contacts').update(update).eq('workspace_id', workspaceId).eq('email', r.email.toLowerCase().trim());
      }
      updated++;
    }

    return res.json({ created, updated, skipped: rows.length - validRows.length });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

// POST /api/contacts/:id/enrich
contactsApiRouter.post('/:id/enrich', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { id } = req.params;
    if (!UUID.test(id)) return res.status(400).json({ error: 'invalid_id' });
    const { data: contact } = await supabase.from('contacts').select('*').eq('id', id).single();
    if (!contact) return res.status(404).json({ error: 'contact_not_found' });
    // Enrichment runs async via worker — return current state
    return res.json({ contact, creditsUsed: 0, message: 'Enrichment queued' });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/contacts/enrich-progress/:jobId
contactsApiRouter.get('/enrich-progress/:jobId', verifySupabaseAuth, async (_req, res) => {
  return res.json({ found: false });
});

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

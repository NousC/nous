import { Router } from 'express';
import {
  getSupabaseClient,
  listContacts,
  getContactByIdentifier,
  createContact,
  updateContact,
  deleteContact,
} from '@nous/core';
import { identifierType } from '@nous/core';
import { logMcpOp } from '../../lib/mcpLogger.mjs';

export const contactsRouter = Router();

// GET /v1/contacts
contactsRouter.get('/', async (req, res) => {
  try {
    const result = await listContacts(getSupabaseClient(), req.workspaceId, {
      search: req.query.search,
      pipeline_stage: req.query.pipeline_stage,
      company_id: req.query.company_id,
      ids: req.query.ids,
      filter: req.query.filter,
      sort: req.query.sort,
      linkedin_url: req.query.linkedin_url,
      limit: req.query.limit ? parseInt(req.query.limit) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset) : undefined,
    });
    const count = (result.contacts ?? []).length;
    const stage = req.query.pipeline_stage || req.query.stage;
    logMcpOp(req, {
      eventType: 'contact_list',
      summary: `${count} contact${count !== 1 ? 's' : ''}${stage ? ` · ${stage}` : ''}`,
    });
    return res.json(result);
  } catch (err) {
    console.error('[GET /v1/contacts]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /v1/contacts/:id
contactsRouter.get('/:id', async (req, res) => {
  try {
    const type = identifierType(req.params.id);
    if (!type) return res.status(400).json({ error: 'id_must_be_uuid_or_email' });

    const contact = await getContactByIdentifier(getSupabaseClient(), req.workspaceId, req.params.id);
    if (!contact) return res.status(404).json({ error: 'contact_not_found' });

    const nameParts = [contact.name || contact.email, contact.title, contact.company].filter(Boolean);
    const scoreParts = [
      contact.pipeline_stage,
      contact.icp_score != null ? `ICP ${contact.icp_score}` : null,
    ].filter(Boolean);
    logMcpOp(req, {
      eventType: 'contact_read',
      summary: [...nameParts, ...scoreParts].join(' · '),
      contactId: contact.id || contact.contact_id,
    });
    return res.json(contact);
  } catch (err) {
    console.error('[GET /v1/contacts/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /v1/contacts/:id/activity — deep timeline with tiered compression
contactsRouter.get('/:id/activity', async (req, res) => {
  try {
    const contact = await getContactByIdentifier(getSupabaseClient(), req.workspaceId, req.params.id);
    if (!contact) return res.status(404).json({ error: 'contact_not_found' });

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const since = req.query.since || null;
    const supabase = getSupabaseClient();

    let q = supabase
      .from('contact_activity_log')
      .select('id, activity_type, description, summary, source, occurred_at, raw_data')
      .eq('contact_id', contact.id)
      .order('occurred_at', { ascending: false })
      .limit(limit);
    if (since) q = q.gte('occurred_at', since);
    const { data: rows } = await q;

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    const activities = (rows || []).map(a => {
      const isRecent = a.occurred_at >= sevenDaysAgo;
      const isThirty = !isRecent && a.occurred_at >= thirtyDaysAgo;
      return {
        id: a.id,
        type: a.activity_type,
        source: a.source || null,
        occurred_at: a.occurred_at,
        // Tiered compression: full body ≤7d, excerpt 7-30d, type+date only >30d
        description: isRecent
          ? (a.description || a.summary || null)
          : isThirty
          ? (a.description || a.summary || '').slice(0, 400) || null
          : null,
        body: isRecent ? (a.raw_data?.body || a.raw_data?.message || null) : null,
      };
    });

    return res.json({ contact_id: contact.id, total: activities.length, activities });
  } catch (err) {
    console.error('[GET /v1/contacts/:id/activity]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /v1/contacts/:id/context — pre-formatted context block for agents
contactsRouter.get('/:id/context', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const contact = await getContactByIdentifier(supabase, req.workspaceId, req.params.id);
    if (!contact) return res.status(404).json({ error: 'contact_not_found' });

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    const [{ data: recentActs }, { data: olderActs }] = await Promise.all([
      supabase.from('contact_activity_log')
        .select('activity_type, description, source, occurred_at')
        .eq('contact_id', contact.id).gte('occurred_at', sevenDaysAgo)
        .order('occurred_at', { ascending: false }),
      supabase.from('contact_activity_log')
        .select('activity_type, description, source, occurred_at')
        .eq('contact_id', contact.id)
        .lt('occurred_at', sevenDaysAgo).gte('occurred_at', thirtyDaysAgo)
        .order('occurred_at', { ascending: false }).limit(5),
    ]);

    const header = [contact.name, contact.title, contact.company].filter(Boolean).join(' · ');
    const scores = [
      `Stage: ${contact.pipeline_stage}`,
      contact.icp_score != null ? `ICP: ${contact.icp_score}` : null,
      contact.deal_health_score != null ? `Health: ${contact.deal_health_score}` : null,
      contact.last_activity_at
        ? `Last seen: ${new Date(contact.last_activity_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
        : null,
    ].filter(Boolean).join('  |  ');

    const lines = [header, scores];
    if (contact.memory_summary) lines.push(`\nContext: ${contact.memory_summary}`);

    const fmt = a => {
      const date = new Date(a.occurred_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const desc = a.description ? `: ${a.description.slice(0, 100)}` : '';
      return `  ${date} — ${a.activity_type}${desc}`;
    };

    if (recentActs?.length) {
      lines.push(`\nThis week (${recentActs.length} touchpoint${recentActs.length !== 1 ? 's' : ''}):`);
      recentActs.forEach(a => lines.push(fmt(a)));
    } else {
      lines.push('\nThis week: no activity');
    }
    if (olderActs?.length) {
      lines.push('\nPrevious 30 days:');
      olderActs.forEach(a => lines.push(fmt(a)));
    }

    const allFacts = contact.facts || [];
    if (allFacts.length) {
      lines.push('\nFacts:');
      allFacts.forEach(f => lines.push(`  [${f.category}] ${f.content}`));
    }

    const block = lines.join('\n');
    return res.json({
      contact_id: contact.id,
      company_id: contact.company_id || null,
      context: block,
      token_estimate: Math.ceil(block.length / 4),
    });
  } catch (err) {
    console.error('[GET /v1/contacts/:id/context]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /v1/contacts
contactsRouter.post('/', async (req, res) => {
  try {
    const { email, first_name, last_name, company, job_title, phone, linkedin_url, notes } = req.body;
    if (!email?.trim()) return res.status(400).json({ error: 'email_required' });

    const contact = await createContact(getSupabaseClient(), req.workspaceId, {
      email, first_name, last_name, company, job_title, phone, linkedin_url, notes,
    });
    const nameParts = [contact.name || email, job_title, company].filter(Boolean);
    logMcpOp(req, {
      eventType: 'contact_create',
      summary: nameParts.join(' · '),
      contactId: contact.id,
    });
    return res.status(201).json(contact);
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: 'email_already_exists' });
    console.error('[POST /v1/contacts]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// PATCH /v1/contacts/:id
contactsRouter.patch('/:id', async (req, res) => {
  try {
    const contact = await updateContact(getSupabaseClient(), req.workspaceId, req.params.id, req.body);
    if (!contact) return res.status(404).json({ error: 'contact_not_found' });
    const changed = Object.keys(req.body).filter(k => req.body[k] != null).join(', ');
    logMcpOp(req, {
      eventType: 'contact_update',
      summary: `${contact.name || contact.email} · updated ${changed}`,
      contactId: contact.id,
    });
    return res.json(contact);
  } catch (err) {
    console.error('[PATCH /v1/contacts/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// DELETE /v1/contacts/:id
contactsRouter.delete('/:id', async (req, res) => {
  try {
    const result = await deleteContact(getSupabaseClient(), req.workspaceId, req.params.id);
    if (!result) return res.status(404).json({ error: 'contact_not_found' });
    logMcpOp(req, {
      eventType: 'contact_delete',
      summary: result.email || req.params.id,
    });
    return res.json(result);
  } catch (err) {
    console.error('[DELETE /v1/contacts/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Lead Lists — Adaptive Lead Scoring, Phase 4a.
// CRUD for lead lists and bulk lead import. See docs/adaptive-lead-scoring.md.

import { Router } from 'express';
import {
  getSupabaseClient,
  createLeadList,
  listLeadLists,
  getLeadList,
  updateLeadListColumns,
  insertLeads,
  listLeads,
  countLeadsByIcp,
  deleteLeads,
  deleteLeadList,
  updateLead,
  assertClaims,
} from '@nous/core';
import { hasFeature } from '../../lib/plans.mjs';
import { requireEnrichmentQuota, requireRecordsBalance } from '../../lib/access.mjs';
import { enrichContact } from '../../services/enrichment.mjs';
import { getVerifier, verifyLead, listConnectedVerifiers } from '../../services/verification.mjs';
import { listCampaigns, pushLeads, SEQUENCERS } from '../../services/sequencerPush.mjs';

export const leadListsRouter = Router();

// Max leads accepted per import request. The frontend chunks larger uploads.
const MAX_IMPORT = 2000;

// The native, system-managed "LinkedIn Engagers" list — auto-created for
// engagement-eligible workspaces and not user-deletable. The weekly worker
// fills it; this source value is the marker for both behaviours.
const ENGAGEMENT_SOURCE = 'linkedin_engagement';
const ENGAGEMENT_LIST_NAME = 'LinkedIn Engagers';
const ENGAGEMENT_ALLOWLIST = new Set(
  (process.env.LINKEDIN_ENGAGEMENT_WORKSPACES || '')
    .split(',').map(s => s.trim()).filter(Boolean),
);

// Pro/Growth/Partner plans (linkedinEngagement feature) or explicit allowlist → eligible.
function engagementEligible(req, workspaceId) {
  if (ENGAGEMENT_ALLOWLIST.has(workspaceId)) return true;
  return !!(req.plan && hasFeature(req.plan.id, 'linkedinEngagement'));
}

// GET /api/lead-lists?workspaceId=… — all lists in the workspace, with counts.
// For engagement-eligible workspaces, the native LinkedIn Engagers list is
// ensured to exist so it always shows as a default.
leadListsRouter.get('/', async (req, res) => {
  try {
    const workspaceId = req.query.workspaceId || req.workspaceId;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const supabase = getSupabaseClient();
    let lead_lists = await listLeadLists(supabase, workspaceId);
    if (engagementEligible(req, workspaceId) && !lead_lists.some(l => l.source === ENGAGEMENT_SOURCE)) {
      const created = await createLeadList(supabase, workspaceId, { name: ENGAGEMENT_LIST_NAME, source: ENGAGEMENT_SOURCE });
      lead_lists = [{ ...created, lead_count: 0 }, ...lead_lists];
    }
    // Native engagers list is always pinned leftmost (it's the locked default).
    lead_lists = [
      ...lead_lists.filter(l => l.source === ENGAGEMENT_SOURCE),
      ...lead_lists.filter(l => l.source !== ENGAGEMENT_SOURCE),
    ];
    return res.json({ lead_lists });
  } catch (err) {
    console.error('[GET /api/lead-lists]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/lead-lists — create a list. Body: { workspaceId?, name, source }.
// `workspaceId` is optional under API-key auth (the key implies the workspace);
// required under JWT auth where it identifies the workspace to act on.
leadListsRouter.post('/', async (req, res) => {
  try {
    const { name, source } = req.body;
    const workspaceId = req.body.workspaceId || req.workspaceId;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const lead_list = await createLeadList(getSupabaseClient(), workspaceId, { name, source });
    return res.status(201).json({ lead_list });
  } catch (err) {
    console.error('[POST /api/lead-lists]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/lead-lists/:id?workspaceId=… — one list.
leadListsRouter.get('/:id', async (req, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const lead_list = await getLeadList(getSupabaseClient(), workspaceId, req.params.id);
    if (!lead_list) return res.status(404).json({ error: 'not_found' });
    return res.json({ lead_list });
  } catch (err) {
    console.error('[GET /api/lead-lists/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// PATCH /api/lead-lists/:id — update a list's columns. Body: { workspaceId, columns }.
leadListsRouter.patch('/:id', async (req, res) => {
  try {
    const { workspaceId, columns } = req.body;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    if (!Array.isArray(columns)) return res.status(400).json({ error: 'columns array required' });
    const lead_list = await updateLeadListColumns(getSupabaseClient(), workspaceId, req.params.id, columns);
    if (!lead_list) return res.status(404).json({ error: 'not_found' });
    return res.json({ lead_list });
  } catch (err) {
    console.error('[PATCH /api/lead-lists/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// DELETE /api/lead-lists/:id — delete an entire list. Body/query: { workspaceId? }.
// Removes the list; the underlying entities + engagement history are kept.
leadListsRouter.delete('/:id', async (req, res) => {
  try {
    const workspaceId = req.body?.workspaceId || req.query.workspaceId || req.workspaceId;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const supabase = getSupabaseClient();
    // The native LinkedIn Engagers list is system-managed and not deletable.
    const list = await getLeadList(supabase, workspaceId, req.params.id);
    if (list?.source === ENGAGEMENT_SOURCE) {
      return res.status(403).json({ error: 'system_list', message: 'The LinkedIn Engagers list is managed automatically and can\'t be deleted.' });
    }
    const deleted = await deleteLeadList(supabase, workspaceId, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'not_found' });
    return res.json({ deleted: true });
  } catch (err) {
    console.error('[DELETE /api/lead-lists/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/lead-lists/:id/leads?workspaceId=&limit=&offset= — leads in a list.
leadListsRouter.get('/:id/leads', async (req, res) => {
  try {
    const { workspaceId, limit, offset, icp, sort, counts, status, reply, verified,
            channel, emailStatus, domain, size, source } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const supabase = getSupabaseClient();
    const validSort = ['recent', 'icp_score_desc', 'icp_score_asc'].includes(sort) ? sort : undefined;
    const str = (v) => (typeof v === 'string' && v ? v : undefined);
    const leads = await listLeads(supabase, workspaceId, req.params.id, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      icp: icp === 'true' || icp === 'false' ? icp : undefined,
      sort: validSort,
      status:      str(status),
      reply:       str(reply),
      verified:    str(verified),
      channel:     str(channel),
      emailStatus: str(emailStatus),
      domain:      str(domain),
      size:        str(size),
      source:      str(source),
    });
    // Return the ICP counts only when asked (the first page) — saves two
    // count queries on every page turn.
    const icpCounts = counts === '1'
      ? await countLeadsByIcp(supabase, workspaceId, req.params.id)
      : undefined;
    return res.json({ leads, counts: icpCounts });
  } catch (err) {
    console.error('[GET /api/lead-lists/:id/leads]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/lead-lists/:id/operations — the operations trail for ONE list, for
// the AGENT (the #1 consumer). This is deliberately NOT surfaced as a frontend
// filter: humans watch the live Ops stream; the agent calls this to answer
// "what happened on this list?" — imports, enrichment runs, pushes, replies,
// scoped to the list and filterable by category/date.
//   ?event=import|enrich|export|reply|score (metadata.category)  ?days=30|all  ?limit=
leadListsRouter.get('/:id/operations', async (req, res) => {
  try {
    const workspaceId = req.query.workspaceId || req.workspaceId;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const supabase = getSupabaseClient();
    const days = req.query.days === 'all' ? null : (parseInt(req.query.days, 10) || 30);
    const since = days ? new Date(Date.now() - days * 86400000).toISOString() : null;
    const category = typeof req.query.event === 'string' && req.query.event && req.query.event !== 'all'
      ? req.query.event : null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);

    let q = supabase.from('workspace_system_log')
      .select('id, source, event_type, summary, metadata, occurred_at')
      .eq('workspace_id', workspaceId)
      .eq('metadata->>lead_list_id', req.params.id)
      .order('occurred_at', { ascending: false })
      .limit(limit);
    if (since) q = q.gte('occurred_at', since);
    if (category) q = q.eq('metadata->>category', category);

    const { data, error } = await q;
    if (error) throw error;

    // Aggregate counts by category so the agent gets the shape at a glance.
    const by_category = {};
    for (const e of data || []) {
      const c = e.metadata?.category || e.event_type || 'other';
      by_category[c] = (by_category[c] || 0) + 1;
    }
    return res.json({ operations: data || [], by_category });
  } catch (err) {
    console.error('[GET /api/lead-lists/:id/operations]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/lead-lists/:id/leads — bulk import.
// Body: { workspaceId?, leads: [...], importDuplicates?: boolean }.
// `workspaceId` is optional under API-key auth (the key implies the workspace).
// `importDuplicates` defaults to false: rows whose email or normalized
// linkedin_url already exists in the workspace are skipped. Set true to
// force-insert; the response always includes a `duplicate_skipped` count.
leadListsRouter.post('/:id/leads', requireRecordsBalance, async (req, res) => {
  try {
    const { leads, importDuplicates, source } = req.body;
    const workspaceId = req.body.workspaceId || req.workspaceId;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'leads array required' });
    }
    if (leads.length > MAX_IMPORT) {
      return res.status(400).json({ error: `too many leads — max ${MAX_IMPORT} per request` });
    }
    const supabase = getSupabaseClient();
    // The list must exist in this workspace before we bulk-insert into it.
    const lead_list = await getLeadList(supabase, workspaceId, req.params.id);
    if (!lead_list) return res.status(404).json({ error: 'not_found' });
    // Lead source — every imported lead gets one so the agent can always read
    // where it came from. Per-row `source` wins; otherwise the import's `source`,
    // otherwise the list's own source label.
    const defaultSource = (typeof source === 'string' && source.trim())
      || lead_list.source || 'Import';
    const result = await insertLeads(supabase, workspaceId, req.params.id, leads, {
      importDuplicates: Boolean(importDuplicates),
      defaultSource,
    });
    // Tag the import as an operation on this list, with its source — the agent
    // reads these to attribute campaign performance back to where leads came from.
    if (result.inserted) {
      await supabase.from('workspace_system_log').insert({
        workspace_id: workspaceId, source: 'lead_list', event_type: 'leads_imported',
        summary: `Imported ${result.inserted} lead${result.inserted === 1 ? '' : 's'}`
          + (result.skipped ? ` · skipped ${result.skipped}` : '') + ` · source: ${defaultSource}`,
        metadata: { lead_list_id: req.params.id, category: 'import', source: defaultSource, inserted: result.inserted, skipped: result.skipped },
        billable_ops: 0, occurred_at: new Date().toISOString(),
      }).then(() => {}, () => {});
    }
    return res.status(201).json(result);
  } catch (err) {
    console.error('[POST /api/lead-lists/:id/leads]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// DELETE /api/lead-lists/:id/leads — remove selected leads from a list.
// Body: { workspaceId?, ids: [...] }. The operator's manual control step after
// ICP scoring. Returns { deleted }.
leadListsRouter.delete('/:id/leads', async (req, res) => {
  try {
    const { ids } = req.body;
    const workspaceId = req.body.workspaceId || req.workspaceId;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    const deleted = await deleteLeads(getSupabaseClient(), workspaceId, req.params.id, ids);
    return res.json({ deleted });
  } catch (err) {
    console.error('[DELETE /api/lead-lists/:id/leads]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/lead-lists/:id/leads/blank — append an empty row to the list (an
// entity with no identifiers, added to the list collection). Returns { id } so
// the UI can drop the row in instantly and let the user fill it inline. This is
// the Airtable-style "+ add row" — no email/linkedin required up front.
leadListsRouter.post('/:id/leads/blank', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.body.workspaceId || req.workspaceId;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const lead_list = await getLeadList(supabase, workspaceId, req.params.id);
    if (!lead_list) return res.status(404).json({ error: 'not_found' });

    const { data: ent, error } = await supabase
      .from('entities').insert({ workspace_id: workspaceId, type: 'person', status: 'active' })
      .select('id').single();
    if (error || !ent) throw error || new Error('entity insert failed');
    await supabase.from('collection_entities')
      .insert({ collection_id: req.params.id, entity_id: ent.id, source: 'Manual' })
      .then(() => {}, () => {});
    return res.status(201).json({ id: ent.id });
  } catch (err) {
    console.error('[POST /api/lead-lists/:id/leads/blank]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// PATCH /api/lead-lists/:id/leads/:leadId — inline-edit one field on a lead.
// Body: { workspaceId?, key, value }. key ∈ name | email | company | linkedin_url
// | <custom field key>. The lead id IS the entity id; name/company write sticky
// claims, email/linkedin_url swap the active identifier, custom keys merge fields.
leadListsRouter.patch('/:id/leads/:leadId', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.body.workspaceId || req.workspaceId;
    const { key } = req.body;
    const leadId = req.params.leadId;
    const value = typeof req.body.value === 'string' ? req.body.value.trim() : req.body.value;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    if (!key) return res.status(400).json({ error: 'key required' });

    // Confirm the lead is in this workspace + list before mutating its entity.
    const { data: lead } = await supabase
      .from('leads').select('id, fields')
      .eq('workspace_id', workspaceId).eq('lead_list_id', req.params.id).eq('id', leadId).maybeSingle();
    if (!lead) return res.status(404).json({ error: 'not_found' });

    if (key === 'name') {
      const [first, ...rest] = String(value || '').split(/\s+/).filter(Boolean);
      await assertClaims(supabase, workspaceId, leadId, { values: { first_name: first || '', last_name: rest.join(' ') || null } });
    } else if (key === 'company') {
      await assertClaims(supabase, workspaceId, leadId, { values: { company: value || null } });
    } else if (key === 'email' || key === 'linkedin_url') {
      const norm = key === 'email' ? String(value || '').toLowerCase() : String(value || '');
      // Retire the current active identifier of this kind, then add the new one.
      await supabase.from('entity_identifiers').update({ status: 'retired' })
        .eq('workspace_id', workspaceId).eq('entity_id', leadId).eq('kind', key).eq('status', 'active');
      if (norm) {
        await supabase.from('entity_identifiers')
          .insert({ workspace_id: workspaceId, entity_id: leadId, kind: key, value: norm, status: 'active' })
          .then(() => {}, () => {});
      }
    } else {
      const fields = { ...(lead.fields || {}), [key]: value };
      await updateLead(supabase, workspaceId, leadId, { fields });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[PATCH /api/lead-lists/:id/leads/:leadId]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Sync (inline) cap per request; larger selections go async via a bulk job.
const MAX_ENRICH = 200;
const MAX_BULK = 5000; // hard ceiling on a single background job

// PostgREST IN-lists can't hold thousands of ids — fetch leads in URL-safe chunks.
async function fetchLeadsByIds(supabase, workspaceId, listId, ids, columns) {
  const out = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('leads').select(columns)
      .eq('workspace_id', workspaceId).eq('lead_list_id', listId).in('id', ids.slice(i, i + 200));
    if (data) out.push(...data);
  }
  return out;
}

// Latest observation timestamp per entity for a method ('enrichment'|'verification'), chunked.
async function lastRunByEntity(supabase, workspaceId, method, entityIds) {
  const map = new Map();
  for (let i = 0; i < entityIds.length; i += 200) {
    const { data } = await supabase.from('observations').select('entity_id, observed_at')
      .eq('workspace_id', workspaceId).eq('method', method)
      .in('entity_id', entityIds.slice(i, i + 200)).order('observed_at', { ascending: false });
    for (const o of data || []) if (!map.has(o.entity_id)) map.set(o.entity_id, o.observed_at);
  }
  return map;
}

// Enqueue an async bulk enrich/verify job; the worker (bulkLeadJobs) drains it.
async function enqueueBulkJob(supabase, { workspaceId, listId, kind, provider, ids, createdBy }) {
  const { data, error } = await supabase.from('lead_bulk_jobs').insert({
    workspace_id: workspaceId, lead_list_id: listId, kind, provider: provider || null,
    total: ids.length, lead_ids: ids, created_by: createdBy || null,
  }).select('id').single();
  if (error) throw error;
  return data.id;
}

// POST /api/lead-lists/:id/enrich — find emails for selected leads (single or bulk)
// via the workspace's own Prospeo/Apollo key. Capped to the plan's remaining
// enrichment allowance; writes email + verification status back onto each lead.
leadListsRouter.post('/:id/enrich', requireEnrichmentQuota, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.body.workspaceId || req.workspaceId;
    const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, MAX_BULK) : [];
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    if (ids.length === 0) return res.status(400).json({ error: 'ids array required' });

    // Large selections run async — enqueue a job the worker drains with live
    // progress, instead of holding this request open for thousands of calls.
    if (req.body.background) {
      const jobId = await enqueueBulkJob(supabase, {
        workspaceId, listId: req.params.id, kind: 'enrich', ids, createdBy: req.userId,
      });
      return res.json({ job_id: jobId, status: 'pending', total: ids.length });
    }

    // Cap to the remaining monthly allowance (Infinity on self-host / BYOK).
    const cap = typeof req.enrichRemaining === 'number' ? req.enrichRemaining : Infinity;
    const leads = await fetchLeadsByIds(supabase, workspaceId, req.params.id, ids,
      'id, workspace_id, email, linkedin_url, name, company, domain, email_status');

    // Reuse-gate — never re-pay to enrich a lead we processed recently. The date
    // comes off the append-only enrichment observations (method='enrichment').
    const ENRICH_STALE_DAYS = 90;
    const staleBefore = Date.now() - ENRICH_STALE_DAYS * 86400000;
    const lastEnriched = await lastRunByEntity(supabase, workspaceId, 'enrichment', (leads || []).map(l => l.id));

    // Classify each lead the SAME way the run loop below does, so a dry-run
    // preview is exact. A lead is chargeable only if it has an identifier to
    // work from AND isn't a recently-enriched reuse.
    const classify = (l) => {
      if (!l.email && !l.linkedin_url) return 'no_identifier';
      const le = lastEnriched.get(l.id);
      if (l.email && l.email_status && le && new Date(le).getTime() >= staleBefore) return 'reused';
      return 'chargeable';
    };

    // Dry-run preview — return the cost breakdown without calling a provider or
    // writing anything. Powers the pre-flight confirmation modal.
    if (req.body.preview) {
      let chargeable = 0, reused = 0, noId = 0;
      for (const l of leads || []) {
        const c = classify(l);
        if (c === 'chargeable') chargeable++; else if (c === 'reused') reused++; else noId++;
      }
      return res.json({ preview: true, total: ids.length, chargeable, reused, no_identifier: noId });
    }

    let enriched = 0, skippedQuota = 0, skippedNoId = 0, skippedVerified = 0;
    for (const l of leads || []) {
      const c = classify(l);
      if (c === 'no_identifier') { skippedNoId++; continue; }
      if (c === 'reused') { skippedVerified++; continue; }
      if (enriched >= Math.min(cap, MAX_ENRICH)) { skippedQuota++; continue; }
      const [first, ...rest] = (l.name || '').trim().split(' ');
      const contact = {
        id: l.id, workspace_id: l.workspace_id, email: l.email, linkedin_url: l.linkedin_url,
        first_name: first || null, last_name: rest.join(' ') || null,
        company: l.company || null, domain: l.domain || null,
      };
      try {
        await enrichContact(supabase, contact);
        enriched++;
        await supabase.from('workspace_system_log').insert({
          workspace_id: workspaceId, source: 'enrichment', event_type: 'enrichment_run',
          summary: `Enriched ${l.name || l.email || 'lead'}`, contact_id: l.id,
          metadata: { from: 'lead_list' }, billable_ops: 0, occurred_at: new Date().toISOString(),
        }).then(() => {}, () => {});
      } catch (e) {
        console.warn('[POST /api/lead-lists/:id/enrich] enrich failed', l.id, e.message);
      }
    }
    // One batch op tagged to this list (the per-lead logs above stay unscoped,
    // so the list-scoped operations view shows clean run-level rows, not 1000s).
    await supabase.from('workspace_system_log').insert({
      workspace_id: workspaceId, source: 'enrichment', event_type: 'enrichment_run',
      summary: `Enriched ${enriched} lead${enriched === 1 ? '' : 's'}`
        + (skippedVerified ? ` · reused ${skippedVerified} already verified (no charge)` : ''),
      metadata: { lead_list_id: req.params.id, category: 'enrich', enriched, reused: skippedVerified, requested: ids.length },
      billable_ops: 0, occurred_at: new Date().toISOString(),
    }).then(() => {}, () => {});

    return res.json({ enriched, skipped_quota: skippedQuota, skipped_no_identifier: skippedNoId, skipped_already_verified: skippedVerified, requested: ids.length });
  } catch (err) {
    console.error('[POST /api/lead-lists/:id/enrich]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/lead-lists/:id/verify — validate deliverability of the emails on
// selected leads via the workspace's own MillionVerifier / NeverBounce key.
// Distinct from /enrich: this only acts on leads that ALREADY have an email,
// and the verifier's verdict upgrades the email_status shown on the lead.
// Same plan allowance + 90-day reuse-gate as enrichment.
const MAX_VERIFY = 200;
leadListsRouter.post('/:id/verify', requireEnrichmentQuota, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.body.workspaceId || req.workspaceId;
    const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, MAX_BULK) : [];
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    if (ids.length === 0) return res.status(400).json({ error: 'ids array required' });

    // Which verifiers are connected — drives the modal's provider picker and the
    // "connect a verifier" prompt when none exist.
    const connected = await listConnectedVerifiers(supabase, workspaceId);
    if (connected.length === 0) return res.status(409).json({ error: 'no_verifier_connected' });

    // Large selections run async — enqueue a job the worker drains with live
    // progress. Honour the provider the user picked in the modal.
    if (req.body.background) {
      const provider = connected.includes(req.body.provider) ? req.body.provider : connected[0];
      const jobId = await enqueueBulkJob(supabase, {
        workspaceId, listId: req.params.id, kind: 'verify', provider, ids, createdBy: req.userId,
      });
      return res.json({ job_id: jobId, status: 'pending', total: ids.length, provider });
    }

    const cap = typeof req.enrichRemaining === 'number' ? req.enrichRemaining : Infinity;
    const leads = await fetchLeadsByIds(supabase, workspaceId, req.params.id, ids,
      'id, workspace_id, email, name');

    // Reuse-gate — never re-pay to re-verify within VERIFY_STALE_DAYS. The last
    // verification date comes off the append-only verification observations.
    const VERIFY_STALE_DAYS = 90;
    const staleBefore = Date.now() - VERIFY_STALE_DAYS * 86400000;
    const lastVerified = await lastRunByEntity(supabase, workspaceId, 'verification', (leads || []).map(l => l.id));

    // Pre-check: a lead is verifiable only if it HAS an email and wasn't verified
    // recently. Same classification the run loop uses, so the preview is exact.
    const classify = (l) => {
      if (!l.email) return 'no_email';
      const lv = lastVerified.get(l.id);
      if (lv && new Date(lv).getTime() >= staleBefore) return 'reused';
      return 'chargeable';
    };

    // Dry-run preview — cost breakdown + which verifiers are connected, without
    // spending a credit. Powers the pre-flight confirmation modal + picker.
    if (req.body.preview) {
      let chargeable = 0, reused = 0, noEmail = 0;
      for (const l of leads || []) {
        const c = classify(l);
        if (c === 'chargeable') chargeable++; else if (c === 'reused') reused++; else noEmail++;
      }
      return res.json({ preview: true, total: ids.length, chargeable, reused, no_email: noEmail, connected_verifiers: connected });
    }

    // Resolve the verifier to run with — honour the provider the user picked in
    // the modal (falls back to MillionVerifier→NeverBounce preference).
    const verifier = await getVerifier(supabase, workspaceId, req.body.provider);
    if (!verifier) return res.status(409).json({ error: 'no_verifier_connected' });

    let deliverable = 0, risky = 0, undeliverable = 0;
    let skippedNoEmail = 0, skippedRecent = 0, skippedQuota = 0;
    for (const l of leads || []) {
      const c = classify(l);
      if (c === 'no_email') { skippedNoEmail++; continue; }
      if (c === 'reused') { skippedRecent++; continue; }
      if (deliverable + risky + undeliverable >= Math.min(cap, MAX_VERIFY)) { skippedQuota++; continue; }
      try {
        const status = await verifyLead(supabase, verifier, l);
        if (status === 'DELIVERABLE')      deliverable++;
        else if (status === 'RISKY')       risky++;
        else if (status === 'UNAVAILABLE') undeliverable++;
      } catch (e) {
        console.warn('[POST /api/lead-lists/:id/verify] verify failed', l.id, e.message);
      }
    }
    const verified = deliverable + risky + undeliverable;
    // One run-level op tagged to this list (per-lead logs stay unscoped, like enrich).
    await supabase.from('workspace_system_log').insert({
      workspace_id: workspaceId, source: verifier.provider, event_type: 'verification_run',
      summary: `Verified ${verified} email${verified === 1 ? '' : 's'} (${deliverable} deliverable · ${risky} risky · ${undeliverable} undeliverable)`
        + (skippedRecent ? ` · reused ${skippedRecent} recently verified (no charge)` : ''),
      metadata: { lead_list_id: req.params.id, category: 'verify', provider: verifier.provider, deliverable, risky, undeliverable, reused: skippedRecent, requested: ids.length },
      billable_ops: 0, occurred_at: new Date().toISOString(),
    }).then(() => {}, () => {});

    return res.json({
      verified, deliverable, risky, undeliverable,
      skipped_no_email: skippedNoEmail, skipped_already_verified: skippedRecent,
      skipped_quota: skippedQuota, provider: verifier.provider, requested: ids.length,
    });
  } catch (err) {
    console.error('[POST /api/lead-lists/:id/verify]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/lead-lists/:id/jobs/active — the latest unfinished bulk job for this
// list, so the frontend can resume the progress bar after a reload. Returns
// { job: null } when none is running.
leadListsRouter.get('/:id/jobs/active', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.query.workspaceId || req.workspaceId;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const { data, error } = await supabase
      .from('lead_bulk_jobs')
      .select('id, kind, provider, status, total, processed, result, created_at')
      .eq('workspace_id', workspaceId).eq('lead_list_id', req.params.id)
      .in('status', ['pending', 'running'])
      .order('created_at', { ascending: false }).limit(1);
    if (error?.code === '42P01' || error?.code === 'PGRST205') return res.json({ job: null });
    if (error) throw error;
    return res.json({ job: data?.[0] || null });
  } catch (err) {
    console.error('[GET /api/lead-lists/:id/jobs/active]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/lead-lists/:id/jobs/:jobId — poll one bulk job's progress/result.
leadListsRouter.get('/:id/jobs/:jobId', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.query.workspaceId || req.workspaceId;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const { data, error } = await supabase
      .from('lead_bulk_jobs')
      .select('id, kind, provider, status, total, processed, result, error, created_at, finished_at')
      .eq('workspace_id', workspaceId).eq('lead_list_id', req.params.id).eq('id', req.params.jobId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'not_found' });
    return res.json({ job: data });
  } catch (err) {
    console.error('[GET /api/lead-lists/:id/jobs/:jobId]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/lead-lists/:id/tag-channel — tag leads with the channel/tool they were
// exported into (e.g. a CSV download into a non-integrated sequencer) so the
// Channel column tracks where they went. Body: { workspaceId?, channel, ids? }.
// With no ids, tags every lead in the list (capped). Mirrors the /push tagging.
const MAX_TAG = 5000;
leadListsRouter.post('/:id/tag-channel', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.body.workspaceId || req.workspaceId;
    const channel = typeof req.body.channel === 'string' ? req.body.channel.trim() : '';
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    if (!channel) return res.status(400).json({ error: 'channel required' });

    let ids = Array.isArray(req.body.ids) && req.body.ids.length ? req.body.ids.slice(0, MAX_TAG) : null;
    if (!ids) {
      const { data } = await supabase.from('leads').select('id')
        .eq('workspace_id', workspaceId).eq('lead_list_id', req.params.id).limit(MAX_TAG);
      ids = (data || []).map(r => r.id);
    }
    if (ids.length === 0) return res.json({ tagged: 0 });

    const nowISO = new Date().toISOString();
    const obs = ids.map(id => ({
      workspace_id: workspaceId, entity_id: id, kind: 'event',
      property: 'interaction.added_to_campaign',
      value: { provider: 'csv_export', channel },
      source: channel, method: 'csv_export', observed_at: nowISO,
    }));
    for (let i = 0; i < obs.length; i += 1000) {
      await supabase.from('observations').insert(obs.slice(i, i + 1000))
        .then(() => {}, e => console.warn('[tag-channel] insert failed', e.message));
    }
    return res.json({ tagged: ids.length, channel });
  } catch (err) {
    console.error('[POST /api/lead-lists/:id/tag-channel]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/lead-lists/sequencer/campaigns?workspaceId=&provider=instantly
// Lists the connected sequencer's campaigns for the export picker.
leadListsRouter.get('/sequencer/campaigns', async (req, res) => {
  try {
    const { workspaceId, provider } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    if (!SEQUENCERS.includes(provider)) return res.status(400).json({ error: 'unsupported_provider', supported: SEQUENCERS });
    const out = await listCampaigns(getSupabaseClient(), workspaceId, provider);
    return res.json(out);
  } catch (err) {
    console.error('[GET /api/lead-lists/sequencer/campaigns]', err);
    return res.status(502).json({ error: 'provider_error', message: err.message });
  }
});

// POST /api/lead-lists/:id/push — push selected leads into a sequencer campaign,
// then tag each pushed lead with the channel it went out on.
const MAX_PUSH = 1000;
leadListsRouter.post('/:id/push', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.body.workspaceId || req.workspaceId;
    const { provider, campaignId, campaignName } = req.body;
    const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, MAX_PUSH) : [];
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    if (!SEQUENCERS.includes(provider)) return res.status(400).json({ error: 'unsupported_provider' });
    if (!campaignId) return res.status(400).json({ error: 'campaignId required' });
    if (ids.length === 0) return res.status(400).json({ error: 'ids array required' });

    const { data: rows } = await supabase
      .from('leads').select('id, email, linkedin_url, name, company')
      .eq('workspace_id', workspaceId).eq('lead_list_id', req.params.id).in('id', ids);
    const leads = (rows || []).map(l => {
      const [first, ...rest] = (l.name || '').trim().split(' ');
      return { id: l.id, email: l.email, linkedin_url: l.linkedin_url, first_name: first || null, last_name: rest.join(' ') || null, company: l.company };
    });

    const result = await pushLeads(supabase, workspaceId, provider, campaignId, leads);
    if (!result.ok) return res.status(result.error === 'not_connected' ? 409 : 502).json(result);

    // Tag pushed leads — an interaction observation so the Channel column reflects
    // where they went (instantly/lemlist = Email, heyreach = LinkedIn) and the
    // timeline shows the campaign.
    const pushed = leads.filter(l => l.email || l.linkedin_url).slice(0, result.pushed);
    if (pushed.length) {
      const nowISO = new Date().toISOString();
      const obs = pushed.map(l => ({
        workspace_id: workspaceId, entity_id: l.id, kind: 'event',
        property: 'interaction.added_to_campaign',
        value: { provider, campaign_id: campaignId, campaign_name: campaignName || null },
        source: provider, method: 'api', observed_at: nowISO,
      }));
      await supabase.from('observations').insert(obs).then(() => {}, e => console.warn('[push] tag insert failed', e.message));
    }
    // Tag the push as an export operation on this list (provider + channel), so
    // reply outcomes can be attributed back to the campaign this list fed.
    await supabase.from('workspace_system_log').insert({
      workspace_id: workspaceId, source: provider, event_type: 'pushed_to_campaign',
      summary: `Pushed ${result.pushed} lead${result.pushed === 1 ? '' : 's'} → ${campaignName || provider}`,
      metadata: { lead_list_id: req.params.id, category: 'export', provider, campaign_id: campaignId, campaign_name: campaignName || null, pushed: result.pushed },
      billable_ops: 0, occurred_at: new Date().toISOString(),
    }).then(() => {}, () => {});
    return res.json({ ...result, requested: ids.length });
  } catch (err) {
    console.error('[POST /api/lead-lists/:id/push]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

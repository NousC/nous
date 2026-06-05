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
} from '@nous/core';
import { hasFeature } from '../../lib/plans.mjs';

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

// Scale plan (linkedinEngagement feature) or explicit allowlist → eligible.
function engagementEligible(req, workspaceId) {
  if (ENGAGEMENT_ALLOWLIST.has(workspaceId)) return true;
  return !!(req.plan && hasFeature(req.plan.id, 'linkedinEngagement'));
}

// GET /api/lead-lists?workspaceId=… — all lists in the workspace, with counts.
// For engagement-eligible workspaces, the native LinkedIn Engagers list is
// ensured to exist so it always shows as a default.
leadListsRouter.get('/', async (req, res) => {
  try {
    const { workspaceId } = req.query;
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
    const { workspaceId, limit, offset, icp, sort, counts, status, reply, verified } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });
    const supabase = getSupabaseClient();
    const validSort = ['recent', 'icp_score_desc', 'icp_score_asc'].includes(sort) ? sort : undefined;
    const leads = await listLeads(supabase, workspaceId, req.params.id, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      icp: icp === 'true' || icp === 'false' ? icp : undefined,
      sort: validSort,
      status:   typeof status === 'string'   ? status   : undefined,
      reply:    typeof reply === 'string'    ? reply    : undefined,
      verified: typeof verified === 'string' ? verified : undefined,
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

// POST /api/lead-lists/:id/leads — bulk import.
// Body: { workspaceId?, leads: [...], importDuplicates?: boolean }.
// `workspaceId` is optional under API-key auth (the key implies the workspace).
// `importDuplicates` defaults to false: rows whose email or normalized
// linkedin_url already exists in the workspace are skipped. Set true to
// force-insert; the response always includes a `duplicate_skipped` count.
leadListsRouter.post('/:id/leads', async (req, res) => {
  try {
    const { leads, importDuplicates } = req.body;
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
    const result = await insertLeads(supabase, workspaceId, req.params.id, leads, {
      importDuplicates: Boolean(importDuplicates),
    });
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

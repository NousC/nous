import { Router } from 'express';
import { getSupabaseClient, getCompanyProfile } from '@nous/core';
import { logMcpOp } from '../../lib/mcpLogger.mjs';

export const companiesRouter = Router();

// GET /v1/companies/:id/stakeholders — buying committee for a company
companiesRouter.get('/:id/stakeholders', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { id } = req.params;
    const workspaceId = req.workspaceId;

    // Fetch company
    const { data: company } = await supabase
      .from('companies')
      .select('id, name, domain, industry')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (!company) return res.status(404).json({ error: 'company_not_found' });

    // All contacts at this company
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, email, job_title, seniority, pipeline_stage, icp_score')
      .eq('workspace_id', workspaceId)
      .eq('company_id', id)
      .order('icp_score', { ascending: false, nullsLast: true });

    const contactIds = (contacts || []).map(c => c.id);

    // Graph edges involving these contacts or the company itself
    let edges = [];
    if (contactIds.length > 0) {
      const [bySubject, byObject, byCompany] = await Promise.all([
        supabase.from('workspace_graph_edges')
          .select('subject_type, subject_id, subject_label, relationship, object_type, object_id, object_label, confidence')
          .eq('workspace_id', workspaceId)
          .in('subject_id', contactIds),
        supabase.from('workspace_graph_edges')
          .select('subject_type, subject_id, subject_label, relationship, object_type, object_id, object_label, confidence')
          .eq('workspace_id', workspaceId)
          .in('object_id', contactIds),
        supabase.from('workspace_graph_edges')
          .select('subject_type, subject_id, subject_label, relationship, object_type, object_id, object_label, confidence')
          .eq('workspace_id', workspaceId)
          .eq('object_id', id)
          .eq('object_type', 'company'),
      ]);

      const seen = new Set();
      for (const row of [...(bySubject.data || []), ...(byObject.data || []), ...(byCompany.data || [])]) {
        const key = `${row.subject_label}|${row.relationship}|${row.object_label}`;
        if (!seen.has(key)) { seen.add(key); edges.push(row); }
      }
    }

    // Derive roles per contact from edge relationships
    const contactMap = new Map((contacts || []).map(c => [c.id, { ...c, name: [c.first_name, c.last_name].filter(Boolean).join(' '), roles: [] }]));
    const ROLE_MAP = {
      CHAMPION_AT:      'champion',
      BUDGET_HOLDER_AT: 'budget_holder',
      BLOCKER_AT:       'blocker',
      DECISION_MAKER_AT:'decision_maker',
      INFLUENCER_AT:    'influencer',
      END_USER_AT:      'end_user',
    };

    for (const edge of edges) {
      if (edge.subject_id && contactMap.has(edge.subject_id)) {
        const role = ROLE_MAP[edge.relationship];
        if (role) {
          const c = contactMap.get(edge.subject_id);
          if (!c.roles.includes(role)) c.roles.push(role);
        }
      }
    }

    return res.json({
      company,
      contacts: Array.from(contactMap.values()),
      edges: edges.map(e => ({
        subject: e.subject_label,
        subject_id: e.subject_id,
        relationship: e.relationship,
        object: e.object_label,
        object_id: e.object_id,
        confidence: e.confidence,
      })),
    });
  } catch (err) {
    console.error('[GET /v1/companies/:id/stakeholders]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /v1/companies/:id
companiesRouter.get('/:id', async (req, res) => {
  try {
    const company = await getCompanyProfile(getSupabaseClient(), req.workspaceId, req.params.id);
    if (!company) return res.status(404).json({ error: 'company_not_found' });
    const parts = [company.name, company.domain, company.industry].filter(Boolean);
    if (company.employee_count) parts.push(`${company.employee_count} employees`);
    logMcpOp(req, {
      eventType: 'company_read',
      summary: parts.join(' · '),
    });
    return res.json(company);
  } catch (err) {
    console.error('[GET /v1/companies/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

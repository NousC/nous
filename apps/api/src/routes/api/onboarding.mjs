import { Router } from 'express';
import { getSupabaseClient } from '@nous/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';
import { ensureUserAndTeam } from '../../lib/auth.mjs';

export const onboardingRouter = Router();

// POST /api/onboarding/step-1 — save company name + website to workspace
onboardingRouter.post('/step-1', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { user, team } = await ensureUserAndTeam(req.user);
    const { company_name, website, use_case } = req.body;

    // Find the user's workspace for this team (same pattern as /complete)
    const { data: wms } = await supabase
      .from('workspace_members')
      .select('workspace_id, workspaces:workspace_id(id, team_id)')
      .eq('user_id', user.id);
    const match = (wms || []).find(m => m.workspaces?.team_id === team.id);
    const workspaceId = match?.workspace_id || null;

    if (workspaceId && company_name?.trim()) {
      await supabase.from('workspaces')
        .update({ name: company_name.trim() })
        .eq('id', workspaceId);
    }

    // Store use-case and website as workspace memories for AI context
    const memories = [];
    if (use_case?.trim()) memories.push(`Use case: ${use_case.trim()}`);
    if (website?.trim()) memories.push(`Company website: ${website.trim()}`);
    for (const content of memories) {
      await supabase.from('workspace_memories').insert({
        workspace_id: workspaceId,
        category: 'Company',
        content,
        source: 'onboarding',
        is_active: true,
      }).catch(() => {});
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/onboarding/step-1]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/onboarding/icp — capture target buyer profile
onboardingRouter.post('/icp', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { user, team } = await ensureUserAndTeam(req.user);
    const { roles, company_size, industries, geos } = req.body || {};

    const { data: wms } = await supabase
      .from('workspace_members')
      .select('workspace_id, workspaces:workspace_id(id, team_id)')
      .eq('user_id', user.id);
    const workspaceId = (wms || []).find(m => m.workspaces?.team_id === team.id)?.workspace_id;
    if (!workspaceId) return res.status(404).json({ error: 'no_workspace' });

    const lines = [];
    if (Array.isArray(roles) && roles.length)       lines.push(`Target roles: ${roles.join(', ')}`);
    if (company_size?.trim())                       lines.push(`Target company size: ${company_size.trim()}`);
    if (Array.isArray(industries) && industries.length) lines.push(`Target industries: ${industries.join(', ')}`);
    if (Array.isArray(geos) && geos.length)         lines.push(`Target geographies: ${geos.join(', ')}`);

    for (const content of lines) {
      await supabase.from('workspace_memories').insert({
        workspace_id: workspaceId,
        category: 'ICP',
        content,
        source: 'onboarding',
        is_active: true,
      }).catch(() => {});
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/onboarding/icp]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Sample contacts inserted on /complete when the workspace is empty.
// Gives the user something to query against from day one.
const SAMPLE_CONTACTS = [
  { email: 'priya.shah@acme.io',     first_name: 'Priya',   last_name: 'Shah',     company: 'Acme',         domain: 'acme.io',     job_title: 'VP Sales',          source: 'sample' },
  { email: 'marcus.lee@northwind.co',first_name: 'Marcus',  last_name: 'Lee',      company: 'Northwind',    domain: 'northwind.co',job_title: 'Head of GTM',       source: 'sample' },
  { email: 'sara.koenig@lattice.dev',first_name: 'Sara',    last_name: 'Koenig',   company: 'Lattice',      domain: 'lattice.dev', job_title: 'Director of RevOps',source: 'sample' },
  { email: 'jp.romero@helix.ai',     first_name: 'JP',      last_name: 'Romero',   company: 'Helix',        domain: 'helix.ai',    job_title: 'Founder',           source: 'sample' },
  { email: 'aisha.okafor@orbital.io',first_name: 'Aisha',   last_name: 'Okafor',   company: 'Orbital',      domain: 'orbital.io',  job_title: 'Head of Growth',    source: 'sample' },
  { email: 'tom.bauer@kestrel.so',   first_name: 'Tom',     last_name: 'Bauer',    company: 'Kestrel',      domain: 'kestrel.so',  job_title: 'CRO',               source: 'sample' },
];

// POST /api/onboarding/complete
onboardingRouter.post('/complete', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { template_id } = req.body;
    const { user, team } = await ensureUserAndTeam(req.user);

    let workspace = null;
    if (template_id) {
      const { data: tpl } = await supabase.from('templates').select('id, workspace_id, team_id').eq('id', template_id).single();
      if (!tpl) return res.status(404).json({ error: 'template_not_found' });
      if (tpl.team_id !== team.id) return res.status(403).json({ error: 'template_not_authorized' });
      const { data: ws } = await supabase.from('workspaces').select('*').eq('id', tpl.workspace_id).single();
      workspace = ws;
    } else {
      const { data: wms } = await supabase.from('workspace_members').select('workspace_id, workspaces:workspace_id(*)').eq('user_id', user.id);
      const match = wms?.find(m => m.workspaces?.team_id === team.id);
      workspace = match?.workspaces || null;
    }

    // Seed demo contacts if the workspace is empty, so the dashboard isn't blank.
    if (workspace?.id) {
      const { count } = await supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspace.id);
      if (!count) {
        await supabase.from('contacts').insert(
          SAMPLE_CONTACTS.map(c => ({ ...c, workspace_id: workspace.id, created_by: user.id }))
        ).catch(() => {});
      }
    }

    if (!user.onboarding_completed_at) {
      await supabase.from('users').update({ onboarding_completed_at: new Date().toISOString() }).eq('id', user.id);
    }

    return res.json({ success: true, workspace });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

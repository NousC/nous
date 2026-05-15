import { Router } from 'express';
import { getSupabaseClient } from '@proply/core';
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

    if (!user.onboarding_completed_at) {
      await supabase.from('users').update({ onboarding_completed_at: new Date().toISOString() }).eq('id', user.id);
    }

    return res.json({ success: true, workspace });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

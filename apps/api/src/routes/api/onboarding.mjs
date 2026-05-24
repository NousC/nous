import { Router } from 'express';
import { getSupabaseClient, saveNote } from '@nous/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';
import { ensureUserAndTeam } from '../../lib/auth.mjs';

export const onboardingRouter = Router();

// POST /api/onboarding/step-1 — save company name + website to workspace
onboardingRouter.post('/step-1', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { user, team } = await ensureUserAndTeam(req.user);
    const { name, company_name, website, icp_description } = req.body;

    // Find the user's workspace for this team (same pattern as /complete)
    const { data: wms } = await supabase
      .from('workspace_members')
      .select('workspace_id, workspaces:workspace_id(id, team_id)')
      .eq('user_id', user.id);
    const match = (wms || []).find(m => m.workspaces?.team_id === team.id);
    const workspaceId = match?.workspace_id || null;

    if (name?.trim()) {
      await supabase.from('users')
        .update({ name: name.trim() })
        .eq('id', user.id)
        .catch(() => {});
    }

    if (workspaceId && company_name?.trim()) {
      await supabase.from('workspaces')
        .update({ name: company_name.trim() })
        .eq('id', workspaceId);
    }

    if (workspaceId) {
      if (website?.trim()) {
        await saveNote(supabase, workspaceId, {
          category: 'Company',
          content: `Company website: ${website.trim()}`,
          source: 'onboarding',
        }).catch(() => {});
      }
      // 'ICP' category seeds the Scorecard auto-build on the Intelligence page.
      if (icp_description?.trim()) {
        await saveNote(supabase, workspaceId, {
          category: 'ICP',
          content: icp_description.trim(),
          source: 'onboarding',
        }).catch(() => {});
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/onboarding/step-1]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// Fire-and-forget POST to ONBOARDING_WEBHOOK_URL when a user finishes onboarding.
// Lets external systems (Slack, Zapier, n8n, CRM) react to new signups.
async function fireOnboardingWebhook(payload) {
  const url = process.env.ONBOARDING_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[onboarding webhook] failed:', err?.message || err);
  }
}

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

    const isFirstCompletion = !user.onboarding_completed_at;
    if (isFirstCompletion) {
      await supabase.from('users').update({ onboarding_completed_at: new Date().toISOString() }).eq('id', user.id);
    }

    // Outbound webhook — only on first completion, fire-and-forget.
    if (isFirstCompletion) {
      fireOnboardingWebhook({
        event: 'onboarding.completed',
        timestamp: new Date().toISOString(),
        user: { id: user.id, name: user.name || null, email: user.email || null },
        workspace: workspace ? { id: workspace.id, name: workspace.name } : null,
        team: { id: team.id, name: team.name || null },
      });
    }

    return res.json({ success: true, workspace });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

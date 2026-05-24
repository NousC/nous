import { Router } from 'express';
import { getSupabaseClient, saveNote, listNotes } from '@nous/core';
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

// GET /api/onboarding/checklist?workspaceId=... — 5-item post-onboarding progress.
// Prefers req.workspaceId (set by middleware from query), falls back to the
// user's first workspace via workspace_members. The query param is what the
// frontend actually sends, so it stays accurate when a user has many workspaces.
onboardingRouter.get('/checklist', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();

    let workspaceId = req.workspaceId || null;
    if (!workspaceId) {
      const { user, team } = await ensureUserAndTeam(req.user);
      const { data: wms } = await supabase
        .from('workspace_members')
        .select('workspace_id, workspaces:workspace_id(id, team_id)')
        .eq('user_id', user.id);
      const match = (wms || []).find(m => m.workspaces?.team_id === team.id);
      workspaceId = match?.workspace_id || null;
    }
    if (!workspaceId) {
      return res.json({ steps: [], completed_count: 0, total: 5, workspaceId: null });
    }

    const safe = async (fn) => { try { return await fn(); } catch (e) { return { error: String(e?.message || e) }; } };

    // Fetch api_keys once and filter in JS — more reliable than .is()/.not() chains.
    const [icpNotes, scorecardSignals, contacts, apiKeys, webhooks] = await Promise.all([
      safe(() => listNotes(supabase, workspaceId, { categories: ['ICP'] })),
      safe(async () => {
        const { data } = await supabase
          .from('scorecard_signals')
          .select('id')
          .eq('workspace_id', workspaceId)
          .limit(1);
        return data ?? [];
      }),
      safe(async () => {
        const { count } = await supabase
          .from('contacts')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId);
        return count ?? 0;
      }),
      safe(async () => {
        const { data } = await supabase
          .from('api_keys')
          .select('id, revoked_at, last_used_at')
          .eq('workspace_id', workspaceId);
        return data ?? [];
      }),
      safe(async () => {
        const { count } = await supabase
          .from('workspace_webhook_subscriptions')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId);
        return count ?? 0;
      }),
    ]);

    const icpCount       = Array.isArray(icpNotes)        ? icpNotes.length : 0;
    const signalCount    = Array.isArray(scorecardSignals) ? scorecardSignals.length : 0;
    const contactCount   = typeof contacts === 'number'   ? contacts : 0;
    const apiKeyRows     = Array.isArray(apiKeys)         ? apiKeys : [];
    const activeKeyCount = apiKeyRows.filter(k => !k.revoked_at).length;
    const usedKeyCount   = apiKeyRows.filter(k => !!k.last_used_at).length;
    const webhookCount   = typeof webhooks === 'number'   ? webhooks : 0;

    // ICP done = either workspace has an ICP-category memory OR a Scorecard exists.
    const icpDone = icpCount > 0 || signalCount > 0;

    const steps = [
      { id: 'icp',      label: 'Describe your ICP',  completed: icpDone,                href: '/intelligence' },
      { id: 'contacts', label: 'Bring contacts in',  completed: contactCount > 0,       href: '/people' },
      { id: 'api_key',  label: 'Create an API key',  completed: activeKeyCount > 0,     href: '/keys' },
      { id: 'install',  label: 'Install Nous',       completed: usedKeyCount > 0,       href: '/install' },
      { id: 'webhooks', label: 'Set up 3 webhooks',  completed: webhookCount >= 3,      href: '/webhooks' },
    ];

    const debug = process.env.NODE_ENV !== 'production' ? {
      workspaceId,
      counts: { icpCount, signalCount, contactCount, activeKeyCount, usedKeyCount, webhookCount },
      errors: {
        icp:       icpNotes?.error ?? null,
        scorecard: scorecardSignals?.error ?? null,
        contacts:  typeof contacts !== 'number' ? contacts?.error ?? null : null,
        apiKeys:   !Array.isArray(apiKeys) ? apiKeys?.error ?? null : null,
        webhooks:  typeof webhooks !== 'number' ? webhooks?.error ?? null : null,
      },
    } : undefined;

    return res.json({
      steps,
      completed_count: steps.filter(s => s.completed).length,
      total: steps.length,
      ...(debug ? { debug } : {}),
    });
  } catch (err) {
    console.error('[GET /api/onboarding/checklist]', err);
    return res.status(500).json({ error: 'internal_error', detail: String(err?.message || err) });
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

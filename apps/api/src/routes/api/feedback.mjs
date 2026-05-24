import { Router } from 'express';
import { getSupabaseClient } from '@nous/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';
import { ensureUserAndTeam } from '../../lib/auth.mjs';

export const feedbackRouter = Router();

// Default to the n8n webhook the user provided; override via env if needed.
const DEFAULT_WEBHOOK = 'https://primary-production-5015.up.railway.app/webhook/2fe97712-6cc7-494e-8a22-e0fe7882f1aa';
const WEBHOOK_URL = process.env.FEEDBACK_WEBHOOK_URL || DEFAULT_WEBHOOK;

// POST /api/feedback
// Body: { type: 'idea' | 'bug', message, videoLink?, companyName?, companyUrl?, context? }
// Enriches with authed user + team, then forwards to the configured webhook.
feedbackRouter.post('/', verifySupabaseAuth, async (req, res) => {
  try {
    const { type, message, videoLink, companyName, companyUrl, context } = req.body || {};

    if (!type || (type !== 'idea' && type !== 'bug')) {
      return res.status(400).json({ error: 'type must be "idea" or "bug"' });
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }
    if (message.length > 10_000) {
      return res.status(400).json({ error: 'message too long (max 10000 chars)' });
    }

    const { user, team } = await ensureUserAndTeam(req.user);

    const supabase = getSupabaseClient();
    let workspaceName = null;
    if (team?.id) {
      const { data: ws } = await supabase
        .from('workspaces')
        .select('name')
        .eq('team_id', team.id)
        .limit(1)
        .maybeSingle();
      workspaceName = ws?.name ?? null;
    }

    const payload = {
      type,                                             // 'idea' | 'bug'
      message: message.trim(),
      videoLink: (videoLink && String(videoLink).trim()) || null,
      profileName: user?.name ?? null,
      profileEmail: user?.email ?? null,
      workspaceName,
      teamName: team?.name ?? null,
      companyName: (companyName && String(companyName).trim()) || null,
      companyUrl: (companyUrl && String(companyUrl).trim()) || null,
      ids: {
        userId: user?.id ?? null,
        teamId: team?.id ?? null,
      },
      context: context && typeof context === 'object' ? context : null,
      createdAt: new Date().toISOString(),
    };

    const r = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('[FEEDBACK] webhook non-2xx:', r.status, detail.slice(0, 500));
      return res.status(502).json({ error: 'webhook_failed', status: r.status });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[FEEDBACK_ROUTE_ERROR]', err);
    return res.status(500).json({
      error: 'internal_error',
      ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message || err) }),
    });
  }
});

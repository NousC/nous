import { Router } from 'express';
import { createHmac } from 'crypto';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';

export const signalsRouter = Router();

function signalToken(workspaceId) {
  const secret = process.env.SIGNAL_HMAC_SECRET || 'proply-signals';
  return createHmac('sha256', secret).update(workspaceId).digest('hex').slice(0, 32);
}

// GET /api/signals/webhook-url
signalsRouter.get('/webhook-url', verifySupabaseAuth, async (req, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId required' });

    const token = signalToken(workspaceId);
    const base = process.env.VITE_API_URL || process.env.APP_URL || 'http://localhost:3000';

    return res.json({
      token,
      workspace_id: workspaceId,
      url: `${base}/api/public/signals/ingest`,
      rb2b_example: {
        url: `${base}/api/public/signals/ingest`,
        method: 'POST',
        body: { workspace_id: workspaceId, token, source: 'rb2b', email: '{{email}}', first_name: '{{first_name}}', last_name: '{{last_name}}', company: '{{company}}', page: '{{page}}' },
      },
      signalbase_example: {
        url: `${base}/api/public/signals/ingest`,
        method: 'POST',
        body: { workspace_id: workspaceId, token, source: 'signalbase', company_name: '{{company_name}}', domain: '{{domain}}' },
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

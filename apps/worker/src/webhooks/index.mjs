// Inbound webhook router — registers routes for all signal sources.
// Each route validates the workspace_id, checks HMAC auth where supported,
// then delegates to the source-specific handler.

import { Router } from 'express';
import crypto from 'crypto';
import { handleLinkedIn } from './handlers/linkedin.mjs';
import { handleFireflies } from './handlers/fireflies.mjs';
import { handleRB2B } from './handlers/rb2b.mjs';

export const webhookRouter = Router();

function verifyHmac(req, secret) {
  const sig = req.headers['x-proply-signature'] || req.headers['x-hub-signature-256'];
  if (!sig || !secret) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex')}`;
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
  catch { return false; }
}

// All inbound routes accept /:workspaceId so the worker can handle any workspace
// without needing API key auth (HMAC on sensitive sources instead).

webhookRouter.post('/linkedin/:workspaceId', (req, res) => {
  const secret = process.env.LINKEDIN_WEBHOOK_SECRET;
  if (secret && !verifyHmac(req, secret)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }
  handleLinkedIn(req, res, req.params.workspaceId).catch(err => {
    console.error('[WEBHOOK/linkedin]', err);
    res.status(500).json({ error: 'internal_error' });
  });
});

webhookRouter.post('/fireflies/:workspaceId', (req, res) => {
  const secret = process.env.FIREFLIES_WEBHOOK_SECRET;
  if (secret && !verifyHmac(req, secret)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }
  handleFireflies(req, res, req.params.workspaceId).catch(err => {
    console.error('[WEBHOOK/fireflies]', err);
    res.status(500).json({ error: 'internal_error' });
  });
});

webhookRouter.post('/rb2b/:workspaceId', (req, res) => {
  const secret = process.env.RB2B_WEBHOOK_SECRET;
  if (secret && !verifyHmac(req, secret)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }
  handleRB2B(req, res, req.params.workspaceId).catch(err => {
    console.error('[WEBHOOK/rb2b]', err);
    res.status(500).json({ error: 'internal_error' });
  });
});

// Catch-all for unrecognized sources — log and 200 to prevent retries
webhookRouter.post('/:source/:workspaceId', (req, res) => {
  console.log(`[WEBHOOK] Unhandled source: ${req.params.source}`);
  res.json({ ok: true, skipped: true });
});

// Inbound webhook router — registers routes for all signal sources.
// Each route validates the workspace_id, checks HMAC auth where supported,
// then delegates to the source-specific handler.

import { Router } from 'express';
import crypto from 'crypto';
import { handleLinkedIn } from './handlers/linkedin.mjs';
import { handleFireflies } from './handlers/fireflies.mjs';
import { handleFathom } from './handlers/fathom.mjs';
import { handleRB2B } from './handlers/rb2b.mjs';
import { handleInstantly } from './handlers/instantly.mjs';
import { handleCalendly } from './handlers/calendly.mjs';
import { handleStripe } from './handlers/stripe.mjs';

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

// Supports both URL styles:
//   /linkedin/:workspaceId          (path param, HMAC header)
//   /linkedin?workspace_id=...&secret=... (Unipile style, query param secret)
webhookRouter.post(['/linkedin/:workspaceId', '/linkedin'], (req, res) => {
  const workspaceId = req.params.workspaceId || req.query.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'workspace_id_required' });

  const envSecret = process.env.LINKEDIN_WEBHOOK_SECRET;
  if (envSecret) {
    const querySecret = req.query.secret || '';
    const hasValidHmac = verifyHmac(req, envSecret);
    let hasValidQuerySecret = false;
    try {
      hasValidQuerySecret = querySecret.length === envSecret.length &&
        crypto.timingSafeEqual(Buffer.from(querySecret), Buffer.from(envSecret));
    } catch { /* length mismatch → false */ }
    if (!hasValidHmac && !hasValidQuerySecret) {
      return res.status(401).json({ error: 'invalid_signature' });
    }
  }

  handleLinkedIn(req, res, workspaceId).catch(err => {
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

webhookRouter.post(['/fathom/:workspaceId', '/fathom'], (req, res) => {
  const workspaceId = req.params.workspaceId || req.query.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'workspace_id_required' });
  // Fathom uses its own svix-based signature — handled inside the handler
  handleFathom(req, res, workspaceId).catch(err => {
    console.error('[WEBHOOK/fathom]', err);
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

webhookRouter.post(['/instantly/:workspaceId', '/instantly'], (req, res) => {
  const workspaceId = req.params.workspaceId || req.query.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'workspace_id_required' });
  const secret = process.env.INSTANTLY_WEBHOOK_SECRET;
  if (secret && !verifyHmac(req, secret)) return res.status(401).json({ error: 'invalid_signature' });
  handleInstantly(req, res, workspaceId).catch(err => {
    console.error('[WEBHOOK/instantly]', err);
    res.status(500).json({ error: 'internal_error' });
  });
});

// Calendly uses its own signing format (Calendly-Webhook-Signature: t=<ts>,v1=<hmac>)
// with a per-workspace signing key stored on the connection. Verification lives
// in the handler so it has DB access to look up the right key.
webhookRouter.post(['/calendly/:workspaceId', '/calendly'], (req, res) => {
  const workspaceId = req.params.workspaceId || req.query.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'workspace_id_required' });
  handleCalendly(req, res, workspaceId).catch(err => {
    console.error('[WEBHOOK/calendly]', err);
    res.status(500).json({ error: 'internal_error' });
  });
});

webhookRouter.post(['/stripe/:workspaceId', '/stripe'], (req, res) => {
  const workspaceId = req.params.workspaceId || req.query.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'workspace_id_required' });
  const secret = process.env.STRIPE_INBOUND_WEBHOOK_SECRET;
  if (secret && !verifyHmac(req, secret)) return res.status(401).json({ error: 'invalid_signature' });
  handleStripe(req, res, workspaceId).catch(err => {
    console.error('[WEBHOOK/stripe]', err);
    res.status(500).json({ error: 'internal_error' });
  });
});

// Catch-all for unrecognized sources — log and 200 to prevent retries
webhookRouter.post('/:source/:workspaceId', (req, res) => {
  console.log(`[WEBHOOK] Unhandled source: ${req.params.source}`);
  res.json({ ok: true, skipped: true });
});

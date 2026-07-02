// Partner OS provisioning endpoint — service-to-service. Lets the Partner OS
// (the agency white-label layer) create a Nous workspace for a new client and
// mint a workspace API key it can operate that workspace with.
//
// Auth is a shared secret (PARTNER_PROVISION_SECRET), NOT a user session — the
// caller is the Partner OS backend, not a browser. Disabled (503) if the secret
// is unset, so it's dead unless Nous Cloud opts in.
//
// POST /api/admin/provision/workspace
//   headers: X-Partner-Secret: <PARTNER_PROVISION_SECRET>
//   body:    { team_id, owner_user_id, name }
//   → 201 { workspace_id, api_key }   (raw key returned ONCE, never stored)

import express from 'express';
import crypto from 'node:crypto';
import { getSupabaseClient } from '@nous/core';

export const provisionRouter = express.Router();

function requirePartnerSecret(req, res, next) {
  const secret = process.env.PARTNER_PROVISION_SECRET;
  if (!secret) return res.status(503).json({ error: 'provisioning_disabled' });
  const given = req.headers['x-partner-secret'];
  if (!given || given !== secret) return res.status(401).json({ error: 'unauthorized' });
  next();
}

provisionRouter.post('/workspace', requirePartnerSecret, async (req, res) => {
  try {
    const { team_id, owner_user_id, name } = req.body || {};
    if (!team_id || !owner_user_id || !name?.trim()) {
      return res.status(400).json({ error: 'team_id, owner_user_id, name required' });
    }
    const supabase = getSupabaseClient();

    // 1. Create the workspace under the agency's team.
    const { data: workspace, error: wsErr } = await supabase
      .from('workspaces')
      .insert({ team_id, name: name.trim() })
      .select('id')
      .single();
    if (wsErr) throw wsErr;

    // 2. Make the agency owner the workspace owner.
    await supabase.from('workspace_members').insert({
      workspace_id: workspace.id, user_id: owner_user_id, role: 'owner',
    });

    // 3. Mint a workspace-scoped automation key (admin scope, not tied to a person).
    const rawKey = `pk_${crypto.randomBytes(24).toString('hex')}`;
    const key_hash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const { error: keyErr } = await supabase.from('api_keys').insert({
      workspace_id: workspace.id, name: 'Partner OS', key_hash,
      created_by_user_id: null, owner_user_id: null, scope: 'admin',
    });
    if (keyErr) throw keyErr;

    return res.status(201).json({ workspace_id: workspace.id, api_key: rawKey });
  } catch (err) {
    console.error('[provision/workspace]', err?.message || err);
    return res.status(500).json({ error: 'internal_error', detail: err?.message });
  }
});

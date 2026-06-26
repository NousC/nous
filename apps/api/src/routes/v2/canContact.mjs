import { Router } from 'express';
import { getSupabaseClient, resolveFocus, canContact } from '@nous/core';

export const canContactV2Router = Router();

const CHANNELS = ['any', 'email', 'linkedin'];

// POST /v2/can-contact — the outreach guardrail. Before an agent sends, ask
// whether the account is clear on the requested channel given the workspace
// cooldown policy and suppression list.
// Body: { focus: <email|url|uuid|name>, channel?: 'any'|'email'|'linkedin', cooldowns?: {email_hours,linkedin_hours,any_hours} }
canContactV2Router.post('/', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.workspaceId;
    const { focus, channel = 'any', cooldowns } = req.body;

    if (!focus) return res.status(400).json({ error: 'focus_required' });
    if (!CHANNELS.includes(channel)) {
      return res.status(400).json({ error: 'invalid_channel', valid_channels: CHANNELS });
    }

    const resolution = await resolveFocus(supabase, workspaceId, String(focus));
    if (resolution.status === 'not_found') return res.status(404).json({ error: 'entity_not_found' });
    if (resolution.status === 'ambiguous') {
      return res.json({ status: 'ambiguous', candidates: resolution.candidates });
    }

    const result = await canContact(supabase, workspaceId, resolution.entity_id, { channel, cooldowns });
    return res.json(result);
  } catch (err) {
    console.error('[POST /v2/can-contact]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

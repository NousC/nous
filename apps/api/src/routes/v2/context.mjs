import { Router } from 'express';
import { getSupabaseClient, assembleContext, resolveEntity, CONTEXT_INTENTS } from '@nous/core';

export const contextV2Router = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /v2/context — engineered context for an intent on one entity.
// Body: { focus: <entity UUID | email>, intent?: ContextIntent, budget_tokens?: number }
// Runs the pipeline: retrieve -> rank -> connect -> compress -> tag -> budget.
contextV2Router.post('/', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.workspaceId;
    const { focus, intent = 'account_review', budget_tokens } = req.body;

    if (!focus) return res.status(400).json({ error: 'focus_required' });
    if (!CONTEXT_INTENTS.includes(intent)) {
      return res.status(400).json({ error: 'invalid_intent', valid_intents: CONTEXT_INTENTS });
    }

    let entityId = focus;
    if (!UUID.test(focus)) {
      if (typeof focus !== 'string' || !focus.includes('@')) {
        return res.status(400).json({ error: 'focus_must_be_entity_uuid_or_email' });
      }
      entityId = await resolveEntity(supabase, workspaceId, { kind: 'email', value: focus });
      if (!entityId) return res.status(404).json({ error: 'entity_not_found' });
    }

    const context = await assembleContext(supabase, workspaceId, entityId, intent, budget_tokens);
    if (!context) return res.status(404).json({ error: 'entity_not_found' });
    return res.json(context);
  } catch (err) {
    console.error('[POST /v2/context]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

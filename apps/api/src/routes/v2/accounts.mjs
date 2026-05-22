import { Router } from 'express';
import { getSupabaseClient, getAccountRecord, resolveEntity } from '@nous/core';

export const accountsV2Router = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /v2/accounts/:id — the full account-record projection:
// entity + claims-with-epistemics + recent observation timeline.
// :id may be an entity UUID or an email address.
accountsV2Router.get('/:id', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.workspaceId;
    let entityId = req.params.id;

    if (!UUID.test(entityId)) {
      if (!entityId.includes('@')) {
        return res.status(400).json({ error: 'id_must_be_entity_uuid_or_email' });
      }
      const resolved = await resolveEntity(supabase, workspaceId, { kind: 'email', value: entityId });
      if (!resolved) return res.status(404).json({ error: 'entity_not_found' });
      entityId = resolved;
    }

    const record = await getAccountRecord(supabase, workspaceId, entityId);
    if (!record) return res.status(404).json({ error: 'entity_not_found' });
    return res.json(record);
  } catch (err) {
    console.error('[GET /v2/accounts/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

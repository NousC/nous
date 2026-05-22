import { Router } from 'express';
import {
  getSupabaseClient,
  getOrCreateEntity,
  recordObservation,
  recomputeClaim,
} from '@nous/core';

export const observationsV2Router = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /v2/observations — record what happened / was learned.
// Body: {
//   focus: <entity UUID | email | domain>,
//   observations: [ { kind:'event'|'state', property, value, source?, method?,
//                      observed_at?, external_id?, raw? } ]
// }
// Agents never "update" — they observe. The substrate derives the new claims.
observationsV2Router.post('/', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.workspaceId;
    const { focus, observations } = req.body;

    if (!focus || !Array.isArray(observations) || observations.length === 0) {
      return res.status(400).json({ error: 'focus_and_observations_required' });
    }

    // Resolve the focus to an entity — create one if the identifier is unknown.
    let entityId;
    if (typeof focus === 'string' && UUID.test(focus)) {
      entityId = focus;
    } else if (typeof focus === 'string' && focus.includes('@')) {
      entityId = await getOrCreateEntity(supabase, workspaceId, 'person', [
        { kind: 'email', value: focus },
      ]);
    } else if (typeof focus === 'string' && focus.trim()) {
      entityId = await getOrCreateEntity(supabase, workspaceId, 'company', [
        { kind: 'domain', value: focus },
      ]);
    } else {
      return res.status(400).json({ error: 'invalid_focus' });
    }

    // Append every observation to the immutable spine.
    let recorded = 0;
    const touchedProps = new Set();
    for (const o of observations) {
      if (!o.property || (o.kind !== 'event' && o.kind !== 'state')) continue;
      const result = await recordObservation(supabase, {
        workspaceId,
        entityId,
        kind: o.kind,
        property: o.property,
        value: o.value ?? null,
        source: o.source || 'agent',
        method: o.method || 'api',
        observedAt: o.observed_at,
        externalId: o.external_id,
        raw: o.raw,
      });
      if (result) {
        recorded++;
        if (o.kind === 'state') touchedProps.add(o.property);
      }
    }

    // Recompute the affected claims inline so the agent sees the effect now.
    const claimsRecomputed = [];
    for (const property of touchedProps) {
      try {
        await recomputeClaim(supabase, workspaceId, entityId, property);
        claimsRecomputed.push(property);
      } catch (e) {
        console.error('[POST /v2/observations] recompute failed:', property, e.message);
      }
    }

    return res.json({ entity_id: entityId, recorded, claims_recomputed: claimsRecomputed });
  } catch (err) {
    console.error('[POST /v2/observations]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

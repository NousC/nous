import { Router } from 'express';
import {
  getSupabaseClient,
  getOrCreateEntity,
  recordObservation,
  recomputeClaim,
  detectIdentifier,
} from '@nous/core';

export const observationsV2Router = Router();

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

    // Resolve the focus to an entity — create one if it's a new identifier.
    // A write needs a precise identifier (id / email / LinkedIn / domain) —
    // never a bare name (too ambiguous to record against).
    const ident = detectIdentifier(String(focus));
    if (!ident) {
      return res.status(400).json({
        error: 'invalid_focus',
        detail: 'provide an entity id, email, LinkedIn URL, or domain — not a bare name',
      });
    }
    let entityId;
    if (ident.kind === 'entity_id') {
      entityId = ident.value;
    } else if (ident.kind === 'domain') {
      entityId = await getOrCreateEntity(supabase, workspaceId, 'company',
        [{ kind: 'domain', value: ident.value }]);
    } else {
      entityId = await getOrCreateEntity(supabase, workspaceId, 'person',
        [{ kind: ident.kind, value: ident.value }]);
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

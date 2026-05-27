import { Router } from 'express';
import {
  getSupabaseClient,
  getOrCreateEntity,
  attachIdentifiers,
  resolveFocus,
  assertClaims,
  fetchEntityOverlays,
  applyContactOverlay,
  normaliseLinkedInUrl,
} from '@nous/core';

// LinkedIn URL variants (with/without trailing slash, with/without www) so
// the linkedin_url= exact filter matches historical rows that were stored raw
// before normaliseIdentifier started normalising on write.
function linkedInVariants(url) {
  const out = new Set();
  const trimmed = String(url ?? '').trim();
  if (!trimmed) return [];
  const canonical = normaliseLinkedInUrl(trimmed);
  if (canonical) {
    const noWww = canonical.replace('https://www.', 'https://');
    for (const base of [canonical, noWww]) { out.add(base); out.add(base + '/'); }
  }
  out.add(trimmed);
  out.add(trimmed.toLowerCase());
  return Array.from(out);
}

export const peopleV2Router = Router();

// ─── /v2/people — the deterministic surface for People (humans) ─────────────
// REST shape that workflow runtimes (n8n, Make, custom backends) call when
// they already know the parameters. Agents reading context should still use
// /v2/context or /v2/accounts/:id (intent-shaped, epistemics-tagged).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIMIT = 1000;

// Properties that live in entity_identifiers, not in claims. Splitting these
// out keeps the PATCH/POST surface unsurprising — `email` works.
const IDENTIFIER_KIND_BY_FIELD = {
  email:              'email',
  linkedin_url:       'linkedin_url',
  linkedin_member_id: 'linkedin_member_id',
  hubspot_id:         'hubspot',
  pipedrive_id:       'pipedrive',
  apollo_id:          'apollo',
  attio_id:           'attio',
};

function parseDuration(input) {
  // '2d' | '7d' | '30d' | '6h' | '90m' → ms; null when unparseable.
  if (input == null) return null;
  const m = String(input).trim().match(/^(\d+)\s*([smhd])$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const ms = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return n * ms;
}

function splitBody(body) {
  // identifiers → entity_identifiers via attachIdentifiers
  // everything else → claims via assertClaims
  const identifiers = [];
  const claimValues = {};
  for (const [k, v] of Object.entries(body ?? {})) {
    if (k in IDENTIFIER_KIND_BY_FIELD) {
      if (v) identifiers.push({ kind: IDENTIFIER_KIND_BY_FIELD[k], value: String(v) });
    } else {
      claimValues[k] = v;
    }
  }
  return { identifiers, claimValues };
}

async function projectPerson(supabase, entityId) {
  // Reuse the same overlay the contacts view + /v2/accounts use, so n8n and
  // the agent see the same person.
  const overlays = await fetchEntityOverlays(supabase, [entityId]);
  const row = applyContactOverlay({ id: entityId }, overlays.get(entityId));
  return { entity_id: entityId, ...row };
}

// ─── GET /v2/people — filtered list ─────────────────────────────────────────
// Reads the `contacts` view (v2-substrate-backed) for stability. Filters map
// directly to columns the view exposes; n8n discovers them via the docs.
peopleV2Router.get('/', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.workspaceId;
    const {
      search,
      pipeline_stage,
      source,
      status,
      has_email,
      has_linkedin,
      linkedin_url,
      email,
      last_activity_before,
      last_activity_after,
      sort,
      limit,
      offset,
    } = req.query;

    let q = supabase.from('contacts').select('*').eq('workspace_id', workspaceId);
    if (pipeline_stage) q = q.eq('pipeline_stage', pipeline_stage);
    if (status)         q = q.eq('status', status);
    if (source)         q = q.eq('source', source);
    if (has_email === 'true')     q = q.not('email', 'is', null);
    if (has_email === 'false')    q = q.is('email', null);
    if (has_linkedin === 'true')  q = q.not('linkedin_url', 'is', null);
    if (has_linkedin === 'false') q = q.is('linkedin_url', null);

    // Exact-match lookups by identifier — the shape workflow runtimes use
    // when they already have the value. linkedin_url= tries variant forms
    // (with/without trailing slash, with/without www) so old rows match too.
    if (email) q = q.eq('email', String(email).toLowerCase().trim());
    if (linkedin_url) q = q.in('linkedin_url', linkedInVariants(linkedin_url));

    const beforeMs = parseDuration(last_activity_before);
    if (beforeMs != null) {
      const cutoff = new Date(Date.now() - beforeMs).toISOString();
      // "gone quiet for N" — either never had activity, or last activity is before cutoff.
      q = q.or(`last_activity_at.is.null,last_activity_at.lt.${cutoff}`);
    }
    const afterMs = parseDuration(last_activity_after);
    if (afterMs != null) {
      const cutoff = new Date(Date.now() - afterMs).toISOString();
      q = q.gte('last_activity_at', cutoff);
    }

    if (search && String(search).trim()) {
      const t = `%${String(search).trim()}%`;
      q = q.or(`email.ilike.${t},first_name.ilike.${t},last_name.ilike.${t},company.ilike.${t},linkedin_url.ilike.${t}`);
    }

    q = sort === 'last_activity_asc'
      ? q.order('last_activity_at', { ascending: true, nullsFirst: false })
      : q.order('last_activity_at', { ascending: false, nullsFirst: false });

    const lim = Math.min(parseInt(limit, 10) || 100, MAX_LIMIT);
    const off = parseInt(offset, 10) || 0;
    q = q.range(off, off + lim - 1);

    const { data, error } = await q;
    if (error) throw error;
    return res.json({ people: data ?? [], limit: lim, offset: off });
  } catch (err) {
    console.error('[GET /v2/people]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ─── POST /v2/people — create or upsert by identifier ────────────────────────
// Body: { email?, linkedin_url?, ... + any claim properties }
// If an entity with one of the identifiers already exists, returns it and
// asserts any new claim values onto it (safe to call from a form intake hook
// that fires repeatedly).
peopleV2Router.post('/', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.workspaceId;
    const { identifiers, claimValues } = splitBody(req.body);

    if (identifiers.length === 0) {
      return res.status(400).json({
        error: 'identifier_required',
        detail: 'pass at least one of: email, linkedin_url, linkedin_member_id, hubspot_id, pipedrive_id, apollo_id, attio_id',
      });
    }

    const entityId = await getOrCreateEntity(supabase, workspaceId, 'person', identifiers);
    if (Object.keys(claimValues).length > 0) {
      await assertClaims(supabase, workspaceId, entityId, { values: claimValues });
    }
    const person = await projectPerson(supabase, entityId);
    return res.status(201).json({ person });
  } catch (err) {
    console.error('[POST /v2/people]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ─── PATCH /v2/people/:id — assert claim values + attach identifiers ─────────
// `:id` may be an entity UUID, email, domain, or LinkedIn URL. Asserted claims
// are sticky — derivation from observations will not overwrite them.
peopleV2Router.patch('/:id', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.workspaceId;

    const resolution = await resolveFocus(supabase, workspaceId, req.params.id);
    if (resolution.status === 'not_found')  return res.status(404).json({ error: 'entity_not_found' });
    if (resolution.status === 'ambiguous')  return res.json({ status: 'ambiguous', candidates: resolution.candidates });

    const entityId = resolution.entity_id;
    const { identifiers, claimValues } = splitBody(req.body);

    if (identifiers.length > 0) {
      await attachIdentifiers(supabase, workspaceId, entityId, identifiers);
    }
    let writtenCount = 0;
    if (Object.keys(claimValues).length > 0) {
      const result = await assertClaims(supabase, workspaceId, entityId, { values: claimValues });
      writtenCount = result.written.length + result.invalidated.length;
    }

    const person = await projectPerson(supabase, entityId);
    return res.json({ person, claims_written: writtenCount });
  } catch (err) {
    console.error('[PATCH /v2/people/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

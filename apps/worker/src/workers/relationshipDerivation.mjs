// Relationship-graph derivation — the org chart + buying committee, made real.
//
// Identity resolution gives us nodes (people, companies) and `works_at` edges.
// This worker derives the next layer for each company:
//   1. reports_to edges  — an org chart inferred from titles/seniority
//   2. committee_role     — champion / economic_buyer / influencer / blocker /
//                           contact, from engagement + seniority
//
// reports_to is written straight to the relationships table (the derived edge
// layer). committee_role is written as a STATE OBSERVATION, so the claim engine
// derives the claim downstream — exactly how stageDerivation handles
// pipeline_stage. get_context's loadStakeholders then reads both and returns the
// committee with roles + managers.
//
// Pure logic (the seniority ladder, deriveReportsTo, classifyCommittee) lives in
// @nous/core; this file is the IO/scheduling shell.

import {
  getSupabaseClient,
  logWorkerRun,
  getColleagues,
  setReportsTo,
  deriveReportsTo,
  classifyCommittee,
} from '@nous/core';

const COMPANIES_PER_RUN = 1000;  // sanity cap; loop again next tick if more
const LOOKBACK_DAYS = 90;

// An event counts as engagement (champion signal) if it came from THEIR side —
// an inbound reply/message — or it's a meeting/call (both directions imply
// engagement). Outbound-only touches we sent are not engagement.
const isInbound = (o) => (o.raw?.is_outbound ?? false) !== true;
const isEngagement = (o) =>
  typeof o.property === 'string' &&
  o.property.startsWith('interaction.') &&
  (isInbound(o) || /meeting|repl|call/i.test(o.property));

function negativeFromClaims(claimsByProp) {
  if (claimsByProp.do_not_contact === true || claimsByProp.unsubscribed === true) return true;
  if (typeof claimsByProp.reply_sentiment === 'string'
      && claimsByProp.reply_sentiment.toLowerCase() === 'negative') return true;
  return false;
}

export async function runRelationshipDerivation() {
  const supabase = getSupabaseClient();
  const startedAt = new Date();

  const { data: companies, error: compErr } = await supabase
    .from('entities')
    .select('id, workspace_id')
    .eq('type', 'company')
    .eq('status', 'active')
    .limit(COMPANIES_PER_RUN);
  if (compErr) {
    if (compErr.code === '42P01' || compErr.code === 'PGRST205') return; // table missing — skip
    console.error('[relationship_derivation] company scan failed:', compErr.message);
    return;
  }
  if (!companies?.length) return;

  const sinceISO = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  // workspaceId → tallies for one tidy log line per workspace
  const perWorkspace = new Map();

  for (const company of companies) {
    const ws = company.workspace_id;
    const colleagueIds = await getColleagues(supabase, ws, company.id, { limit: 100 });
    if (colleagueIds.length === 0) continue;

    // member facts (one batched claims read) + engagement (one batched obs read)
    const [{ data: claimRows, error: clErr }, { data: obsRows, error: obErr }] = await Promise.all([
      supabase
        .from('claims')
        .select('entity_id, property, value')
        .eq('workspace_id', ws)
        .in('entity_id', colleagueIds)
        .in('property', ['job_title', 'seniority', 'department', 'committee_role',
                         'do_not_contact', 'unsubscribed', 'reply_sentiment'])
        .is('invalid_at', null),
      supabase
        .from('observations')
        .select('entity_id, property, raw')
        .eq('workspace_id', ws)
        .in('entity_id', colleagueIds)
        .eq('kind', 'event')
        .gte('observed_at', sinceISO)
        .limit(5000),
    ]);
    if (clErr || obErr) continue;

    const byEntity = new Map();   // id -> { job_title, seniority, department, committee_role, ... }
    for (const c of claimRows ?? []) {
      const m = byEntity.get(c.entity_id) ?? {};
      m[c.property] = c.value;
      byEntity.set(c.entity_id, m);
    }
    const inbound = new Map();     // id -> engagement count
    for (const o of obsRows ?? []) {
      if (!isEngagement(o)) continue;
      inbound.set(o.entity_id, (inbound.get(o.entity_id) ?? 0) + 1);
    }

    const members = colleagueIds.map((id) => {
      const m = byEntity.get(id) ?? {};
      return {
        entityId: id,
        title: typeof m.job_title === 'string' ? m.job_title : null,
        seniority: typeof m.seniority === 'string' ? m.seniority : null,
        department: typeof m.department === 'string' ? m.department : null,
        inboundCount: inbound.get(id) ?? 0,
        negativeSignal: negativeFromClaims(m),
      };
    });

    const bump = perWorkspace.get(ws) ?? { companies: 0, edges: 0, roles: 0 };
    bump.companies++;

    // 1. org chart — reports_to edges (single current manager per person)
    for (const edge of deriveReportsTo(members)) {
      try {
        const changed = await setReportsTo(supabase, ws, edge.fromEntityId, edge.toEntityId);
        if (changed) bump.edges++;
      } catch (err) {
        console.error('[relationship_derivation] setReportsTo failed:', err.message);
      }
    }

    // 2. committee roles — write a state observation only when the role changes,
    //    so the claim engine re-derives committee_role without log spam.
    const roles = classifyCommittee(members);
    for (const m of members) {
      const role = roles.get(m.entityId);
      if (!role) continue;
      const current = byEntity.get(m.entityId)?.committee_role;
      if (current === role) continue;
      const { error: insErr } = await supabase.from('observations').insert({
        workspace_id: ws,
        entity_id: m.entityId,
        kind: 'state',
        property: 'committee_role',
        value: role,
        source: 'relationship_derivation',
        method: 'inference',
        observed_at: new Date().toISOString(),
      });
      if (!insErr) bump.roles++;
    }

    perWorkspace.set(ws, bump);
  }

  // one log row per workspace that changed anything
  for (const [wsId, t] of perWorkspace) {
    if (t.edges === 0 && t.roles === 0) continue;
    try {
      await supabase.from('workspace_system_log').insert({
        workspace_id: wsId,
        source: 'relationship_derivation',
        event_type: 'relationships.derived',
        summary: `Relationship graph — ${t.edges} reports_to edge(s), ${t.roles} committee role(s) across ${t.companies} companies`,
        metadata: { companies: t.companies, edges: t.edges, roles: t.roles, lookback_days: LOOKBACK_DAYS },
      });
    } catch { /* logging is best-effort */ }
  }

  const totals = [...perWorkspace.values()].reduce(
    (s, t) => ({ companies: s.companies + t.companies, edges: s.edges + t.edges, roles: s.roles + t.roles }),
    { companies: 0, edges: 0, roles: 0 },
  );
  console.log(`[relationship_derivation] companies=${totals.companies} edges=${totals.edges} roles=${totals.roles} · ${Date.now() - +startedAt}ms`);

  if (totals.edges || totals.roles) {
    await logWorkerRun(supabase, {
      worker: 'relationship_derivation',
      status: 'success',
      summary: `${totals.edges} reports_to edge(s), ${totals.roles} committee role(s) over ${totals.companies} companies`,
      details: totals,
      startedAt,
    });
  }
}

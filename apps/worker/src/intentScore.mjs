// Intent score — Plan 2, Phase 1 (the "reach out NOW?" axis, separate from ICP fit).
//
// Fit says WHO (durable). Intent says WHEN (decays). This computes a 0-100
// `intent_score` from the behavioural signals Nous already collects, with the
// anti-over-prioritization rules baked in so no single channel (esp. a website
// visit) can fake readiness:
//   1. per-signal CAP        — each signal contributes at most its weight
//   2. SATURATION on repeats — 1-e^(-n/2): 1≈.39, 3≈.78, 20≈1.0 (no runaway)
//   3. DECAY by recency      — 0.5^(age/halfLife); a stale signal barely counts
//   4. CORROBORATION gate    — a lone signal caps at Warm(69); a lone website
//                              visit caps at Aware(49). Hot/Red-hot needs ≥2 signals.
//   5. FIT gate (in the play)— Not-ICP + Hot is still ignored (printed, not scored away)
//
// SAFE: read-only preview by default — prints the score distribution + examples,
// writes nothing. (The worker that stakes the claim + the columns are Phase 1b.)
//
// Usage (from apps/worker, prod creds in env):
//   set -a; source ../../../assetly-blueprint/.env; set +a
//   node src/intentScore.mjs                 # preview the default list
//   LIST_ID=<uuid> node src/intentScore.mjs

import { getSupabaseClient } from '@nous/core';

const WS = process.env.WS_ID || '9caa9db9-000c-43d3-895b-14f4aedffb5f';
const LL = process.env.LIST_ID || 'c369c099-1c20-444b-8f8b-8565642e3842';
const supabase = getSupabaseClient();
const NOW = Date.now();
const DAY = 86400000;

// Signal catalog. weight = max contribution; halfLifeDays = recency decay.
// website_visit is wired but inert until the Phase-2 pixel writes those obs.
const SIGNALS = {
  meeting_booked:   { weight: 35, halfLifeDays: 30 },
  replied:          { weight: 35, halfLifeDays: 30 },
  linkedin_engaged: { weight: 25, halfLifeDays: 14 },
  content_intent:   { weight: 20, halfLifeDays: 30 },
  hiring:           { weight: 18, halfLifeDays: 30 },
  momentum:         { weight: 12, halfLifeDays: 60 },
  website_visit:    { weight: 40, halfLifeDays: 7 },   // [Phase 2] needs a visitor pixel
};
const MEANINGFUL = 5;   // a signal's contribution must clear this to count as "distinct active"

const saturate = (n) => 1 - Math.exp(-n / 2);                 // diminishing returns on repeats
const decay = (ageDays, halfLife) => Math.pow(0.5, ageDays / halfLife);
const ageDays = (iso) => Math.max(0, (NOW - new Date(iso).getTime()) / DAY);

// counts: { class: [iso, iso, ...] }  (one entry per event, newest-weighted via decay)
function scoreIntent(counts) {
  const contrib = {};
  for (const [cls, cfg] of Object.entries(SIGNALS)) {
    const events = counts[cls] || [];
    if (!events.length) continue;
    // recency-weighted count: each event worth its own decay, summed, then saturated + capped
    const weightedN = events.reduce((s, iso) => s + decay(ageDays(iso), cfg.halfLifeDays), 0);
    contrib[cls] = Math.min(cfg.weight, cfg.weight * saturate(weightedN));
  }
  const active = Object.keys(contrib).filter(c => contrib[c] >= MEANINGFUL);
  let score = Math.min(100, Object.values(contrib).reduce((a, b) => a + b, 0));

  // CORROBORATION gate — one signal can't fake readiness.
  if (active.length < 2) {
    const onlyWeb = active.length === 1 && active[0] === 'website_visit';
    score = Math.min(score, onlyWeb ? 49 : 69);
  }
  score = Math.round(score);
  const band = score >= 85 ? 'Red-hot' : score >= 70 ? 'Hot' : score >= 50 ? 'Warm'
            : score >= 20 ? 'Aware' : 'Dormant';
  return { score, band, contrib, active };
}

async function pageAll(table, select, filter) {
  const out = []; let from = 0;
  for (;;) {
    let q = supabase.from(table).select(select).eq('workspace_id', WS).range(from, from + 999);
    for (const [k, v] of Object.entries(filter || {})) q = q.in(k, v);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

async function main() {
  console.log(`\n=== Intent score PREVIEW (read-only) — DB ${new URL(process.env.SUPABASE_URL).host} ===`);
  console.log(`WS ${WS}  LIST ${LL}\n`);

  // 1. list leads → person entity (contact_id) + domain (for inherited company signals)
  const leads = (await supabase.from('leads').select('contact_id,name,email,domain,fields')
    .eq('workspace_id', WS).eq('lead_list_id', LL).limit(2000)).data || [];
  const personIds = [...new Set(leads.map(l => l.contact_id).filter(Boolean))];
  const domains = [...new Set(leads.map(l => (l.domain || (l.email||'').split('@')[1] || '').toLowerCase()).filter(Boolean))];

  // 2. domain → company entity, and the company's intent-ish signal claims (inherited)
  const idRows = await pageAll('entity_identifiers', 'entity_id,value', { value: domains, });
  const dom2co = new Map(idRows.filter(r => r.value).map(r => [r.value.toLowerCase(), r.entity_id]));
  const coIds = [...new Set([...dom2co.values()])];
  const coSignals = new Map(); // entity → { hiring:[iso], momentum:[iso], content_intent:[iso] }
  for (const grp of chunk(coIds, 100)) {
    const cls = (await supabase.from('claims').select('entity_id,property,value,last_observed_at,computed_at')
      .eq('workspace_id', WS).in('entity_id', grp).is('invalid_at', null)
      .in('property', ['signal.hiring', 'signal.momentum', 'signal.intent'])).data || [];
    for (const c of cls) {
      const sc = (c.value && typeof c.value === 'object') ? c.value.score : null;
      if (sc != null && sc < 6) continue;                       // only meaningful signal strength
      const map = coSignals.get(c.entity_id) || {};
      const key = c.property === 'signal.intent' ? 'content_intent' : c.property.split('.')[1];
      (map[key] = map[key] || []).push(c.last_observed_at || c.computed_at);
      coSignals.set(c.entity_id, map);
    }
  }

  // 3. per-person behavioural observations (meetings, replies, LinkedIn engagement)
  const personObs = new Map(); // entity → { meeting_booked:[iso], replied:[iso], linkedin_engaged:[iso] }
  for (const grp of chunk(personIds, 100)) {
    const obs = (await supabase.from('observations').select('entity_id,property,source,observed_at')
      .eq('workspace_id', WS).in('entity_id', grp)
      .gte('observed_at', new Date(NOW - 180 * DAY).toISOString())).data || [];
    for (const o of obs) {
      let cls = null;
      if (o.property === 'interaction.meeting_scheduled') cls = 'meeting_booked';
      else if (o.property === 'interaction.email_replied') cls = 'replied';
      else if (o.property === 'interaction.linkedin_message'
            || o.property === 'interaction.linkedin_connected'
            || o.property === 'interaction.linkedin_post_engagement'   // [Phase 1b] engagement worker should emit this per engager
            ) cls = 'linkedin_engaged';
      if (!cls) continue;
      const map = personObs.get(o.entity_id) || {};
      (map[cls] = map[cls] || []).push(o.observed_at);
      personObs.set(o.entity_id, map);
    }
  }

  // 4. fit overlay — latest icp_fit tier per person (for the Fit×Intent play)
  const tier = new Map();
  for (const grp of chunk(personIds, 100)) {
    const pr = (await supabase.from('predictions').select('entity_id,predicted_value,predicted_at')
      .eq('workspace_id', WS).eq('kind', 'icp_fit').in('entity_id', grp)
      .order('predicted_at', { ascending: false })).data || [];
    for (const p of pr) if (!tier.has(p.entity_id)) tier.set(p.entity_id, (p.predicted_value || {}).tier || null);
  }

  // 5. compute + report
  const rows = [];
  for (const l of leads) {
    if (!l.contact_id) continue;
    const dom = (l.domain || (l.email||'').split('@')[1] || '').toLowerCase();
    const coId = dom2co.get(dom);
    const counts = { ...(personObs.get(l.contact_id) || {}) };
    const coMap = coId ? coSignals.get(coId) : null;
    if (coMap) for (const [k, v] of Object.entries(coMap)) counts[k] = [...(counts[k] || []), ...v];
    const r = scoreIntent(counts);
    rows.push({ name: l.name, tier: tier.get(l.contact_id), ...r });
  }

  const bandCount = {};
  for (const r of rows) bandCount[r.band] = (bandCount[r.band] || 0) + 1;
  console.log('Intent band distribution across', rows.length, 'leads:');
  for (const b of ['Red-hot','Hot','Warm','Aware','Dormant']) console.log(`  ${b.padEnd(8)} ${bandCount[b] || 0}`);

  const top = rows.filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 15);
  console.log('\nTop by intent (name · tier · intent score/band · active signals):');
  for (const r of top) {
    const play = (r.tier === 'tier_1' && r.score >= 70) ? '→ WORK NOW'
      : (r.tier === 'not_icp') ? '→ ignore (not ICP)' : '';
    console.log(`  ${(r.name||'?').slice(0,26).padEnd(26)} ${String(r.tier).padEnd(8)} ${String(r.score).padStart(3)}/${r.band.padEnd(8)} [${r.active.join(', ')}] ${play}`);
  }
  if (!top.length) console.log('  (no behavioural intent yet — expected on a freshly-built cold list; intent accrues as engagement happens)');
  console.log('\nPREVIEW only — nothing written.');
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });

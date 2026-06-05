// Weekly LinkedIn engagement run — the native, no-button lead source.
//
// For each workspace that has connected its own LinkedIn (via Unipile, stored in
// workspace_linkedin_connections) AND is on the Scale plan, this scrapes the
// engagers off that workspace's OWN recent posts (comments + reactions) and drops
// them into a native "LinkedIn Engagers" lead list. There is no frontend trigger;
// it runs on a weekly cron and is visible only in the ops log.
//
// Why these stay LEADS, not People:
//   * the lead insert writes observations with source 'lead_list'
//   * the engagement signal here is written with source 'apify_linkedin'
//   Both are scrape sources, and a post-engagement promotes no pipeline stage
//   (see stageDerivation). So the People (contacts) view filter keeps them out.
//   The moment they actually reply / DM / meet, a real-source interaction lands
//   and they graduate into People automatically. Comment in, conversation out.
//
// Cloud + Scale plan only. NOT a self-host feature — self-host has no plan
// concept and lead lists are already cloud-only (see access.mjs / the feature
// split). Gating (any one no-op silences the whole thing — safe by default):
//   * APIFY_TOKEN unset                   -> feature off everywhere
//   * workspace has no LinkedIn connected -> skipped
//   * workspace not on Scale (and not in LINKEDIN_ENGAGEMENT_WORKSPACES) -> skipped

import { getSupabaseClient, insertLeads, createLeadList, listLeadLists, logWorkerRun } from '@nous/core';
import { runActor, hasApifyToken } from '../utils/apify.mjs';
import { logSysEvent } from '../utils/systemLog.mjs';

const WINDOW_DAYS  = Number(process.env.ENGAGEMENT_WINDOW_DAYS || 7);
const FLOOR_HOURS  = 48;          // skip posts younger than this — engagement is still arriving
const MAX_POSTS    = Number(process.env.ENGAGEMENT_MAX_POSTS || 5);
const MAX_PER_POST = 100;         // comments / reactions pulled per post
// 'main' = full profiles + vanity URLs (enrichable, identity-resolvable); 'short' = cheaper.
const PROFILE_MODE = process.env.ENGAGEMENT_PROFILE_MODE || 'main';
const LIST_NAME    = 'LinkedIn Engagers';
const LIST_SOURCE  = 'linkedin_engagement';
const ENGAGE_PROP  = 'interaction.linkedin_post_engagement';

// Workspaces force-enabled regardless of plan (cloud dogfood + pilots), CSV.
const ALLOWLIST = new Set(
  (process.env.LINKEDIN_ENGAGEMENT_WORKSPACES || '')
    .split(',').map(s => s.trim()).filter(Boolean),
);

// ── helpers ──────────────────────────────────────────────────────────────────
function normUrl(u) {
  if (!u) return null;
  return String(u).toLowerCase().split('?')[0].replace(/\/+$/, '');
}

function relSecs(s) {
  const m = /^(\d+)\s*(mo|[wdhms])/.exec(String(s).trim().toLowerCase());
  if (!m) return null;
  const mult = { mo: 2592000, w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  return parseInt(m[1], 10) * mult[m[2]];
}

// Best-effort post timestamp (seconds). HarvestAPI returns several shapes.
function postTs(p, now) {
  const v = p.postedAt;
  if (typeof v === 'number') return v > 1e12 ? v / 1000 : v;
  if (v && typeof v === 'object') {
    const t = v.timestamp;
    if (t) return t > 1e12 ? t / 1000 : t;
    if (v.date) { const d = Date.parse(v.date); if (!Number.isNaN(d)) return d / 1000; }
    if (v.postedAgoShort) { const r = relSecs(v.postedAgoShort); if (r) return now - r; }
  }
  if (typeof v === 'string') {
    const d = Date.parse(v); if (!Number.isNaN(d)) return d / 1000;
    const r = relSecs(v); if (r) return now - r;
  }
  const pat = p.postedAtTimestamp;
  if (pat) return pat > 1e12 ? pat / 1000 : pat;
  return null;
}

// Is this workspace allowed to run? Cloud, Scale-plan only — this is NOT a
// self-host feature (self-host has no plans, and lead lists are cloud-only).
// The allowlist is for cloud dogfood / pilots; everyone else needs active Scale.
async function isEligible(supabase, workspaceId) {
  if (ALLOWLIST.has(workspaceId)) return true;
  const { data: ws } = await supabase.from('workspaces').select('team_id').eq('id', workspaceId).maybeSingle();
  if (!ws?.team_id) return false;
  const { data: sub } = await supabase
    .from('subscriptions').select('plan_id, status').eq('team_id', ws.team_id).maybeSingle();
  if (!sub) return false;
  const dead = sub.status === 'canceled' || sub.status === 'incomplete_expired' || sub.status === 'past_due';
  return !dead && sub.plan_id === 'scale';
}

// Find the workspace's native engagers list, creating it on first run.
async function ensureList(supabase, workspaceId) {
  const lists = await listLeadLists(supabase, workspaceId);
  const existing = lists.find(l => l.source === LIST_SOURCE || l.name === LIST_NAME);
  if (existing) return existing;
  return createLeadList(supabase, workspaceId, { name: LIST_NAME, source: LIST_SOURCE });
}

// Scrape a profile's recent-post engagers. Returns a map keyed by normalized URL.
async function scrapeEngagers(profileUrl) {
  const now = Date.now() / 1000;
  const url = String(profileUrl).split('?')[0];
  const posts = await runActor('harvestapi~linkedin-post-search',
    { profileUrls: [url], maxItems: 25, sortBy: 'date' });

  const keep = [];
  for (const p of posts) {
    const pu = p.linkedinUrl || p.url || p.postUrl;
    if (!pu) continue;
    const t = postTs(p, now);
    if (t != null) {
      const ageH = (now - t) / 3600;
      if (ageH < FLOOR_HOURS) continue;
      if (ageH / 24 > WINDOW_DAYS) continue;
    }
    keep.push(pu);
    if (keep.length >= MAX_POSTS) break;
  }

  const eng = new Map();
  const add = (actor, kind, { text = null, react = null, postUrl = null } = {}) => {
    if (!actor?.linkedinUrl) return;
    const k = normUrl(actor.linkedinUrl);
    const e = eng.get(k) || {
      name: actor.name || null, linkedin_url: actor.linkedinUrl.trim(),
      position: actor.position || null, kinds: new Set(), post_urls: new Set(),
      sample_comment: null, reaction: null,
    };
    e.kinds.add(kind);
    if (postUrl) e.post_urls.add(postUrl);
    if (text && !e.sample_comment) e.sample_comment = text;
    if (react && !e.reaction) e.reaction = react;
    eng.set(k, e);
  };

  for (const pu of keep) {
    try {
      const comments = await runActor('harvestapi~linkedin-post-comments',
        { posts: [pu], maxItems: MAX_PER_POST, profileScraperMode: PROFILE_MODE });
      for (const c of comments) add(c.actor, 'comment', { text: c.commentary, postUrl: pu });
    } catch (err) { console.error('[ENGAGE] comments error', pu, err.message); }
    try {
      const reactions = await runActor('harvestapi~linkedin-post-reactions',
        { posts: [pu], maxItems: MAX_PER_POST, profileScraperMode: PROFILE_MODE });
      for (const r of reactions) add(r.actor, 'reaction', { react: r.reactionType, postUrl: pu });
    } catch (err) { console.error('[ENGAGE] reactions error', pu, err.message); }
  }
  return { engagers: eng, postsMined: keep.length };
}

// ── per-workspace run ────────────────────────────────────────────────────────
async function runForWorkspace(supabase, conn) {
  const workspaceId = conn.workspace_id;
  const profileUrl = conn.linkedin_profile_url;
  if (!profileUrl) return null;
  if (!(await isEligible(supabase, workspaceId))) return null;

  const { engagers, postsMined } = await scrapeEngagers(profileUrl);
  if (engagers.size === 0) {
    await logSysEvent(supabase, {
      workspaceId, source: 'linkedin_engagement', eventType: 'run',
      summary: `No engagers on ${postsMined} recent post(s)`,
    });
    return { workspaceId, postsMined, engagers: 0, inserted: 0 };
  }

  const list = await ensureList(supabase, workspaceId);

  const rows = [...engagers.values()].map(e => {
    const kinds = [...e.kinds].sort().join('+'); // 'comment', 'reaction', or 'comment+reaction'
    return {
      name: e.name,
      linkedin_url: e.linkedin_url,
      fields: {
        title: e.position,
        source: 'Engaged with your LinkedIn post',
        engagement: kinds,
        post_urls: [...e.post_urls],
        sample_comment: e.sample_comment,
        reaction: e.reaction,
      },
    };
  });

  const res = await insertLeads(supabase, workspaceId, list.id, rows, { importDuplicates: false });

  // Attach an engagement observation to each engager's entity (idempotent per run).
  // We read back the list's leads to resolve entity ids for everyone we scraped —
  // including those skipped as duplicates (already a lead, but engaged again now).
  const urls = rows.map(r => r.linkedin_url);
  const { data: leadRows } = await supabase
    .from('leads').select('id, linkedin_url')
    .eq('workspace_id', workspaceId).eq('lead_list_id', list.id).in('linkedin_url', urls);

  const byUrl = new Map((leadRows || []).map(r => [normUrl(r.linkedin_url), r.id]));
  const rundate = new Date().toISOString().slice(0, 10);
  const nowISO = new Date().toISOString();
  const obs = [];
  for (const e of engagers.values()) {
    const entityId = byUrl.get(normUrl(e.linkedin_url));
    if (!entityId) continue;
    obs.push({
      workspace_id: workspaceId,
      entity_id: entityId,
      kind: 'event',
      property: ENGAGE_PROP,
      value: {
        kind: [...e.kinds].sort().join('+'),
        post_urls: [...e.post_urls],
        sample_comment: e.sample_comment,
        reaction: e.reaction,
        profile_name: e.name,
      },
      source: 'apify_linkedin',
      method: 'cron',
      external_id: `li_engage_${entityId}_${rundate}`,
      observed_at: nowISO,
    });
  }
  if (obs.length) {
    await supabase.from('observations')
      .upsert(obs, { onConflict: 'workspace_id,source,external_id', ignoreDuplicates: true });
  }

  await logSysEvent(supabase, {
    workspaceId, source: 'linkedin_engagement', eventType: 'run',
    summary: `${engagers.size} engager(s) from ${postsMined} post(s) → ${LIST_NAME} (${res.inserted} new, ${res.duplicate_skipped} already there)`,
    metadata: { postsMined, engagers: engagers.size, ...res, listId: list.id },
  });

  return { workspaceId, postsMined, engagers: engagers.size, inserted: res.inserted };
}

// ── entrypoint ───────────────────────────────────────────────────────────────
export async function runLinkedInEngagement() {
  if (!hasApifyToken()) return; // feature off — no token configured

  const startedAt = new Date().toISOString();
  const supabase = getSupabaseClient();
  const { data: conns, error } = await supabase
    .from('workspace_linkedin_connections')
    .select('workspace_id, linkedin_profile_url')
    .not('linkedin_profile_url', 'is', null);
  if (error) { console.error('[ENGAGE] load connections failed', error.message); return; }
  if (!conns?.length) return;

  let workspaces = 0, totalEngagers = 0, totalInserted = 0;
  for (const conn of conns) {
    try {
      const r = await runForWorkspace(supabase, conn);
      if (r) { workspaces++; totalEngagers += r.engagers; totalInserted += r.inserted; }
    } catch (err) {
      console.error('[ENGAGE] workspace failed', conn.workspace_id, err.message);
    }
  }

  console.log(`[ENGAGE] done — ${workspaces} workspace(s), ${totalEngagers} engagers, ${totalInserted} new leads`);
  await logWorkerRun(supabase, {
    worker: 'linkedin_engagement',
    status: 'success',
    summary: `${workspaces} workspace(s), ${totalEngagers} engagers, ${totalInserted} new leads`,
    details: { workspaces, engagers: totalEngagers, inserted: totalInserted },
    startedAt,
  });
}

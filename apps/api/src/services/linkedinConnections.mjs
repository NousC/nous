// Backfill a workspace's EXISTING LinkedIn 1st-degree connections into the native
// "LinkedIn Connections" list, marked 'connected'. The webhooks only capture
// connections going FORWARD (a new accept / DM / reply); this seeds the back-
// catalog by pulling the relation list from Unipile for the account the user
// already linked. On-demand (Sync button) — safe to re-run (per-list dedup +
// idempotent observations).
import { getSupabaseClient, listLeadLists, createLeadList, insertLeads } from '@nous/core';

const CONNECTIONS_SOURCE = 'linkedin_connections';
const CONNECTIONS_LIST_NAME = 'LinkedIn Connections';
const MAX_RELATIONS = 5000; // safety cap per run

async function ensureConnectionsList(supabase, workspaceId) {
  const lists = await listLeadLists(supabase, workspaceId);
  return lists.find(l => l.source === CONNECTIONS_SOURCE)
    || await createLeadList(supabase, workspaceId, { name: CONNECTIONS_LIST_NAME, source: CONNECTIONS_SOURCE });
}

export async function syncLinkedInConnections(supabase, workspaceId) {
  if (!process.env.UNIPILE_API_KEY || !process.env.UNIPILE_DSN) return { error: 'not_configured' };
  const base = `https://${process.env.UNIPILE_DSN}`;
  const headers = { 'X-API-KEY': process.env.UNIPILE_API_KEY, accept: 'application/json' };

  const { data: accounts } = await supabase
    .from('workspace_linkedin_connections')
    .select('unipile_account_id')
    .eq('workspace_id', workspaceId);
  const accountIds = [...new Set((accounts || []).map(a => a.unipile_account_id).filter(Boolean))];
  console.log('[sync] accounts', accountIds.length, accountIds);
  if (!accountIds.length) return { error: 'no_account' };

  const list = await ensureConnectionsList(supabase, workspaceId);
  console.log('[sync] list', list?.id);

  // 1. Pull relations from every connected account, paginated by cursor.
  const rows = [];
  for (const accountId of accountIds) {
    let cursor = null;
    do {
      const url = `${base}/api/v1/users/relations?account_id=${encodeURIComponent(accountId)}&limit=100`
        + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      let d;
      try {
        const r = await fetch(url, { headers });
        if (!r.ok) break;
        d = await r.json();
      } catch { break; }
      for (const it of (d.items || [])) {
        const memberId = it.member_id || it.provider_id || null;
        const slug = it.public_identifier || null;
        const linkedinUrl = it.public_profile_url || it.profile_url
          || (slug ? `https://www.linkedin.com/in/${slug}` : null);
        const name = it.name || [it.first_name, it.last_name].filter(Boolean).join(' ').trim() || null;
        if (!linkedinUrl && !memberId) continue;
        rows.push({
          name, linkedin_url: linkedinUrl, linkedin_member_id: memberId, source: 'LinkedIn',
          fields: it.headline ? { title: it.headline } : {},
        });
        if (rows.length >= MAX_RELATIONS) break;
      }
      cursor = d.cursor || null;
    } while (cursor && rows.length < MAX_RELATIONS);
  }

  console.log('[sync] relations fetched', rows.length);
  if (!rows.length) return { synced: 0, added: 0, marked: 0, accounts: accountIds.length };

  // 2. Insert membership in BATCHES. The leads-view INSERT trigger resolves
  //    identity per row, so a single ~1000-row insert blows the Postgres
  //    statement timeout (57014). Each batch is its own statement, well under
  //    the limit, and commits independently — so a re-run resumes (per-list
  //    dedup skips what's already in).
  let added = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const ins = await insertLeads(supabase, workspaceId, list.id, rows.slice(i, i + 100), { importDuplicates: false });
    added += ins.inserted ?? 0;
  }
  console.log('[sync] insertLeads added', added);

  // 3. Mark every list member 'connected': bulk-write interaction.linkedin_connected
  //    for any entity that doesn't already have one (idempotent; the view's status
  //    keeps a higher stage — messaged/replied — if it exists).
  const ids = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('leads').select('id')
      .eq('workspace_id', workspaceId).eq('lead_list_id', list.id).range(from, from + 999);
    if (!data?.length) break;
    ids.push(...data.map(r => r.id));
    if (data.length < 1000) break;
  }
  const have = new Set();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('observations').select('entity_id')
      .eq('workspace_id', workspaceId).eq('property', 'interaction.linkedin_connected')
      .in('entity_id', ids.slice(i, i + 200));
    for (const o of (data || [])) have.add(o.entity_id);
  }
  const now = new Date().toISOString();
  const obs = ids.filter(id => !have.has(id)).map(id => ({
    workspace_id: workspaceId, entity_id: id, kind: 'event',
    property: 'interaction.linkedin_connected', value: { backfill: true },
    source: 'linkedin', method: 'backfill', observed_at: now,
    external_id: `li_conn_backfill_${id}`,
  }));
  for (let i = 0; i < obs.length; i += 200) {
    await supabase.from('observations').insert(obs.slice(i, i + 200)).then(() => {}, () => {});
  }

  return { synced: rows.length, added, marked: obs.length, accounts: accountIds.length };
}

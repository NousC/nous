import type { SupabaseClient } from '@supabase/supabase-js';
import { isUUID, isEmail, normaliseLinkedInUrl, VALID_PIPELINE_STAGES } from '../utils/identity.js';
import { computeLinkedInChannel } from '../utils/linkedin.js';
import type {
  Contact, ContactProfile, ContactListItem,
  ListContactsParams, CreateContactParams, UpdateContactParams,
} from '../types.js';

const CONTACT_SELECT = 'id, email, first_name, last_name, company, job_title, linkedin_url, photo_url, channels, pipeline_stage, deal_health_score, icp_score, icp_fit, last_activity_at, company_id, memory_summary';
const CONTACT_LIST_SELECT = 'id, email, first_name, last_name, company, job_title, source, icp_fit, icp_score, icp_reasoning, deal_health_score, pipeline_stage, last_activity_at, deal_stage, company_id, linkedin_url, channels, photo_url';

function formatContact(c: Record<string, unknown>): ContactListItem {
  return {
    id: c.id as string,
    email: c.email as string,
    name: [c.first_name, c.last_name].filter(Boolean).join(' ') || null,
    company: (c.company as string) || null,
    company_id: (c.company_id as string) || null,
    title: (c.job_title as string) || null,
    linkedin_url: (c.linkedin_url as string) || null,
    channels: c.channels
      ? { ...(c.channels as Record<string, unknown>), ...((c.channels as Record<string, unknown>).linkedin && { linkedin: computeLinkedInChannel((c.channels as Record<string, Record<string, unknown>>).linkedin) }) }
      : null,
    icp_fit: (c.icp_fit as string) ?? null,
    icp_score: (c.icp_score as number) ?? null,
    deal_health_score: (c.deal_health_score as number) ?? null,
    pipeline_stage: ((c.pipeline_stage as string) || 'identified') as Contact['pipeline_stage'],
    last_activity_at: (c.last_activity_at as string) || null,
  };
}

export async function listContacts(
  supabase: SupabaseClient,
  workspaceId: string,
  params: ListContactsParams = {},
): Promise<{ contacts: ContactListItem[]; total: number; limit: number; offset: number }> {
  const { search, pipeline_stage, company_id, ids, filter, sort = 'recent', linkedin_url } = params;
  const limitNum = Math.min(params.limit ?? 50, 200);
  const offsetNum = params.offset ?? 0;

  let query = supabase
    .from('contacts')
    .select(CONTACT_LIST_SELECT, { count: 'exact' })
    .eq('workspace_id', workspaceId);

  if (ids?.trim()) {
    const idList = ids.split(',').map(s => s.trim()).filter(Boolean);
    if (idList.length) query = query.in('id', idList);
  }

  query = (sort === 'score' || sort === 'deal_health_score' || sort === 'connection_score')
    ? query.order('deal_health_score', { ascending: false, nullsFirst: false })
    : query.order('last_activity_at', { ascending: false, nullsFirst: false });

  if (search?.trim()) {
    const q = `%${search.trim()}%`;
    query = query.or(`email.ilike.${q},first_name.ilike.${q},last_name.ilike.${q},company.ilike.${q}`);
  }

  if (linkedin_url?.trim()) {
    const norm = normaliseLinkedInUrl(linkedin_url.trim());
    if (norm) query = query.eq('linkedin_url', norm);
  }

  if (pipeline_stage && (VALID_PIPELINE_STAGES as readonly string[]).includes(pipeline_stage)) {
    query = query.eq('pipeline_stage', pipeline_stage);
  }

  if (company_id && isUUID(company_id)) {
    query = query.eq('company_id', company_id);
  }

  const now = Date.now();
  if (filter === 'hot') {
    query = query
      .gte('last_activity_at', new Date(now - 14 * 86400000).toISOString())
      .gte('deal_health_score', 45);
  } else if (filter === 'engaged') {
    query = query.gte('last_activity_at', new Date(now - 60 * 86400000).toISOString());
  }

  query = query.range(offsetNum, offsetNum + limitNum - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    contacts: (data || []).map(formatContact),
    total: count || 0,
    limit: limitNum,
    offset: offsetNum,
  };
}

export async function getContactByIdentifier(
  supabase: SupabaseClient,
  workspaceId: string,
  identifier: string,
): Promise<ContactProfile | null> {
  let row: Record<string, unknown> | null = null;

  if (isUUID(identifier)) {
    const { data } = await supabase.from('contacts').select(CONTACT_SELECT).eq('id', identifier).eq('workspace_id', workspaceId).single();
    row = data;
  } else if (isEmail(identifier)) {
    const { data } = await supabase.from('contacts').select(CONTACT_SELECT).eq('email', identifier.toLowerCase()).eq('workspace_id', workspaceId).single();
    row = data;
  } else {
    return null;
  }

  if (!row) return null;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: activityRows },
    companyResult,
    { data: recentSignals },
    { data: contactMems },
    companyMemResult,
  ] = await Promise.all([
    supabase.from('contact_activity_log')
      .select('id, activity_type, description, summary, source, occurred_at, raw_data')
      .eq('contact_id', row.id).order('occurred_at', { ascending: false }).limit(25),
    row.company_id
      ? supabase.from('companies').select('name, domain, industry, employee_count, location').eq('id', row.company_id).single()
      : Promise.resolve({ data: null }),
    supabase.from('contact_activity_log')
      .select('activity_type').eq('contact_id', row.id).gte('occurred_at', thirtyDaysAgo),
    supabase.from('workspace_memories')
      .select('category, content, metadata').eq('workspace_id', workspaceId).eq('is_active', true)
      .filter('metadata->>contact_id', 'eq', row.id)
      .order('created_at', { ascending: false }).limit(20),
    row.company_id
      ? supabase.from('workspace_memories')
          .select('category, content, metadata').eq('workspace_id', workspaceId).eq('is_active', true)
          .filter('metadata->>company_id', 'eq', row.company_id)
          .order('created_at', { ascending: false }).limit(20)
      : Promise.resolve({ data: [] }),
  ]);

  const signals30d = (recentSignals || []).reduce<Record<string, number>>((acc, a) => {
    acc[(a as Record<string, string>).activity_type] = (acc[(a as Record<string, string>).activity_type] || 0) + 1;
    return acc;
  }, {});

  const facts = [
    ...(contactMems || []).map(m => ({ scope: 'contact' as const, category: m.category, content: m.content, graph_layer: (m.metadata?.graph_layer ?? 'private') as 'private' | 'public' })),
    ...(companyMemResult.data || []).map(m => ({ scope: 'company' as const, category: m.category, content: m.content, graph_layer: (m.metadata?.graph_layer ?? 'private') as 'private' | 'public' })),
  ];

  const channels = (() => {
    const ch = row.channels as Record<string, unknown> | null;
    if (!ch?.linkedin) return ch;
    return { ...ch, linkedin: computeLinkedInChannel(ch.linkedin as Record<string, unknown>) };
  })();

  return {
    id: row.id as string,
    email: row.email as string,
    name: [row.first_name, row.last_name].filter(Boolean).join(' ') || null,
    company: (row.company as string) || (companyResult.data as Record<string, string>)?.name || null,
    company_id: (row.company_id as string) || null,
    title: (row.job_title as string) || null,
    linkedin_url: (row.linkedin_url as string) || null,
    photo_url: (row.photo_url as string) || null,
    channels,
    pipeline_stage: ((row.pipeline_stage as string) || 'identified') as Contact['pipeline_stage'],
    icp_fit: (row.icp_fit as string) ?? null,
    icp_score: (row.icp_score as number) ?? null,
    deal_health_score: (row.deal_health_score as number) ?? null,
    last_activity_at: (row.last_activity_at as string) || null,
    memory_summary: (row.memory_summary as string) || null,
    company_details: companyResult.data as ContactProfile['company_details'],
    activities: (activityRows || []).map(a => ({
      id: a.id,
      type: a.activity_type,
      description: a.description || a.summary || null,
      body: a.raw_data?.body || a.raw_data?.message || null,
      source: a.source || null,
      occurred_at: a.occurred_at,
    })),
    facts,
    signals_30d: signals30d,
  };
}

export async function createContact(
  supabase: SupabaseClient,
  workspaceId: string,
  params: CreateContactParams,
): Promise<ContactListItem> {
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      workspace_id: workspaceId,
      email: params.email.toLowerCase().trim(),
      first_name: params.first_name?.trim() || null,
      last_name: params.last_name?.trim() || null,
      company: params.company?.trim() || null,
      job_title: params.job_title?.trim() || null,
      phone: params.phone?.trim() || null,
      linkedin_url: normaliseLinkedInUrl(params.linkedin_url || null),
      notes: params.notes?.trim() || null,
      pipeline_stage: 'identified',
      source: 'api',
    })
    .select(CONTACT_LIST_SELECT)
    .single();

  if (error) {
    if (error.code === '23505') throw Object.assign(new Error('email_already_exists'), { status: 409 });
    throw error;
  }

  return formatContact(data);
}

export async function updateContact(
  supabase: SupabaseClient,
  workspaceId: string,
  identifier: string,
  params: UpdateContactParams,
): Promise<ContactListItem | null> {
  const existing = await getContactByIdentifier(supabase, workspaceId, identifier);
  if (!existing) return null;

  const updates: Record<string, unknown> = {};
  if (params.first_name !== undefined) updates.first_name = params.first_name.trim() || null;
  if (params.last_name !== undefined) updates.last_name = params.last_name.trim() || null;
  if (params.company !== undefined) updates.company = params.company.trim() || null;
  if (params.job_title !== undefined) updates.job_title = params.job_title.trim() || null;
  if (params.phone !== undefined) updates.phone = params.phone.trim() || null;
  if (params.linkedin_url !== undefined) updates.linkedin_url = normaliseLinkedInUrl(params.linkedin_url);
  if (params.notes !== undefined) updates.notes = params.notes.trim() || null;

  const { data, error } = await supabase
    .from('contacts')
    .update(updates)
    .eq('id', existing.id)
    .eq('workspace_id', workspaceId)
    .select(CONTACT_LIST_SELECT)
    .single();

  if (error) throw error;
  return formatContact(data);
}

export async function deleteContact(
  supabase: SupabaseClient,
  workspaceId: string,
  identifier: string,
): Promise<{ contact_id: string; email: string } | null> {
  const existing = await getContactByIdentifier(supabase, workspaceId, identifier);
  if (!existing) return null;

  // Delete related data first
  await Promise.all([
    supabase.from('contact_activity_log').delete().eq('contact_id', existing.id),
    supabase.from('workspace_memories')
      .update({ is_active: false })
      .filter('metadata->>contact_id', 'eq', existing.id)
      .eq('workspace_id', workspaceId),
  ]);

  await supabase.from('contacts').delete().eq('id', existing.id).eq('workspace_id', workspaceId);

  return { contact_id: existing.id, email: existing.email };
}

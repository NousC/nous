import type { SupabaseClient } from '@supabase/supabase-js';
import { isUUID } from '../utils/identity.js';
import type { Lead, LeadList, LeadColumn, LeadStatus, ReplyOutcome } from '../types.js';

// DB layer for Lead Lists — the cold outreach universe, kept separate from
// `contacts` (People). See docs/adaptive-lead-scoring.md.

const LEAD_LIST_COLUMNS = 'id, workspace_id, name, source, columns, created_at, updated_at';

const LEAD_COLUMNS =
  'id, lead_list_id, workspace_id, email, name, company, linkedin_url, ' +
  'sent_at, send_variant, is_repeat_contact, features, fields, scorecard_score, ' +
  'reply_outcome, replied_at, status, contact_id, created_at, updated_at';

// Columns a new list starts with, beyond the fixed name / email / company /
// linkedin / status. Stored on lead_lists.columns; values live in leads.fields.
const DEFAULT_LEAD_COLUMNS: LeadColumn[] = [
  { key: 'title',        label: 'Title' },
  { key: 'industry',     label: 'Industry' },
  { key: 'company_size', label: 'Company size' },
];

const cleanEmail = (email: string | null | undefined): string | null =>
  email ? email.toLowerCase().trim() || null : null;

// ── Lead lists ────────────────────────────────────────────────────────────────

export interface CreateLeadListParams {
  name: string;
  source?: string;
}

export async function createLeadList(
  supabase: SupabaseClient,
  workspaceId: string,
  params: CreateLeadListParams,
): Promise<LeadList> {
  const { data, error } = await supabase
    .from('lead_lists')
    .insert({
      workspace_id: workspaceId,
      name: params.name.trim(),
      source: params.source ?? 'csv',
      columns: DEFAULT_LEAD_COLUMNS,
    })
    .select(LEAD_LIST_COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as LeadList;
}

// Replace a list's user-defined column set.
export async function updateLeadListColumns(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  columns: LeadColumn[],
): Promise<LeadList | null> {
  if (!isUUID(id)) return null;
  const clean = columns
    .filter(c => c && typeof c.key === 'string' && c.key.trim())
    .map(c => ({ key: c.key.trim(), label: String(c.label || c.key).trim() }));
  const { data, error } = await supabase
    .from('lead_lists')
    .update({ columns: clean })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select(LEAD_LIST_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as LeadList) ?? null;
}

export async function listLeadLists(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<LeadList[]> {
  const { data, error } = await supabase
    .from('lead_lists')
    .select(`${LEAD_LIST_COLUMNS}, leads(count)`)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => {
    const { leads, ...rest } = row as Record<string, unknown> & {
      leads?: { count: number }[];
    };
    return { ...(rest as unknown as LeadList), lead_count: leads?.[0]?.count ?? 0 };
  });
}

export async function getLeadList(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
): Promise<LeadList | null> {
  if (!isUUID(id)) return null;
  const { data, error } = await supabase
    .from('lead_lists')
    .select(LEAD_LIST_COLUMNS)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as LeadList) ?? null;
}

// ── Leads ─────────────────────────────────────────────────────────────────────

export interface LeadInput {
  email?: string | null;
  name?: string | null;
  company?: string | null;
  linkedin_url?: string | null;
  send_variant?: string | null;
  is_repeat_contact?: boolean;
  features?: Record<string, unknown>;
  fields?: Record<string, unknown>;
}

// Bulk-insert leads into a list. Rows with neither an email nor a LinkedIn URL
// are dropped — there would be no way to resolve a reply back to them.
export async function insertLeads(
  supabase: SupabaseClient,
  workspaceId: string,
  leadListId: string,
  rows: LeadInput[],
): Promise<{ inserted: number; skipped: number }> {
  if (!isUUID(leadListId) || rows.length === 0) return { inserted: 0, skipped: 0 };

  const payload = rows
    .map(r => ({
      lead_list_id: leadListId,
      workspace_id: workspaceId,
      email: cleanEmail(r.email),
      name: r.name?.trim() || null,
      company: r.company?.trim() || null,
      linkedin_url: r.linkedin_url?.trim() || null,
      send_variant: r.send_variant ?? null,
      is_repeat_contact: r.is_repeat_contact ?? false,
      features: r.features ?? {},
      fields: r.fields ?? {},
    }))
    .filter(r => r.email || r.linkedin_url);

  const skipped = rows.length - payload.length;
  if (payload.length === 0) return { inserted: 0, skipped };

  const { data, error } = await supabase.from('leads').insert(payload).select('id');
  if (error) throw error;
  return { inserted: data?.length ?? 0, skipped };
}

export async function listLeads(
  supabase: SupabaseClient,
  workspaceId: string,
  leadListId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<Lead[]> {
  if (!isUUID(leadListId)) return [];
  const limit = Math.min(opts.limit ?? 100, 1000);
  const offset = opts.offset ?? 0;
  const { data, error } = await supabase
    .from('leads')
    .select(LEAD_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('lead_list_id', leadListId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data || []) as unknown as Lead[];
}

// Resolve an inbound reply to a lead. Returns the most recent matching lead in
// the workspace, or null. Used by the graduation flow.
export async function findLeadByEmail(
  supabase: SupabaseClient,
  workspaceId: string,
  email: string,
): Promise<Lead | null> {
  const clean = cleanEmail(email);
  if (!clean) return null;
  const { data, error } = await supabase
    .from('leads')
    .select(LEAD_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('email', clean)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0] as unknown as Lead) ?? null;
}

export interface LeadPatch {
  status?: LeadStatus;
  reply_outcome?: ReplyOutcome | null;
  replied_at?: string | null;
  sent_at?: string | null;
  send_variant?: string | null;
  scorecard_score?: number | null;
  contact_id?: string | null;
  features?: Record<string, unknown>;
  fields?: Record<string, unknown>;
}

export async function updateLead(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  patch: LeadPatch,
): Promise<Lead | null> {
  if (!isUUID(id)) return null;
  const { data, error } = await supabase
    .from('leads')
    .update(patch)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select(LEAD_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Lead) ?? null;
}

// ── Suppression list ──────────────────────────────────────────────────────────

export async function addSuppression(
  supabase: SupabaseClient,
  workspaceId: string,
  email: string,
  reason?: string,
): Promise<void> {
  const clean = cleanEmail(email);
  if (!clean) return;
  const { error } = await supabase
    .from('lead_suppressions')
    .upsert(
      { workspace_id: workspaceId, email: clean, reason: reason ?? null },
      { onConflict: 'workspace_id,email' },
    );
  if (error) throw error;
}

export async function isSuppressed(
  supabase: SupabaseClient,
  workspaceId: string,
  email: string,
): Promise<boolean> {
  const clean = cleanEmail(email);
  if (!clean) return false;
  const { data, error } = await supabase
    .from('lead_suppressions')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('email', clean)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

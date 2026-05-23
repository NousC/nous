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

// Normalize a LinkedIn URL for cross-list dedup. Same transforms Proply
// Connect's engagement engine uses, so the two stay in sync: lowercase, force
// https, drop www., drop query/fragment, drop trailing slashes.
function normalizeLinkedInUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  const trimmed = u.trim();
  if (!trimmed) return null;
  return trimmed
    .toLowerCase()
    .replace(/^http:\/\//, 'https://')
    .replace(/^https?:\/\/www\./, 'https://')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

// Bulk-insert leads into a list. Rows with neither an email nor a LinkedIn URL
// are dropped — there would be no way to resolve a reply back to them.
//
// By default rows whose email or normalized LinkedIn URL already exists in the
// workspace are skipped (workspace-wide dedup, matching how operators expect
// re-imports to behave). Pass `{ importDuplicates: true }` to force-insert.
//
// Response counts:
//   - inserted          rows actually written
//   - skipped           total rows not written (no-identifier + duplicates)
//   - duplicate_skipped of `skipped`, how many were dedup matches
export async function insertLeads(
  supabase: SupabaseClient,
  workspaceId: string,
  leadListId: string,
  rows: LeadInput[],
  opts: { importDuplicates?: boolean } = {},
): Promise<{ inserted: number; skipped: number; duplicate_skipped: number }> {
  if (!isUUID(leadListId) || rows.length === 0) {
    return { inserted: 0, skipped: 0, duplicate_skipped: 0 };
  }

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

  const droppedNoIdentifier = rows.length - payload.length;

  let toInsert = payload;
  let duplicateSkipped = 0;

  if (!opts.importDuplicates && payload.length > 0) {
    // Pull every existing email + linkedin_url in the workspace, paginated,
    // and filter the incoming payload through them. Workspace-wide so the
    // same person doesn't end up in two lists as two rows.
    const existingEmails = new Set<string>();
    const existingUrls = new Set<string>();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('leads')
        .select('email, linkedin_url')
        .eq('workspace_id', workspaceId)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const row of data) {
        if (row.email) existingEmails.add(row.email.toLowerCase().trim());
        const u = normalizeLinkedInUrl(row.linkedin_url);
        if (u) existingUrls.add(u);
      }
      if (data.length < PAGE) break;
    }

    toInsert = payload.filter(r => {
      if (r.email && existingEmails.has(r.email)) return false;
      const u = normalizeLinkedInUrl(r.linkedin_url);
      if (u && existingUrls.has(u)) return false;
      return true;
    });
    duplicateSkipped = payload.length - toInsert.length;
  }

  if (toInsert.length === 0) {
    return {
      inserted: 0,
      skipped: droppedNoIdentifier + duplicateSkipped,
      duplicate_skipped: duplicateSkipped,
    };
  }

  const { data, error } = await supabase.from('leads').insert(toInsert).select('id');
  if (error) throw error;
  return {
    inserted: data?.length ?? 0,
    skipped: droppedNoIdentifier + duplicateSkipped,
    duplicate_skipped: duplicateSkipped,
  };
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

// ── Cold-outbound dedup: classifyEmails ──────────────────────────────────────
//
// The pre-flight check for a new CSV upload. Given a list of emails, returns
// which are safe to cold-email and which are not (already engaged, bounced,
// unsubscribed, workspace-suppressed, or recently contacted). Cross-list,
// across all-time engagement — the agency unlock v2 enables.

export type EmailClassificationStatus =
  | 'net_new'        // no prior record — safe to send
  | 'engaged'        // in an active conversation; don't cold-send
  | 'recent'         // contacted within the cooldown window — defer
  | 'bounced'        // last delivery bounced — skip
  | 'unsubscribed'   // opted out or do-not-contact — skip
  | 'suppressed';    // workspace-level suppression (policy layer)

export interface EmailClassification {
  email: string;
  status: EmailClassificationStatus;
  entity_id?: string;
  reason?: string | null;
}

const STAGE_ENGAGED = new Set(['aware', 'interested', 'evaluating', 'client']);
const RECENT_WINDOW_DAYS = 30;

/**
 * Classify a batch of emails against the workspace's existing engagement
 * graph. Pure read — does not mutate anything.
 */
export async function classifyEmails(
  supabase: SupabaseClient,
  workspaceId: string,
  emails: string[],
): Promise<EmailClassification[]> {
  const normalized = Array.from(new Set(
    emails.map(e => (e ?? '').toLowerCase().trim()).filter(Boolean),
  ));
  if (normalized.length === 0) return [];

  // 1. Workspace policy: suppressions
  const { data: suppressed } = await supabase
    .from('lead_suppressions')
    .select('email, reason')
    .eq('workspace_id', workspaceId)
    .in('email', normalized);
  const supByEmail = new Map<string, string | null>(
    (suppressed ?? []).map(s => [(s as { email: string }).email, (s as { reason: string | null }).reason]),
  );

  // 2. Existing entity_identifiers (the v2 identity index)
  const { data: idents } = await supabase
    .from('entity_identifiers')
    .select('value, entity_id')
    .eq('workspace_id', workspaceId)
    .eq('kind', 'email')
    .eq('status', 'active')
    .in('value', normalized);
  const entityByEmail = new Map<string, string>(
    (idents ?? []).map(i => [(i as { value: string }).value, (i as { entity_id: string }).entity_id]),
  );

  // 3. For matched entities — what we know about them
  const entityIds = [...new Set(entityByEmail.values())];
  const claimsByEntity = new Map<string, Record<string, unknown>>();
  const recentByEntity = new Set<string>();

  if (entityIds.length > 0) {
    const { data: claimRows } = await supabase
      .from('claims')
      .select('entity_id, property, value')
      .in('entity_id', entityIds)
      .is('invalid_at', null)
      .in('property', ['reachability_status', 'sentiment', 'pipeline_stage']);
    for (const c of (claimRows ?? []) as { entity_id: string; property: string; value: unknown }[]) {
      const m = claimsByEntity.get(c.entity_id) ?? {};
      m[c.property] = c.value;
      claimsByEntity.set(c.entity_id, m);
    }

    const since = new Date(Date.now() - RECENT_WINDOW_DAYS * 86_400_000).toISOString();
    const { data: recents } = await supabase
      .from('observations')
      .select('entity_id')
      .in('entity_id', entityIds)
      .gte('observed_at', since)
      .like('property', 'interaction.%')
      .limit(entityIds.length * 4);
    for (const r of (recents ?? []) as { entity_id: string }[]) {
      recentByEntity.add(r.entity_id);
    }
  }

  // 4. Classify (suppression > bounced > unsubscribed > engaged > recent > net_new)
  return normalized.map((email): EmailClassification => {
    if (supByEmail.has(email)) {
      return { email, status: 'suppressed', reason: supByEmail.get(email) ?? 'workspace suppression' };
    }
    const entityId = entityByEmail.get(email);
    if (!entityId) return { email, status: 'net_new' };

    const claims = claimsByEntity.get(entityId) ?? {};
    const reach = claims.reachability_status as string | undefined;
    if (reach === 'bounced')      return { email, status: 'bounced', entity_id: entityId };
    if (reach === 'unsubscribed') return { email, status: 'unsubscribed', entity_id: entityId };

    const sentiment = claims.sentiment as string | undefined;
    if (sentiment === 'do_not_contact') {
      return { email, status: 'unsubscribed', entity_id: entityId, reason: 'do_not_contact' };
    }

    const stage = claims.pipeline_stage as string | undefined;
    if (stage && STAGE_ENGAGED.has(stage)) {
      return { email, status: 'engaged', entity_id: entityId, reason: stage };
    }

    if (recentByEntity.has(entityId)) {
      return { email, status: 'recent', entity_id: entityId };
    }

    // Entity exists but stage is cold/identified and no recent activity — could be re-touched.
    return { email, status: 'net_new', entity_id: entityId, reason: 'cold' };
  });
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

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// Notes — the human-asserted memory layer, now claim-shaped.
//
// Each note is an `asserted` claim on an entity (workspace / company / person)
// with property `note.<uuid>` and value {category, content, source, metadata}.
// Asserted claims have no observation backing, so the claim engine never
// overwrites them. "Delete" is invalidation via invalid_at — per the v2 rule,
// claims are never hard-deleted. Replaces the v1 workspace_memories table.

export interface Note {
  id: string;
  workspace_id: string;
  entity_id: string;
  category: string;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

const COLUMNS =
  'id, workspace_id, entity_id, property, value, ' +
  'confidence, epistemic_class, freshness, valid_from, invalid_at, computed_at';

function noteFromClaim(c: Record<string, unknown>): Note {
  const v = (c.value as Record<string, unknown> | null) ?? {};
  return {
    id: c.id as string,
    workspace_id: c.workspace_id as string,
    entity_id: c.entity_id as string,
    category: (v.category as string) ?? 'General',
    content: (v.content as string) ?? '',
    source: (v.source as string) ?? 'manual',
    metadata: (v.metadata as Record<string, unknown>) ?? {},
    created_at: (c.valid_from as string) ?? (c.computed_at as string),
    updated_at: c.computed_at as string,
    is_active: c.invalid_at == null,
  };
}

/** The workspace entity id — every workspace has exactly one (per migration). */
export async function getWorkspaceEntityId(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('entities')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('type', 'workspace')
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export interface ListNotesOpts {
  entityId?: string;
  entityIds?: string[];
  categories?: string[];
  limit?: number;
  offset?: number;
  includeInactive?: boolean;
}

/** List notes, newest first. */
export async function listNotes(
  supabase: SupabaseClient,
  workspaceId: string,
  opts: ListNotesOpts = {},
): Promise<Note[]> {
  let q = supabase
    .from('claims')
    .select(COLUMNS)
    .eq('workspace_id', workspaceId)
    .like('property', 'note.%');
  if (!opts.includeInactive) q = q.is('invalid_at', null);
  if (opts.entityId) q = q.eq('entity_id', opts.entityId);
  if (opts.entityIds?.length) q = q.in('entity_id', opts.entityIds);
  q = q.order('valid_from', { ascending: false });
  if (opts.limit != null) {
    const off = opts.offset ?? 0;
    q = q.range(off, off + opts.limit - 1);
  }

  const { data, error } = await q;
  if (error) throw error;

  // Category is inside JSONB value — filter in JS to keep the query portable.
  let notes = (data ?? []).map(c => noteFromClaim(c as unknown as Record<string, unknown>));
  if (opts.categories?.length) {
    const set = new Set(opts.categories);
    notes = notes.filter(n => set.has(n.category));
  }
  return notes;
}

export interface SaveNoteParams {
  /** Defaults to the workspace entity. */
  entityId?: string;
  category?: string;
  content: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export async function saveNote(
  supabase: SupabaseClient,
  workspaceId: string,
  params: SaveNoteParams,
): Promise<Note | null> {
  let entityId = params.entityId;
  if (!entityId) {
    const fallback = await getWorkspaceEntityId(supabase, workspaceId);
    if (!fallback) throw new Error('workspace entity not found');
    entityId = fallback;
  }
  const now = new Date().toISOString();
  const value = {
    category: params.category ?? 'General',
    content: params.content,
    source: params.source ?? 'manual',
    metadata: params.metadata ?? {},
  };
  const { data, error } = await supabase
    .from('claims')
    .insert({
      workspace_id: workspaceId,
      entity_id: entityId,
      property: `note.${randomUUID()}`,
      value,
      confidence: 1.0,
      epistemic_class: 'asserted',
      freshness: 'fresh',
      valid_from: now,
      computed_at: now,
    })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data ? noteFromClaim(data as unknown as Record<string, unknown>) : null;
}

export async function updateNote(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  patch: { content?: string; category?: string; is_active?: boolean },
): Promise<Note | null> {
  const { data: current, error: e1 } = await supabase
    .from('claims')
    .select(COLUMNS)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (e1) throw e1;
  if (!current) return null;

  const cur = current as unknown as Record<string, unknown>;
  const v = (cur.value as Record<string, unknown>) ?? {};
  const nextValue: Record<string, unknown> = { ...v };
  if (patch.content !== undefined) nextValue.content = patch.content;
  if (patch.category !== undefined) nextValue.category = patch.category;

  const updates: Record<string, unknown> = {
    value: nextValue,
    computed_at: new Date().toISOString(),
  };
  if (patch.is_active === false) updates.invalid_at = new Date().toISOString();
  if (patch.is_active === true) updates.invalid_at = null;

  const { data, error } = await supabase
    .from('claims')
    .update(updates)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data ? noteFromClaim(data as unknown as Record<string, unknown>) : null;
}

/** Soft-delete (invalidate). Per the v2 rule, claims are never hard-deleted. */
export async function deleteNote(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
): Promise<void> {
  await supabase
    .from('claims')
    .update({ invalid_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', workspaceId);
}

export async function getNote(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
): Promise<Note | null> {
  const { data, error } = await supabase
    .from('claims')
    .select(COLUMNS)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) throw error;
  return data ? noteFromClaim(data as unknown as Record<string, unknown>) : null;
}

/** Active notes count across the workspace. */
export async function countActiveNotes(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  const { count } = await supabase
    .from('claims')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .like('property', 'note.%')
    .is('invalid_at', null);
  return count ?? 0;
}

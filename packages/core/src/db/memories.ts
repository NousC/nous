import type { SupabaseClient } from '@supabase/supabase-js';
import { isUUID } from '../utils/identity.js';
import type { WorkspaceMemory, MemoryCategory } from '../types.js';

export interface SaveMemoryParams {
  content: string;
  category?: MemoryCategory;
  source?: string;
  metadata?: Record<string, unknown>;
  embedding?: number[] | null;
}

export interface SearchMemoryParams {
  q: string;
  contact_id?: string;
  company_id?: string;
  limit?: number;
}

export interface SearchResult {
  id: string;
  category: MemoryCategory;
  content: string;
  similarity: number;
  written_at: string | null;
}

export async function listMemories(
  supabase: SupabaseClient,
  workspaceId: string,
  opts: { category?: MemoryCategory; limit?: number } = {},
): Promise<WorkspaceMemory[]> {
  let query = supabase
    .from('workspace_memories')
    .select('id, category, content, source, metadata, created_at, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .is('metadata->>contact_id', null)
    .is('metadata->>company_id', null)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 50);

  if (opts.category) query = query.eq('category', opts.category);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as WorkspaceMemory[];
}

export async function saveMemory(
  supabase: SupabaseClient,
  workspaceId: string,
  params: SaveMemoryParams,
): Promise<WorkspaceMemory> {
  const { data, error } = await supabase
    .from('workspace_memories')
    .insert({
      workspace_id: workspaceId,
      category: params.category ?? 'General',
      content: params.content.trim(),
      source: params.source ?? 'api',
      is_active: true,
      metadata: params.metadata ?? {},
      embedding: params.embedding ? JSON.stringify(params.embedding) : null,
    })
    .select('id, category, content, source, metadata, created_at')
    .single();

  if (error) throw error;
  return data as WorkspaceMemory;
}

export async function updateMemory(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  params: { content?: string; category?: MemoryCategory; metadata?: Record<string, unknown>; embedding?: number[] | null },
): Promise<WorkspaceMemory | null> {
  if (!isUUID(id)) return null;

  const { data: existing } = await supabase
    .from('workspace_memories')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .single();

  if (!existing) return null;

  const updates: Record<string, unknown> = {
    content: params.content?.trim() ?? existing.content,
    category: params.category ?? existing.category,
    metadata: params.metadata !== undefined ? params.metadata : existing.metadata,
    source: 'api',
  };

  if (params.embedding !== undefined) {
    updates.embedding = params.embedding ? JSON.stringify(params.embedding) : null;
  }

  const { data, error } = await supabase
    .from('workspace_memories')
    .update(updates)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('id, category, content, source, metadata, created_at, updated_at')
    .single();

  if (error) throw error;
  return data as WorkspaceMemory;
}

export async function softDeleteMemory(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
): Promise<{ id: string; content: string } | null> {
  if (!isUUID(id)) return null;

  const { data: existing } = await supabase
    .from('workspace_memories')
    .select('id, content')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .single();

  if (!existing) return null;

  await supabase
    .from('workspace_memories')
    .update({ is_active: false })
    .eq('id', id)
    .eq('workspace_id', workspaceId);

  return { id: existing.id, content: existing.content };
}

export async function searchMemories(
  supabase: SupabaseClient,
  workspaceId: string,
  params: SearchMemoryParams,
): Promise<SearchResult[]> {
  // Calls the pgvector similarity search RPC.
  // Falls back to ilike text search if embedding is unavailable.
  const limit = Math.min(params.limit ?? 10, 20);

  const rpcParams: Record<string, unknown> = {
    query_text: params.q,
    workspace_id: workspaceId,
    match_count: limit,
    threshold: params.contact_id ? 0.45 : 0.55,
  };

  if (params.contact_id) rpcParams.filter_contact_id = params.contact_id;
  if (params.company_id) rpcParams.filter_company_id = params.company_id;

  const { data, error } = await supabase.rpc('search_workspace_memories', rpcParams);

  if (error) {
    // Fallback: plain text search
    let q = supabase
      .from('workspace_memories')
      .select('id, category, content, metadata, created_at')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .ilike('content', `%${params.q}%`)
      .limit(limit);

    if (params.contact_id) q = q.filter('metadata->>contact_id', 'eq', params.contact_id);
    if (params.company_id) q = q.filter('metadata->>company_id', 'eq', params.company_id);

    const { data: fallback } = await q;
    return (fallback || []).map(r => ({
      id: r.id,
      category: r.category,
      content: r.content,
      similarity: 1,
      written_at: r.created_at,
    }));
  }

  return (data || []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    category: r.category as MemoryCategory,
    content: r.content as string,
    similarity: r.similarity as number,
    written_at: (r.created_at as string) || null,
  }));
}

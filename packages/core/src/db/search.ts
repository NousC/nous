import type { SupabaseClient } from '@supabase/supabase-js';
import { embed } from '../embed.js';

// Semantic search over the substrate. Step 2 of the Context API pipeline
// (Retrieve) — the pre-filter that narrows candidates before assembly.
// Returns [] if embeddings aren't available (no OPENAI_API_KEY) so callers
// fall back to structured retrieval.

export interface ClaimSearchHit {
  id: string;
  entity_id: string;
  property: string;
  value: unknown;
  confidence: number;
  freshness: string;
  similarity: number;
}

export async function searchClaims(
  supabase: SupabaseClient,
  workspaceId: string,
  query: string,
  opts: { limit?: number; threshold?: number } = {},
): Promise<ClaimSearchHit[]> {
  const vector = await embed(query);
  if (!vector) return [];

  const { data, error } = await supabase.rpc('search_claims', {
    p_workspace_id: workspaceId,
    p_embedding: JSON.stringify(vector),   // pgvector accepts the array literal as text
    p_threshold: opts.threshold ?? 0.3,
    p_limit: opts.limit ?? 20,
  });
  if (error) {
    // function missing (RPC not yet created) — degrade silently
    if (error.code === '42883' || error.code === 'PGRST202') return [];
    console.error('[searchClaims]', error.message);
    return [];
  }
  return (data as ClaimSearchHit[]) ?? [];
}

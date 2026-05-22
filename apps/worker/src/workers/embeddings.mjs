// Embedding worker — fills claim embeddings so semantic search works.
//
// Sweeps claims that have no embedding yet, embeds them in batches via
// OpenAI, and writes the vectors back. The backfilled claims and every
// new claim get embedded within a couple of minutes. No OPENAI_API_KEY =
// no-op (semantic search just stays dark; structured retrieval is unaffected).

import { getSupabaseClient, embedBatch } from '@nous/core';

const BATCH = 96;

function claimText(c) {
  let v = c.value;
  if (v && typeof v === 'object') v = JSON.stringify(v);
  return `${c.property}: ${v ?? ''}`.slice(0, 2000);
}

export async function processEmbeddings() {
  const supabase = getSupabaseClient();
  try {
    const { data: claims, error } = await supabase
      .from('claims')
      .select('id, property, value')
      .is('embedding', null)
      .limit(BATCH);

    // Migration not yet applied — skip silently.
    if (error?.code === '42P01' || error?.code === 'PGRST205') return;
    if (error) throw error;
    if (!claims?.length) return;

    const vectors = await embedBatch(claims.map(claimText));
    if (!vectors) return;   // no OPENAI_API_KEY, or the call failed — retry next sweep

    let embedded = 0;
    for (let i = 0; i < claims.length; i++) {
      const vec = vectors[i];
      if (!vec) continue;
      const { error: upErr } = await supabase
        .from('claims')
        .update({ embedding: JSON.stringify(vec) })   // array literal as text — pgvector parses it
        .eq('id', claims[i].id);
      if (!upErr) embedded++;
    }
    if (embedded) console.log(`[EMBEDDINGS] embedded ${embedded} claims`);
  } catch (err) {
    console.error('[EMBEDDINGS] sweep error:', err.message);
  }
}

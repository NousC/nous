// Embedding worker — fills claim AND observation embeddings so semantic
// search works. Sweeps rows that have no embedding yet, embeds them in
// batches via OpenAI, writes the vectors back. The backfilled rows and
// every new row get embedded within a couple of minutes. No OPENAI_API_KEY
// = no-op (semantic search stays dark; structured retrieval is unaffected).
//
// Observations are append-only, but their `embedding` index column is
// exempt from the immutability guard — see reject_mutation() in the schema.

import { getSupabaseClient, embedBatch } from '@nous/core';

const BATCH = 96;

function rowText(r) {
  let v = r.value;
  if (v && typeof v === 'object') v = JSON.stringify(v);
  return `${r.property}: ${v ?? ''}`.slice(0, 2000);
}

async function sweep(supabase, table) {
  const { data: rows, error } = await supabase
    .from(table)
    .select('id, property, value')
    .is('embedding', null)
    .limit(BATCH);

  if (error?.code === '42P01' || error?.code === 'PGRST205') return 0;
  if (error) throw error;
  if (!rows?.length) return 0;

  const vectors = await embedBatch(rows.map(rowText));
  if (!vectors) return 0;   // no OPENAI_API_KEY, or the call failed — retry next sweep

  let embedded = 0;
  for (let i = 0; i < rows.length; i++) {
    const vec = vectors[i];
    if (!vec) continue;
    const { error: upErr } = await supabase
      .from(table)
      .update({ embedding: JSON.stringify(vec) })
      .eq('id', rows[i].id);
    if (!upErr) embedded++;
  }
  return embedded;
}

export async function processEmbeddings() {
  const supabase = getSupabaseClient();
  try {
    const claims = await sweep(supabase, 'claims');
    const observations = await sweep(supabase, 'observations');
    if (claims || observations) {
      console.log(`[EMBEDDINGS] embedded ${claims} claims, ${observations} observations`);
    }
  } catch (err) {
    console.error('[EMBEDDINGS] sweep error:', err.message);
  }
}

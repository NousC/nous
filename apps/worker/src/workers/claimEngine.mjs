// Claim-derivation engine — drains the claim_jobs queue.
//
// Every observation insert enqueues a (entity, property) recompute via a DB
// trigger (observations_enqueue_recompute). This worker drains that queue and
// re-derives each affected claim from its observations. This is the
// self-healing loop: a new observation always pulls the belief back toward
// truth. The derivation logic itself lives in @nous/core (recomputeClaim).

import { getSupabaseClient, recomputeClaim, logWorkerRun } from '@nous/core';

const BATCH_SIZE = 500;        // jobs pulled per inner sweep
const CONCURRENCY = 15;        // parallel recomputes within a sweep
const TIME_BUDGET_MS = 50_000; // drain up to ~50s per tick (cron fires every minute)

// Prevent overlapping ticks — a long drain must not collide with the next cron.
let running = false;

export async function processClaimJobs() {
  if (running) return;
  running = true;
  const supabase = getSupabaseClient();
  const startedAt = new Date();
  const deadline = Date.now() + TIME_BUDGET_MS;
  let recomputed = 0, failed = 0, sweeps = 0;
  try {
    // Keep draining the queue (in 500-job sweeps) until it's empty or we hit the
    // time budget. Each sweep recomputes its unique (entity, property) targets in
    // parallel — distinct targets are independent, so this is safe.
    while (Date.now() < deadline) {
      const { data: jobs, error } = await supabase
        .from('claim_jobs')
        .select('id, workspace_id, entity_id, property')
        .is('picked_at', null)
        .order('enqueued_at', { ascending: true })
        .limit(BATCH_SIZE);

      // Migration not yet applied — skip silently so we don't spam logs.
      if (error?.code === '42P01' || error?.code === 'PGRST205') return;
      if (error) throw error;
      if (!jobs?.length) break; // queue drained

      // Collapse many observations on the same (entity, property) to one recompute.
      const targets = new Map();
      for (const j of jobs) targets.set(`${j.entity_id}:${j.property}`, j);

      const succeeded = new Set();
      const entries = [...targets.entries()];
      for (let i = 0; i < entries.length; i += CONCURRENCY) {
        await Promise.all(entries.slice(i, i + CONCURRENCY).map(async ([key, t]) => {
          try {
            await recomputeClaim(supabase, t.workspace_id, t.entity_id, t.property);
            succeeded.add(key);
            recomputed++;
          } catch (err) {
            failed++;
            console.error(`[CLAIM_ENGINE] ${t.entity_id}/${t.property}:`, err.message);
          }
        }));
      }

      // Delete jobs for succeeded targets; leave failed ones to retry next tick.
      const doneIds = jobs
        .filter(j => succeeded.has(`${j.entity_id}:${j.property}`))
        .map(j => j.id);
      if (doneIds.length) await supabase.from('claim_jobs').delete().in('id', doneIds);

      sweeps++;
      if (!succeeded.size) break; // everything failed — stop, don't hot-loop
    }

    if (recomputed || failed) {
      console.log(`[CLAIM_ENGINE] recomputed=${recomputed} failed=${failed} sweeps=${sweeps}`);
      await logWorkerRun(supabase, {
        worker: 'claim_engine',
        status: failed && !recomputed ? 'error' : 'success',
        summary: `recomputed ${recomputed}${failed ? `, failed ${failed}` : ''} over ${sweeps} sweep(s)`,
        details: { recomputed, failed, sweeps },
        startedAt,
      });
    }
  } catch (err) {
    console.error('[CLAIM_ENGINE] sweep error:', err.message);
    await logWorkerRun(supabase, {
      worker: 'claim_engine',
      status: 'error',
      summary: 'sweep failed',
      error: err.message,
      startedAt,
    });
  } finally {
    running = false;
  }
}

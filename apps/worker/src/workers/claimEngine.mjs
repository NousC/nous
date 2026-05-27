// Claim-derivation engine — drains the claim_jobs queue.
//
// Every observation insert enqueues a (entity, property) recompute via a DB
// trigger (observations_enqueue_recompute). This worker drains that queue and
// re-derives each affected claim from its observations. This is the
// self-healing loop: a new observation always pulls the belief back toward
// truth. The derivation logic itself lives in @nous/core (recomputeClaim).

import { getSupabaseClient, recomputeClaim, logWorkerRun } from '@nous/core';

const BATCH_SIZE = 200;

export async function processClaimJobs() {
  const supabase = getSupabaseClient();
  const startedAt = new Date();
  try {
    const { data: jobs, error } = await supabase
      .from('claim_jobs')
      .select('id, workspace_id, entity_id, property')
      .is('picked_at', null)
      .order('enqueued_at', { ascending: true })
      .limit(BATCH_SIZE);

    // Migration not yet applied — skip silently so we don't spam logs.
    if (error?.code === '42P01' || error?.code === 'PGRST205') return;
    if (error) throw error;
    if (!jobs?.length) return;

    // Many observations on the same (entity, property) enqueue many jobs —
    // collapse to one recompute per unique target.
    const targets = new Map();
    for (const j of jobs) {
      targets.set(`${j.entity_id}:${j.property}`, j);
    }

    const succeeded = new Set();
    let recomputed = 0, failed = 0;
    for (const [key, t] of targets) {
      try {
        await recomputeClaim(supabase, t.workspace_id, t.entity_id, t.property);
        succeeded.add(key);
        recomputed++;
      } catch (err) {
        failed++;
        console.error(`[CLAIM_ENGINE] ${t.entity_id}/${t.property}:`, err.message);
      }
    }

    // Delete jobs for succeeded targets; leave failed ones to retry next sweep.
    const doneIds = jobs
      .filter(j => succeeded.has(`${j.entity_id}:${j.property}`))
      .map(j => j.id);
    if (doneIds.length) {
      await supabase.from('claim_jobs').delete().in('id', doneIds);
    }

    if (recomputed || failed) {
      console.log(`[CLAIM_ENGINE] recomputed=${recomputed} failed=${failed} jobs=${jobs.length}`);
      await logWorkerRun(supabase, {
        worker: 'claim_engine',
        status: failed && !recomputed ? 'error' : 'success',
        summary: `recomputed ${recomputed}${failed ? `, failed ${failed}` : ''} from ${jobs.length} job(s)`,
        details: { recomputed, failed, jobs: jobs.length, unique_targets: targets.size },
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
  }
}

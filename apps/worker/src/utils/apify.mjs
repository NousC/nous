// Thin Apify client for the HarvestAPI LinkedIn actors used by the weekly
// engagement run. One call = run an actor synchronously and return its dataset
// items. No SDK dependency — just the run-sync-get-dataset-items endpoint.
//
// Token lives in APIFY_TOKEN. When it's unset the whole engagement feature is a
// no-op (the worker checks before calling here), so self-hosters and workspaces
// that never configured Apify never hit this.

const APIFY_BASE = 'https://api.apify.com/v2/acts';

export function hasApifyToken() {
  return !!process.env.APIFY_TOKEN;
}

// Run an actor and return its dataset items. `timeoutSecs` bounds the actor run
// server-side; we give the HTTP read a little more headroom on top.
export async function runActor(actor, input, { timeoutSecs = 240 } = {}) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN not set');
  const url = `${APIFY_BASE}/${actor}/run-sync-get-dataset-items?token=${token}&timeout=${timeoutSecs}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), (timeoutSecs + 20) * 1000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`apify ${actor} -> ${res.status} ${body.slice(0, 200)}`);
    }
    const items = await res.json();
    return Array.isArray(items) ? items : [];
  } finally {
    clearTimeout(t);
  }
}

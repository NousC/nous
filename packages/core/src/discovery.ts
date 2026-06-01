// Contrastive signal discovery — the data-driven candidate source for the
// Scorecard. Sweeps a won/lost cohort for features whose presence separates
// winners from losers by lift, and turns the strongest into new signal
// proposals. Deterministic (no LLM). Used by the nightly learning loop AND the
// "build from closed deals" onboarding. See docs/icp-from-closed-deals.md.

export interface DiscoveryEpisode {
  features: Record<string, unknown>;
  /** 0–1 outcome score (legacy fallback when no disposition). */
  outcome?: number;
  /** 'won' | 'lost' | 'no_opportunity' | null. no_opportunity should be excluded
   *  by the caller; if present here it is treated as a loss. */
  disposition?: string | null;
}

export interface DiscoverySignalRef {
  active?: boolean;
  rule?: { feature?: string } | null;
}

export interface SignalProposal {
  action: 'add';
  signal: { key: string; label: string; weight: number; rule: { feature: string; op: string; value: unknown } };
  note: string;
}

const dslug = (s: unknown) =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

/** Map a lift ratio to a signal weight (−10..10), in bands. */
export function weightFromLift(lift: number): number {
  if (lift >= 3) return 8;
  if (lift >= 2) return 6;
  if (lift >= 1.5) return 4;
  if (lift <= 0.33) return -8;
  if (lift <= 0.5) return -6;
  if (lift <= 0.66) return -4;
  return 0;
}

function labelForDiscovery(feature: string, value: unknown): string {
  const f = feature.replace(/^signal\./, '').replace(/[._]/g, ' ').trim();
  const title = f.replace(/\b\w/g, c => c.toUpperCase());
  return typeof value === 'boolean' ? title : `${title}: ${String(value).replace(/_/g, ' ')}`;
}

export function discoverSignals(
  episodes: DiscoveryEpisode[],
  signals: DiscoverySignalRef[],
): SignalProposal[] {
  const rows = episodes.map(e => ({
    features: e.features,
    win: e.disposition ? e.disposition === 'won' : (e.outcome ?? 0) >= 0.5,
  }));
  if (rows.length < 8) return [];

  const totalN = rows.length;
  const totalWins = rows.filter(r => r.win).length;
  if (totalWins === 0 || totalWins === totalN) return []; // no contrast

  // Tally (feature == value) candidates — booleans ("has X") and short categoricals.
  const cand = new Map<string, { feature: string; value: unknown; withN: number; winWith: number }>();
  for (const r of rows) {
    for (const [f, v] of Object.entries(r.features)) {
      if (v == null) continue;
      const isBool = typeof v === 'boolean';
      const isCat = typeof v === 'string' && v.length <= 40;
      if (!isBool && !isCat) continue;
      if (isBool && v === false) continue; // only presence of a signal
      const key = `${f}::${String(v)}`;
      let c = cand.get(key);
      if (!c) { c = { feature: f, value: v, withN: 0, winWith: 0 }; cand.set(key, c); }
      c.withN++;
      if (r.win) c.winWith++;
    }
  }

  const scored = new Set(
    signals.filter(s => s.active !== false).map(s => s.rule?.feature).filter(Boolean) as string[],
  );
  const out: { feature: string; value: unknown; lift: number; weight: number; withN: number }[] = [];
  for (const c of cand.values()) {
    const nWithout = totalN - c.withN;
    if (c.withN < 4 || nWithout < 4) continue;        // small cohorts lie
    if (scored.has(c.feature)) continue;               // already scored on this
    const wrWith = c.winWith / c.withN;
    const wrWithout = (totalWins - c.winWith) / nWithout;
    if (wrWithout <= 0) continue;
    const lift = wrWith / wrWithout;
    if (lift < 1.5 && lift > 0.66) continue;           // not discriminative
    const weight = weightFromLift(lift);
    if (weight === 0) continue;
    out.push({ feature: c.feature, value: c.value, lift, weight, withN: c.withN });
  }
  out.sort((a, b) => Math.abs(Math.log(b.lift)) - Math.abs(Math.log(a.lift)));
  return out.slice(0, 5).map(d => ({
    action: 'add' as const,
    signal: {
      key: `disc_${dslug(d.feature)}${typeof d.value === 'string' ? '_' + dslug(d.value) : ''}`,
      label: labelForDiscovery(d.feature, d.value),
      weight: d.weight,
      rule: { feature: d.feature, op: '==', value: d.value },
    },
    note: `discovered: ${d.lift.toFixed(1)}× lift over ${d.withN} deals`,
  }));
}

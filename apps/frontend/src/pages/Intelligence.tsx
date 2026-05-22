import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { PageHeader } from "@/components/ui/page-header";

// Intelligence — the compound-intelligence loop made transparent.
//
// The loop is literal in the v2 substrate, and every stage is a real table:
//
//   observations  →  claims  →  predictions  →  calibration  →  scorecard
//   (evidence)       (beliefs,   (claims about   (how well      (the model
//                    self-healing) the future)   they held)     adapts)
//
// New observations recompute the affected claims (self-healing) and resolve
// open predictions — which re-weights the Scorecard. The loop closes.

const apiUrl = import.meta.env.VITE_API_URL ?? "";

const MEMORY_CATEGORIES = ["ICP", "Product", "Pricing", "Market", "Competitors", "Team", "Patterns", "General"];

interface Substrate {
  observations: { total: number; last_7d: number; by_source: { source: string; count: number }[] };
  claims: { total: number; freshness: Record<string, number>; epistemic: Record<string, number> };
  recompute: { pending: number };
  predictions: { total: number; open: number; resolved: number; by_kind: Record<string, number> };
  calibration: {
    resolved: number;
    gap: number | null;
    high: { count: number; avg_outcome: number | null };
    low: { count: number; avg_outcome: number | null };
    trend: { week: string; n: number; gap: number | null }[];
  };
}
interface Signal {
  id: string;
  key: string;
  label: string;
  weight: number;
  coverage: number;
  active: boolean;
}
interface Run {
  id: string;
  steps: number;
  gap_before: number | null;
  gap_after: number | null;
  note: string | null;
  created_at: string;
}
interface MemoryFact {
  id: string;
  category: string;
  content: string;
  created_at: string;
}

const fmtGap = (g: number | null | undefined) =>
  g == null ? "—" : `${g > 0 ? "+" : ""}${g.toFixed(2)}`;

// ─── Building blocks — the platform's card vocabulary ─────────────────────────

function StatTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</div>
      <div className="text-[22px] font-semibold text-foreground tabular-nums tracking-tight leading-none mt-2">{value}</div>
      <div className="text-[12px] text-muted-foreground/70 mt-1.5">{sub}</div>
    </div>
  );
}

// A numbered loop-stage card. `step` prints the position in the loop so the
// page reads top-to-bottom as the pipeline itself.
function Stage({ step, label, what, right, children }: {
  step: number | string;
  label: string;
  what: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/50 border-b border-border">
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[11px] font-semibold text-foreground/70 tabular-nums">
          {step}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</span>
        <span className="text-[12px] text-muted-foreground/60 truncate">— {what}</span>
        <span className="ml-auto flex-shrink-0">{right}</span>
      </div>
      {children}
    </div>
  );
}

// A segmented proportion bar with a labelled legend. Used for the freshness,
// epistemic-class, and prediction-status distributions.
function DistroBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) {
    return <div className="text-[13px] text-muted-foreground/50">No data yet</div>;
  }
  return (
    <div>
      <div className="flex h-2 rounded-full overflow-hidden bg-muted">
        {segments.filter(s => s.value > 0).map(s => (
          <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
        {segments.map(s => (
          <span key={s.label} className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground capitalize">
            <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
            {s.label} <span className="tabular-nums text-foreground/70 font-medium">{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const FRESHNESS_COLOR: Record<string, string> = {
  fresh: "#15803d", aging: "#b45309", suspect: "#c2410c", expired: "#6b7280",
};
const EPISTEMIC_COLOR: Record<string, string> = {
  observed: "#1d4ed8", inferred: "#7c3aed", predicted: "#0891b2", asserted: "#6b7280",
};

export default function Intelligence() {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";

  const [substrate, setSubstrate] = useState<Substrate | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [memories, setMemories] = useState<MemoryFact[]>([]);
  const [loading, setLoading] = useState(true);

  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState("ICP");
  const [newContent, setNewContent] = useState("");
  const [savingMem, setSavingMem] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(() => {
    if (!workspaceId || !token) return;
    const h = { Authorization: `Bearer ${token}` };
    setLoading(true);
    Promise.all([
      fetch(`${apiUrl}/api/mind/substrate?workspaceId=${workspaceId}`, { headers: h }).then(r => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/mind/scorecard?workspaceId=${workspaceId}`, { headers: h }).then(r => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/mind/scorecard/runs?workspaceId=${workspaceId}`, { headers: h }).then(r => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/workspace/memories?workspaceId=${workspaceId}&limit=200`, { headers: h }).then(r => (r.ok ? r.json() : null)),
    ])
      .then(([sub, sc, rn, mem]) => {
        if (sub) setSubstrate(sub);
        if (sc) setSignals(sc.signals ?? []);
        if (rn) setRuns(rn.runs ?? []);
        if (mem) setMemories(mem.memories ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [workspaceId, token]);

  useEffect(() => { load(); }, [load]);

  const addMemory = async () => {
    if (!newContent.trim() || savingMem) return;
    setSavingMem(true);
    try {
      await fetch(`${apiUrl}/api/workspace/memories`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, content: newContent.trim(), category: newCat }),
      });
      setNewContent("");
      setAdding(false);
      load();
    } catch { /* silent */ }
    finally { setSavingMem(false); }
  };

  const buildScorecard = async () => {
    if (seeding) return;
    setSeeding(true);
    try {
      await fetch(`${apiUrl}/api/mind/scorecard/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId }),
      });
      load();
    } catch { /* silent */ }
    finally { setSeeding(false); }
  };

  const active = signals.filter(s => s.active);
  const positive = active.filter(s => s.weight > 0).sort((a, b) => b.weight - a.weight);
  const negative = active.filter(s => s.weight < 0).sort((a, b) => a.weight - b.weight);

  const obs = substrate?.observations;
  const claims = substrate?.claims;
  const preds = substrate?.predictions;
  const cal = substrate?.calibration;
  const recompute = substrate?.recompute;

  const gap = cal?.gap ?? null;
  const status =
    cal == null || cal.resolved === 0 ? "Gathering evidence"
    : gap == null ? "Gathering evidence"
    : gap > 0.05 ? "Sharpening"
    : gap < 0 ? "Miscalibrated"
    : "Holding steady";

  const freshKeys = ["fresh", "aging", "suspect", "expired"];
  const epiKeys = ["observed", "inferred", "predicted", "asserted"];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-8 py-7">
        <PageHeader
          title="Intelligence"
          subtitle="The compound-intelligence loop — evidence becomes beliefs, beliefs become predictions, and outcomes sharpen the model."
          actions={
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          }
        />

        {/* Loop summary — one tile per stage */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatTile
            label="Evidence"
            value={(obs?.total ?? 0).toLocaleString()}
            sub={`${(obs?.last_7d ?? 0).toLocaleString()} in the last 7 days`}
          />
          <StatTile
            label="Beliefs"
            value={(claims?.total ?? 0).toLocaleString()}
            sub={
              recompute?.pending
                ? `${recompute.pending} recomputing`
                : `${claims?.freshness?.fresh ?? 0} fresh`
            }
          />
          <StatTile
            label="Predictions"
            value={(preds?.total ?? 0).toLocaleString()}
            sub={`${preds?.open ?? 0} open · ${preds?.resolved ?? 0} resolved`}
          />
          <StatTile label="Calibration" value={fmtGap(gap)} sub={status} />
        </div>

        <div className="space-y-4">

          {/* Stage 1 — Evidence (observations) */}
          <Stage
            step={1}
            label="Evidence"
            what="the append-only spine — every observation, never overwritten"
            right={
              obs && obs.total > 0 && (
                <span className="text-[12px] text-muted-foreground/70 tabular-nums">
                  {obs.total.toLocaleString()} observations
                </span>
              )
            }
          >
            {!obs || obs.total === 0 ? (
              <div className="px-4 py-8 text-[13px] text-muted-foreground/70 text-center">
                No evidence yet — observations flow in as agents and connectors record activity.
              </div>
            ) : (
              <div className="px-4 py-3.5">
                <p className="text-[13px] text-muted-foreground mb-3">
                  {obs.last_7d.toLocaleString()} recorded in the last 7 days.
                  Observations are immutable — corrections arrive as new evidence.
                </p>
                <div className="space-y-0">
                  {obs.by_source.slice(0, 8).map(s => (
                    <div key={s.source} className="flex items-baseline gap-3 py-1.5">
                      <span className="text-[13px] text-foreground/80 capitalize w-40 flex-shrink-0">
                        {s.source.replace(/_/g, " ")}
                      </span>
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-foreground/30"
                          style={{ width: `${(s.count / obs.by_source[0].count) * 100}%` }}
                        />
                      </div>
                      <span className="text-[12px] text-muted-foreground tabular-nums w-12 text-right flex-shrink-0">
                        {s.count.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Stage>

          {/* Stage 2 — Beliefs (claims) */}
          <Stage
            step={2}
            label="Beliefs"
            what="claims derived from the evidence — each with confidence and freshness"
            right={
              recompute != null && (
                <span
                  className="text-[12px] tabular-nums"
                  style={{ color: recompute.pending > 0 ? "#b45309" : undefined }}
                >
                  {recompute.pending > 0
                    ? `${recompute.pending} recomputing`
                    : "self-healing · idle"}
                </span>
              )
            }
          >
            {!claims || claims.total === 0 ? (
              <div className="px-4 py-8 text-[13px] text-muted-foreground/70 text-center">
                No claims yet — the derivation engine builds them once observations exist.
              </div>
            ) : (
              <div className="px-4 py-3.5 space-y-4">
                <p className="text-[13px] text-muted-foreground">
                  {claims.total.toLocaleString()} claims. A claim is never written by hand —
                  it is recomputed from observations, so a new observation pulls the belief
                  back toward truth.
                </p>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-2">
                    Freshness
                  </div>
                  <DistroBar
                    segments={freshKeys.map(k => ({
                      label: k, value: claims.freshness[k] ?? 0, color: FRESHNESS_COLOR[k],
                    }))}
                  />
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-2">
                    Epistemic class
                  </div>
                  <DistroBar
                    segments={epiKeys.map(k => ({
                      label: k, value: claims.epistemic[k] ?? 0, color: EPISTEMIC_COLOR[k],
                    }))}
                  />
                </div>
              </div>
            )}
          </Stage>

          {/* Stage 3 — Predictions */}
          <Stage
            step={3}
            label="Predictions"
            what="claims about the future — staked now, graded later"
            right={
              preds && preds.total > 0 && (
                <span className="text-[12px] text-muted-foreground/70 tabular-nums">
                  {preds.total.toLocaleString()} predictions
                </span>
              )
            }
          >
            {!preds || preds.total === 0 ? (
              <div className="px-4 py-8 text-[13px] text-muted-foreground/70 text-center">
                No predictions yet — the Scorecard stakes one each time it scores an account.
              </div>
            ) : (
              <div className="px-4 py-3.5 space-y-4">
                <DistroBar
                  segments={[
                    { label: "resolved", value: preds.resolved, color: "#15803d" },
                    { label: "open", value: preds.open, color: "#6b7280" },
                  ]}
                />
                <div className="space-y-0">
                  {Object.entries(preds.by_kind)
                    .sort((a, b) => b[1] - a[1])
                    .map(([kind, n]) => (
                      <div key={kind} className="flex items-baseline gap-3 py-1.5 border-b border-border/60 last:border-0">
                        <span className="text-[13px] text-foreground/80 capitalize">
                          {kind.replace(/_/g, " ")}
                        </span>
                        <span className="ml-auto text-[12px] text-muted-foreground tabular-nums">
                          {n.toLocaleString()}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </Stage>

          {/* Stage 4 — Calibration */}
          <Stage
            step={4}
            label="Calibration"
            what="how well resolved predictions held up — the headline number"
            right={
              <span className="text-[12px] text-muted-foreground/70 tabular-nums">{status}</span>
            }
          >
            {!cal || cal.resolved === 0 ? (
              <div className="px-4 py-8 text-[13px] text-muted-foreground/70 text-center">
                Calibration appears once predictions resolve — when later evidence grades them.
              </div>
            ) : (
              <div className="px-4 py-4">
                <div className="flex items-baseline gap-3">
                  <span className="text-[32px] font-semibold text-foreground tabular-nums tracking-tight leading-none">
                    {fmtGap(gap)}
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    gap across {cal.resolved.toLocaleString()} resolved predictions
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="rounded-lg border border-border/60 px-3 py-2.5">
                    <div className="text-[12px] text-muted-foreground">Predicted a fit (≥70)</div>
                    <div className="text-[15px] font-semibold text-foreground tabular-nums mt-1">
                      {cal.high.avg_outcome != null ? cal.high.avg_outcome.toFixed(1) : "—"}
                      <span className="text-[12px] font-normal text-muted-foreground/70 ml-1.5">
                        avg outcome · n={cal.high.count}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/60 px-3 py-2.5">
                    <div className="text-[12px] text-muted-foreground">Predicted a miss (&lt;70)</div>
                    <div className="text-[15px] font-semibold text-foreground tabular-nums mt-1">
                      {cal.low.avg_outcome != null ? cal.low.avg_outcome.toFixed(1) : "—"}
                      <span className="text-[12px] font-normal text-muted-foreground/70 ml-1.5">
                        avg outcome · n={cal.low.count}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="text-[12px] text-muted-foreground/70 mt-3">
                  A positive gap means the model scored converting accounts higher than the rest.
                  The Scorecard learning runs widen it.
                </p>
              </div>
            )}
          </Stage>

          {/* Stage 5 — The Scorecard */}
          <Stage
            step={5}
            label="The Scorecard"
            what="the weighted signals the model scores accounts on"
            right={
              active.length > 0 && (
                <span className="text-[12px] text-muted-foreground/70 tabular-nums">{active.length} signals</span>
              )
            }
          >
            {active.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[13px] text-muted-foreground">
                  No Scorecard yet — the weighted signals the model scores accounts on.
                </p>
                <button
                  onClick={buildScorecard}
                  disabled={seeding}
                  className="mt-3 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40"
                >
                  {seeding ? "Building…" : "Build from your ICP memory"}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 divide-x divide-border/60">
                {[
                  { rows: positive, head: "Predicts a fit", color: "#15803d" },
                  { rows: negative, head: "Predicts a miss", color: "#b91c1c" },
                ].map(({ rows, head, color }) => (
                  <div key={head}>
                    <div className="px-4 py-2 border-b border-border/60 text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color }}>
                      {head}
                    </div>
                    {rows.length === 0 ? (
                      <div className="px-4 py-4 text-[13px] text-muted-foreground/50">None</div>
                    ) : (
                      rows.map(s => (
                        <div key={s.id} className="flex items-baseline gap-3 px-4 py-2.5 border-b border-border/60 last:border-0">
                          <span className="text-[12px] font-semibold tabular-nums w-8 flex-shrink-0" style={{ color }}>
                            {s.weight > 0 ? "+" : ""}{s.weight}
                          </span>
                          <span className="text-[13px] text-foreground/80 leading-snug">{s.label}</span>
                        </div>
                      ))
                    )}
                  </div>
                ))}
              </div>
            )}
          </Stage>

          {/* Stage 6 — Learning Runs */}
          <Stage
            step={6}
            label="Learning Runs"
            what="the loop closing — each run tests one change against held-back evidence"
          >
            {runs.length === 0 ? (
              <div className="px-4 py-8 text-[13px] text-muted-foreground/70 text-center">
                The loop runs nightly once there are enough resolved predictions to learn from.
              </div>
            ) : (
              runs.map(r => (
                <div key={r.id} className="flex items-center gap-4 px-4 py-3 border-b border-border/60 last:border-0">
                  <span className="text-[12px] text-muted-foreground/70 tabular-nums flex-shrink-0" style={{ width: 52 }}>
                    {format(new Date(r.created_at), "MMM d")}
                  </span>
                  <span className="text-[13px] text-muted-foreground tabular-nums flex-shrink-0" style={{ width: 116 }}>
                    {fmtGap(r.gap_before)} → {fmtGap(r.gap_after)}
                  </span>
                  <span className="text-[13px] text-foreground/80 truncate">
                    {r.note || `${r.steps} step${r.steps === 1 ? "" : "s"}`}
                  </span>
                </div>
              ))
            )}
          </Stage>

          {/* Memory — the human input to the loop */}
          <Stage
            step="·"
            label="Memory"
            what="what you've taught it — the ICP, product, and market the loop reasons from"
            right={
              !adding && (
                <button
                  onClick={() => setAdding(true)}
                  className="text-[12px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
                >
                  + Add fact
                </button>
              )
            }
          >
            {adding && (
              <div className="px-4 py-3.5 border-b border-border/60 bg-muted/50/50 space-y-2.5">
                <select
                  value={newCat}
                  onChange={e => setNewCat(e.target.value)}
                  className="rounded-md border border-border bg-background text-[13px] text-foreground px-2 py-1.5 outline-none focus:border-foreground/40"
                >
                  {MEMORY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <textarea
                  value={newContent}
                  onChange={e => setNewContent(e.target.value)}
                  rows={3}
                  autoFocus
                  placeholder="e.g. B2B SaaS companies, 50–200 employees, RevOps and Sales Ops leaders, US."
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-foreground/40 resize-none leading-relaxed"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={addMemory}
                    disabled={savingMem || !newContent.trim()}
                    className="h-8 px-3.5 rounded-md bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-30"
                  >
                    {savingMem ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => { setAdding(false); setNewContent(""); }}
                    className="h-8 px-3 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {memories.length === 0 && !adding ? (
              <div className="px-4 py-8 text-[13px] text-muted-foreground/70 text-center">
                No facts yet — add what you know about your ICP, product, and market.
              </div>
            ) : (
              memories.slice(0, 24).map(m => (
                <div key={m.id} className="flex items-baseline gap-3 px-4 py-2.5 border-b border-border/60 last:border-0">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 flex-shrink-0" style={{ width: 84 }}>
                    {m.category}
                  </span>
                  <span className="text-[13px] text-foreground/80 leading-snug">{m.content}</span>
                </div>
              ))
            )}
          </Stage>

        </div>
      </div>
    </div>
  );
}

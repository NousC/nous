import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { RefreshCw } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/ui/page-header";

// Intelligence — the dashboard for the compound-intelligence loop.
//
// Answers two questions on one page:
//   1. Is the model getting better over time?
//   2. What should I act on next?
//
// Backed by /api/mind/substrate which reads the v2 substrate stage by stage:
// observations → claims → predictions → calibration → scorecard.

const apiUrl = import.meta.env.VITE_API_URL ?? "";

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
  top_signals: { key: string; label: string; weight: number; fires: number; hits: number; hit_rate: number }[];
  recent_predictions: {
    id: string; entity_id: string; name: string | null; email: string | null;
    score: number | null; fit: boolean | null;
    predicted_at: string; resolved_at: string | null;
    outcome_score: number | null; replied: boolean | null;
    fired: string[];
  }[];
  misses: Substrate["recent_predictions"];
  attention: {
    kind: string; entity_id: string; entity_name: string | null;
    what: string; suggested_action: string; age_days: number;
  }[];
}
interface Signal {
  id: string; key: string; label: string; weight: number; coverage: number; active: boolean;
}

const fmtGap = (g: number | null | undefined) =>
  g == null ? "—" : `${g > 0 ? "+" : ""}${g.toFixed(2)}`;
const fmtAgo = (iso: string | null) => iso ? formatDistanceToNow(new Date(iso), { addSuffix: false }) : "—";

// ─── Building blocks ─────────────────────────────────────────────────────────

function StatTile({ label, value, sub, tone = "neutral" }: {
  label: string; value: string; sub?: React.ReactNode; tone?: "neutral" | "good" | "warn";
}) {
  const valueColor = tone === "good" ? "#15803d" : tone === "warn" ? "#b45309" : undefined;
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</div>
      <div className="text-[22px] font-semibold tabular-nums tracking-tight leading-none mt-2" style={{ color: valueColor }}>{value}</div>
      {sub && <div className="text-[12px] text-muted-foreground/70 mt-1.5">{sub}</div>}
    </div>
  );
}

function Card({ label, right, children }: {
  label: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/50 border-b border-border">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

// Sparkline for the calibration trend.
function Sparkline({ values, width = 96, height = 24 }: { values: (number | null)[]; width?: number; height?: number }) {
  const points = values.filter((v): v is number => v != null);
  if (points.length < 2) return <span className="text-muted-foreground/50 text-[11px]">no trend yet</span>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const path = values
    .map((v, i) => {
      if (v == null) return null;
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" ");
  const last = points[points.length - 1];
  const colour = last > 0 ? "#15803d" : last < 0 ? "#b91c1c" : "#6b7280";
  return (
    <svg width={width} height={height} className="inline-block" style={{ verticalAlign: "middle" }}>
      <polyline points={path} fill="none" stroke={colour} strokeWidth="1.5" />
    </svg>
  );
}

// ─── The page ────────────────────────────────────────────────────────────────

export default function Intelligence() {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";

  const [substrate, setSubstrate] = useState<Substrate | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(() => {
    if (!workspaceId || !token) return;
    const h = { Authorization: `Bearer ${token}` };
    setLoading(true);
    Promise.all([
      fetch(`${apiUrl}/api/mind/substrate?workspaceId=${workspaceId}`, { headers: h }).then(r => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/mind/scorecard?workspaceId=${workspaceId}`, { headers: h }).then(r => (r.ok ? r.json() : null)),
    ])
      .then(([sub, sc]) => {
        if (sub) setSubstrate(sub);
        if (sc) setSignals(sc.signals ?? []);
      })
      .finally(() => setLoading(false));
  }, [workspaceId, token]);

  useEffect(() => { load(); }, [load]);

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
    } finally { setSeeding(false); }
  };

  const active   = signals.filter(s => s.active);
  const positive = active.filter(s => s.weight > 0).sort((a, b) => b.weight - a.weight);
  const negative = active.filter(s => s.weight < 0).sort((a, b) => a.weight - b.weight);

  const gap = substrate?.calibration.gap ?? null;
  const status =
    !substrate || substrate.calibration.resolved === 0 ? "Gathering evidence"
    : gap == null ? "Gathering evidence"
    : gap > 0.05  ? "Sharpening"
    : gap < 0     ? "Miscalibrated"
    : "Holding steady";

  const trendValues = substrate?.calibration.trend.map(t => t.gap) ?? [];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-8 py-7">
        <PageHeader
          title="Intelligence"
          subtitle="Is the model getting better over time, and what should you act on next?"
          actions={
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          }
        />

        {/* Stat tiles — the headline numbers */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatTile
            label="Calibration"
            value={fmtGap(gap)}
            tone={gap == null ? "neutral" : gap > 0.05 ? "good" : gap < 0 ? "warn" : "neutral"}
            sub={
              <span className="inline-flex items-center gap-2">
                {status}
                <Sparkline values={trendValues} width={56} height={16} />
              </span>
            }
          />
          <StatTile
            label="Predictions"
            value={(substrate?.predictions.total ?? 0).toLocaleString()}
            sub={`${substrate?.predictions.open ?? 0} open · ${substrate?.predictions.resolved ?? 0} resolved`}
          />
          <StatTile
            label="Evidence"
            value={(substrate?.observations.total ?? 0).toLocaleString()}
            sub={`${(substrate?.observations.last_7d ?? 0).toLocaleString()} in the last 7d`}
          />
          <StatTile
            label="Beliefs"
            value={(substrate?.claims.total ?? 0).toLocaleString()}
            sub={
              substrate?.recompute.pending
                ? <span className="text-[#b45309]">{substrate.recompute.pending} recomputing</span>
                : `${substrate?.claims.freshness?.fresh ?? 0} fresh · self-healing idle`
            }
          />
        </div>

        <div className="space-y-4">

          {/* Top firing signals — which signals actually predict outcomes */}
          <Card
            label="Top firing signals"
            right={
              <span className="text-[12px] text-muted-foreground/70 tabular-nums">
                {substrate?.top_signals.length ?? 0} signals firing on resolved predictions
              </span>
            }
          >
            {!substrate?.top_signals.length ? (
              <div className="px-4 py-8 text-[13px] text-muted-foreground/70 text-center">
                No signal hit-rate yet — need resolved predictions first.
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {substrate.top_signals.map(s => {
                  const tone = s.weight > 0 ? "#15803d" : "#b91c1c";
                  return (
                    <div key={s.key} className="grid grid-cols-[40px_1fr_auto_auto] items-baseline gap-4 px-4 py-2.5">
                      <span className="text-[12px] font-semibold tabular-nums" style={{ color: tone }}>
                        {s.weight > 0 ? "+" : ""}{s.weight}
                      </span>
                      <span className="text-[13px] text-foreground/80 leading-snug truncate">{s.label}</span>
                      <span className="text-[12px] text-muted-foreground tabular-nums whitespace-nowrap">
                        fires <span className="text-foreground/70 font-medium">{s.fires}×</span>
                      </span>
                      <span className="text-[12px] text-muted-foreground tabular-nums whitespace-nowrap text-right" style={{ width: 60 }}>
                        hit <span className="text-foreground/70 font-medium">{s.hit_rate}%</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Recent predictions — the pulse */}
          <Card
            label="Recent predictions"
            right={
              <span className="text-[12px] text-muted-foreground/70 tabular-nums">
                {substrate?.recent_predictions.length ?? 0} most recent
              </span>
            }
          >
            {!substrate?.recent_predictions.length ? (
              <div className="px-4 py-8 text-[13px] text-muted-foreground/70 text-center">
                No predictions yet — the Scorecard stakes one per scored entity.
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {substrate.recent_predictions.map(p => {
                  const status =
                    p.resolved_at && typeof p.outcome_score === "number"
                      ? p.outcome_score >= 0.5 ? "hit" : "miss"
                      : "open";
                  const statusColor = status === "hit" ? "#15803d" : status === "miss" ? "#b91c1c" : "#6b7280";
                  return (
                    <div key={p.id} className="grid grid-cols-[1fr_60px_1fr_70px_60px] items-baseline gap-3 px-4 py-2.5">
                      <span className="text-[13px] text-foreground/80 truncate">
                        {p.name || p.email || p.entity_id.slice(0, 8)}
                      </span>
                      <span className="text-[13px] font-semibold tabular-nums">
                        {p.score ?? "—"}
                      </span>
                      <span className="text-[12px] text-muted-foreground truncate">
                        {p.fired.length ? p.fired.join(" · ") : "—"}
                      </span>
                      <span className="text-[12px] tabular-nums text-right" style={{ color: statusColor }}>
                        {status}
                      </span>
                      <span className="text-[11px] text-muted-foreground/70 tabular-nums text-right">
                        {fmtAgo(p.predicted_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Two-up: Attention + Misses */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card
              label="Attention"
              right={
                substrate?.attention.length ? (
                  <span className="text-[12px] text-muted-foreground/70 tabular-nums">{substrate.attention.length}</span>
                ) : null
              }
            >
              {!substrate?.attention.length ? (
                <div className="px-4 py-8 text-[13px] text-muted-foreground/70 text-center">
                  Nothing needs attention. ✓
                </div>
              ) : (
                <div className="divide-y divide-border/60">
                  {substrate.attention.map((a, i) => (
                    <div key={i} className="px-4 py-2.5">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">{a.kind.replace(/_/g, ' ')}</span>
                        <span className="text-[13px] text-foreground/80 truncate">{a.entity_name || a.entity_id.slice(0, 8)}</span>
                        <span className="text-[12px] text-muted-foreground ml-auto tabular-nums">{a.age_days}d</span>
                      </div>
                      <div className="text-[12px] text-muted-foreground mt-0.5">{a.what}</div>
                      <div className="text-[12px] text-foreground/70 mt-0.5">→ {a.suggested_action}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card
              label="Misses — what tonight's loop trains on"
              right={
                substrate?.misses.length ? (
                  <span className="text-[12px] text-muted-foreground/70 tabular-nums">{substrate.misses.length}</span>
                ) : null
              }
            >
              {!substrate?.misses.length ? (
                <div className="px-4 py-8 text-[13px] text-muted-foreground/70 text-center">
                  No surprises in resolved predictions yet.
                </div>
              ) : (
                <div className="divide-y divide-border/60">
                  {substrate.misses.map(p => {
                    const scoreHigh = (p.score ?? 0) >= 70;
                    const surprise = scoreHigh ? "high score, no conversion" : "low score, surprised conversion";
                    const tone = scoreHigh ? "#b91c1c" : "#15803d";
                    return (
                      <div key={p.id} className="px-4 py-2.5">
                        <div className="flex items-baseline gap-2">
                          <span className="text-[13px] text-foreground/80 truncate">
                            {p.name || p.email || p.entity_id.slice(0, 8)}
                          </span>
                          <span className="text-[12px] tabular-nums" style={{ color: tone }}>
                            scored {p.score} · outcome {(p.outcome_score ?? 0).toFixed(2)}
                          </span>
                        </div>
                        <div className="text-[12px] text-muted-foreground mt-0.5">{surprise}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          {/* The Scorecard — the model itself */}
          <Card
            label="The Scorecard"
            right={
              active.length > 0 ? (
                <span className="text-[12px] text-muted-foreground/70 tabular-nums">{active.length} signals</span>
              ) : null
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
                  { rows: positive, head: "Predicts a fit",   color: "#15803d" },
                  { rows: negative, head: "Predicts a miss",  color: "#b91c1c" },
                ].map(({ rows, head, color }) => (
                  <div key={head}>
                    <div className="px-4 py-2 border-b border-border/60 text-[11px] font-semibold uppercase tracking-wide" style={{ color }}>
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
          </Card>

          {/* Substrate footer — the data plumbing under the loop */}
          <Card label="Substrate">
            <div className="px-4 py-3 text-[12px] text-muted-foreground grid grid-cols-3 gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70 mb-1">Evidence</div>
                {(substrate?.observations.total ?? 0).toLocaleString()} observations from{" "}
                {substrate?.observations.by_source.slice(0, 3).map(s => s.source).join(", ") || "—"}
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70 mb-1">Beliefs</div>
                {(substrate?.claims.total ?? 0).toLocaleString()} claims ·{" "}
                {substrate?.claims.freshness?.fresh ?? 0} fresh ·{" "}
                {(substrate?.claims.freshness?.aging ?? 0) + (substrate?.claims.freshness?.suspect ?? 0)} aging ·{" "}
                {substrate?.claims.freshness?.expired ?? 0} expired
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70 mb-1">Self-healing</div>
                {substrate?.recompute.pending
                  ? <span className="text-[#b45309]">recomputing {substrate.recompute.pending}</span>
                  : "queue idle — beliefs are current"}
                <span className="text-muted-foreground/60"> · trigger fires on every new observation</span>
              </div>
            </div>
            {substrate?.calibration.trend.length ? (
              <div className="px-4 pb-3 text-[12px] text-muted-foreground/70 border-t border-border/60 pt-2 flex items-center gap-2">
                <span>Calibration trend:</span>
                {substrate.calibration.trend.map((t, i) => (
                  <span key={t.week} className="tabular-nums">
                    {i > 0 && <span className="text-muted-foreground/40 mx-1">·</span>}
                    {format(new Date(t.week), "MMM d")}: {fmtGap(t.gap)}
                  </span>
                ))}
              </div>
            ) : null}
          </Card>

        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { PageHeader } from "@/components/ui/page-header";

// Intelligence — the compound intelligence of the workspace: how well the Mind
// predicts (calibration), what it believes (the Scorecard), how it learned
// (the runs), and the knowledge it reasons over (memory).

const apiUrl = import.meta.env.VITE_API_URL ?? "";

const MEMORY_CATEGORIES = ["ICP", "Product", "Pricing", "Market", "Competitors", "Team", "Patterns", "General"];

interface Calibration {
  resolved: number;
  open: number;
  gap: number | null;
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

function Card({ label, right, children }: {
  label: string;
  right?: React.ReactNode;
  children: React.ReactNode;
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

export default function Intelligence() {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";

  const [calibration, setCalibration] = useState<Calibration | null>(null);
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
      fetch(`${apiUrl}/api/mind/calibration?workspaceId=${workspaceId}`, { headers: h }).then(r => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/mind/scorecard?workspaceId=${workspaceId}`, { headers: h }).then(r => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/mind/scorecard/runs?workspaceId=${workspaceId}`, { headers: h }).then(r => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/workspace/memories?workspaceId=${workspaceId}&limit=200`, { headers: h }).then(r => (r.ok ? r.json() : null)),
    ])
      .then(([cal, sc, rn, mem]) => {
        if (cal) setCalibration(cal);
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

  const gap = calibration?.gap ?? null;
  const status =
    gap == null ? "Gathering evidence"
    : gap > 0.05 ? "Sharpening"
    : gap < 0 ? "Miscalibrated"
    : "Holding steady";

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-8 py-7">
        <PageHeader
          title="Intelligence"
          subtitle="The compound intelligence of your workspace — how well it predicts, what it believes, and how it keeps getting sharper."
          actions={
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          }
        />

        {/* Stat tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatTile label="Calibration" value={fmtGap(gap)} sub={status} />
          <StatTile
            label="Predictions"
            value={(calibration?.resolved ?? 0).toLocaleString()}
            sub={`${calibration?.open ?? 0} still maturing`}
          />
          <StatTile
            label="Scorecard"
            value={String(active.length)}
            sub={active.length ? `${positive.length} fit · ${negative.length} miss` : "no signals yet"}
          />
          <StatTile label="Memory" value={memories.length.toLocaleString()} sub="facts" />
        </div>

        <div className="space-y-4">

          {/* Scorecard */}
          <Card
            label="The Scorecard"
            right={
              active.length > 0 && (
                <span className="text-[12px] text-muted-foreground/70 tabular-nums">{active.length} signals</span>
              )
            }
          >
            {active.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[13px] text-muted-foreground">
                  No Scorecard yet — the weighted signals the Mind scores accounts on.
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
          </Card>

          {/* Learning runs */}
          <Card label="Learning Runs">
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
          </Card>

          {/* Memory */}
          <Card
            label="Memory"
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
          </Card>

        </div>
      </div>
    </div>
  );
}

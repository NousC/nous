import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { PageHeader } from "@/components/ui/page-header";

// Intelligence — the one page where a workspace sees its compound intelligence:
// is the Mind sharpening (calibration), what it believes (the Scorecard), how
// it learned (the runs), and the raw context underneath (memory).

const apiUrl = import.meta.env.VITE_API_URL ?? "";

interface Calibration {
  resolved: number;
  open: number;
  gap: number | null;
  trend: { week: string; n: number; gap: number | null }[];
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
  signal_count: number | null;
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

const gapColor = (g: number | null | undefined) =>
  g == null ? "#9ca3af" : g > 0.05 ? "#16a34a" : g < 0 ? "#dc2626" : "#ca8a04";

// Card chrome — matches the table cards on the People / Companies pages.
function Card({ label, right, children }: {
  label: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[13px] text-gray-400 text-center py-12">{children}</div>;
}

function SignalRow({ s }: { s: Signal }) {
  const positive = s.weight > 0;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 last:border-0">
      <span
        className="inline-flex items-center justify-center h-6 min-w-[2.25rem] px-1.5 rounded-md text-[12px] font-semibold tabular-nums flex-shrink-0"
        style={{
          color: positive ? "#16a34a" : "#dc2626",
          backgroundColor: positive ? "#16a34a14" : "#dc262614",
        }}
      >
        {positive ? "+" : ""}{s.weight}
      </span>
      <span className="text-[13px] text-gray-700 truncate" title={s.label}>{s.label}</span>
      <span className="text-[12px] text-gray-300 tabular-nums ml-auto flex-shrink-0">{s.coverage || ""}</span>
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
  const [icpText, setIcpText] = useState("");
  const [icpDraft, setIcpDraft] = useState("");
  const [savingIcp, setSavingIcp] = useState(false);

  const load = useCallback(() => {
    if (!workspaceId || !token) return;
    const h = { Authorization: `Bearer ${token}` };
    setLoading(true);
    Promise.all([
      fetch(`${apiUrl}/api/mind/calibration?workspaceId=${workspaceId}`, { headers: h }).then(r => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/mind/scorecard?workspaceId=${workspaceId}`, { headers: h }).then(r => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/mind/scorecard/runs?workspaceId=${workspaceId}`, { headers: h }).then(r => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/workspace/memories?workspaceId=${workspaceId}&limit=200`, { headers: h }).then(r => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/mind/icp?workspaceId=${workspaceId}`, { headers: h }).then(r => (r.ok ? r.json() : null)),
    ])
      .then(([cal, sc, rn, mem, icp]) => {
        if (cal) setCalibration(cal);
        if (sc) setSignals(sc.signals ?? []);
        if (rn) setRuns(rn.runs ?? []);
        if (mem) setMemories(mem.memories ?? []);
        if (icp) { setIcpText(icp.icp_text ?? ""); setIcpDraft(icp.icp_text ?? ""); }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [workspaceId, token]);

  useEffect(() => { load(); }, [load]);

  const saveIcp = async () => {
    if (!workspaceId || !token || savingIcp) return;
    setSavingIcp(true);
    const h = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    try {
      await fetch(`${apiUrl}/api/mind/icp`, {
        method: "PUT", headers: h,
        body: JSON.stringify({ workspaceId, icp_text: icpDraft.trim() }),
      });
      // No Scorecard yet — translate the ICP into the seed Scorecard.
      if (signals.filter(s => s.active).length === 0 && icpDraft.trim()) {
        await fetch(`${apiUrl}/api/mind/scorecard/seed`, {
          method: "POST", headers: h, body: JSON.stringify({ workspaceId }),
        });
      }
      load();
    } catch { /* silent */ }
    finally { setSavingIcp(false); }
  };

  const active = signals.filter(s => s.active);
  const positive = active.filter(s => s.weight > 0).sort((a, b) => b.weight - a.weight);
  const negative = active.filter(s => s.weight < 0).sort((a, b) => a.weight - b.weight);

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="px-8 py-7">
        <PageHeader
          title="Intelligence"
          subtitle="What this workspace has learned — and the proof it's getting sharper."
          actions={
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-white border border-gray-200 text-gray-700 text-[13px] font-semibold hover:bg-gray-50 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          }
        />

        <div className="space-y-5">

          {/* 1 — Calibration */}
          <Card label="Calibration">
            <div className="px-5 py-5 flex items-center justify-between gap-6">
              <div className="flex items-baseline gap-4 min-w-0">
                <span
                  className="text-[34px] font-bold tracking-tight tabular-nums leading-none flex-shrink-0"
                  style={{ color: gapColor(calibration?.gap) }}
                >
                  {fmtGap(calibration?.gap)}
                </span>
                <span className="text-[13px] text-gray-500 leading-snug">
                  The gap between the accounts the Mind scores high and the ones that actually convert. Wider is sharper.
                </span>
              </div>
              <div className="flex items-center gap-6 flex-shrink-0">
                <div className="text-right">
                  <div className="text-[15px] font-semibold text-gray-900 tabular-nums">{calibration?.resolved ?? 0}</div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Resolved</div>
                </div>
                <div className="text-right">
                  <div className="text-[15px] font-semibold text-gray-900 tabular-nums">{calibration?.open ?? 0}</div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Open</div>
                </div>
              </div>
            </div>
            {calibration && calibration.trend.length > 0 ? (
              <div className="px-5 pb-5 pt-1 border-t border-gray-100">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2.5">By week</div>
                <div className="flex items-end gap-1 h-12">
                  {calibration.trend.slice(-24).map((t, i) => {
                    const g = t.gap ?? 0;
                    const height = Math.max(3, Math.min(48, Math.abs(g) * 130));
                    return (
                      <div
                        key={i}
                        title={`${t.week}: ${fmtGap(t.gap)}`}
                        className="flex-1 rounded-sm"
                        style={{ height, minWidth: 4, backgroundColor: g >= 0 ? "#16a34a" : "#dc2626", opacity: 0.35 }}
                      />
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="px-5 pb-5 pt-1 border-t border-gray-100">
                <p className="text-[13px] text-gray-400 pt-3">
                  No resolved predictions yet — the gap appears once outreach outcomes land.
                </p>
              </div>
            )}
          </Card>

          {/* ICP — the plain-English seed */}
          <Card label="ICP">
            <div className="px-5 py-5">
              <p className="text-[13px] text-gray-500 mb-3 leading-snug">
                Describe your ideal customer in plain English. The Mind translates it into a starting
                Scorecard, then refines it from real outcomes.
              </p>
              <textarea
                value={icpDraft}
                onChange={e => setIcpDraft(e.target.value)}
                rows={3}
                placeholder="B2B SaaS companies, 50–200 employees, RevOps and Sales Ops leaders, US…"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-400 resize-none leading-relaxed"
              />
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={saveIcp}
                  disabled={savingIcp || icpDraft.trim() === icpText.trim()}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-gray-900 text-white text-[13px] font-semibold hover:bg-gray-800 transition-colors disabled:opacity-30"
                >
                  {savingIcp ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Saving…</> : "Save ICP"}
                </button>
                {active.length === 0 && icpDraft.trim() && !savingIcp && (
                  <span className="text-[12px] text-gray-400">Saving generates your Scorecard.</span>
                )}
              </div>
            </div>
          </Card>

          {/* 2 — The Scorecard */}
          <Card label="The Scorecard">
            {active.length === 0 ? (
              <Empty>No Scorecard yet — seed it from your ICP, then the nightly loop refines it.</Empty>
            ) : (
              <div className="grid grid-cols-2 divide-x divide-gray-100">
                <div>
                  <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-gray-100">
                    <TrendingUp className="h-3.5 w-3.5 text-green-600" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-green-600">Predicts a fit</span>
                  </div>
                  {positive.map(s => <SignalRow key={s.id} s={s} />)}
                  {positive.length === 0 && <div className="text-[13px] text-gray-400 px-4 py-6">None</div>}
                </div>
                <div>
                  <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-gray-100">
                    <TrendingDown className="h-3.5 w-3.5 text-red-600" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-red-600">Predicts a miss</span>
                  </div>
                  {negative.map(s => <SignalRow key={s.id} s={s} />)}
                  {negative.length === 0 && (
                    <div className="text-[13px] text-gray-400 px-4 py-6">None yet — the loop discovers these</div>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* 3 — Learning runs */}
          <Card label="Learning Runs">
            {runs.length === 0 ? (
              <Empty>The loop hasn't run yet — it runs nightly once there are enough resolved predictions.</Empty>
            ) : (
              <div>
                {runs.map(r => (
                  <div key={r.id} className="flex items-center gap-4 px-4 py-3 border-b border-gray-100 last:border-0">
                    <span className="text-[12px] text-gray-400 tabular-nums flex-shrink-0" style={{ width: 56 }}>
                      {format(new Date(r.created_at), "MMM d")}
                    </span>
                    <span className="text-[13px] text-gray-700 tabular-nums flex-shrink-0" style={{ width: 140 }}>
                      gap {fmtGap(r.gap_before)} → <span style={{ color: gapColor(r.gap_after) }}>{fmtGap(r.gap_after)}</span>
                    </span>
                    <span className="text-[13px] text-gray-500 truncate flex-1">
                      {r.note || `${r.steps} step${r.steps === 1 ? "" : "s"}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* 4 — Memory */}
          <Card
            label="Memory"
            right={
              <span className="text-[12px] font-semibold text-gray-900 tabular-nums">
                {memories.length.toLocaleString()} facts
              </span>
            }
          >
            {memories.length === 0 ? (
              <Empty>No facts yet — the raw context the Mind reasons over will collect here.</Empty>
            ) : (
              <div>
                {memories.slice(0, 8).map(m => (
                  <div key={m.id} className="flex items-baseline gap-3 px-4 py-2.5 border-b border-gray-100 last:border-0">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 flex-shrink-0" style={{ width: 76 }}>
                      {m.category}
                    </span>
                    <span className="text-[13px] text-gray-700 truncate">{m.content}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

        </div>
      </div>
    </div>
  );
}

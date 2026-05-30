import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { RefreshCw, ChevronRight, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/ui/page-header";

// Intelligence — your living ICP.
//
// The page answers one human question, top to bottom:
//   1. Who is my ideal customer?        → "Your ideal customer" (the Scorecard, as plain sentences)
//   2. How sure are you?                → "Confidence" (calibration, stated honestly)
//   3. What did you learn?              → "What I learned" (the loop's recent adjustments)
//   4. Who do I act on?                 → "Who to act on" (attention + top-scored open accounts)
//
// Everything underneath — observations, claims, the self-healing queue, worker
// runs — is real but it is *machinery*, not the answer. It lives in the
// "Under the hood" drawer for when you want proof the loop ran.
//
// Backed by /api/mind/substrate (the v2 substrate, stage by stage),
// /api/mind/scorecard (the model) and /api/mind/scorecard/runs (what changed).

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
interface IcpFact {
  id: string; category: string; content: string; created_at?: string | null;
}
interface ScorecardRun {
  id: string;
  target: string | null;
  steps: unknown;
  gap_before: number | null;
  gap_after: number | null;
  signal_count: number | null;
  note: string | null;
  created_at: string;
}
const ICP_CATEGORIES = ["ICP", "Market", "Product", "Pricing", "Competitors", "Positioning"];

const fmtGap = (g: number | null | undefined) =>
  g == null ? "—" : `${g > 0 ? "+" : ""}${g.toFixed(2)}`;

// ─── Building blocks ─────────────────────────────────────────────────────────

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
  const [runs, setRuns] = useState<ScorecardRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  // ICP facts — workspace-level notes (asserted claims). Loaded only when the
  // Scorecard is empty so the user has an inline path to bootstrap one.
  const [icpFacts, setIcpFacts] = useState<IcpFact[]>([]);
  const [newCategory, setNewCategory] = useState("ICP");
  const [newContent, setNewContent] = useState("");
  const [savingFact, setSavingFact] = useState(false);

  // ── The GTM Playbook wizard (Phase B) — guided ICP setup, read from the site.
  const [pbOpen, setPbOpen] = useState(false);
  const [pbLoading, setPbLoading] = useState(false);
  const [pbBuilding, setPbBuilding] = useState(false);
  const [pbStep, setPbStep] = useState(0);
  const [pbReadSite, setPbReadSite] = useState(true);
  const [pbStrategy, setPbStrategy] = useState({ sell: "", audience: "", problems: "", pricing: "", positioning: "" });
  const [pbSegments, setPbSegments] = useState<string[]>([]);
  const [pbBuyers, setPbBuyers] = useState<string[]>([]);
  const [pbUseCases, setPbUseCases] = useState<string[]>([]);
  const [pbCompetitors, setPbCompetitors] = useState<string[]>([]);
  const [pbSel, setPbSel] = useState<{ segments: string[]; buyers: string[]; use_cases: string[]; competitors: string[] }>(
    { segments: [], buyers: [], use_cases: [], competitors: [] });
  const [pbManual, setPbManual] = useState(false);
  const [pbInput, setPbInput] = useState("");

  // The saved-context card is collapsed by default once there's content to hide.
  const [contextOpen, setContextOpen] = useState(false);

  // Inline editing of Scorecard signals (label / weight) + delete.
  const [editSig, setEditSig] = useState<{ id: string; field: "label" | "weight" } | null>(null);

  const load = useCallback(() => {
    if (!workspaceId || !token) return;
    const h = { Authorization: `Bearer ${token}` };
    setLoading(true);
    Promise.all([
      fetch(`${apiUrl}/api/mind/substrate?workspaceId=${workspaceId}`, { headers: h }).then(r => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/mind/scorecard?workspaceId=${workspaceId}`, { headers: h }).then(r => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/workspace/memories?workspaceId=${workspaceId}&limit=80`, { headers: h }).then(r => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/mind/scorecard/runs?workspaceId=${workspaceId}`, { headers: h }).then(r => (r.ok ? r.json() : null)),
    ])
      .then(([sub, sc, mem, scruns]) => {
        if (sub) setSubstrate(sub);
        if (sc) setSignals(sc.signals ?? []);
        if (mem) {
          const facts: IcpFact[] = (mem.memories ?? [])
            .filter((m: any) => ICP_CATEGORIES.includes(m.category))
            .map((m: any) => ({ id: m.id, category: m.category, content: m.content, created_at: m.created_at }));
          setIcpFacts(facts);
        }
        if (scruns) setRuns(scruns.runs ?? []);
      })
      .finally(() => setLoading(false));
  }, [workspaceId, token]);

  useEffect(() => { load(); }, [load]);

  const addIcpFact = async () => {
    if (!newContent.trim() || savingFact) return;
    setSavingFact(true);
    try {
      await fetch(`${apiUrl}/api/workspace/memories`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, category: newCategory, content: newContent.trim() }),
      });
      setNewContent("");
      load();
    } finally { setSavingFact(false); }
  };

  const removeIcpFact = async (id: string) => {
    try {
      await fetch(`${apiUrl}/api/workspace/memories/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId }),
      });
      load();
    } catch { /* ignore */ }
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
    } finally { setSeeding(false); }
  };

  // ── Playbook wizard handlers ────────────────────────────────────────────────
  const openPlaybook = async () => {
    setPbOpen(true);
    setPbStep(0);
    setPbLoading(true);
    try {
      const r = await fetch(`${apiUrl}/api/mind/playbook/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId }),
      });
      const d = await r.json();
      setPbReadSite(Boolean(d.read_site));
      setPbStrategy({
        sell: d.strategy?.sell ?? "", audience: d.strategy?.audience ?? "", problems: d.strategy?.problems ?? "",
        pricing: d.strategy?.pricing ?? "", positioning: d.strategy?.positioning ?? "",
      });
      setPbSegments(d.segments ?? []);
      setPbBuyers(d.buyers ?? []);
      setPbUseCases(d.use_cases ?? []);
      setPbCompetitors(d.competitors ?? []);
      setPbSel({ segments: d.segments ?? [], buyers: d.buyers ?? [], use_cases: d.use_cases ?? [], competitors: d.competitors ?? [] });
    } catch { /* user can still type */ }
    finally { setPbLoading(false); }
  };

  const pbOptions: Record<string, [string[], React.Dispatch<React.SetStateAction<string[]>>]> = {
    segments: [pbSegments, setPbSegments],
    buyers: [pbBuyers, setPbBuyers],
    use_cases: [pbUseCases, setPbUseCases],
    competitors: [pbCompetitors, setPbCompetitors],
  };
  const toggleSel = (group: "segments" | "buyers" | "use_cases" | "competitors", v: string) =>
    setPbSel(s => ({ ...s, [group]: s[group].includes(v) ? s[group].filter(x => x !== v) : [...s[group], v] }));
  const addOption = (group: "segments" | "buyers" | "use_cases" | "competitors", raw: string) => {
    const v = raw.trim();
    if (!v) return;
    const [, setter] = pbOptions[group];
    setter(prev => prev.includes(v) ? prev : [...prev, v]);
    setPbSel(s => ({ ...s, [group]: s[group].includes(v) ? s[group] : [...s[group], v] }));
  };

  const confirmPlaybook = async () => {
    if (pbBuilding) return;
    setPbBuilding(true);
    try {
      const h = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      // Server-side: clears stale ICP facts + writes the confirmed Playbook
      // (use-cases included) as a clean slate. No client-side delete loop.
      await fetch(`${apiUrl}/api/mind/playbook/confirm`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          workspaceId,
          strategy: pbStrategy,
          segments: pbSel.segments,
          buyers: pbSel.buyers,
          use_cases: pbSel.use_cases,
          competitors: pbSel.competitors,
        }),
      });
      // Rebuild the Scorecard from the fresh facts.
      await fetch(`${apiUrl}/api/mind/scorecard/seed`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ workspaceId, force: true }),
      });
      setPbOpen(false);
      load();
    } finally { setPbBuilding(false); }
  };

  const patchSignal = async (id: string, body: { label?: string; weight?: number; active?: boolean }) => {
    setEditSig(null);
    await fetch(`${apiUrl}/api/mind/scorecard/signals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ workspaceId, ...body }),
    });
    load();
  };
  const removeSignal = async (id: string) => {
    await fetch(`${apiUrl}/api/mind/scorecard/signals/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ workspaceId }),
    });
    load();
  };

  const active   = signals.filter(s => s.active);
  const positive = active.filter(s => s.weight > 0).sort((a, b) => b.weight - a.weight);
  const negative = active.filter(s => s.weight < 0).sort((a, b) => a.weight - b.weight);
  const hasModel = active.length > 0;

  const gap = substrate?.calibration.gap ?? null;
  const resolved = substrate?.calibration.resolved ?? 0;
  const trendValues = substrate?.calibration.trend.map(t => t.gap) ?? [];

  // ── The confidence sentence ─────────────────────────────────────────────────
  // Turn the calibration numbers into one honest line a founder can read. The
  // model is well-calibrated when the accounts it scores high convert more
  // often than the ones it scores low — we say that as a multiple when we can.
  const hi = substrate?.calibration.high.avg_outcome ?? null;
  const lo = substrate?.calibration.low.avg_outcome ?? null;
  const confidence: { line: string; tone: "good" | "warn" | "neutral" } = (() => {
    if (!hasModel) return { line: "No model yet — build your Scorecard below to start scoring accounts.", tone: "neutral" };
    if (resolved === 0)
      return { line: `Still gathering evidence. ${substrate?.predictions.open ?? 0} predictions are open and waiting on outcomes.`, tone: "neutral" };
    if (hi != null && lo != null && lo > 0.01) {
      const mult = hi / lo;
      if (mult >= 1.15)
        return { line: `Accounts I score 70+ convert ${mult.toFixed(1)}× more often than the rest. The model is calling it right.`, tone: "good" };
      if (mult >= 0.95)
        return { line: `High and low-scored accounts are converting at about the same rate — the model isn't separating fit from non-fit yet.`, tone: "warn" };
      return { line: `Accounts I score low are converting more than the ones I score high — the model is miscalibrated and tonight's loop will adjust.`, tone: "warn" };
    }
    if (hi != null && hi > 0 && (lo == null || lo <= 0.01))
      return { line: `Accounts I score 70+ are converting; lower-scored ones haven't yet. Early but pointing the right way.`, tone: "good" };
    return { line: `${resolved} prediction${resolved === 1 ? "" : "s"} resolved so far — not enough yet to call the model's accuracy.`, tone: "neutral" };
  })();
  const confColor = confidence.tone === "good" ? "#15803d" : confidence.tone === "warn" ? "#b45309" : undefined;

  // ── "Who to act on" — attention items, falling back to top-scored open accounts ──
  const openHot = (substrate?.recent_predictions ?? [])
    .filter(p => !p.resolved_at && (p.score ?? 0) >= 60)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 6);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-8 py-7 max-w-[1240px] mx-auto">
        <PageHeader
          title="GTM Context"
          subtitle="Your ideal customer, learned from what actually closes — and sharpening every night."
          actions={
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          }
        />

        <div className="space-y-4">

          {/* ─── 1. Your ideal customer — the Scorecard, as plain sentences ─── */}
          <div className="rounded-xl border border-border bg-background overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/50 border-b border-border">
              {(icpFacts.length === 0 && !hasModel) ? (
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Company &amp; GTM context</span>
              ) : (
                <button
                  onClick={() => setContextOpen(o => !o)}
                  className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 hover:text-foreground transition-colors"
                >
                  <ChevronRight className={`h-3.5 w-3.5 transition-transform ${contextOpen ? "rotate-90" : ""}`} />
                  Company &amp; GTM context
                  <span className="text-muted-foreground/50 normal-case font-normal ml-1 tabular-nums">· {icpFacts.length} fact{icpFacts.length === 1 ? "" : "s"}</span>
                </button>
              )}
              {(hasModel || icpFacts.length > 0) && (
                <button
                  onClick={openPlaybook}
                  className="text-[12px] font-semibold text-foreground/70 hover:text-foreground transition-colors"
                >
                  Rebuild from your site
                </button>
              )}
            </div>
            {((icpFacts.length === 0 && !hasModel) || contextOpen) && (
            <>
            {(icpFacts.length === 0 && !hasModel) ? (
              /* Cold start — the guided GTM Playbook, with manual entry as a fallback. */
              !pbManual ? (
                <div className="px-6 py-10 flex flex-col items-center text-center">
                  <h3 className="text-[17px] font-semibold text-foreground">Set up your GTM Playbook</h3>
                  <p className="text-[13px] text-muted-foreground mt-2 max-w-[460px] leading-relaxed">
                    We'll read your website, draft what you sell and who you sell to, then
                    walk you through your segments, buyers, and use cases — answers already
                    filled in. Confirm them and we build your scoring model.
                  </p>
                  <button
                    onClick={openPlaybook}
                    className="mt-5 inline-flex items-center gap-1.5 h-10 px-5 rounded-lg bg-primary text-primary-foreground text-[14px] font-semibold hover:bg-primary/90 transition-colors"
                  >
                    Set up your GTM Playbook
                  </button>
                  <button
                    onClick={() => setPbManual(true)}
                    className="mt-3 text-[12px] text-muted-foreground/70 hover:text-foreground transition-colors"
                  >
                    or enter it manually
                  </button>
                </div>
              ) : (
              <div className="px-4 py-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] text-muted-foreground">
                    Describe your ideal customer and we'll translate it into a weighted signal list.
                  </p>
                  <button
                    onClick={() => setPbManual(false)}
                    className="text-[12px] text-muted-foreground/70 hover:text-foreground transition-colors whitespace-nowrap ml-3"
                  >
                    ← back to guided setup
                  </button>
                </div>

                {icpFacts.length > 0 && (
                  <div className="divide-y divide-border/60 rounded-lg border border-border/60">
                    {icpFacts.map(f => (
                      <div key={f.id} className="flex items-start gap-3 px-3 py-2">
                        <span
                          className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 mt-0.5"
                          style={{ width: 80 }}
                        >
                          {f.category}
                        </span>
                        <span className="text-[13px] text-foreground/80 leading-snug flex-1">{f.content}</span>
                        <button
                          onClick={() => removeIcpFact(f.id)}
                          className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors"
                          aria-label="Remove fact"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 items-stretch">
                  <select
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value)}
                    className="rounded-md border border-border bg-background text-[13px] text-foreground px-2 py-1.5 outline-none focus:border-foreground/40"
                  >
                    {ICP_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input
                    type="text"
                    value={newContent}
                    onChange={e => setNewContent(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") addIcpFact(); }}
                    placeholder="e.g. B2B SaaS, 50–200 employees, RevOps and Sales Ops leaders, US."
                    className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-foreground/40"
                  />
                  <button
                    onClick={addIcpFact}
                    disabled={savingFact || !newContent.trim()}
                    className="h-9 px-3.5 rounded-md bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors disabled:opacity-30"
                  >
                    Add
                  </button>
                </div>

                <div className="flex items-center gap-3 pt-2 border-t border-border/60">
                  <button
                    onClick={buildScorecard}
                    disabled={seeding || icpFacts.length === 0}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-30"
                  >
                    {seeding
                      ? "Building…"
                      : icpFacts.length === 0
                        ? "Add at least one fact first"
                        : `Build the model from ${icpFacts.length} fact${icpFacts.length === 1 ? "" : "s"}`}
                  </button>
                  {icpFacts.length > 0 && (
                    <span className="text-[12px] text-muted-foreground/70">
                      Claude turns these into 4–8 weighted signals.
                    </span>
                  )}
                </div>
              </div>
              )
            ) : (
              /* Saved context — the source of truth, grouped + editable. */
              <div className="px-4 py-4 space-y-4">
                {icpFacts.length > 0 ? (
                  <div className="space-y-3">
                    {ICP_CATEGORIES.filter(cat => icpFacts.some(f => f.category === cat)).map(cat => (
                      <div key={cat}>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60 mb-1">{cat}</div>
                        <div className="space-y-1">
                          {icpFacts.filter(f => f.category === cat).map(f => (
                            <div key={f.id} className="flex items-start gap-2 group">
                              <span className="text-[13px] text-foreground/85 leading-snug flex-1">{f.content}</span>
                              <button
                                onClick={() => removeIcpFact(f.id)}
                                className="flex-shrink-0 h-5 w-5 grid place-items-center rounded text-muted-foreground/50 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                aria-label="Delete fact"
                                title="Delete this fact"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-muted-foreground/70">
                    No context saved yet — add facts below, or rebuild from your site.
                  </p>
                )}
                {/* add-fact row */}
                <div className="flex gap-2 items-stretch pt-3 border-t border-border/60">
                  <select
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value)}
                    className="rounded-md border border-border bg-background text-[13px] text-foreground px-2 py-1.5 outline-none focus:border-foreground/40"
                  >
                    {ICP_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input
                    type="text"
                    value={newContent}
                    onChange={e => setNewContent(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") addIcpFact(); }}
                    placeholder="Add a fact — segments, buyers, pricing, a competitor…"
                    className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-foreground/40"
                  />
                  <button
                    onClick={addIcpFact}
                    disabled={savingFact || !newContent.trim()}
                    className="h-9 px-3.5 rounded-md bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors disabled:opacity-30"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
            </>
            )}
          </div>

          {/* ─── Your ideal customer — the scoring signals derived from the context ─── */}
          {(hasModel || icpFacts.length > 0) && (
            <Card
              label="Your ideal customer"
              right={hasModel ? (
                <span className="text-[12px] text-muted-foreground/70 tabular-nums">
                  {active.length} signal{active.length === 1 ? "" : "s"}
                </span>
              ) : null}
            >
              {hasModel ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border/60">
                  {[
                    { rows: positive, head: "What predicts a fit",  color: "#15803d", empty: "Nothing yet" },
                    { rows: negative, head: "What predicts a miss", color: "#b91c1c", empty: "Nothing ruled out yet — the loop learns these from replies" },
                  ].map(({ rows, head, color, empty }) => (
                    <div key={head}>
                      <div className="px-4 py-2 border-b border-border/60 text-[11px] font-semibold uppercase tracking-wide" style={{ color }}>
                        {head}
                      </div>
                      {rows.length === 0 ? (
                        <div className="px-4 py-4 text-[13px] text-muted-foreground/50">{empty}</div>
                      ) : (
                        rows.map(s => {
                          const editingW = editSig?.id === s.id && editSig.field === "weight";
                          const editingL = editSig?.id === s.id && editSig.field === "label";
                          return (
                            <div key={s.id} className="flex items-baseline gap-3 px-4 py-2.5 border-b border-border/60 last:border-0 group">
                              {editingW ? (
                                <input
                                  type="number" autoFocus defaultValue={s.weight} min={-10} max={10}
                                  onBlur={e => patchSignal(s.id, { weight: Number(e.target.value) })}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") patchSignal(s.id, { weight: Number((e.target as HTMLInputElement).value) });
                                    if (e.key === "Escape") setEditSig(null);
                                  }}
                                  className="w-12 flex-shrink-0 rounded border border-border bg-background text-[12px] tabular-nums px-1 py-0.5 outline-none focus:border-foreground/40"
                                />
                              ) : (
                                <button
                                  onClick={() => setEditSig({ id: s.id, field: "weight" })}
                                  title="Edit weight"
                                  className="text-[12px] font-semibold tabular-nums w-8 flex-shrink-0 text-left hover:underline"
                                  style={{ color }}
                                >
                                  {s.weight > 0 ? "+" : ""}{s.weight}
                                </button>
                              )}
                              {editingL ? (
                                <input
                                  type="text" autoFocus defaultValue={s.label}
                                  onBlur={e => patchSignal(s.id, { label: e.target.value })}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") patchSignal(s.id, { label: (e.target as HTMLInputElement).value });
                                    if (e.key === "Escape") setEditSig(null);
                                  }}
                                  className="flex-1 rounded border border-border bg-background text-[13px] px-1.5 py-0.5 outline-none focus:border-foreground/40"
                                />
                              ) : (
                                <span
                                  onClick={() => setEditSig({ id: s.id, field: "label" })}
                                  className="text-[13px] text-foreground/85 leading-snug flex-1 cursor-pointer hover:text-foreground"
                                >
                                  {s.label}
                                </span>
                              )}
                              <button
                                onClick={() => removeSignal(s.id)}
                                className="text-[13px] text-muted-foreground/40 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                aria-label="Delete signal"
                              >
                                ×
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-4 flex items-center gap-3 flex-wrap">
                  <button
                    onClick={buildScorecard}
                    disabled={seeding}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-30"
                  >
                    {seeding ? "Building…" : "Build scoring signals from this context"}
                  </button>
                  <span className="text-[12px] text-muted-foreground/70">Claude turns the context above into 4–8 weighted signals.</span>
                </div>
              )}
            </Card>
          )}

          {/* ─── 2. Confidence — calibration, stated honestly ─── */}
          {hasModel && (
            <Card label="Confidence">
              <div className="px-4 py-4 flex items-center gap-4">
                <div className="flex-1">
                  <p className="text-[14px] leading-relaxed" style={{ color: confColor }}>
                    {confidence.line}
                  </p>
                  <p className="text-[12px] text-muted-foreground/70 mt-1.5 tabular-nums">
                    {resolved} prediction{resolved === 1 ? "" : "s"} resolved · {substrate?.predictions.open ?? 0} open
                    {gap != null && <> · calibration gap {fmtGap(gap)}</>}
                  </p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <Sparkline values={trendValues} width={88} height={28} />
                  <div className="text-[11px] text-muted-foreground/60 mt-1">8-week trend</div>
                </div>
              </div>
            </Card>
          )}

          {/* ─── What I learned + Who to act on — paired, side by side ─── */}
          {hasModel && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card
              label="What I learned"
              right={
                runs.length ? (
                  <span className="text-[12px] text-muted-foreground/70 tabular-nums">{runs.length} run{runs.length === 1 ? "" : "s"}</span>
                ) : null
              }
            >
              {runs.length === 0 ? (
                <div className="px-4 py-8 text-[13px] text-muted-foreground/70 text-center">
                  The model hasn't needed to adjust yet. As predictions resolve, the nightly
                  loop sharpens the signals and the changes show up here.
                </div>
              ) : (
                <div className="divide-y divide-border/60">
                  {runs.slice(0, 6).map(r => {
                    const delta = (r.gap_after != null && r.gap_before != null)
                      ? r.gap_after - r.gap_before : null;
                    return (
                      <div key={r.id} className="px-4 py-3">
                        <div className="flex items-baseline gap-2">
                          <span className="text-[13px] text-foreground/85 leading-snug flex-1">
                            {r.note || "Adjusted the Scorecard."}
                          </span>
                          <span className="text-[11px] text-muted-foreground/60 tabular-nums whitespace-nowrap">
                            {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                          </span>
                        </div>
                        {delta != null && Math.abs(delta) > 0.001 && (
                          <div className="text-[12px] mt-0.5 tabular-nums" style={{ color: delta > 0 ? "#15803d" : "#b45309" }}>
                            calibration {delta > 0 ? "improved" : "slipped"} {fmtGap(delta)}
                            {r.signal_count != null && <span className="text-muted-foreground/60"> · {r.signal_count} signals</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card
              label="Who to act on"
              right={
                (substrate?.attention.length || openHot.length) ? (
                  <span className="text-[12px] text-muted-foreground/70 tabular-nums">
                    {(substrate?.attention.length ?? 0) + openHot.length}
                  </span>
                ) : null
              }
            >
              {!substrate?.attention.length && !openHot.length ? (
                <div className="px-4 py-8 text-[13px] text-muted-foreground/70 text-center">
                  Nothing needs attention right now. ✓
                </div>
              ) : (
                <div className="divide-y divide-border/60">
                  {substrate?.attention.map((a, i) => (
                    <div key={`att-${i}`} className="px-4 py-2.5">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#b45309]">{a.kind.replace(/_/g, ' ')}</span>
                        <span className="text-[13px] text-foreground/85 truncate">{a.entity_name || a.entity_id.slice(0, 8)}</span>
                        <span className="text-[12px] text-muted-foreground/60 ml-auto tabular-nums">{a.age_days}d</span>
                      </div>
                      <div className="text-[12px] text-muted-foreground mt-0.5">{a.what}</div>
                      <div className="text-[12px] text-foreground/70 mt-0.5">→ {a.suggested_action}</div>
                    </div>
                  ))}
                  {openHot.map(p => (
                    <div key={`hot-${p.id}`} className="px-4 py-2.5 flex items-baseline gap-3">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#15803d]">strong fit</span>
                      <span className="text-[13px] text-foreground/85 truncate flex-1">
                        {p.name || p.email || p.entity_id.slice(0, 8)}
                      </span>
                      <span className="text-[12px] text-muted-foreground truncate hidden sm:block" style={{ maxWidth: 220 }}>
                        {p.fired.length ? p.fired.join(" · ") : "—"}
                      </span>
                      <span className="text-[13px] font-semibold tabular-nums text-[#15803d]">{p.score}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
          )}

        </div>
      </div>


      {/* ─── GTM Playbook wizard — guided ICP setup, read from your site ─── */}
      {pbOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !pbBuilding && setPbOpen(false)}
        >
          <div
            className="bg-background border border-border rounded-2xl shadow-xl w-full max-w-[620px] max-h-[88vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <div>
                <div className="text-[15px] font-semibold text-foreground">Set up your GTM Playbook</div>
                {!pbLoading && <div className="text-[12px] text-muted-foreground/70 mt-0.5">Step {pbStep + 1} of 5</div>}
              </div>
              <button
                onClick={() => !pbBuilding && setPbOpen(false)}
                className="text-muted-foreground/60 hover:text-foreground text-[20px] leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {pbLoading ? (
                <div className="py-16 flex flex-col items-center text-center">
                  <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground/60" />
                  <p className="text-[13px] text-muted-foreground mt-3">Reading your site and drafting your playbook…</p>
                </div>
              ) : pbStep === 0 ? (
                <div className="space-y-4">
                  <p className="text-[13px] text-muted-foreground">
                    {pbReadSite
                      ? "Here's what we found about you. Edit anything that's off."
                      : "We couldn't read your site, so here's our best guess — edit freely."}
                  </p>
                  {([["sell", "What you sell"], ["audience", "Who you sell to"], ["problems", "Problems you solve"], ["pricing", "How you price"], ["positioning", "How you position"]] as const).map(([k, label]) => (
                    <div key={k}>
                      <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</label>
                      <textarea
                        value={pbStrategy[k]}
                        onChange={e => setPbStrategy(s => ({ ...s, [k]: e.target.value }))}
                        rows={2}
                        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40 resize-none"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                (() => {
                  const group = (pbStep === 1 ? "segments" : pbStep === 2 ? "buyers" : pbStep === 3 ? "use_cases" : "competitors") as "segments" | "buyers" | "use_cases" | "competitors";
                  const meta = {
                    segments: { q: "Which market segments do you target?", sub: "Tap to keep the ones that fit, or add your own." },
                    buyers: { q: "Who are the primary buyers?", sub: "The roles you sell to." },
                    use_cases: { q: "What are the primary use cases?", sub: "The jobs they hire you for." },
                    competitors: { q: "Who do you compete with?", sub: "Named rivals or the alternatives you displace." },
                  }[group];
                  const [opts] = pbOptions[group];
                  const sel = pbSel[group];
                  return (
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-[15px] font-semibold text-foreground">{meta.q}</h3>
                        <p className="text-[12px] text-muted-foreground/70 mt-0.5">{meta.sub}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {opts.map(o => {
                          const on = sel.includes(o);
                          return (
                            <button
                              key={o}
                              onClick={() => toggleSel(group, o)}
                              className={`px-3 py-1.5 rounded-full text-[13px] border transition-colors ${on
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background text-foreground/80 border-border hover:border-foreground/40"}`}
                            >
                              {o}
                            </button>
                          );
                        })}
                        {opts.length === 0 && (
                          <span className="text-[13px] text-muted-foreground/60">No suggestions — add your own below.</span>
                        )}
                      </div>
                      <div className="flex gap-2 pt-1">
                        <input
                          value={pbInput}
                          onChange={e => setPbInput(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") { addOption(group, pbInput); setPbInput(""); } }}
                          placeholder="Add your own…"
                          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-[13px] outline-none focus:border-foreground/40"
                        />
                        <button
                          onClick={() => { addOption(group, pbInput); setPbInput(""); }}
                          className="h-9 px-3.5 rounded-md border border-border text-[13px] font-semibold hover:bg-muted/50 transition-colors"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  );
                })()
              )}
            </div>

            {!pbLoading && (
              <div className="px-6 py-4 border-t border-border flex items-center justify-between">
                <button
                  onClick={() => { setPbStep(s => Math.max(0, s - 1)); setPbInput(""); }}
                  disabled={pbStep === 0 || pbBuilding}
                  className="text-[13px] font-semibold text-foreground/70 hover:text-foreground disabled:opacity-30 transition-colors"
                >
                  Back
                </button>
                {pbStep < 4 ? (
                  <button
                    onClick={() => { setPbStep(s => s + 1); setPbInput(""); }}
                    className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 transition-colors"
                  >
                    Next
                  </button>
                ) : (
                  <button
                    onClick={confirmPlaybook}
                    disabled={pbBuilding}
                    className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {pbBuilding ? "Building your model…" : "Build my model"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

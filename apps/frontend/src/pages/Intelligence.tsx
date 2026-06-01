import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { RefreshCw, ChevronRight, Trash2, History } from "lucide-react";
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
  top_signals: { key: string; label: string; weight: number; fires: number; hits: number; hit_rate: number; lift?: number | null; sample?: number }[];
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
  confidence?: number; subject?: string | null; reaffirmed_at?: string | null; source?: string;
}

// A fact is worth revisiting if it was AI-drafted and never confirmed
// (confidence < 1), or if it has gone untouched for a while. Confirming resets
// the clock (reaffirmed_at) and raises confidence to 1.
const STALE_DAYS = 90;
function reviewReason(f: IcpFact): string | null {
  if (typeof f.confidence === "number" && f.confidence < 1) return "AI-drafted, not confirmed";
  const stamp = f.reaffirmed_at || f.created_at;
  if (stamp) {
    const days = Math.floor((Date.now() - new Date(stamp).getTime()) / 86400000);
    if (days >= STALE_DAYS) return `${days} days since last confirmed`;
  }
  return null;
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
// A GTM fact that was superseded — the workspace sharpening its own profile.
interface ContextChange {
  category: string; from: string; to: string; at: string; source: string;
}
// The curated GTM context sections, in document order. The first six feed the
// ICP scoring model; "GTM Motion" and "Notes" are agent-readable context only.
// Curated (not open-ended) so the context reads as a tidy one-pager.
const ICP_CATEGORIES = ["ICP", "Market", "Product", "Pricing", "Competitors", "Positioning", "GTM Motion", "Notes"];

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
  const [contextChanges, setContextChanges] = useState<ContextChange[]>([]);
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
  // Lifetime cap on "Rebuild from your site" — each rebuild runs an AI draft, so
  // it's capped server-side at 3 per workspace. null until the server tells us.
  const [pbRebuilds, setPbRebuilds] = useState<{ used: number; limit: number } | null>(null);

  // Collapsed by default — the page leads with the "getting smarter" story;
  // the full profile is one click away.
  const [contextOpen, setContextOpen] = useState(false);
  // The legend that explains predictions + the timeline chips.
  const [legendOpen, setLegendOpen] = useState(false);

  // Per-fact supersession history — which fact's timeline is expanded, + its rows.
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<{ id: string; content: string; created_at?: string | null; is_active?: boolean }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Inline editing of Scorecard signals (label / weight) + delete.
  const [editSig, setEditSig] = useState<{ id: string; field: "label" | "weight" } | null>(null);
  // The scoring model (signals, calibration, learned-changes) is tucked behind
  // a "see the model" disclosure so the page leads with the profile, not stats.
  const [modelOpen, setModelOpen] = useState(false);

  const load = useCallback(() => {
    if (!workspaceId || !token) return;
    const h = { Authorization: `Bearer ${token}` };
    setLoading(true);
    Promise.all([
      fetch(`${apiUrl}/api/mind/substrate?workspaceId=${workspaceId}`, { headers: h }).then(r => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/mind/scorecard?workspaceId=${workspaceId}`, { headers: h }).then(r => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/workspace/memories?workspaceId=${workspaceId}&limit=80`, { headers: h }).then(r => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/mind/scorecard/runs?workspaceId=${workspaceId}`, { headers: h }).then(r => (r.ok ? r.json() : null)),
      fetch(`${apiUrl}/api/mind/context-changes?workspaceId=${workspaceId}`, { headers: h }).then(r => (r.ok ? r.json() : null)),
    ])
      .then(([sub, sc, mem, scruns, ctxch]) => {
        if (sub) setSubstrate(sub);
        if (sc) setSignals(sc.signals ?? []);
        if (mem) {
          const facts: IcpFact[] = (mem.memories ?? [])
            .filter((m: any) => ICP_CATEGORIES.includes(m.category))
            .map((m: any) => ({ id: m.id, category: m.category, content: m.content, created_at: m.created_at, confidence: m.confidence, subject: m.subject, reaffirmed_at: m.reaffirmed_at, source: m.source }));
          setIcpFacts(facts);
        }
        if (scruns) setRuns(scruns.runs ?? []);
        if (ctxch) setContextChanges(ctxch.changes ?? []);
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

  // Confirm a fact — raise confidence to 1 and reset its staleness clock.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const confirmFact = async (id: string) => {
    setConfirmingId(id);
    try {
      await fetch(`${apiUrl}/api/workspace/memories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, confidence: 1, reaffirm: true }),
      });
      await load();
    } finally { setConfirmingId(null); }
  };

  // Expand/collapse a fact's supersession timeline (active + superseded versions).
  const toggleHistory = async (fact: IcpFact) => {
    if (historyOpen === fact.id) { setHistoryOpen(null); return; }
    if (!fact.subject) return;
    setHistoryOpen(fact.id);
    setHistoryItems([]);
    setHistoryLoading(true);
    try {
      const r = await fetch(
        `${apiUrl}/api/workspace/memories/history?workspaceId=${workspaceId}&subject=${encodeURIComponent(fact.subject)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const d = await r.json();
      setHistoryItems((d.history ?? []).map((m: any) => ({ id: m.id, content: m.content, created_at: m.created_at, is_active: m.is_active })));
    } catch { /* ignore */ }
    finally { setHistoryLoading(false); }
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
      // 429 = the lifetime rebuild cap is hit. Record it so the button disables.
      if (r.status === 429) {
        const e = await r.json().catch(() => ({}));
        setPbRebuilds({ used: e.used ?? 3, limit: e.limit ?? 3 });
        setPbOpen(false);
        return;
      }
      const d = await r.json();
      if (d.rebuilds_limit != null) setPbRebuilds({ used: d.rebuilds_used ?? 0, limit: d.rebuilds_limit });
      setPbReadSite(Boolean(d.read_site));
      setPbStrategy({
        sell: d.strategy?.sell ?? "", audience: d.strategy?.audience ?? "", problems: d.strategy?.problems ?? "",
        pricing: d.strategy?.pricing ?? "", positioning: d.strategy?.positioning ?? "",
      });
      setPbSegments(d.segments ?? []);
      setPbBuyers(d.buyers ?? []);
      setPbUseCases(d.use_cases ?? []);
      setPbCompetitors(d.competitors ?? []);
      // Suggestions start UNSELECTED — the user taps the ones that fit, and any
      // option they add themselves is auto-selected by addOption.
      setPbSel({ segments: [], buyers: [], use_cases: [], competitors: [] });
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

  // Has the user actually run the guided 5-step Playbook? The wizard writes its
  // facts with source 'playbook' — onboarding only seeds a single ICP line
  // (source 'onboarding'), which is NOT a completed playbook. So a lone ICP fact
  // must not unlock the page: until the user finishes the Playbook (or builds a
  // model by hand), we keep them on the cold-start setup screen.
  const playbookDone = icpFacts.some(f => f.source === "playbook");
  const needsSetup = !playbookDone && !hasModel;

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

  // The scoring model in one plain sentence — the transparency layer. The
  // weights/calibration live behind "see the model"; this is the gist.
  const fitSummary = positive.length
    ? `A strong fit looks like: ${positive.slice(0, 5).map(s => s.label).join("; ")}.`
    : null;

  const predictionsMade = (substrate?.predictions.open ?? 0) + resolved;

  // "Called it" — resolved predictions where the model scored a strong fit and
  // the account actually converted. The loop proven right by reality.
  const hits = (substrate?.recent_predictions ?? [])
    .filter(p => p.resolved_at && (p.score ?? 0) >= 70 && (p.outcome_score ?? 0) > 0);

  // Who taught a context change — turns "a fact changed" into "Claude learned
  // this from your work", which is the whole write-back loop made visible.
  const sourceWho = (s: string) => (s === "agent" ? "Claude" : s === "playbook" ? "site" : "you");

  // The timeline is for things the workspace LEARNED, not a copy of the context.
  // So we don't echo the static site/you facts here — only Claude's write-backs
  // (the system updating itself from your work) count as a "captured" learning.
  // Refinements, model changes, and outcomes are events regardless of source.
  const refinedContents = new Set(contextChanges.map(c => c.to));
  const captures = icpFacts.filter(f => f.source === "agent" && f.created_at && !refinedContents.has(f.content));

  // The "what it's learned" timeline — the page's heart. Knowledge captured,
  // then refined (you/Claude/site), the model sharpening, and predictions it
  // called right — all merged newest-first.
  type Learning = { id: string; kind: "model" | "context" | "outcome"; who?: string; text: string; sub?: string; at: string; delta?: number | null };
  const learnings: Learning[] = [
    ...runs.map(r => ({
      id: `run-${r.id}`, kind: "model" as const,
      text: r.note || "Sharpened the scoring model.",
      at: r.created_at,
      delta: (r.gap_after != null && r.gap_before != null) ? r.gap_after - r.gap_before : null,
    })),
    ...contextChanges.map((c, i) => ({
      id: `ctx-${i}`, kind: "context" as const, who: sourceWho(c.source),
      text: `${c.category} — ${c.to}`,
      sub: `was: ${c.from}`,
      at: c.at,
    })),
    ...hits.map(p => ({
      id: `hit-${p.id}`, kind: "outcome" as const,
      text: `Called it — ${p.name || p.email || "an account"} scored ${p.score} and converted`,
      at: p.resolved_at as string,
    })),
    ...captures.map(f => ({
      id: `cap-${f.id}`, kind: "context" as const, who: sourceWho(f.source ?? "manual"),
      text: `${f.category} — ${f.content}`,
      at: f.created_at as string,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 14);

  // "Sharpened" counts the times it got BETTER — refinements, model changes, and
  // calls it got right — not the initial captures.
  const sharpenedCount = runs.length + contextChanges.length + hits.length;

  // The chip on each learning — colour-codes who/what taught it.
  const learningChip = (l: Learning): { label: string; color: string; bg: string } => {
    if (l.kind === "outcome") return { label: "✓ called it", color: "#b45309", bg: "rgba(180,83,9,0.10)" };
    if (l.kind === "model") return { label: "model", color: "#15803d", bg: "rgba(21,128,61,0.08)" };
    const who = l.who ?? "you";
    if (who === "Claude") return { label: "Claude", color: "#6d28d9", bg: "rgba(109,40,217,0.08)" };
    if (who === "site") return { label: "site", color: "#a16207", bg: "rgba(161,98,7,0.08)" };
    return { label: "you", color: "#475569", bg: "rgba(71,85,105,0.08)" };
  };

  // "To get sharper, I need…" — turns the page into a loop the user feeds.
  const staleCount = icpFacts.filter(f => reviewReason(f)).length;
  const openPreds = substrate?.predictions.open ?? 0;
  const needs: string[] = [];
  if (!hasModel && icpFacts.length > 0) needs.push("build your scoring model");
  if (openPreds > 0) needs.push(`${openPreds} prediction${openPreds === 1 ? "" : "s"} waiting on outcomes`);
  if (staleCount > 0) needs.push(`confirm ${staleCount} belief${staleCount === 1 ? "" : "s"}`);

  // "Learning for N days" — a streak from the oldest fact still in the context.
  const oldestAt = icpFacts.reduce<string | null>(
    (min, f) => (f.created_at && (!min || f.created_at < min) ? f.created_at : min), null);
  const learningDays = oldestAt ? Math.max(1, Math.floor((Date.now() - new Date(oldestAt).getTime()) / 86400000)) : null;

  // One editable signal row (weight + label), reused inside "see the model".
  const renderSignal = (s: Signal, color: string) => {
    const editingW = editSig?.id === s.id && editSig.field === "weight";
    const editingL = editSig?.id === s.id && editSig.field === "label";
    return (
      <div key={s.id} className="flex items-baseline gap-3 py-1.5 group">
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
        {(() => {
          // Lift: how much more accounts where this signal fires convert vs where
          // it doesn't, measured from resolved deals. Null until there's enough data.
          const t = (substrate?.top_signals ?? []).find(ts => ts.key === s.key);
          if (t?.lift == null) return null;
          const up = t.lift >= 1;
          return (
            <span
              className="flex-shrink-0 text-[11px] font-semibold tabular-nums px-1.5 py-[1px] rounded"
              style={up ? { color: "#15803d", background: "rgba(21,128,61,0.08)" } : { color: "#b45309", background: "rgba(180,83,9,0.08)" }}
              title={`accounts with this signal convert ${t.lift}× as often (from ${t.sample} resolved deals)`}
            >
              {t.lift}×{up ? " more" : ""}
            </span>
          );
        })()}
        <button
          onClick={() => removeSignal(s.id)}
          className="flex-shrink-0 h-5 w-5 grid place-items-center rounded text-muted-foreground/40 hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-colors"
          aria-label="Remove signal"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-8 py-7 max-w-[1240px] mx-auto">
        <PageHeader
          title="GTM Context"
          subtitle="What your agents know about your business."
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

          {/* ─── 1. Your context — the living profile, the hero of the page ─── */}
          <div className="rounded-xl border border-border bg-background overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/50 border-b border-border">
              {needsSetup ? (
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Your context</span>
              ) : (
                <button
                  onClick={() => setContextOpen(o => !o)}
                  className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 hover:text-foreground transition-colors"
                >
                  <ChevronRight className={`h-3.5 w-3.5 transition-transform ${contextOpen ? "rotate-90" : ""}`} />
                  Your context
                  <span className="text-muted-foreground/50 normal-case font-normal ml-1 tabular-nums">· {icpFacts.length} fact{icpFacts.length === 1 ? "" : "s"}</span>
                </button>
              )}
              {!needsSetup && (() => {
                const exhausted = pbRebuilds != null && pbRebuilds.used >= pbRebuilds.limit;
                return (
                  <button
                    onClick={openPlaybook}
                    disabled={exhausted}
                    title={pbRebuilds ? `${pbRebuilds.used}/${pbRebuilds.limit} site rebuilds used` : "Reads your site and re-drafts your playbook (3 rebuilds max)"}
                    className="text-[12px] font-semibold text-foreground/70 hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {exhausted ? "Site rebuilds used up" : "Rebuild from your site"}
                  </button>
                );
              })()}
            </div>
            {(needsSetup || contextOpen) && (
            <>
            {needsSetup ? (
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
                {(() => {
                  const review = icpFacts
                    .map(f => ({ f, reason: reviewReason(f) }))
                    .filter((x): x is { f: IcpFact; reason: string } => x.reason !== null);
                  if (review.length === 0) return null;
                  return (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700/90">
                        <RefreshCw className="h-3 w-3" />
                        Worth revisiting · {review.length}
                      </div>
                      <p className="text-[11.5px] text-muted-foreground/80 leading-relaxed">
                        These facts are AI-drafted or have gone a while without a check. Confirm the ones still true so your context stays trustworthy.
                      </p>
                      <div className="space-y-1.5">
                        {review.map(({ f, reason }) => (
                          <div key={f.id} className="flex items-start gap-2">
                            <span className="text-[12px] text-foreground/80 leading-snug flex-1">
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50 mr-1.5">{f.category}</span>
                              {f.content}
                              <span className="ml-1.5 text-[10px] text-amber-700/70">· {reason}</span>
                            </span>
                            <button
                              onClick={() => confirmFact(f.id)}
                              disabled={confirmingId === f.id}
                              className="flex-shrink-0 h-6 px-2 rounded-md border border-amber-600/30 text-[11px] font-semibold text-amber-800 hover:bg-amber-500/15 transition-colors disabled:opacity-40"
                            >
                              {confirmingId === f.id ? "…" : "Confirm"}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {icpFacts.length > 0 ? (
                  <div className="space-y-5">
                    {ICP_CATEGORIES.filter(cat => icpFacts.some(f => f.category === cat)).map(cat => (
                      <div key={cat}>
                        <div className="text-[12px] font-semibold uppercase tracking-wider text-foreground/60 mb-1.5 pb-1 border-b border-border/40">{cat}</div>
                        <div className="space-y-1.5">
                          {icpFacts.filter(f => f.category === cat).map(f => {
                            const inferred = typeof f.confidence === "number" && f.confidence < 1;
                            return (
                            <div key={f.id}>
                              <div className="flex items-start gap-2 group">
                                <span className="text-[13px] text-foreground/85 leading-snug flex-1">
                                  {f.content}
                                  {inferred && (
                                    <span
                                      title="AI-drafted from your site — confirm or edit to make it yours"
                                      className="ml-1.5 align-middle text-[9px] font-semibold uppercase tracking-wide text-amber-700/80 bg-amber-500/10 rounded px-1 py-[1px]"
                                    >
                                      inferred
                                    </span>
                                  )}
                                </span>
                                {f.subject && (
                                  <button
                                    onClick={() => toggleHistory(f)}
                                    className="flex-shrink-0 h-5 w-5 grid place-items-center rounded text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-colors"
                                    aria-label="Fact history"
                                    title="See how this changed over time"
                                  >
                                    <History className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                <button
                                  onClick={() => removeIcpFact(f.id)}
                                  className="flex-shrink-0 h-5 w-5 grid place-items-center rounded text-muted-foreground/50 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                  aria-label="Delete fact"
                                  title="Delete this fact"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              {historyOpen === f.id && (
                                <div className="mt-1 ml-1 pl-3 border-l-2 border-border/60 space-y-1">
                                  {historyLoading ? (
                                    <div className="text-[11px] text-muted-foreground/60 py-1">Loading history…</div>
                                  ) : historyItems.length <= 1 ? (
                                    <div className="text-[11px] text-muted-foreground/60 py-1">No earlier versions yet — this is the first.</div>
                                  ) : (
                                    historyItems.map(h => (
                                      <div key={h.id} className="text-[12px] leading-snug">
                                        <span className={h.is_active ? "text-foreground/80" : "text-muted-foreground/50 line-through"}>{h.content}</span>
                                        <span className="ml-1.5 text-[10px] text-muted-foreground/50">
                                          {h.is_active ? "current" : "superseded"}{h.created_at ? ` · ${new Date(h.created_at).toLocaleDateString()}` : ""}
                                        </span>
                                      </div>
                                    ))
                                  )}
                                </div>
                              )}
                            </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-muted-foreground/70">
                    No context yet — add to a section below, or rebuild from your site.
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
                    placeholder="Add to a section — a buyer, pricing, your motion, a note…"
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

          {/* ─── 2. How your workspace is getting smarter — the centerpiece. ───
               ─── The compounding story: the model AND the context sharpening ───
               ─── over time. This is the whole point of the page. ─── */}
          {!needsSetup && (hasModel || icpFacts.length > 0 || learnings.length > 0) && (
            <div className="rounded-xl border border-border bg-background overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-muted/50 border-b border-border">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  How your workspace is getting smarter
                  {learningDays != null && (
                    <span className="normal-case font-normal text-muted-foreground/45 ml-1.5">· learning for {learningDays}d</span>
                  )}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setLegendOpen(o => !o)}
                    className="text-[12px] font-semibold text-muted-foreground/70 hover:text-foreground transition-colors"
                  >
                    What's this?
                  </button>
                  {hasModel && (
                    <button
                      onClick={() => setModelOpen(o => !o)}
                      className="text-[12px] font-semibold text-muted-foreground/70 hover:text-foreground transition-colors"
                    >
                      {modelOpen ? "Hide the scoring model" : "See the scoring model"}
                    </button>
                  )}
                </div>
              </div>

              {legendOpen && (
                <div className="px-4 py-3 bg-muted/30 border-b border-border/60 text-[12px] text-muted-foreground/80 space-y-2.5">
                  <p className="leading-relaxed">
                    <span className="font-semibold text-foreground/75">Prediction:</span> when Nous scores an account's fit (0–100), it stakes a bet that the strong-fit ones will convert. As accounts reply or close, each prediction resolves — and the model learns which signals were actually predictive.
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {[
                      { label: "Claude", color: "#6d28d9", bg: "rgba(109,40,217,0.08)", desc: "Claude updated your context from your work" },
                      { label: "you", color: "#475569", bg: "rgba(71,85,105,0.08)", desc: "you edited it" },
                      { label: "site", color: "#a16207", bg: "rgba(161,98,7,0.08)", desc: "drafted from your website" },
                      { label: "model", color: "#15803d", bg: "rgba(21,128,61,0.08)", desc: "the scoring model adjusted itself" },
                      { label: "✓ called it", color: "#b45309", bg: "rgba(180,83,9,0.10)", desc: "a strong-fit prediction that converted" },
                    ].map(it => (
                      <span key={it.label} className="inline-flex items-center gap-1.5">
                        <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-[1px] rounded whitespace-nowrap" style={{ color: it.color, background: it.bg }}>{it.label}</span>
                        <span className="text-muted-foreground/65">{it.desc}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="px-4 py-4 space-y-4">
                {/* Headline — the improvement when there's data, else the loop's promise. */}
                {!hasModel ? (
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      onClick={buildScorecard}
                      disabled={seeding}
                      className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-30"
                    >
                      {seeding ? "Building…" : "Build your scoring model"}
                    </button>
                    <span className="text-[12px] text-muted-foreground/70">Turn your context into a model that scores fit — then watch it sharpen from every outcome.</span>
                  </div>
                ) : resolved > 0 ? (
                  <div className="flex items-end gap-3">
                    <p className="text-[15px] leading-relaxed flex-1 font-medium" style={{ color: confColor }}>{confidence.line}</p>
                    {trendValues.length >= 2 && (
                      <div className="flex-shrink-0 text-right">
                        <Sparkline values={trendValues} width={84} height={26} />
                        <div className="text-[10px] text-muted-foreground/50 mt-0.5">getting sharper</div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[14px] text-foreground/80 leading-relaxed">
                    Your model is learning. It's made {predictionsMade} prediction{predictionsMade === 1 ? "" : "s"} across your accounts — as they reply and close, it sharpens which signals predict a real fit, and you'll watch exactly what it learns below.
                  </p>
                )}

                {/* Growth strip — concrete proof of substance, even early. */}
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted-foreground/70 tabular-nums border-t border-border/50 pt-3">
                  <span><span className="font-semibold text-foreground/80">{icpFacts.length}</span> facts in context</span>
                  {hasModel && <span><span className="font-semibold text-foreground/80">{active.length}</span> signals learned</span>}
                  {predictionsMade > 0 && <span><span className="font-semibold text-foreground/80">{predictionsMade}</span> predictions</span>}
                  {hits.length > 0 && <span className="text-[#b45309]">called it right <span className="font-semibold">{hits.length}</span>×</span>}
                  {resolved > 0 && <span><span className="font-semibold text-foreground/80">{resolved}</span> outcomes in</span>}
                  {sharpenedCount > 0 && <span>sharpened <span className="font-semibold text-foreground/80">{sharpenedCount}</span>×</span>}
                </div>

                {/* What it's learned — the timeline. The heart of the page. */}
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60 mb-1.5">What it's learned</div>
                  {learnings.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground/65 leading-relaxed">
                      Nothing learned yet. This fills in as your workspace sharpens — when Claude updates your context from your work, when you refine a belief, or when a prediction resolves. It's the record of getting smarter, not a copy of your context.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {learnings.map(l => {
                        const chip = learningChip(l);
                        return (
                        <div key={l.id} className="flex items-baseline gap-2.5 text-[12.5px]">
                          <span
                            className="flex-shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-[1px] rounded mt-[1px] whitespace-nowrap"
                            style={{ color: chip.color, background: chip.bg }}
                          >
                            {chip.label}
                          </span>
                          <span className="flex-1 leading-snug text-foreground/85">
                            {l.text}
                            {l.sub && <span className="text-muted-foreground/55"> · {l.sub}</span>}
                          </span>
                          {l.delta != null && Math.abs(l.delta) > 0.001 && (
                            <span className="tabular-nums whitespace-nowrap flex-shrink-0" style={{ color: l.delta > 0 ? "#15803d" : "#b45309" }}>
                              {l.delta > 0 ? "↑" : "↓"} {fmtGap(l.delta)}
                            </span>
                          )}
                          <span className="text-[11px] text-muted-foreground/50 tabular-nums whitespace-nowrap flex-shrink-0">
                            {formatDistanceToNow(new Date(l.at), { addSuffix: true })}
                          </span>
                        </div>
                        );
                      })}
                    </div>
                  )}

                  {needs.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/50 text-[12px] text-muted-foreground/75 leading-relaxed">
                      <span className="font-semibold text-foreground/70">To get sharper:</span> {needs.join(" · ")}
                    </div>
                  )}
                </div>

                {/* The scoring model itself — transparency on demand. */}
                {hasModel && modelOpen && (
                  <div className="pt-3 border-t border-border/60 space-y-3">
                    {fitSummary && <p className="text-[13px] text-foreground/80 leading-relaxed">{fitSummary}</p>}
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60 mb-1">
                        Signals · {active.length}
                        <span className="normal-case font-normal text-muted-foreground/50"> — click a weight or label to edit</span>
                      </div>
                      <div>{positive.map(s => renderSignal(s, "#15803d"))}</div>
                      {negative.length > 0 && (
                        <>
                          <div className="text-[10px] font-semibold uppercase tracking-wide mt-3 mb-1" style={{ color: "#b91c1c" }}>Predicts a miss</div>
                          <div>{negative.map(s => renderSignal(s, "#b91c1c"))}</div>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground/55 tabular-nums pt-2 border-t border-border/40">
                      <span>{resolved} resolved · {substrate?.predictions.open ?? 0} open</span>
                      {gap != null && <span>· calibration gap {fmtGap(gap)}</span>}
                    </div>
                  </div>
                )}
              </div>
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
                        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40 resize-y min-h-[3rem]"
                      />
                    </div>
                  ))}
                </div>
              ) : (
                (() => {
                  const group = (pbStep === 1 ? "segments" : pbStep === 2 ? "buyers" : pbStep === 3 ? "use_cases" : "competitors") as "segments" | "buyers" | "use_cases" | "competitors";
                  const meta = {
                    segments: { q: "Which market segments do you target?", sub: "Tap the ones that fit to add them, or add your own." },
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
                              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[13px] border transition-colors ${on
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background text-foreground/80 border-border hover:border-foreground/40"}`}
                            >
                              <span className="text-[11px] leading-none opacity-80">{on ? "✓" : "+"}</span>
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

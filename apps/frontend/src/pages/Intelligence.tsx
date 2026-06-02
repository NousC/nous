import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { RefreshCw, ChevronRight, Trash2, History, Info, Plus } from "lucide-react";
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
  predictions: { total: number; open: number; resolved: number; won?: number; lost?: number; by_kind: Record<string, number> };
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
    outcome_score: number | null; disposition: string | null; replied: boolean | null;
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

// A standalone ICP record — the analyzed account's score trail, sourced from
// the ICP substrate (GET /api/mind/account/:id), independent of the CRM contact.
interface IcpRecordRow {
  id: string;
  score: number | null;
  fit: boolean | null;
  reason: string | null;
  scored_at: string;
  rescored?: boolean;
  resolved_at: string | null;
  disposition: string | null;
  outcome_score: number | null;
  learned: { status: "changed" | "no_change" | "pending"; at?: string; detail?: string | null } | null;
}
interface IcpRecord {
  account: { entity_id: string; name: string | null; email: string | null };
  icp: { current: IcpRecordRow; history: IcpRecordRow[] } | null;
}

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
  const [addSection, setAddSection] = useState<string | null>(null);
  const [sectionDraft, setSectionDraft] = useState("");

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

  // Per-fact supersession history — which fact's timeline is expanded, + its rows.
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<{ id: string; content: string; created_at?: string | null; is_active?: boolean }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Build-from-closed-deals (Step 5) — seed the model from real won/lost.
  const [cdOpen, setCdOpen] = useState(false);
  const [cdWon, setCdWon] = useState("");
  const [cdLost, setCdLost] = useState("");
  const [cdRunning, setCdRunning] = useState(false);
  const [cdResult, setCdResult] = useState<{ enriched: number; discovered: { label: string; weight: number; note: string }[] } | null>(null);

  // Standalone ICP record drawer — opened from the analyzed table.
  const [recordEntity, setRecordEntity] = useState<{ id: string; label: string } | null>(null);
  const [record, setRecord] = useState<IcpRecord | null>(null);
  const [recordLoading, setRecordLoading] = useState(false);
  useEffect(() => {
    if (!recordEntity) { setRecord(null); return; }
    setRecordLoading(true);
    fetch(`${apiUrl}/api/mind/account/${recordEntity.id}?workspaceId=${workspaceId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => setRecord(d ?? null))
      .catch(() => setRecord(null))
      .finally(() => setRecordLoading(false));
  }, [recordEntity, workspaceId, token]);

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

  const submitSection = async (cat: string) => {
    if (!sectionDraft.trim() || savingFact) return;
    setSavingFact(true);
    try {
      await fetch(`${apiUrl}/api/workspace/memories`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, category: cat, content: sectionDraft.trim() }),
      });
      setSectionDraft("");
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

  // Build the model from real closed deals — enrich + contrastive lift discovery.
  const parseDomains = (s: string) => s.split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
  const runClosedDeals = async () => {
    if (cdRunning) return;
    const won = parseDomains(cdWon), lost = parseDomains(cdLost);
    if (won.length + lost.length < 4) { window.alert("Add at least a few closed deals (won + lost domains)."); return; }
    setCdRunning(true); setCdResult(null);
    try {
      const r = await fetch(`${apiUrl}/api/mind/closed-deals`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, won, lost }),
      });
      const d = await r.json();
      if (d.discovered) { setCdResult(d); load(); }
      else window.alert(d.detail || d.error || "Couldn't process the deals.");
    } catch { window.alert("Request failed."); }
    finally { setCdRunning(false); }
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
      // One onboarding flow: after the site-read playbook builds the model,
      // continue into closed-deals discovery to seed it from real outcomes too.
      setCdOpen(true);
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
  if (openPreds > 0) needs.push(`${openPreds} scored account${openPreds === 1 ? "" : "s"} waiting on an outcome`);
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
          title="Context"
          subtitle="What your agents know about your business."
          actions={
            <div className="flex items-center gap-2">
              {!needsSetup && (
                <button
                  onClick={() => setCdOpen(true)}
                  title="Add closed-won / closed-lost deals to sharpen the model"
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" /> Add deals
                </button>
              )}
              <button
                onClick={load}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
              </button>
            </div>
          }
        />

        {hasModel && (
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border/70 rounded-xl border border-border mb-4 bg-background">
            {[
              { label: "Accounts analyzed", value: predictionsMade, color: undefined as string | undefined, info: "Accounts the ICP model has scored for fit (0–100)." },
              { label: "Closed-won", value: substrate?.predictions.won ?? 0, color: "#15803d", info: "Scored accounts that converted — the wins the model learns from." },
              { label: "Closed-lost", value: substrate?.predictions.lost ?? 0, color: "#b45309", info: "Scored accounts that entered a real buying motion but didn't close." },
              { label: "Signals", value: active.length, color: undefined, info: "The weighted attributes the model scores fit on." },
            ].map(m => (
              <div key={m.label} className="px-4 py-3.5 relative group/metric">
                <Info className="absolute top-2 right-2 h-3 w-3 text-muted-foreground/25 group-hover/metric:text-muted-foreground/60 transition-colors" />
                <span className="pointer-events-none absolute top-7 right-2 z-30 w-52 rounded-lg bg-foreground text-background text-[11px] leading-snug px-2.5 py-2 shadow-lg opacity-0 group-hover/metric:opacity-100 transition-opacity duration-150">
                  {m.info}
                </span>
                <div className="text-[22px] font-semibold tabular-nums leading-none" style={m.color ? { color: m.color } : undefined}>{m.value}</div>
                <div className="text-[10.5px] font-medium text-muted-foreground/60 uppercase tracking-wide mt-1.5">{m.label}</div>
              </div>
            ))}
          </div>
        )}

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
                </button>
              )}
            </div>
            {(needsSetup || contextOpen) && (
            <>
            {needsSetup ? (
              /* Cold start — the guided Playbook (or closed-deals / manual). */
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
                    onClick={() => setCdOpen(true)}
                    className="mt-3 text-[12px] font-semibold text-foreground/70 hover:text-foreground transition-colors"
                  >
                    or build from my closed deals →
                  </button>
                  <button
                    onClick={() => setPbManual(true)}
                    className="mt-1.5 text-[12px] text-muted-foreground/70 hover:text-foreground transition-colors"
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
                          aria-label="Remove"
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
                        ? "Add at least one line first"
                        : `Build the model from ${icpFacts.length} line${icpFacts.length === 1 ? "" : "s"}`}
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
                        These are AI-drafted or have gone a while without a check. Confirm the ones still true so your context stays trustworthy.
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
                {/* Each section is a living field. Hover a section to reveal its
                    "+" — add a line straight into it, no dropdown. */}
                <div className="space-y-5">
                  {ICP_CATEGORIES.map(cat => {
                    const items = icpFacts.filter(f => f.category === cat);
                    const adding = addSection === cat;
                    const openAdd = () => { setAddSection(cat); setSectionDraft(""); };
                    const closeAdd = () => { setAddSection(null); setSectionDraft(""); };
                    return (
                      <div key={cat} className="group/section">
                        <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-border/40">
                          <span className="text-[12px] font-semibold uppercase tracking-wider text-foreground/60">{cat}</span>
                          <button
                            onClick={() => (adding ? closeAdd() : openAdd())}
                            className={`flex-shrink-0 h-5 w-5 grid place-items-center rounded text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-all ${adding ? "opacity-100" : "opacity-0 group-hover/section:opacity-100"}`}
                            aria-label={`Add to ${cat}`}
                            title={`Add to ${cat}`}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="space-y-1.5">
                          {items.map(f => {
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
                                    aria-label="History"
                                    title="See how this changed over time"
                                  >
                                    <History className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                <button
                                  onClick={() => removeIcpFact(f.id)}
                                  className="flex-shrink-0 h-5 w-5 grid place-items-center rounded text-muted-foreground/50 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                  aria-label="Remove"
                                  title="Remove"
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
                          {adding ? (
                            <input
                              type="text"
                              autoFocus
                              value={sectionDraft}
                              onChange={e => setSectionDraft(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") submitSection(cat);
                                if (e.key === "Escape") closeAdd();
                              }}
                              onBlur={() => { if (!sectionDraft.trim()) closeAdd(); }}
                              placeholder={`Add to ${cat}…`}
                              className="w-full rounded-md border border-foreground/30 bg-background px-3 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-foreground/50"
                            />
                          ) : items.length === 0 ? (
                            <button
                              onClick={openAdd}
                              className="flex items-center gap-1 text-[12.5px] text-muted-foreground/40 hover:text-foreground/70 transition-colors"
                            >
                              <Plus className="h-3 w-3" /> add
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            </>
            )}
          </div>

          {/* ─── 2. How your workspace is getting smarter — the centerpiece. ───
               ─── The compounding story: the model AND the context sharpening ───
               ─── over time. This is the whole point of the page. ─── */}
          {!needsSetup && ((!hasModel && icpFacts.length > 0) || (hasModel && (substrate?.recent_predictions?.length ?? 0) > 0)) && (
            <div className="rounded-xl border border-border bg-background overflow-hidden">
              <div className="px-4 py-4 space-y-5">
                {/* Build CTA — only before a scoring model exists. */}
                {!hasModel && (
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
                )}

                {/* What we analyzed — the real work, as a People-style table. Each
                    account Nous scored: its ICP fit and how it actually turned out.
                    Full-bleed (breaks the card padding) so it reads as a real table. */}
                {hasModel && (substrate?.recent_predictions?.length ?? 0) > 0 && (
                  <div className="-mx-4">
                    {/* Header */}
                    <div className="flex items-center gap-4 px-4 py-2.5 bg-muted/50 border-y border-border">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 flex-1 min-w-0">Account</span>
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 flex-shrink-0 text-right" style={{ width: 48 }}>ICP fit</span>
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 flex-shrink-0" style={{ width: 96 }}>Outcome</span>
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 flex-shrink-0 text-right" style={{ width: 92 }}>Analyzed</span>
                    </div>
                    {/* Rows */}
                    {substrate!.recent_predictions.slice(0, 12).map(p => {
                      const label = p.name || p.email || "Unknown account";
                      const score = typeof p.score === "number" ? Math.round(p.score) : null;
                      const outcome =
                        p.disposition === "won" ? { t: "Closed-won", c: "#15803d", bg: "rgba(21,128,61,0.10)" }
                        : p.disposition === "lost" ? { t: "Closed-lost", c: "#b45309", bg: "rgba(180,83,9,0.10)" }
                        : p.replied ? { t: "Replied", c: "#1d4ed8", bg: "rgba(29,78,216,0.10)" }
                        : p.disposition === "no_opportunity" ? { t: "No deal", c: "#64748b", bg: "rgba(100,116,139,0.10)" }
                        : null;
                      return (
                        <div
                          key={p.id}
                          onClick={() => p.entity_id && setRecordEntity({ id: p.entity_id, label })}
                          className="flex items-center gap-4 px-4 py-3 border-b border-border/60 last:border-0 hover:bg-muted/50 transition-colors cursor-pointer"
                          title="Open this account's ICP record"
                        >
                          <span className="flex-1 min-w-0 text-[13px] font-medium text-foreground truncate">{label}</span>
                          <span
                            className="flex-shrink-0 text-right text-[13px] font-semibold tabular-nums"
                            style={{ width: 48, color: score == null ? "#94a3b8" : score >= 70 ? "#15803d" : score >= 40 ? "#a16207" : "#b91c1c" }}
                          >
                            {score ?? "—"}
                          </span>
                          <div className="flex-shrink-0" style={{ width: 96 }}>
                            {outcome ? (
                              <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-[1px] rounded" style={{ color: outcome.c, background: outcome.bg }}>
                                {outcome.t}
                              </span>
                            ) : (
                              <span className="text-[12px] text-muted-foreground/45">Pending</span>
                            )}
                          </div>
                          <span className="flex-shrink-0 text-right text-[12px] text-muted-foreground/60 tabular-nums" style={{ width: 92 }}>
                            {formatDistanceToNow(new Date(p.resolved_at || p.predicted_at), { addSuffix: true })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

              </div>
            </div>
          )}

        </div>
      </div>


      {/* ─── ICP record — a standalone account record, opened from the table.
           Its own thing: the score trail + how each outcome fed the model.
           Pure ICP substrate, not the CRM contact. ─── */}
      {recordEntity && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setRecordEntity(null)}>
          <div className="h-full w-full max-w-[460px] bg-background border-l border-border shadow-xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/55">ICP record</div>
                <div className="text-[16px] font-semibold text-foreground truncate">{recordEntity.label}</div>
                {record?.account.email && record.account.email !== recordEntity.label && (
                  <div className="text-[12px] text-muted-foreground/70 truncate">{record.account.email}</div>
                )}
              </div>
              <button onClick={() => setRecordEntity(null)} className="text-muted-foreground/60 hover:text-foreground text-[20px] leading-none flex-shrink-0" aria-label="Close">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {recordLoading ? (
                <div className="text-[13px] text-muted-foreground/60 py-12 text-center">Loading…</div>
              ) : !record?.icp ? (
                <p className="text-[13px] text-muted-foreground/70 py-12 text-center">Not scored yet — Nous scores this account once it has enough to go on.</p>
              ) : (() => {
                const cur = record.icp.current;
                const sc = cur.score;
                const col = sc == null ? "#9ca3af" : sc >= 70 ? "#15803d" : sc >= 40 ? "#b45309" : "#b91c1c";
                const fitLabel = sc == null ? "—" : sc >= 70 ? "Strong fit" : sc >= 40 ? "Potential fit" : "Weak fit";
                const outcomeOf = (d: string | null) =>
                  d === "won"  ? { t: "Closed-won",  c: "#15803d", bg: "rgba(21,128,61,0.10)" }
                  : d === "lost" ? { t: "Closed-lost", c: "#b45309", bg: "rgba(180,83,9,0.10)" }
                  : d === "no_opportunity" ? { t: "No deal", c: "#64748b", bg: "rgba(100,116,139,0.10)" }
                  : null;
                const learnNote = (h: IcpRecordRow): string | null => {
                  if (h.disposition === "no_opportunity") return "Never entered a buying motion — excluded from learning.";
                  const L = h.learned;
                  if (!L || L.status === "pending") return "In the training set — the next learning run will use it.";
                  if (L.status === "changed") return `Sharpened the model${L.at ? ` ${formatDistanceToNow(new Date(L.at), { addSuffix: true })}` : ""}${L.detail ? ` — ${L.detail}` : ""}.`;
                  return "In the training set — no model change that run.";
                };
                return (
                  <div className="space-y-6">
                    {/* Current fit — the headline */}
                    <div>
                      <div className="flex items-baseline gap-2.5">
                        <span className="text-[44px] font-semibold tabular-nums leading-none" style={{ color: col }}>{sc ?? "—"}</span>
                        <span className="text-[14px] text-muted-foreground/80">/ 100 · {fitLabel}</span>
                      </div>
                      {cur.reason && (
                        <p className="text-[13px] text-muted-foreground leading-relaxed mt-2">
                          <span className="text-muted-foreground/60">Scored from: </span>{cur.reason}
                        </p>
                      )}
                    </div>
                    {/* Trail — every score and how it resolved, newest first */}
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60 mb-3">Trail</div>
                      <div className="space-y-0">
                        {record.icp.history.map((h, i) => {
                          const oc = outcomeOf(h.disposition);
                          const isCurrent = i === 0;
                          return (
                            <div key={h.id} className="relative pl-5 pb-5 last:pb-0 border-l border-border/70 last:border-l-transparent">
                              <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-background" style={{ background: isCurrent ? col : "#cbd5e1" }} />
                              <div className="flex items-baseline gap-2 flex-wrap">
                                <span className="text-[13px] font-medium text-foreground">
                                  {h.rescored ? "Re-scored" : "Scored"} <span className="tabular-nums font-semibold" style={{ color: h.score == null ? "#9ca3af" : h.score >= 70 ? "#15803d" : h.score >= 40 ? "#b45309" : "#b91c1c" }}>{h.score ?? "—"}</span>
                                </span>
                                <span className="text-[12px] text-muted-foreground/60 tabular-nums">{formatDistanceToNow(new Date(h.scored_at), { addSuffix: true })}</span>
                              </div>
                              {h.reason && i > 0 && (
                                <p className="text-[12px] text-muted-foreground/70 leading-snug mt-0.5">{h.reason}</p>
                              )}
                              {oc && (
                                <div className="mt-2 flex items-baseline gap-2 flex-wrap">
                                  <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-[1px] rounded" style={{ color: oc.c, background: oc.bg }}>{oc.t}</span>
                                  <span className="text-[12px] text-muted-foreground/70">{learnNote(h)}</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ─── Build from closed deals — contrastive lift discovery ─── */}
      {cdOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !cdRunning && setCdOpen(false)}>
          <div className="bg-background border border-border rounded-2xl shadow-xl w-full max-w-[620px] max-h-[88vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <div className="text-[15px] font-semibold text-foreground">Build from your closed deals</div>
              <button onClick={() => !cdRunning && setCdOpen(false)} className="text-muted-foreground/60 hover:text-foreground text-[20px] leading-none" aria-label="Close">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <p className="text-[12.5px] text-muted-foreground leading-relaxed">
                Paste the website domains of accounts you <b>won</b> and ones you <b>lost</b>. We read each site,
                extract signals, and surface what actually separates your winners — by lift, from your own
                outcomes. A few of each is enough to start.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-[#15803d]">Closed-won domains</label>
                  <textarea value={cdWon} onChange={e => setCdWon(e.target.value)} rows={6}
                    placeholder={"acme.com\nglobex.com\n…"}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-foreground/40 resize-y font-mono" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-[#b45309]">Closed-lost domains</label>
                  <textarea value={cdLost} onChange={e => setCdLost(e.target.value)} rows={6}
                    placeholder={"initech.com\numbrella.com\n…"}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-foreground/40 resize-y font-mono" />
                </div>
              </div>
              {cdResult && (
                <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-1.5">Discovered signals · {cdResult.discovered.length} (enriched {cdResult.enriched})</div>
                  {cdResult.discovered.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground/70">No discriminative signals yet — add more deals (especially a clear won/lost split) and run again.</p>
                  ) : (
                    <div className="space-y-1">
                      {cdResult.discovered.map((d, i) => (
                        <div key={i} className="flex items-baseline gap-2 text-[12.5px]">
                          <span className="font-semibold tabular-nums w-8" style={{ color: d.weight >= 0 ? "#15803d" : "#b45309" }}>{d.weight > 0 ? "+" : ""}{d.weight}</span>
                          <span className="flex-1 text-foreground/85">{d.label}</span>
                          <span className="text-[11px] text-muted-foreground/60">{d.note}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-border flex items-center justify-between">
              <button onClick={() => { setCdOpen(false); setCdResult(null); }} className="text-[13px] font-semibold text-foreground/70 hover:text-foreground transition-colors">Close</button>
              <button onClick={runClosedDeals} disabled={cdRunning}
                className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {cdRunning ? "Reading sites & discovering…" : "Discover my signals"}
              </button>
            </div>
          </div>
        </div>
      )}

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

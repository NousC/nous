import { useState, useEffect, useRef, useMemo } from "react";
import { Pause, Play, Zap, Globe2, Activity } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Public /live page — proof-of-aliveness dashboard.
//
// Data: real, fetched from GET /api/public/live/snapshot (cached server-side
// for 2s, polled here every 5s). Between fetches the counter ticks forward
// at the latest opsPerSec rate so motion stays smooth.
//
// Privacy invariant: never renders names, emails, content, raw IDs, workspace
// names, or company names. Event type strings + counts only.
// ─────────────────────────────────────────────────────────────────────────────

const API_URL = import.meta.env.VITE_API_URL ?? "";
const SNAPSHOT_URL = `${API_URL}/api/public/live/snapshot`;
const POLL_MS = 5_000;
const TICK_MS = 120;

interface RecentEvent {
  type: string;
  ts: number;
  inc: number;
}

interface LiveSnapshot {
  totalEver: number;
  opsLast60Min: number;
  opsPerSec: number;
  instancesOnline: number;
  countries: number;
  uptimePct: number;
  recentEventTypes: RecentEvent[];
  generatedAt: number;
}

// ─── Event-type → color group ───────────────────────────────────────────────
// Driven by the event_type prefix coming back from the API. New event types
// fall through to "neutral" (slate) — no harm if backend adds new namespaces.
function groupOf(eventType: string): string {
  const prefix = eventType.split(".")[0];
  switch (prefix) {
    case "memory":     return "text-teal-600 dark:text-teal-400";
    case "agent":      return "text-emerald-600 dark:text-emerald-400";
    case "identity":   return "text-sky-600 dark:text-sky-400";
    case "crm":        return "text-amber-600 dark:text-amber-400";
    case "linkedin":
    case "gmail":
    case "ingest":     return "text-orange-600 dark:text-orange-400";
    case "activity":   return "text-pink-600 dark:text-pink-400";
    case "enrichment": return "text-cyan-600 dark:text-cyan-400";
    case "webhook":    return "text-violet-600 dark:text-violet-400";
    case "sync":       return "text-lime-600 dark:text-lime-400";
    case "scan":
    case "enrichment_run":
    case "scan_complete":
    case "sync_complete":
    case "sync_partial":
    case "sync_failed": return "text-emerald-600 dark:text-emerald-400";
    default:           return "text-slate-600 dark:text-slate-400";
  }
}

// ─── World-map cities for pulse animation ────────────────────────────────────
// Approximate positions on a 1000×500 equirectangular projection.
const CITIES: { x: number; y: number; weight: number }[] = [
  { x: 130, y: 195, weight: 3 }, // SF
  { x: 180, y: 195, weight: 2 }, // LA
  { x: 250, y: 195, weight: 4 }, // NYC
  { x: 220, y: 215, weight: 1 }, // Austin
  { x: 270, y: 195, weight: 2 }, // Toronto
  { x: 270, y: 320, weight: 2 }, // São Paulo
  { x: 470, y: 165, weight: 4 }, // London
  { x: 480, y: 170, weight: 2 }, // Paris
  { x: 500, y: 160, weight: 2 }, // Amsterdam
  { x: 510, y: 165, weight: 2 }, // Berlin
  { x: 600, y: 200, weight: 1 }, // Istanbul
  { x: 640, y: 235, weight: 1 }, // Dubai
  { x: 720, y: 250, weight: 3 }, // Bangalore
  { x: 750, y: 235, weight: 2 }, // Delhi
  { x: 800, y: 235, weight: 2 }, // Shanghai
  { x: 820, y: 220, weight: 2 }, // Seoul
  { x: 860, y: 225, weight: 3 }, // Tokyo
  { x: 780, y: 280, weight: 2 }, // Singapore
  { x: 880, y: 355, weight: 1 }, // Sydney
  { x: 530, y: 300, weight: 1 }, // Nairobi
  { x: 540, y: 330, weight: 1 }, // Cape Town
  { x: 700, y: 195, weight: 1 }, // Moscow
];

// ─── Data hook: poll snapshot, interpolate counter between polls ─────────────
function useLiveSnapshot(paused: boolean) {
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counter, setCounter] = useState<number>(0);
  const [feed, setFeed] = useState<RecentEvent[]>([]);
  const [sparkData, setSparkData] = useState<number[]>([]);
  const [activeCityIdx, setActiveCityIdx] = useState(0);
  const seenTs = useRef<Set<number>>(new Set());

  // Poll the snapshot every POLL_MS while not paused.
  useEffect(() => {
    if (paused) return;
    let cancelled = false;

    const fetchOnce = async () => {
      try {
        const r = await fetch(SNAPSHOT_URL, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data: LiveSnapshot = await r.json();
        if (cancelled) return;
        setSnap(data);
        setError(null);
        setCounter((c) => Math.max(c, data.totalEver));
        setSparkData((s) => [...s.slice(-29), data.opsPerSec]);

        // Merge new events into the feed (newest first, dedup by ts).
        const fresh = data.recentEventTypes.filter((e) => !seenTs.current.has(e.ts));
        if (fresh.length > 0) {
          fresh.forEach((e) => seenTs.current.add(e.ts));
          // keep set bounded
          if (seenTs.current.size > 500) {
            const arr = Array.from(seenTs.current).slice(-200);
            seenTs.current = new Set(arr);
          }
          setFeed((prev) => [...fresh, ...prev].slice(0, 30));
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "fetch_failed");
      }
    };

    fetchOnce();
    const id = window.setInterval(fetchOnce, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [paused]);

  // Tick the counter forward between fetches using the latest opsPerSec.
  // Also rotates the city pulse highlight.
  useEffect(() => {
    if (paused || !snap) return;
    const id = window.setInterval(() => {
      setCounter((c) => c + Math.max(0, snap.opsPerSec) * (TICK_MS / 1000));
      const weighted = CITIES.flatMap((c, i) => Array(c.weight).fill(i));
      if (weighted.length) {
        setActiveCityIdx(weighted[Math.floor(Math.random() * weighted.length)]);
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [paused, snap]);

  return { snap, error, counter, feed, sparkData, activeCityIdx };
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatCounter(n: number, width = 15): string {
  return Math.floor(n)
    .toString()
    .padStart(width, "0")
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

// ─── Sub-components ─────────────────────────────────────────────────────────
function Counter({ value }: { value: number }) {
  return (
    <div className="text-center">
      <div
        className="font-mono text-emerald-600 leading-none tabular-nums tracking-tight break-all"
        style={{
          fontSize: "clamp(2rem, 8vw, 6rem)",
          textShadow: "0 0 18px rgba(16,185,129,0.18)",
        }}
      >
        {formatCounter(value)}
      </div>
      <p className="mt-5 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
        Total operations processed by every Nous instance, ever
      </p>
    </div>
  );
}

function Sparkline({ data, width = 140, height = 36 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(0.01, max - min);
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} className="text-emerald-600">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function StatRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 px-4">
      <div className="flex items-center gap-2.5 text-zinc-500 text-[12px]">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <span className="text-zinc-900 text-[13px] font-mono tabular-nums">{value}</span>
    </div>
  );
}

// ─── World map SVG (simplified continent silhouettes + pulse markers) ──────
function WorldMap({ activeCityIdx }: { activeCityIdx: number }) {
  const [pulses, setPulses] = useState<{ idx: number; key: number }[]>([]);
  const keyRef = useRef(0);
  useEffect(() => {
    keyRef.current += 1;
    const key = keyRef.current;
    setPulses((p) => [...p, { idx: activeCityIdx, key }]);
    const t = window.setTimeout(
      () => setPulses((p) => p.filter((x) => x.key !== key)),
      2200
    );
    return () => window.clearTimeout(t);
  }, [activeCityIdx]);

  return (
    <div className="relative w-full aspect-[2/1] rounded-lg overflow-hidden bg-zinc-50 border border-zinc-200">
      <svg
        viewBox="0 0 1000 500"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 w-full h-full text-zinc-300"
      >
        {/* Simplified continent silhouettes. Approximate but recognizable. */}
        {/* North America */}
        <path
          fill="currentColor"
          d="M105 95 L150 80 L200 88 L245 95 L280 110 L290 145 L285 175 L275 200 L255 220 L240 245 L220 260 L210 285 L195 290 L175 280 L160 260 L145 240 L130 215 L115 185 L108 150 Z"
        />
        {/* Greenland */}
        <path
          fill="currentColor"
          d="M345 75 L395 70 L415 100 L405 125 L375 130 L350 115 L340 95 Z"
        />
        {/* Central America */}
        <path
          fill="currentColor"
          d="M210 285 L240 275 L255 285 L260 305 L245 318 L230 308 L218 298 Z"
        />
        {/* South America */}
        <path
          fill="currentColor"
          d="M255 295 L290 290 L310 310 L320 340 L315 380 L305 410 L290 435 L275 445 L262 430 L255 395 L250 355 L252 325 Z"
        />
        {/* Iceland */}
        <path
          fill="currentColor"
          d="M430 130 L450 128 L455 140 L440 145 L432 138 Z"
        />
        {/* UK + Ireland */}
        <path
          fill="currentColor"
          d="M450 155 L468 152 L470 168 L462 178 L448 175 L445 162 Z"
        />
        {/* Europe / Scandinavia */}
        <path
          fill="currentColor"
          d="M475 140 L510 130 L545 138 L575 158 L580 180 L560 200 L530 207 L495 200 L478 185 L473 165 Z"
        />
        {/* Africa */}
        <path
          fill="currentColor"
          d="M480 215 L530 205 L575 210 L605 230 L615 270 L605 310 L585 350 L560 390 L535 415 L510 410 L495 380 L488 340 L483 300 L478 260 Z"
        />
        {/* Middle East / Arabia */}
        <path
          fill="currentColor"
          d="M610 220 L660 215 L678 245 L665 275 L635 285 L615 270 L608 245 Z"
        />
        {/* Russia / North Asia (very large) */}
        <path
          fill="currentColor"
          d="M555 135 L640 110 L735 105 L830 110 L905 120 L920 145 L915 170 L885 185 L840 195 L795 200 L745 205 L705 205 L660 200 L615 192 L580 180 L562 158 Z"
        />
        {/* China / East Asia */}
        <path
          fill="currentColor"
          d="M700 215 L780 210 L820 225 L825 255 L810 280 L780 290 L735 290 L705 275 L695 245 Z"
        />
        {/* India peninsula */}
        <path
          fill="currentColor"
          d="M695 250 L735 250 L755 280 L745 315 L725 330 L710 320 L702 295 Z"
        />
        {/* SE Asia + Indonesia */}
        <path
          fill="currentColor"
          d="M775 295 L815 290 L840 305 L865 320 L860 345 L825 350 L795 345 L770 330 Z"
        />
        {/* Japan */}
        <path
          fill="currentColor"
          d="M858 195 L878 192 L890 215 L880 240 L865 230 L855 210 Z"
        />
        {/* Philippines */}
        <path
          fill="currentColor"
          d="M830 285 L845 280 L850 305 L838 318 L828 305 Z"
        />
        {/* Australia */}
        <path
          fill="currentColor"
          d="M820 365 L880 355 L920 370 L925 395 L905 420 L860 430 L825 422 L812 395 Z"
        />
        {/* New Zealand */}
        <path
          fill="currentColor"
          d="M930 410 L945 408 L950 425 L935 432 L928 420 Z"
        />
      </svg>

      {/* City base dots (always visible, dim) */}
      {CITIES.map((c, i) => (
        <div
          key={`base-${i}`}
          className="absolute h-1 w-1 rounded-full bg-emerald-500/40"
          style={{
            left: `${(c.x / 1000) * 100}%`,
            top: `${(c.y / 500) * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}

      {/* Active pulses */}
      {pulses.map((p) => {
        const c = CITIES[p.idx];
        if (!c) return null;
        return (
          <div
            key={p.key}
            className="absolute pointer-events-none"
            style={{
              left: `${(c.x / 1000) * 100}%`,
              top: `${(c.y / 500) * 100}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <span className="block h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_2px_rgba(16,185,129,0.55)]" />
            <span className="absolute inset-0 block h-2 w-2 rounded-full bg-emerald-500/40 animate-[live-ping_2s_ease-out_forwards]" />
          </div>
        );
      })}
    </div>
  );
}

function FeedRow({ event }: { event: RecentEvent }) {
  return (
    <div className="grid grid-cols-[110px_1fr_46px] gap-3 px-4 py-1.5 text-[12px] font-mono hover:bg-zinc-50 transition-colors">
      <span className="text-zinc-500 tabular-nums">{fmtTime(event.ts)}</span>
      <span className={groupOf(event.type)}>{event.type}</span>
      <span className="text-zinc-700 text-right tabular-nums">+{event.inc}</span>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────
export default function Live() {
  const [paused, setPaused] = useState(false);
  const { snap, error, counter, feed, sparkData, activeCityIdx } = useLiveSnapshot(paused);

  // Spacebar toggles pause
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Space" && (e.target as HTMLElement)?.tagName !== "INPUT") {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const opsPerSecLabel = useMemo(() => {
    const v = snap?.opsPerSec ?? 0;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
    if (v >= 10) return String(Math.round(v));
    return v.toFixed(1);
  }, [snap?.opsPerSec]);

  return (
    <div className="min-h-screen bg-white text-zinc-900 font-sans overflow-x-hidden">
      <style>{`
        @keyframes live-ping {
          0%   { transform: scale(0.6); opacity: 0.9; }
          100% { transform: scale(4);   opacity: 0;   }
        }
      `}</style>

      {/* ─── Top bar ─────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-zinc-900">
            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" />
            Nous
          </div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
            Global Operations
          </div>
          {/* right side intentionally empty — keeps the centered title balanced */}
          <div className="w-[60px]" aria-hidden />
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-12 overflow-x-hidden">
        {error && !snap && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
            Couldn't reach the live ops endpoint ({error}). Showing the last known state.
          </div>
        )}

        {/* ─── Hero counter ────────────────────────────── */}
        <section className="grid lg:grid-cols-[1fr_240px] items-end gap-6 mb-14">
          <div className="min-w-0">
            <Counter value={counter} />
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-4">
            <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-1">
              Updating live
            </div>
            <div className="text-[11px] text-zinc-700 mb-2">
              {opsPerSecLabel} ops / sec
            </div>
            <Sparkline data={sparkData} />
          </div>
        </section>

        {/* ─── Main grid: feed + stats/map ─────────────── */}
        <section className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
          {/* LEFT — Live feed */}
          <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden min-w-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                <span className={`h-1.5 w-1.5 rounded-full ${paused ? "bg-zinc-400" : "bg-emerald-500 animate-pulse"}`} />
                <span>Live operations feed</span>
              </div>
              <button
                onClick={() => setPaused((p) => !p)}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] text-zinc-600 hover:bg-zinc-100 transition-colors"
                title="Toggle (Space)"
              >
                {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                {paused ? "Resume" : "Pause"}
              </button>
            </div>
            <div className="min-h-[460px]">
              {feed.length === 0 ? (
                <div className="px-4 py-8 text-[12px] text-zinc-400">
                  {snap ? "No ops in the last hour." : "Connecting…"}
                </div>
              ) : (
                feed.map((ev, i) => <FeedRow key={`${ev.ts}-${i}`} event={ev} />)
              )}
            </div>
            <div className="px-4 py-2.5 border-t border-zinc-200 text-[10px] uppercase tracking-[0.18em] text-zinc-400">
              {paused ? "Paused — press space to resume" : "Live · polled every 5s"}
            </div>
          </div>

          {/* RIGHT — Stats + Map */}
          <div className="space-y-6 min-w-0">
            <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-200 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                Global stats
              </div>
              <div className="divide-y divide-zinc-100">
                <StatRow icon={Globe2}   label="Instances online"  value={(snap?.instancesOnline ?? 0).toLocaleString()} />
                <StatRow icon={Zap}      label="Operations / sec"  value={opsPerSecLabel} />
                <StatRow icon={Activity} label="Ops · last 60 min"  value={(snap?.opsLast60Min ?? 0).toLocaleString()} />
                <StatRow icon={Globe2}   label="Countries"         value={String(snap?.countries ?? 0)} />
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-200 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                Live activity by region
              </div>
              <div className="p-4">
                <WorldMap activeCityIdx={activeCityIdx} />
              </div>
            </div>
          </div>
        </section>

        {/* ─── Footer tagline ───────────────────────────── */}
        <footer className="mt-16 pt-8 border-t border-zinc-200 grid sm:grid-cols-3 gap-4 text-[12px] font-mono text-zinc-500">
          <div>&gt; proof the system is alive</div>
          <div>&gt; proof the scale is real</div>
          <div>&gt; proof the agents never stop</div>
        </footer>
      </main>
    </div>
  );
}

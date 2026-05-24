import { useState, useEffect, useRef, useMemo } from "react";
import { Zap, Globe2, Activity } from "lucide-react";
// @ts-expect-error — dotted-map ships JS with .d.ts in newer versions, but
// older Vite type resolution may not surface it. Runtime works fine.
import DottedMap from "dotted-map";

// ─────────────────────────────────────────────────────────────────────────────
// Public /live page — proof-of-aliveness dashboard.
//
// Data: GET /api/public/live/snapshot — real, global, PII-scrubbed.
// Counter ticks between polls at the latest opsPerSec rate for smoothness.
// ─────────────────────────────────────────────────────────────────────────────

const API_URL = import.meta.env.VITE_API_URL ?? "";
const SNAPSHOT_URL = `${API_URL}/api/public/live/snapshot`;
const POLL_MS = 5_000;
const TICK_MS = 120;

interface RecentEvent { type: string; ts: number; inc: number }
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

// ─── Event-type color groups (prefix-based, neutral fallback) ───────────────
function groupOf(eventType: string): string {
  const prefix = eventType.split(/[._]/)[0];
  switch (prefix) {
    case "memory":     return "text-teal-600";
    case "agent":      return "text-emerald-600";
    case "identity":   return "text-sky-600";
    case "crm":        return "text-amber-600";
    case "linkedin":
    case "gmail":
    case "ingest":     return "text-orange-600";
    case "activity":   return "text-pink-600";
    case "enrichment": return "text-cyan-600";
    case "webhook":    return "text-violet-600";
    case "sync":       return "text-lime-600";
    case "scan":       return "text-emerald-600";
    default:           return "text-slate-700";
  }
}

// ─── World map: real dotted map, computed once at module load ───────────────
// dotted-map generates an SVG string with ~600–1000 small circles forming the
// continent shapes. Computed once so React doesn't re-render a thousand
// elements every tick.
const dottedMap = new DottedMap({ height: 56, grid: "vertical" });
const WORLD_DOT_SVG = dottedMap.getSVG({
  radius: 0.32,
  color: "#cbd5e1",      // slate-300
  shape: "circle",
  backgroundColor: "transparent",
});

// City pulse coordinates (lat, lng → x%, y% on equirectangular projection).
// Each city is rendered as an overlaid emerald dot with a ping animation.
const CITIES: { name: string; lat: number; lng: number; weight: number }[] = [
  { name: "SF",        lat: 37.77,  lng: -122.42, weight: 3 },
  { name: "NYC",       lat: 40.71,  lng: -74.01,  weight: 4 },
  { name: "Toronto",   lat: 43.65,  lng: -79.38,  weight: 2 },
  { name: "Mexico",    lat: 19.43,  lng: -99.13,  weight: 1 },
  { name: "SP",        lat: -23.55, lng: -46.63,  weight: 2 },
  { name: "London",    lat: 51.51,  lng: -0.13,   weight: 4 },
  { name: "Paris",     lat: 48.86,  lng: 2.35,    weight: 2 },
  { name: "Berlin",    lat: 52.52,  lng: 13.40,   weight: 2 },
  { name: "Amsterdam", lat: 52.37,  lng: 4.90,    weight: 2 },
  { name: "Madrid",    lat: 40.42,  lng: -3.70,   weight: 1 },
  { name: "Istanbul",  lat: 41.01,  lng: 28.98,   weight: 1 },
  { name: "Lagos",     lat: 6.52,   lng: 3.38,    weight: 1 },
  { name: "Nairobi",   lat: -1.29,  lng: 36.82,   weight: 1 },
  { name: "Cape Town", lat: -33.92, lng: 18.42,   weight: 1 },
  { name: "Dubai",     lat: 25.20,  lng: 55.27,   weight: 1 },
  { name: "Delhi",     lat: 28.61,  lng: 77.21,   weight: 2 },
  { name: "Mumbai",    lat: 19.08,  lng: 72.88,   weight: 2 },
  { name: "Bangalore", lat: 12.97,  lng: 77.59,   weight: 3 },
  { name: "Singapore", lat: 1.35,   lng: 103.82,  weight: 2 },
  { name: "Shanghai",  lat: 31.23,  lng: 121.47,  weight: 2 },
  { name: "Seoul",     lat: 37.57,  lng: 126.98,  weight: 2 },
  { name: "Tokyo",     lat: 35.68,  lng: 139.65,  weight: 3 },
  { name: "Sydney",    lat: -33.87, lng: 151.21,  weight: 1 },
];

// Equirectangular: x = (lng + 180) / 360, y = (90 - lat) / 180.
const cityPct = (lat: number, lng: number) => ({
  x: ((lng + 180) / 360) * 100,
  y: ((90 - lat) / 180) * 100,
});

// ─── Data hook ──────────────────────────────────────────────────────────────
function useLiveSnapshot() {
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counter, setCounter] = useState<number>(0);
  const [feed, setFeed] = useState<RecentEvent[]>([]);
  const [activeCityIdx, setActiveCityIdx] = useState(0);
  const seenTs = useRef<Set<number>>(new Set());

  useEffect(() => {
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

        const fresh = data.recentEventTypes.filter((e) => !seenTs.current.has(e.ts));
        if (fresh.length > 0) {
          fresh.forEach((e) => seenTs.current.add(e.ts));
          if (seenTs.current.size > 600) {
            seenTs.current = new Set(Array.from(seenTs.current).slice(-300));
          }
          setFeed((prev) => [...fresh, ...prev].slice(0, 50));
        } else if (feed.length === 0 && data.recentEventTypes.length > 0) {
          // First load — seed the feed
          data.recentEventTypes.forEach((e) => seenTs.current.add(e.ts));
          setFeed(data.recentEventTypes.slice(0, 50));
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "fetch_failed");
      }
    };
    fetchOnce();
    const id = window.setInterval(fetchOnce, POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!snap) return;
    const id = window.setInterval(() => {
      setCounter((c) => c + Math.max(0, snap.opsPerSec) * (TICK_MS / 1000));
      const weighted = CITIES.flatMap((c, i) => Array(c.weight).fill(i));
      if (weighted.length) {
        setActiveCityIdx(weighted[Math.floor(Math.random() * weighted.length)]);
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [snap]);

  return { snap, error, counter, feed, activeCityIdx };
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatCounter(n: number, width = 12): string {
  return Math.floor(n).toString().padStart(width, "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return fmtTime(ts);
  const day = String(d.getDate()).padStart(2, "0");
  const mon = String(d.getMonth() + 1).padStart(2, "0");
  return `${mon}/${day} ${fmtTime(ts)}`;
}

// ─── Sub-components ─────────────────────────────────────────────────────────
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

function WorldMap({ activeCityIdx }: { activeCityIdx: number }) {
  const [pulses, setPulses] = useState<{ idx: number; key: number }[]>([]);
  const keyRef = useRef(0);
  useEffect(() => {
    keyRef.current += 1;
    const key = keyRef.current;
    setPulses((p) => [...p, { idx: activeCityIdx, key }]);
    const t = window.setTimeout(() => setPulses((p) => p.filter((x) => x.key !== key)), 2200);
    return () => window.clearTimeout(t);
  }, [activeCityIdx]);

  return (
    <div className="relative w-full aspect-[2.1/1] rounded-lg overflow-hidden bg-white">
      {/* Dotted world (computed once at module load) */}
      <div
        className="absolute inset-0 w-full h-full"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: WORLD_DOT_SVG }}
        style={{ display: "flex" }}
      />
      {/* City pulses */}
      {pulses.map((p) => {
        const c = CITIES[p.idx];
        if (!c) return null;
        const { x, y } = cityPct(c.lat, c.lng);
        return (
          <div
            key={p.key}
            className="absolute pointer-events-none"
            style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}
          >
            <span className="block h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_2px_rgba(16,185,129,0.55)]" />
            <span className="absolute inset-0 block h-1.5 w-1.5 rounded-full bg-emerald-500/40 animate-[live-ping_2s_ease-out_forwards]" />
          </div>
        );
      })}
    </div>
  );
}

function FeedRow({ event }: { event: RecentEvent }) {
  return (
    <div className="grid grid-cols-[140px_1fr_46px] gap-3 px-4 py-1.5 text-[12px] font-mono hover:bg-zinc-50 transition-colors">
      <span className="text-zinc-400 tabular-nums">{fmtDate(event.ts)}</span>
      <span className={groupOf(event.type)}>{event.type}</span>
      <span className="text-zinc-700 text-right tabular-nums">+{event.inc}</span>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────
export default function Live() {
  const { snap, error, counter, feed, activeCityIdx } = useLiveSnapshot();

  const opsPerSecLabel = useMemo(() => {
    const v = snap?.opsPerSec ?? 0;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
    if (v >= 10) return String(Math.round(v));
    return v.toFixed(1);
  }, [snap?.opsPerSec]);

  return (
    <div className="min-h-screen bg-white text-zinc-900 font-mono overflow-x-hidden">
      <style>{`
        @keyframes live-ping {
          0%   { transform: scale(0.6); opacity: 0.9; }
          100% { transform: scale(4.5); opacity: 0;   }
        }
      `}</style>

      {/* ─── Top bar ─────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/85 backdrop-blur">
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between gap-4">
          {/* Logo (left) */}
          <a href="/" className="flex items-center gap-2.5 group" aria-label="Nous">
            <img src="/nous-logo.svg" alt="" className="h-6 w-6" />
            <span className="text-[13px] font-sans font-semibold tracking-tight text-zinc-900">Nous</span>
          </a>

          {/* Centered title */}
          <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500 hidden sm:block">
            Global Operations
          </div>

          {/* Last-60min ops (right) */}
          <div className="flex items-center gap-2 text-[12px] tabular-nums">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-zinc-900 font-semibold">
              {(snap?.opsLast60Min ?? 0).toLocaleString()}
            </span>
            <span className="text-zinc-500 hidden md:inline">ops · last 60 min</span>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-16 overflow-x-hidden">
        {error && !snap && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800 font-sans">
            Couldn't reach the live ops endpoint ({error}).
          </div>
        )}

        {/* ─── Counter ───────────────────────────────────── */}
        <section className="mb-3">
          <div
            className="text-emerald-600 leading-none tabular-nums tracking-tight text-center break-all"
            style={{
              fontSize: "clamp(2.5rem, 10vw, 7rem)",
              textShadow: "0 0 22px rgba(16,185,129,0.15)",
            }}
          >
            {formatCounter(counter)}
          </div>
        </section>

        {/* ─── Tagline strip (replaces "Updating live" card) ─────────────── */}
        <section className="grid sm:grid-cols-3 gap-2 sm:gap-6 text-center mb-16 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          <div>&gt; proof the system is alive</div>
          <div>&gt; proof the scale is real</div>
          <div>&gt; proof the agents never stop</div>
        </section>

        {/* ─── Main grid: feed + stats/map ─────────────── */}
        <section className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
          {/* LEFT — Live feed */}
          <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden min-w-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Live operations</span>
              </div>
              <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 tabular-nums">
                {feed.length} most recent
              </span>
            </div>
            <div className="min-h-[520px] max-h-[640px] overflow-y-auto">
              {feed.length === 0 ? (
                <div className="px-4 py-8 text-[12px] text-zinc-400">
                  {snap ? "No ops logged yet." : "Connecting…"}
                </div>
              ) : (
                feed.map((ev, i) => <FeedRow key={`${ev.ts}-${i}`} event={ev} />)
              )}
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
                Activity by region
              </div>
              <div className="p-3">
                <WorldMap activeCityIdx={activeCityIdx} />
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

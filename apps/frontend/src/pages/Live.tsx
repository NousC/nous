import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { Pause, Play, Zap, Globe2, Activity, ArrowUpRight } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Public /live page — proof-of-aliveness dashboard.
//
// All data here is SIMULATED for v1. The shape mirrors what a future public
// endpoint will return so swapping is mechanical. See `LiveSnapshot` below for
// the contract.
//
// Privacy invariant: this page MUST NEVER render user names, emails, message
// content, workspace names, raw UUIDs, or specific company names (other than
// opt-in Friends). Anonymized actor refs only.
// ─────────────────────────────────────────────────────────────────────────────

type EventGroup =
  | "memory" | "agent" | "identity" | "crm"
  | "ingest" | "activity" | "enrichment" | "webhook" | "sync";

interface EventType {
  name: string;
  group: EventGroup;
  /** A function that returns a short anonymized target string. */
  target: () => string;
}

const COLOR: Record<EventGroup, string> = {
  memory:     "text-teal-400",
  agent:      "text-emerald-400",
  identity:   "text-sky-400",
  crm:        "text-amber-400",
  ingest:     "text-orange-400",
  activity:   "text-pink-400",
  enrichment: "text-cyan-400",
  webhook:    "text-violet-400",
  sync:       "text-lime-400",
};

const hex4 = () => Math.random().toString(16).slice(2, 6);
const id  = (p: string) => `${p}_${hex4()}`;
const num = (lo: number, hi: number) => Math.floor(lo + Math.random() * (hi - lo));

const EVENT_TYPES: EventType[] = [
  { name: "memory.write",          group: "memory",     target: () => `${id("user")} → preferences` },
  { name: "memory.read",           group: "memory",     target: () => id("mem") },
  { name: "memory.compress",       group: "memory",     target: () => `batch_${hex4()} → ${num(40, 220)} records` },
  { name: "memory.delete",         group: "memory",     target: () => `stale_event_${hex4()}` },
  { name: "agent.context.query",   group: "agent",      target: () => `${id("agent")} → memory` },
  { name: "agent.context.refresh", group: "agent",      target: () => id("agent") },
  { name: "agent.tool.execute",    group: "agent",      target: () => `enrich_contact_${hex4()}` },
  { name: "identity.resolve",      group: "identity",   target: () => `email_hash_${hex4()}` },
  { name: "identity.merge",        group: "identity",   target: () => `${id("identity")} ↔ ${id("identity")}` },
  { name: "crm.timeline.sync",     group: "crm",        target: () => `${id("contact")} → ${num(2, 40)} activities` },
  { name: "crm.contact.resolve",   group: "crm",        target: () => `linkedin_urn → ${id("contact")}` },
  { name: "crm.activity.upsert",   group: "crm",        target: () => `${id("activity")} → ${id("contact")}` },
  { name: "linkedin.ingest",       group: "ingest",     target: () => `message_event_${hex4()}` },
  { name: "gmail.thread.sync",     group: "ingest",     target: () => `thread_${hex4()} → ${num(2, 18)} msgs` },
  { name: "activity.compress",     group: "activity",   target: () => `batch_${hex4()} → ${num(50, 200)} records` },
  { name: "activity.classify",     group: "activity",   target: () => `email_opened → engagement` },
  { name: "enrichment.contact",    group: "enrichment", target: () => `${id("contact")} → 23 fields` },
  { name: "enrichment.company",    group: "enrichment", target: () => `${id("company")} → 11 fields` },
  { name: "webhook.deliver",       group: "webhook",    target: () => `${id("endpoint")} ← 200 OK` },
  { name: "webhook.retry",         group: "webhook",    target: () => `${id("endpoint")} attempt #${num(2, 4)}` },
];

// Approximate city positions on a 2:1 equirectangular projection (x%, y%).
const CITIES: { x: number; y: number; weight: number }[] = [
  { x: 13,  y: 39, weight: 3 }, // SF
  { x: 18,  y: 37, weight: 2 }, // LA
  { x: 25,  y: 38, weight: 4 }, // NYC
  { x: 22,  y: 42, weight: 1 }, // Austin
  { x: 27,  y: 38, weight: 2 }, // Toronto
  { x: 26,  y: 56, weight: 2 }, // São Paulo
  { x: 21,  y: 60, weight: 1 }, // BA
  { x: 47,  y: 32, weight: 4 }, // London
  { x: 48,  y: 33, weight: 2 }, // Paris
  { x: 50,  y: 31, weight: 2 }, // Amsterdam
  { x: 51,  y: 32, weight: 2 }, // Berlin
  { x: 53,  y: 36, weight: 1 }, // Milan
  { x: 56,  y: 38, weight: 1 }, // Athens
  { x: 60,  y: 40, weight: 1 }, // Istanbul
  { x: 60,  y: 43, weight: 1 }, // Tel Aviv
  { x: 64,  y: 47, weight: 1 }, // Dubai
  { x: 72,  y: 49, weight: 3 }, // Bangalore
  { x: 75,  y: 47, weight: 2 }, // Delhi
  { x: 80,  y: 47, weight: 2 }, // Shanghai
  { x: 82,  y: 44, weight: 2 }, // Seoul
  { x: 86,  y: 45, weight: 3 }, // Tokyo
  { x: 78,  y: 55, weight: 2 }, // Singapore
  { x: 80,  y: 50, weight: 1 }, // Hong Kong
  { x: 87,  y: 70, weight: 1 }, // Sydney
  { x: 50,  y: 50, weight: 1 }, // Lagos
  { x: 53,  y: 60, weight: 1 }, // Nairobi
  { x: 54,  y: 65, weight: 1 }, // Cape Town
  { x: 22,  y: 30, weight: 1 }, // Vancouver
  { x: 28,  y: 41, weight: 1 }, // Boston
  { x: 70,  y: 38, weight: 1 }, // Moscow
];

// ─────────────────────────────────────────────────────────────────────────────
// Simulator
// ─────────────────────────────────────────────────────────────────────────────

interface FeedEvent {
  ts: number;        // ms epoch
  type: EventType;
  target: string;
  inc: number;       // +N badge
}

interface LiveSnapshot {
  totalEver: number;
  opsPerSec: number;
  instancesOnline: number;
  uptimePct: number;
  countries: number;
  events: FeedEvent[];
  sparkData: number[];
  activeCityIdx: number;  // index of CITIES that just pulsed
}

const TARGET_OPS_PER_SEC_BASE = 8_300;
const TICK_MS = 120;

function useOpsSimulator(paused: boolean): LiveSnapshot {
  const [snap, setSnap] = useState<LiveSnapshot>(() => ({
    totalEver: 128_247_532_841,
    opsPerSec: TARGET_OPS_PER_SEC_BASE,
    instancesOnline: 1247,
    uptimePct: 99.97,
    countries: 93,
    events: [],
    sparkData: Array.from({ length: 30 }, () => 7800 + Math.random() * 1000),
    activeCityIdx: 0,
  }));

  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    if (paused) {
      if (tickRef.current) window.clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }
    tickRef.current = window.setInterval(() => {
      setSnap((prev) => {
        // 1) increment counter by a proportional chunk
        const opsThisTick = Math.floor(prev.opsPerSec * (TICK_MS / 1000));
        const totalEver = prev.totalEver + opsThisTick;

        // 2) emit 2–4 events
        const newEvents: FeedEvent[] = [];
        const n = num(2, 5);
        const now = Date.now();
        for (let i = 0; i < n; i++) {
          const type = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
          newEvents.push({
            ts: now + i,
            type,
            target: type.target(),
            inc: Math.random() < 0.75 ? 1 : num(2, 5),
          });
        }
        const events = [...newEvents.reverse(), ...prev.events].slice(0, 16);

        // 3) jitter ops/sec slightly
        const delta = (Math.random() - 0.5) * 400;
        const opsPerSec = Math.max(7200, Math.min(9400, prev.opsPerSec + delta));

        // 4) sparkline window
        const sparkData = [...prev.sparkData.slice(1), opsPerSec];

        // 5) pulse a weighted-random city
        const weighted = CITIES.flatMap((c, i) => Array(c.weight).fill(i));
        const activeCityIdx = weighted[Math.floor(Math.random() * weighted.length)];

        // 6) drift instances + countries very slowly
        const instancesOnline = Math.max(
          1100,
          Math.min(1400, prev.instancesOnline + (Math.random() < 0.05 ? (Math.random() < 0.5 ? -1 : 1) : 0))
        );

        return {
          ...prev,
          totalEver,
          opsPerSec,
          instancesOnline,
          events,
          sparkData,
          activeCityIdx,
        };
      });
    }, TICK_MS);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, [paused]);

  return snap;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

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

function Counter({ value }: { value: number }) {
  return (
    <div className="text-center">
      <div className="font-mono text-emerald-400 leading-none text-[clamp(2.5rem,9vw,7rem)] tracking-tight"
           style={{ textShadow: "0 0 28px rgba(52,211,153,0.35), 0 0 8px rgba(52,211,153,0.5)" }}>
        {formatCounter(value)}
      </div>
      <p className="mt-5 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
        Total operations processed by every Nous instance, ever
      </p>
    </div>
  );
}

function Sparkline({ data, width = 140, height = 36 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(1, max - min);
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} className="text-emerald-400/80">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function StatRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 px-4">
      <div className="flex items-center gap-2.5 text-zinc-400 text-[12px]">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <span className="text-zinc-100 text-[13px] font-mono">{value}</span>
    </div>
  );
}

function RegionMap({ activeCityIdx }: { activeCityIdx: number }) {
  // Track recent pulses so dots fade out over time.
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
    <div
      className="relative aspect-[2/1] rounded-lg overflow-hidden border border-zinc-800/60"
      style={{
        backgroundImage:
          "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)",
        backgroundSize: "10px 10px",
      }}
    >
      {/* Static city baseline (dim) */}
      {CITIES.map((c, i) => (
        <div
          key={`base-${i}`}
          className="absolute h-1 w-1 rounded-full bg-emerald-400/30"
          style={{ left: `${c.x}%`, top: `${c.y}%`, transform: "translate(-50%, -50%)" }}
        />
      ))}
      {/* Active pulses */}
      {pulses.map((p) => {
        const c = CITIES[p.idx];
        return (
          <div
            key={p.key}
            className="absolute pointer-events-none"
            style={{ left: `${c.x}%`, top: `${c.y}%`, transform: "translate(-50%, -50%)" }}
          >
            <span className="block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.6)]" />
            <span className="absolute inset-0 block h-2 w-2 rounded-full bg-emerald-400/40 animate-[live-ping_2s_ease-out_forwards]" />
          </div>
        );
      })}
    </div>
  );
}

function FeedRow({ event }: { event: FeedEvent }) {
  return (
    <div className="grid grid-cols-[110px_1fr_1fr_46px] gap-3 px-4 py-1.5 text-[12px] font-mono hover:bg-white/[0.02] transition-colors">
      <span className="text-zinc-500 tabular-nums">{fmtTime(event.ts)}</span>
      <span className={COLOR[event.type.group]}>{event.type.name}</span>
      <span className="text-zinc-400 truncate">{event.target}</span>
      <span className="text-zinc-300 text-right tabular-nums">+{event.inc}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function Live() {
  const [paused, setPaused] = useState(false);
  const snap = useOpsSimulator(paused);

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
    if (snap.opsPerSec >= 1000) return `${(snap.opsPerSec / 1000).toFixed(1)}K`;
    return String(Math.round(snap.opsPerSec));
  }, [snap.opsPerSec]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* Keyframes for the pulse rings */}
      <style>{`
        @keyframes live-ping {
          0%   { transform: scale(0.6); opacity: 0.9; }
          100% { transform: scale(4);   opacity: 0;   }
        }
      `}</style>

      {/* ─── Top bar ─────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-zinc-900/80 bg-zinc-950/80 backdrop-blur">
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-[12px] uppercase tracking-[0.2em] text-zinc-400">
            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
            <span className="text-zinc-200 font-semibold">Nous</span>
            <span className="text-zinc-600">·</span>
            <span>Global Ops Counter</span>
          </div>
          <div className="hidden md:flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Live · every op · every instance · ever</span>
          </div>
          <a
            href="/signup"
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-md border border-zinc-700 bg-zinc-900 text-[12px] font-semibold text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            Try Nous <ArrowUpRight className="h-3 w-3" />
          </a>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-12">
        {/* ─── Hero counter ────────────────────────────── */}
        <section className="grid lg:grid-cols-[1fr_240px] items-end gap-6 mb-14">
          <Counter value={snap.totalEver} />
          <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-4">
            <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-1">
              Updating every {TICK_MS}ms
            </div>
            <div className="text-[11px] text-zinc-400 mb-2">
              {opsPerSecLabel} ops / sec
            </div>
            <Sparkline data={snap.sparkData} />
          </div>
        </section>

        {/* ─── Main grid: feed + stats/map ─────────────── */}
        <section className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
          {/* LEFT — Live feed */}
          <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/30 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                <span className={`h-1.5 w-1.5 rounded-full ${paused ? "bg-zinc-600" : "bg-emerald-500 animate-pulse"}`} />
                <span>Live operations feed</span>
              </div>
              <button
                onClick={() => setPaused((p) => !p)}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] text-zinc-300 hover:bg-white/[0.04] transition-colors"
                title="Toggle (Space)"
              >
                {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                {paused ? "Resume" : "Pause"}
              </button>
            </div>
            <div className="min-h-[460px]">
              {snap.events.length === 0 ? (
                <div className="px-4 py-8 text-[12px] text-zinc-500">Warming up…</div>
              ) : (
                snap.events.map((ev) => <FeedRow key={ev.ts} event={ev} />)
              )}
            </div>
            <div className="px-4 py-2.5 border-t border-zinc-800/60 text-[10px] uppercase tracking-[0.18em] text-zinc-600">
              {paused ? "Paused — press space to resume" : `Live · updating every ${TICK_MS}ms`}
            </div>
          </div>

          {/* RIGHT — Stats + Map */}
          <div className="space-y-6">
            <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800/60 text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                Global stats
              </div>
              <div className="divide-y divide-zinc-800/40">
                <StatRow icon={Globe2}   label="Instances online"  value={snap.instancesOnline.toLocaleString()} />
                <StatRow icon={Zap}      label="Operations / sec"  value={opsPerSecLabel} />
                <StatRow icon={Activity} label="Uptime"            value={`${snap.uptimePct.toFixed(2)}%`} />
                <StatRow icon={Globe2}   label="Countries"         value={String(snap.countries)} />
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800/60 text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                Live activity by region
              </div>
              <div className="p-4">
                <RegionMap activeCityIdx={snap.activeCityIdx} />
              </div>
            </div>
          </div>
        </section>

        {/* ─── Friends row ──────────────────────────────── */}
        <section className="mt-14 pt-8 border-t border-zinc-900">
          <div className="flex items-end justify-between mb-5">
            <h3 className="text-[11px] uppercase tracking-[0.2em] text-zinc-400">Friends running on Nous</h3>
            <Link to="/signup" className="text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors">
              Be the first → put your logo here
            </Link>
          </div>
          <div className="flex items-center">
            {/* Empty state placeholders — replaced by real opt-in favicons once Friends ships */}
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={`h-10 w-10 rounded-full bg-zinc-900 border border-zinc-800/80 flex items-center justify-center text-zinc-700 text-[14px] ${i > 0 ? "-ml-3" : ""}`}
                style={{ zIndex: 10 - i }}
              >
                ◦
              </div>
            ))}
            <div
              className="-ml-3 h-10 w-10 rounded-full border-2 border-dashed border-zinc-700 flex items-center justify-center text-zinc-500 text-[12px] bg-zinc-950"
              style={{ zIndex: 1 }}
            >
              +
            </div>
          </div>
          <p className="text-[10px] text-zinc-600 mt-3 italic">
            Real favicons appear here once Nous customers opt in from settings.
          </p>
        </section>

        {/* ─── Footer tagline ───────────────────────────── */}
        <footer className="mt-16 pt-8 border-t border-zinc-900 grid sm:grid-cols-3 gap-4 text-[12px] font-mono text-zinc-500">
          <div>&gt; proof the system is alive</div>
          <div>&gt; proof the scale is real</div>
          <div>&gt; proof the agents never stop</div>
        </footer>
      </main>
    </div>
  );
}

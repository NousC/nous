import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useAuth } from "@/contexts/AuthContext";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

// The Galaxy — the workspace's context graph rendered as a shareable constellation.
// It is the SAME graph the agents traverse (people, companies, the topics they care
// about, and the works_at / champions edges between them), drawn the way Obsidian
// draws a vault: account-stars in a connected core, a halo of cold leads around it,
// and colour as a heartbeat. Anonymous by construction — the API never sends names —
// so "Share mode" produces a clean, postable artifact.

type GNode = {
  id: string;
  t: "person" | "company" | "topic";
  score: number | null;
  tier: string | null;
  age: number | null;        // days since last activity, null = dormant
  label?: string;            // topics only (not PII)
  // force-graph mutates these in place:
  x?: number; y?: number; vx?: number; vy?: number;
  deg?: number; r?: number;
};
type GLink = { source: any; target: any; k: "works_at" | "topic" };

// palette ---------------------------------------------------------------------
const BG = "#070809";
const COL = {
  bg: BG,
  personDormant: "#454c5e",
  companyDormant: "#6b7689",
  alive: "#37d67a",              // recent activity
  aging: "#2f7a55",              // active-ish, fading
  hot: "#f6c451",                // tier-1 / 85+ and alive  → glows gold
  topic: "#7b80ff",              // concept hubs, kept faint
};

function nodeColor(n: GNode): string {
  if (n.t === "topic") return COL.topic;
  const dormant = n.t === "company" ? COL.companyDormant : COL.personDormant;
  if (n.age == null) return dormant;
  const hot = (n.tier === "tier_1") || (n.score != null && n.score >= 85);
  if (hot && n.age <= 30) return COL.hot;
  if (n.age <= 21) return COL.alive;
  if (n.age <= 60) return COL.aging;
  return dormant;
}

export default function Galaxy() {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";

  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const [data, setData] = useState<{ nodes: GNode[]; links: GLink[] } | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [share, setShare] = useState(false);     // clean mode for screenshots

  // size to container
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDims({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // fetch the snapshot
  useEffect(() => {
    if (!token || !workspaceId) return;
    let alive = true;
    setLoading(true);
    fetch(`${apiUrl}/api/graph?workspaceId=${workspaceId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j)))
      .then((j) => {
        if (!alive) return;
        const nodes: GNode[] = j.nodes;
        const deg: Record<string, number> = {};
        for (const e of j.edges) { deg[e.s] = (deg[e.s] || 0) + 1; deg[e.t] = (deg[e.t] || 0) + 1; }
        for (const n of nodes) {
          n.deg = deg[n.id] || 0;
          // radius: connectivity = how much context accumulated. companies & topics
          // that many things point at become the hub starbursts.
          const base = n.t === "company" ? 2.4 : n.t === "topic" ? 1.4 : 1.6;
          n.r = base + Math.sqrt(n.deg) * (n.t === "topic" ? 0.7 : 1.1);
        }
        const links: GLink[] = j.edges.map((e: any) => ({ source: e.s, target: e.t, k: e.k }));
        setData({ nodes, links });
        setMeta(j.meta);
        setLoading(false);
      })
      .catch((e) => { if (alive) { setErr(e?.error || "failed_to_load"); setLoading(false); } });
    return () => { alive = false; };
  }, [token, workspaceId]);

  // physics: tight account-stars, looser topic links, strong separation so the
  // core breathes and the orphans fan out into a halo.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !data) return;
    fg.d3Force("charge")?.strength(-26).distanceMax(420);
    fg.d3Force("link")?.distance((l: GLink) => (l.k === "works_at" ? 26 : 52)).strength(0.6);
    try { fg.d3Force("center")?.strength(0.04); } catch { /* noop */ }
    fg.d3ReheatSimulation?.();
  }, [data]);

  const draw = useCallback((node: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
    const r = node.r || 2;
    const color = nodeColor(node);
    const x = node.x!, y = node.y!;
    const lit = color === COL.hot || color === COL.alive;
    // glow for the living nodes — this is what makes the galaxy feel alive
    if (lit) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
      g.addColorStop(0, color === COL.hot ? "rgba(246,196,81,0.55)" : "rgba(55,214,122,0.45)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * 4, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.globalAlpha = node.t === "topic" ? 0.7 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    // hub ring on the big company stars
    if (node.t === "company" && (node.deg || 0) >= 3) {
      ctx.lineWidth = 0.6 / scale;
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.stroke();
    }
  }, []);

  const downloadPng = useCallback(() => {
    const cv = wrapRef.current?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!cv) return;
    // paint the dark bg behind (canvas itself is transparent) for a clean card
    const out = document.createElement("canvas");
    out.width = cv.width; out.height = cv.height;
    const c = out.getContext("2d")!;
    c.fillStyle = BG; c.fillRect(0, 0, out.width, out.height);
    c.drawImage(cv, 0, 0);
    // watermark
    c.font = `${Math.round(out.height * 0.022)}px ui-sans-serif, system-ui, sans-serif`;
    c.fillStyle = "rgba(255,255,255,0.4)";
    c.textAlign = "right";
    c.fillText("nous · context graph", out.width - 28, out.height - 22);
    const a = document.createElement("a");
    a.download = "nous-context-graph.png";
    a.href = out.toDataURL("image/png");
    a.click();
  }, []);

  return (
    <div ref={wrapRef} className="relative h-[calc(100vh-0px)] w-full overflow-hidden" style={{ background: BG }}>
      {/* chrome — hidden in share mode for a clean screenshot */}
      {!share && (
        <div className="absolute left-5 top-5 z-10 select-none">
          <div className="text-sm font-medium tracking-tight text-white/90">Context Graph</div>
          {meta && (
            <div className="mt-0.5 text-[11px] text-white/40">
              {meta.people} people · {meta.companies} companies · {meta.topics} topics · {meta.edges} links
            </div>
          )}
          <div className="mt-3 flex flex-col gap-1 text-[10px] text-white/35">
            <Legend c={COL.hot} t="hot · tier-1 & active" />
            <Legend c={COL.alive} t="active recently" />
            <Legend c={COL.personDormant} t="dormant" />
            <Legend c={COL.topic} t="topic / theme" />
          </div>
        </div>
      )}

      <div className="absolute right-5 top-5 z-10 flex items-center gap-2">
        <button
          onClick={() => setShare(s => !s)}
          className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/70 backdrop-blur hover:bg-white/10"
        >
          {share ? "Exit share mode" : "Share mode"}
        </button>
        <button
          onClick={downloadPng}
          className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/70 backdrop-blur hover:bg-white/10"
        >
          Download PNG
        </button>
      </div>

      {/* watermark — always on, so a screenshot answers "what is that?" */}
      <div className="pointer-events-none absolute bottom-4 right-6 z-10 text-[11px] font-medium tracking-tight text-white/30 select-none">
        nous · context graph
      </div>

      {loading && <Center>building your galaxy…</Center>}
      {err && <Center>could not load the graph ({err})</Center>}

      {data && (
        <ForceGraph2D
          ref={fgRef}
          width={dims.w}
          height={dims.h}
          graphData={data}
          backgroundColor={BG}
          nodeRelSize={1}
          nodeVal={(n: any) => (n.r || 1)}
          nodeCanvasObject={draw as any}
          nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(node.x, node.y, (node.r || 2) + 1.5, 0, 2 * Math.PI); ctx.fill();
          }}
          nodeLabel={(n: any) => share ? "" : (
            n.t === "topic" ? `theme · ${n.label}` :
            `${n.t}${n.score != null ? ` · ICP ${n.score}` : ""}${n.age != null ? ` · active ${n.age}d ago` : " · dormant"}`
          )}
          linkColor={(l: any) => l.k === "works_at" ? "rgba(150,170,205,0.16)" : "rgba(124,128,255,0.08)"}
          linkWidth={(l: any) => l.k === "works_at" ? 0.5 : 0.4}
          enableNodeDrag={false}
          cooldownTicks={180}
          warmupTicks={40}
          onEngineStop={() => { /* settled */ }}
        />
      )}
    </div>
  );
}

function Legend({ c, t }: { c: string; t: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />
      <span>{t}</span>
    </div>
  );
}
function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-0 flex items-center justify-center text-sm text-white/40">{children}</div>
  );
}

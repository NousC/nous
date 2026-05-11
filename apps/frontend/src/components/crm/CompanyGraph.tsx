import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { Loader2 } from "lucide-react";

// ─── Image cache (module-level, survives re-renders) ──────────────────────────
const IMG = new Map<string, HTMLImageElement | "loading" | "failed">();

function preload(src: string): void {
  if (!src || IMG.has(src)) return;
  IMG.set(src, "loading");
  const img = new window.Image();
  // Do NOT set crossOrigin — Google favicon API and most CDNs don't send CORS headers,
  // which would cause the image to fail entirely. We only ever draw to canvas (never
  // read pixels back), so a "tainted" canvas is perfectly acceptable here.
  img.onload  = () => IMG.set(src, img);
  img.onerror = () => IMG.set(src, "failed");
  img.src = src;
}
function getImg(src: string): HTMLImageElement | null {
  const v = IMG.get(src);
  return v instanceof HTMLImageElement ? v : null;
}
function faviconUrl(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG     = "#FFFFFF";       // canvas background
const V      = "#7C3AED";       // violet
const GREEN  = "#16A34A";       // green  (private signal)
const AMBER  = "#D97706";       // amber  (public signal)
const CYAN   = "#06B6D4";       // terminal cyan (memory card accent)
const TEXT   = "#18181B";       // dark text on light
const MUTED  = "#71717A";
const NODE_D = "#FFFFFF";       // node fill (white)

const va = (a: number) => `rgba(109,40,217,${a})`;
const ga = (a: number) => `rgba(22,163,74,${a})`;
const aa = (a: number) => `rgba(217,119,6,${a})`;

const STAGE: Record<string, string> = {
  identified: "#71717A",
  aware:      "#F59E0B",
  interested: "#FB923C",
  evaluating: "#8B5CF6",
  client:     "#22C55E",
};

const PROVIDER_LOGO: Record<string, string> = {
  rb2b:      "/provider-logos/rb2b.svg",
  linkedin:  "/provider-logos/linkedin.png",
  gmail:     "/provider-logos/gmail.svg",
  instantly: "/provider-logos/instantly.svg",
  fireflies: "/provider-logos/fireflies.svg",
  apollo:    "/provider-logos/apollo.svg",
  hubspot:   "/provider-logos/hubspot.svg",
  pipedrive: "/provider-logos/pipedrive.svg",
  slack:     "/provider-logos/slack.svg",
  notion:    "/provider-logos/notion.svg",
  anthropic: "/provider-logos/anthropic.svg",
  claude:    "/provider-logos/claude.svg",
};

const PROVIDER_SHORT: Record<string, string> = {
  rb2b: "RB2B", linkedin: "LI", gmail: "GM", instantly: "IN",
  fireflies: "FF", apollo: "AP", hubspot: "HS", pipedrive: "PD",
  slack: "SL", notion: "NO", proply: "PR", manual: "—",
};

const PUBLIC_SIGNALS = new Set([
  "website_visit","page_view","email_opened","linkedin_view",
  "social_engagement","ad_impression","newsletter_signup","website_revisit",
]);

// ─── Activity-type icons (drawn on canvas for agent/unknown sources) ──────────
function drawActivityIcon(
  ctx: CanvasRenderingContext2D,
  at: string,
  x: number, y: number,
  nodeRadius: number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.fillStyle   = color;
  ctx.lineWidth   = Math.max(0.5, nodeRadius * 0.08);
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";

  const s = nodeRadius * 0.38;

  if (at.includes("email")) {
    // Envelope: rect + V-chevron at top
    const hw = s, hh = s * 0.8;
    ctx.strokeRect(x - hw, y - hh / 2, hw * 2, hh * 1.4);
    ctx.beginPath();
    ctx.moveTo(x - hw, y - hh / 2);
    ctx.lineTo(x, y + hh * 0.25);
    ctx.lineTo(x + hw, y - hh / 2);
    ctx.stroke();
  } else if (at.includes("meeting") || at.includes("demo") || at.includes("call")) {
    // Calendar: rect + header divider + two tab lines
    const w = s * 1.4, h = s * 1.3, top = y - h / 2 + s * 0.2;
    ctx.strokeRect(x - w / 2, top, w, h);
    ctx.beginPath();
    ctx.moveTo(x - w / 2, top + s * 0.45);
    ctx.lineTo(x + w / 2, top + s * 0.45);
    ctx.moveTo(x - w * 0.22, top);
    ctx.lineTo(x - w * 0.22, top - s * 0.38);
    ctx.moveTo(x + w * 0.22, top);
    ctx.lineTo(x + w * 0.22, top - s * 0.38);
    ctx.stroke();
  } else if (at.includes("visit") || at.includes("page") || at.includes("view")) {
    // Eye: two quadratic curves + filled pupil
    ctx.beginPath();
    ctx.moveTo(x - s, y);
    ctx.quadraticCurveTo(x, y - s * 0.9, x + s, y);
    ctx.quadraticCurveTo(x, y + s * 0.9, x - s, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, s * 0.28, 0, Math.PI * 2);
    ctx.fill();
  } else if (at.includes("proposal") || at.includes("document") || at.includes("sign")) {
    // Document: rect with folded corner + two text lines
    const dw = s * 1.1, dh = s * 1.4, fold = s * 0.38;
    ctx.beginPath();
    ctx.moveTo(x - dw / 2, y - dh / 2);
    ctx.lineTo(x + dw / 2 - fold, y - dh / 2);
    ctx.lineTo(x + dw / 2, y - dh / 2 + fold);
    ctx.lineTo(x + dw / 2, y + dh / 2);
    ctx.lineTo(x - dw / 2, y + dh / 2);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - dw / 2 + s * 0.25, y - s * 0.1);
    ctx.lineTo(x + dw / 2 - s * 0.25, y - s * 0.1);
    ctx.moveTo(x - dw / 2 + s * 0.25, y + s * 0.4);
    ctx.lineTo(x + dw / 2 - s * 0.5,  y + s * 0.4);
    ctx.stroke();
  } else {
    // Default / agent — cross with center dot (sparkle)
    ctx.beginPath();
    ctx.moveTo(x, y - s * 0.75); ctx.lineTo(x, y + s * 0.75);
    ctx.moveTo(x - s * 0.75, y); ctx.lineTo(x + s * 0.75, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── Canvas helper ────────────────────────────────────────────────────────────
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ─── Types ────────────────────────────────────────────────────────────────────
type NodeType = "company" | "contact" | "signal" | "memory";

interface GNode {
  id: string; type: NodeType; label: string;
  pipelineStage?: string; dealHealthScore?: number; seniority?: string;
  activityType?: string; source?: string; occurredAt?: string; summary?: string;
  isPublic?: boolean; memBody?: string;
  domain?: string; companyDealHealth?: number;
  signalCount?: number; lastActivityDays?: number;
  fx?: number; fy?: number; x?: number; y?: number;
}
interface GLink {
  source: string | GNode; target: string | GNode;
  linkType: "employs" | "signal" | "memory"; isPublic?: boolean;
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────
function Tooltip({ node, x, y }: { node: GNode; x: number; y: number }) {
  const stage = node.pipelineStage ?? "identified";
  const sc = STAGE[stage] ?? "#A1A1AA";
  const ageDays = node.occurredAt
    ? Math.floor((Date.now() - new Date(node.occurredAt).getTime()) / 86400000) : null;
  const ageStr = ageDays === null ? null
    : ageDays === 0 ? "Today" : ageDays === 1 ? "Yesterday" : `${ageDays}d ago`;
  const isPrivate = node.isPublic === false;

  return (
    <div style={{ left: x + 16, top: y - 8 }}
      className="absolute z-50 pointer-events-none bg-white border border-zinc-200 rounded-xl px-4 py-3 shadow-xl max-w-[280px] min-w-[150px]">

      {node.type === "company" && <>
        <p className="text-[10px] text-zinc-400 uppercase tracking-widest font-medium mb-1">Account</p>
        <p className="text-[14px] font-semibold text-zinc-900 leading-snug">{node.label}</p>
        {node.companyDealHealth != null && (
          <div className="mt-2 space-y-1">
            <div className="flex justify-between text-[10px] text-zinc-400">
              <span>Deal health</span><span>{node.companyDealHealth}/100</span>
            </div>
            <div className="h-1 w-full rounded-full bg-zinc-100 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${node.companyDealHealth}%`, background: node.companyDealHealth >= 70 ? GREEN : node.companyDealHealth >= 40 ? AMBER : "#DC2626" }} />
            </div>
          </div>
        )}
        {node.signalCount != null && <p className="text-[10px] text-zinc-400 mt-1.5">{node.signalCount} signals tracked</p>}
      </>}

      {node.type === "contact" && <>
        <div className="flex items-center gap-1.5 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ background: sc }} />
          <p className="text-[10px] uppercase tracking-widest font-medium" style={{ color: sc }}>{stage}</p>
        </div>
        <p className="text-[13px] font-semibold text-zinc-900 leading-snug">{node.label}</p>
        {node.seniority && <p className="text-[11px] text-zinc-400 mt-0.5 capitalize">{node.seniority.replace(/_/g, " ")}</p>}
        <div className="mt-2 space-y-1">
          {node.dealHealthScore != null && (
            <div className="flex items-center gap-1.5">
              <div className="h-1 w-16 rounded-full bg-zinc-100 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${node.dealHealthScore}%`, background: sc }} />
              </div>
              <span className="text-[10px] text-zinc-400">health {node.dealHealthScore}</span>
            </div>
          )}
          {node.signalCount != null && node.signalCount > 0 && (
            <p className="text-[10px] text-zinc-400">{node.signalCount} signals · {node.lastActivityDays === 0 ? "active today" : node.lastActivityDays != null ? `last active ${node.lastActivityDays}d ago` : ""}</p>
          )}
        </div>
      </>}

      {node.type === "signal" && <>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: isPrivate ? GREEN : AMBER }}>{node.source ?? "signal"}</p>
          <span className="text-[9px] px-1.5 py-px rounded-full border font-medium" style={{ color: isPrivate ? GREEN : AMBER, borderColor: isPrivate ? GREEN : AMBER }}>
            {isPrivate ? "private" : "public"}
          </span>
        </div>
        <p className="text-[12px] font-medium text-zinc-800 capitalize">{(node.activityType ?? "").replace(/_/g, " ")}</p>
        {ageStr && <p className="text-[10px] text-zinc-400 mt-0.5">{ageStr}</p>}
        {node.summary && <p className="text-[10px] text-zinc-500 mt-1.5 leading-relaxed border-t border-zinc-100 pt-1.5">{node.summary.slice(0, 80)}</p>}
      </>}

      {node.type === "memory" && <>
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: V }}>Memory</p>
        <p className="text-[11px] text-zinc-700 leading-relaxed">{node.memBody}</p>
      </>}
    </div>
  );
}

// ─── Props / API types ────────────────────────────────────────────────────────
interface Props {
  companyId?: string; contactIds?: string[]; companyName?: string;
  companyDomain?: string;
  token: string; apiUrl: string; workspaceId: string;
  onContactClick?: (contactId: string) => void;
}
interface RawContact { id: string; first_name?: string; last_name?: string; email?: string; job_title?: string; seniority?: string; pipeline_stage?: string; deal_health_score?: number; }
interface RawSignal  { id: string; contact_id: string; activity_type: string; source?: string; occurred_at?: string; summary?: string; }
interface RawMemory  { id: string; contact_id: string; content: string; }
interface RawCompany { id: string; name: string; domain?: string; deal_health_score?: number; }

// ─── Component ────────────────────────────────────────────────────────────────
export function CompanyGraph({ companyId, contactIds, companyName, companyDomain, token, apiUrl, workspaceId, onContactClick }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef      = useRef<any>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const zoomedRef     = useRef(false);
  const graphDataRef  = useRef<{ nodes: GNode[]; links: GLink[] }>({ nodes: [], links: [] });
  const savedCamRef   = useRef<{ zoom: number; cx: number; cy: number } | null>(null);

  const [dims, setDims]             = useState({ w: 800, h: 600 });
  const [graphData, setGraphData]   = useState<{ nodes: GNode[]; links: GLink[] }>({ nodes: [], links: [] });
  const [loading, setLoading]       = useState(true);
  const [hovered, setHovered]       = useState<GNode | null>(null);
  const [tipPos, setTipPos]         = useState({ x: 0, y: 0 });
  // (no forceRedraw state — we call graphRef.refresh() directly instead)

  // Stable storage key per company
  const storageKey = useMemo(() =>
    `proply-graph-pos:${companyId ?? companyName ?? "unknown"}`,
  [companyId, companyName]);

  // Keep ref in sync for callbacks
  useEffect(() => { graphDataRef.current = graphData; }, [graphData]);

  // Reset zoom flag on new data
  useEffect(() => {
    zoomedRef.current = false;
  }, [graphData]);

  // When graph loads with saved positions: restore the saved camera (zoom+pan)
  // so the user sees exactly what they left. Fall back to zoomToFit only on
  // the very first visit (no saved camera).
  useEffect(() => {
    if (graphData.nodes.length === 0) return;
    const hasSavedPos = graphData.nodes.some(n => n.fx !== undefined);
    if (!hasSavedPos) return;
    const t = setTimeout(() => {
      if (!graphRef.current) return;
      const cam = savedCamRef.current;
      if (cam) {
        graphRef.current.zoom?.(cam.zoom, 0);
        graphRef.current.centerAt?.(cam.cx, cam.cy, 0);
      } else {
        graphRef.current.zoomToFit?.(0, 80);
      }
      zoomedRef.current = true;
    }, 100);
    return () => clearTimeout(t);
  }, [graphData]);

  // Fallback: first-visit or timing edge-case — fit after simulation settles.
  useEffect(() => {
    if (graphData.nodes.length === 0) return;
    const t = setTimeout(() => {
      if (!zoomedRef.current && graphRef.current) {
        graphRef.current.zoomToFit?.(0, 80);
        zoomedRef.current = true;
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [graphData]);

  // Keep a ref copy of dims so drag callbacks read the current value
  const dimsRef = useRef(dims);
  useEffect(() => { dimsRef.current = dims; }, [dims]);

  // ── Save node positions + camera state to localStorage ──────────────────
  const savePositions = useCallback(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    graphDataRef.current.nodes.forEach((n: GNode) => {
      pos[n.id] = { x: n.fx ?? n.x ?? 0, y: n.fy ?? n.y ?? 0 };
    });
    const zoom   = graphRef.current?.zoom?.() ?? null;
    const center = graphRef.current?.centerAt?.() ?? null;
    const cam    = (zoom != null && center != null)
      ? { zoom, cx: (center as { x: number; y: number }).x, cy: (center as { x: number; y: number }).y }
      : null;
    if (cam) savedCamRef.current = cam;
    try { localStorage.setItem(storageKey, JSON.stringify({ pos, cam })); } catch { /* quota */ }
  }, [storageKey]);

  // ── Container size — immediate + watch ───────────────────────────────────
  useLayoutEffect(() => {
    const measure = () => {
      if (!containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      if (width > 0 && height > 0) setDims({ w: width, h: height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchGraph = useCallback(async () => {
    try {
      let url: string;
      if (companyId) {
        url = `${apiUrl}/api/companies/${companyId}/graph?workspaceId=${workspaceId}`;
      } else if (contactIds && contactIds.length > 0) {
        const name = companyName ? `&companyName=${encodeURIComponent(companyName)}` : "";
        url = `${apiUrl}/api/contact-graph?ids=${contactIds.join(",")}&workspaceId=${workspaceId}${name}`;
      } else { setLoading(false); return; }

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();

      const company: RawCompany   = data.company;
      const contacts: RawContact[] = data.contacts ?? [];
      const signals: RawSignal[]   = data.signals   ?? [];
      const memories: RawMemory[]  = data.memories   ?? [];

      const domain = company.domain ?? companyDomain;
      if (domain) preload(faviconUrl(domain));
      signals.forEach(s => { const l = PROVIDER_LOGO[s.source ?? ""]; if (l) preload(l); });

      // Restore saved positions + camera (if user has previously arranged this graph)
      let savedPos: Record<string, { x: number; y: number }> = {};
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
        // Support both legacy format (plain pos object) and new {pos, cam} format
        if (stored.pos) {
          savedPos = stored.pos;
          savedCamRef.current = stored.cam ?? null;
        } else {
          savedPos = stored;
          savedCamRef.current = null;
        }
      } catch { /* */ }

      const nodes: GNode[] = [];
      const links: GLink[] = [];

      // Per-contact signal stats
      const contactSignalCount: Record<string, number>   = {};
      const contactLastActivity: Record<string, number>  = {};
      signals.forEach(s => {
        contactSignalCount[s.contact_id] = (contactSignalCount[s.contact_id] ?? 0) + 1;
        if (s.occurred_at) {
          const days = Math.floor((Date.now() - new Date(s.occurred_at).getTime()) / 86400000);
          if (contactLastActivity[s.contact_id] === undefined || days < contactLastActivity[s.contact_id])
            contactLastActivity[s.contact_id] = days;
        }
      });

      // Company node — NOT PINNED: let force simulation place it naturally at center
      // (pinning at fx=0,fy=0 = world-origin which is off-screen in most layouts)
      const companyNode: GNode = {
        id: `company-${company.id}`, type: "company", label: company.name,
        domain, companyDealHealth: company.deal_health_score ?? undefined,
        signalCount: signals.length,
      };
      const cSaved = savedPos[companyNode.id];
      if (cSaved) { companyNode.fx = cSaved.x; companyNode.fy = cSaved.y; }
      nodes.push(companyNode);

      contacts.forEach(c => {
        const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "Unknown";
        const node: GNode = {
          id: `contact-${c.id}`, type: "contact", label: name,
          pipelineStage:  c.pipeline_stage ?? "identified",
          dealHealthScore: c.deal_health_score ?? 0,
          seniority:       c.seniority,
          signalCount:     contactSignalCount[c.id] ?? 0,
          lastActivityDays: contactLastActivity[c.id],
        };
        const s = savedPos[node.id];
        if (s) { node.fx = s.x; node.fy = s.y; }
        nodes.push(node);
        links.push({ source: `company-${company.id}`, target: `contact-${c.id}`, linkType: "employs" });
      });

      signals.forEach(s => {
        const isPub = PUBLIC_SIGNALS.has(s.activity_type);
        const node: GNode = {
          id: `signal-${s.id}`, type: "signal", label: s.activity_type,
          source: s.source ?? "manual", activityType: s.activity_type,
          occurredAt: s.occurred_at, summary: s.summary ?? undefined, isPublic: isPub,
        };
        const sv = savedPos[node.id];
        if (sv) { node.fx = sv.x; node.fy = sv.y; }
        nodes.push(node);
        links.push({ source: `contact-${s.contact_id}`, target: `signal-${s.id}`, linkType: "signal", isPublic: isPub });
      });

      memories.forEach(m => {
        const node: GNode = { id: `memory-${m.id}`, type: "memory", label: "Memory", memBody: m.content };
        const sv = savedPos[node.id];
        if (sv) { node.fx = sv.x; node.fy = sv.y; }
        nodes.push(node);
        links.push({ source: `contact-${m.contact_id}`, target: `memory-${m.id}`, linkType: "memory" });
      });

      setGraphData({ nodes, links });
    } catch { /* silent */ }
    setLoading(false);
  }, [companyId, contactIds, companyName, companyDomain, apiUrl, workspaceId, token, storageKey]);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  // Canvas loop keeps running (particles keep doRedraw=true), so logos that
  // load async will appear on the next rendered frame automatically.

  // 30s refresh
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) fetchGraph(); }, 30000);
    return () => clearInterval(id);
  }, [fetchGraph]);

  // Force config — repulsion + link distances
  useEffect(() => {
    if (!graphRef.current || graphData.nodes.length === 0) return;
    graphRef.current.d3Force?.("charge")?.strength?.(-280);
    graphRef.current.d3Force?.("link")?.distance?.((l: GLink) =>
      l.linkType === "employs" ? 140 : 60
    );
    graphRef.current.d3ReheatSimulation?.();
  }, [graphData]);

  // ── Engine stop: zoom once, then FREEZE all nodes ─────────────────────────
  // Freezing: set fx/fy = current x/y on every node.
  // D3 treats fx/fy nodes as immovable — simulation can reheat all it wants
  // but pinned nodes won't move. Drag still works (updates fx/fy directly).
  const onEngineStop = useCallback(() => {
    if (!graphRef.current) return;
    if (!zoomedRef.current) {
      const cam = savedCamRef.current;
      if (cam) {
        graphRef.current.zoom?.(cam.zoom, 0);
        graphRef.current.centerAt?.(cam.cx, cam.cy, 0);
      } else {
        graphRef.current.zoomToFit?.(0, 80);
      }
      zoomedRef.current = true;
    }
    // Freeze any unfrozen node (covers initial settle AND post-drag reheat where
    // force-graph clears fx/fy on drag-end for nodes that started the drag unfrozen).
    // Use == null to catch both null and undefined.
    graphDataRef.current.nodes.forEach((n: GNode) => {
      if (n.fx == null || n.fy == null) {
        n.fx = n.x ?? 0;
        n.fy = n.y ?? 0;
      }
    });
    savePositions();
  }, [savePositions]);

  // ── Save position after each drag, re-fit only if near canvas edge ────────
  // IMPORTANT: Do NOT use animated zoomToFit (duration > 0) here.
  // Animated zoom adds a tween to force-graph's internal tweenGroup. That tween
  // persists across company navigations and overrides onEngineStop's instant
  // zoomToFit(0, 80), causing a wrong camera on the next company you visit.
  // Instant zoom (duration = 0) avoids all tween interference.
  const onNodeDragEnd = useCallback((node: GNode) => {
    // force-graph clears node.fx/fy before calling this for nodes that were
    // unfrozen at drag-start. Re-pin immediately so the node stays put.
    node.fx = node.x ?? 0;
    node.fy = node.y ?? 0;
    savePositions();
  }, [savePositions]);

  // ── Clamp nodes to canvas bounds while dragging ───────────────────────────
  // Root cause of the dead zone: D3 drag listens at document level, so when
  // the mouse moves into the sidebar the node's world position is updated to
  // coords that map to canvas pixels > dims.w. Canvas clips there → invisible.
  // Fix: convert current world pos → screen px, clamp, convert back → world.
  const onNodeDrag = useCallback((node: GNode) => {
    if (!graphRef.current) return;
    const { w, h } = dimsRef.current;
    const sp = graphRef.current.graph2ScreenCoords?.(node.x ?? 0, node.y ?? 0);
    if (!sp) return;
    // Pad by node radius so the full circle stays within the canvas
    const pad = node.type === 'company' ? 32 : node.type === 'contact' ? 22 : 16;
    const cx = Math.max(pad, Math.min(w - pad, sp.x));
    const cy = Math.max(pad, Math.min(h - pad, sp.y));
    if (cx !== sp.x || cy !== sp.y) {
      // Out of canvas bounds — clamp back and pin
      const wp = graphRef.current.screen2GraphCoords?.(cx, cy);
      if (wp) {
        node.x = wp.x; node.y = wp.y;
        node.fx = wp.x; node.fy = wp.y;
      }
    } else {
      // In bounds — pin at current position so the node can't be pulled away
      // by the force simulation even if it started the drag unfrozen (fx==null).
      node.fx = node.x ?? 0;
      node.fy = node.y ?? 0;
    }
  }, []);

  // ── Node rendering ─────────────────────────────────────────────────────────
  const paintNode = useCallback((node: GNode, ctx: CanvasRenderingContext2D, gs: number) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;

    if (node.type === "company") {
      const r = 24;

      // Drop shadow + fill
      ctx.shadowColor = "rgba(0,0,0,0.07)";
      ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = NODE_D; ctx.fill();
      ctx.shadowBlur = 0;

      // Outer dashed ring (health-tinted)
      const h = node.companyDealHealth ?? null;
      const rc = h == null ? va(0.35) : h >= 70 ? GREEN : h >= 40 ? AMBER : "#DC2626";
      ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.strokeStyle = rc; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.setLineDash([]);

      // Company favicon
      const logo = node.domain ? getImg(faviconUrl(node.domain)) : null;
      if (logo) {
        const ir = r - 7;
        ctx.save();
        ctx.beginPath(); ctx.arc(x, y, ir, 0, 2 * Math.PI); ctx.clip();
        ctx.drawImage(logo, x - ir, y - ir, ir * 2, ir * 2);
        ctx.restore();
      } else {
        // Initials fallback
        ctx.fillStyle = va(0.45);
        ctx.font = `600 ${Math.max(7, 10 / Math.max(1, gs * 0.7))}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(node.label.slice(0, 2).toUpperCase(), x, y);
      }

      // Company name
      ctx.fillStyle = TEXT;
      ctx.font = `500 ${Math.max(5.5, 7 / Math.max(1, gs * 0.7))}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(node.label.length > 18 ? node.label.slice(0, 17) + "…" : node.label, x, y + r + 5);

      // Signal count chip
      if (node.signalCount && node.signalCount > 0) {
        ctx.fillStyle = va(0.08);
        const chipW = 24, chipH = 10, chipY = y + r + 16;
        ctx.fillRect(x - chipW / 2, chipY, chipW, chipH);
        ctx.fillStyle = va(0.6);
        ctx.font = `500 ${Math.max(4, 5 / Math.max(1, gs * 0.7))}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(`${node.signalCount} sig`, x, chipY + chipH / 2);
      }

    } else if (node.type === "contact") {
      const r = 11;
      const stage = node.pipelineStage ?? "identified";
      const sc = STAGE[stage] ?? "#71717A";

      ctx.shadowColor = "rgba(0,0,0,0.06)";
      ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = NODE_D; ctx.fill();
      ctx.shadowBlur = 0;

      // Stage ring
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.strokeStyle = sc + "CC"; ctx.lineWidth = 1.5; ctx.stroke();

      // Person silhouette — head + shoulders
      ctx.beginPath();
      ctx.arc(x, y - r * 0.2, r * 0.27, 0, 2 * Math.PI);
      ctx.fillStyle = sc + "88"; ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.rect(x - r, y, r * 2, r); ctx.clip();
      ctx.beginPath(); ctx.arc(x, y + r * 0.28, r * 0.44, 0, 2 * Math.PI);
      ctx.fillStyle = sc + "88"; ctx.fill();
      ctx.restore();

      // Health arc progress ring
      const health = node.dealHealthScore ?? 0;
      if (health > 0) {
        const end = (health / 100) * 2 * Math.PI - Math.PI / 2;
        ctx.beginPath(); ctx.arc(x, y, r + 3, -Math.PI / 2, end);
        ctx.strokeStyle = sc + "40"; ctx.lineWidth = 2; ctx.stroke();
      }

      // First name + stage dot to the right
      const firstName = node.label.split(" ")[0];
      const fs = Math.max(5, 6 / Math.max(1, gs * 0.7));
      ctx.fillStyle = TEXT;
      ctx.font = `500 ${fs}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(firstName, x + r + 4, y);
      const tw = ctx.measureText(firstName).width;
      ctx.fillStyle = sc;
      ctx.beginPath(); ctx.arc(x + r + 4 + tw + 5, y, 2, 0, 2 * Math.PI); ctx.fill();

      // Signal count badge
      if (node.signalCount && node.signalCount > 0) {
        const bfs = Math.max(3.5, 4.5 / Math.max(1, gs * 0.7));
        ctx.fillStyle = va(0.1);
        const bw = bfs * 2.5 + 5;
        ctx.fillRect(x - bw / 2, y + r + 3, bw, bfs + 3);
        ctx.fillStyle = va(0.7);
        ctx.font = `600 ${bfs}px Inter, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(`${node.signalCount}`, x, y + r + 3 + (bfs + 3) / 2);
      }

    } else if (node.type === "signal") {
      const r = 9;
      const isPub = node.isPublic ?? false;

      // Age-based opacity
      let opacity = 1;
      if (node.occurredAt) {
        const age = (Date.now() - new Date(node.occurredAt).getTime()) / 86400000;
        opacity = Math.max(0.25, 1 - age / 90);
      }
      ctx.globalAlpha = opacity;

      ctx.shadowColor = "rgba(0,0,0,0.05)";
      ctx.shadowBlur = 7;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = isPub ? aa(0.1) : ga(0.1);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Border: dashed amber for public, solid green for private
      if (isPub) { ctx.setLineDash([2, 3]); ctx.strokeStyle = aa(0.6); }
      else        { ctx.setLineDash([]);     ctx.strokeStyle = ga(0.65); }
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.stroke();
      ctx.setLineDash([]);

      // Provider logo (loads async, falls back gracefully)
      const logoSrc = PROVIDER_LOGO[node.source ?? ""];
      const logo = logoSrc ? getImg(logoSrc) : null;
      if (logo) {
        const ir = r - 1.5;
        ctx.save();
        ctx.beginPath(); ctx.arc(x, y, ir, 0, 2 * Math.PI); ctx.clip();
        ctx.drawImage(logo, x - ir, y - ir, ir * 2, ir * 2);
        ctx.restore();
      } else if (PROVIDER_SHORT[node.source ?? ""]) {
        // Known provider without a logo file — show abbreviation
        const short = PROVIDER_SHORT[node.source ?? ""];
        ctx.fillStyle = isPub ? AMBER : GREEN;
        ctx.font = `700 ${Math.max(3.5, 5 / Math.max(1, gs * 0.6))}px Inter, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(short.slice(0, 2), x, y);
      } else {
        // Agent or unknown source — draw icon that shows what actually happened
        drawActivityIcon(ctx, node.activityType ?? "", x, y, r, isPub ? AMBER : GREEN);
      }

      ctx.globalAlpha = 1;

    } else if (node.type === "memory") {
      const s = 7;
      // Diamond shape
      ctx.save();
      ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      ctx.shadowColor = va(0.12); ctx.shadowBlur = 6;
      ctx.fillStyle = va(0.06);
      ctx.beginPath(); ctx.rect(-s, -s, s * 2, s * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = va(0.38); ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      // § glyph centered in diamond
      const fs = Math.max(4.5, 5.5 / Math.max(1, gs * 0.7));
      ctx.fillStyle = va(0.65);
      ctx.font = `700 ${fs}px 'Courier New', monospace`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("§", x, y);
    }
  }, []);

  // Hit areas — generous radius so interaction is reliable
  const paintNodeArea = useCallback((node: GNode, color: string, ctx: CanvasRenderingContext2D) => {
    const x = node.x ?? 0, y = node.y ?? 0;
    const r = node.type === "company" ? 30 : node.type === "contact" ? 20 : 14;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
  }, []);

  const linkColor = useCallback((l: GLink) => {
    if (l.linkType === "memory") return `rgba(6,182,212,0.2)`;
    if (l.linkType === "signal") return l.isPublic ? aa(0.25) : ga(0.2);
    return "rgba(113,113,122,0.18)";
  }, []);

  const linkWidth = useCallback((l: GLink) => l.linkType === "employs" ? 1.2 : 0.7, []);
  const linkDash  = useCallback((l: GLink) => l.linkType === "memory" || l.isPublic ? [3, 4] : null, []);

  // Animated particles: flow along signal edges (public=amber, private=green)
  const particleColor = useCallback((l: GLink) => {
    if (l.linkType !== "signal") return null;
    return l.isPublic ? aa(0.55) : ga(0.55);
  }, []);

  const handleNodeHover = useCallback((node: GNode | null) => {
    setHovered(node ?? null);
    document.body.style.cursor = node ? "pointer" : "default";
  }, []);
  const handleNodeClick = useCallback((node: GNode) => {
    if (node.type === "contact") onContactClick?.(node.id.replace("contact-", ""));
  }, [onContactClick]);
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTipPos({ x: e.clientX - r.left, y: e.clientY - r.top });
  }, []);

  const nC = graphData.nodes.filter(n => n.type === "contact").length;
  const nS = graphData.nodes.filter(n => n.type === "signal").length;
  const nM = graphData.nodes.filter(n => n.type === "memory").length;

  if (loading) return (
    <div className="flex items-center justify-center w-full h-full bg-white">
      <Loader2 className="h-4 w-4 animate-spin text-zinc-300" />
    </div>
  );

  if (!graphData.nodes.some(n => n.type === "contact")) return (
    <div className="flex flex-col items-center justify-center w-full h-full gap-2 bg-white">
      <div className="w-8 h-8 rounded-full border border-dashed border-violet-200" />
      <p className="text-[13px] font-medium text-zinc-500">No contacts linked</p>
      <p className="text-[11px] text-zinc-400">Add contacts at this company to see the graph</p>
    </div>
  );

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden" style={{ background: BG }} onMouseMove={handleMouseMove}>
      <ForceGraph2D
        ref={graphRef}
        width={Math.max(100, dims.w)}
        height={dims.h}
        graphData={graphData}
        nodeId="id"
        backgroundColor={BG}
        nodeCanvasObject={paintNode as never}
        nodeCanvasObjectMode={() => "replace"}
        nodePointerAreaPaint={paintNodeArea as never}
        enableNodeDrag
        enableZoomInteraction
        enablePanInteraction
        onNodeHover={handleNodeHover as never}
        onNodeClick={handleNodeClick as never}
        onNodeDrag={onNodeDrag as never}
        onNodeDragEnd={onNodeDragEnd as never}
        linkColor={linkColor as never}
        linkWidth={linkWidth as never}
        linkLineDash={linkDash as never}
        linkDirectionalParticles={(l: GLink) => l.linkType === "signal" ? 2 : 0}
        linkDirectionalParticleSpeed={0.004}
        linkDirectionalParticleWidth={1.5}
        linkDirectionalParticleColor={particleColor as never}
        d3AlphaDecay={0.05}
        d3VelocityDecay={0.42}
        cooldownTicks={120}
        minZoom={0.2}
        maxZoom={6}
        nodeLabel={() => ""}
        onEngineStop={onEngineStop}
      />

      {hovered && <Tooltip node={hovered} x={tipPos.x} y={tipPos.y} />}

      {/* Legend */}
      <div className="absolute bottom-5 left-5 space-y-1.5 pointer-events-none">
        {(["client","evaluating","interested","aware","identified"] as const).map(s => (
          <div key={s} className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: STAGE[s] }} />
            <span className="text-[10px] text-zinc-400 capitalize">{s}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 mt-1.5">
          <div className="w-3 h-[1px] border-t border-dashed" style={{ borderColor: aa(0.7) }} />
          <span className="text-[10px] text-zinc-400">public signal</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-[1px]" style={{ background: ga(0.5) }} />
          <span className="text-[10px] text-zinc-400">private signal</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rotate-45 border border-dashed flex-shrink-0" style={{ borderColor: va(0.4), background: va(0.06) }} />
          <span className="text-[10px] text-zinc-400 font-mono">§ memory</span>
        </div>
      </div>

      {/* Stats */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 text-[11px] text-zinc-400 pointer-events-none select-none font-mono">
        <span><span className="text-zinc-700 font-medium">{nC}</span> contacts</span>
        <span className="text-zinc-200">·</span>
        <span><span className="text-zinc-700 font-medium">{nS}</span> signals</span>
        <span className="text-zinc-200">·</span>
        <span><span className="text-violet-500 font-medium">{nM}</span> § mem</span>
      </div>
    </div>
  );
}

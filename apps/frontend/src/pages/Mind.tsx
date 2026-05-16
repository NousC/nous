import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { format, isToday, isYesterday, startOfDay } from "date-fns";
import { X, ExternalLink, ChevronUp, ChevronDown, RefreshCw, Copy, Check } from "lucide-react";
import { systemLogOpName, agentOpName, OP_COLORS } from "@/lib/operationName";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

// ─── Codename ─────────────────────────────────────────────────────────────────

const ADJECTIVES = ["Crow","Atlas","Iron","Amber","Onyx","Cobalt","Steel","Jade","Silver","Bronze","Copper","Crimson","Indigo","Obsidian","Granite","Marble","Basalt","Quartz","Flint","Cinder"];
const NOUNS      = ["Marigold","Oracle","Cipher","Nexus","Vector","Prism","Signal","Archive","Beacon","Matrix","Cortex","Lattice","Fulcrum","Apex","Vertex","Zenith","Meridian","Axis","Core","Sluice"];

function generateCodename(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h) ^ seed.charCodeAt(i);
  const abs = Math.abs(h);
  return `${ADJECTIVES[abs % ADJECTIVES.length]}-of-${NOUNS[(abs >> 8) % NOUNS.length]}-${(abs % 99) + 1}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContactInfo {
  id: string;
  name: string;
  email: string | null;
  title: string | null;
  pipelineStage: string;
  icpScore: number | null;
  location: string | null;
  seniority: string | null;
}

interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employee_count: number | null;
  location: string | null;
  contactCount: number;
  contacts: ContactInfo[];
  dealHealthScore: number | null;
}

interface LiveOp {
  id: string;
  ts: string;
  name: string;
  color: string;
  detail: string;
  source: "system" | "agent" | "mcp" | "sdk" | "api";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function orbitPositions(count: number, rx = 270, ry = 148) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    const jitter = 1 + 0.12 * Math.sin(i * 1.9 + 0.8);
    return { x: Math.cos(angle) * rx * jitter, y: Math.sin(angle) * ry * jitter };
  });
}

function dayLabel(date: Date) {
  if (isToday(date))     return "TODAY";
  if (isYesterday(date)) return "YESTERDAY";
  return format(date, "MMM d, yyyy").toUpperCase();
}

function groupByDay(ops: LiveOp[]) {
  const map = new Map<string, LiveOp[]>();
  for (const op of ops) {
    const key = startOfDay(new Date(op.ts)).toISOString();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(op);
  }
  return [...map.entries()].map(([, ops]) => ({ label: dayLabel(new Date(ops[0].ts)), ops }));
}

// ─── ConnectModal ─────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={copy}
      className="absolute top-2 right-2 text-muted-foreground/40 hover:text-foreground/70 transition-colors">
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

const MCP_CONFIG = `{
  "mcpServers": {
    "proply": {
      "command": "npx",
      "args": ["-y", "@goproply/mcp"],
      "env": {
        "PROPLY_API_KEY": "your-api-key"
      }
    }
  }
}`;

const SDK_SNIPPET = `npm install @proply/sdk

import { Proply } from '@proply/sdk';
const proply = new Proply('your-api-key');

const contact = await proply.contacts.get('email@example.com');`;

function ConnectModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"mcp" | "sdk">("mcp");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative bg-background border border-border rounded-lg max-w-xl w-full mx-4"
        style={{ fontFamily: "'JetBrains Mono','Consolas',monospace" }}>
        <button onClick={onClose} className="absolute top-3 right-3 text-muted-foreground/40 hover:text-foreground/70 transition-colors">
          <X className="h-4 w-4" />
        </button>
        <div className="p-6 space-y-5">
          <div>
            <div className="text-muted-foreground/40 text-[9px] tracking-widest mb-1">PROPLY / MIND / CONNECT</div>
            <div className="text-foreground text-sm">Connect an agent to the Mind</div>
            <div className="text-muted-foreground text-[11px] mt-1">Choose how your AI agent accesses contact intelligence.</div>
          </div>
          <div className="flex gap-1">
            {(["mcp", "sdk"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-[11px] rounded border transition-colors ${
                  tab === t ? "border-border bg-muted text-foreground" : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border"
                }`}>
                {t === "mcp" ? "MCP Server" : "Node SDK"}
              </button>
            ))}
          </div>
          {tab === "mcp" && (
            <div className="space-y-3">
              <div className="text-muted-foreground text-[11px]">
                Works with Claude Desktop, Cursor, Windsurf, and any MCP-compatible agent.
                Add to your <span className="text-foreground/70">claude_desktop_config.json</span> or MCP settings:
              </div>
              <div className="relative bg-muted/50 border border-border rounded p-3 text-[11px] text-foreground/70 whitespace-pre overflow-x-auto">
                <CopyButton text={MCP_CONFIG} />{MCP_CONFIG}
              </div>
              <div className="text-muted-foreground/50 text-[10px]">Get your API key → Settings → API Keys</div>
            </div>
          )}
          {tab === "sdk" && (
            <div className="space-y-3">
              <div className="text-muted-foreground text-[11px]">
                Use the Node SDK to query contact intelligence from any TypeScript or JavaScript workflow.
              </div>
              <div className="relative bg-muted/50 border border-border rounded p-3 text-[11px] text-foreground/70 whitespace-pre overflow-x-auto">
                <CopyButton text={SDK_SNIPPET} />{SDK_SNIPPET}
              </div>
              <div className="text-muted-foreground/50 text-[10px]">Get your API key → Settings → API Keys</div>
            </div>
          )}
          <div className="border-t border-border/40 pt-4 flex items-center justify-between">
            <span className="text-muted-foreground/50 text-[10px]">The Mind goes online once it receives its first agent call.</span>
            <a href="/settings" className="text-[11px] text-muted-foreground/60 hover:text-foreground/80 transition-colors flex items-center gap-1">
              API Keys <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ContactDossier ──────────────────────────────────────────────────────────

function ContactDossier({
  contact, rect, onMouseEnter, onMouseLeave, onClick,
}: {
  contact: ContactInfo;
  rect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
}) {
  const stageColor =
    contact.pipelineStage === "client"     ? "#4ade80" :
    contact.pipelineStage === "evaluating" ? "#60a5fa" :
    contact.pipelineStage === "interested" ? "#fb923c" :
    contact.pipelineStage === "aware"      ? "#facc15" : "#9ca3af";

  const spaceRight = window.innerWidth - rect.right;
  const left = spaceRight > 260 ? rect.right + 10 : rect.left - 260;
  const top  = Math.max(8, Math.min(rect.top - 24, window.innerHeight - 220));

  return (
    <div
      className="fixed z-[60] border border-border bg-background shadow-xl cursor-pointer"
      style={{ left, top, width: 248, fontFamily: "'JetBrains Mono','Consolas',monospace" }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      <div className="px-3 pt-2.5 pb-1.5 border-b border-border/40">
        <div className="text-[9px] text-muted-foreground/40 tracking-widest">PERSON RECORD</div>
        <div className="flex items-center justify-between mt-0.5">
          <div className="text-[11px] text-foreground">{contact.name}</div>
          <ExternalLink className="h-2.5 w-2.5 text-muted-foreground/30" />
        </div>
      </div>
      <div className="px-3 py-2 text-[10px]">
        <div className="grid grid-cols-[58px_1fr] gap-x-2 gap-y-0.5">
          {contact.title && <>
            <span className="text-muted-foreground/40">title</span>
            <span className="text-foreground/80 truncate">{contact.title}</span>
          </>}
          {contact.email && <>
            <span className="text-muted-foreground/40">email</span>
            <span className="text-foreground/70 truncate">{contact.email}</span>
          </>}
          <span className="text-muted-foreground/40">stage</span>
          <span style={{ color: stageColor }}>{contact.pipelineStage}</span>
          {contact.icpScore !== null && <>
            <span className="text-muted-foreground/40">icp</span>
            <span className="text-foreground/70">{contact.icpScore}/100</span>
          </>}
          {contact.seniority && <>
            <span className="text-muted-foreground/40">seniority</span>
            <span className="text-foreground/70">{contact.seniority}</span>
          </>}
          {contact.location && <>
            <span className="text-muted-foreground/40">location</span>
            <span className="text-foreground/70 truncate">{contact.location}</span>
          </>}
        </div>
      </div>
      <div className="px-3 py-1.5 border-t border-border/20 text-[9px] text-muted-foreground/40 tracking-wide">
        click to open person record →
      </div>
    </div>
  );
}

// ─── CompanyCard ─────────────────────────────────────────────────────────────

function CompanyCard({
  company, active, onEnter, onLeave, onContactEnter, onContactLeave,
}: {
  company: Company;
  active: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onContactEnter: (c: ContactInfo, rect: DOMRect) => void;
  onContactLeave: () => void;
}) {
  const h = company.dealHealthScore;
  const trend  = h === null ? null : h >= 70 ? "↑" : h >= 40 ? "→" : "↓";
  const hClass = h === null ? "" : h >= 70 ? "text-emerald-500" : h >= 40 ? "text-yellow-500" : "text-red-400";

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={`border text-[10px] transition-all duration-200 select-none ${
        active ? "border-foreground/25 bg-background shadow-md" : "border-border/45 bg-background/90 hover:border-border/60"
      }`}
      style={{ minWidth: 148, maxWidth: 210 }}
    >
      <div className="px-2.5 pt-2 pb-1.5 border-b border-border/30">
        <span className="text-muted-foreground/35">§ </span>
        <span className={active ? "text-foreground font-medium" : "text-foreground/75"}>{company.name}</span>
      </div>

      {company.contacts.length > 0 && (
        <div className="px-2.5 py-1.5 border-b border-border/20 space-y-px">
          {company.contacts.slice(0, 5).map(c => (
            <div
              key={c.id}
              className="flex items-baseline gap-1.5 group/contact rounded px-0.5 hover:bg-muted/30 transition-colors"
              onMouseEnter={e => onContactEnter(c, e.currentTarget.getBoundingClientRect())}
              onMouseLeave={onContactLeave}
            >
              <span className="text-muted-foreground/35 flex-shrink-0 text-[9px]">|_</span>
              <span className="text-foreground/75 flex-1 min-w-0 truncate group-hover/contact:text-foreground transition-colors">
                {c.name}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="px-2.5 py-1.5 space-y-px text-[9px]">
        {h !== null && trend && (
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground/35">health</span>
            <span className={hClass}>{h}/100 {trend}</span>
          </div>
        )}
        {company.industry && (
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground/35">industry</span>
            <span className="text-foreground/50 truncate">{company.industry}</span>
          </div>
        )}
        {company.contacts.length === 0 && (
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground/35">contacts</span>
            <span className="text-foreground/40">0</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── BrainCanvas ─────────────────────────────────────────────────────────────
// Canvas-rendered character brain: two lobes with organic boundary bumps,
// animated sulci gaps, thin fold lines, gyri texture, breathing alpha.

const BRAIN_CHARS = ['@', '#', '0', 'O', 'o', '*', '+', '·'];

function BrainCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W  = canvas.width;   // 320
    const H  = canvas.height;  // 238
    const cx = W / 2;          // 160
    const cy = H * 0.42;       // ~100

    // Lobe centers (offset left/right from brain center)
    const rcx = cx + 34, rcy = cy;
    const lcx = cx - 34, lcy = cy;
    const lw = 82, lh = 72; // lobe half-dimensions

    const STEP     = 9;
    const FISSURE  = STEP * 0.8; // gap width from center to exclude

    // Density: two ellipses with bumpy organic boundary
    function getDensity(px: number, py: number): number {
      const ar = Math.atan2(py - rcy, px - rcx);
      const al = Math.atan2(py - lcy, px - lcx);
      // Boundary perturbation: 6 main gyri bumps + finer texture
      const br = 1 + 0.09 * Math.sin(ar * 6) + 0.05 * Math.sin(ar * 13 + 1.2);
      const bl = 1 + 0.09 * Math.sin(al * 6 + 0.8) + 0.05 * Math.sin(al * 13);
      const dr = ((px - rcx) / (lw * br)) ** 2 + ((py - rcy) / (lh * br)) ** 2;
      const dl = ((px - lcx) / (lw * bl)) ** 2 + ((py - lcy) / (lh * bl)) ** 2;
      const d  = Math.min(dr, dl);
      return d < 1 ? (1 - d) ** 0.5 : -1;
    }

    // Sulcus lines: return true if point is in a gap
    function inSulcus(px: number, py: number, den: number): boolean {
      if (den < 0.12) return false;
      const SW = 3.2; // sulcus half-width in px

      // Right lobe sulci
      if (px > cx + FISSURE) {
        const lx = px - rcx, ly = py - rcy;
        // Superior frontal sulcus — upper arc
        if (Math.abs(ly - (-27 + Math.sin(lx / 18) * 8)) < SW) return true;
        // Central sulcus — diagonal S-curve
        if (Math.abs(ly - (6 + lx * 0.16 + Math.sin(lx / 22) * 9)) < SW - 0.5) return true;
        // Inferior temporal sulcus
        if (Math.abs(ly - (34 + Math.sin(lx / 16) * 6)) < SW - 1) return true;
      }
      // Left lobe sulci (mirrored)
      if (px < cx - FISSURE) {
        const lx = lcx - px, ly = py - lcy;
        if (Math.abs(ly - (-27 + Math.sin(lx / 18) * 8)) < SW) return true;
        if (Math.abs(ly - (6 + lx * 0.16 + Math.sin(lx / 22) * 9)) < SW - 0.5) return true;
        if (Math.abs(ly - (34 + Math.sin(lx / 16) * 6)) < SW - 1) return true;
      }
      return false;
    }

    // Draw thin bezier sulci lines after characters
    function drawSulciLines(breathe: number) {
      const alpha = (0.08 + breathe * 0.06).toFixed(2);
      ctx.strokeStyle = `rgba(80,40,180,${alpha})`;
      ctx.lineWidth = 0.9;
      ctx.lineCap = 'round';

      // Right lobe — 3 sulci
      const sulciR: [number, number, number, number, number, number, number, number][] = [
        [rcx - 22, rcy - 27, rcx + 10, rcy - 30, rcx + 42, rcy - 24, rcx + 62, rcy - 20],
        [rcx - 16, rcy + 6,  rcx + 18, rcy + 2,  rcx + 46, rcy + 14, rcx + 62, rcy + 22],
        [rcx - 18, rcy + 34, rcx + 12, rcy + 32, rcx + 40, rcy + 38, rcx + 56, rcy + 42],
      ];
      for (const [x1,y1,cx1,cy1,cx2,cy2,x2,y2] of sulciR) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(cx1, cy1, cx2, cy2, x2, y2);
        ctx.stroke();
      }

      // Left lobe — mirror
      const sulciL: [number, number, number, number, number, number, number, number][] = [
        [lcx + 22, lcy - 27, lcx - 10, lcy - 30, lcx - 42, lcy - 24, lcx - 62, lcy - 20],
        [lcx + 16, lcy + 6,  lcx - 18, lcy + 2,  lcx - 46, lcy + 14, lcx - 62, lcy + 22],
        [lcx + 18, lcy + 34, lcx - 12, lcy + 32, lcx - 40, lcy + 38, lcx - 56, lcy + 42],
      ];
      for (const [x1,y1,cx1,cy1,cx2,cy2,x2,y2] of sulciL) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(cx1, cy1, cx2, cy2, x2, y2);
        ctx.stroke();
      }
    }

    let t = 0;

    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.font         = `${STEP}px 'JetBrains Mono','Consolas',monospace`;

      const breathe = (Math.sin(t * 0.38) + 1) / 2; // 0–1, ~16.5s period

      for (let gx = STEP; gx <= W - STEP / 2; gx += STEP) {
        for (let gy = STEP; gy <= H - 28; gy += STEP) {
          const den = getDensity(gx, gy);
          if (den < 0) continue;

          // Fissure gap at vertical center
          if (Math.abs(gx - cx) < FISSURE) continue;

          // Sulcus gaps
          if (inSulcus(gx, gy, den)) continue;

          // Gyri texture: radial rings create alternating dense/sparse zones
          const distR  = Math.sqrt((gx - rcx) ** 2 + ((gy - rcy) * 1.15) ** 2);
          const distL  = Math.sqrt((gx - lcx) ** 2 + ((gy - lcy) * 1.15) ** 2);
          const gyri   = Math.cos(Math.min(distR, distL) * 0.21 + t * 0.06) * 0.22;

          // Noise for character variety
          const nx = Math.sin(gx * 0.13 + t * 0.7) * Math.cos(gy * 0.10 + t * 0.55);

          const rawIdx = (1 - den) + gyri * 0.5 + nx * 0.18 + 0.04;
          const ci = Math.max(0, Math.min(BRAIN_CHARS.length - 1, Math.floor(rawIdx * BRAIN_CHARS.length)));
          const char = BRAIN_CHARS[ci];
          if (char === '·' && Math.random() > 0.6) continue; // thin out faint chars

          const alpha = Math.max(0.05, Math.min(0.84,
            0.10 + den * 0.56 + breathe * 0.18 + gyri * 0.08 + nx * 0.06
          ));
          ctx.fillStyle = `rgba(139,92,246,${alpha.toFixed(2)})`;
          ctx.fillText(char, gx, gy);
        }
      }

      // Thin sulci lines drawn over characters
      drawSulciLines(breathe);

      // MIND label — horizontally centered below brain
      const mindAlpha = (0.28 + breathe * 0.14).toFixed(2);
      ctx.font = `8px 'JetBrains Mono','Consolas',monospace`;
      ctx.fillStyle = `rgba(139,92,246,${mindAlpha})`;
      ctx.fillText('M · I · N · D', cx, H - 9);

      t += 0.022;
      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return (
    <div className="select-none pointer-events-none" style={{ width: 320, height: 238 }}>
      <canvas ref={canvasRef} width={320} height={238} style={{ display: 'block' }} />
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Mind() {
  const { userData, session } = useAuth();
  const navigate = useNavigate();
  const workspaceId = userData?.workspace?.id;
  const token       = session?.access_token;

  const [companies,     setCompanies]     = useState<Company[]>([]);
  const [ops,           setOps]           = useState<LiveOp[]>([]);
  const [totalOps,      setTotalOps]      = useState(0);
  const [selected,      setSelected]      = useState<Company | null>(null);
  const [isOnline,      setIsOnline]      = useState(false);
  const [opsExpanded,   setOpsExpanded]   = useState(false);
  const [loadingMore,   setLoadingMore]   = useState(false);
  const [sysOffset,     setSysOffset]     = useState(200);
  const [agentOffset,   setAgentOffset]   = useState(100);
  const [hasMore,       setHasMore]       = useState(true);
  const [showConnect,   setShowConnect]   = useState(false);
  const [stats,         setStats]         = useState({ contacts: 0, memories: 0, integrations: 0 });
  const [hoveredContact,setHoveredContact]= useState<{ contact: ContactInfo; rect: DOMRect } | null>(null);
  const [pan,           setPan]           = useState({ x: 0, y: 0 });
  const [dragging,      setDragging]      = useState(false);
  // Card offsets — persisted to localStorage so positions survive reload
  const [cardOffsets,   setCardOffsets]   = useState<Record<string, { x: number; y: number }>>(() => {
    try { const s = localStorage.getItem("mind_card_offsets"); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const [draggingCardId,setDraggingCardId]= useState<string | null>(null);
  const [scale,         setScale]         = useState(() => {
    try { return parseFloat(localStorage.getItem("mind_scale") ?? "1") || 1; } catch { return 1; }
  });

  // Canvas pan refs
  const isDragging  = useRef(false);
  const dragStart   = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const hasMoved    = useRef(false);

  // Per-card drag refs
  const cardDragRef = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number } | null>(null);

  // Dossier hover persistence — delayed hide so mouse can travel to the popup
  const dossierTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const codename = workspaceId ? generateCodename(workspaceId) : "···";

  // ── Dossier hover management ─────────────────────────────────────────────────

  const showDossier = useCallback((contact: ContactInfo, rect: DOMRect) => {
    if (dossierTimer.current) { clearTimeout(dossierTimer.current); dossierTimer.current = null; }
    setHoveredContact({ contact, rect });
  }, []);

  const scheduleDossierHide = useCallback(() => {
    dossierTimer.current = setTimeout(() => {
      setHoveredContact(null);
      dossierTimer.current = null;
    }, 230);
  }, []);

  const cancelDossierHide = useCallback(() => {
    if (dossierTimer.current) { clearTimeout(dossierTimer.current); dossierTimer.current = null; }
  }, []);

  const hideDossierNow = useCallback(() => {
    if (dossierTimer.current) { clearTimeout(dossierTimer.current); dossierTimer.current = null; }
    setHoveredContact(null);
  }, []);

  // ── Canvas pan handlers ──────────────────────────────────────────────────────

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    hasMoved.current   = false;
    dragStart.current  = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [pan]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (!hasMoved.current && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      hasMoved.current = true;
      setDragging(true);
    }
    if (hasMoved.current) setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
  }, []);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
    hasMoved.current   = false;
    setDragging(false);
  }, []);

  // ── Per-card drag handlers ───────────────────────────────────────────────────

  const handleCardPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, co: Company) => {
    e.stopPropagation();
    const off = cardOffsets[co.id] ?? { x: 0, y: 0 };
    cardDragRef.current = { id: co.id, sx: e.clientX, sy: e.clientY, ox: off.x, oy: off.y };
    setDraggingCardId(co.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [cardOffsets]);

  const handleCardPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!cardDragRef.current) return;
    const { id, sx, sy, ox, oy } = cardDragRef.current;
    setCardOffsets(prev => ({ ...prev, [id]: { x: ox + (e.clientX - sx), y: oy + (e.clientY - sy) } }));
  }, []);

  const handleCardPointerUp = useCallback(() => {
    cardDragRef.current = null;
    setDraggingCardId(null);
  }, []);

  // ── Persistence ──────────────────────────────────────────────────────────────

  useEffect(() => {
    try { localStorage.setItem("mind_card_offsets", JSON.stringify(cardOffsets)); } catch { /* ignore */ }
  }, [cardOffsets]);

  useEffect(() => {
    try { localStorage.setItem("mind_scale", String(scale)); } catch { /* ignore */ }
  }, [scale]);

  // ── Zoom (wheel) ─────────────────────────────────────────────────────────────

  const canvasContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale(prev => {
        const factor = e.ctrlKey ? 0.005 : 0.0012;
        return Math.min(3, Math.max(0.25, prev - e.deltaY * factor));
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── Data fetching ────────────────────────────────────────────────────────────

  const loadStats = useCallback(async () => {
    if (!workspaceId || !token) return;
    try {
      const [statsRes, intRes] = await Promise.all([
        fetch(`${apiUrl}/api/requests/stats?workspace_id=${workspaceId}&days=all`,
          { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiUrl}/api/workflow-providers/connections?workspace_id=${workspaceId}`,
          { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const s = statsRes.ok ? await statsRes.json() : {};
      const i = intRes.ok  ? await intRes.json()   : {};
      setStats({
        contacts:     s.totalContacts  ?? 0,
        memories:     s.totalFacts     ?? 0,
        integrations: (i.connections   ?? []).length,
      });
    } catch { /* silent */ }
  }, [workspaceId, token]);

  const loadCompanies = useCallback(async () => {
    if (!workspaceId || !token) return;
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [coRes, ctRes] = await Promise.all([
        fetch(`${apiUrl}/api/companies/list?workspaceId=${workspaceId}`, { headers }),
        fetch(`${apiUrl}/api/contacts?workspaceId=${workspaceId}&limit=500`, { headers }),
      ]);
      const coData = coRes.ok ? await coRes.json() : {};
      const ctData = ctRes.ok ? await ctRes.json() : {};

      const byCompany = new Map<string, ContactInfo[]>();
      for (const c of (ctData.contacts ?? [])) {
        if (!c.company_id) continue;
        const info: ContactInfo = {
          id:            c.id,
          name:          [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "—",
          email:         c.email          ?? null,
          title:         c.job_title      ?? null,
          pipelineStage: c.pipeline_stage ?? "identified",
          icpScore:      c.icp_score      ?? null,
          location:      c.location       ?? null,
          seniority:     c.seniority      ?? null,
        };
        const arr = byCompany.get(c.company_id) ?? [];
        arr.push(info);
        byCompany.set(c.company_id, arr);
      }

      const list: Company[] = (coData.companies ?? []).map((co: any) => {
        const contacts = byCompany.get(co.id) ?? [];
        return {
          id:             co.id,
          name:           co.name,
          domain:         co.domain         ?? null,
          industry:       co.industry       ?? null,
          employee_count: co.employee_count ?? null,
          location:       co.location       ?? null,
          contactCount:   contacts.length,
          contacts,
          dealHealthScore: co.deal_health_score ?? null,
        };
      });

      setCompanies([...list].sort((a, b) => b.contactCount - a.contactCount).slice(0, 8));
    } catch { /* silent */ }
  }, [workspaceId, token]);

  const loadOps = useCallback(async (sysOff = 0, agentOff = 0, reset = true) => {
    if (!workspaceId || !token) return;
    if (!reset) setLoadingMore(true);
    try {
      const [sysRes, agentRes] = await Promise.all([
        fetch(`${apiUrl}/api/workspace/system-log?workspace_id=${workspaceId}&days=7&limit=200&offset=${sysOff}`,
          { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiUrl}/api/requests/log?days=7&limit=100&offset=${agentOff}`,
          { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const sysData   = sysRes.ok   ? await sysRes.json()   : { events: [], total: 0 };
      const agentData = agentRes.ok ? await agentRes.json() : { requests: [], total: 0 };

      const sysOps: LiveOp[] = (sysData.events ?? []).map((e: any) => {
        const op = systemLogOpName(e.source, e.event_type, e.metadata);
        return { id: e.id, ts: e.occurred_at, name: op.name, color: OP_COLORS[op.color], detail: e.summary || e.source, source: e.source === "mcp" ? "agent" as const : "system" as const };
      });
      const agentOps: LiveOp[] = (agentData.requests ?? []).map((r: any) => {
        const op = agentOpName(r.op_type, r.entity_type);
        return { id: r.id, ts: r.created_at, name: op.name, color: OP_COLORS[op.color], detail: r.entity_type, source: "agent" as const };
      });
      const batch = [...sysOps, ...agentOps].sort(
        (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()
      );

      setOps(prev => reset ? batch : [...prev, ...batch]);
      if (reset) setTotalOps((sysData.total ?? 0) + (agentData.total ?? 0));
      setSysOffset(sysOff + sysOps.length);
      setAgentOffset(agentOff + agentOps.length);
      setHasMore(sysOps.length === 200 || agentOps.length === 100);

      if (reset) {
        const fiveMinAgo = Date.now() - 5 * 60 * 1000;
        setIsOnline(agentOps.some(o => new Date(o.ts).getTime() > fiveMinAgo));
      }
    } catch { /* silent */ }
    finally { setLoadingMore(false); }
  }, [workspaceId, token]);

  useEffect(() => {
    loadStats();
    loadCompanies();
    loadOps(0, 0, true);
    const iv = setInterval(() => loadOps(0, 0, true), 15_000);
    return () => clearInterval(iv);
  }, [loadStats, loadCompanies, loadOps]);

  const loadMore  = () => loadOps(sysOffset, agentOffset, false);
  const positions = orbitPositions(companies.length);
  const groups    = groupByDay(ops);

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden"
      style={{ fontFamily: "'JetBrains Mono','Consolas',monospace" }}>

      {/* Top bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-b border-border/40">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground tracking-widest">
          PROPLY<span className="text-muted-foreground/40 mx-1">/</span>MIND
        </div>
        <div className="text-[11px] text-muted-foreground/50 tracking-wide">{codename}</div>
      </div>

      {/* Content area */}
      <div className="flex-1 relative overflow-hidden">

        {/* Brain + orbit canvas — fades when ops expanded */}
        <div
          ref={canvasContainerRef}
          className="absolute inset-0"
          style={{
            opacity: opsExpanded ? 0 : 1,
            pointerEvents: opsExpanded ? "none" : "auto",
            transition: "opacity 400ms",
            cursor: dragging ? "grabbing" : "default",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* Pannable + zoomable layer */}
          <div
            className="absolute inset-0"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: "center center", willChange: "transform" }}
          >
            {/* SVG connection lines — violet */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <g style={{ transform: "translate(50%, 50%)" }}>
                {companies.map((co, i) => {
                  const pos = positions[i];
                  if (!pos) return null;
                  const off  = cardOffsets[co.id] ?? { x: 0, y: 0 };
                  const effX = pos.x + off.x;
                  const effY = pos.y + off.y;
                  const active = selected?.name === co.name || draggingCardId === co.id;
                  return (
                    <line key={co.id}
                      x1={0} y1={0} x2={effX} y2={effY}
                      stroke="#8b5cf6"
                      strokeWidth={active ? 1.5 : 0.8}
                      strokeDasharray="3 6"
                      strokeOpacity={active ? 0.55 : 0.2}
                      style={active ? { animation: "flowLine 1.4s linear infinite" } : undefined}
                    />
                  );
                })}
              </g>
            </svg>

            {/* Brain — centered */}
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
              style={{ zIndex: 4 }}
            >
              <button
                onClick={() => setShowConnect(true)}
                className="mb-1.5 flex items-center gap-1.5"
                onPointerDown={e => e.stopPropagation()}
              >
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor: isOnline ? "#4ade80" : "#ef4444",
                    boxShadow: isOnline ? "0 0 5px #4ade80" : "0 0 5px #ef4444",
                  }} />
                <span className="text-[10px] tracking-widest" style={{ color: isOnline ? "#4ade80" : "#ef4444" }}>
                  {isOnline ? "ONLINE" : "OFFLINE"}
                </span>
                <span className="text-[10px] ml-0.5" style={{ color: isOnline ? "#4ade8066" : "#ef444466" }}>›</span>
              </button>

              <BrainCanvas />
            </div>

            {/* Company cards — individually draggable, persists in session */}
            {companies.map((co, i) => {
              const pos = positions[i];
              if (!pos) return null;
              const off  = cardOffsets[co.id] ?? { x: 0, y: 0 };
              const effX = pos.x + off.x;
              const effY = pos.y + off.y;
              const isCardDragging = draggingCardId === co.id;
              return (
                <div key={co.id} className="absolute"
                  style={{
                    left: "50%", top: "50%",
                    transform: `translate(calc(-50% + ${effX}px), calc(-50% + ${effY}px))`,
                    zIndex: isCardDragging ? 20 : selected?.name === co.name ? 10 : 3,
                    cursor: isCardDragging ? "grabbing" : "grab",
                    filter: isCardDragging ? "drop-shadow(0 4px 20px rgba(139,92,246,0.3))" : undefined,
                  }}
                  onPointerDown={e => handleCardPointerDown(e, co)}
                  onPointerMove={handleCardPointerMove}
                  onPointerUp={handleCardPointerUp}
                  onPointerCancel={handleCardPointerUp}
                >
                  <CompanyCard
                    company={co}
                    active={selected?.name === co.name}
                    onEnter={() => setSelected(co)}
                    onLeave={() => setSelected(null)}
                    onContactEnter={showDossier}
                    onContactLeave={scheduleDossierHide}
                  />
                </div>
              );
            })}
          </div>

          {/* Stats panel — fixed, not panned */}
          <div
            className="absolute right-6 top-1/2 -translate-y-[60%] flex flex-col gap-3 text-right text-[11px] pointer-events-none"
            style={{ zIndex: 20 }}
          >
            {[
              { label: "TOTAL OPS",    value: (totalOps > 0 ? totalOps : ops.length).toLocaleString() },
              { label: "COMPANIES",    value: companies.length.toLocaleString() },
              { label: "PEOPLE",       value: stats.contacts.toLocaleString() },
              { label: "INTEGRATIONS", value: stats.integrations.toLocaleString() },
              { label: "MEMORIES",     value: stats.memories.toLocaleString() },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="text-muted-foreground/40 text-[9px] tracking-widest mb-0.5">{label}</div>
                <div className="text-foreground/70 tabular-nums">{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Ops drawer */}
        <div className="absolute left-0 right-0 bottom-0 flex flex-col bg-background border-t border-border/40 transition-all duration-400 ease-in-out"
          style={{ height: opsExpanded ? "100%" : "168px" }}>

          <div className="flex-shrink-0 flex items-center justify-between px-6 py-2 border-b border-border/30">
            <span className="flex items-center gap-2 text-[10px] text-muted-foreground tracking-widest">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              LIVE OP LOG
            </span>
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                {totalOps > 0 ? totalOps.toLocaleString() : ops.length.toLocaleString()} ops total
              </span>
              <button onClick={() => setOpsExpanded(e => !e)}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border/60 hover:border-border">
                {opsExpanded
                  ? <><ChevronDown className="h-3 w-3" /> collapse</>
                  : <><ChevronUp   className="h-3 w-3" /> expand</>}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {!opsExpanded ? (
              <div className="px-6 py-2 space-y-1.5">
                {ops.slice(0, 6).map(op => (
                  <div key={op.id} className="flex items-baseline gap-4 group">
                    <span className="text-[10px] text-muted-foreground/50 w-24 flex-shrink-0 tabular-nums">
                      {format(new Date(op.ts), "HH:mm:ss.SSS")}
                    </span>
                    <span className="text-[11px] w-52 flex-shrink-0 truncate" style={{ color: op.color }}>{op.name}</span>
                    <span className="text-[11px] text-muted-foreground/60 group-hover:text-foreground flex-1 truncate transition-colors">{op.detail}</span>
                    <span className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 font-mono ${op.source === "mcp" || op.source === "agent" ? "text-emerald-500/60 bg-emerald-500/8" : op.source === "sdk" ? "text-violet-500/60 bg-violet-500/8" : op.source === "api" ? "text-sky-500/60 bg-sky-500/8" : "text-blue-500/60 bg-blue-500/8"}`}>
                      {op.source}
                    </span>
                  </div>
                ))}
                {ops.length === 0 && <div className="text-[10px] text-muted-foreground/40 py-2">waiting for operations...</div>}
              </div>
            ) : (
              <div>
                {groups.map(group => (
                  <div key={group.label}>
                    <div className="flex items-center gap-3 px-6 py-2 border-b border-border/20 bg-muted/20 sticky top-0">
                      <span className="text-[10px] text-muted-foreground/60 tracking-widest">{group.label}</span>
                      <span className="text-[10px] text-muted-foreground/30">{group.ops.length} ops</span>
                    </div>
                    {group.ops.map(op => (
                      <div key={op.id} className="flex items-baseline gap-4 px-6 py-2 border-b border-border/10 hover:bg-muted/20 transition-colors group">
                        <span className="text-[10px] text-muted-foreground/50 w-24 flex-shrink-0 tabular-nums">
                          {format(new Date(op.ts), "HH:mm:ss.SSS")}
                        </span>
                        <span className="text-[11px] w-52 flex-shrink-0 truncate" style={{ color: op.color }}>{op.name}</span>
                        <span className="text-[11px] text-muted-foreground/60 group-hover:text-foreground flex-1 truncate transition-colors">{op.detail}</span>
                        <span className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 font-mono ${op.source === "mcp" || op.source === "agent" ? "text-emerald-500/60 bg-emerald-500/8" : op.source === "sdk" ? "text-violet-500/60 bg-violet-500/8" : op.source === "api" ? "text-sky-500/60 bg-sky-500/8" : "text-blue-500/60 bg-blue-500/8"}`}>
                          {op.source}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
                {hasMore && (
                  <div className="flex justify-center py-4">
                    <button onClick={loadMore} disabled={loadingMore}
                      className="flex items-center gap-2 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded border border-border/60 hover:border-border">
                      {loadingMore ? <RefreshCw className="h-3 w-3 animate-spin" /> : <ChevronDown className="h-3 w-3" />}
                      {loadingMore ? "loading..." : "load more"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showConnect && <ConnectModal onClose={() => setShowConnect(false)} />}

      {hoveredContact && (
        <ContactDossier
          contact={hoveredContact.contact}
          rect={hoveredContact.rect}
          onMouseEnter={cancelDossierHide}
          onMouseLeave={hideDossierNow}
          onClick={() => {
            hideDossierNow();
            const q = hoveredContact.contact.email ?? hoveredContact.contact.name;
            navigate(`/people?q=${encodeURIComponent(q)}`);
          }}
        />
      )}

      <style>{`
        @keyframes flowLine {
          to { stroke-dashoffset: -18; }
        }
      `}</style>
    </div>
  );
}

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@/contexts/ThemeContext";
import { format, isToday, isYesterday, startOfDay } from "date-fns";
import { X, ExternalLink, ChevronUp, ChevronDown, RefreshCw, Copy, Check, Sun, Moon, LogOut } from "lucide-react";
import { systemLogOpName, agentOpName, OP_COLORS } from "@/lib/operationName";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

// ─── Codename (workspace session id shown in settings) ───────────────────────

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
  seniority: string | null;
  companyId: string | null;
  companyName: string | null;
  lastActivityAt: string | null;
}

interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  contactCount: number;
  contacts: ContactInfo[];
  dealHealthScore: number | null;
}

interface IntegrationConn {
  id: string;
  name: string;
  is_verified: boolean;
  provider: { display_name: string; logo_url?: string; category?: string } | null;
}

interface MemoryFact {
  id: string;
  category: string;
  content: string;
  created_at: string;
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

function healthColor(h: number | null) {
  if (h === null) return "#6b7280";
  return h >= 70 ? "#4ade80" : h >= 40 ? "#facc15" : "#f87171";
}

function initials(name: string) {
  return name.split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
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

// ─── Card offsets (pixels from canvas center to card center) ─────────────────
// Matching CSS positions so canvas lines land exactly at card edges.

const CARD_POSITIONS = {
  companies:    { dx: -295, dy: -195 },
  people:       { dx:  295, dy: -195 },
  integrations: { dx: -255, dy:  188 },
  memories:     { dx:  255, dy:  188 },
};

// ─── BrainCanvas ─────────────────────────────────────────────────────────────

const BRAIN_CHARS = ['@', '#', '0', 'O', 'o', '*', '+', '·'];

function BrainCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H * 0.42;
    const rcx = cx + 34, rcy = cy, lcx = cx - 34, lcy = cy;
    const lw = 82, lh = 72, STEP = 9, FISSURE = STEP * 0.8;

    function getDensity(px: number, py: number): number {
      const ar = Math.atan2(py - rcy, px - rcx);
      const al = Math.atan2(py - lcy, px - lcx);
      const br = 1 + 0.09 * Math.sin(ar * 6) + 0.05 * Math.sin(ar * 13 + 1.2);
      const bl = 1 + 0.09 * Math.sin(al * 6 + 0.8) + 0.05 * Math.sin(al * 13);
      const dr = ((px - rcx) / (lw * br)) ** 2 + ((py - rcy) / (lh * br)) ** 2;
      const dl = ((px - lcx) / (lw * bl)) ** 2 + ((py - lcy) / (lh * bl)) ** 2;
      return Math.min(dr, dl) < 1 ? (1 - Math.min(dr, dl)) ** 0.5 : -1;
    }

    function inSulcus(px: number, py: number, den: number): boolean {
      if (den < 0.12) return false;
      const SW = 3.2;
      if (px > cx + FISSURE) {
        const lx = px - rcx, ly = py - rcy;
        if (Math.abs(ly - (-27 + Math.sin(lx / 18) * 8)) < SW) return true;
        if (Math.abs(ly - (6 + lx * 0.16 + Math.sin(lx / 22) * 9)) < SW - 0.5) return true;
        if (Math.abs(ly - (34 + Math.sin(lx / 16) * 6)) < SW - 1) return true;
      }
      if (px < cx - FISSURE) {
        const lx = lcx - px, ly = py - lcy;
        if (Math.abs(ly - (-27 + Math.sin(lx / 18) * 8)) < SW) return true;
        if (Math.abs(ly - (6 + lx * 0.16 + Math.sin(lx / 22) * 9)) < SW - 0.5) return true;
        if (Math.abs(ly - (34 + Math.sin(lx / 16) * 6)) < SW - 1) return true;
      }
      return false;
    }

    function drawSulciLines(breathe: number) {
      ctx.strokeStyle = `rgba(80,40,180,${(0.08 + breathe * 0.06).toFixed(2)})`;
      ctx.lineWidth = 0.9; ctx.lineCap = 'round';
      const sulciR: [number,number,number,number,number,number,number,number][] = [
        [rcx-22,rcy-27,rcx+10,rcy-30,rcx+42,rcy-24,rcx+62,rcy-20],
        [rcx-16,rcy+6, rcx+18,rcy+2, rcx+46,rcy+14,rcx+62,rcy+22],
        [rcx-18,rcy+34,rcx+12,rcy+32,rcx+40,rcy+38,rcx+56,rcy+42],
      ];
      const sulciL: [number,number,number,number,number,number,number,number][] = [
        [lcx+22,lcy-27,lcx-10,lcy-30,lcx-42,lcy-24,lcx-62,lcy-20],
        [lcx+16,lcy+6, lcx-18,lcy+2, lcx-46,lcy+14,lcx-62,lcy+22],
        [lcx+18,lcy+34,lcx-12,lcy+32,lcx-40,lcy+38,lcx-56,lcy+42],
      ];
      for (const [x1,y1,cx1,cy1,cx2,cy2,x2,y2] of [...sulciR,...sulciL]) {
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.bezierCurveTo(cx1,cy1,cx2,cy2,x2,y2); ctx.stroke();
      }
    }

    let t = 0;
    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `${STEP}px 'JetBrains Mono','Consolas',monospace`;
      const breathe = (Math.sin(t * 0.38) + 1) / 2;
      for (let gx = STEP; gx <= W - STEP / 2; gx += STEP) {
        for (let gy = STEP; gy <= H - 28; gy += STEP) {
          const den = getDensity(gx, gy);
          if (den < 0 || Math.abs(gx - cx) < FISSURE || inSulcus(gx, gy, den)) continue;
          const distR = Math.sqrt((gx-rcx)**2 + ((gy-rcy)*1.15)**2);
          const distL = Math.sqrt((gx-lcx)**2 + ((gy-lcy)*1.15)**2);
          const gyri  = Math.cos(Math.min(distR,distL)*0.21 + t*0.06) * 0.22;
          const nx    = Math.sin(gx*0.13+t*0.7) * Math.cos(gy*0.10+t*0.55);
          const ci    = Math.max(0, Math.min(BRAIN_CHARS.length-1, Math.floor(((1-den)+gyri*0.5+nx*0.18+0.04)*BRAIN_CHARS.length)));
          const char  = BRAIN_CHARS[ci];
          if (char === '·' && Math.random() > 0.6) continue;
          const alpha = Math.max(0.05, Math.min(0.84, 0.10+den*0.56+breathe*0.18+gyri*0.08+nx*0.06));
          ctx.fillStyle = `rgba(139,92,246,${alpha.toFixed(2)})`;
          ctx.fillText(char, gx, gy);
        }
      }
      drawSulciLines(breathe);
      ctx.font = `8px 'JetBrains Mono','Consolas',monospace`;
      ctx.fillStyle = `rgba(139,92,246,${(0.28 + breathe * 0.14).toFixed(2)})`;
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

// ─── MindLines — canvas that draws animated lines brain → cards ──────────────

function MindLines({ pulse }: { pulse: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; });
    ro.observe(canvas);
    canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const bx = W / 2, by = H / 2;
    const alpha = 0.10 + pulse * 0.08;
    ctx.strokeStyle = `rgba(139,92,246,${alpha.toFixed(2)})`;
    ctx.lineWidth   = 0.8;
    for (const { dx, dy } of Object.values(CARD_POSITIONS)) {
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + dx, by + dy);
      ctx.stroke();
    }
  });

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />;
}

// ─── Aggregate card shell ─────────────────────────────────────────────────────

function AggCard({
  tag, title, footer, onFooterClick, children,
}: {
  tag: string;
  title: string;
  footer: string;
  onFooterClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="border border-border/55 bg-background/97 shadow-lg select-none"
      style={{ width: 198, fontFamily: "'JetBrains Mono','Consolas',monospace" }}
    >
      <div className="px-2.5 pt-2 pb-1.5 border-b border-border/30">
        <div className="text-[8px] text-muted-foreground/30 tracking-widest">{tag}</div>
        <div className="text-[11px] text-foreground/85 mt-0.5 leading-tight">§ {title}</div>
      </div>
      <div className="py-0.5">{children}</div>
      <button
        onClick={onFooterClick}
        className="w-full px-2.5 py-1.5 text-left border-t border-border/20 flex items-center justify-between group hover:bg-muted/20 transition-colors"
      >
        <span className="text-[9px] text-muted-foreground/35 group-hover:text-muted-foreground/70 transition-colors">{footer}</span>
        <ExternalLink className="h-2.5 w-2.5 text-muted-foreground/25 group-hover:text-muted-foreground/50 transition-colors" />
      </button>
    </div>
  );
}

// ─── CompaniesAggCard ─────────────────────────────────────────────────────────

function CompaniesAggCard({ companies, total, onOpen }: { companies: Company[]; total: number; onOpen: () => void }) {
  const top = [...companies].sort((a, b) => (b.dealHealthScore ?? 0) - (a.dealHealthScore ?? 0)).slice(0, 5);
  return (
    <AggCard tag="COMPANIES" title="Companies" footer={`${total} total — click to explore`} onFooterClick={onOpen}>
      {top.map(co => (
        <div key={co.id} className="flex items-center gap-1.5 px-2.5 py-1">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: healthColor(co.dealHealthScore) }} />
          <span className="text-[10px] text-foreground/70 truncate flex-1">{co.name}</span>
          <span className="text-[9px] text-muted-foreground/35 flex-shrink-0">{co.contactCount}</span>
        </div>
      ))}
      {top.length === 0 && <div className="px-2.5 py-1.5 text-[9px] text-muted-foreground/30 italic">no companies yet</div>}
    </AggCard>
  );
}

// ─── PeopleAggCard ────────────────────────────────────────────────────────────

function PeopleAggCard({ contacts, total, onOpen }: { contacts: ContactInfo[]; total: number; onOpen: () => void }) {
  const top = [...contacts].sort((a, b) => (b.icpScore ?? 0) - (a.icpScore ?? 0)).slice(0, 5);
  return (
    <AggCard tag="PEOPLE" title="People" footer={`${total} total — click to explore`} onFooterClick={onOpen}>
      {top.map(c => (
        <div key={c.id} className="px-2.5 py-1">
          <div className="text-[10px] text-foreground/70 truncate leading-tight">{c.name}</div>
          {(c.title || c.companyName) && (
            <div className="text-[8px] text-muted-foreground/35 truncate leading-tight">{c.title ?? c.companyName}</div>
          )}
        </div>
      ))}
      {top.length === 0 && <div className="px-2.5 py-1.5 text-[9px] text-muted-foreground/30 italic">no contacts yet</div>}
    </AggCard>
  );
}

// ─── IntegrationsAggCard ──────────────────────────────────────────────────────

function IntegrationsAggCard({ integrations, onOpen }: { integrations: IntegrationConn[]; onOpen: () => void }) {
  const connected = integrations.filter(i => i.is_verified);
  return (
    <AggCard tag="INTEGRATIONS" title="Integrations" footer={`${connected.length} connected — click to explore`} onFooterClick={onOpen}>
      {connected.slice(0, 5).map(conn => (
        <div key={conn.id} className="flex items-center gap-1.5 px-2.5 py-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60 flex-shrink-0" />
          <span className="text-[10px] text-foreground/70 truncate">{conn.provider?.display_name ?? conn.name}</span>
        </div>
      ))}
      {integrations.filter(i => !i.is_verified).slice(0, 2).map(conn => (
        <div key={conn.id} className="flex items-center gap-1.5 px-2.5 py-1">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/25 flex-shrink-0" />
          <span className="text-[10px] text-muted-foreground/40 truncate">{conn.provider?.display_name ?? conn.name}</span>
        </div>
      ))}
      {integrations.length === 0 && <div className="px-2.5 py-1.5 text-[9px] text-muted-foreground/30 italic">no integrations yet</div>}
    </AggCard>
  );
}

// ─── MemoriesAggCard ──────────────────────────────────────────────────────────

function MemoriesAggCard({
  categories, total, onOpen,
}: {
  categories: { name: string; count: number }[];
  total: number;
  onOpen: () => void;
}) {
  const maxCount = categories[0]?.count ?? 1;
  return (
    <AggCard tag="MEMORIES" title="Memories" footer={`${total} facts — click to explore`} onFooterClick={onOpen}>
      {categories.slice(0, 5).map(cat => (
        <div key={cat.name} className="px-2.5 py-0.5 flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground/50 w-16 truncate capitalize">{cat.name.toLowerCase()}</span>
          <div className="flex-1 h-0.5 bg-muted/30 rounded-full overflow-hidden">
            <div className="h-full bg-violet-500/40 rounded-full" style={{ width: `${(cat.count / maxCount) * 100}%` }} />
          </div>
          <span className="text-[9px] text-muted-foreground/40 w-4 text-right flex-shrink-0">{cat.count}</span>
        </div>
      ))}
      {categories.length === 0 && <div className="px-2.5 py-1.5 text-[9px] text-muted-foreground/30 italic">no memories yet</div>}
    </AggCard>
  );
}

// ─── PopupModal ───────────────────────────────────────────────────────────────

function PopupModal({
  label, onClose, width = 440, children,
}: {
  label: string;
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-background border border-border shadow-2xl flex flex-col"
        style={{ width, maxHeight: 540, fontFamily: "'JetBrains Mono','Consolas',monospace" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/40 flex-shrink-0">
          <span className="text-[9px] text-muted-foreground/40 tracking-widest">{label}</span>
          <button onClick={onClose} className="text-muted-foreground/40 hover:text-foreground/70 transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// ─── CompaniesPopup ───────────────────────────────────────────────────────────

function CompaniesPopup({ companies, onClose, onNavigate }: { companies: Company[]; onClose: () => void; onNavigate: () => void }) {
  const [q, setQ] = useState("");
  const filtered = companies.filter(co => !q || co.name.toLowerCase().includes(q.toLowerCase()) || (co.industry ?? "").toLowerCase().includes(q.toLowerCase()));
  const sorted = [...filtered].sort((a, b) => (b.dealHealthScore ?? 0) - (a.dealHealthScore ?? 0));
  return (
    <PopupModal label="PROPLY / MIND / COMPANIES" onClose={onClose} width={460}>
      <div className="px-4 py-2.5 border-b border-border/20 flex-shrink-0">
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="search companies..."
          className="w-full bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/30 outline-none"
          autoFocus
        />
      </div>
      <div className="divide-y divide-border/10">
        {sorted.map(co => (
          <div key={co.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-px" style={{ backgroundColor: healthColor(co.dealHealthScore) }} />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-foreground/80 truncate">{co.name}</div>
              {co.industry && <div className="text-[9px] text-muted-foreground/40 truncate">{co.industry}</div>}
            </div>
            <span className="text-[9px] text-muted-foreground/40 flex-shrink-0">{co.contactCount} contacts</span>
            {co.dealHealthScore !== null && <span className="text-[9px] tabular-nums flex-shrink-0" style={{ color: healthColor(co.dealHealthScore) }}>{co.dealHealthScore}</span>}
          </div>
        ))}
        {sorted.length === 0 && <div className="px-4 py-6 text-[11px] text-muted-foreground/30 text-center">no results</div>}
      </div>
      <div className="border-t border-border/20 px-4 py-2.5 flex-shrink-0">
        <button onClick={() => { onNavigate(); onClose(); }} className="text-[10px] text-muted-foreground/50 hover:text-foreground/80 transition-colors flex items-center gap-1">
          Open Companies page <ExternalLink className="h-2.5 w-2.5" />
        </button>
      </div>
    </PopupModal>
  );
}

// ─── PeoplePopup ──────────────────────────────────────────────────────────────

function PeoplePopup({ contacts, onClose, onSelect }: { contacts: ContactInfo[]; onClose: () => void; onSelect: (c: ContactInfo) => void }) {
  const [q, setQ] = useState("");
  const filtered = contacts.filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()) || (c.email ?? "").toLowerCase().includes(q.toLowerCase()) || (c.companyName ?? "").toLowerCase().includes(q.toLowerCase()));
  const stageColor = (s: string) =>
    s === "client" ? "#4ade80" : s === "evaluating" ? "#60a5fa" : s === "interested" ? "#fb923c" : s === "aware" ? "#facc15" : "#9ca3af";
  return (
    <PopupModal label="PROPLY / MIND / PEOPLE" onClose={onClose} width={480}>
      <div className="px-4 py-2.5 border-b border-border/20">
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="search people..."
          className="w-full bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/30 outline-none"
          autoFocus
        />
      </div>
      <div className="divide-y divide-border/10">
        {filtered.slice(0, 100).map(c => (
          <button key={c.id} onClick={() => { onSelect(c); onClose(); }}
            className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-muted/20 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-foreground/80 truncate">{c.name}</div>
              {(c.title || c.companyName) && <div className="text-[9px] text-muted-foreground/40 truncate">{[c.title, c.companyName].filter(Boolean).join(" · ")}</div>}
            </div>
            <span className="text-[9px] flex-shrink-0" style={{ color: stageColor(c.pipelineStage) }}>{c.pipelineStage}</span>
            {c.icpScore !== null && <span className="text-[9px] text-muted-foreground/40 flex-shrink-0 tabular-nums">{c.icpScore}</span>}
          </button>
        ))}
        {filtered.length === 0 && <div className="px-4 py-6 text-[11px] text-muted-foreground/30 text-center">no results</div>}
      </div>
      {filtered.length > 100 && (
        <div className="border-t border-border/20 px-4 py-2 text-[9px] text-muted-foreground/30 text-center">
          showing 100 of {filtered.length} — refine search to narrow down
        </div>
      )}
    </PopupModal>
  );
}

// ─── IntegrationsPopup ────────────────────────────────────────────────────────

function IntegrationsPopup({ integrations, onClose, onNavigate }: { integrations: IntegrationConn[]; onClose: () => void; onNavigate: () => void }) {
  return (
    <PopupModal label="PROPLY / MIND / INTEGRATIONS" onClose={onClose} width={420}>
      <div className="divide-y divide-border/10">
        {integrations.map(conn => (
          <div key={conn.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${conn.is_verified ? "bg-emerald-500/70" : "bg-muted-foreground/25"}`} />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-foreground/80">{conn.provider?.display_name ?? conn.name}</div>
              {conn.provider?.category && <div className="text-[9px] text-muted-foreground/35">{conn.provider.category}</div>}
            </div>
            <span className={`text-[9px] ${conn.is_verified ? "text-emerald-500/60" : "text-muted-foreground/30"}`}>
              {conn.is_verified ? "connected" : "needs auth"}
            </span>
          </div>
        ))}
        {integrations.length === 0 && <div className="px-4 py-8 text-[11px] text-muted-foreground/30 text-center">no integrations configured</div>}
      </div>
      <div className="border-t border-border/20 px-4 py-2.5">
        <button onClick={() => { onNavigate(); onClose(); }} className="text-[10px] text-muted-foreground/50 hover:text-foreground/80 transition-colors flex items-center gap-1">
          Manage integrations <ExternalLink className="h-2.5 w-2.5" />
        </button>
      </div>
    </PopupModal>
  );
}

// ─── MemoriesPopup ────────────────────────────────────────────────────────────

function MemoriesPopup({
  memories, categories, onClose, onNavigate,
}: {
  memories: MemoryFact[];
  categories: { name: string; count: number }[];
  onClose: () => void;
  onNavigate: () => void;
}) {
  const [activecat, setActivecat] = useState<string | null>(null);
  const maxCount = categories[0]?.count ?? 1;
  const shown = activecat ? memories.filter(m => m.category === activecat) : memories;
  return (
    <PopupModal label="PROPLY / MIND / MEMORIES" onClose={onClose} width={500}>
      {/* Category overview */}
      <div className="px-4 py-3 border-b border-border/20 space-y-1.5">
        {categories.map(cat => (
          <button key={cat.name} onClick={() => setActivecat(p => p === cat.name ? null : cat.name)}
            className={`w-full flex items-center gap-2 py-0.5 group transition-opacity ${activecat && activecat !== cat.name ? "opacity-30" : ""}`}>
            <span className="text-[9px] text-muted-foreground/50 capitalize w-20 text-left flex-shrink-0">{cat.name.toLowerCase()}</span>
            <div className="flex-1 h-0.5 bg-muted/30 rounded-full overflow-hidden">
              <div className="h-full bg-violet-500/50 rounded-full transition-all" style={{ width: `${(cat.count / maxCount) * 100}%` }} />
            </div>
            <span className="text-[9px] text-muted-foreground/40 w-6 text-right flex-shrink-0 tabular-nums">{cat.count}</span>
          </button>
        ))}
      </div>
      {/* Facts */}
      <div className="divide-y divide-border/10">
        {shown.slice(0, 30).map(m => (
          <div key={m.id} className="px-4 py-2.5">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-[8px] text-muted-foreground/30 tracking-widest capitalize">{m.category?.toLowerCase()}</span>
              <span className="text-[8px] text-muted-foreground/25">{format(new Date(m.created_at), "MMM d")}</span>
            </div>
            <div className="text-[10px] text-foreground/65 leading-relaxed">{m.content}</div>
          </div>
        ))}
        {shown.length === 0 && <div className="px-4 py-6 text-[11px] text-muted-foreground/30 text-center">no facts in this category</div>}
      </div>
      <div className="border-t border-border/20 px-4 py-2.5">
        <button onClick={() => { onNavigate(); onClose(); }} className="text-[10px] text-muted-foreground/50 hover:text-foreground/80 transition-colors flex items-center gap-1">
          Open Memories page <ExternalLink className="h-2.5 w-2.5" />
        </button>
      </div>
    </PopupModal>
  );
}

// ─── SettingsPopup ────────────────────────────────────────────────────────────

function SettingsPopup({ onClose }: { onClose: () => void }) {
  const { userData, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const isAdmin  = userData?.user?.is_admin === true;

  const go = (path: string) => { navigate(path); onClose(); };
  const handleSignOut = async () => { try { await signOut(); } catch { /* ignore */ } onClose(); };

  const LINKS = [
    { label: "Workspace",    sub: "name, domain, plan",       path: "/settings" },
    { label: "Users",        sub: "team members & invites",   path: "/settings/users" },
    { label: "Billing",      sub: "plan, invoices, usage",    path: "/billing" },
    { label: "API Keys",     sub: "create & manage keys",     path: "/developer" },
    { label: "Integrations", sub: "connected services",       path: "/integrations" },
  ];

  return (
    <div className="fixed inset-0 z-[80]" onClick={onClose}>
      <div
        className="absolute left-3 top-12 w-72 bg-background border border-border shadow-2xl"
        style={{ fontFamily: "'JetBrains Mono','Consolas',monospace" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 pt-3 pb-2.5 border-b border-border/40">
          <div className="text-[9px] text-muted-foreground/40 tracking-widest">WORKSPACE</div>
          <div className="text-[12px] text-foreground mt-0.5">{userData?.workspace?.name ?? "—"}</div>
          <div className="text-[10px] text-muted-foreground/50 mt-0.5">{userData?.user?.email}</div>
          <div className="text-[9px] text-muted-foreground/25 mt-1 tracking-wider">{userData?.workspace?.id ? generateCodename(userData.workspace.id) : ""}</div>
        </div>
        <div className="py-1">
          {LINKS.map(l => (
            <button key={l.path} onClick={() => go(l.path)}
              className="w-full flex items-baseline gap-2 px-4 py-2 text-left hover:bg-muted/30 transition-colors">
              <span className="text-[11px] text-foreground/85 flex-shrink-0">{l.label}</span>
              <span className="text-[10px] text-muted-foreground/40 truncate">{l.sub}</span>
            </button>
          ))}
        </div>
        {isAdmin && (
          <div className="border-t border-border/30 py-1">
            <div className="px-4 py-1 text-[9px] text-muted-foreground/30 tracking-widest">ADMIN</div>
            {[
              { label: "CMS",       path: "/admin/cms" },
              { label: "Support",   path: "/admin/support" },
              { label: "Changelog", path: "/admin/changelog" },
              { label: "Roadmap",   path: "/admin/roadmap" },
              { label: "Affiliates",path: "/admin/affiliates" },
            ].map(l => (
              <button key={l.path} onClick={() => go(l.path)}
                className="w-full px-4 py-1.5 text-left text-[10px] text-muted-foreground/60 hover:text-foreground hover:bg-muted/20 transition-colors">
                {l.label}
              </button>
            ))}
          </div>
        )}
        <div className="border-t border-border/40 px-4 py-2.5 flex items-center justify-between">
          <button onClick={toggleTheme} className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors">
            {theme === "dark" ? <><Sun className="h-3 w-3" /> Light mode</> : <><Moon className="h-3 w-3" /> Dark mode</>}
          </button>
          <button onClick={handleSignOut} className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 hover:text-red-400 transition-colors">
            <LogOut className="h-3 w-3" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ConnectModal ─────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
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
            {(["mcp","sdk"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-[11px] rounded border transition-colors ${tab===t?"border-border bg-muted text-foreground":"border-border/40 text-muted-foreground hover:text-foreground hover:border-border"}`}>
                {t==="mcp"?"MCP Server":"Node SDK"}
              </button>
            ))}
          </div>
          {tab==="mcp" && (
            <div className="space-y-3">
              <div className="text-muted-foreground text-[11px]">Works with Claude Desktop, Cursor, Windsurf, and any MCP-compatible agent.</div>
              <div className="relative bg-muted/50 border border-border rounded p-3 text-[11px] text-foreground/70 whitespace-pre overflow-x-auto"><CopyButton text={MCP_CONFIG}/>{MCP_CONFIG}</div>
              <div className="text-muted-foreground/50 text-[10px]">Get your API key → Settings → API Keys</div>
            </div>
          )}
          {tab==="sdk" && (
            <div className="space-y-3">
              <div className="text-muted-foreground text-[11px]">Use the Node SDK to query contact intelligence from any TypeScript or JavaScript workflow.</div>
              <div className="relative bg-muted/50 border border-border rounded p-3 text-[11px] text-foreground/70 whitespace-pre overflow-x-auto"><CopyButton text={SDK_SNIPPET}/>{SDK_SNIPPET}</div>
              <div className="text-muted-foreground/50 text-[10px]">Get your API key → Settings → API Keys</div>
            </div>
          )}
          <div className="border-t border-border/40 pt-4 flex items-center justify-between">
            <span className="text-muted-foreground/50 text-[10px]">The Mind goes online once it receives its first agent call.</span>
            <a href="/settings" className="text-[11px] text-muted-foreground/60 hover:text-foreground/80 transition-colors flex items-center gap-1">API Keys <ExternalLink className="h-3 w-3"/></a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Popup = "companies" | "people" | "integrations" | "memories" | null;

export default function Mind() {
  const { userData, session } = useAuth();
  const navigate = useNavigate();
  const workspaceId = userData?.workspace?.id;
  const token       = session?.access_token;

  const [companies,     setCompanies]     = useState<Company[]>([]);
  const [allContacts,   setAllContacts]   = useState<ContactInfo[]>([]);
  const [integrations,  setIntegrations]  = useState<IntegrationConn[]>([]);
  const [memories,      setMemories]      = useState<MemoryFact[]>([]);
  const [ops,           setOps]           = useState<LiveOp[]>([]);
  const [totalOps,      setTotalOps]      = useState(0);
  const [isOnline,      setIsOnline]      = useState(false);
  const [opsExpanded,   setOpsExpanded]   = useState(false);
  const [loadingMore,   setLoadingMore]   = useState(false);
  const [sysOffset,     setSysOffset]     = useState(200);
  const [agentOffset,   setAgentOffset]   = useState(100);
  const [hasMore,       setHasMore]       = useState(true);
  const [showConnect,   setShowConnect]   = useState(false);
  const [showSettings,  setShowSettings]  = useState(false);
  const [popup,         setPopup]         = useState<Popup>(null);
  const [pulse,         setPulse]         = useState(0);

  // Breathing pulse for canvas lines
  useEffect(() => {
    let t = 0;
    const iv = setInterval(() => { t += 0.04; setPulse((Math.sin(t) + 1) / 2); }, 50);
    return () => clearInterval(iv);
  }, []);

  const memoriesCategories = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of memories) {
      const cat = m.category ?? "General";
      map.set(cat, (map.get(cat) ?? 0) + 1);
    }
    return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [memories]);

  const loadData = useCallback(async () => {
    if (!workspaceId || !token) return;
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const [coRes, ctRes, intRes, memRes] = await Promise.all([
        fetch(`${apiUrl}/api/companies/list?workspaceId=${workspaceId}`, { headers }),
        fetch(`${apiUrl}/api/contacts?workspaceId=${workspaceId}&limit=500`, { headers }),
        fetch(`${apiUrl}/api/workflow-providers/connections?workspace_id=${workspaceId}`, { headers }),
        fetch(`${apiUrl}/api/workspace/memories?workspaceId=${workspaceId}&limit=200`, { headers }),
      ]);

      const coData  = coRes.ok  ? await coRes.json()  : {};
      const ctData  = ctRes.ok  ? await ctRes.json()  : {};
      const intData = intRes.ok ? await intRes.json() : {};
      const memData = memRes.ok ? await memRes.json() : {};

      const byCompany = new Map<string, ContactInfo[]>();
      const contactList: ContactInfo[] = [];
      for (const c of (ctData.contacts ?? [])) {
        const info: ContactInfo = {
          id:            c.id,
          name:          [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "—",
          email:         c.email          ?? null,
          title:         c.job_title      ?? null,
          pipelineStage: c.pipeline_stage ?? "identified",
          icpScore:      c.icp_score      ?? null,
          seniority:     c.seniority      ?? null,
          companyId:     c.company_id     ?? null,
          companyName:   c.company        ?? null,
          lastActivityAt: c.last_activity_at ?? null,
        };
        contactList.push(info);
        if (c.company_id) {
          const arr = byCompany.get(c.company_id) ?? [];
          arr.push(info);
          byCompany.set(c.company_id, arr);
        }
      }

      const coList: Company[] = (coData.companies ?? []).map((co: any) => ({
        id: co.id, name: co.name, domain: co.domain ?? null,
        industry: co.industry ?? null,
        contactCount: byCompany.get(co.id)?.length ?? 0,
        contacts: byCompany.get(co.id) ?? [],
        dealHealthScore: co.deal_health_score ?? null,
      }));

      setCompanies(coList);
      setAllContacts(contactList);
      setIntegrations(intData.connections ?? []);
      setMemories(memData.memories ?? []);
    } catch { /* silent */ }
  }, [workspaceId, token]);

  const loadOps = useCallback(async (sysOff = 0, agentOff = 0, reset = true) => {
    if (!workspaceId || !token) return;
    if (!reset) setLoadingMore(true);
    try {
      const [sysRes, agentRes] = await Promise.all([
        fetch(`${apiUrl}/api/workspace/system-log?workspace_id=${workspaceId}&days=7&limit=200&offset=${sysOff}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiUrl}/api/requests/log?days=7&limit=100&offset=${agentOff}`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const sysData   = sysRes.ok   ? await sysRes.json()   : { events: [], total: 0 };
      const agentData = agentRes.ok ? await agentRes.json() : { requests: [], total: 0 };

      const sysOps: LiveOp[] = (sysData.events ?? []).map((e: any) => {
        const op = systemLogOpName(e.source, e.event_type, e.metadata);
        const src = (["mcp", "sdk", "api"].includes(e.source) ? e.source : "system") as LiveOp["source"];
        return { id: e.id, ts: e.occurred_at, name: op.name, color: OP_COLORS[op.color], detail: e.summary || e.source, source: src };
      });
      const agentOps: LiveOp[] = (agentData.requests ?? []).map((r: any) => {
        const op = agentOpName(r.op_type, r.entity_type);
        const src = (["mcp", "sdk", "api"].includes(r.source) ? r.source : "agent") as LiveOp["source"];
        return { id: r.id, ts: r.created_at, name: op.name, color: OP_COLORS[op.color], detail: r.summary || r.entity_type, source: src };
      });
      const seen = new Set<string>();
      const batch = [...sysOps, ...agentOps]
        .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
        .filter(op => { if (seen.has(op.id)) return false; seen.add(op.id); return true; });

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
    loadData();
    loadOps(0, 0, true);
    const iv = setInterval(() => loadOps(0, 0, true), 15_000);
    return () => clearInterval(iv);
  }, [loadData, loadOps]);

  const loadMore = () => loadOps(sysOffset, agentOffset, false);
  const groups   = groupByDay(ops);

  const workspaceName = userData?.workspace?.name ?? "Workspace";
  const userEmail     = userData?.user?.email ?? "";
  const userInitials  = initials(userEmail.split("@")[0] || "?");

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden"
      style={{ fontFamily: "'JetBrains Mono','Consolas',monospace" }}>

      {/* ── Top bar ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-border/40">
        {/* Left: avatar + workspace name → settings */}
        <button
          onClick={() => setShowSettings(s => !s)}
          className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
        >
          <div className="w-6 h-6 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
            <span className="text-[9px] text-violet-400/80 font-bold tracking-tight">{userInitials}</span>
          </div>
          <div className="text-left">
            <div className="text-[11px] text-foreground/80 leading-tight">{workspaceName}</div>
            <div className="text-[9px] text-muted-foreground/40 leading-tight tracking-widest">MIND</div>
          </div>
        </button>

        {/* Right: ⌘K hint + online status */}
        <div className="flex items-center gap-4">
          <span className="text-[10px] text-muted-foreground/25 hidden sm:block">⌘K</span>
          <button
            onClick={() => setShowConnect(true)}
            className="flex items-center gap-1.5"
          >
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: isOnline ? "#4ade80" : "#ef4444", boxShadow: isOnline ? "0 0 5px #4ade80" : "0 0 5px #ef4444" }} />
            <span className="text-[10px] tracking-widest" style={{ color: isOnline ? "#4ade80" : "#ef4444" }}>
              {isOnline ? "ONLINE" : "OFFLINE"}
            </span>
          </button>
        </div>
      </div>

      {/* ── Content area ── */}
      <div className="flex-1 relative overflow-hidden">

        {/* Graph area */}
        <div
          className="absolute inset-0 transition-opacity duration-400"
          style={{ opacity: opsExpanded ? 0 : 1, pointerEvents: opsExpanded ? "none" : "auto", bottom: 168 }}
        >
          {/* Animated lines canvas — brain → aggregate cards */}
          <MindLines pulse={pulse} />

          {/* Brain — fixed at center */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ zIndex: 10 }}>
            <BrainCanvas />
          </div>

          {/* ── Companies card — NW ── */}
          <div className="absolute" style={{
            left:      `calc(50% + ${CARD_POSITIONS.companies.dx}px)`,
            top:       `calc(50% + ${CARD_POSITIONS.companies.dy}px)`,
            transform: "translate(-50%, -50%)",
            zIndex:    5,
          }}>
            <CompaniesAggCard companies={companies} total={companies.length} onOpen={() => setPopup("companies")} />
          </div>

          {/* ── People card — NE ── */}
          <div className="absolute" style={{
            left:      `calc(50% + ${CARD_POSITIONS.people.dx}px)`,
            top:       `calc(50% + ${CARD_POSITIONS.people.dy}px)`,
            transform: "translate(-50%, -50%)",
            zIndex:    5,
          }}>
            <PeopleAggCard contacts={allContacts} total={allContacts.length} onOpen={() => setPopup("people")} />
          </div>

          {/* ── Integrations card — SW ── */}
          <div className="absolute" style={{
            left:      `calc(50% + ${CARD_POSITIONS.integrations.dx}px)`,
            top:       `calc(50% + ${CARD_POSITIONS.integrations.dy}px)`,
            transform: "translate(-50%, -50%)",
            zIndex:    5,
          }}>
            <IntegrationsAggCard integrations={integrations} onOpen={() => setPopup("integrations")} />
          </div>

          {/* ── Memories card — SE ── */}
          <div className="absolute" style={{
            left:      `calc(50% + ${CARD_POSITIONS.memories.dx}px)`,
            top:       `calc(50% + ${CARD_POSITIONS.memories.dy}px)`,
            transform: "translate(-50%, -50%)",
            zIndex:    5,
          }}>
            <MemoriesAggCard categories={memoriesCategories} total={memories.length} onOpen={() => setPopup("memories")} />
          </div>

          {/* ── Stats — right side ── */}
          <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col gap-3 text-right" style={{ zIndex: 20 }}>
            {/* Total Ops → expand drawer */}
            <button
              onClick={() => setOpsExpanded(e => !e)}
              className="text-right group transition-opacity opacity-70 hover:opacity-100"
            >
              <div className="text-muted-foreground/40 text-[9px] tracking-widest mb-0.5 group-hover:text-muted-foreground/70 transition-colors">TOTAL OPS</div>
              <div className="text-foreground/70 tabular-nums text-[11px] group-hover:text-foreground transition-colors">{(totalOps > 0 ? totalOps : ops.length).toLocaleString()}</div>
            </button>

            {([
              { label: "COMPANIES",    value: companies.length,    popup: "companies"    as Popup },
              { label: "PEOPLE",       value: allContacts.length,  popup: "people"       as Popup },
              { label: "INTEGRATIONS", value: integrations.filter(i => i.is_verified).length, popup: "integrations" as Popup },
              { label: "MEMORIES",     value: memories.length,     popup: "memories"     as Popup },
            ]).map(({ label, value, popup: p }) => (
              <button
                key={label}
                onClick={() => setPopup(q => q === p ? null : p)}
                className={`text-right group transition-opacity ${popup === p ? "opacity-100" : "opacity-70 hover:opacity-100"}`}
              >
                <div className="text-muted-foreground/40 text-[9px] tracking-widest mb-0.5 group-hover:text-muted-foreground/70 transition-colors">{label}</div>
                <div className="text-foreground/70 tabular-nums text-[11px] group-hover:text-foreground transition-colors">{value.toLocaleString()}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Ops drawer ── */}
        <div className="absolute left-0 right-0 bottom-0 flex flex-col bg-background border-t border-border/40 transition-all duration-400 ease-in-out"
          style={{ height: opsExpanded ? "100%" : "168px" }}>

          <div className="flex-shrink-0 flex items-center justify-between px-6 py-2 border-b border-border/30 relative z-10 bg-background">
            <span className="flex items-center gap-2 text-[10px] text-muted-foreground tracking-widest">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              LIVE OP LOG
            </span>
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                {(totalOps > 0 ? totalOps : ops.length).toLocaleString()} ops total
              </span>
              <button onClick={() => setOpsExpanded(e => !e)}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border/60 hover:border-border">
                {opsExpanded ? <><ChevronDown className="h-3 w-3"/>collapse</> : <><ChevronUp className="h-3 w-3"/>expand</>}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {!opsExpanded ? (
              <div className="px-6 py-2 space-y-1.5">
                {ops.slice(0, 6).map(op => (
                  <div key={op.id} className="flex items-baseline gap-4 group">
                    <span className="text-[10px] text-muted-foreground/50 w-24 flex-shrink-0 tabular-nums">{format(new Date(op.ts), "HH:mm:ss.SSS")}</span>
                    <span className="text-[11px] w-52 flex-shrink-0 truncate" style={{ color: op.color }}>{op.name}</span>
                    <span className="text-[11px] text-muted-foreground/60 group-hover:text-foreground flex-1 truncate transition-colors">{op.detail}</span>
                    <span className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 font-mono ${op.source==="mcp"||op.source==="agent"?"text-emerald-500/60 bg-emerald-500/8":op.source==="sdk"?"text-violet-500/60 bg-violet-500/8":op.source==="api"?"text-sky-500/60 bg-sky-500/8":"text-blue-500/60 bg-blue-500/8"}`}>
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
                    <div className="flex items-center gap-3 px-6 py-2 border-b border-border/20 bg-background sticky top-0 z-[5]">
                      <span className="text-[10px] text-muted-foreground/60 tracking-widest">{group.label}</span>
                      <span className="text-[10px] text-muted-foreground/30">{group.ops.length} ops</span>
                    </div>
                    {group.ops.map(op => (
                      <div key={op.id} className="flex items-baseline gap-4 px-6 py-2 border-b border-border/10 hover:bg-muted/20 transition-colors group">
                        <span className="text-[10px] text-muted-foreground/50 w-24 flex-shrink-0 tabular-nums">{format(new Date(op.ts), "HH:mm:ss.SSS")}</span>
                        <span className="text-[11px] w-52 flex-shrink-0 truncate" style={{ color: op.color }}>{op.name}</span>
                        <span className="text-[11px] text-muted-foreground/60 group-hover:text-foreground flex-1 truncate transition-colors">{op.detail}</span>
                        <span className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 font-mono ${op.source==="mcp"||op.source==="agent"?"text-emerald-500/60 bg-emerald-500/8":op.source==="sdk"?"text-violet-500/60 bg-violet-500/8":op.source==="api"?"text-sky-500/60 bg-sky-500/8":"text-blue-500/60 bg-blue-500/8"}`}>
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
                      {loadingMore ? <RefreshCw className="h-3 w-3 animate-spin"/> : <ChevronDown className="h-3 w-3"/>}
                      {loadingMore ? "loading..." : "load more"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Modals & popups ── */}
      {showConnect  && <ConnectModal  onClose={() => setShowConnect(false)} />}
      {showSettings && <SettingsPopup onClose={() => setShowSettings(false)} />}

      {popup === "companies" && (
        <CompaniesPopup
          companies={companies}
          onClose={() => setPopup(null)}
          onNavigate={() => navigate("/companies")}
        />
      )}
      {popup === "people" && (
        <PeoplePopup
          contacts={allContacts}
          onClose={() => setPopup(null)}
          onSelect={c => { const q = c.email ?? c.name; navigate(`/people?q=${encodeURIComponent(q)}`); }}
        />
      )}
      {popup === "integrations" && (
        <IntegrationsPopup
          integrations={integrations}
          onClose={() => setPopup(null)}
          onNavigate={() => navigate("/integrations")}
        />
      )}
      {popup === "memories" && (
        <MemoriesPopup
          memories={memories}
          categories={memoriesCategories}
          onClose={() => setPopup(null)}
          onNavigate={() => navigate("/memories")}
        />
      )}
    </div>
  );
}

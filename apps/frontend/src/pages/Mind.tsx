import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@/contexts/ThemeContext";
import { format, isToday, isYesterday, startOfDay, formatDistanceToNow } from "date-fns";
import { X, ExternalLink, ChevronUp, ChevronDown, ChevronLeft, RefreshCw, Copy, Check, Sun, Moon, LogOut, Plus, ChevronRight, ArrowLeft, Phone, FileText, Mail, MessageSquare, Linkedin, Trash2 } from "lucide-react";
import { systemLogOpName, agentOpName, OP_COLORS } from "@/lib/operationName";
import { toast } from "@/components/ui/sonner";

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
  icpFit: boolean | null;
  seniority: string | null;
  companyId: string | null;
  companyName: string | null;
  domain: string | null;
  linkedinUrl: string | null;
  lastActivityAt: string | null;
  dealHealthScore: number | null;
  dealStage: string | null;
  dealValue: number | null;
  source: string | null;
  segmentLabel: string | null;
  firstContact: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  department: string | null;
  createdAt: string | null;
}

interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  revenueRange: string | null;
  contactCount: number;
  contacts: ContactInfo[];
  dealHealthScore: number | null;
  lastActivityAt: string | null;
  employeeCount: number | null;
}

interface IntegrationConn {
  id: string;
  name: string;
  is_verified: boolean;
  provider: { display_name: string; logo_url?: string; category?: string; name?: string } | null;
}

interface AvailableProvider {
  id: string;
  name: string;
  display_name: string;
  logo_url?: string;
  category?: string;
  description?: string;
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

interface Workspace {
  id: string;
  name: string;
  icon?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function healthColor(h: number | null) {
  if (h === null) return "#6b7280";
  return h >= 70 ? "#4ade80" : h >= 40 ? "#facc15" : "#f87171";
}

function initials(name: string) {
  return name.split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function stageColor(s: string) {
  return s === "client" ? "#4ade80" : s === "evaluating" ? "#60a5fa" : s === "interested" ? "#fb923c" : s === "aware" ? "#facc15" : "#9ca3af";
}

function dayLabel(date: Date) {
  if (isToday(date))     return "TODAY";
  if (isYesterday(date)) return "YESTERDAY";
  return format(date, "MMM d, yyyy").toUpperCase();
}

function groupByDay(ops: LiveOp[]) {
  const map = new Map<string, LiveOp[]>();
  for (const op of ops) {
    const d = new Date(op.ts);
    if (isNaN(d.getTime())) continue;
    const key = startOfDay(d).toISOString();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(op);
  }
  return [...map.entries()].map(([, grpOps]) => ({ label: dayLabel(new Date(grpOps[0].ts)), ops: grpOps }));
}

// ─── Mind state ───────────────────────────────────────────────────────────────

type MindStateType = "active" | "idle" | "sleeping";

// ─── Card offsets from canvas center → card center ────────────────────────────

const CARD_POSITIONS = {
  attention: { dx: -295, dy: -195 },
  decay:     { dx:  295, dy: -195 },
  pattern:   { dx: -335, dy:   10 },
  icp:       { dx:  335, dy:   10 },
  signals:   { dx: -295, dy:  205 },
  backlog:   { dx:    0, dy:  262 },
  nextsteps: { dx:  295, dy:  205 },
};

// ─── BrainCanvas ─────────────────────────────────────────────────────────────

const BRAIN_CHARS = ['@', '#', '0', 'O', 'o', '*', '+', '·'];

function BrainCanvas({ mindState }: { mindState: MindStateType }) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const animRef    = useRef<number>(0);
  const stateRef   = useRef<MindStateType>(mindState);
  stateRef.current = mindState;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H * 0.42;
    const rcx = cx + 34, rcy = cy, lcx = cx - 34, lcy = cy;
    const lw = 82, lh = 72, STEP = 9, FISSURE = STEP * 0.8;

    function getColors() {
      const s = stateRef.current;
      if (s === "active")   return { r:249, g:115, b:22,  sr:180, sg:70,  sb:10 };
      if (s === "sleeping") return { r:107, g:114, b:128, sr:60,  sg:65,  sb:75 };
      return                       { r:74,  g:222, b:128, sr:20,  sg:130, sb:60  };
    }

    function getDensity(px: number, py: number) {
      const ar = Math.atan2(py-rcy,px-rcx), al = Math.atan2(py-lcy,px-lcx);
      const br = 1+0.09*Math.sin(ar*6)+0.05*Math.sin(ar*13+1.2);
      const bl = 1+0.09*Math.sin(al*6+0.8)+0.05*Math.sin(al*13);
      const dr = ((px-rcx)/(lw*br))**2+((py-rcy)/(lh*br))**2;
      const dl = ((px-lcx)/(lw*bl))**2+((py-lcy)/(lh*bl))**2;
      const d  = Math.min(dr,dl);
      return d < 1 ? (1-d)**0.5 : -1;
    }
    function inSulcus(px: number, py: number, den: number) {
      if (den < 0.12) return false;
      const SW = 3.2;
      if (px > cx+FISSURE) {
        const lx = px-rcx, ly = py-rcy;
        if (Math.abs(ly-(-27+Math.sin(lx/18)*8))<SW) return true;
        if (Math.abs(ly-(6+lx*0.16+Math.sin(lx/22)*9))<SW-0.5) return true;
        if (Math.abs(ly-(34+Math.sin(lx/16)*6))<SW-1) return true;
      }
      if (px < cx-FISSURE) {
        const lx = lcx-px, ly = py-lcy;
        if (Math.abs(ly-(-27+Math.sin(lx/18)*8))<SW) return true;
        if (Math.abs(ly-(6+lx*0.16+Math.sin(lx/22)*9))<SW-0.5) return true;
        if (Math.abs(ly-(34+Math.sin(lx/16)*6))<SW-1) return true;
      }
      return false;
    }
    function drawSulciLines(breathe: number) {
      const { sr, sg, sb } = getColors();
      ctx.strokeStyle=`rgba(${sr},${sg},${sb},${(0.08+breathe*0.06).toFixed(2)})`;
      ctx.lineWidth=0.9; ctx.lineCap='round';
      const sulciR:any[]=[[rcx-22,rcy-27,rcx+10,rcy-30,rcx+42,rcy-24,rcx+62,rcy-20],[rcx-16,rcy+6,rcx+18,rcy+2,rcx+46,rcy+14,rcx+62,rcy+22],[rcx-18,rcy+34,rcx+12,rcy+32,rcx+40,rcy+38,rcx+56,rcy+42]];
      const sulciL:any[]=[[lcx+22,lcy-27,lcx-10,lcy-30,lcx-42,lcy-24,lcx-62,lcy-20],[lcx+16,lcy+6,lcx-18,lcy+2,lcx-46,lcy+14,lcx-62,lcy+22],[lcx+18,lcy+34,lcx-12,lcy+32,lcx-40,lcy+38,lcx-56,lcy+42]];
      for (const [x1,y1,c1x,c1y,c2x,c2y,x2,y2] of [...sulciR,...sulciL]) {
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.bezierCurveTo(c1x,c1y,c2x,c2y,x2,y2); ctx.stroke();
      }
    }
    let t = 0;
    function draw() {
      ctx.clearRect(0,0,W,H);
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.font=`${STEP}px 'JetBrains Mono',monospace`;
      const breathe=(Math.sin(t*0.38)+1)/2;
      const { r, g, b } = getColors();
      for (let gx=STEP;gx<=W-STEP/2;gx+=STEP) {
        for (let gy=STEP;gy<=H-28;gy+=STEP) {
          const den=getDensity(gx,gy);
          if (den<0||Math.abs(gx-cx)<FISSURE||inSulcus(gx,gy,den)) continue;
          const distR=Math.sqrt((gx-rcx)**2+((gy-rcy)*1.15)**2);
          const distL=Math.sqrt((gx-lcx)**2+((gy-lcy)*1.15)**2);
          const gyri=Math.cos(Math.min(distR,distL)*0.21+t*0.06)*0.22;
          const nx=Math.sin(gx*0.13+t*0.7)*Math.cos(gy*0.10+t*0.55);
          const ci=Math.max(0,Math.min(BRAIN_CHARS.length-1,Math.floor(((1-den)+gyri*0.5+nx*0.18+0.04)*BRAIN_CHARS.length)));
          const char=BRAIN_CHARS[ci];
          if (char==='·'&&Math.random()>0.6) continue;
          const alpha=Math.max(0.05,Math.min(0.84,0.10+den*0.56+breathe*0.18+gyri*0.08+nx*0.06));
          ctx.fillStyle=`rgba(${r},${g},${b},${alpha.toFixed(2)})`;
          ctx.fillText(char,gx,gy);
        }
      }
      drawSulciLines(breathe);
      ctx.font=`8px 'JetBrains Mono',monospace`;
      ctx.fillStyle=`rgba(${r},${g},${b},${(0.28+breathe*0.14).toFixed(2)})`;
      ctx.fillText('M · I · N · D',cx,H-9);
      t+=0.022;
      animRef.current=requestAnimationFrame(draw);
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

function MindLines({ pulse, mindState }: { pulse: number; mindState: MindStateType }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ro = new ResizeObserver(() => { canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight; });
    ro.observe(canvas); canvas.width=canvas.offsetWidth; canvas.height=canvas.offsetHeight;
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const W=canvas.width, H=canvas.height;
    ctx.clearRect(0,0,W,H);
    const [r,g,b] = mindState==="active" ? [249,115,22] : mindState==="sleeping" ? [107,114,128] : [74,222,128];
    ctx.strokeStyle=`rgba(${r},${g},${b},${(0.10+pulse*0.09).toFixed(2)})`;
    ctx.lineWidth=0.8;
    for (const { dx, dy } of Object.values(CARD_POSITIONS)) {
      ctx.beginPath(); ctx.moveTo(W/2,H/2); ctx.lineTo(W/2+dx,H/2+dy); ctx.stroke();
    }
  });
  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />;
}

// ─── Insight card shell ───────────────────────────────────────────────────────

function InsightCard({ tag, onExpand, accentColor, children }: {
  tag: string; onExpand?: () => void; accentColor?: string; children: React.ReactNode;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div className="border border-border/55 bg-background/97 shadow-lg select-none transition-all duration-200"
      style={{ width: 198, fontFamily: "'JetBrains Mono',monospace",
        ...(hov && accentColor ? { borderColor:`${accentColor}99`, boxShadow:`0 0 9px ${accentColor}30` } : {}) }}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}>
      <div className="px-2.5 pt-1.5 pb-1 border-b border-border/25">
        <div className="text-[8px] text-muted-foreground/30 tracking-widest">{tag}</div>
      </div>
      <div className="py-0.5">{children}</div>
      {onExpand && (
        <button onClick={onExpand}
          className="w-full px-2.5 py-1.5 text-left border-t border-border/20 flex items-center justify-between group hover:bg-muted/20 transition-colors">
          <span className="text-[9px] text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors">view all</span>
          <ExternalLink className="h-2.5 w-2.5 text-muted-foreground/20 group-hover:text-muted-foreground/45 transition-colors" />
        </button>
      )}
    </div>
  );
}

// ATTENTION — most recently active contacts
function AttentionCard({ contacts, onOpen, accentColor }: { contacts: ContactInfo[]; onOpen: () => void; accentColor?: string }) {
  const now = Date.now();
  const recent = [...contacts]
    .filter(c => c.lastActivityAt)
    .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""))
    .slice(0, 5);
  return (
    <InsightCard tag="ATTENTION" onExpand={onOpen} accentColor={accentColor}>
      {recent.map(c => {
        const days = Math.floor((now - new Date(c.lastActivityAt!).getTime()) / 86400000);
        const age = days === 0 ? "today" : days === 1 ? "1d" : `${days}d`;
        return (
          <div key={c.id} className="flex items-center gap-1.5 px-2.5 py-0.5">
            <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: stageColor(c.pipelineStage) }} />
            <span className="text-[10px] text-foreground/65 truncate flex-1">{c.name}</span>
            <span className="text-[9px] text-muted-foreground/35 tabular-nums flex-shrink-0">{age}</span>
          </div>
        );
      })}
      {recent.length === 0 && <div className="px-2.5 py-2 text-[9px] text-muted-foreground/25 italic">no recent activity</div>}
    </InsightCard>
  );
}

// DECAY — active-stage contacts going silent
function DecayCard({ contacts, onOpen, accentColor }: { contacts: ContactInfo[]; onOpen: () => void; accentColor?: string }) {
  const now = Date.now();
  const decaying = contacts
    .filter(c => ["interested","evaluating"].includes(c.pipelineStage) && c.lastActivityAt)
    .map(c => ({ ...c, days: Math.floor((now - new Date(c.lastActivityAt!).getTime()) / 86400000) }))
    .filter(c => c.days >= 5)
    .sort((a, b) => b.days - a.days)
    .slice(0, 5);
  return (
    <InsightCard tag="DECAY" onExpand={onOpen} accentColor={accentColor}>
      {decaying.map(c => (
        <div key={c.id} className="flex items-center gap-1.5 px-2.5 py-0.5">
          <span className="text-[10px] text-foreground/65 truncate flex-1">{c.name}</span>
          <span className="text-[9px] tabular-nums flex-shrink-0 font-medium"
            style={{ color: c.days > 21 ? "#f87171" : c.days > 10 ? "#fb923c" : "#facc15" }}>
            {c.days}d
          </span>
        </div>
      ))}
      {decaying.length === 0 && <div className="px-2.5 py-2 text-[9px] text-muted-foreground/25 italic">no silent deals</div>}
    </InsightCard>
  );
}

// SIGNALS — computed pipeline intelligence
function SignalsCard({ contacts, companies, accentColor }: { contacts: ContactInfo[]; companies: Company[]; accentColor?: string }) {
  const now = Date.now();
  const evaluating  = contacts.filter(c => c.pipelineStage === "evaluating").length;
  const newThisWeek = contacts.filter(c => c.createdAt && now - new Date(c.createdAt).getTime() < 7*86400000).length;
  const highIcp     = contacts.filter(c => (c.icpScore ?? 0) >= 70).length;
  const goneDark    = contacts.filter(c => ["interested","evaluating"].includes(c.pipelineStage) && c.lastActivityAt && now - new Date(c.lastActivityAt).getTime() > 14*86400000).length;
  const healthScores = companies.filter(c => c.dealHealthScore != null).map(c => c.dealHealthScore!);
  const avgHealth    = healthScores.length ? Math.round(healthScores.reduce((s,v)=>s+v,0)/healthScores.length) : null;

  const sigs = [
    { label: "deals evaluating",  value: evaluating  },
    { label: "contacts this week", value: newThisWeek },
    { label: "high ICP ≥70",      value: highIcp     },
    { label: "gone dark >14d",    value: goneDark    },
    ...(avgHealth != null ? [{ label: "avg deal health", value: avgHealth }] : []),
  ];
  return (
    <InsightCard tag="SIGNALS" accentColor={accentColor}>
      {sigs.slice(0,5).map((sig, i) => (
        <div key={i} className="flex items-baseline gap-1.5 px-2.5 py-0.5">
          <span className="text-[10px] tabular-nums text-foreground/70 w-7 text-right flex-shrink-0">{sig.value}</span>
          <span className="text-[9px] text-muted-foreground/45 truncate flex-1">{sig.label}</span>
        </div>
      ))}
    </InsightCard>
  );
}

// BACKLOG — ops throughput summary
function BacklogCard({ ops, onOpen, accentColor }: { ops: LiveOp[]; onOpen: () => void; accentColor?: string }) {
  const now   = Date.now();
  const today = ops.filter(op => now - new Date(op.ts).getTime() < 86400000);
  const agent  = today.filter(op => op.source === "agent" || op.source === "mcp").length;
  const system = today.filter(op => op.source === "system").length;
  const api    = today.filter(op => op.source === "api"   || op.source === "sdk").length;
  const lastOp = ops[0];
  const lastMins = lastOp ? Math.floor((now - new Date(lastOp.ts).getTime()) / 60000) : null;
  const lastLabel = lastMins == null ? null : lastMins < 1 ? "just now" : lastMins < 60 ? `${lastMins}m ago` : `${Math.floor(lastMins/60)}h ago`;
  return (
    <InsightCard tag="BACKLOG" onExpand={onOpen} accentColor={accentColor}>
      <div className="px-2.5 pt-1.5 pb-1">
        <span className="text-[12px] tabular-nums text-foreground/75 font-medium">{today.length}</span>
        <span className="text-[9px] text-muted-foreground/40 ml-1">ops today</span>
        {lastLabel && <div className="text-[8px] text-muted-foreground/30 mt-0.5">last: {lastLabel}</div>}
      </div>
      {([{label:"agent",value:agent,color:"#34d399"},{label:"system",value:system,color:"#60a5fa"},{label:"api/sdk",value:api,color:"#a78bfa"}] as const)
        .filter(r=>r.value>0).map(row=>(
        <div key={row.label} className="flex items-center gap-2 px-2.5 py-0.5">
          <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: row.color, opacity: 0.65 }} />
          <span className="text-[9px] text-muted-foreground/45">{row.label}</span>
          <span className="text-[9px] tabular-nums text-muted-foreground/55 ml-auto">{row.value}</span>
        </div>
      ))}
    </InsightCard>
  );
}

// NEXT STEPS — rule-based suggested actions
interface NextStep { action: string; name: string; urgency: number; }

function computeNextSteps(contacts: ContactInfo[]): NextStep[] {
  const now = Date.now();
  const steps: NextStep[] = [];
  for (const c of contacts) {
    const days = c.lastActivityAt ? Math.floor((now - new Date(c.lastActivityAt).getTime()) / 86400000) : 999;
    const icp  = c.icpScore ?? 40;
    if      (c.pipelineStage === "evaluating" && days >= 5)   steps.push({ action: "Follow up",  name: c.name, urgency: days * icp / 50 });
    else if (c.pipelineStage === "interested"  && days >= 10)  steps.push({ action: "Re-engage",  name: c.name, urgency: days * icp / 80 });
    else if (c.pipelineStage === "identified"  && days <= 3)   steps.push({ action: "Qualify",    name: c.name, urgency: 200 - days * 10 });
    else if (c.pipelineStage === "aware"       && days >= 7 && icp >= 60) steps.push({ action: "Reach out", name: c.name, urgency: icp });
    else if (c.pipelineStage === "client"      && days >= 30)  steps.push({ action: "Check in",   name: c.name, urgency: 30 });
  }
  return steps.sort((a, b) => b.urgency - a.urgency).slice(0, 5);
}

function NextStepsCard({ contacts, onOpen, accentColor }: { contacts: ContactInfo[]; onOpen: () => void; accentColor?: string }) {
  const steps = computeNextSteps(contacts);
  return (
    <InsightCard tag="NEXT STEPS" onExpand={onOpen} accentColor={accentColor}>
      {steps.map((s, i) => (
        <div key={i} className="flex items-baseline gap-1.5 px-2.5 py-0.5">
          <span className="text-[8px] text-violet-400/65 flex-shrink-0 w-14 truncate uppercase tracking-wide">{s.action}</span>
          <span className="text-[10px] text-foreground/65 truncate flex-1">{s.name}</span>
        </div>
      ))}
      {steps.length === 0 && <div className="px-2.5 py-2 text-[9px] text-muted-foreground/25 italic">pipeline is healthy</div>}
    </InsightCard>
  );
}

// ─── Memory pills (PATTERN + ICP) ────────────────────────────────────────────
// Each entry is a rounded pill chip — a different shape from the rectangular InsightCards

function MemoryPills({ tag, accent = "rgba(139,92,246,0.65)", accentColor, children }: {
  tag: string; accent?: string; accentColor?: string; children: React.ReactNode;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div className="select-none transition-all duration-200"
      style={{
        width: 192,
        fontFamily: "'JetBrains Mono',monospace",
        ...(hov && accentColor ? { filter: `drop-shadow(0 0 6px ${accentColor}30)` } : {}),
      }}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}>
      <div className="mb-1.5 px-1">
        <span className="text-[7px] tracking-[0.18em] uppercase" style={{ color: accent }}>{tag}</span>
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function MemoryPill({ date, content, accent }: { date: string; content: string; accent: string }) {
  return (
    <div className="flex items-baseline gap-2 px-2.5 py-1.5"
      style={{
        borderRadius: 99,
        border: `1px solid ${accent}`,
        background: `${accent}0e`,
      }}>
      <span className="text-[6.5px] text-muted-foreground/40 tabular-nums flex-shrink-0 uppercase tracking-wide">{date}</span>
      <span className="text-[8px] text-foreground/55 italic truncate min-w-0">{content}</span>
    </div>
  );
}

// PATTERN — workspace memories with category "pattern"
function PatternCard({ memories, accentColor }: { memories: MemoryFact[]; accentColor?: string }) {
  const accent = "rgba(139,92,246,0.65)";
  const items = memories.filter(m => m.category?.toLowerCase().includes("pattern")).slice(0, 3);
  return (
    <MemoryPills tag="PATTERN" accent={accent} accentColor={accentColor}>
      {items.map(m => (
        <MemoryPill key={m.id} accent={accent}
          date={new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          content={m.content} />
      ))}
      {items.length === 0 && (
        <div className="px-2.5 py-1.5 text-[8px] text-muted-foreground/25 italic"
          style={{ borderRadius: 99, border: `1px solid ${accent}30` }}>no pattern memories yet</div>
      )}
    </MemoryPills>
  );
}

// ICP — workspace memories with category "icp"
function IcpCard({ memories, accentColor }: { memories: MemoryFact[]; accentColor?: string }) {
  const accent = "rgba(52,211,153,0.65)";
  const items = memories.filter(m => m.category?.toLowerCase().includes("icp")).slice(0, 3);
  return (
    <MemoryPills tag="ICP" accent={accent} accentColor={accentColor}>
      {items.map(m => (
        <MemoryPill key={m.id} accent={accent}
          date={new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          content={m.content} />
      ))}
      {items.length === 0 && (
        <div className="px-2.5 py-1.5 text-[8px] text-muted-foreground/25 italic"
          style={{ borderRadius: 99, border: `1px solid ${accent}30` }}>no ICP memories yet</div>
      )}
    </MemoryPills>
  );
}

// ─── ActivityIcon ─────────────────────────────────────────────────────────────

function ActivityIcon({ source, type }: { source: string | null; type: string }) {
  const s = (source || "").toLowerCase();
  const t = (type || "").toLowerCase();
  const logo = (src: string) => (
    <img src={src} alt="" className="w-3.5 h-3.5 rounded-sm object-contain flex-shrink-0"
      onError={e=>{(e.target as HTMLImageElement).style.display="none";}} />
  );
  if (s === "linkedin"        || t.includes("linkedin"))          return <img src="/provider-logos/linkedin.png" alt="" className="w-3.5 h-3.5 rounded-sm object-contain flex-shrink-0" />;
  if (s === "gmail"           || s === "email" || s === "smtp" || t.includes("email")) return logo("/provider-logos/gmail.svg");
  if (s === "google_calendar" || s === "google-calendar"       || t.includes("calendar")) return logo("/provider-logos/google.svg");
  if (s === "slack"           || t.includes("slack"))             return logo("/provider-logos/slack.svg");
  if (s === "hubspot"         || t.includes("hubspot"))           return logo("/provider-logos/hubspot.svg");
  if (s === "fireflies"       || t.includes("fireflies"))         return logo("/provider-logos/fireflies.svg");
  if (s === "granola"         || t.includes("granola"))           return logo("/provider-logos/granola.svg");
  if (s === "fathom"          || t.includes("fathom"))            return logo("/provider-logos/fathom.svg");
  if (s === "calendly"        || t.includes("calendly"))          return logo("/provider-logos/calendly.svg");
  if (s === "apollo"          || t.includes("apollo"))            return logo("/provider-logos/apollo.svg");
  if (t.includes("meeting")   || t.includes("call"))              return <Phone className="w-3.5 h-3.5 text-muted-foreground/45 flex-shrink-0" />;
  if (t.includes("note")      || t.includes("manual"))            return <FileText className="w-3.5 h-3.5 text-muted-foreground/45 flex-shrink-0" />;
  return <MessageSquare className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />;
}

// ─── PeopleDetail — tabbed contact record inside a popup ─────────────────────

type DetailTab = "activity" | "emails" | "linkedin" | "slack" | "calls" | "notes" | "company" | "memory";

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d < 0) return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const PIPELINE_STAGES = ["identified","aware","interested","evaluating","client"];

function PeopleDetail({ contact, token, onBack }: { contact: ContactInfo; token: string; onBack: () => void }) {
  const [tab, setTab] = useState<DetailTab>("activity");
  const [loading, setLoading] = useState(true);
  const [acts, setActs] = useState<any[]>([]);
  const [mems, setMems] = useState<any[]>([]);
  const [raw, setRaw] = useState<any>(null);
  const [editingField, setEditingField] = useState<string|null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [localOverrides, setLocalOverrides] = useState<Record<string,string|null>>({});

  useEffect(() => {
    setLoading(true);
    fetch(`${apiUrl}/api/contacts/${contact.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setActs(d.activities ?? []); setMems(d.memories ?? []); setRaw(d.contact ?? null); } setLoading(false); })
      .catch(() => setLoading(false));
  }, [contact.id, token]);

  const patchContact = async (patchKey: string, value: string) => {
    setSaving(true);
    try {
      await fetch(`${apiUrl}/api/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [patchKey]: value || null }),
      });
      setLocalOverrides(prev => ({ ...prev, [patchKey]: value || null }));
    } catch { /* silent */ }
    finally { setSaving(false); setEditingField(null); }
  };

  const startEdit = (key: string, current: string | null) => {
    setEditingField(key); setEditValue(current ?? "");
  };

  const get = (patchKey: string, fallback: string | null | undefined) =>
    patchKey in localOverrides ? localOverrides[patchKey] : (fallback ?? null);

  const emails  = acts.filter(a => a.source === "gmail" || ["email_sent","email_opened","email_reply","email_bounced"].some(t => a.activity_type?.includes(t)));
  const linkedin = acts.filter(a => a.source === "linkedin" || a.activity_type?.includes("linkedin"));
  const slack   = acts.filter(a => a.source === "slack"    || a.activity_type?.includes("slack"));
  const calls   = acts.filter(a => ["call","meeting"].some(t => a.activity_type?.includes(t)));
  const notes   = acts.filter(a => ["note","manual","contact_created"].some(t => a.activity_type?.includes(t)));

  const TABS: { id: DetailTab; label: string; count?: number }[] = [
    { id:"activity",  label:"Activity",  count: acts.length    },
    { id:"emails",    label:"Emails",    count: emails.length  },
    { id:"linkedin",  label:"LinkedIn",  count: linkedin.length },
    { id:"slack",     label:"Slack",     count: slack.length   },
    { id:"calls",     label:"Calls",     count: calls.length   },
    { id:"notes",     label:"Notes",     count: notes.length   },
    { id:"company",   label:"Company"                          },
    { id:"memory",    label:"Memory",    count: mems.length    },
  ];

  const tabItems = tab==="activity" ? acts : tab==="emails" ? emails : tab==="linkedin" ? linkedin : tab==="slack" ? slack : tab==="calls" ? calls : tab==="notes" ? notes : [];

  return (
    <div className="flex flex-col" style={{ height:"75vh" }}>
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-5 pb-0">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={onBack} className="text-muted-foreground/40 hover:text-foreground/70 transition-colors flex-shrink-0">
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <h2 className="text-[17px] font-semibold text-foreground tracking-tight">{contact.name}</h2>
        </div>
        <div className="flex items-center gap-2 pl-7 mb-4 flex-wrap">
          {contact.email && <span className="text-[11px] text-muted-foreground/50">{contact.email}</span>}
          {contact.lastActivityAt && <span className="text-[10px] text-muted-foreground/30">· {relTime(contact.lastActivityAt)}</span>}
        </div>
        <div className="flex items-end border-b border-border/30 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1 mr-5 pb-2.5 text-[11px] border-b-2 transition-colors flex-shrink-0 ${
                tab===t.id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground/40 hover:text-foreground/70"
              }`}>
              {t.label}
              {t.count !== undefined && <span className={`text-[10px] ${tab===t.id ? "text-muted-foreground/50" : "text-muted-foreground/25"}`}>{t.count}</span>}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-muted-foreground/30">loading...</div>
      ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Main content */}
          <div className="flex-1 overflow-y-auto px-6 py-3">
            {(tab !== "company" && tab !== "memory") && (
              tabItems.length === 0
                ? <p className="text-[11px] text-muted-foreground/30 py-12 text-center">nothing here yet</p>
                : <div className="divide-y divide-border/10">
                    {tabItems.map((a: any) => {
                      // API returns: title (=description), subtitle (=actual message text), created_at, raw_data
                      const body = a.subtitle || a.raw_data?.text || a.raw_data?.body || null;
                      return (
                        <div key={a.id} className="py-3">
                          <div className="flex items-center gap-2.5 mb-1.5">
                            <ActivityIcon source={a.source} type={a.activity_type || ""} />
                            <span className="text-[9px] text-muted-foreground/45 tracking-wide flex-1 truncate">
                              {a.activity_type?.replace(/_/g," ").toLowerCase()}
                            </span>
                            <span className="text-[9px] text-muted-foreground/25 tabular-nums flex-shrink-0">{relTime(a.created_at || a.occurred_at)}</span>
                          </div>
                          {body && (
                            <p className="text-[11px] text-foreground/75 leading-relaxed pl-[26px]">{body}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
            )}
            {tab === "company" && (
              <div className="py-4 space-y-2">
                <div className="text-[14px] text-foreground/80">{contact.companyName ?? raw?.company ?? "—"}</div>
                {(contact.domain ?? raw?.domain) && <div className="text-[11px] text-muted-foreground/50">{contact.domain ?? raw?.domain}</div>}
              </div>
            )}
            {tab === "memory" && (
              mems.length === 0
                ? <p className="text-[11px] text-muted-foreground/30 py-12 text-center">no memories yet</p>
                : <div className="divide-y divide-border/10">
                    {mems.map((m: any) => (
                      <div key={m.id} className="py-3">
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-[8px] text-muted-foreground/30 tracking-widest capitalize">{m.category?.toLowerCase()}</span>
                          <span className="text-[8px] text-muted-foreground/20 ml-auto">{relTime(m.created_at)}</span>
                        </div>
                        <p className="text-[11px] text-foreground/65 leading-relaxed">{m.content}</p>
                      </div>
                    ))}
                  </div>
            )}
          </div>

          {/* Record Details sidebar — editable */}
          <div className="w-56 flex-shrink-0 border-l border-border/20 px-4 py-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[9px] text-muted-foreground/30 tracking-widest">RECORD DETAILS</span>
              {saving && <span className="text-[8px] text-violet-400/60">saving…</span>}
            </div>
            <div className="space-y-3">
              {([
                { label:"First Name",     key:"firstName",      val: get("firstName",      raw?.first_name)                },
                { label:"Last Name",      key:"lastName",       val: get("lastName",       raw?.last_name)                 },
                { label:"Email",          key:"email",          val: get("email",          contact.email)                  },
                { label:"Phone",          key:"phone",          val: get("phone",          contact.phone)                  },
                { label:"Job Title",      key:"jobTitle",       val: get("jobTitle",       contact.title)                  },
                { label:"Company",        key:"company",        val: get("company",        contact.companyName??raw?.company)},
                { label:"LinkedIn",       key:"linkedinUrl",    val: get("linkedinUrl",    contact.linkedinUrl)            },
                { label:"Pipeline Stage", key:"pipeline_stage", val: get("pipeline_stage", contact.pipelineStage), type:"select", opts: PIPELINE_STAGES },
                { label:"Deal Stage",     key:"dealStage",      val: get("dealStage",      contact.dealStage??raw?.deal_stage)},
                { label:"Deal Value",     key:"dealValue",      val: get("dealValue",      contact.dealValue!=null?String(contact.dealValue):null), type:"number" },
                { label:"Lead Source",    key:"lead_source",    val: get("lead_source",    contact.source??raw?.lead_source)},
                { label:"Industry",       key:"industry",       val: get("industry",       raw?.industry)                  },
                { label:"Department",     key:"department",     val: get("department",     contact.department)             },
                { label:"Seniority",      key:"seniority",      val: get("seniority",      contact.seniority)              },
                { label:"City",           key:"city",           val: get("city",           contact.city)                   },
                { label:"Country",        key:"country",        val: get("country",        contact.country)                },
                { label:"Notes",          key:"notes",          val: get("notes",          raw?.notes), type:"textarea"     },
              ] as { label:string; key:string; val:string|null; type?:string; opts?:string[] }[]).map(({ label, key, val, type, opts }) => {
                const isEditing = editingField === key;
                return (
                  <div key={key}>
                    <div className="text-[9px] text-muted-foreground/35 mb-0.5">{label}</div>
                    {isEditing ? (
                      type === "select" ? (
                        <select value={editValue} autoFocus
                          onChange={e => { setEditValue(e.target.value); patchContact(key, e.target.value); }}
                          className="w-full bg-background border border-violet-500/40 text-[11px] text-foreground px-1.5 py-0.5 outline-none">
                          {opts?.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : type === "textarea" ? (
                        <textarea value={editValue} autoFocus rows={3}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={() => patchContact(key, editValue)}
                          onKeyDown={e => { if (e.key==="Escape") setEditingField(null); }}
                          className="w-full bg-background border border-violet-500/40 text-[11px] text-foreground px-1.5 py-0.5 outline-none resize-none leading-relaxed" />
                      ) : (
                        <input type={type==="number"?"number":"text"} value={editValue} autoFocus
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={() => patchContact(key, editValue)}
                          onKeyDown={e => { if (e.key==="Enter") patchContact(key, editValue); if (e.key==="Escape") setEditingField(null); }}
                          className="w-full bg-background border border-violet-500/40 text-[11px] text-foreground px-1.5 py-0.5 outline-none" />
                      )
                    ) : (
                      <div onClick={() => startEdit(key, val)}
                        className={`text-[11px] leading-snug break-words cursor-pointer rounded px-1 -mx-1 py-0.5 transition-colors hover:bg-muted/30 ${val ? "text-foreground/75" : "text-muted-foreground/20 italic"}`}>
                        {val ?? "—"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Popups ────────────────────────────────────────────────────────────────────

function PopupModal({ label, onClose, children }: {
  label:string; onClose:()=>void; children:React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background border border-border shadow-2xl flex flex-col"
        style={{ width:Math.min(900, window.innerWidth-32), maxHeight:"88vh", fontFamily:"'JetBrains Mono',monospace" }}
        onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/40 flex-shrink-0">
          <span className="text-[9px] text-muted-foreground/40 tracking-widest">{label}</span>
          <button onClick={onClose} className="text-muted-foreground/40 hover:text-foreground/70 transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">{children}</div>
      </div>
    </div>
  );
}

// ── Companies ──────────────────────────────────────────────────────────────────

type CoTab = "overview" | "activity" | "memory";

type CoSort = { col: string; dir: "asc"|"desc" };

function CompaniesPopup({ companies, workspaceId, token, onClose }: { companies:Company[]; workspaceId:string; token:string; onClose:()=>void }) {
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<Company | null>(null);
  const [coTab, setCoTab] = useState<CoTab>("overview");
  const [coActs, setCoActs] = useState<any[]>([]);
  const [coMems, setCoMems] = useState<any[]>([]);
  const [coLoading, setCoLoading] = useState(false);
  // editable detail sidebar
  const [coEditField, setCoEditField] = useState<string|null>(null);
  const [coEditValue, setCoEditValue] = useState("");
  const [coSaving, setCoSaving] = useState(false);
  const [coLocalOverrides, setCoLocalOverrides] = useState<Record<string,string|null>>({});
  // list view
  const [coSort, setCoSort] = useState<CoSort>({ col:"dealHealthScore", dir:"desc" });
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    if (!detail) return;
    setCoActs([]); setCoMems([]); setCoLoading(true); setCoLocalOverrides({});
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      Promise.all(detail.contacts.slice(0,5).map(c =>
        fetch(`${apiUrl}/api/contacts/${c.id}`, { headers })
          .then(r => r.ok ? r.json() : null)
          .then(d => (d?.activities ?? []).map((a: any) => ({ ...a, contactName: c.name })))
          .catch(() => [])
      )).then(results => results.flat().sort((a:any,b:any) =>
        new Date(b.created_at||b.occurred_at||0).getTime() - new Date(a.created_at||a.occurred_at||0).getTime()
      )),
      fetch(`${apiUrl}/api/workspace/memories?workspaceId=${workspaceId}&company_id=${detail.id}&limit=50`, { headers })
        .then(r => r.ok ? r.json() : {})
        .then(d => d.memories ?? [])
        .catch(() => []),
    ]).then(([acts, mems]) => {
      setCoActs(acts); setCoMems(mems); setCoLoading(false);
    });
  }, [detail?.id]);

  const patchCompany = async (key: string, value: string) => {
    if (!detail) return;
    setCoSaving(true);
    try {
      await fetch(`${apiUrl}/api/companies/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type":"application/json", Authorization:`Bearer ${token}` },
        body: JSON.stringify({ [key]: value || null }),
      });
      setCoLocalOverrides(prev => ({ ...prev, [key]: value || null }));
    } catch { /* silent */ }
    finally { setCoSaving(false); setCoEditField(null); }
  };

  const getCoVal = (key: string, fallback: string|null|undefined) =>
    key in coLocalOverrides ? coLocalOverrides[key] : (fallback ?? null);


  const toggleSort = (col: string) => {
    setPage(0);
    setCoSort(prev => prev.col===col ? { col, dir:prev.dir==="asc"?"desc":"asc" } : { col, dir:"desc" });
  };

  const filtered = [...companies].filter(co =>
    !q || co.name.toLowerCase().includes(q.toLowerCase()) ||
    (co.domain??"").toLowerCase().includes(q.toLowerCase()) ||
    (co.industry??"").toLowerCase().includes(q.toLowerCase())
  );
  const sortedList = [...filtered].sort((a,b) => {
    let av: any, bv: any;
    if (coSort.col==="name")            { av=a.name; bv=b.name; }
    else if (coSort.col==="lastActivity"){ av=a.lastActivityAt??""; bv=b.lastActivityAt??""; }
    else if (coSort.col==="industry")   { av=a.industry??""; bv=b.industry??""; }
    else if (coSort.col==="employees")  { av=a.employeeCount??-1; bv=b.employeeCount??-1; }
    else if (coSort.col==="contacts")   { av=a.contactCount; bv=b.contactCount; }
    else                                 { av=a.dealHealthScore??-1; bv=b.dealHealthScore??-1; }
    if (av<bv) return coSort.dir==="asc"?-1:1;
    if (av>bv) return coSort.dir==="asc"?1:-1;
    return 0;
  });
  const totalPages = Math.ceil(sortedList.length / PAGE_SIZE);
  const pageRows = sortedList.slice(page*PAGE_SIZE, (page+1)*PAGE_SIZE);

  const SortHdr = ({ col, label, style, className }: { col:string; label:string; style?:React.CSSProperties; className?:string }) => (
    <button onClick={()=>toggleSort(col)} style={style}
      className={`text-[9px] tracking-widest flex-shrink-0 flex items-center gap-0.5 hover:text-foreground/60 transition-colors ${coSort.col===col?"text-foreground/50":"text-muted-foreground/35"} ${className??""}`}>
      {label}{coSort.col===col&&<span className="text-[7px]">{coSort.dir==="asc"?"▲":"▼"}</span>}
    </button>
  );

  if (detail) {
    const CO_TABS: { id: CoTab; label: string; count?: number }[] = [
      { id:"overview",  label:"Overview"                    },
      { id:"activity",  label:"Activity",  count:coActs.length },
      { id:"memory",    label:"Memory",    count:coMems.length },
    ];
    return (
      <PopupModal label="PROPLY / MIND / COMPANIES" onClose={onClose}>
        <div className="flex" style={{ height:"70vh" }}>
          {/* Main area */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <div className="flex-shrink-0 px-6 pt-5 pb-0">
              <div className="flex items-center gap-3 mb-1">
                <button onClick={() => { setDetail(null); setCoTab("overview"); }} className="text-muted-foreground/40 hover:text-foreground/70 transition-colors">
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
                <h2 className="text-[17px] font-semibold text-foreground">{getCoVal("name",detail.name)??detail.name}</h2>
                {detail.domain && <span className="text-[11px] text-muted-foreground/40">{detail.domain}</span>}
              </div>
              <div className="flex items-end border-b border-border/30 mt-3 overflow-x-auto">
                {CO_TABS.map(t => (
                  <button key={t.id} onClick={() => setCoTab(t.id)}
                    className={`flex items-center gap-1 mr-5 pb-2.5 text-[11px] border-b-2 transition-colors flex-shrink-0 ${
                      coTab===t.id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground/40 hover:text-foreground/70"
                    }`}>
                    {t.label}
                    {t.count !== undefined && <span className={`text-[10px] ${coTab===t.id?"text-muted-foreground/50":"text-muted-foreground/25"}`}>{t.count}</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {coLoading ? (
                <div className="flex items-center justify-center py-12 text-[11px] text-muted-foreground/30">loading…</div>
              ) : coTab === "overview" ? (
                <div>
                  {detail.contacts.length > 0 && (
                    <>
                      <div className="text-[9px] text-muted-foreground/30 tracking-widest mb-3">CONTACTS ({detail.contacts.length})</div>
                      <div className="divide-y divide-border/10">
                        {detail.contacts.map(c => (
                          <div key={c.id} className="flex items-center gap-4 py-2.5">
                            <div className="flex-1 min-w-0">
                              <div className="text-[11px] text-foreground/80">{c.name}</div>
                              {c.title && <div className="text-[9px] text-muted-foreground/40">{c.title}</div>}
                            </div>
                            <span className="text-[9px] flex-shrink-0" style={{color:stageColor(c.pipelineStage)}}>{c.pipelineStage}</span>
                            {c.icpScore!=null && <span className="text-[9px] text-muted-foreground/35 tabular-nums">{c.icpScore}</span>}
                            {c.lastActivityAt && <span className="text-[9px] text-muted-foreground/25 flex-shrink-0">{relTime(c.lastActivityAt)}</span>}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {detail.contacts.length === 0 && <p className="text-[11px] text-muted-foreground/30 py-8 text-center">no contacts yet</p>}
                </div>
              ) : coTab === "activity" ? (
                coActs.length === 0
                  ? <p className="text-[11px] text-muted-foreground/30 py-8 text-center">no activity yet</p>
                  : <div className="divide-y divide-border/10">
                      {coActs.slice(0,50).map((a:any, i:number) => {
                        const body = a.subtitle || a.raw_data?.text || a.raw_data?.body || null;
                        return (
                          <div key={a.id ?? i} className="py-3">
                            <div className="flex items-center gap-2.5 mb-1">
                              <ActivityIcon source={a.source} type={a.activity_type||""} />
                              <span className="text-[9px] text-muted-foreground/45 flex-1 truncate">{a.activity_type?.replace(/_/g," ").toLowerCase()}</span>
                              <span className="text-[9px] text-violet-400/40 flex-shrink-0">{a.contactName}</span>
                              <span className="text-[9px] text-muted-foreground/25 tabular-nums flex-shrink-0">{relTime(a.created_at||a.occurred_at)}</span>
                            </div>
                            {body && <p className="text-[11px] text-foreground/70 leading-relaxed pl-[26px]">{body}</p>}
                          </div>
                        );
                      })}
                    </div>
              ) : (
                coMems.length === 0
                  ? <p className="text-[11px] text-muted-foreground/30 py-8 text-center">no memories yet</p>
                  : <div className="divide-y divide-border/10">
                      {coMems.map((m:any) => (
                        <div key={m.id} className="py-3">
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className="text-[8px] text-muted-foreground/30 tracking-widest capitalize">{m.category?.toLowerCase()}</span>
                            <span className="text-[8px] text-muted-foreground/20 ml-auto">{relTime(m.created_at)}</span>
                          </div>
                          <p className="text-[11px] text-foreground/65 leading-relaxed">{m.content}</p>
                        </div>
                      ))}
                    </div>
              )}
            </div>
          </div>
          {/* Right sidebar — editable */}
          <div className="w-56 flex-shrink-0 border-l border-border/20 px-4 py-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[9px] text-muted-foreground/30 tracking-widest">RECORD DETAILS</span>
              {coSaving && <span className="text-[8px] text-violet-400/60">saving…</span>}
            </div>
            <div className="space-y-3">
              {([
                { label:"Name",          key:"name",           val: getCoVal("name", detail.name) },
                { label:"Domain",        key:"domain",         val: getCoVal("domain", detail.domain) },
                { label:"Industry",      key:"industry",       val: getCoVal("industry", detail.industry) },
                { label:"Employees",     key:"employee_count", val: getCoVal("employee_count", detail.employeeCount!=null?String(detail.employeeCount):null), type:"number" },
                { label:"Location",      key:"location",       val: getCoVal("location", detail.location) },
                { label:"Revenue Range", key:"revenue_range",  val: getCoVal("revenue_range", detail.revenueRange) },
                { label:"Deal Health",   key:"_ro_health",     val: detail.dealHealthScore!=null?`${detail.dealHealthScore}/100`:null },
                { label:"Contacts",      key:"_ro_contacts",   val: String(detail.contactCount) },
                { label:"Last Activity", key:"_ro_last",       val: detail.lastActivityAt?relTime(detail.lastActivityAt):null },
              ] as { label:string; key:string; val:string|null; type?:string }[]).map(({ label, key, val, type }) => {
                const isReadOnly = key.startsWith("_ro_");
                const isEditing = coEditField===key;
                return (
                  <div key={key}>
                    <div className="text-[9px] text-muted-foreground/35 mb-0.5">{label}</div>
                    {isReadOnly ? (
                      <div className={`text-[11px] leading-snug break-words ${val?"text-foreground/75":"text-muted-foreground/20 italic"}`}>{val??"—"}</div>
                    ) : isEditing ? (
                      <input type={type==="number"?"number":"text"} value={coEditValue} autoFocus
                        onChange={e=>setCoEditValue(e.target.value)}
                        onBlur={()=>patchCompany(key,coEditValue)}
                        onKeyDown={e=>{if(e.key==="Enter")patchCompany(key,coEditValue);if(e.key==="Escape")setCoEditField(null);}}
                        className="w-full bg-background border border-violet-500/40 text-[11px] text-foreground px-1.5 py-0.5 outline-none"/>
                    ) : (
                      <div onClick={()=>{setCoEditField(key);setCoEditValue(val??"");}}
                        className={`text-[11px] leading-snug break-words cursor-pointer rounded px-1 -mx-1 py-0.5 transition-colors hover:bg-muted/30 ${val?"text-foreground/75":"text-muted-foreground/20 italic"}`}>
                        {val??"—"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </PopupModal>
    );
  }

  return (
    <PopupModal label="PROPLY / MIND / COMPANIES" onClose={onClose}>
      {/* Toolbar */}
      <div className="flex items-center gap-4 px-5 py-2.5 border-b border-border/20">
        <input value={q} onChange={e=>{setQ(e.target.value);setPage(0);}} placeholder="search companies..." autoFocus
          className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/30 outline-none" />
        <span className="text-[9px] text-muted-foreground/30">{filtered.length} of {companies.length}</span>
      </div>
      {/* Table header */}
      <div className="flex items-center px-5 py-1.5 border-b border-border/20 bg-muted/10">
        <SortHdr col="name"         label="COMPANY"   style={{width:155}} />
        <span className="text-[9px] text-muted-foreground/35 tracking-widest flex-1 min-w-0">TOP CONTACTS</span>
        <SortHdr col="lastActivity" label="LAST ACT." style={{width:88}} />
        <span className="text-[9px] text-muted-foreground/35 tracking-widest flex-shrink-0" style={{width:95}}>DOMAIN</span>
        <SortHdr col="industry"     label="INDUSTRY"  style={{width:88}} />
        <SortHdr col="employees"    label="EMP."      style={{width:68}} className="justify-end" />
        <SortHdr col="contacts"     label="CONTACTS"  style={{width:55}} className="justify-end" />
        <SortHdr col="dealHealthScore" label="HEALTH" style={{width:68}} className="justify-end" />
      </div>
      {/* Rows */}
      <div className="divide-y divide-border/10 flex-1 overflow-y-auto">
        {pageRows.map(co => {
          const topContacts = co.contacts.slice(0,3).map(c=>c.name.split(" ")[0]).join(", ");
          const enriching = coEnriching.has(co.id);
          const enriched  = coEnriched.has(co.id);
          const enrichErr = coEnrichErr.has(co.id);
          return (
          <div key={co.id} className="flex items-center px-5 py-2.5 hover:bg-muted/20 transition-colors group">
            <button onClick={() => setDetail(co)} className="flex items-center gap-2 flex-shrink-0 text-left" style={{width:155}}>
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{backgroundColor:healthColor(co.dealHealthScore)}} />
              <span className="text-[11px] text-foreground/80 truncate">{co.name}</span>
            </button>
            <button onClick={()=>setDetail(co)} className="text-[10px] text-muted-foreground/35 flex-1 min-w-0 truncate pr-2 text-left">{topContacts||"—"}</button>
            <span className="text-[10px] text-muted-foreground/40 flex-shrink-0 pr-2" style={{width:88}}>{relTime(co.lastActivityAt)}</span>
            <span className="text-[10px] text-muted-foreground/40 flex-shrink-0 truncate pr-2" style={{width:95}}>{co.domain??"—"}</span>
            <span className="text-[10px] text-muted-foreground/40 flex-shrink-0 truncate pr-2" style={{width:88}}>{co.industry??"—"}</span>
            <span className="text-[10px] text-muted-foreground/40 flex-shrink-0 text-right tabular-nums" style={{width:68}}>{co.employeeCount!=null?co.employeeCount.toLocaleString():"—"}</span>
            <span className="text-[10px] text-muted-foreground/50 flex-shrink-0 text-right tabular-nums" style={{width:55}}>{co.contactCount}</span>
            <span className="text-[10px] flex-shrink-0 text-right tabular-nums" style={{width:68,color:co.dealHealthScore!=null?healthColor(co.dealHealthScore):""}}>
              {co.dealHealthScore!=null?`${co.dealHealthScore}`:"—"}
            </span>
          </div>
          );
        })}
        {pageRows.length===0 && <div className="px-5 py-8 text-[11px] text-muted-foreground/30 text-center">no results</div>}
      </div>
      {/* Pagination footer */}
      {totalPages > 1 && (
        <div className="border-t border-border/20 px-5 py-2 flex-shrink-0 flex items-center justify-between">
          <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}
            className="text-[9px] text-muted-foreground/40 hover:text-foreground/60 transition-colors disabled:opacity-25 flex items-center gap-1">
            <ChevronLeft className="h-3 w-3"/>prev
          </button>
          <span className="text-[9px] text-muted-foreground/30 tabular-nums">
            {page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE,sortedList.length)} of {sortedList.length}
          </span>
          <button onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} disabled={page>=totalPages-1}
            className="text-[9px] text-muted-foreground/40 hover:text-foreground/60 transition-colors disabled:opacity-25 flex items-center gap-1">
            next<ChevronRight className="h-3 w-3"/>
          </button>
        </div>
      )}
    </PopupModal>
  );
}

// ── CSV import helpers ─────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim()); current = '';
    } else current += ch;
  }
  result.push(current.trim());
  return result;
}

const IMPORT_FIELDS = [
  { key: 'email',         label: 'Email' },
  { key: 'full_name',     label: 'Full Name' },
  { key: 'first_name',    label: 'First Name' },
  { key: 'last_name',     label: 'Last Name' },
  { key: 'company',       label: 'Company' },
  { key: 'job_title',     label: 'Job Title' },
  { key: 'phone',         label: 'Phone' },
  { key: 'deal_stage',    label: 'Deal Stage' },
  { key: 'source',        label: 'Source' },
  { key: 'linkedin_url',  label: 'LinkedIn URL' },
  { key: 'notes',         label: 'Notes' },
  { key: 'pipeline_stage',label: 'Pipeline Stage' },
] as const;

const IMPORT_AUTO_MATCH: Record<string, string[]> = {
  email:          ['email','emailaddress','mail'],
  first_name:     ['first_name','firstname','fname'],
  last_name:      ['last_name','lastname','lname','surname'],
  full_name:      ['full_name','fullname','name'],
  company:        ['company','companyname','organization','account'],
  job_title:      ['title','job_title','jobtitle','position','role'],
  phone:          ['phone','phonenumber','mobile','tel'],
  deal_stage:     ['deal_stage','dealstage'],
  source:         ['source','leadsource','lead_source'],
  linkedin_url:   ['linkedin_url','linkedin','linkedinurl'],
  notes:          ['notes','note','comment','description'],
  pipeline_stage: ['pipeline_stage','pipelinestage','pipeline'],
};

function detectImportMappings(headers: string[]): Record<string, string> {
  const used = new Set<string>(); const map: Record<string, string> = {};
  for (const h of headers) {
    const lh = h.toLowerCase().replace(/[-_\s]/g,'');
    for (const [field, aliases] of Object.entries(IMPORT_AUTO_MATCH)) {
      if (!used.has(field) && aliases.some(a => lh === a)) { map[h]=field; used.add(field); break; }
    }
    if (map[h] === undefined) map[h] = '';
  }
  return map;
}

function PeopleImportModal({ workspaceId, token, onClose, onDone }: {
  workspaceId:string; token:string; onClose:()=>void; onDone:()=>void;
}) {
  const [step, setStep] = useState<'upload'|'mapping'>('upload');
  const [dragOver, setDragOver] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvSampleRow, setCsvSampleRow] = useState<Record<string,string>>({});
  const [csvAllRows, setCsvAllRows] = useState<Record<string,string>[]>([]);
  const [fieldMappings, setFieldMappings] = useState<Record<string,string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{created:number;updated:number}|null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const parseCSVFile = async (file: File) => {
    try {
      const text = await file.text();
      const lines = text.trim().split(/\r?\n/);
      if (lines.length < 2) return;
      const headers = parseCSVLine(lines[0]);
      const rows = lines.slice(1).map(line => {
        const vals = parseCSVLine(line); const row: Record<string,string> = {};
        headers.forEach((h,i) => { row[h] = vals[i]?.trim()||''; });
        return row;
      }).filter(r => Object.values(r).some(v=>v));
      setCsvHeaders(headers); setCsvAllRows(rows);
      setCsvSampleRow(rows[0]||{}); setFieldMappings(detectImportMappings(headers));
      setStep('mapping');
    } catch { /* silent */ }
  };

  const runImport = async () => {
    setImporting(true);
    try {
      const rows = csvAllRows.map(row => {
        const mapped: Record<string,string> = {};
        for (const [col,field] of Object.entries(fieldMappings)) { if (field&&row[col]) mapped[field]=row[col]; }
        if (mapped.full_name && !mapped.first_name && !mapped.last_name) {
          const parts = mapped.full_name.trim().split(/\s+/);
          mapped.first_name = parts[0]||''; mapped.last_name = parts.slice(1).join(' ')||'';
          delete mapped.full_name;
        }
        return mapped;
      }).filter(r => r.email || r.linkedin_url);

      const res = await fetch(`${apiUrl}/api/contacts/import`, {
        method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`},
        body: JSON.stringify({ workspaceId, rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error||'Import failed');
      setResult({ created: data.created||0, updated: data.updated||0 });
      onDone();
    } catch { /* silent */ }
    finally { setImporting(false); }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background border border-border shadow-2xl w-full mx-4"
        style={{ maxWidth: step==='mapping'?580:400, fontFamily:"'JetBrains Mono',monospace" }}
        onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/40 flex-shrink-0">
          <span className="text-[9px] text-muted-foreground/40 tracking-widest">PROPLY / MIND / PEOPLE / IMPORT</span>
          <button onClick={onClose} className="text-muted-foreground/40 hover:text-foreground/70 transition-colors"><X className="h-3.5 w-3.5"/></button>
        </div>
        {result ? (
          <div className="px-6 py-10 text-center">
            <div className="text-[13px] text-foreground/80 mb-1">{result.created} new &middot; {result.updated} updated</div>
            <div className="text-[10px] text-muted-foreground/40 mb-5">import complete</div>
            <button onClick={onClose} className="text-[10px] px-4 py-1.5 border border-border/60 hover:border-border text-muted-foreground hover:text-foreground transition-colors">done</button>
          </div>
        ) : step==='upload' ? (
          <div className="px-6 py-5">
            <div
              onDragOver={e=>{e.preventDefault();setDragOver(true);}}
              onDragLeave={()=>setDragOver(false)}
              onDrop={e=>{e.preventDefault();setDragOver(false);const f=e.dataTransfer.files?.[0];if(f?.name.endsWith('.csv'))parseCSVFile(f);}}
              onClick={()=>importRef.current?.click()}
              className={`flex flex-col items-center justify-center gap-3 h-36 border border-dashed cursor-pointer transition-colors select-none ${dragOver?'border-violet-500/60 bg-violet-500/5':'border-border/40 hover:border-border/70 hover:bg-muted/10'}`}>
              <FileText className="h-5 w-5 text-muted-foreground/30"/>
              <div className="text-center">
                <p className="text-[11px] text-foreground/60">drop a .csv or <span className="text-violet-400">click to upload</span></p>
                <p className="text-[9px] text-muted-foreground/30 mt-0.5">column mapping in next step</p>
              </div>
            </div>
            <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)parseCSVFile(f);}}/>
          </div>
        ) : (
          <div>
            <div className="overflow-y-auto" style={{maxHeight:'60vh'}}>
              <div className="flex items-center px-5 py-2 border-b border-border/20 bg-muted/10">
                <span className="text-[9px] text-muted-foreground/35 tracking-widest flex-1">CSV COLUMN</span>
                <span className="text-[9px] text-muted-foreground/35 tracking-widest" style={{width:170}}>MAPS TO</span>
                <span className="text-[9px] text-muted-foreground/35 tracking-widest flex-1">SAMPLE</span>
              </div>
              {csvHeaders.map(col=>(
                <div key={col} className="flex items-center px-5 py-2 border-b border-border/10">
                  <span className="text-[11px] text-foreground/70 flex-1 truncate pr-2">{col}</span>
                  <select value={fieldMappings[col]||''} onChange={e=>setFieldMappings(p=>({...p,[col]:e.target.value}))}
                    className="bg-background border border-border/40 text-[10px] text-foreground/65 px-2 py-1 outline-none hover:border-border transition-colors flex-shrink-0" style={{width:170}}>
                    <option value="">— skip —</option>
                    {IMPORT_FIELDS.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                  <span className="text-[10px] text-violet-400/70 flex-1 truncate pl-4">{csvSampleRow[col]||<span className="text-muted-foreground/20">—</span>}</span>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-border/20 flex items-center justify-between">
              <button onClick={()=>setStep('upload')} className="text-[10px] text-muted-foreground/40 hover:text-foreground/60 transition-colors">← back</button>
              <div className="flex items-center gap-3">
                <span className="text-[9px] text-muted-foreground/30">{csvAllRows.length} rows</span>
                <button onClick={runImport} disabled={importing}
                  className="flex items-center gap-2 text-[10px] px-4 py-1.5 bg-violet-500/20 border border-violet-500/30 text-violet-400/80 hover:bg-violet-500/30 transition-colors disabled:opacity-40">
                  {importing?<><RefreshCw className="h-3 w-3 animate-spin"/>importing…</>:'import people'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── People ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

function PeoplePopup({ contacts, onClose, token, onNavigate, workspaceId, defaultSort }: { contacts:ContactInfo[]; onClose:()=>void; token:string; onNavigate:()=>void; workspaceId:string; defaultSort?: { col:"lastActivity"|"deal"|null; dir:"asc"|"desc" } }) {
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [detail, setDetail] = useState<ContactInfo | null>(null);
  const [page, setPage] = useState(0);
  const [sortCol, setSortCol] = useState<"lastActivity"|"deal"|null>(defaultSort?.col ?? null);
  const [sortDir, setSortDir] = useState<"asc"|"desc">(defaultSort?.dir ?? "asc");
  const [showImport, setShowImport] = useState(false);
  const [enriching, setEnriching] = useState<Set<string>>(new Set());
  const [enriched, setEnriched] = useState<Set<string>>(new Set());
  const [enrichErr, setEnrichErr] = useState<Set<string>>(new Set());
  const stages = ["identified","aware","interested","evaluating","client"];

  const handleEnrich = async (c: ContactInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!c.domain || enriching.has(c.id) || enriched.has(c.id)) return;
    setEnriching(prev => new Set(prev).add(c.id));
    setEnrichErr(prev => { const s = new Set(prev); s.delete(c.id); return s; });
    try {
      const res = await fetch(`${apiUrl}/api/companies/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ domain: c.domain, workspaceId, companyId: c.companyId }),
      });
      if (res.ok) setEnriched(prev => new Set(prev).add(c.id));
      else setEnrichErr(prev => new Set(prev).add(c.id));
    } catch { setEnrichErr(prev => new Set(prev).add(c.id)); }
    finally { setEnriching(prev => { const s = new Set(prev); s.delete(c.id); return s; }); }
  };

  const cycleSort = (col: "lastActivity"|"deal") => {
    if (sortCol !== col) { setSortCol(col); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortCol(null); setPage(0); }
  };

  const filtered = contacts.filter(c => {
    const qs = q.toLowerCase();
    return (!q || c.name.toLowerCase().includes(qs) || (c.email??"").toLowerCase().includes(qs) || (c.companyName??"").toLowerCase().includes(qs))
      && (!stage || c.pipelineStage === stage);
  });
  const sorted = [...filtered].sort((a,b) => {
    if (sortCol === "lastActivity") {
      const cmp = (a.lastActivityAt??"").localeCompare(b.lastActivityAt??"");
      return sortDir === "asc" ? cmp : -cmp;
    }
    if (sortCol === "deal") {
      const cmp = (a.dealStage??"").localeCompare(b.dealStage??"");
      return sortDir === "asc" ? cmp : -cmp;
    }
    return (b.lastActivityAt??"").localeCompare(a.lastActivityAt??"");
  });
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSearch = (v: string) => { setQ(v); setPage(0); };
  const handleStage  = (s: string) => { setStage(p => p===s ? "" : s); setPage(0); };

  const handleExport = () => {
    const headers = ["Name","Email","Company","Pipeline Stage","Deal Stage","Segment","Health","ICP","Last Activity","LinkedIn"];
    const rows = contacts.map(c => [
      c.name, c.email??"", c.companyName??"", c.pipelineStage,
      c.dealStage??"", c.segmentLabel??"",
      c.dealHealthScore!=null?String(c.dealHealthScore):"",
      c.icpScore!=null?String(c.icpScore):"",
      c.lastActivityAt??"", c.linkedinUrl??""
    ]);
    const csv = [headers,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    const a = document.createElement("a"); a.href=url; a.download="contacts.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const SortBtn = ({ col, label, w }: { col:"lastActivity"|"deal"; label:string; w:number }) => (
    <button onClick={() => { cycleSort(col); setPage(0); }}
      className="text-[9px] tracking-widest flex items-center gap-0.5 flex-shrink-0 group"
      style={{width:w, color: sortCol===col ? "var(--foreground)" : ""}}>
      <span className={sortCol===col ? "text-foreground/70" : "text-muted-foreground/35 group-hover:text-muted-foreground/55 transition-colors"}>{label}</span>
      {sortCol===col && <span className="text-[8px] text-muted-foreground/50 ml-0.5">{sortDir==="asc"?"↑":"↓"}</span>}
    </button>
  );

  if (detail) {
    return (
      <PopupModal label="PROPLY / MIND / PEOPLE" onClose={onClose}>
        <PeopleDetail contact={detail} token={token} onBack={() => setDetail(null)} />
      </PopupModal>
    );
  }

  return (
    <>
      {showImport && <PeopleImportModal workspaceId={workspaceId} token={token} onClose={()=>setShowImport(false)} onDone={()=>setShowImport(false)}/>}
      <PopupModal label="PROPLY / MIND / PEOPLE" onClose={onClose}>
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border/20">
          <input value={q} onChange={e=>handleSearch(e.target.value)} placeholder="search people..." autoFocus
            className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/30 outline-none" />
          <div className="flex items-center gap-1 flex-shrink-0">
            {stages.map(s => (
              <button key={s} onClick={() => handleStage(s)}
                className={`text-[8px] px-2 py-0.5 transition-colors ${stage===s ? "text-foreground border border-border bg-muted" : "text-muted-foreground/40 border border-border/30 hover:border-border/60"}`}>
                {s}
              </button>
            ))}
          </div>
          <span className="text-[9px] text-muted-foreground/30 flex-shrink-0 tabular-nums">{sorted.length} of {contacts.length}</span>
        </div>
        {/* Table header — NAME, COMPANY, LI, STAGE, ICP, DEAL↕, SEGMENT, HEALTH, LAST INT.↕, ENRICH */}
        <div className="flex items-center px-5 py-1.5 border-b border-border/20 bg-muted/10">
          <span className="text-[9px] text-muted-foreground/35 tracking-widest flex-shrink-0" style={{width:155}}>NAME</span>
          <span className="text-[9px] text-muted-foreground/35 tracking-widest flex-shrink-0" style={{width:115}}>COMPANY</span>
          <span className="text-[9px] text-muted-foreground/35 tracking-widest flex-shrink-0" style={{width:36}}>LI</span>
          <span className="text-[9px] text-muted-foreground/35 tracking-widest flex-shrink-0" style={{width:80}}>STAGE</span>
          <span className="text-[9px] text-muted-foreground/35 tracking-widest flex-shrink-0" style={{width:38}}>ICP</span>
          <SortBtn col="deal" label="DEAL" w={80} />
          <span className="text-[9px] text-muted-foreground/35 tracking-widest flex-shrink-0" style={{width:65}}>SEGMENT</span>
          <span className="text-[9px] text-muted-foreground/35 tracking-widest flex-shrink-0" style={{width:55}}>HEALTH</span>
          <SortBtn col="lastActivity" label="LAST INT." w={90} />
          <span className="text-[9px] text-muted-foreground/35 tracking-widest flex-shrink-0 text-right" style={{width:72}}>ENRICH</span>
        </div>
        {/* Rows */}
        <div className="divide-y divide-border/10">
          {pageRows.map(c => (
            <div key={c.id} className="flex items-center px-5 py-2 hover:bg-muted/20 transition-colors group">
              <button onClick={() => setDetail(c)} className="flex-shrink-0 text-left min-w-0 pr-3" style={{width:155}}>
                <div className="text-[11px] text-foreground/80 truncate">{c.name}</div>
                {c.title && <div className="text-[9px] text-muted-foreground/35 truncate">{c.title}</div>}
              </button>
              <button onClick={() => setDetail(c)} className="text-[10px] text-muted-foreground/50 truncate pr-2 flex-shrink-0 text-left" style={{width:115}}>{c.companyName ?? "—"}</button>
              <div className="flex-shrink-0" style={{width:36}}>
                {c.linkedinUrl
                  ? <a href={c.linkedinUrl} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}
                      className="text-violet-400/60 hover:text-violet-400/90 transition-colors flex items-center">
                      <Linkedin className="h-3 w-3" />
                    </a>
                  : <span className="text-muted-foreground/15 text-[9px]">—</span>
                }
              </div>
              <button onClick={() => setDetail(c)} className="text-[10px] pr-2 flex-shrink-0 text-left" style={{width:80,color:stageColor(c.pipelineStage)}}>{c.pipelineStage}</button>
              <button onClick={() => setDetail(c)} className="text-[10px] text-muted-foreground/40 pr-2 flex-shrink-0 text-left tabular-nums" style={{width:38}}>{c.icpScore != null ? c.icpScore : "—"}</button>
              <button onClick={() => setDetail(c)} className="text-[10px] text-muted-foreground/45 truncate pr-2 flex-shrink-0 text-left" style={{width:80}}>{c.dealStage ?? "—"}</button>
              <button onClick={() => setDetail(c)} className="text-[10px] text-muted-foreground/40 truncate pr-2 flex-shrink-0 text-left" style={{width:65}}>{c.segmentLabel ?? "—"}</button>
              <button onClick={() => setDetail(c)} className="text-[10px] tabular-nums pr-2 flex-shrink-0 text-left" style={{width:55,color:c.dealHealthScore!=null?healthColor(c.dealHealthScore):""}}>
                {c.dealHealthScore!=null ? `${c.dealHealthScore}` : "—"}
              </button>
              <button onClick={() => setDetail(c)} className="text-[10px] text-muted-foreground/40 flex-1 text-left" style={{minWidth:0}}>{relTime(c.lastActivityAt)}</button>
              <div className="flex-shrink-0 text-right" style={{width:72}}>
                {!c.domain ? (
                  <span className="text-[8px] text-muted-foreground/20">no domain</span>
                ) : enriched.has(c.id) ? (
                  <span className="text-[8px] text-emerald-500/60">enriched</span>
                ) : enrichErr.has(c.id) ? (
                  <span className="text-[8px] text-red-400/60">failed</span>
                ) : (
                  <button onClick={e => handleEnrich(c, e)} disabled={enriching.has(c.id)}
                    className="text-[8px] text-violet-400/50 hover:text-violet-400/80 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-40 flex items-center gap-0.5 ml-auto">
                    {enriching.has(c.id) ? <RefreshCw className="h-2.5 w-2.5 animate-spin"/> : <><span>Enrich</span><span className="text-muted-foreground/30">·5cr</span></>}
                  </button>
                )}
              </div>
            </div>
          ))}
          {sorted.length===0 && <div className="px-5 py-8 text-[11px] text-muted-foreground/30 text-center">no results</div>}
        </div>
        {/* Footer: import/export + pagination */}
        <div className="border-t border-border/20 px-5 py-2 flex-shrink-0 flex items-center justify-between text-[9px] text-muted-foreground/30">
          <div className="flex items-center gap-4">
            <button onClick={handleExport} className="flex items-center gap-1 hover:text-muted-foreground/60 transition-colors">
              export CSV <ExternalLink className="h-2.5 w-2.5" />
            </button>
            <button onClick={() => setShowImport(true)} className="flex items-center gap-1 hover:text-muted-foreground/60 transition-colors">
              import CSV <ExternalLink className="h-2.5 w-2.5" />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="tabular-nums">page {page+1} of {totalPages} · {sorted.length} people</span>
            <button onClick={() => setPage(p=>p-1)} disabled={page===0}
              className="px-2 py-0.5 border border-border/30 hover:border-border/60 disabled:opacity-20 transition-colors">prev</button>
            <button onClick={() => setPage(p=>p+1)} disabled={page>=totalPages-1}
              className="px-2 py-0.5 border border-border/30 hover:border-border/60 disabled:opacity-20 transition-colors">next</button>
          </div>
        </div>
      </PopupModal>
    </>
  );
}

const LOGO_FALLBACK: Record<string, string> = {
  apollo: "/provider-logos/apollo.svg",
  "apollo.io": "/provider-logos/apollo.svg",
  gmail: "/provider-logos/gmail.svg",
  linkedin: "/provider-logos/linkedin.svg",
  hubspot: "/provider-logos/hubspot.svg",
  slack: "/provider-logos/slack.svg",
  instantly: "/provider-logos/instantly.svg",
  rb2b: "/provider-logos/rb2b.svg",
  fireflies: "/provider-logos/fireflies.svg",
  calendly: "/provider-logos/calendly.svg",
};

function IntegrationLogo({ url, name, size=28 }: { url?: string; name: string; size?: number }) {
  const key = name.toLowerCase().replace(/[^a-z.]/g, "");
  const src = url || LOGO_FALLBACK[key] || LOGO_FALLBACK[key.split(".")[0]];
  if (src) {
    return <img src={src} alt={name} className="rounded object-contain flex-shrink-0"
      style={{ width: size, height: size }}
      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />;
  }
  return (
    <div className="rounded bg-muted/40 flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}>
      <span className="text-[9px] text-muted-foreground/40">{name.slice(0,2).toUpperCase()}</span>
    </div>
  );
}

// Hardcoded providers (API key based) — mirrors the real Integrations page
const MIND_HARDCODED_PROVIDERS: AvailableProvider[] = [
  { id:"instantly",  name:"instantly",  display_name:"Instantly",  logo_url:"/provider-logos/instantly.svg",  category:"outbound"     },
  { id:"lemlist",    name:"lemlist",    display_name:"Lemlist",    logo_url:"/provider-logos/lemlist.svg",    category:"outbound"     },
  { id:"apollo",     name:"apollo",     display_name:"Apollo",     logo_url:"/provider-logos/apollo.svg",     category:"enrichment"   },
  { id:"prospeo",    name:"prospeo",    display_name:"Prospeo",    logo_url:"/provider-logos/prospeo.svg",    category:"enrichment"   },
  { id:"signalbase", name:"signalbase", display_name:"SignalBase", logo_url:"/provider-logos/signalbase.svg", category:"signals"      },
];
const MIND_EXCLUDED = new Set(["assetly","gmail","mailchimp","google_analytics","granola","notion","clickup","openai","gemini","google","fireflies","calendly","rb2b","fathom","anthropic","stripe"]);

function IntegrationsPopup({ integrations, workspaceId, token, onClose }: {
  integrations:IntegrationConn[]; workspaceId:string; token:string; onClose:()=>void;
}) {
  const [dbProviders, setDbProviders] = useState<AvailableProvider[]>([]);
  const [webhookUrls, setWebhookUrls] = useState<{source:string;url:string}[]>([]);
  const [tab, setTab] = useState<"connected"|"available"|"webhooks">("connected");
  const [copied, setCopied] = useState<string|null>(null);
  // Inline connect state
  const [connecting, setConnecting] = useState<AvailableProvider|null>(null);
  const [connApiKey, setConnApiKey] = useState("");
  const [connName, setConnName] = useState("");
  const [connTesting, setConnTesting] = useState(false);
  const [connTestResult, setConnTestResult] = useState<{verified:boolean;message:string}|null>(null);
  const [connSaving, setConnSaving] = useState(false);
  const [connSuccess, setConnSuccess] = useState<string|null>(null);
  // Live connections state (so we can refresh after connecting)
  const [liveConns, setLiveConns] = useState<IntegrationConn[]>(integrations);

  useEffect(() => { setLiveConns(integrations); }, [integrations]);

  useEffect(() => {
    fetch(`${apiUrl}/api/workflow-providers`, { headers:{ Authorization:`Bearer ${token}` } })
      .then(r=>r.ok?r.json():{}).then(d=>{
        const list: any[] = d.providers || d || [];
        const hardcodedNames = new Set(MIND_HARDCODED_PROVIDERS.map(h=>h.name));
        const filtered = list.filter((p:any) => p.auth_type !== "none" && !MIND_EXCLUDED.has(p.name) && !hardcodedNames.has(p.name));
        setDbProviders(filtered);
      }).catch(()=>{});
    fetch(`${apiUrl}/api/webhooks/urls?workspaceId=${workspaceId}`, { headers:{ Authorization:`Bearer ${token}` } })
      .then(r=>r.ok?r.json():{}).then(d=>setWebhookUrls(d.urls??[])).catch(()=>{});
  }, [token, workspaceId]);

  // Merge hardcoded + DB providers
  const allProviders: AvailableProvider[] = [...MIND_HARDCODED_PROVIDERS, ...dbProviders];
  const connected  = liveConns.filter(i=>i.is_verified);
  const needsAuth  = liveConns.filter(i=>!i.is_verified);
  const notConnected = allProviders.filter(p=>!liveConns.some(i=>i.provider?.name===p.name||i.name===p.name));

  const copyUrl = (url: string, key: string) => {
    navigator.clipboard.writeText(url).then(() => { setCopied(key); setTimeout(()=>setCopied(null),2000); });
  };

  const startConnect = (p: AvailableProvider) => {
    setConnecting(p); setConnApiKey(""); setConnName(p.display_name);
    setConnTestResult(null); setConnSuccess(null);
  };

  const testConnection = async () => {
    if (!connecting || !connApiKey.trim()) return;
    setConnTesting(true); setConnTestResult(null);
    try {
      const res = await fetch(`${apiUrl}/api/workflow-providers/${connecting.name}/test`, {
        method:"POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${token}`},
        body: JSON.stringify({ api_key: connApiKey }),
      });
      setConnTestResult(await res.json());
    } catch { setConnTestResult({ verified:false, message:"Connection failed" }); }
    finally { setConnTesting(false); }
  };

  const saveConnection = async () => {
    if (!connecting || !connTestResult?.verified) return;
    setConnSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/workflow-providers/${connecting.name}/connect`, {
        method:"POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${token}`},
        body: JSON.stringify({ workspace_id: workspaceId, name: connName.trim()||connecting.display_name, api_key: connApiKey }),
      });
      if (res.ok) {
        setConnSuccess(connecting.display_name);
        // Optimistically add to live connections
        setLiveConns(prev => [...prev, { id: Date.now().toString(), name: connName.trim()||connecting.display_name, is_verified: true, provider: { display_name: connecting.display_name, logo_url: connecting.logo_url, category: connecting.category, name: connecting.name } }]);
        setTimeout(() => { setConnecting(null); setConnSuccess(null); setTab("connected"); }, 1500);
      } else {
        const err = await res.json().catch(()=>({}));
        setConnTestResult({ verified:false, message: err.error||"Failed to save" });
      }
    } catch { setConnTestResult({ verified:false, message:"Save failed" }); }
    finally { setConnSaving(false); }
  };

  return (
    <PopupModal label="PROPLY / MIND / INTEGRATIONS" onClose={onClose}>
      {/* Inline connect panel */}
      {connecting ? (
        <div className="px-6 py-5">
          <div className="flex items-center gap-3 mb-5">
            <button onClick={()=>setConnecting(null)} className="text-muted-foreground/40 hover:text-foreground/70 transition-colors"><ArrowLeft className="h-3.5 w-3.5"/></button>
            <IntegrationLogo url={connecting.logo_url} name={connecting.display_name} size={22}/>
            <span className="text-[13px] text-foreground/80">{connecting.display_name}</span>
          </div>
          {connSuccess ? (
            <div className="text-center py-8">
              <Check className="h-8 w-8 text-emerald-500/70 mx-auto mb-2"/>
              <div className="text-[12px] text-emerald-500/70">{connSuccess} connected</div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="text-[9px] text-muted-foreground/35 mb-1">CONNECTION NAME</div>
                <input value={connName} onChange={e=>setConnName(e.target.value)}
                  className="w-full bg-muted/20 border border-border/40 text-[11px] text-foreground px-2.5 py-1.5 outline-none focus:border-violet-500/40"/>
              </div>
              <div>
                <div className="text-[9px] text-muted-foreground/35 mb-1">API KEY</div>
                <input type="password" value={connApiKey} onChange={e=>setConnApiKey(e.target.value)}
                  placeholder="Enter API key…"
                  onKeyDown={e=>{if(e.key==="Enter")testConnection();}}
                  className="w-full bg-muted/20 border border-border/40 text-[11px] text-foreground px-2.5 py-1.5 outline-none focus:border-violet-500/40 placeholder:text-muted-foreground/25"/>
              </div>
              {connTestResult && (
                <div className={`text-[10px] px-3 py-2 border ${connTestResult.verified?"text-emerald-500/70 border-emerald-500/20 bg-emerald-500/5":"text-red-400/70 border-red-500/20 bg-red-500/5"}`}>
                  {connTestResult.message}
                </div>
              )}
              <div className="flex items-center gap-3 pt-1">
                <button onClick={testConnection} disabled={connTesting||!connApiKey.trim()}
                  className="text-[10px] px-4 py-1.5 border border-border/40 text-muted-foreground/60 hover:border-border hover:text-foreground transition-colors disabled:opacity-30 flex items-center gap-1.5">
                  {connTesting?<><RefreshCw className="h-3 w-3 animate-spin"/>testing…</>:"test connection"}
                </button>
                <button onClick={saveConnection} disabled={connSaving||!connTestResult?.verified}
                  className="text-[10px] px-4 py-1.5 bg-violet-500/20 border border-violet-500/30 text-violet-400/80 hover:bg-violet-500/30 transition-colors disabled:opacity-30 flex items-center gap-1.5">
                  {connSaving?<><RefreshCw className="h-3 w-3 animate-spin"/>saving…</>:"save"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <div className="flex border-b border-border/30">
            {([
              ["connected", `Connected (${connected.length + needsAuth.length})`],
              ["available",  `Available (${notConnected.length})`],
              ["webhooks",   `Webhooks (${webhookUrls.length})`],
            ] as const).map(([t,label]) => (
              <button key={t} onClick={()=>setTab(t)}
                className={`px-5 py-2.5 text-[10px] transition-colors border-b-2 ${tab===t?"border-violet-500/50 text-foreground/80":"border-transparent text-muted-foreground/40 hover:text-muted-foreground/70"}`}>
                {label}
              </button>
            ))}
          </div>

          {tab==="connected" && (
            <div className="divide-y divide-border/10">
              {connected.length===0&&needsAuth.length===0 && (
                <div className="px-5 py-8 text-[11px] text-muted-foreground/30 text-center">no integrations connected yet</div>
              )}
              {[...connected,...needsAuth].map(conn => {
                const providerForConnect: AvailableProvider = {
                  id: conn.provider?.name ?? conn.name,
                  name: conn.provider?.name ?? conn.name,
                  display_name: conn.provider?.display_name ?? conn.name,
                  logo_url: conn.provider?.logo_url,
                  category: conn.provider?.category,
                };
                return (
                <div key={conn.id} className="flex items-center gap-4 px-5 py-3 hover:bg-muted/10 transition-colors group">
                  <IntegrationLogo url={conn.provider?.logo_url} name={conn.provider?.display_name??conn.name} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-foreground/80">{conn.provider?.display_name??conn.name}</div>
                    {conn.provider?.category && <div className="text-[9px] text-muted-foreground/35">{conn.provider.category}</div>}
                  </div>
                  <span className={`text-[9px] px-2 py-0.5 border flex-shrink-0 ${conn.is_verified?"text-emerald-500/60 border-emerald-500/20 bg-emerald-500/5":"text-amber-500/60 border-amber-500/20 bg-amber-500/5"}`}>
                    {conn.is_verified ? "connected" : "needs auth"}
                  </span>
                  <button onClick={()=>startConnect(providerForConnect)}
                    className="text-[9px] text-muted-foreground/30 hover:text-foreground/60 transition-colors opacity-0 group-hover:opacity-100 flex items-center gap-1 flex-shrink-0 ml-2 border border-border/30 px-2 py-0.5 hover:border-border/60">
                    update
                  </button>
                </div>
                );
              })}
            </div>
          )}

          {tab==="available" && (
            <div className="divide-y divide-border/10">
              {notConnected.map(p => (
                <div key={p.id} className="flex items-center gap-4 px-5 py-3 hover:bg-muted/10 transition-colors group">
                  <IntegrationLogo url={p.logo_url} name={p.display_name} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-foreground/70">{p.display_name}</div>
                    {p.category && <div className="text-[9px] text-muted-foreground/35">{p.category}</div>}
                  </div>
                  <button onClick={()=>startConnect(p)}
                    className="text-[9px] text-violet-400/60 hover:text-violet-400/90 transition-colors opacity-0 group-hover:opacity-100 flex items-center gap-1 flex-shrink-0 border border-violet-500/30 px-2 py-0.5 hover:border-violet-500/60">
                    connect
                  </button>
                </div>
              ))}
              {notConnected.length===0 && <div className="px-5 py-8 text-[11px] text-muted-foreground/30 text-center">all providers connected</div>}
            </div>
          )}

          {tab==="webhooks" && (
            <div>
              <div className="px-5 py-3 border-b border-border/10 text-[9px] text-muted-foreground/30">
                Paste these URLs into your tools to push signals in automatically.
              </div>
              <div className="divide-y divide-border/10">
                {webhookUrls.map(w => (
                  <div key={w.source} className="flex items-center gap-4 px-5 py-3">
                    <IntegrationLogo name={w.source} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-foreground/70 capitalize mb-0.5">{w.source}</div>
                      <div className="text-[9px] text-muted-foreground/40 truncate font-mono">{w.url}</div>
                    </div>
                    <button onClick={()=>copyUrl(w.url, w.source)}
                      className="text-[9px] text-muted-foreground/40 hover:text-foreground/70 transition-colors flex items-center gap-1 flex-shrink-0">
                      {copied===w.source ? <><Check className="h-3 w-3 text-emerald-500"/>copied</> : <><Copy className="h-3 w-3"/>copy</>}
                    </button>
                  </div>
                ))}
                {webhookUrls.length===0 && <div className="px-5 py-8 text-[11px] text-muted-foreground/30 text-center">no webhook URLs configured</div>}
              </div>
            </div>
          )}
        </>
      )}
    </PopupModal>
  );
}

function MemoryUploadModal({ workspaceId, token, onClose, onDone }: {
  workspaceId:string; token:string; onClose:()=>void; onDone:(count:number)=>void;
}) {
  const [mode, setMode] = useState<"text"|"file">("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File|null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{added:number;updated:number;skipped:number}|null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const ingest = async () => {
    if (loading) return;
    setLoading(true); setResult(null);
    try {
      if (mode === "text") {
        if (!text.trim()) return;
        const res = await fetch(`${apiUrl}/api/workspace/memories/ingest`, {
          method:"POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${token}`},
          body: JSON.stringify({ workspaceId, text: text.trim(), source:"manual" }),
        });
        if (!res.ok) throw new Error();
        const d = await res.json();
        setResult({ added:d.added||0, updated:d.updated||0, skipped:d.skipped||0 });
        setText(""); onDone(d.added||0);
      } else {
        if (!file) return;
        const form = new FormData();
        form.append("file", file); form.append("workspaceId", workspaceId);
        const res = await fetch(`${apiUrl}/api/workspace/memories/ingest-file`, {
          method:"POST", headers:{ Authorization:`Bearer ${token}` }, body: form,
        });
        if (!res.ok) throw new Error();
        const d = await res.json();
        setResult({ added:d.added||0, updated:d.updated||0, skipped:d.skipped||0 });
        setFile(null); onDone(d.added||0);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background border border-border shadow-2xl w-full mx-4" style={{ maxWidth:460, fontFamily:"'JetBrains Mono',monospace" }}
        onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/40">
          <span className="text-[9px] text-muted-foreground/40 tracking-widest">PROPLY / MIND / MEMORIES / UPLOAD</span>
          <button onClick={onClose} className="text-muted-foreground/40 hover:text-foreground/70 transition-colors"><X className="h-3.5 w-3.5"/></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-2">
            {(["text","file"] as const).map(m=>(
              <button key={m} onClick={()=>setMode(m)}
                className={`text-[10px] px-3 py-1 border transition-colors ${mode===m?"border-violet-500/50 text-violet-400/80 bg-violet-500/8":"border-border/40 text-muted-foreground/40 hover:border-border/70"}`}>
                {m==="text"?"paste text":"upload file"}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/35">Claude extracts facts and merges with existing memory.</p>

          {mode==="text" ? (
            <textarea value={text} onChange={e=>setText(e.target.value)} rows={7}
              placeholder="Paste notes, emails, meeting transcripts…"
              className="w-full bg-muted/20 border border-border/40 text-[11px] text-foreground px-3 py-2 outline-none resize-none placeholder:text-muted-foreground/25 leading-relaxed focus:border-violet-500/40" />
          ) : (
            <div
              onDragOver={e=>{e.preventDefault();setDragOver(true);}}
              onDragLeave={()=>setDragOver(false)}
              onDrop={e=>{e.preventDefault();setDragOver(false);const f=e.dataTransfer.files?.[0];if(f)setFile(f);}}
              onClick={()=>fileRef.current?.click()}
              className={`flex flex-col items-center justify-center h-32 border border-dashed cursor-pointer transition-colors ${dragOver?"border-violet-500/60 bg-violet-500/5":"border-border/40 hover:border-border/70 hover:bg-muted/10"}`}>
              <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" className="hidden"
                onChange={e=>{const f=e.target.files?.[0];e.target.value="";if(f)setFile(f);}}/>
              {file ? (
                <div className="text-center">
                  <div className="text-[11px] text-foreground/70 truncate max-w-[200px]">{file.name}</div>
                  <div className="text-[9px] text-muted-foreground/35 mt-0.5">{(file.size/1024).toFixed(0)} KB</div>
                  <button onClick={e=>{e.stopPropagation();setFile(null);}} className="text-[9px] text-muted-foreground/35 hover:text-muted-foreground/70 mt-1">remove</button>
                </div>
              ) : (
                <div className="text-center">
                  <FileText className="h-5 w-5 text-muted-foreground/25 mx-auto mb-2"/>
                  <p className="text-[10px] text-muted-foreground/40">drop or <span className="text-violet-400/70">click to upload</span></p>
                  <p className="text-[9px] text-muted-foreground/25 mt-0.5">PDF, DOCX, TXT, MD</p>
                </div>
              )}
            </div>
          )}

          {result && (
            <div className="flex items-center gap-4 text-[10px]">
              <span className="text-emerald-500/70">{result.added} added</span>
              {result.updated>0&&<span className="text-muted-foreground/50">{result.updated} updated</span>}
              {result.skipped>0&&<span className="text-muted-foreground/30">{result.skipped} skipped</span>}
            </div>
          )}

          <button onClick={ingest} disabled={loading||(mode==="text"?!text.trim():!file)}
            className="w-full flex items-center justify-center gap-2 text-[11px] py-2 bg-violet-500/20 border border-violet-500/30 text-violet-400/80 hover:bg-violet-500/30 transition-colors disabled:opacity-30">
            {loading?<><RefreshCw className="h-3 w-3 animate-spin"/>extracting facts…</>:<><FileText className="h-3 w-3"/>extract facts</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function MemoriesPopup({ memories, categories, workspaceId, token, onClose }: {
  memories:MemoryFact[]; categories:{name:string;count:number}[]; workspaceId:string; token:string; onClose:()=>void;
}) {
  const [activeCat, setActiveCat] = useState<string|null>(null);
  const [q, setQ] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const maxCount = categories[0]?.count??1;
  const shown = memories.filter(m=>{
    const matchCat = !activeCat||m.category===activeCat;
    const matchQ   = !q||m.content.toLowerCase().includes(q.toLowerCase());
    return matchCat&&matchQ;
  });
  return (
    <>
      {showUpload && <MemoryUploadModal workspaceId={workspaceId} token={token} onClose={()=>setShowUpload(false)} onDone={()=>setShowUpload(false)} />}
      <PopupModal label="PROPLY / MIND / MEMORIES" onClose={onClose}>
        {/* search + categories */}
        <div className="border-b border-border/20 px-5 py-3 space-y-3">
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="search facts..." autoFocus
            className="w-full bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/30 outline-none" />
          <div className="space-y-1.5">
            {categories.map(cat=>(
              <button key={cat.name} onClick={()=>setActiveCat(p=>p===cat.name?null:cat.name)}
                className={`w-full flex items-center gap-2 py-0.5 group transition-opacity ${activeCat&&activeCat!==cat.name?"opacity-25":""}`}>
                <span className={`text-[9px] w-20 text-left flex-shrink-0 capitalize transition-colors ${activeCat===cat.name?"text-foreground/70":"text-muted-foreground/50"}`}>{cat.name.toLowerCase()}</span>
                <div className="flex-1 h-0.5 bg-muted/30 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-500/50 rounded-full" style={{ width:`${(cat.count/maxCount)*100}%` }} />
                </div>
                <span className="text-[9px] text-muted-foreground/40 w-8 text-right flex-shrink-0 tabular-nums">{cat.count}</span>
              </button>
            ))}
          </div>
        </div>
        {/* facts */}
        <div className="divide-y divide-border/10">
          {shown.slice(0,50).map(m=>(
            <div key={m.id} className="px-5 py-3">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-[8px] text-muted-foreground/30 tracking-widest capitalize">{m.category?.toLowerCase()}</span>
                <span className="text-[8px] text-muted-foreground/20">{format(new Date(m.created_at),"MMM d")}</span>
              </div>
              <div className="text-[10px] text-foreground/65 leading-relaxed">{m.content}</div>
            </div>
          ))}
          {shown.length===0&&<div className="px-5 py-8 text-[11px] text-muted-foreground/30 text-center">no facts match</div>}
        </div>
        <div className="border-t border-border/20 px-5 py-2.5 flex-shrink-0 flex justify-between items-center text-[9px] text-muted-foreground/30">
          <span>{shown.length} of {memories.length} facts</span>
          <button onClick={()=>setShowUpload(true)} className="flex items-center gap-1 hover:text-muted-foreground/60 transition-colors">
            upload memories <Plus className="h-2.5 w-2.5" />
          </button>
        </div>
      </PopupModal>
    </>
  );
}

// ─── WorkspaceSwitcher ────────────────────────────────────────────────────────

function WorkspaceSwitcher() {
  const { userData, session, refreshUserData } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen]               = useState(false);
  const [workspaces, setWs]           = useState<Workspace[]>([]);
  const [creating, setCreating]       = useState(false);
  const [newName, setNewName]         = useState("");
  const [hoveredId, setHoveredId]     = useState<string|null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Workspace|null>(null);
  const currentId = userData?.workspace?.id;

  useEffect(() => {
    if (!open||!session?.access_token) return;
    fetch(`${apiUrl}/api/workspaces`, { headers:{ Authorization:`Bearer ${session.access_token}` } })
      .then(r=>r.ok?r.json():{})
      .then(d=>setWs(d.workspaces??[]))
      .catch(()=>{});
  }, [open, session]);

  const switchTo = (id: string) => {
    localStorage.setItem('selectedWorkspaceId', id);
    refreshUserData();
    setOpen(false);
  };

  const createWorkspace = async () => {
    if (!newName.trim()||!session?.access_token) return;
    try {
      const res = await fetch(`${apiUrl}/api/workspaces`, {
        method:"POST",
        headers:{ Authorization:`Bearer ${session.access_token}`, "Content-Type":"application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const d = res.ok ? await res.json() : null;
      if (d?.workspace) { switchTo(d.workspace.id); setNewName(""); setCreating(false); }
    } catch { /* silent */ }
  };

  const deleteWorkspace = async (ws: Workspace) => {
    if (!session?.access_token) return;
    try {
      await fetch(`${apiUrl}/api/workspaces/${ws.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      setWs(prev => prev.filter(w => w.id !== ws.id));
      setConfirmDelete(null);
      if (ws.id === currentId) refreshUserData();
    } catch { /* silent */ }
  };

  const workspaceName = userData?.workspace?.name ?? "Workspace";

  return (
    <div className="relative">
      <button onClick={()=>setOpen(o=>!o)}
        className="flex items-center gap-1.5 hover:opacity-80 transition-opacity text-left">
        <span className="text-[11px] text-foreground/70 tracking-wide">{workspaceName}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground/30 flex-shrink-0" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[90]" onClick={()=>{setOpen(false);setCreating(false);setNewName("");setConfirmDelete(null);}}>
          <div className="absolute left-3 top-12 w-64 bg-background border border-border shadow-2xl"
            style={{ fontFamily:"'JetBrains Mono',monospace" }}
            onClick={e=>e.stopPropagation()}>
            <div className="px-3 py-2 border-b border-border/30">
              <div className="text-[9px] text-muted-foreground/30 tracking-widest">SWITCH WORKSPACE</div>
            </div>
            <div className="py-1 max-h-52 overflow-y-auto">
              {workspaces.map(ws=>(
                <div key={ws.id}
                  className={`relative flex items-center gap-2.5 px-3 py-2 hover:bg-muted/30 transition-colors ${ws.id===currentId?"opacity-50":""}`}
                  onMouseEnter={()=>setHoveredId(ws.id)} onMouseLeave={()=>setHoveredId(null)}>
                  <button className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                    onClick={()=>ws.id!==currentId&&switchTo(ws.id)} disabled={ws.id===currentId}>
                    <div className="w-5 h-5 rounded-full bg-violet-500/15 border border-violet-500/25 flex items-center justify-center flex-shrink-0">
                      <span className="text-[8px] text-violet-400/70 font-bold">{initials(ws.name)}</span>
                    </div>
                    <span className="text-[11px] text-foreground/75 truncate">{ws.name}</span>
                    {ws.id===currentId&&<span className="text-[8px] text-muted-foreground/30 ml-1 flex-shrink-0">current</span>}
                  </button>
                  {hoveredId===ws.id && ws.id!==currentId && (
                    <button
                      onClick={e=>{ e.stopPropagation(); setConfirmDelete(ws); }}
                      className="flex-shrink-0 p-0.5 text-muted-foreground/30 hover:text-red-400/70 transition-colors">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Delete confirmation */}
            {confirmDelete && (
              <div className="border-t border-border/30 px-3 py-2.5 bg-red-500/5">
                <p className="text-[10px] text-foreground/70 mb-2">
                  Delete <span className="font-medium text-foreground/90">"{confirmDelete.name}"</span>? This cannot be undone.
                </p>
                <div className="flex gap-1.5">
                  <button onClick={()=>deleteWorkspace(confirmDelete)}
                    className="flex-1 py-1 text-[9px] bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-colors rounded">
                    delete
                  </button>
                  <button onClick={()=>setConfirmDelete(null)}
                    className="px-2 py-1 text-[9px] text-muted-foreground/40 hover:text-foreground/60 transition-colors">
                    cancel
                  </button>
                </div>
              </div>
            )}

            <div className="border-t border-border/30 p-2">
              {!creating ? (
                <button onClick={()=>setCreating(true)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-[10px] text-muted-foreground/50 hover:text-foreground/70 hover:bg-muted/20 transition-colors rounded">
                  <Plus className="h-3 w-3" /> New workspace
                </button>
              ) : (
                <div className="space-y-1.5">
                  <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="workspace name" autoFocus
                    onKeyDown={e=>{if(e.key==="Enter")createWorkspace();if(e.key==="Escape"){setCreating(false);setNewName("");}}}
                    className="w-full px-2 py-1.5 text-[10px] bg-muted/30 border border-border/40 text-foreground placeholder:text-muted-foreground/30 outline-none rounded" />
                  <div className="flex gap-1">
                    <button onClick={createWorkspace} className="flex-1 py-1 text-[9px] bg-violet-500/20 border border-violet-500/30 text-violet-400/80 hover:bg-violet-500/30 transition-colors rounded">create</button>
                    <button onClick={()=>{setCreating(false);setNewName("");}} className="px-2 py-1 text-[9px] text-muted-foreground/40 hover:text-foreground/60 transition-colors">cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SettingsFullPopup ────────────────────────────────────────────────────────

type SettingsTab = "profile" | "team" | "api-keys" | "billing" | "usage";

function SettingsFullPopup({ onClose, initialTab = "profile" }: { onClose: () => void; initialTab?: SettingsTab }) {
  const { userData, session, refreshUserData, signOut } = useAuth();
  const handleSignOut = async () => { try { await signOut(); } catch { /* ignore */ } onClose(); };
  const { theme, toggleTheme } = useTheme();
  const token = session?.access_token;
  const teamId = userData?.team?.id;

  const [tab, setTab] = useState<SettingsTab>(initialTab);

  // Profile
  const [name, setName] = useState(userData?.user?.name ?? "");
  const [nameSaving, setNameSaving] = useState(false);

  // Team
  const [members, setMembers] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [workspaceName, setWorkspaceName] = useState(userData?.team?.name ?? "");
  const [wsNameSaving, setWsNameSaving] = useState(false);

  // API Keys
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);

  // Billing
  const [billing, setBilling] = useState<any>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  // Usage
  const [usageData, setUsageData] = useState<any>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    setName(userData?.user?.name ?? "");
    setWorkspaceName(userData?.team?.name ?? "");
  }, [userData]);

  const loadTeam = async () => {
    if (!teamId || !token) return;
    setTeamLoading(true);
    try {
      const h = { Authorization: `Bearer ${token}` };
      const [mRes, iRes] = await Promise.all([
        fetch(`${apiUrl}/api/teams/${teamId}/members`, { headers: h }),
        fetch(`${apiUrl}/api/teams/${teamId}/invitations`, { headers: h }),
      ]);
      if (mRes.ok) setMembers((await mRes.json()).members ?? []);
      if (iRes.ok) setInvitations((await iRes.json()).invitations ?? []);
    } finally { setTeamLoading(false); }
  };

  const loadKeys = async () => {
    if (!token) return;
    setKeysLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/workspace/api-keys`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setApiKeys((await res.json()).api_keys ?? []);
    } finally { setKeysLoading(false); }
  };

  const loadBilling = async () => {
    if (!token) return;
    setBillingLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/billing/packs`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setBilling(await res.json());
    } finally { setBillingLoading(false); }
  };

  const loadUsage = async () => {
    if (!token) return;
    setUsageLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/usage`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setUsageData(await res.json());
    } finally { setUsageLoading(false); }
  };

  useEffect(() => {
    if (tab === "team")     loadTeam();
    if (tab === "api-keys") loadKeys();
    if (tab === "billing")  loadBilling();
    if (tab === "usage")    loadUsage();
  }, [tab]);

  const saveName = async () => {
    if (!token) return;
    setNameSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/users/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) { toast.success("Name updated"); refreshUserData(); }
      else { const e = await res.json().catch(() => ({})); toast.error(e.error || "Failed to update name"); }
    } finally { setNameSaving(false); }
  };

  const saveWsName = async () => {
    if (!token || !teamId) return;
    setWsNameSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/teams/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: workspaceName.trim() }),
      });
      if (res.ok) { toast.success("Workspace name updated"); refreshUserData(); }
      else { const e = await res.json().catch(() => ({})); toast.error(e.error || "Failed to update workspace name"); }
    } finally { setWsNameSaving(false); }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !teamId || !token) return;
    setInviting(true);
    try {
      const res = await fetch(`${apiUrl}/api/teams/${teamId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      if (res.ok) { toast.success(`Invitation sent to ${inviteEmail}`); setInviteEmail(""); setShowInvite(false); await loadTeam(); }
      else { const e = await res.json().catch(() => ({})); toast.error(e.error || "Failed to send invitation"); }
    } finally { setInviting(false); }
  };

  const cancelInvitation = async (id: string) => {
    if (!teamId || !token || !confirm("Cancel this invitation?")) return;
    await fetch(`${apiUrl}/api/teams/${teamId}/invitations/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    await loadTeam();
  };

  const removeMember = async (userId: string) => {
    if (!teamId || !token || !confirm("Remove this member from the team?")) return;
    await fetch(`${apiUrl}/api/teams/${teamId}/members/${userId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    await loadTeam();
  };

  const createKey = async () => {
    if (!newKeyName.trim() || !token) return;
    setCreatingKey(true);
    try {
      const res = await fetch(`${apiUrl}/api/workspace/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      if (res.ok) { const d = await res.json(); setNewKeyValue(d.key); setNewKeyName(""); await loadKeys(); toast.success("API key created"); }
      else { const e = await res.json().catch(() => ({})); toast.error(e.error || "Failed to create key"); }
    } finally { setCreatingKey(false); }
  };

  const deleteKey = async (id: string) => {
    if (!token || !confirm("Delete this API key? This cannot be undone.")) return;
    await fetch(`${apiUrl}/api/workspace/api-keys/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    await loadKeys();
    toast.success("Key deleted");
  };

  const purchasePack = async (packId: string) => {
    if (!token) return;
    setCheckoutLoading(packId);
    try {
      const res = await fetch(`${apiUrl}/api/billing/purchase-pack`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ packId }),
      });
      if (res.ok) { const d = await res.json(); if (d.url) window.location.href = d.url; }
      else { const e = await res.json().catch(() => ({})); toast.error(e.error || "Checkout failed"); }
    } finally { setCheckoutLoading(null); }
  };

  const TABS: { id: SettingsTab; label: string }[] = [
    { id: "profile",  label: "Profile"  },
    { id: "team",     label: "Team"     },
    { id: "api-keys", label: "API Keys" },
    { id: "billing",  label: "Billing"  },
    { id: "usage",    label: "Usage"    },
  ];

  return (
    <PopupModal label="PROPLY / MIND / SETTINGS" onClose={onClose}>
      <div className="flex" style={{ height: "70vh" }}>
        {/* Left nav */}
        <div className="w-40 flex-shrink-0 border-r border-border/20 py-4 flex flex-col">
          <div className="flex-1 space-y-0.5">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`w-full text-left px-5 py-2 text-[11px] transition-colors ${tab === t.id ? "text-foreground bg-muted/20" : "text-muted-foreground/50 hover:text-foreground/70 hover:bg-muted/10"}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="border-t border-border/20 px-5 pt-3 pb-3 space-y-2">
            <button onClick={toggleTheme} className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40 hover:text-foreground/60 transition-colors">
              {theme === "dark" ? <><Sun className="h-3 w-3" />Light mode</> : <><Moon className="h-3 w-3" />Dark mode</>}
            </button>
            <button onClick={handleSignOut} className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40 hover:text-red-400 transition-colors">
              <LogOut className="h-3 w-3" />Log out
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── Profile ── */}
          {tab === "profile" && (
            <div className="space-y-6 max-w-sm">
              <div className="text-[9px] text-muted-foreground/30 tracking-widest">PROFILE</div>
              <div className="space-y-5">
                <div>
                  <div className="text-[9px] text-muted-foreground/35 mb-1">EMAIL</div>
                  <div className="text-[11px] text-muted-foreground/50">{userData?.user?.email}</div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground/35 mb-1">DISPLAY NAME</div>
                  <div className="flex items-center gap-2">
                    <input value={name} onChange={e => setName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveName(); }}
                      className="flex-1 bg-muted/20 border border-border/40 text-[11px] text-foreground px-2.5 py-1.5 outline-none focus:border-violet-500/40" />
                    <button onClick={saveName} disabled={nameSaving || !name.trim()}
                      className="text-[10px] px-3 py-1.5 bg-violet-500/15 border border-violet-500/30 text-violet-400/80 hover:bg-violet-500/25 transition-colors disabled:opacity-30">
                      {nameSaving ? "…" : "save"}
                    </button>
                  </div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground/35 mb-1">WORKSPACE CODENAME</div>
                  <div className="text-[10px] text-muted-foreground/30 font-mono">{userData?.workspace?.id ? generateCodename(userData.workspace.id) : "—"}</div>
                </div>
              </div>
            </div>
          )}

          {/* ── Team ── */}
          {tab === "team" && (
            <div className="space-y-6 max-w-lg">
              <div>
                <div className="text-[9px] text-muted-foreground/30 tracking-widest mb-3">WORKSPACE NAME</div>
                <div className="flex items-center gap-2">
                  <input value={workspaceName} onChange={e => setWorkspaceName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") saveWsName(); }}
                    className="flex-1 bg-muted/20 border border-border/40 text-[11px] text-foreground px-2.5 py-1.5 outline-none focus:border-violet-500/40" />
                  <button onClick={saveWsName} disabled={wsNameSaving || !workspaceName.trim()}
                    className="text-[10px] px-3 py-1.5 bg-violet-500/15 border border-violet-500/30 text-violet-400/80 hover:bg-violet-500/25 transition-colors disabled:opacity-30">
                    {wsNameSaving ? "…" : "save"}
                  </button>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[9px] text-muted-foreground/30 tracking-widest">MEMBERS {members.length > 0 && `(${members.length})`}</div>
                  <button onClick={() => setShowInvite(v => !v)}
                    className="text-[9px] text-violet-400/60 hover:text-violet-400/90 transition-colors flex items-center gap-1">
                    <Plus className="h-2.5 w-2.5" />invite
                  </button>
                </div>
                {showInvite && (
                  <div className="flex items-center gap-2 mb-4 p-3 border border-border/30 bg-muted/5">
                    <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") handleInvite(); if (e.key === "Escape") setShowInvite(false); }}
                      placeholder="email@example.com" autoFocus
                      className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/25 outline-none" />
                    <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                      className="bg-background border border-border/40 text-[9px] text-muted-foreground/60 px-1.5 py-1 outline-none">
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                    <button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}
                      className="text-[9px] px-2 py-1 bg-violet-500/15 border border-violet-500/30 text-violet-400/80 disabled:opacity-30">
                      {inviting ? "…" : "send"}
                    </button>
                    <button onClick={() => setShowInvite(false)} className="text-muted-foreground/30 hover:text-foreground/60"><X className="h-3 w-3" /></button>
                  </div>
                )}
                {teamLoading ? (
                  <div className="text-[10px] text-muted-foreground/30 py-4">loading…</div>
                ) : (
                  <div className="divide-y divide-border/10">
                    {members.map(m => (
                      <div key={m.id ?? m.user_id} className="flex items-center gap-3 py-2.5 group">
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] text-foreground/80">{m.name ?? m.user?.name ?? "—"}</div>
                          <div className="text-[9px] text-muted-foreground/40">{m.email ?? m.user?.email ?? ""}</div>
                        </div>
                        <span className="text-[9px] text-muted-foreground/30 flex-shrink-0">{m.role}</span>
                        {(m.user_id ?? m.id) !== userData?.user?.id && (
                          <button onClick={() => removeMember(m.user_id ?? m.id)}
                            className="text-muted-foreground/20 hover:text-red-400/60 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                    {members.length === 0 && !teamLoading && <div className="text-[10px] text-muted-foreground/30 py-4">no members yet</div>}
                  </div>
                )}
              </div>
              {invitations.length > 0 && (
                <div>
                  <div className="text-[9px] text-muted-foreground/30 tracking-widest mb-3">PENDING INVITATIONS</div>
                  <div className="divide-y divide-border/10">
                    {invitations.map(inv => (
                      <div key={inv.id} className="flex items-center gap-3 py-2.5 group">
                        <span className="flex-1 text-[11px] text-muted-foreground/60">{inv.email}</span>
                        <span className="text-[9px] text-amber-500/50 flex-shrink-0">pending</span>
                        <button onClick={() => cancelInvitation(inv.id)}
                          className="text-muted-foreground/20 hover:text-red-400/60 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── API Keys ── */}
          {tab === "api-keys" && (
            <div className="space-y-5 max-w-lg">
              <div className="text-[9px] text-muted-foreground/30 tracking-widest">API KEYS</div>
              {newKeyValue && (
                <div className="p-3 border border-emerald-500/20 bg-emerald-500/5">
                  <div className="text-[9px] text-emerald-500/60 mb-2">New key created — copy it now, won't be shown again</div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-[10px] text-emerald-400/80 font-mono break-all">{newKeyValue}</code>
                    <button onClick={() => { navigator.clipboard.writeText(newKeyValue); toast.success("Copied"); }}
                      className="text-[9px] text-emerald-500/60 hover:text-emerald-400 flex items-center gap-1 flex-shrink-0">
                      <Copy className="h-3 w-3" />copy
                    </button>
                    <button onClick={() => setNewKeyValue(null)} className="text-muted-foreground/30 hover:text-foreground/60 flex-shrink-0"><X className="h-3 w-3" /></button>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") createKey(); }}
                  placeholder="key name…"
                  className="flex-1 bg-muted/20 border border-border/40 text-[11px] text-foreground px-2.5 py-1.5 outline-none focus:border-violet-500/40 placeholder:text-muted-foreground/25" />
                <button onClick={createKey} disabled={creatingKey || !newKeyName.trim()}
                  className="text-[10px] px-3 py-1.5 bg-violet-500/15 border border-violet-500/30 text-violet-400/80 hover:bg-violet-500/25 disabled:opacity-30 flex items-center gap-1.5 flex-shrink-0">
                  {creatingKey ? <><RefreshCw className="h-3 w-3 animate-spin" />creating…</> : <><Plus className="h-3 w-3" />create key</>}
                </button>
              </div>
              {keysLoading ? (
                <div className="text-[10px] text-muted-foreground/30">loading…</div>
              ) : (
                <div className="divide-y divide-border/10">
                  {apiKeys.map(k => (
                    <div key={k.id} className="flex items-center gap-3 py-3 group">
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-foreground/80">{k.name}</div>
                        <div className="text-[9px] text-muted-foreground/30 tabular-nums">created {relTime(k.created_at)}</div>
                      </div>
                      <div className="text-[9px] text-muted-foreground/25 flex-shrink-0">
                        {k.last_used_at ? `used ${relTime(k.last_used_at)}` : "never used"}
                      </div>
                      <button onClick={() => deleteKey(k.id)}
                        className="text-muted-foreground/20 hover:text-red-400/60 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {apiKeys.length === 0 && !keysLoading && <div className="text-[10px] text-muted-foreground/30 py-4">no API keys yet</div>}
                </div>
              )}
            </div>
          )}

          {/* ── Billing ── */}
          {tab === "billing" && (
            <div className="space-y-6 max-w-lg">
              <div className="text-[9px] text-muted-foreground/30 tracking-widest">BILLING</div>
              {billingLoading ? (
                <div className="text-[10px] text-muted-foreground/30">loading…</div>
              ) : billing?.billing_disabled ? (
                <div className="text-[11px] text-muted-foreground/40 py-4">Billing is not enabled on this instance.</div>
              ) : billing ? (
                <>
                  {/* Balance */}
                  <div className="p-4 border border-border/30 bg-muted/5 space-y-2">
                    <div className="text-[9px] text-muted-foreground/30 tracking-widest mb-3">BALANCE</div>
                    <div className="flex items-baseline gap-3">
                      <span className="text-[22px] font-semibold text-foreground tabular-nums">{(billing.balance?.opsRemaining ?? 0).toLocaleString()}</span>
                      <span className="text-[10px] text-muted-foreground/50">ops remaining</span>
                    </div>
                    <div className="flex gap-6 text-[9px] text-muted-foreground/40">
                      <span>{(billing.balance?.opsUsed ?? 0).toLocaleString()} used</span>
                      <span>{(billing.balance?.opsTotalPurchased ?? 0).toLocaleString()} purchased total</span>
                      <span>limit: {billing.balance?.accountsLimit ?? 50} contacts</span>
                    </div>
                  </div>

                  {/* Packs */}
                  <div>
                    <div className="text-[9px] text-muted-foreground/30 tracking-widest mb-3">OP PACKS</div>
                    <div className="grid grid-cols-2 gap-2">
                      {(billing.packs ?? []).map((p: any) => (
                        <div key={p.id} className={`p-3 border ${p.popular ? "border-violet-500/30 bg-violet-500/5" : "border-border/20 bg-muted/5"} space-y-2`}>
                          <div className="flex items-baseline gap-2">
                            <span className="text-[13px] font-semibold text-foreground/80">{(p.ops/1000).toFixed(0)}k</span>
                            <span className="text-[9px] text-muted-foreground/40">ops</span>
                            {p.popular && <span className="text-[8px] text-violet-400/70 ml-auto">popular</span>}
                          </div>
                          <div className="text-[10px] text-muted-foreground/50">{p.accountsLimit} contacts · ${p.priceUSD}</div>
                          <button onClick={() => purchasePack(p.id)} disabled={!!checkoutLoading}
                            className={`w-full text-[9px] py-1 border transition-colors disabled:opacity-40 ${p.popular ? "border-violet-500/40 text-violet-400/80 hover:bg-violet-500/10" : "border-border/40 text-muted-foreground/60 hover:text-foreground hover:border-border"}`}>
                            {checkoutLoading === p.id ? "…" : `$${p.priceUSD}`}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recent purchases */}
                  {billing.purchases?.length > 0 && (
                    <div>
                      <div className="text-[9px] text-muted-foreground/30 tracking-widest mb-3">RECENT PURCHASES</div>
                      <div className="divide-y divide-border/10">
                        {billing.purchases.slice(0, 5).map((p: any, i: number) => (
                          <div key={i} className="flex items-center gap-3 py-2.5">
                            <span className="flex-1 text-[10px] text-foreground/70">{(p.ops_granted ?? 0).toLocaleString()} ops</span>
                            <span className="text-[9px] text-muted-foreground/35">${((p.amount_usd_cents ?? 0) / 100).toFixed(2)}</span>
                            <span className="text-[9px] text-muted-foreground/25">{relTime(p.created_at)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          )}

          {/* ── Usage ── */}
          {tab === "usage" && (
            <div className="space-y-6 max-w-md">
              <div className="text-[9px] text-muted-foreground/30 tracking-widest">USAGE</div>
              {usageLoading ? (
                <div className="text-[10px] text-muted-foreground/30">loading…</div>
              ) : usageData ? (
                <>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-[9px] text-muted-foreground/35 tracking-widest">PLAN</span>
                    <span className="text-[10px] text-foreground/70 uppercase tracking-wide">{usageData.plan}</span>
                  </div>
                  <div className="space-y-4">
                    {[
                      { label: "Contacts", cur: usageData.usage?.prospects?.current, lim: usageData.usage?.prospects?.limit },
                      { label: "Documents", cur: usageData.usage?.documents?.current, lim: null },
                      { label: "Templates", cur: usageData.usage?.templates?.current, lim: null },
                      { label: "Workspaces", cur: usageData.usage?.workspaces?.current, lim: null },
                      { label: "Ops Balance", cur: usageData.usage?.ops?.balance, lim: null },
                      { label: "AI Credits Limit", cur: usageData.usage?.credits?.limit, lim: null },
                    ].map(({ label, cur, lim }) => (
                      <div key={label}>
                        <div className="flex items-baseline justify-between mb-1.5">
                          <span className="text-[10px] text-muted-foreground/50">{label}</span>
                          <span className="text-[11px] text-foreground/70 tabular-nums">
                            {(cur ?? 0).toLocaleString()}{lim !== null && lim !== undefined ? ` / ${lim === null ? "∞" : lim.toLocaleString()}` : ""}
                          </span>
                        </div>
                        {lim != null && lim > 0 && (
                          <div className="h-0.5 bg-muted/30 rounded-full overflow-hidden">
                            <div className="h-full bg-violet-500/40 rounded-full transition-all"
                              style={{ width: `${Math.min(100, ((cur ?? 0) / lim) * 100)}%` }} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          )}

        </div>
      </div>
    </PopupModal>
  );
}

// ─── ConnectModal ─────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied,setCopied]=useState(false);
  return (
    <button onClick={()=>{navigator.clipboard.writeText(text).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});}}
      className="absolute top-2 right-2 text-muted-foreground/40 hover:text-foreground/70 transition-colors">
      {copied?<Check className="h-3 w-3 text-emerald-500"/>:<Copy className="h-3 w-3"/>}
    </button>
  );
}
const MCP_CONFIG=`{\n  "mcpServers": {\n    "proply": {\n      "command": "npx",\n      "args": ["-y", "@goproply/mcp"],\n      "env": { "PROPLY_API_KEY": "your-api-key" }\n    }\n  }\n}`;
const SDK_SNIPPET=`npm install @proply/sdk\n\nimport { Proply } from '@proply/sdk';\nconst proply = new Proply('your-api-key');\n\nconst contact = await proply.contacts.get('email@example.com');`;

function ConnectModal({ onClose }: { onClose: () => void }) {
  const [tab,setTab]=useState<"mcp"|"sdk">("mcp");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative bg-background border border-border rounded-lg max-w-xl w-full mx-4" style={{ fontFamily:"'JetBrains Mono',monospace" }}>
        <button onClick={onClose} className="absolute top-3 right-3 text-muted-foreground/40 hover:text-foreground/70 transition-colors"><X className="h-4 w-4"/></button>
        <div className="p-6 space-y-5">
          <div>
            <div className="text-muted-foreground/40 text-[9px] tracking-widest mb-1">PROPLY / MIND / CONNECT</div>
            <div className="text-foreground text-sm">Connect an agent to the Mind</div>
          </div>
          <div className="flex gap-1">
            {(["mcp","sdk"] as const).map(t=>(
              <button key={t} onClick={()=>setTab(t)}
                className={`px-3 py-1.5 text-[11px] rounded border transition-colors ${tab===t?"border-border bg-muted text-foreground":"border-border/40 text-muted-foreground hover:text-foreground hover:border-border"}`}>
                {t==="mcp"?"MCP Server":"Node SDK"}
              </button>
            ))}
          </div>
          {tab==="mcp"&&<div className="space-y-3"><div className="text-muted-foreground text-[11px]">Works with Claude Desktop, Cursor, Windsurf, and any MCP-compatible agent.</div><div className="relative bg-muted/50 border border-border rounded p-3 text-[11px] text-foreground/70 whitespace-pre overflow-x-auto"><CopyButton text={MCP_CONFIG}/>{MCP_CONFIG}</div></div>}
          {tab==="sdk"&&<div className="space-y-3"><div className="text-muted-foreground text-[11px]">Use the Node SDK from any TypeScript or JavaScript workflow.</div><div className="relative bg-muted/50 border border-border rounded p-3 text-[11px] text-foreground/70 whitespace-pre overflow-x-auto"><CopyButton text={SDK_SNIPPET}/>{SDK_SNIPPET}</div></div>}
          <div className="border-t border-border/40 pt-4 flex items-center justify-between">
            <span className="text-muted-foreground/50 text-[10px]">The Mind goes online once it receives its first agent call.</span>
            <a href="/settings" className="text-[11px] text-muted-foreground/60 hover:text-foreground/80 transition-colors flex items-center gap-1">API Keys<ExternalLink className="h-3 w-3"/></a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Popup = "companies" | "people" | "integrations" | "memories" | "settings" | null;

export default function Mind() {
  const { userData, session } = useAuth();
  const navigate  = useNavigate();
  const workspaceId = userData?.workspace?.id;
  const token       = session?.access_token;

  const [companies,    setCompanies]    = useState<Company[]>([]);
  const [allContacts,  setAllContacts]  = useState<ContactInfo[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationConn[]>([]);
  const [memories,     setMemories]     = useState<MemoryFact[]>([]);
  const [ops,          setOps]          = useState<LiveOp[]>([]);
  const [totalOps,     setTotalOps]     = useState(0);
  const [isOnline,     setIsOnline]     = useState(false);
  const [opsExpanded,  setOpsExpanded]  = useState(false);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [sysOffset,    setSysOffset]    = useState(200);
  const [agentOffset,  setAgentOffset]  = useState(100);
  const [hasMore,      setHasMore]      = useState(true);
  const [showConnect,  setShowConnect]  = useState(false);
  const [settingsTab,  setSettingsTab]  = useState<SettingsTab>("profile");
  const [popup,        setPopup]        = useState<Popup>(null);
  const [pulse,        setPulse]        = useState(0);
  const [peopleSort,   setPeopleSort]   = useState<{col:"lastActivity"|"deal"|null;dir:"asc"|"desc"}|undefined>(undefined);

  // Mind state: active (<5min), idle (<24h), sleeping (>24h)
  const mindState = useMemo((): MindStateType => {
    if (!ops.length) return "sleeping";
    const lastMs = new Date(ops[0].ts).getTime();
    const elapsed = Date.now() - lastMs;
    if (elapsed < 5 * 60 * 1000)  return "active";
    if (elapsed < 24 * 60 * 60 * 1000) return "idle";
    return "sleeping";
  }, [ops]);

  const mindAccent = mindState === "active" ? "#f97316" : mindState === "idle" ? "#4ade80" : "#6b7280";

  // Breathing pulse
  useEffect(() => {
    let t = 0;
    const iv = setInterval(() => { t += 0.04; setPulse((Math.sin(t)+1)/2); }, 50);
    return () => clearInterval(iv);
  }, []);

  // Listen for CommandPalette popup-open events
  useEffect(() => {
    const handler = (e: Event) => {
      const popup = (e as CustomEvent<string>).detail;
      if (popup === "settings") setSettingsTab("profile");
      setPopup(popup as Popup);
    };
    window.addEventListener("proply:open-popup", handler);
    return () => window.removeEventListener("proply:open-popup", handler);
  }, []);

  const memoriesCategories = useMemo(() => {
    const map = new Map<string,number>();
    for (const m of memories) { const c=m.category??"General"; map.set(c,(map.get(c)??0)+1); }
    return [...map.entries()].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count);
  }, [memories]);

  const loadData = useCallback(async () => {
    if (!workspaceId||!token) return;
    const headers = { Authorization:`Bearer ${token}` };
    try {
      const [coRes,ctRes,intRes,memRes] = await Promise.all([
        fetch(`${apiUrl}/api/companies/list?workspaceId=${workspaceId}`,{headers}),
        fetch(`${apiUrl}/api/contacts?workspaceId=${workspaceId}&limit=2000`,{headers}),
        fetch(`${apiUrl}/api/workflow-providers/connections?workspace_id=${workspaceId}`,{headers}),
        fetch(`${apiUrl}/api/workspace/memories?workspaceId=${workspaceId}&limit=200`,{headers}),
      ]);
      const coData=coRes.ok?await coRes.json():{};
      const ctData=ctRes.ok?await ctRes.json():{};
      const intData=intRes.ok?await intRes.json():{};
      const memData=memRes.ok?await memRes.json():{};
      const byCompany=new Map<string,ContactInfo[]>();
      const contactList:ContactInfo[]=[];
      for (const c of (ctData.contacts??[])) {
        const info:ContactInfo={ id:c.id, name:[c.first_name,c.last_name].filter(Boolean).join(" ")||c.email||"—", email:c.email??null, title:c.job_title??null, pipelineStage:c.pipeline_stage??"identified", icpScore:c.icp_score??null, icpFit:c.icp_fit??null, seniority:c.seniority??null, companyId:c.company_id??null, companyName:c.company??null, domain:c.domain??null, linkedinUrl:c.linkedin_url??null, lastActivityAt:c.last_activity_at??null, dealHealthScore:c.deal_health_score??null, dealStage:c.deal_stage??null, dealValue:c.deal_value??null, source:c.source??null, segmentLabel:c.segment_label??null, firstContact:c.first_contact??null, phone:c.phone??null, city:c.city??null, country:c.country??null, department:c.department??null, createdAt:c.created_at??null };
        contactList.push(info);
        if (c.company_id) { const arr=byCompany.get(c.company_id)??[]; arr.push(info); byCompany.set(c.company_id,arr); }
      }
      setCompanies((coData.companies??[]).map((co:any)=>{ const coContacts=byCompany.get(co.id)??[]; const lastActivityAt=coContacts.reduce((best:string|null,c:ContactInfo)=>{ if(!c.lastActivityAt) return best; if(!best||c.lastActivityAt>best) return c.lastActivityAt; return best; },null); return { id:co.id, name:co.name, domain:co.domain??null, industry:co.industry??null, location:co.location??null, revenueRange:co.revenue_range??null, contactCount:coContacts.length, contacts:coContacts, dealHealthScore:co.deal_health_score??null, lastActivityAt, employeeCount:co.employee_count??co.employees??null }; }));
      setAllContacts(contactList);
      setIntegrations(intData.connections??[]);
      setMemories(memData.memories??[]);
    } catch { /* silent */ }
  }, [workspaceId,token]);

  const loadOps = useCallback(async (sysOff=0, agentOff=0, reset=true) => {
    if (!workspaceId||!token) return;
    if (!reset) setLoadingMore(true);
    try {
      const [sysRes,agentRes] = await Promise.all([
        fetch(`${apiUrl}/api/workspace/system-log?workspace_id=${workspaceId}&days=7&limit=200&offset=${sysOff}`,{headers:{Authorization:`Bearer ${token}`}}),
        fetch(`${apiUrl}/api/requests/log?days=7&limit=100&offset=${agentOff}`,{headers:{Authorization:`Bearer ${token}`}}),
      ]);
      const sysData=sysRes.ok?await sysRes.json():{events:[],total:0};
      const agentData=agentRes.ok?await agentRes.json():{requests:[],total:0};
      const sysOps:LiveOp[]=(sysData.events??[]).map((e:any)=>{ const op=systemLogOpName(e.source,e.event_type,e.metadata); return {id:e.id,ts:e.occurred_at,name:op.name,color:OP_COLORS[op.color],detail:e.summary||e.source,source:e.source==="mcp"?"agent" as const:"system" as const}; });
      const agentOps:LiveOp[]=(agentData.requests??[]).map((r:any)=>{ const op=agentOpName(r.op_type,r.entity_type); return {id:r.id,ts:r.created_at,name:op.name,color:OP_COLORS[op.color],detail:r.entity_type,source:"agent" as const}; });
      const merged=[...sysOps,...agentOps].filter(op=>op.ts&&!isNaN(new Date(op.ts).getTime())).sort((a,b)=>new Date(b.ts).getTime()-new Date(a.ts).getTime());
      const dedup=(arr:LiveOp[])=>{ const seen=new Set<string>(); return arr.filter(o=>{ if(seen.has(o.id)) return false; seen.add(o.id); return true; }); };
      setOps(prev=>reset?dedup(merged):dedup([...prev,...merged]));
      if (reset) setTotalOps((sysData.total??0)+(agentData.total??0));
      setSysOffset(sysOff+sysOps.length); setAgentOffset(agentOff+agentOps.length);
      setHasMore(sysOps.length===200||agentOps.length===100);
      if (reset) { const t5=Date.now()-5*60*1000; setIsOnline(agentOps.some(o=>new Date(o.ts).getTime()>t5)); }
    } catch { /* silent */ }
    finally { setLoadingMore(false); }
  }, [workspaceId,token]);

  useEffect(() => {
    loadData(); loadOps(0,0,true);
    const iv=setInterval(()=>loadOps(0,0,true),15_000);
    return ()=>clearInterval(iv);
  }, [loadData,loadOps]);

  const groups = groupByDay(ops);

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden"
      style={{ fontFamily:"'JetBrains Mono',monospace" }}>

      {/* ── Top bar ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-border/40">
        <WorkspaceSwitcher />
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground/25 hidden sm:block">⌘K</span>
          <button onClick={()=>{ setSettingsTab("profile"); setPopup("settings"); }}
            className="text-[10px] text-muted-foreground/40 hover:text-foreground/70 transition-colors tracking-wider">
            {userData?.workspace?.id ? generateCodename(userData.workspace.id) : "—"}
          </button>
        </div>
      </div>

      {/* ── Content area ── */}
      <div className="flex-1 relative overflow-hidden">

        {/* Graph area — static canvas */}
        <div
          className="absolute inset-0 transition-opacity duration-400"
          style={{ opacity:opsExpanded?0:1, pointerEvents:opsExpanded?"none":"auto", bottom:44 }}
        >
          <MindLines pulse={pulse} mindState={mindState} />

          {/* Brain */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ zIndex:10 }}>
            <BrainCanvas mindState={mindState} />
            {/* Mind state indicator */}
            <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-1 pointer-events-auto"
              onClick={(e)=>{e.stopPropagation();setShowConnect(true);}}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor:mindAccent, boxShadow:`0 0 5px ${mindAccent}`, ...(mindState==="active"?{animation:"pulse 1.5s infinite"}:{}) }} />
              <span className="text-[9px] tracking-widest cursor-pointer" style={{ color:mindAccent }}>{mindState.toUpperCase()}</span>
            </div>
          </div>

          {/* Insight cards */}
          <div className="absolute pointer-events-auto" style={{ left:`calc(50% + ${CARD_POSITIONS.attention.dx}px)`, top:`calc(50% + ${CARD_POSITIONS.attention.dy}px)`, transform:"translate(-50%,-50%)", zIndex:5 }}>
            <AttentionCard contacts={allContacts} accentColor={mindAccent} onOpen={()=>{ setPeopleSort({col:"lastActivity",dir:"desc"}); setPopup("people"); }} />
          </div>
          <div className="absolute pointer-events-auto" style={{ left:`calc(50% + ${CARD_POSITIONS.decay.dx}px)`, top:`calc(50% + ${CARD_POSITIONS.decay.dy}px)`, transform:"translate(-50%,-50%)", zIndex:5 }}>
            <DecayCard contacts={allContacts} accentColor={mindAccent} onOpen={()=>{ setPeopleSort({col:"lastActivity",dir:"asc"}); setPopup("people"); }} />
          </div>

          <div className="absolute pointer-events-auto" style={{ left:`calc(50% + ${CARD_POSITIONS.signals.dx}px)`, top:`calc(50% + ${CARD_POSITIONS.signals.dy}px)`, transform:"translate(-50%,-50%)", zIndex:5 }}>
            <SignalsCard contacts={allContacts} companies={companies} accentColor={mindAccent} />
          </div>
          <div className="absolute pointer-events-auto" style={{ left:`calc(50% + ${CARD_POSITIONS.backlog.dx}px)`, top:`calc(50% + ${CARD_POSITIONS.backlog.dy}px)`, transform:"translate(-50%,-50%)", zIndex:5 }}>
            <BacklogCard ops={ops} accentColor={mindAccent} onOpen={()=>setOpsExpanded(true)} />
          </div>
          <div className="absolute pointer-events-auto" style={{ left:`calc(50% + ${CARD_POSITIONS.nextsteps.dx}px)`, top:`calc(50% + ${CARD_POSITIONS.nextsteps.dy}px)`, transform:"translate(-50%,-50%)", zIndex:5 }}>
            <NextStepsCard contacts={allContacts} accentColor={mindAccent} onOpen={()=>{ setPeopleSort({col:"lastActivity",dir:"asc"}); setPopup("people"); }} />
          </div>

          {/* Stats — fixed at right edge */}
          <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col gap-3 text-right pointer-events-auto" style={{ zIndex:20 }}>
            <button onClick={()=>setOpsExpanded(e=>!e)}
              className="text-right group transition-opacity opacity-70 hover:opacity-100">
              <div className="text-muted-foreground/40 text-[9px] tracking-widest mb-0.5 group-hover:text-muted-foreground/70">TOTAL OPS</div>
              <div className="text-foreground/70 tabular-nums text-[11px] group-hover:text-foreground">{(totalOps>0?totalOps:ops.length).toLocaleString()}</div>
            </button>
            {([
              {label:"COMPANIES",   value:companies.length,    p:"companies"    as Popup},
              {label:"PEOPLE",      value:allContacts.length,  p:"people"       as Popup},
              {label:"INTEGRATIONS",value:integrations.filter(i=>i.is_verified).length, p:"integrations" as Popup},
              {label:"MEMORIES",    value:memories.length,     p:"memories"     as Popup},
            ]).map(({label,value,p})=>(
              <button key={label} onClick={()=>setPopup(q=>q===p?null:p)}
                className={`text-right group transition-opacity ${popup===p?"opacity-100":"opacity-70 hover:opacity-100"}`}>
                <div className="text-muted-foreground/40 text-[9px] tracking-widest mb-0.5 group-hover:text-muted-foreground/70">{label}</div>
                <div className="text-foreground/70 tabular-nums text-[11px] group-hover:text-foreground">{value.toLocaleString()}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Ops drawer ── */}
        <div className="absolute left-0 right-0 bottom-0 flex flex-col bg-background border-t border-border/40 transition-all duration-400 ease-in-out"
          style={{ height:opsExpanded?"100%":"44px" }}>
          <div className="flex-shrink-0 flex items-center justify-between px-6 py-2 border-b border-border/30">
            <span className="flex items-center gap-2 text-[10px] text-muted-foreground tracking-widest">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"/>LIVE OP LOG
            </span>
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-muted-foreground/60 tabular-nums">{(totalOps>0?totalOps:ops.length).toLocaleString()} ops total</span>
              <button onClick={()=>setOpsExpanded(e=>!e)}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border/60 hover:border-border">
                {opsExpanded?<><ChevronDown className="h-3 w-3"/>collapse</>:<><ChevronUp className="h-3 w-3"/>expand</>}
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {!opsExpanded?(
              <div className="px-6 py-2 space-y-1.5">
                {ops.slice(0,6).map(op=>(
                  <div key={op.id} className="flex items-baseline gap-4 group">
                    <span className="text-[10px] text-muted-foreground/50 w-24 flex-shrink-0 tabular-nums">{format(new Date(op.ts),"HH:mm:ss.SSS")}</span>
                    <span className="text-[11px] w-52 flex-shrink-0 truncate" style={{color:op.color}}>{op.name}</span>
                    <span className="text-[11px] text-muted-foreground/60 group-hover:text-foreground flex-1 truncate transition-colors">{op.detail}</span>
                    <span className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 ${op.source==="mcp"||op.source==="agent"?"text-emerald-500/60 bg-emerald-500/8":op.source==="sdk"?"text-violet-500/60 bg-violet-500/8":op.source==="api"?"text-sky-500/60 bg-sky-500/8":"text-blue-500/60 bg-blue-500/8"}`}>{op.source}</span>
                  </div>
                ))}
                {ops.length===0&&<div className="text-[10px] text-muted-foreground/40 py-2">waiting for operations...</div>}
              </div>
            ):(
              <div>
                {groups.map(group=>(
                  <div key={group.label}>
                    <div className="flex items-center gap-3 px-6 py-2 border-b border-border/20 bg-muted/20 sticky top-0">
                      <span className="text-[10px] text-muted-foreground/60 tracking-widest">{group.label}</span>
                      <span className="text-[10px] text-muted-foreground/30">{group.ops.length} ops</span>
                    </div>
                    {group.ops.map(op=>(
                      <div key={op.id} className="flex items-baseline gap-4 px-6 py-2 border-b border-border/10 hover:bg-muted/20 transition-colors group">
                        <span className="text-[10px] text-muted-foreground/50 w-24 flex-shrink-0 tabular-nums">{format(new Date(op.ts),"HH:mm:ss.SSS")}</span>
                        <span className="text-[11px] w-52 flex-shrink-0 truncate" style={{color:op.color}}>{op.name}</span>
                        <span className="text-[11px] text-muted-foreground/60 group-hover:text-foreground flex-1 truncate transition-colors">{op.detail}</span>
                        <span className={`text-[9px] px-1 py-0.5 rounded flex-shrink-0 ${op.source==="mcp"||op.source==="agent"?"text-emerald-500/60 bg-emerald-500/8":op.source==="sdk"?"text-violet-500/60 bg-violet-500/8":op.source==="api"?"text-sky-500/60 bg-sky-500/8":"text-blue-500/60 bg-blue-500/8"}`}>{op.source}</span>
                      </div>
                    ))}
                  </div>
                ))}
                {hasMore&&(
                  <div className="flex justify-center py-4">
                    <button onClick={()=>loadOps(sysOffset,agentOffset,false)} disabled={loadingMore}
                      className="flex items-center gap-2 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded border border-border/60 hover:border-border">
                      {loadingMore?<RefreshCw className="h-3 w-3 animate-spin"/>:<ChevronDown className="h-3 w-3"/>}
                      {loadingMore?"loading...":"load more"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      {showConnect&&<ConnectModal onClose={()=>setShowConnect(false)}/>}

      {popup==="companies"&&workspaceId&&token&&<CompaniesPopup companies={companies} workspaceId={workspaceId} token={token} onClose={()=>setPopup(null)}/>}
      {popup==="people"&&token&&workspaceId&&<PeoplePopup contacts={allContacts} token={token} workspaceId={workspaceId} onClose={()=>{setPopup(null);setPeopleSort(undefined);}} onNavigate={()=>navigate("/people")} defaultSort={peopleSort}/>}
      {popup==="integrations"&&workspaceId&&token&&<IntegrationsPopup integrations={integrations} workspaceId={workspaceId} token={token} onClose={()=>setPopup(null)}/>}
      {popup==="memories"&&workspaceId&&token&&<MemoriesPopup memories={memories} categories={memoriesCategories} workspaceId={workspaceId} token={token} onClose={()=>setPopup(null)}/>}
      {popup==="settings"&&<SettingsFullPopup initialTab={settingsTab} onClose={()=>setPopup(null)}/>}
    </div>
  );
}

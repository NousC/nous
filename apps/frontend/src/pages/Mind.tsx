import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
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
      "args": ["-y", "@proply/mcp"],
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
                  tab === t
                    ? "border-border bg-muted text-foreground"
                    : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border"
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
                <CopyButton text={MCP_CONFIG} />
                {MCP_CONFIG}
              </div>
              <div className="text-muted-foreground/50 text-[10px]">
                Get your API key → Settings → API Keys
              </div>
            </div>
          )}

          {tab === "sdk" && (
            <div className="space-y-3">
              <div className="text-muted-foreground text-[11px]">
                Use the Node SDK to query contact intelligence from any TypeScript or JavaScript workflow.
              </div>
              <div className="relative bg-muted/50 border border-border rounded p-3 text-[11px] text-foreground/70 whitespace-pre overflow-x-auto">
                <CopyButton text={SDK_SNIPPET} />
                {SDK_SNIPPET}
              </div>
              <div className="text-muted-foreground/50 text-[10px]">
                Get your API key → Settings → API Keys
              </div>
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

function ContactDossier({ contact, rect }: { contact: ContactInfo; rect: DOMRect }) {
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
      className="fixed z-[60] border border-border bg-background shadow-xl pointer-events-none"
      style={{ left, top, width: 248, fontFamily: "'JetBrains Mono','Consolas',monospace" }}
    >
      <div className="px-3 pt-2.5 pb-1.5 border-b border-border/40">
        <div className="text-[9px] text-muted-foreground/40 tracking-widest">PERSON RECORD</div>
        <div className="text-[11px] text-foreground mt-0.5">{contact.name}</div>
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
    </div>
  );
}

// ─── CompanyCard ─────────────────────────────────────────────────────────────

function CompanyCard({
  company, active, onEnter, onLeave, onContactHover,
}: {
  company: Company;
  active: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onContactHover: (c: ContactInfo | null, rect?: DOMRect) => void;
}) {
  const h = company.dealHealthScore;
  const trend = h === null ? null : h >= 70 ? "↑" : h >= 40 ? "→" : "↓";
  const hClass = h === null ? "" : h >= 70 ? "text-emerald-500" : h >= 40 ? "text-yellow-500" : "text-red-400";

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={`border text-[10px] transition-all duration-200 cursor-default select-none ${
        active
          ? "border-foreground/25 bg-background shadow-md"
          : "border-border/45 bg-background/90 hover:border-border/60"
      }`}
      style={{ minWidth: 148, maxWidth: 210 }}
    >
      <div className="px-2.5 pt-2 pb-1.5 border-b border-border/30">
        <span className="text-muted-foreground/35">§ </span>
        <span className={active ? "text-foreground font-medium" : "text-foreground/75"}>
          {company.name}
        </span>
      </div>

      {company.contacts.length > 0 && (
        <div className="px-2.5 py-1.5 border-b border-border/20 space-y-px">
          {company.contacts.slice(0, 5).map(c => (
            <div
              key={c.id}
              className="flex items-baseline gap-1.5 group/contact rounded px-0.5 hover:bg-muted/30 transition-colors"
              onMouseEnter={e => onContactHover(c, e.currentTarget.getBoundingClientRect())}
              onMouseLeave={() => onContactHover(null)}
            >
              <span className="text-muted-foreground/35 flex-shrink-0 text-[9px]">|_</span>
              <span className="text-foreground/75 flex-1 min-w-0 truncate group-hover/contact:text-foreground transition-colors">
                {c.name}
              </span>
              <span className={`flex-shrink-0 text-[9px] ${
                c.pipelineStage === "client"     ? "text-emerald-500" :
                c.pipelineStage === "evaluating" ? "text-blue-400"    :
                c.pipelineStage === "interested" ? "text-orange-400"  :
                c.pipelineStage === "aware"      ? "text-yellow-500"  :
                "text-muted-foreground/40"
              }`}>{c.pipelineStage.slice(0, 5)}</span>
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

// ─── BrainSVG ─────────────────────────────────────────────────────────────────

function BrainSVG() {
  return (
    <svg
      width="206" height="154"
      viewBox="0 0 206 154"
      className="text-muted-foreground select-none"
      style={{ animation: "mindBreathe 6s ease-in-out infinite", transformOrigin: "center" }}
    >
      {/* Right hemisphere */}
      <path
        d="M 103,14 C 122,10 148,20 160,42 C 172,65 168,92 153,110 C 141,124 124,132 109,134 C 104,135 103,134 103,134"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeOpacity="0.48"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Left hemisphere */}
      <path
        d="M 103,14 C 84,10 58,20 46,42 C 34,65 38,92 53,110 C 65,124 82,132 97,134 C 102,135 103,134 103,134"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeOpacity="0.48"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Interhemispheric fissure */}
      <line
        x1="103" y1="14" x2="103" y2="134"
        stroke="currentColor"
        strokeWidth="0.5"
        strokeOpacity="0.18"
        strokeDasharray="2 4"
      />

      {/* Right sulci — staggered pulse animations */}
      <path d="M 109,26 C 128,35 143,50 137,68"
        fill="none" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.3" strokeLinecap="round"
        style={{ animation: "sulciPulse 8s ease-in-out infinite 0s" }}
      />
      <path d="M 120,54 C 143,63 155,80 144,98"
        fill="none" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.3" strokeLinecap="round"
        style={{ animation: "sulciPulse 8s ease-in-out infinite 2s" }}
      />
      <path d="M 109,86 C 126,95 135,110 122,124"
        fill="none" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.3" strokeLinecap="round"
        style={{ animation: "sulciPulse 8s ease-in-out infinite 4s" }}
      />

      {/* Left sulci (mirrored) */}
      <path d="M 97,26 C 78,35 63,50 69,68"
        fill="none" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.3" strokeLinecap="round"
        style={{ animation: "sulciPulse 8s ease-in-out infinite 1s" }}
      />
      <path d="M 86,54 C 63,63 51,80 62,98"
        fill="none" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.3" strokeLinecap="round"
        style={{ animation: "sulciPulse 8s ease-in-out infinite 3s" }}
      />
      <path d="M 97,86 C 80,95 71,110 84,124"
        fill="none" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.3" strokeLinecap="round"
        style={{ animation: "sulciPulse 8s ease-in-out infinite 5s" }}
      />

      {/* Corpus callosum — bottom connecting bridge */}
      <path
        d="M 87,134 C 90,142 103,144 103,144 C 103,144 116,142 119,134"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeOpacity="0.28"
        strokeLinecap="round"
      />

      {/* MIND label */}
      <text
        x="103" y="152"
        textAnchor="middle"
        fontSize="7.5"
        letterSpacing="6"
        fill="currentColor"
        fillOpacity="0.28"
        fontFamily="'JetBrains Mono','Consolas',monospace"
      >MIND</text>
    </svg>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Mind() {
  const { userData, session } = useAuth();
  const workspaceId = userData?.workspace?.id;
  const token       = session?.access_token;

  const [companies,    setCompanies]    = useState<Company[]>([]);
  const [ops,          setOps]          = useState<LiveOp[]>([]);
  const [totalOps,     setTotalOps]     = useState(0);
  const [selected,     setSelected]     = useState<Company | null>(null);
  const [isOnline,     setIsOnline]     = useState(false);
  const [opsExpanded,  setOpsExpanded]  = useState(false);
  const [loadingMore,  setLoadingMore]  = useState(false);
  const [sysOffset,    setSysOffset]    = useState(200);
  const [agentOffset,  setAgentOffset]  = useState(100);
  const [hasMore,      setHasMore]      = useState(true);
  const [showConnect,  setShowConnect]  = useState(false);
  const [stats, setStats]               = useState({ contacts: 0, memories: 0, integrations: 0 });
  const [hoveredContact, setHoveredContact] = useState<{ contact: ContactInfo; rect: DOMRect } | null>(null);
  const [pan,          setPan]          = useState({ x: 0, y: 0 });
  const [dragging,     setDragging]     = useState(false);

  const isDragging  = useRef(false);
  const dragStart   = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const hasMoved    = useRef(false);

  const codename = workspaceId ? generateCodename(workspaceId) : "···";

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
    if (hasMoved.current) {
      setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
    hasMoved.current   = false;
    setDragging(false);
  }, []);

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
          email:         c.email         ?? null,
          title:         c.job_title     ?? null,
          pipelineStage: c.pipeline_stage ?? "identified",
          icpScore:      c.icp_score     ?? null,
          location:      c.location      ?? null,
          seniority:     c.seniority     ?? null,
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
          domain:         co.domain          ?? null,
          industry:       co.industry        ?? null,
          employee_count: co.employee_count  ?? null,
          location:       co.location        ?? null,
          contactCount:   contacts.length,
          contacts,
          dealHealthScore: co.deal_health_score ?? null,
        };
      });

      setCompanies(
        [...list]
          .sort((a, b) => b.contactCount - a.contactCount)
          .slice(0, 8)
      );
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

        {/* Brain + orbit — fades when ops expanded */}
        <div
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
          {/* Pannable layer — brain, connection lines, company cards */}
          <div
            className="absolute inset-0"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px)`, willChange: "transform" }}
          >
            {/* SVG connection lines */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <g style={{ transform: "translate(50%, 50%)" }}>
                {companies.map((co, i) => {
                  const pos = positions[i];
                  if (!pos) return null;
                  const active = selected?.name === co.name;
                  return (
                    <line key={co.name}
                      x1={0} y1={0} x2={pos.x} y2={pos.y}
                      stroke="currentColor"
                      strokeWidth={active ? 1.5 : 0.8}
                      strokeDasharray="3 6"
                      strokeOpacity={active ? 0.38 : 0.1}
                      className="text-foreground"
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
                className="mb-2 flex items-center gap-1.5"
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

              <BrainSVG />
            </div>

            {/* Company cards */}
            {companies.map((co, i) => {
              const pos = positions[i];
              if (!pos) return null;
              return (
                <div key={co.name} className="absolute"
                  style={{
                    left: "50%", top: "50%",
                    transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`,
                    zIndex: selected?.name === co.name ? 10 : 3,
                  }}>
                  <CompanyCard
                    company={co}
                    active={selected?.name === co.name}
                    onEnter={() => setSelected(co)}
                    onLeave={() => setSelected(null)}
                    onContactHover={(c, rect) =>
                      setHoveredContact(c && rect ? { contact: c, rect } : null)
                    }
                  />
                </div>
              );
            })}
          </div>

          {/* Stats panel — fixed position, not panned */}
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

        {/* Ops drawer — slides up from bottom */}
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
                    <span className="text-[11px] text-muted-foreground/60 group-hover:text-foreground flex-1 truncate transition-colors">
                      {op.detail}
                    </span>
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
                        <span className="text-[11px] text-muted-foreground/60 group-hover:text-foreground flex-1 truncate transition-colors">
                          {op.detail}
                        </span>
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
        <ContactDossier contact={hoveredContact.contact} rect={hoveredContact.rect} />
      )}

      <style>{`
        @keyframes mindBreathe {
          0%, 100% { transform: scale(1);     opacity: 0.62; }
          50%       { transform: scale(1.025); opacity: 0.94; }
        }
        @keyframes sulciPulse {
          0%, 100% { stroke-opacity: 0.28; }
          50%       { stroke-opacity: 0.62; }
        }
        @keyframes flowLine {
          to { stroke-dashoffset: -18; }
        }
      `}</style>
    </div>
  );
}

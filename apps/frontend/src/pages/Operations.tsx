import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { format, isToday, isYesterday, startOfDay } from "date-fns";
import { RefreshCw, ChevronDown } from "lucide-react";
import { systemLogOpName, agentOpName, OP_COLORS, type OpInfo } from "@/lib/operationName";
import { freshAccessToken } from "@/lib/freshToken";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Op {
  id: string;
  ts: string;
  op: OpInfo;
  detail: string;
  source: "system" | "agent" | "mcp" | "sdk" | "api";
}

type DateRange = "1d" | "7d" | "30d" | "all";

const DATE_TABS: { id: DateRange; label: string }[] = [
  { id: "1d",  label: "1d"  },
  { id: "7d",  label: "7d"  },
  { id: "30d", label: "30d" },
  { id: "all", label: "All" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try { return format(new Date(iso), "HH:mm:ss.SSS"); } catch { return iso; }
}

function dayLabel(date: Date): string {
  if (isToday(date))     return "TODAY";
  if (isYesterday(date)) return "YESTERDAY";
  return format(date, "MMM d, yyyy").toUpperCase();
}

function groupByDay(ops: Op[]): { label: string; ops: Op[] }[] {
  const map = new Map<string, Op[]>();
  for (const op of ops) {
    const key = startOfDay(new Date(op.ts)).toISOString();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(op);
  }
  return [...map.entries()].map(([key, ops]) => ({
    label: dayLabel(new Date(key)),
    ops,
  }));
}

function opDetailFromAgent(opType: string, entityType: string, source: string | null): string {
  const parts = [entityType?.replace(/_/g, " "), source ? `via ${source}` : ""].filter(Boolean);
  return parts.join(" · ") || opType;
}

// ─── Component ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 200;

export default function Operations() {
  const { userData, session } = useAuth();
  const workspaceId = userData?.workspace?.id;
  const token       = session?.access_token;

  const [dateRange,  setDateRange]  = useState<DateRange>("7d");
  const [ops,        setOps]        = useState<Op[]>([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [loadingMore,setLoadingMore]= useState(false);
  const [filter,     setFilter]     = useState<"all" | "agent" | "system">("all");
  const [sysOffset,  setSysOffset]  = useState(0);
  const [agentOffset,setAgentOffset]= useState(0);
  const [hasMore,    setHasMore]    = useState(true);

  const fetchBatch = useCallback(async (sysOff: number, agentOff: number, reset: boolean) => {
    if (!workspaceId || !token) return;
    reset ? setLoading(true) : setLoadingMore(true);
    try {
      const fresh = await freshAccessToken();
      if (!fresh) { reset ? setLoading(false) : setLoadingMore(false); return; }
      const days = dateRange === "all" ? "all" : dateRange.replace("d", "");

      const [sysRes, agentRes] = await Promise.all([
        fetch(
          `${apiUrl}/api/workspace/system-log?workspace_id=${workspaceId}&days=${days}&limit=200&offset=${sysOff}`,
          { headers: { Authorization: `Bearer ${fresh}` } }
        ),
        fetch(
          `${apiUrl}/api/requests/log?days=${days}&limit=100&offset=${agentOff}`,
          { headers: { Authorization: `Bearer ${fresh}` } }
        ),
      ]);

      const sysData   = sysRes.ok   ? await sysRes.json()   : { events: [], total: 0 };
      const agentData = agentRes.ok ? await agentRes.json() : { requests: [], total: 0 };

      const sysOps: Op[] = (sysData.events ?? []).map((e: any) => ({
        id:     e.id,
        ts:     e.occurred_at,
        op:     systemLogOpName(e.source, e.event_type, e.metadata),
        detail: e.summary || e.source,
        source: e.source === "mcp" ? "agent" as const : "system" as const,
      }));

      const agentOps: Op[] = (agentData.requests ?? []).map((r: any) => ({
        id:     r.id,
        ts:     r.created_at,
        op:     agentOpName(r.op_type, r.entity_type),
        detail: opDetailFromAgent(r.op_type, r.entity_type, r.source),
        source: "agent" as const,
      }));

      const batch = [...sysOps, ...agentOps].sort(
        (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()
      );

      setOps(prev => reset ? batch : [...prev, ...batch]);
      setTotal((sysData.total ?? 0) + (agentData.total ?? 0));
      setSysOffset(sysOff + sysOps.length);
      setAgentOffset(agentOff + agentOps.length);
      setHasMore(sysOps.length === 200 || agentOps.length === 100);
    } catch {
      if (reset) setOps([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [workspaceId, token, dateRange]);

  // Reset on date/filter change
  useEffect(() => {
    setSysOffset(0);
    setAgentOffset(0);
    setHasMore(true);
    fetchBatch(0, 0, true);
  }, [dateRange, workspaceId, token]); // eslint-disable-line

  const loadMore = () => fetchBatch(sysOffset, agentOffset, false);

  const AGENT_SOURCES = new Set(["agent", "mcp", "sdk", "api"]);
  const visible = filter === "all"
    ? ops
    : filter === "agent"
    ? ops.filter(o => AGENT_SOURCES.has(o.source))
    : ops.filter(o => o.source === "system");
  const groups  = groupByDay(visible);

  const recentCount = ops.filter(o => new Date(o.ts).getTime() > Date.now() - 60_000).length;
  const opsPerSec   = recentCount > 0 ? (recentCount / 60).toFixed(2) : "0.00";

  return (
    <div className="flex flex-col h-full bg-background text-foreground" style={{ fontFamily: "'JetBrains Mono','Consolas',monospace" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-semibold tracking-widest uppercase">Operations</h1>
          <span className="text-xs text-muted-foreground tabular-nums">
            {ops.length.toLocaleString()} loaded{total > 0 && total !== ops.length ? ` / ${total.toLocaleString()} total` : ""}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Source filter */}
          <div className="flex items-center gap-1 text-xs">
            {(["all", "agent", "system"] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded transition-colors ${filter === f ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
                {f}
              </button>
            ))}
          </div>
          {/* Date range */}
          <div className="flex items-center gap-0.5 text-xs">
            {DATE_TABS.map(t => (
              <button key={t.id} onClick={() => setDateRange(t.id)}
                className={`px-2.5 py-1 rounded transition-colors ${dateRange === t.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
                {t.label}
              </button>
            ))}
          </div>
          <button onClick={() => fetchBatch(0, 0, true)} disabled={loading}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Live strip */}
      <div className="flex items-center gap-3 px-6 py-2 border-b border-border/20 bg-muted/10">
        <span className="flex items-center gap-1.5 text-xs text-emerald-500">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          LIVE OP LOG
        </span>
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground tabular-nums">{opsPerSec} ops/sec</span>
      </div>

      {/* Op rows grouped by day */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">loading...</div>
        ) : visible.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">no operations in this range</div>
        ) : (
          <>
            {groups.map(group => (
              <div key={group.label}>
                {/* Day separator */}
                <div className="flex items-center gap-3 px-6 py-2 border-b border-border/20 bg-muted/5 sticky top-0">
                  <span className="text-[10px] text-muted-foreground tracking-widest">{group.label}</span>
                  <span className="text-[10px] text-muted-foreground/50">{group.ops.length} ops</span>
                </div>
                {/* Ops in this day */}
                {group.ops.map(op => (
                  <div key={op.id}
                    className="flex items-baseline gap-4 px-6 py-2 hover:bg-muted/20 transition-colors group border-b border-border/10">
                    <span className="text-[11px] text-muted-foreground w-28 flex-shrink-0 tabular-nums">
                      {formatTime(op.ts)}
                    </span>
                    <span className="text-[12px] flex-1 min-w-0 truncate" style={{ color: OP_COLORS[op.op.color] }}>
                      {op.op.name}
                    </span>
                    <span className="text-[11px] text-muted-foreground/60 group-hover:text-foreground truncate max-w-[280px] transition-colors">
                      {op.detail}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 font-mono ${
                      op.source === "mcp"    ? "text-emerald-400 bg-emerald-400/10" :
                      op.source === "sdk"    ? "text-violet-400 bg-violet-400/10"   :
                      op.source === "api"    ? "text-sky-400 bg-sky-400/10"         :
                      op.source === "agent"  ? "text-emerald-400 bg-emerald-400/10" :
                                              "text-blue-400 bg-blue-400/10"
                    }`}>
                      {op.source}
                    </span>
                  </div>
                ))}
              </div>
            ))}

            {/* Load more */}
            {hasMore && (
              <div className="flex justify-center py-6">
                <button onClick={loadMore} disabled={loadingMore}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors px-4 py-2 rounded border border-border/40 hover:border-border">
                  {loadingMore
                    ? <RefreshCw className="h-3 w-3 animate-spin" />
                    : <ChevronDown className="h-3 w-3" />}
                  {loadingMore ? "loading..." : "load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

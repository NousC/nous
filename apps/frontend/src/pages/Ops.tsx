import { useState, useEffect, useCallback, useMemo } from "react";
import { Activity, RefreshCw, ChevronDown } from "lucide-react";
import { format, isToday, isYesterday, startOfDay } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/ui/page-header";
import { systemLogOpName, agentOpName, OP_COLORS } from "@/lib/operationName";
import { freshAccessToken } from "@/lib/freshToken";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

// ─── Types ──────────────────────────────────────────────────────────────────

interface LiveOp {
  id: string;
  ts: string;
  name: string;
  color: string;
  detail: string;
  source: "system" | "agent" | "mcp" | "sdk" | "api";
}

type Range = "all" | "1d" | "7d" | "30d";

const RANGE_DAYS: Record<Range, number | null> = { all: null, "1d": 1, "7d": 7, "30d": 30 };
const RANGE_LABEL: Record<Range, string> = { all: "All", "1d": "1d", "7d": "7d", "30d": "30d" };

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// An op "failed" when its name or detail signals an error/failure.
function isFailedOp(op: LiveOp) {
  const hay = `${op.name} ${op.detail}`.toLowerCase();
  return /\b(fail|failed|error|errored|denied|rejected|exception|invalid|unauthorized)\b/.test(hay);
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Ops() {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";

  const [ops, setOps]                 = useState<LiveOp[]>([]);
  const [lifetimeOps, setLifetimeOps] = useState(0);
  const [loading, setLoading]         = useState(true);
  const [range, setRange]             = useState<Range>("7d");

  const loadOps = useCallback(async () => {
    if (!workspaceId || !token) return;
    try {
      const fresh = await freshAccessToken();
      if (!fresh) return;
      const [sysRes, agentRes, lifeRes] = await Promise.all([
        fetch(`${apiUrl}/api/workspace/system-log?workspace_id=${workspaceId}&days=30&limit=200&offset=0`, { headers: { Authorization: `Bearer ${fresh}` } }),
        fetch(`${apiUrl}/api/requests/log?days=30&limit=200&offset=0`, { headers: { Authorization: `Bearer ${fresh}` } }),
        fetch(`${apiUrl}/api/usage`, { headers: { Authorization: `Bearer ${fresh}` } }),
      ]);
      const sysData   = sysRes.ok   ? await sysRes.json()   : { events: [] };
      const agentData = agentRes.ok ? await agentRes.json() : { requests: [] };
      const sysOps: LiveOp[] = (sysData.events ?? []).map((e: any) => {
        const op = systemLogOpName(e.source, e.event_type, e.metadata);
        // Any caller-facing surface (MCP, SDK, named agent, raw API client)
        // counts as an Agent op for the System/Agent tally. Everything else
        // (Attio sync, LinkedIn webhook, Gmail poller…) stays as system.
        const isAgentSource = ["mcp", "sdk", "agent", "api"].includes(e.source);
        return {
          id: e.id, ts: e.occurred_at,
          name: op.name, color: OP_COLORS[op.color],
          detail: e.summary || e.source,
          source: isAgentSource ? (e.source as LiveOp["source"]) : "system" as const,
        };
      });
      const agentOps: LiveOp[] = (agentData.requests ?? []).map((r: any) => {
        const op = agentOpName(r.op_type, r.entity_type);
        return { id: r.id, ts: r.created_at, name: op.name, color: OP_COLORS[op.color], detail: r.entity_type, source: "agent" as const };
      });
      const merged = [...sysOps, ...agentOps]
        .filter(op => op.ts && !isNaN(new Date(op.ts).getTime()))
        .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      const seen = new Set<string>();
      const dedup = merged.filter(o => { if (seen.has(o.id)) return false; seen.add(o.id); return true; });
      setOps(dedup);
      // All-time ops = SUM(billable_ops) from /api/usage.
      const usage = lifeRes.ok ? await lifeRes.json() : null;
      setLifetimeOps(usage?.ops?.allTime ?? 0);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [workspaceId, token]);

  useEffect(() => {
    loadOps();
    const iv = setInterval(loadOps, 15_000);
    return () => clearInterval(iv);
  }, [loadOps]);

  // Range-filtered ops, computed client-side.
  const rangeOps = useMemo(() => {
    const days = RANGE_DAYS[range];
    if (days == null) return ops;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return ops.filter(op => new Date(op.ts).getTime() >= cutoff);
  }, [ops, range]);

  const metrics = useMemo(() => {
    const failed = rangeOps.filter(isFailedOp).length;
    const system = rangeOps.filter(op => op.source === "system").length;
    const agent  = rangeOps.filter(op => op.source !== "system").length;
    return { failed, system, agent, total: rangeOps.length };
  }, [rangeOps]);

  const groups = groupByDay(rangeOps);

  const stats = [
    { label: "Total ops (all-time)", value: lifetimeOps > 0 ? lifetimeOps : ops.length },
    { label: `Ops in range (${RANGE_LABEL[range]})`, value: metrics.total },
    { label: "Failed ops", value: metrics.failed },
    { label: "System / Agent", value: `${metrics.system} / ${metrics.agent}`, raw: true },
  ];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-8 py-7">
        <PageHeader
          title="Ops"
        />

        {/* ── Metrics row ── */}
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
            {stats.map(s => (
              <div key={s.label} className="rounded-xl border border-border bg-background p-4">
                <div className="text-[22px] font-bold text-foreground tabular-nums">
                  {s.raw ? s.value : (typeof s.value === "number" ? s.value.toLocaleString() : s.value)}
                </div>
                <div className="text-[12px] text-muted-foreground mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Date-range toggle ── */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[12px] font-semibold tracking-wide text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            LIVE OP LOG
          </span>
          <div className="inline-flex items-center rounded-lg border border-border bg-background p-0.5">
            {(["all", "1d", "7d", "30d"] as Range[]).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1 rounded-md text-[12px] font-semibold transition-colors ${
                  range === r
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}>
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
        </div>

        {/* ── Op log ── */}
        {loading ? (
          <div className="space-y-px rounded-xl overflow-hidden border border-border">
            {[...Array(6)].map((_, i) => <div key={i} className="h-11 bg-muted/50 animate-pulse" />)}
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-12 text-center">
            <Activity className="h-7 w-7 text-muted-foreground/50 mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-[13px] font-medium text-foreground/80 mb-1">No operations in this range</p>
            <p className="text-[12px] text-muted-foreground/70">Connect an integration or widen the date range to see activity.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            {groups.map(group => (
              <div key={group.label}>
                <div className="flex items-center gap-3 px-4 py-2 border-b border-border/60 bg-muted/50">
                  <span className="text-[11px] font-semibold tracking-widest text-muted-foreground">{group.label}</span>
                  <span className="text-[11px] text-muted-foreground/70 tabular-nums">{group.ops.length} ops</span>
                </div>
                {group.ops.map(op => (
                  <div key={op.id}
                    className="flex items-baseline gap-4 px-4 py-2.5 border-b border-border/60 last:border-0 hover:bg-accent transition-colors group">
                    <span className="text-[11px] text-muted-foreground/70 w-24 flex-shrink-0 tabular-nums font-mono">
                      {format(new Date(op.ts), "HH:mm:ss")}
                    </span>
                    <span className="text-[12px] w-56 flex-shrink-0 truncate font-mono" style={{ color: op.color }}>
                      {op.name}
                    </span>
                    <span className="text-[12px] text-muted-foreground group-hover:text-foreground flex-1 truncate transition-colors">
                      {op.detail}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                      op.source === "mcp" || op.source === "agent"
                        ? "text-emerald-700 bg-emerald-50"
                        : op.source === "sdk"
                          ? "text-violet-700 bg-violet-50"
                          : op.source === "api"
                            ? "text-sky-700 bg-sky-50"
                            : "text-blue-700 bg-blue-50"
                    }`}>
                      {op.source}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {!loading && groups.length > 0 && (
          <div className="flex items-center justify-center gap-1.5 py-4 text-[11px] text-muted-foreground/70">
            <RefreshCw className="h-3 w-3" /> Auto-refreshes every 15s
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useMemo } from "react";
import { RefreshCw, Activity, Sparkles, Check, X } from "lucide-react";
import { format, isToday, isYesterday, startOfDay } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { IntegrationConn } from "@/components/mind/entities";
import { AgentSetupHint } from "@/components/AgentSetupHint";
import { PageHeader } from "@/components/ui/page-header";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

// ─── CRM provider metadata ───────────────────────────────────────────────────
const CRM_PROVIDER_META: Record<string, { label: string; logo: string; color: string }> = {
  hubspot:   { label: "HubSpot",   logo: "/provider-logos/hubspot.svg",   color: "#ff7a59" },
  pipedrive: { label: "Pipedrive", logo: "/provider-logos/pipedrive.svg", color: "#1a1a1a" },
  attio:     { label: "Attio",     logo: "/provider-logos/attio.svg",     color: "#5852eb" },
};
const CRM_NAMES = Object.keys(CRM_PROVIDER_META);

type HygieneProposal = {
  id: string; provider: string; kind: string; field: string | null;
  proposed_value: unknown; current_value: unknown; reason: string | null; confidence: number | null;
  status: string; created_at: string;
  contact?: { name: string | null; email: string | null; company: string | null } | null;
};
type SyncEvent = { id: string; ts: string; provider: string; event_type: string; summary: string };
type Range = "1d" | "7d" | "30d" | "all";

const RANGE_DAYS: Record<Range, number | null> = { "1d": 1, "7d": 7, "30d": 30, all: null };
const RANGE_LABEL: Record<Range, string> = { "1d": "1d", "7d": "7d", "30d": "30d", all: "All" };

// ─── Helpers ────────────────────────────────────────────────────────────────

function dayLabel(date: Date) {
  if (isToday(date))     return "TODAY";
  if (isYesterday(date)) return "YESTERDAY";
  return format(date, "MMM d, yyyy").toUpperCase();
}

function groupByDay(events: SyncEvent[]) {
  const map = new Map<string, SyncEvent[]>();
  for (const e of events) {
    const d = new Date(e.ts);
    if (isNaN(d.getTime())) continue;
    const key = startOfDay(d).toISOString();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return [...map.entries()].map(([, grp]) => ({ label: dayLabel(new Date(grp[0].ts)), events: grp }));
}

// Map an event type to a (humanName, kind) pair so we can color + badge it.
function classifyEvent(eventType: string): { name: string; kind: "ok" | "warn" | "fail" | "info" } {
  const t = eventType.toLowerCase();
  if (t.includes("fail") || t.includes("error"))       return { name: humanize(eventType), kind: "fail" };
  if (t.includes("partial"))                            return { name: humanize(eventType), kind: "warn" };
  if (t.includes("complete") || t.includes("success")) return { name: humanize(eventType), kind: "ok" };
  return { name: humanize(eventType), kind: "info" };
}

function humanize(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

const HYGIENE_KIND_LABEL: Record<string, string> = {
  field_fill: "Fill", field_update: "Update", conflict: "Conflict",
  net_new: "Net-new", icp_rescore: "ICP score", milestone_sync: "Milestone",
};

function summarizeProposed(v: unknown): string {
  if (v == null) return "";
  if (typeof v !== "object") return String(v);
  return Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val != null && val !== "")
    .map(([k, val]) => `${k}: ${typeof val === "object" ? JSON.stringify(val) : val}`)
    .join(" · ");
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function CrmSync() {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";

  const [integrations, setIntegrations] = useState<IntegrationConn[]>([]);
  const [loadingConns, setLoadingConns] = useState(true);

  useEffect(() => {
    if (!token || !workspaceId) return;
    setLoadingConns(true);
    fetch(`${apiUrl}/api/workflow-providers/connections?workspace_id=${workspaceId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : {}))
      .then(d => setIntegrations(d.connections ?? []))
      .catch(() => setIntegrations([]))
      .finally(() => setLoadingConns(false));
  }, [token, workspaceId]);

  const crmConns = integrations.filter(i => CRM_NAMES.includes(i.provider?.name ?? ""));

  // Unified sync log across all CRMs (last 30d, capped at 200 per provider).
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [range, setRange]   = useState<Range>("7d");

  const loadEvents = useCallback(async () => {
    if (!crmConns.length) { setEvents([]); return; }
    const all: SyncEvent[] = [];
    await Promise.all(crmConns.map(async c => {
      const prov = c.provider?.name; if (!prov) return;
      try {
        const r = await fetch(`${apiUrl}/api/workspace/system-log?workspace_id=${workspaceId}&source=${prov}&days=30&limit=200`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) return;
        const d = await r.json();
        for (const e of d.events ?? []) {
          all.push({
            id: e.id,
            ts: e.occurred_at,
            provider: prov,
            event_type: e.event_type,
            summary: e.summary || e.event_type,
          });
        }
      } catch { /* silent */ }
    }));
    all.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    setEvents(all);
  }, [token, workspaceId, crmConns.map(c => c.provider?.name).join(',')]);

  useEffect(() => { loadEvents(); const iv = setInterval(loadEvents, 15_000); return () => clearInterval(iv); }, [loadEvents]);

  // ── Hygiene report ──
  const [proposals, setProposals] = useState<HygieneProposal[]>([]);

  const loadProposals = useCallback(async () => {
    if (!token || !workspaceId) return;
    try {
      const r = await fetch(`${apiUrl}/api/crm/hygiene/proposals?workspaceId=${workspaceId}&status=proposed&limit=100`,
        { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return;
      const d = await r.json();
      setProposals(d.proposals ?? []);
    } catch { /* ignore */ }
  }, [token, workspaceId]);

  useEffect(() => { loadProposals(); }, [loadProposals]);

  const decideProposal = async (id: string, status: "approved" | "dismissed") => {
    const target = proposals.find(p => p.id === id);
    setProposals(prev => prev.filter(p => p.id !== id));  // optimistic
    try {
      const r = await fetch(`${apiUrl}/api/crm/hygiene/proposals/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, status }),
      });
      const d = await r.json().catch(() => ({}));
      if (status === "approved") {
        if (d.applied === true)       toast.success(`Applied to ${target?.provider ?? "CRM"}`);
        else if (d.applied === false) toast.error(`Apply failed — ${d.reason || "see live log"}`);
        else                          toast.info("Approved — write-back ships next");
      }
      loadEvents();  // surface the operation in the live log
    } catch { loadProposals(); }
  };

  // ── Range-filtered events for the unified log ──
  const rangeEvents = useMemo(() => {
    const days = RANGE_DAYS[range];
    if (days == null) return events;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return events.filter(e => new Date(e.ts).getTime() >= cutoff);
  }, [events, range]);

  const groups = groupByDay(rangeEvents);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-8 py-7">
        <PageHeader title="CRM Sync" />

        {loadingConns ? (
          <div className="text-[13px] text-muted-foreground/70 text-center py-12">Loading…</div>
        ) : crmConns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-10 px-6 text-center">
            <p className="text-[13px] font-medium text-foreground/80 mb-1">No CRM connected yet</p>
            <p className="text-[12px] text-muted-foreground/70 mb-4">Your agent connects HubSpot, Pipedrive, or Attio and sets your sync rules. This page is where you watch it run.</p>
            <div className="mx-auto max-w-[420px]">
              <AgentSetupHint prompt="Set up my CRM sync" />
            </div>
          </div>
        ) : (
          <>
            {/* ── Hygiene report (full width) — proposed changes awaiting your approval.
                 Setup/config moved to the agent; this page is a watch surface. ── */}
            <div className="mb-6">
            <div className="rounded-xl border border-border bg-background overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
                <div>
                  <h3 className="text-[13px] font-semibold text-foreground">Hygiene report</h3>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground/70">Proposed changes awaiting approval.</p>
                </div>
                {proposals.length > 0 && (
                  <span className="inline-flex flex-shrink-0 items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{proposals.length}</span>
                )}
              </div>
              {proposals.length === 0 ? (
                <div className="py-12 text-center">
                  <Sparkles className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" strokeWidth={1.5} />
                  <p className="mb-0.5 text-[12.5px] font-medium text-foreground/80">No proposed changes</p>
                  <p className="text-[11.5px] text-muted-foreground/70">Hygiene runs on a schedule and proposes changes here for your approval.</p>
                </div>
              ) : (
                <div className="max-h-[420px] divide-y divide-border/60 overflow-y-auto">
                  {proposals.slice(0, 50).map(p => (
                    <div key={p.id} className="flex items-center gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-foreground">{p.contact?.name || p.contact?.email || "Unknown contact"}</div>
                        <div className="truncate text-[11px] text-muted-foreground/70">
                          <span className="font-medium text-muted-foreground">{HYGIENE_KIND_LABEL[p.kind] || p.kind}</span>
                          {summarizeProposed(p.proposed_value) ? ` · ${summarizeProposed(p.proposed_value)}` : (p.reason ? ` · ${p.reason}` : "")}
                        </div>
                      </div>
                      <button onClick={() => decideProposal(p.id, "approved")} title="Approve & apply"
                        className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary hover:bg-primary/20">
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => decideProposal(p.id, "dismissed")} title="Dismiss"
                        className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </div>{/* end hygiene report */}

            {/* ── Date-range toggle + live header ── */}
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[12px] font-semibold tracking-wide text-muted-foreground">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                LIVE SYNC LOG
              </span>
              <div className="inline-flex items-center rounded-lg border border-border bg-background p-0.5">
                {(["1d", "7d", "30d", "all"] as Range[]).map(r => (
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

            {/* ── Sync event log ── */}
            {groups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border py-12 text-center">
                <Activity className="h-7 w-7 text-muted-foreground/50 mx-auto mb-3" strokeWidth={1.5} />
                <p className="text-[13px] font-medium text-foreground/80 mb-1">No sync activity in this range</p>
                <p className="text-[12px] text-muted-foreground/70">Widen the date range to see earlier runs and pushes.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden">
                {groups.map(group => (
                  <div key={group.label}>
                    <div className="flex items-center gap-3 px-4 py-2 border-b border-border/60 bg-muted/50">
                      <span className="text-[11px] font-semibold tracking-widest text-muted-foreground">{group.label}</span>
                      <span className="text-[11px] text-muted-foreground/70 tabular-nums">{group.events.length} event{group.events.length === 1 ? "" : "s"}</span>
                    </div>
                    {group.events.map(ev => {
                      const meta = CRM_PROVIDER_META[ev.provider];
                      const cls  = classifyEvent(ev.event_type);
                      const badgeCls = cls.kind === "ok"   ? "text-emerald-700 bg-emerald-50"
                                     : cls.kind === "warn" ? "text-amber-700 bg-amber-50"
                                     : cls.kind === "fail" ? "text-red-700 bg-red-50"
                                                           : "text-sky-700 bg-sky-50";
                      const nameColor = cls.kind === "fail" ? "#dc2626"
                                      : cls.kind === "warn" ? "#b45309"
                                      : (meta?.color ?? "#475569");
                      return (
                        <div key={ev.id}
                          className="flex items-baseline gap-4 px-4 py-2.5 border-b border-border/60 last:border-0 hover:bg-accent transition-colors group">
                          <span className="text-[11px] text-muted-foreground/70 w-24 flex-shrink-0 tabular-nums font-mono">
                            {format(new Date(ev.ts), "HH:mm:ss")}
                          </span>
                          <span className="text-[12px] w-44 flex-shrink-0 truncate font-mono" style={{ color: nameColor }}>
                            {cls.name}
                          </span>
                          <span className="text-[12px] text-muted-foreground group-hover:text-foreground flex-1 truncate transition-colors" title={ev.summary}>
                            {ev.summary}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 font-medium ${badgeCls}`}>
                            {meta?.label ?? ev.provider}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {groups.length > 0 && (
              <div className="flex items-center justify-center gap-1.5 py-4 text-[11px] text-muted-foreground/70">
                <RefreshCw className="h-3 w-3" /> Auto-refreshes every 15s
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

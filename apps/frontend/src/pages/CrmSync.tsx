import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Download, Plus, Activity, Settings, ChevronDown, Upload, UserPlus, Sparkles } from "lucide-react";
import { format, isToday, isYesterday, startOfDay } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { IntegrationConn, IntegrationLogo } from "@/components/mind/entities";
import { PageHeader } from "@/components/ui/page-header";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

// ─── CRM provider metadata ───────────────────────────────────────────────────
const CRM_PROVIDER_META: Record<string, { label: string; logo: string; color: string }> = {
  hubspot:   { label: "HubSpot",   logo: "/provider-logos/hubspot.svg",   color: "#ff7a59" },
  pipedrive: { label: "Pipedrive", logo: "/provider-logos/pipedrive.svg", color: "#1a1a1a" },
  attio:     { label: "Attio",     logo: "/provider-logos/attio.svg",     color: "#5852eb" },
};
const CRM_NAMES = Object.keys(CRM_PROVIDER_META);

type CrmConfig = {
  auto_sync: boolean; push_activities: boolean; last_synced_at: string | null; contacts_synced: number;
  create_in_crm: boolean; create_trigger: string; create_require_icp_fit: boolean; create_icp_threshold: number;
  hygiene_enabled: boolean; hygiene_cadence: string;
};
const DEFAULT_CFG: CrmConfig = {
  auto_sync: false, push_activities: true, last_synced_at: null, contacts_synced: 0,
  create_in_crm: true, create_trigger: "positive_reply_or_meeting", create_require_icp_fit: true, create_icp_threshold: 70,
  hygiene_enabled: true, hygiene_cadence: "weekly",
};

type HygieneProposal = {
  id: string; provider: string; kind: string; field: string | null;
  proposed_value: unknown; current_value: unknown; reason: string | null; confidence: number | null;
  status: string; created_at: string;
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
  const navigate = useNavigate();

  // CRM sync is a Scale feature — the API returns 402 feature_not_in_plan for
  // lower plans. Turn that into an upgrade toast.
  const crmGate = () => toast.info("CRM sync is a Scale feature — upgrade on the Usage & Billing page.");

  const [integrations, setIntegrations] = useState<IntegrationConn[]>([]);
  const [loadingConns, setLoadingConns] = useState(true);
  const [showHelp, setShowHelp] = useState(false);

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
  const connectedProviders = new Set(crmConns.map(c => c.provider?.name).filter(Boolean) as string[]);

  const [configs, setConfigs] = useState<Record<string, CrmConfig>>({});
  const [syncing, setSyncing] = useState<string | null>(null);
  const [togglingAuto, setTogglingAuto] = useState<string | null>(null);
  const [togglingPush, setTogglingPush] = useState<string | null>(null);

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

  // Load existing sync configs for every connected CRM
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries: [string, CrmConfig][] = [];
      for (const c of crmConns) {
        const prov = c.provider?.name; if (!prov) continue;
        try {
          const r = await fetch(`${apiUrl}/api/crm/sync-config?workspaceId=${workspaceId}&provider=${prov}`, { headers: { Authorization: `Bearer ${token}` } });
          if (!r.ok) continue;
          const d = await r.json();
          if (d.config) entries.push([prov, {
            auto_sync:       !!d.config.auto_sync,
            push_activities: d.config.push_activities !== false,  // default true if unset
            last_synced_at:  d.config.last_synced_at ?? null,
            contacts_synced: d.config.contacts_synced ?? 0,
            create_in_crm:          d.config.create_in_crm !== false,
            create_trigger:         d.config.create_trigger || "positive_reply_or_meeting",
            create_require_icp_fit: d.config.create_require_icp_fit !== false,
            create_icp_threshold:   typeof d.config.create_icp_threshold === "number" ? d.config.create_icp_threshold : 70,
            hygiene_enabled: d.config.hygiene_enabled !== false,
            hygiene_cadence: d.config.hygiene_cadence || "weekly",
          }]);
        } catch {}
      }
      if (!cancelled) setConfigs(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [token, workspaceId, crmConns.length]);

  const saveConfig = async (provider: string, connectionId: string, patch: {
    autoSync?: boolean; pushActivities?: boolean;
    createInCrm?: boolean; createTrigger?: string; createRequireIcpFit?: boolean; createIcpThreshold?: number;
    hygieneEnabled?: boolean; hygieneCadence?: string;
  }) => {
    const r = await fetch(`${apiUrl}/api/crm/sync-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ workspaceId, connectionId, provider, ...patch }),
    });
    if (r.status === 402) {
      const e = await r.json().catch(() => ({}));
      if (e.error === "feature_not_in_plan") crmGate();
    }
    return r.ok;
  };

  const handleSync = async (conn: IntegrationConn) => {
    const provider = conn.provider?.name; if (!provider) return;
    setSyncing(provider);
    try {
      // Ensure config exists before sync-now (server requires a row)
      if (!configs[provider]) await saveConfig(provider, conn.id, { autoSync: false, pushActivities: true });
      const r = await fetch(`${apiUrl}/api/crm/sync-now`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, provider }),
      });
      const d = await r.json();
      if (r.status === 402 && d.error === "feature_not_in_plan") { crmGate(); return; }
      if (!r.ok) throw new Error(d.message || d.error || "Sync failed");
      toast.success(`Synced ${d.total ?? 0} records — ${d.imported ?? 0} new${d.skipped ? `, ${d.skipped} skipped` : ""}`);
      setConfigs(prev => ({
        ...prev,
        [provider]: {
          ...DEFAULT_CFG,
          ...prev[provider],
          last_synced_at:  new Date().toISOString(),
          contacts_synced: (prev[provider]?.contacts_synced ?? 0) + (d.imported ?? 0),
        },
      }));
      // Surface the sync_complete event right away
      loadEvents();
    } catch (e: any) {
      toast.error(e.message || "Sync failed");
    } finally { setSyncing(null); }
  };

  const handleToggleAuto = async (conn: IntegrationConn, val: boolean) => {
    const provider = conn.provider?.name; if (!provider) return;
    setTogglingAuto(provider);
    const ok = await saveConfig(provider, conn.id, { autoSync: val });
    if (ok) setConfigs(prev => ({ ...prev, [provider]: { ...DEFAULT_CFG, ...prev[provider], auto_sync: val } }));
    setTogglingAuto(null);
  };

  const handleTogglePush = async (conn: IntegrationConn, val: boolean) => {
    const provider = conn.provider?.name; if (!provider) return;
    setTogglingPush(provider);
    const ok = await saveConfig(provider, conn.id, { pushActivities: val });
    if (ok) setConfigs(prev => ({ ...prev, [provider]: { ...DEFAULT_CFG, ...prev[provider], push_activities: val } }));
    setTogglingPush(null);
  };

  // Persist a create-policy change and optimistically reflect it in local state.
  const handleSavePolicy = async (conn: IntegrationConn, patch: {
    createInCrm?: boolean; createTrigger?: string; createRequireIcpFit?: boolean; createIcpThreshold?: number;
  }) => {
    const provider = conn.provider?.name; if (!provider) return;
    const ok = await saveConfig(provider, conn.id, patch);
    if (ok) setConfigs(prev => ({ ...prev, [provider]: {
      ...DEFAULT_CFG, ...prev[provider],
      ...(patch.createInCrm         !== undefined ? { create_in_crm:          patch.createInCrm } : {}),
      ...(patch.createTrigger       !== undefined ? { create_trigger:         patch.createTrigger } : {}),
      ...(patch.createRequireIcpFit !== undefined ? { create_require_icp_fit: patch.createRequireIcpFit } : {}),
      ...(patch.createIcpThreshold  !== undefined ? { create_icp_threshold:   patch.createIcpThreshold } : {}),
    }}));
  };

  const handleSaveHygiene = async (conn: IntegrationConn, patch: { hygieneEnabled?: boolean; hygieneCadence?: string }) => {
    const provider = conn.provider?.name; if (!provider) return;
    const ok = await saveConfig(provider, conn.id, patch);
    if (ok) setConfigs(prev => ({ ...prev, [provider]: {
      ...DEFAULT_CFG, ...prev[provider],
      ...(patch.hygieneEnabled !== undefined ? { hygiene_enabled: patch.hygieneEnabled } : {}),
      ...(patch.hygieneCadence !== undefined ? { hygiene_cadence: patch.hygieneCadence } : {}),
    }}));
  };

  // ── Hygiene report ──
  const [proposals, setProposals] = useState<HygieneProposal[]>([]);
  const [runningHygiene, setRunningHygiene] = useState<string | null>(null);

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

  const handleRunHygiene = async (conn: IntegrationConn) => {
    const provider = conn.provider?.name; if (!provider) return;
    setRunningHygiene(provider);
    try {
      // Ensure a config row exists first (server needs one to attach to).
      if (!configs[provider]) await saveConfig(provider, conn.id, { autoSync: false, pushActivities: true });
      const r = await fetch(`${apiUrl}/api/crm/hygiene/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, provider }),
      });
      const d = await r.json();
      if (r.status === 402 && d.error === "feature_not_in_plan") { crmGate(); return; }
      if (!r.ok) throw new Error(d.error || "Hygiene run failed");
      toast.success(`Hygiene run — ${d.net_new ?? 0} net-new enriched, ${d.icp_rescore ?? 0} ICP write-backs proposed`);
      loadProposals();
      loadEvents();
    } catch (e: any) {
      toast.error(e.message || "Hygiene run failed");
    } finally { setRunningHygiene(null); }
  };

  const decideProposal = async (id: string, status: "approved" | "dismissed") => {
    setProposals(prev => prev.filter(p => p.id !== id));  // optimistic
    try {
      await fetch(`${apiUrl}/api/crm/hygiene/proposals/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, status }),
      });
    } catch { loadProposals(); }
  };

  // ── Range-filtered events for the unified log ──
  const rangeEvents = useMemo(() => {
    const days = RANGE_DAYS[range];
    if (days == null) return events;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return events.filter(e => new Date(e.ts).getTime() >= cutoff);
  }, [events, range]);

  // ── Top-of-page metrics tiles ──
  const stats = useMemo(() => {
    const totalContacts = Object.values(configs).reduce((s, c) => s + (c.contacts_synced ?? 0), 0);
    const autoOn        = Object.values(configs).filter(c => c.auto_sync).length;
    const fails7d       = events.filter(e => {
      if (!e.event_type.toLowerCase().includes("fail")) return false;
      return Date.now() - new Date(e.ts).getTime() < 7 * 24 * 60 * 60 * 1000;
    }).length;
    return [
      { label: "Contacts synced (all-time)", value: totalContacts.toLocaleString(), raw: true },
      { label: "Connected CRMs",              value: `${crmConns.length} / ${CRM_NAMES.length}`, raw: true },
      { label: "Auto-sync active",            value: autoOn },
      { label: "Failed runs (7d)",            value: fails7d },
    ] as { label: string; value: number | string; raw?: boolean }[];
  }, [configs, events, crmConns.length]);

  const groups = groupByDay(rangeEvents);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-8 py-7">
        <PageHeader
          title="CRM Sync"
          subtitle="Configure each CRM connection — auto-sync runs once a day, or trigger Sync now anytime. Every push and pull lands in the live log below."
        />

        {/* ── How CRM sync works — plain-language overview ── */}
        <div className="mb-5 rounded-xl border border-border bg-background">
          <button
            onClick={() => setShowHelp(v => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left">
            <span className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
              <Activity className="h-4 w-4 text-primary" />
              How CRM sync works
            </span>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showHelp ? "rotate-180" : ""}`} />
          </button>
          {showHelp && (
            <div className="border-t border-border/60 px-4 py-4">
              <p className="mb-4 text-[12.5px] leading-relaxed text-muted-foreground">
                Nous treats your customer graph as the source of truth and keeps the CRM
                reconciled with it. Data moves in four ways:
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    icon: Download, title: "Pull — read from the CRM",
                    body: "Once a day (when Auto-sync is on) Nous reads contacts, companies, and deals updated since the last run, so it knows what your CRM holds. Run it anytime with Sync now.",
                  },
                  {
                    icon: Upload, title: "Push — log touchpoints back",
                    body: "When a real milestone happens in your outbound — a positive reply, a booked meeting, a signed proposal — Nous logs it onto the matching CRM record. Low-signal noise (every open, every back-and-forth) stays in the graph and never clutters the CRM.",
                  },
                  {
                    icon: UserPlus, title: "Create — only earned records",
                    body: "A prospect who isn't in the CRM yet is created automatically once they meet your trigger (by default: a positive reply or a booked meeting) and clear your ICP-fit threshold. Set this per CRM below — so every record is an earned, on-target hand-raise.",
                  },
                  {
                    icon: Sparkles, title: "Hygiene — keep attributes reconciled",
                    body: "On a weekly or monthly schedule, Nous reconciles a slice of contact and account fields against what it knows. Today it enriches and scores records added outside Nous and proposes ICP write-backs; filling and refreshing other fields is rolling out. Every change is proposed with its evidence for your approval — Nous never overwrites a value your team entered without proof.",
                  },
                ].map(({ icon: Icon, title, body }) => (
                  <div key={title} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground/90">
                      <Icon className="h-3.5 w-3.5 text-primary" />
                      {title}
                    </div>
                    <p className="text-[12px] leading-relaxed text-muted-foreground">{body}</p>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[11.5px] leading-relaxed text-muted-foreground/70">
                Every pull, push, create, and hygiene change lands in the live log below — so you can always see exactly what Nous did and why.
              </p>
            </div>
          )}
        </div>

        {loadingConns ? (
          <div className="text-[13px] text-muted-foreground/70 text-center py-12">Loading…</div>
        ) : crmConns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-12 text-center">
            <p className="text-[13px] font-medium text-foreground/80 mb-1">No CRM connected yet</p>
            <p className="text-[12px] text-muted-foreground/70 mb-4">Connect HubSpot, Pipedrive, or Attio to start syncing contacts.</p>
            <button onClick={() => navigate("/integrations")}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 transition-colors">
              <Plus className="h-3.5 w-3.5" /> Connect a CRM
            </button>
          </div>
        ) : (
          <>
            {/* ── Metrics row ── */}
            <div className="mb-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {stats.map(s => (
                <div key={s.label} className="rounded-xl border border-border bg-background p-4">
                  <div className="text-[22px] font-bold text-foreground tabular-nums">
                    {s.raw ? s.value : (typeof s.value === "number" ? s.value.toLocaleString() : s.value)}
                  </div>
                  <div className="text-[12px] text-muted-foreground mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            {/* ── CRM configuration section ── */}
            <div className="mb-6">
              <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold tracking-wide text-muted-foreground">
                <Settings className="h-3.5 w-3.5" />
                CRM CONFIGURATION
              </div>
              <div className="rounded-xl border border-border overflow-hidden">
                {crmConns.map((conn, i) => {
                  const provider = conn.provider?.name as string;
                  const meta = CRM_PROVIDER_META[provider];
                  const cfg = configs[provider];
                  const last = cfg?.last_synced_at ? format(new Date(cfg.last_synced_at), "MMM d, HH:mm") : "never";
                  const isSyncing = syncing === provider;
                  return (
                    <div key={conn.id} className={i < crmConns.length - 1 ? "border-b border-border/60" : ""}>
                    <div className="flex items-center gap-4 px-4 py-3.5">
                      <IntegrationLogo url={meta.logo} name={meta.label} size={26} />
                      <div className="w-40 flex-shrink-0">
                        <div className="text-[13px] font-semibold text-foreground">{meta.label}</div>
                        <div className="text-[11px] text-muted-foreground/70 truncate">{conn.is_verified ? "Connected" : "Needs auth"}</div>
                      </div>
                      <div className="hidden md:flex flex-col text-[12px] w-32 flex-shrink-0">
                        <span className="text-muted-foreground/70">Last sync</span>
                        <span className="text-foreground/80 tabular-nums">{last}</span>
                      </div>
                      <div className="hidden md:flex flex-col text-[12px] w-28 flex-shrink-0">
                        <span className="text-muted-foreground/70">Contacts</span>
                        <span className="text-foreground/80 tabular-nums">{(cfg?.contacts_synced ?? 0).toLocaleString()}</span>
                      </div>
                      <div className="flex-1 flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
                        <label className="flex items-center gap-1.5 text-[12px] text-foreground/80 cursor-pointer whitespace-nowrap"
                          title="Daily incremental pull — contacts, companies, deals updated since the last run.">
                          <input type="checkbox" checked={!!cfg?.auto_sync} disabled={togglingAuto === provider || !conn.is_verified}
                            onChange={e => handleToggleAuto(conn, e.target.checked)}
                            className="h-3.5 w-3.5 accent-primary" />
                          Auto-sync (daily)
                        </label>
                        <label className="flex items-center gap-1.5 text-[12px] text-foreground/80 cursor-pointer whitespace-nowrap"
                          title="Push Nous touchpoints (meetings, replies, signed proposals) to this CRM as native engagements.">
                          <input type="checkbox" checked={cfg?.push_activities !== false} disabled={togglingPush === provider || !conn.is_verified}
                            onChange={e => handleTogglePush(conn, e.target.checked)}
                            className="h-3.5 w-3.5 accent-primary" />
                          Push activities
                        </label>
                        <button onClick={() => handleSync(conn)} disabled={isSyncing || !conn.is_verified}
                          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40">
                          {isSyncing
                            ? <><RefreshCw className="h-3 w-3 animate-spin" /> Syncing…</>
                            : <><Download className="h-3 w-3" /> Sync now</>}
                        </button>
                      </div>
                    </div>

                    {/* ── Create-policy sub-row: WHEN a prospect earns a new CRM record ── */}
                    {conn.is_verified && (
                      <div className="px-4 pb-3.5 -mt-1 md:pl-[4.1rem]">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5">
                          <label className="flex items-center gap-1.5 text-[12px] font-medium text-foreground/80 cursor-pointer whitespace-nowrap"
                            title="When ON, a prospect who isn't in this CRM yet is created automatically once they meet the trigger below. When OFF, Nous only logs activity onto records that already exist.">
                            <input type="checkbox" checked={cfg?.create_in_crm !== false}
                              onChange={e => handleSavePolicy(conn, { createInCrm: e.target.checked })}
                              className="h-3.5 w-3.5 accent-primary" />
                            Create new records
                          </label>
                          {cfg?.create_in_crm !== false && (
                            <>
                              <span className="text-[12px] text-muted-foreground/70">when</span>
                              <select value={cfg?.create_trigger || "positive_reply_or_meeting"}
                                onChange={e => handleSavePolicy(conn, { createTrigger: e.target.value })}
                                className="h-7 rounded-md border border-border bg-background px-2 text-[12px] text-foreground/90">
                                <option value="positive_reply_or_meeting">a reply is positive, or a meeting is booked</option>
                                <option value="any_reply_or_meeting">any reply, or a meeting is booked</option>
                                <option value="meeting_only">a meeting is booked</option>
                                <option value="interested_stage">the contact reaches “interested”</option>
                              </select>
                              <label className="flex items-center gap-1.5 text-[12px] text-foreground/80 cursor-pointer whitespace-nowrap"
                                title="Only create the record if the contact's ICP fit score clears the threshold — keeps off-target replies out of the CRM.">
                                <input type="checkbox" checked={cfg?.create_require_icp_fit !== false}
                                  onChange={e => handleSavePolicy(conn, { createRequireIcpFit: e.target.checked })}
                                  className="h-3.5 w-3.5 accent-primary" />
                                and ICP fit ≥
                              </label>
                              <input type="number" min={0} max={100}
                                key={cfg?.create_icp_threshold ?? 70}
                                defaultValue={cfg?.create_icp_threshold ?? 70}
                                disabled={cfg?.create_require_icp_fit === false}
                                onBlur={e => handleSavePolicy(conn, { createIcpThreshold: Number(e.target.value) })}
                                className="h-7 w-14 rounded-md border border-border bg-background px-2 text-[12px] tabular-nums disabled:opacity-40" />
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* ── Hygiene sub-row: scheduled reconcile + run now ── */}
                    {conn.is_verified && (
                      <div className="px-4 pb-3.5 -mt-1 md:pl-[4.1rem]">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
                          <span className="flex items-center gap-1.5 text-[12px] font-medium text-foreground/80 whitespace-nowrap">
                            <Sparkles className="h-3.5 w-3.5 text-primary" /> Hygiene
                          </span>
                          <label className="flex items-center gap-1.5 text-[12px] text-foreground/80 cursor-pointer whitespace-nowrap"
                            title="Scheduled reconcile: enrich + score net-new records and propose CRM updates for your approval. Never writes to the CRM without sign-off.">
                            <input type="checkbox" checked={cfg?.hygiene_enabled !== false}
                              onChange={e => handleSaveHygiene(conn, { hygieneEnabled: e.target.checked })}
                              className="h-3.5 w-3.5 accent-primary" />
                            Scheduled cleanup
                          </label>
                          {cfg?.hygiene_enabled !== false && (
                            <select value={cfg?.hygiene_cadence || "weekly"}
                              onChange={e => handleSaveHygiene(conn, { hygieneCadence: e.target.value })}
                              className="h-7 rounded-md border border-border bg-background px-2 text-[12px] text-foreground/90">
                              <option value="weekly">weekly</option>
                              <option value="monthly">monthly</option>
                            </select>
                          )}
                          <button onClick={() => handleRunHygiene(conn)} disabled={runningHygiene === provider}
                            className="ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border text-[12px] font-medium text-foreground/80 hover:bg-muted/50 disabled:opacity-40">
                            {runningHygiene === provider
                              ? <><RefreshCw className="h-3 w-3 animate-spin" /> Running…</>
                              : <><Sparkles className="h-3 w-3" /> Run hygiene now</>}
                          </button>
                        </div>
                      </div>
                    )}
                    </div>
                  );
                })}

                {/* If some CRMs are connected but not all, give a path to add more */}
                {connectedProviders.size < CRM_NAMES.length && (
                  <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-t border-border/60">
                    <span className="text-[12px] text-muted-foreground/70">
                      {CRM_NAMES.length - connectedProviders.size} more {CRM_NAMES.length - connectedProviders.size === 1 ? "CRM" : "CRMs"} available — {CRM_NAMES.filter(n => !connectedProviders.has(n)).map(n => CRM_PROVIDER_META[n].label).join(", ")}
                    </span>
                    <button onClick={() => navigate("/integrations")}
                      className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md border border-border px-2.5 py-1 hover:bg-muted/50">
                      <Plus className="h-3.5 w-3.5" /> Add CRM
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* ── Hygiene report — proposed changes awaiting approval ── */}
            {proposals.length > 0 && (
              <div className="mb-6">
                <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold tracking-wide text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" />
                  HYGIENE REPORT — {proposals.length} proposed change{proposals.length === 1 ? "" : "s"}
                </div>
                <div className="rounded-xl border border-border divide-y divide-border/60">
                  {proposals.slice(0, 50).map(p => (
                    <div key={p.id} className="flex items-start gap-3 px-4 py-3">
                      <span className="mt-0.5 inline-flex flex-shrink-0 items-center rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {HYGIENE_KIND_LABEL[p.kind] || p.kind}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] text-foreground/90">{p.reason || p.kind}</div>
                        {summarizeProposed(p.proposed_value) && (
                          <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground/80">{summarizeProposed(p.proposed_value)}</div>
                        )}
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1.5">
                        <button onClick={() => decideProposal(p.id, "approved")}
                          className="inline-flex items-center h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[11.5px] font-semibold hover:bg-primary/90">
                          Approve
                        </button>
                        <button onClick={() => decideProposal(p.id, "dismissed")}
                          className="inline-flex items-center h-7 px-2.5 rounded-md border border-border text-[11.5px] font-medium text-muted-foreground hover:bg-muted/50">
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground/60">
                  Approving records the decision. Writing approved changes back to the CRM ships next (Phase 2).
                </p>
              </div>
            )}

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
                <p className="text-[12px] text-muted-foreground/70">Trigger Sync now above or widen the date range to see runs and pushes.</p>
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

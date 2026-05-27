import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Download, Plus, Activity, Settings } from "lucide-react";
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

type CrmConfig = { auto_sync: boolean; push_activities: boolean; last_synced_at: string | null; contacts_synced: number };
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
          }]);
        } catch {}
      }
      if (!cancelled) setConfigs(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [token, workspaceId, crmConns.length]);

  const saveConfig = async (provider: string, connectionId: string, patch: { autoSync?: boolean; pushActivities?: boolean }) => {
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
          auto_sync:       prev[provider]?.auto_sync ?? false,
          push_activities: prev[provider]?.push_activities ?? true,
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
    if (ok) setConfigs(prev => ({ ...prev, [provider]: {
      auto_sync:       val,
      push_activities: prev[provider]?.push_activities ?? true,
      last_synced_at:  prev[provider]?.last_synced_at ?? null,
      contacts_synced: prev[provider]?.contacts_synced ?? 0,
    }}));
    setTogglingAuto(null);
  };

  const handleTogglePush = async (conn: IntegrationConn, val: boolean) => {
    const provider = conn.provider?.name; if (!provider) return;
    setTogglingPush(provider);
    const ok = await saveConfig(provider, conn.id, { pushActivities: val });
    if (ok) setConfigs(prev => ({ ...prev, [provider]: {
      auto_sync:       prev[provider]?.auto_sync ?? false,
      push_activities: val,
      last_synced_at:  prev[provider]?.last_synced_at ?? null,
      contacts_synced: prev[provider]?.contacts_synced ?? 0,
    }}));
    setTogglingPush(null);
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
                    <div key={conn.id} className={`flex items-center gap-4 px-4 py-3.5 ${i < crmConns.length - 1 ? "border-b border-border/60" : ""}`}>
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

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Download, Plus } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { IntegrationConn, IntegrationLogo } from "@/components/mind/entities";
import { PageHeader } from "@/components/ui/page-header";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

// ─── CRM provider metadata ───────────────────────────────────────────────────
const CRM_PROVIDER_META: Record<string, { label: string; logo: string }> = {
  hubspot:   { label: "HubSpot",   logo: "/provider-logos/hubspot.svg"   },
  pipedrive: { label: "Pipedrive", logo: "/provider-logos/pipedrive.svg" },
  attio:     { label: "Attio",     logo: "/provider-logos/attio.svg"     },
};
const CRM_NAMES = Object.keys(CRM_PROVIDER_META);

type CrmConfig = { auto_sync: boolean; push_activities: boolean; last_synced_at: string | null; contacts_synced: number };
type CrmOp = { id: string; ts: string; event_type: string; summary: string | null; metadata?: any };

export default function CrmSync() {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";
  const navigate = useNavigate();

  // CRM sync is a Scale feature — the API returns 402 feature_not_in_plan for
  // lower plans. Turn that into an upgrade toast.
  const crmGate = () => toast.info("CRM sync is a Scale feature — upgrade on the Usage & Billing page.");

  // Fetch the integration connections ourselves (was a prop on the popup).
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
  const [syncResult, setSyncResult] = useState<Record<string, { total: number; imported: number; skipped: number }>>({});
  const [togglingAuto, setTogglingAuto] = useState<string | null>(null);
  const [togglingPush, setTogglingPush] = useState<string | null>(null);

  // Per-CRM recent ops feed (last 15 events for each provider)
  const [ops, setOps] = useState<Record<string, CrmOp[]>>({});

  const loadOps = useCallback(async () => {
    if (!crmConns.length) return;
    const out: Record<string, CrmOp[]> = {};
    await Promise.all(crmConns.map(async c => {
      const prov = c.provider?.name; if (!prov) return;
      try {
        const r = await fetch(`${apiUrl}/api/workspace/system-log?workspace_id=${workspaceId}&source=${prov}&days=7&limit=15`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) return;
        const d = await r.json();
        out[prov] = (d.events ?? []).map((e: any) => ({ id: e.id, ts: e.occurred_at, event_type: e.event_type, summary: e.summary, metadata: e.metadata }));
      } catch {}
    }));
    setOps(out);
  }, [token, workspaceId, crmConns.map(c => c.provider?.name).join(',')]);

  useEffect(() => { loadOps(); const iv = setInterval(loadOps, 10_000); return () => clearInterval(iv); }, [loadOps]);

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
    setSyncResult(prev => ({ ...prev, [provider]: undefined as any }));
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
      setSyncResult(prev => ({ ...prev, [provider]: { total: d.total || 0, imported: d.imported || 0, skipped: d.skipped || 0 } }));
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
      loadOps();
    } catch {} finally { setSyncing(null); }
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

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-8 py-7">
        <PageHeader
          title="CRM Sync"
          subtitle="A live feed of what Nous is doing with each connected CRM — activity pushes, contact resolutions, and sync runs."
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
          <div className="space-y-4">
            {crmConns.map(conn => {
              const provider = conn.provider?.name as string;
              const meta = CRM_PROVIDER_META[provider];
              const cfg = configs[provider];
              const last = cfg?.last_synced_at ? format(new Date(cfg.last_synced_at), "MMM d, HH:mm") : "never";
              const result = syncResult[provider];
              const isSyncing = syncing === provider;
              return (
                <div key={conn.id} className="rounded-xl border border-border p-5 space-y-4">
                  {/* Header */}
                  <div className="flex items-center gap-3">
                    <IntegrationLogo url={meta.logo} name={meta.label} size={28} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold text-foreground">{meta.label}</div>
                      <div className="text-[12px] text-muted-foreground/70 truncate">{conn.name} · {conn.is_verified ? "Connected" : "Needs auth"}</div>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px]">
                    <div className="text-muted-foreground/70">Last sync</div>
                    <div className="text-foreground/80 tabular-nums">{last}</div>
                    <div className="text-muted-foreground/70">Contacts pulled</div>
                    <div className="text-foreground/80 tabular-nums">{(cfg?.contacts_synced ?? 0).toLocaleString()}</div>
                  </div>

                  {result && (
                    <div className="text-[13px] px-3 py-2 rounded-lg border text-emerald-700 border-emerald-200 bg-emerald-50">
                      Synced {result.total} contacts — {result.imported} new{result.skipped ? `, ${result.skipped} skipped` : ""}
                    </div>
                  )}

                  {/* Controls */}
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
                    <button onClick={() => handleSync(conn)} disabled={isSyncing || !conn.is_verified}
                      className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40">
                      {isSyncing
                        ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Syncing…</>
                        : <><Download className="h-3.5 w-3.5" /> Sync now</>}
                    </button>
                    <label className="flex items-center gap-2 text-[13px] text-foreground/80 cursor-pointer"
                      title="Incremental pull every 15 minutes — contacts, companies, deals updated since the last run.">
                      <input type="checkbox" checked={!!cfg?.auto_sync} disabled={togglingAuto === provider || !conn.is_verified}
                        onChange={e => handleToggleAuto(conn, e.target.checked)}
                        className="h-3.5 w-3.5 accent-primary" />
                      Auto-sync (every 15 min)
                    </label>
                    <label className="flex items-center gap-2 text-[13px] text-foreground/80 cursor-pointer"
                      title="Push Nous touchpoints (meetings, replies, signed proposals) to this CRM as native engagements.">
                      <input type="checkbox" checked={cfg?.push_activities !== false} disabled={togglingPush === provider || !conn.is_verified}
                        onChange={e => handleTogglePush(conn, e.target.checked)}
                        className="h-3.5 w-3.5 accent-primary" />
                      Push activities
                    </label>
                  </div>

                  {/* Recent ops — last 15 events for this provider, refreshes every 10s */}
                  <div className="border-t border-border/60 pt-3.5">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-2">Recent activity</div>
                    {(ops[provider]?.length ?? 0) === 0 ? (
                      <div className="text-[13px] text-muted-foreground/70 italic">No recent activity — push or sync something to populate.</div>
                    ) : (
                      <div className="space-y-1">
                        {ops[provider]!.slice(0, 8).map(o => {
                          const failed = o.event_type.includes('failed');
                          return (
                            <div key={o.id} className="flex items-baseline gap-3">
                              <span className="font-mono text-[12px] text-muted-foreground/70 w-[68px] flex-shrink-0 tabular-nums">{format(new Date(o.ts), "HH:mm:ss")}</span>
                              <span className={`text-[13px] flex-1 truncate ${failed ? "text-red-600" : "text-foreground/80"}`} title={o.summary ?? undefined}>
                                {o.summary || o.event_type}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* If some CRMs are connected but not all, give a path to add more */}
            {connectedProviders.size < CRM_NAMES.length && (
              <div className="flex items-center justify-between rounded-xl border border-dashed border-border px-5 py-3.5">
                <span className="text-[13px] text-muted-foreground/70">
                  {CRM_NAMES.length - connectedProviders.size} more {CRM_NAMES.length - connectedProviders.size === 1 ? "CRM" : "CRMs"} available
                </span>
                <button onClick={() => navigate("/integrations")}
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors rounded-md border border-border px-2.5 py-1 hover:bg-muted/50">
                  <Plus className="h-3.5 w-3.5" /> Add CRM
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

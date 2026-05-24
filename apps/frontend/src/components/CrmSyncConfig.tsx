import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, CheckCircle2, Download, RefreshCw } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  connectionId: string;
  connectionName: string;
  provider: "hubspot" | "pipedrive" | "attio";
}

const PROVIDER_META = {
  hubspot:    { label: "HubSpot",    logo: "/provider-logos/hubspot.svg"    },
  pipedrive:  { label: "Pipedrive",  logo: "/provider-logos/pipedrive.svg"  },
  attio:      { label: "Attio",      logo: "/provider-logos/attio.svg"      },
};

export default function CrmSyncConfig({ open, onClose, workspaceId, connectionId, provider }: Props) {
  const { session } = useAuth();
  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";
  const h = { Authorization: `Bearer ${session?.access_token}` };
  const meta = PROVIDER_META[provider];

  const [autoSync,    setAutoSync]    = useState(false);
  const [syncing,     setSyncing]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [syncResult,  setSyncResult]  = useState<{ total: number; imported: number } | null>(null);
  const [lastSynced,  setLastSynced]  = useState<string | null>(null);
  const [configured,  setConfigured]  = useState(false);

  useEffect(() => {
    if (!open || !workspaceId || !session?.access_token) return;
    fetch(`${apiUrl}/api/crm/sync-config?workspaceId=${workspaceId}&provider=${provider}`, { headers: h })
      .then(r => r.json())
      .then(d => {
        if (d.config) {
          setAutoSync(d.config.auto_sync || false);
          setLastSynced(d.config.last_synced_at || null);
          setSyncResult(d.config.contacts_synced != null ? { total: 0, imported: d.config.contacts_synced } : null);
          setConfigured(true);
        } else {
          setConfigured(false);
        }
      })
      .catch(() => {});
  }, [open, workspaceId]);

  const saveConfig = async (newAutoSync: boolean) => {
    setSaving(true);
    try {
      const r = await fetch(`${apiUrl}/api/crm/sync-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...h },
        body: JSON.stringify({ workspaceId, connectionId, provider, autoSync: newAutoSync }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to save");
      setConfigured(true);
    } catch (e: any) { toast.error(e.message || "Failed"); }
    finally { setSaving(false); }
  };

  const handleToggle = async (val: boolean) => {
    setAutoSync(val);
    await saveConfig(val);
    toast.success(val ? "Auto-sync enabled" : "Auto-sync disabled");
  };

  const handleSyncNow = async () => {
    if (!configured) await saveConfig(autoSync);
    setSyncing(true); setSyncResult(null);
    try {
      const r = await fetch(`${apiUrl}/api/crm/sync-now`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...h },
        body: JSON.stringify({ workspaceId, provider }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Sync failed");
      setSyncResult({ total: d.total, imported: d.imported });
      setLastSynced(new Date().toISOString());
      setConfigured(true);
      toast.success(`Synced ${d.total} contacts — ${d.imported} new`);
    } catch (e: any) { toast.error(e.message || "Sync failed"); }
    finally { setSyncing(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <img src={meta.logo} alt={meta.label} className="h-4 w-auto" />
            {meta.label}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-1">
          {configured && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-start gap-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-emerald-800">{meta.label} connected</p>
                {lastSynced && (
                  <p className="text-[11px] text-emerald-600 mt-0.5">
                    Last synced {new Date(lastSynced).toLocaleDateString()}
                    {syncResult && ` · ${syncResult.imported} contacts`}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2.5 space-y-1">
            <p className="text-[12px] text-gray-500">
              Nous pulls contacts from {meta.label} by email, then writes pipeline stage and deal health score back.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
            <div>
              <p className="text-[12px] font-medium text-gray-700">Auto-sync (every 15 min)</p>
              <p className="text-[11px] text-gray-400">Pulls new + updated records incrementally</p>
            </div>
            <Switch checked={autoSync} disabled={saving} onCheckedChange={handleToggle} />
          </div>

          <Button className="w-full text-xs" disabled={syncing} onClick={handleSyncNow}>
            {syncing
              ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Syncing…</>
              : <><Download className="h-3 w-3 mr-1.5" />Sync now</>
            }
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

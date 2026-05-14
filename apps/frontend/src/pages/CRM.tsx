import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, RefreshCw, Download, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CrmProvider, CrmConnection, CrmRecord } from "@/types/crm";

const PROVIDER_META: Partial<Record<CrmProvider, { label: string; logo: string }>> = {
  hubspot:   { label: "HubSpot",   logo: "/provider-logos/hubspot.svg"   },
  pipedrive: { label: "Pipedrive", logo: "/provider-logos/pipedrive.svg" },
  attio:     { label: "Attio",     logo: "/provider-logos/attio.svg"     },
};

type Tab = "contacts" | "companies" | "deals";

interface ConnectedCRM extends CrmConnection {
  connectionId: string;
}

export default function CRM() {
  const { session, userData, userDataLoading } = useAuth();
  const apiUrl = import.meta.env.VITE_API_URL ?? "";
  const workspaceId = userData?.workspace?.id || localStorage.getItem("selectedWorkspaceId") || "";

  const [loadingConn, setLoadingConn] = useState(true);
  const [crm, setCrm] = useState<ConnectedCRM | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("contacts");
  const [search, setSearch] = useState("");
  const [records, setRecords] = useState<CrmRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());

  const headers = { Authorization: `Bearer ${session?.access_token}` };

  // Detect connected CRM
  useEffect(() => {
    if (!session?.access_token) return;
    if (!workspaceId) {
      if (!userDataLoading) setLoadingConn(false);
      return;
    }
    setLoadingConn(true);
    fetch(`${apiUrl}/api/workflow-providers/connections?workspace_id=${workspaceId}`, { headers })
      .then(r => r.json())
      .then(d => {
        const found = (d.connections || []).find((c: any) =>
          ["hubspot", "pipedrive", "attio"].includes(c.provider?.name?.toLowerCase())
        );
        if (found) {
          localStorage.setItem("connectedCrmProvider", found.provider.name.toLowerCase());
          window.dispatchEvent(new Event("crm-provider-changed"));
          setCrm({
            id: found.id,
            connectionId: found.id,
            provider: found.provider.name.toLowerCase() as CrmProvider,
            providerName: found.provider.display_name || found.provider.name,
            isVerified: found.is_verified,
            lastTestAt: found.last_test_at,
          });
        } else {
          localStorage.removeItem("connectedCrmProvider");
          setCrm(null);
        }
      })
      .catch(() => toast.error("Failed to load connections"))
      .finally(() => setLoadingConn(false));
  }, [session?.access_token, workspaceId, userDataLoading]);

  // Fetch live records
  const fetchRecords = useCallback(async () => {
    if (!crm || !session?.access_token) return;
    setLoadingRecords(true);
    try {
      const params = new URLSearchParams({
        provider: crm.provider,
        type: activeTab === "contacts" ? "contact" : activeTab === "companies" ? "company" : "deal",
        connectionId: crm.connectionId,
        workspaceId,
        ...(search ? { search } : {}),
      });
      const r = await fetch(`${apiUrl}/api/crm/records?${params}`, { headers });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to fetch records");
      setRecords(d.records || []);
    } catch (e: any) {
      toast.error(e.message || "Failed to load records");
      setRecords([]);
    } finally {
      setLoadingRecords(false);
    }
  }, [crm, activeTab, search, session?.access_token, workspaceId]);

  useEffect(() => { if (crm) fetchRecords(); }, [crm, activeTab]);

  const handleImport = useCallback(async (record: CrmRecord) => {
    if (!crm || importingIds.has(record.id) || importedIds.has(record.id)) return;
    setImportingIds(prev => new Set(prev).add(record.id));
    try {
      const r = await fetch(`${apiUrl}/api/crm/import`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          provider: crm.provider,
          connectionId: crm.connectionId,
          records: [{ ...record, type: activeTab === "contacts" ? "contact" : activeTab === "companies" ? "company" : "deal" }],
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Import failed');
      if (d.errors?.length) throw new Error(d.errors[0].error);
      setImportedIds(prev => new Set(prev).add(record.id));
      toast.success(activeTab === "deals" ? "Deal imported — pipeline stage updated" : "Imported to Proply");
    } catch (e: any) {
      toast.error(e.message || 'Import failed');
    } finally {
      setImportingIds(prev => { const s = new Set(prev); s.delete(record.id); return s; });
    }
  }, [crm, activeTab, workspaceId, importingIds, importedIds]);

  useEffect(() => {
    if (!crm) return;
    const t = setTimeout(fetchRecords, 350);
    return () => clearTimeout(t);
  }, [search]);

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (loadingConn) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  // ── No CRM connected ─────────────────────────────────────────────────────────

  if (!crm) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <p className="text-[13px] text-gray-400">No CRM connected yet.</p>
      </div>
    );
  }

  const meta = PROVIDER_META[crm.provider];

  // ── Connected view ───────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-white">

      {/* Page header */}
      <div className="flex-shrink-0 px-6 pt-5 pb-0">

        {/* Title row */}
        <div className="flex items-center gap-2.5 mb-1.5">
          {meta?.logo && (
            <img src={meta.logo} alt={meta.label} className="h-5 w-5 object-contain flex-shrink-0" />
          )}
          <h1 className="text-[24px] font-semibold text-gray-900 tracking-tight">
            {meta?.label ?? crm.providerName}
          </h1>
          <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium mt-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
            Live
          </span>
          <div className="flex-1" />
          <a
            href="/integrations"
            className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            Manage
          </a>
        </div>

        {/* Filter strip */}
        <div className="flex items-center border-b border-gray-100 pb-0 gap-0">

          {/* Tabs */}
          <div className="flex items-center gap-0.5 mr-2">
            {(["contacts", "companies", "deals"] as Tab[]).map(tab => (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setSearch(""); }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-[13px] rounded-md transition-colors capitalize",
                  activeTab === tab
                    ? "bg-gray-100 text-gray-900 font-medium"
                    : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Right: search + refresh */}
          <div className="flex items-center gap-2 py-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={`Search ${activeTab}…`}
                className="pl-9 pr-3 h-7 w-44 text-[12px] bg-white border-gray-200 rounded-md shadow-sm focus-visible:ring-1 focus-visible:ring-teal-500/30 focus-visible:border-teal-400 placeholder:text-gray-400 transition-all"
              />
            </div>
            <button
              onClick={fetchRecords}
              disabled={loadingRecords}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] text-gray-500 hover:text-gray-800 hover:bg-gray-50 rounded-md transition-colors border border-gray-200 disabled:opacity-40"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loadingRecords && "animate-spin")} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loadingRecords ? (
          <div>
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-3.5 border-b border-gray-50">
                <div className="h-3.5 w-32 bg-gray-100 rounded animate-pulse" />
                <div className="h-3.5 w-40 bg-gray-100 rounded animate-pulse" />
                <div className="h-3.5 w-28 bg-gray-100 rounded animate-pulse" />
                <div className="flex-1" />
                <div className="h-3.5 w-20 bg-gray-100 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : records.length === 0 ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-[13px] text-gray-400">
              {search ? "No matching records" : `No ${activeTab} found`}
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-6 py-3 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide">Name</th>
                <th className="px-3 py-3 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide">
                  {activeTab === "contacts" ? "Email" : activeTab === "companies" ? "Domain" : "Value"}
                </th>
                <th className="px-3 py-3 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide">
                  {activeTab === "contacts" ? "Company" : activeTab === "companies" ? "Industry" : "Stage"}
                </th>
                <th className="px-3 py-3 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide">
                  {activeTab === "companies" ? "Location" : "Owner"}
                </th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {records.map(rec => (
                <tr key={rec.id} className="border-b border-gray-50 transition-colors hover:bg-gray-50/60">
                  <td className="px-6 py-3.5">
                    <span className="text-[13px] font-medium text-gray-900">{rec.name}</span>
                  </td>
                  <td className="px-3 py-3.5">
                    <span className="text-[13px] text-gray-500">
                      {activeTab === "contacts"
                        ? rec.email || "—"
                        : activeTab === "companies"
                          ? (rec as any).domain || "—"
                          : rec.dealValue != null
                            ? `${rec.dealCurrency ?? "$"}${rec.dealValue.toLocaleString()}`
                            : "—"
                      }
                    </span>
                  </td>
                  <td className="px-3 py-3.5">
                    {activeTab === "contacts"
                      ? <span className="text-[13px] text-gray-500">{rec.company || rec.organizationName || "—"}</span>
                      : activeTab === "companies"
                        ? <span className="text-[13px] text-gray-500">{(rec as any).industry || "—"}</span>
                        : rec.dealStage
                          ? <Badge variant="secondary" className="text-[11px] font-normal">{rec.dealStage}</Badge>
                          : <span className="text-[13px] text-gray-300">—</span>
                    }
                  </td>
                  <td className="px-3 py-3.5">
                    <span className="text-[13px] text-gray-400">
                      {activeTab === "companies"
                        ? [((rec as any).city), ((rec as any).country)].filter(Boolean).join(", ") || "—"
                        : rec.ownerName || "—"
                      }
                    </span>
                  </td>
                  <td className="px-3 py-3.5 text-right">
                    {importedIds.has(rec.id) ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                        <Check className="h-3 w-3" /> Imported
                      </span>
                    ) : (
                      <button
                        onClick={() => handleImport(rec)}
                        disabled={importingIds.has(rec.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors disabled:opacity-40"
                      >
                        {importingIds.has(rec.id)
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Download className="h-3 w-3" />
                        }
                        Import
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

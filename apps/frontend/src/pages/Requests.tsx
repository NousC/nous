import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { freshAccessToken } from "@/lib/freshToken";
import {
  ArrowDownToLine, ArrowUpFromLine, Trash2, Search, Globe, Code2, Webhook,
  Brain, Users, Building2, RefreshCw, ScrollText,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { format, formatDistanceToNow } from "date-fns";
import SystemLog from "@/pages/SystemLog";

type Tab = "requests" | "activity";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

interface RequestRow {
  id: string;
  created_at: string;
  op_type: "write" | "retrieve" | "delete";
  entity_type: string;
  source: string;
  api_key_name: string | null;
}

type FilterType = "all" | "write" | "retrieve" | "delete";
type DateRange = "1d" | "7d" | "30d" | "all";

const DATE_TABS: { id: DateRange; label: string }[] = [
  { id: "1d",  label: "1d"       },
  { id: "7d",  label: "7d"       },
  { id: "30d", label: "30d"      },
  { id: "all", label: "All Time" },
];

function opLabel(entityType: string, opType: string) {
  if (opType === "delete") {
    if (entityType === "memory")  return "Delete Memory";
    if (entityType === "contact") return "Delete Contact";
    return "Delete";
  }
  if (opType === "write") {
    if (entityType === "activity")       return "Track";
    if (entityType === "memory")         return "Remember";
    if (entityType === "contact_create") return "Create Contact";
    if (entityType === "contact_update") return "Update Contact";
    return "Write";
  }
  if (entityType === "contact")      return "Get Contact";
  if (entityType === "company")      return "Get Company";
  if (entityType === "contact_list") return "List Contacts";
  if (entityType === "search")       return "Search";
  return "Retrieve";
}

function OpBadge({ opType }: { opType: string }) {
  if (opType === "delete") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-600 border border-red-100">
        <Trash2 className="h-2.5 w-2.5" />
        Delete
      </span>
    );
  }
  const isWrite = opType === "write";
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold",
      isWrite
        ? "bg-violet-50 text-violet-600 border border-violet-100"
        : "bg-blue-50 text-blue-600 border border-blue-100"
    )}>
      {isWrite
        ? <ArrowUpFromLine className="h-2.5 w-2.5" />
        : <ArrowDownToLine className="h-2.5 w-2.5" />}
      {isWrite ? "Write" : "Retrieve"}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  const isMcp = source === "mcp";
  const isWebhook = source === "webhook";
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold",
      isMcp     ? "bg-violet-50 text-violet-600"  :
      isWebhook ? "bg-amber-50 text-amber-600"    :
                  "bg-gray-100 text-gray-500"
    )}>
      {isMcp     ? <Brain   className="h-2.5 w-2.5" /> :
       isWebhook ? <Webhook className="h-2.5 w-2.5" /> :
                   <Code2   className="h-2.5 w-2.5" />}
      {isMcp ? "MCP" : isWebhook ? "Webhook" : "SDK"}
    </span>
  );
}

function EntityIcon({ entityType }: { entityType: string }) {
  const cls = "h-3.5 w-3.5 text-gray-400 flex-shrink-0";
  if (entityType === "contact" || entityType === "contact_create" || entityType === "contact_update")  return <Users      className={cls} strokeWidth={1.5} />;
  if (entityType === "company")  return <Building2  className={cls} strokeWidth={1.5} />;
  if (entityType === "memory")   return <Brain      className={cls} strokeWidth={1.5} />;
  if (entityType === "search")   return <Search     className={cls} strokeWidth={1.5} />;
  if (entityType === "activity") return <Globe      className={cls} strokeWidth={1.5} />;
  return null;
}

export default function Requests() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";

  const [tab, setTab]             = useState<Tab>("requests");
  const [rows, setRows]           = useState<RequestRow[]>([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [filter, setFilter]       = useState<FilterType>("all");
  const [dateRange, setDateRange] = useState<DateRange>("7d");
  const [search, setSearch]       = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const fresh = await freshAccessToken();
      if (!fresh) { setLoading(false); return; }
      const params = new URLSearchParams({ days: dateRange, limit: "100" });
      if (filter !== "all") params.set("op_type", filter);
      const res = await fetch(`${apiUrl}/api/requests/log?${params}`, {
        headers: { Authorization: `Bearer ${fresh}` },
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setRows(d.requests ?? []);
      setTotal(d.total ?? 0);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [token, filter, dateRange]);

  useEffect(() => { load(); }, [load]);

  const filtered = search.trim()
    ? rows.filter(r =>
        opLabel(r.entity_type, r.op_type).toLowerCase().includes(search.toLowerCase()) ||
        r.entity_type.toLowerCase().includes(search.toLowerCase()) ||
        (r.api_key_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
        r.source.toLowerCase().includes(search.toLowerCase())
      )
    : rows;

  const writeCount    = rows.filter(r => r.op_type === "write").length;
  const retrieveCount = rows.filter(r => r.op_type !== "write" && r.op_type !== "delete").length;
  const deleteCount   = rows.filter(r => r.op_type === "delete").length;

  if (tab === "activity") {
    return (
      <div className="flex flex-col h-full bg-white">
        <div className="flex-shrink-0 px-8 pt-5 pb-0 border-b border-gray-100">
          <TabBar tab={tab} setTab={setTab} />
        </div>
        <div className="flex-1 min-h-0">
          <SystemLog />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex-shrink-0 px-8 pt-7 pb-5 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight">Requests</h1>
            <p className="text-[12px] text-gray-400 mt-0.5">
              All agent interactions with your workspace — track, remember, retrieve, and search.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <TabBar tab={tab} setTab={setTab} />
            <button
              onClick={load}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 mt-5">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-100">
            <span className="text-[12px] text-gray-500">Total</span>
            <span className="text-[13px] font-semibold text-gray-900 tabular-nums">{total.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 border border-violet-100">
            <ArrowUpFromLine className="h-3 w-3 text-violet-500" />
            <span className="text-[12px] text-violet-600">Write</span>
            <span className="text-[13px] font-semibold text-violet-700 tabular-nums">{writeCount.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-100">
            <ArrowDownToLine className="h-3 w-3 text-blue-500" />
            <span className="text-[12px] text-blue-600">Retrieve</span>
            <span className="text-[13px] font-semibold text-blue-700 tabular-nums">{retrieveCount.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 border border-red-100">
            <Trash2 className="h-3 w-3 text-red-500" />
            <span className="text-[12px] text-red-600">Delete</span>
            <span className="text-[13px] font-semibold text-red-700 tabular-nums">{deleteCount.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-3 px-8 py-3 border-b border-gray-100">
        {/* Date filter */}
        <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 rounded-lg">
          {DATE_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setDateRange(t.id)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
                dateRange === t.id
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Op type filter */}
        <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 rounded-lg">
          {(["all", "write", "retrieve", "delete"] as FilterType[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all capitalize",
                filter === f
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              {f === "all" ? "All" : f === "write" ? "Write" : f === "retrieve" ? "Retrieve" : "Delete"}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative w-52">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter requests…"
            className="pl-8 h-8 text-[12px] bg-white border-gray-200 rounded-lg focus-visible:ring-1 focus-visible:ring-gray-300 placeholder:text-gray-400"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {/* Header row */}
        <div className="sticky top-0 z-10 grid grid-cols-[1fr_110px_90px_90px_140px] gap-4 px-8 py-2.5 bg-gray-50/90 backdrop-blur border-b border-gray-100">
          {["Operation", "Type", "Source", "Entity", "Time"].map(h => (
            <p key={h} className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{h}</p>
          ))}
        </div>

        {loading ? (
          <div className="space-y-px px-8 py-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-50 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <Globe className="h-5 w-5 text-gray-400" />
            </div>
            <p className="text-[13px] font-medium text-gray-700 mb-1">No requests yet</p>
            <p className="text-[12px] text-gray-400 max-w-xs">
              Agent requests (track, remember, search, get contact) will appear here once your integration is live.
            </p>
          </div>
        ) : (
          <div>
            {filtered.map((row, i) => (
              <div
                key={row.id}
                className={cn(
                  "grid grid-cols-[1fr_110px_90px_90px_140px] gap-4 items-center px-8 py-3 hover:bg-gray-50/70 transition-colors",
                  i > 0 && "border-t border-gray-50"
                )}
              >
                {/* Operation */}
                <div className="flex items-center gap-2 min-w-0">
                  <EntityIcon entityType={row.entity_type} />
                  <span className="text-[13px] font-medium text-gray-800 truncate">
                    {opLabel(row.entity_type, row.op_type)}
                  </span>
                  {row.api_key_name && (
                    <span className="text-[11px] text-gray-400 truncate">· {row.api_key_name}</span>
                  )}
                </div>

                {/* Type */}
                <div>
                  <OpBadge opType={row.op_type} />
                </div>

                {/* Source */}
                <div>
                  <SourceBadge source={row.source || "sdk"} />
                </div>

                {/* Entity */}
                <span className="text-[12px] text-gray-500 capitalize">{row.entity_type}</span>

                {/* Time */}
                <div>
                  <p className="text-[12px] text-gray-500">
                    {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                  </p>
                  <p className="text-[10px] text-gray-350 text-gray-300">
                    {format(new Date(row.created_at), "MMM d, HH:mm")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 rounded-lg">
      <button
        onClick={() => setTab("requests")}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
          tab === "requests" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
        )}
      >
        <RefreshCw className="h-3 w-3" />
        Requests
      </button>
      <button
        onClick={() => setTab("activity")}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
          tab === "activity" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
        )}
      >
        <ScrollText className="h-3 w-3" />
        Activity Log
      </button>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { freshAccessToken } from "@/lib/freshToken";
import {
  Mail, Video, Zap, Calendar, Globe, Activity, Brain, RefreshCw, Search,
  GitBranch, Webhook, ChevronRight, Users, Target, Upload, Linkedin,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { format, formatDistanceToNow } from "date-fns";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

interface SystemEvent {
  id: string;
  source: string;
  event_type: string;
  summary: string;
  contact_id: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

type DateRange = "1d" | "7d" | "30d" | "all";

const DATE_TABS: { id: DateRange; label: string }[] = [
  { id: "1d",  label: "1d"       },
  { id: "7d",  label: "7d"       },
  { id: "30d", label: "30d"      },
  { id: "all", label: "All Time" },
];

const SOURCES = [
  { id: "all",        label: "All"        },
  { id: "gmail",      label: "Gmail"      },
  { id: "smtp",       label: "SMTP"       },
  { id: "fireflies",  label: "Fireflies"  },
  { id: "apollo",     label: "Apollo"     },
  { id: "prospeo",    label: "Prospeo"    },
  { id: "import",     label: "Import"     },
  { id: "system",     label: "ICP"        },
  { id: "calendly",   label: "Calendly"   },
  { id: "rb2b",       label: "RB2B"       },
  { id: "signalbase", label: "Signalbase" },
  { id: "memory",     label: "Memory"     },
  { id: "linkedin",   label: "LinkedIn"   },
  { id: "pipeline",   label: "Pipeline"   },
];

const SOURCE_META: Record<string, { icon: React.ComponentType<{ className?: string }>, color: string, bg: string }> = {
  gmail:      { icon: Mail,      color: "text-blue-600",   bg: "bg-blue-50 border-blue-100"     },
  smtp:       { icon: Mail,      color: "text-blue-500",   bg: "bg-blue-50 border-blue-100"     },
  fireflies:  { icon: Video,     color: "text-purple-600", bg: "bg-purple-50 border-purple-100" },
  apollo:     { icon: Zap,       color: "text-orange-600", bg: "bg-orange-50 border-orange-100" },
  prospeo:    { icon: Search,    color: "text-blue-700",   bg: "bg-blue-50 border-blue-200"     },
  import:     { icon: Upload,    color: "text-emerald-600",bg: "bg-emerald-50 border-emerald-100"},
  system:     { icon: Target,    color: "text-indigo-600", bg: "bg-indigo-50 border-indigo-100" },
  calendly:   { icon: Calendar,  color: "text-teal-600",   bg: "bg-teal-50 border-teal-100"     },
  rb2b:       { icon: Globe,     color: "text-green-600",  bg: "bg-green-50 border-green-100"   },
  signalbase: { icon: Activity,  color: "text-indigo-600", bg: "bg-indigo-50 border-indigo-100" },
  memory:     { icon: Brain,     color: "text-violet-600", bg: "bg-violet-50 border-violet-100" },
  linkedin:   { icon: Linkedin,  color: "text-blue-700",   bg: "bg-blue-50 border-blue-200"     },
  pipeline:   { icon: GitBranch, color: "text-gray-600",   bg: "bg-gray-100 border-gray-200"    },
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  sync_run:            "Sync",
  webhook_received:    "Webhook",
  signal_ingested:     "Signal",
  extraction_complete: "Extracted",
  stage_transition:    "Stage",
  enrichment_run:      "Enriched",
  icp_scored:          "ICP Score",
  import_run:          "Import",
  auth_failed:         "Error",
};

function SourceBadge({ source }: { source: string }) {
  const meta = SOURCE_META[source] ?? { icon: Webhook, color: "text-gray-500", bg: "bg-gray-100 border-gray-200" };
  const Icon = meta.icon;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border",
      meta.bg, meta.color
    )}>
      <Icon className="h-2.5 w-2.5" />
      {source.charAt(0).toUpperCase() + source.slice(1)}
    </span>
  );
}

function EventTypeBadge({ eventType }: { eventType: string }) {
  const label = EVENT_TYPE_LABELS[eventType] ?? eventType;
  const isError = eventType === "auth_failed";
  return (
    <span className={cn(
      "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
      isError ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-500"
    )}>
      {label}
    </span>
  );
}

function SourceIcon({ source }: { source: string }) {
  const meta = SOURCE_META[source];
  if (!meta) return <Webhook className="h-4 w-4 text-gray-300 flex-shrink-0" />;
  const Icon = meta.icon;
  return <Icon className={cn("h-4 w-4 flex-shrink-0", meta.color)} />;
}

export default function SystemLog() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = localStorage.getItem("selectedWorkspaceId") ?? "";

  const [events, setEvents]         = useState<SystemEvent[]>([]);
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(false);
  const [dateRange, setDateRange]   = useState<DateRange>("7d");
  const [source, setSource]         = useState("all");
  const [search, setSearch]         = useState("");

  const load = useCallback(async () => {
    if (!token || !workspaceId) return;
    setLoading(true);
    try {
      const fresh = await freshAccessToken();
      if (!fresh) { setLoading(false); return; }
      const params = new URLSearchParams({ workspace_id: workspaceId, days: dateRange, limit: "200" });
      if (source !== "all") params.set("source", source);
      const res = await fetch(`${apiUrl}/api/workspace/system-log?${params}`, {
        headers: { Authorization: `Bearer ${fresh}` },
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setEvents(d.events ?? []);
      setTotal(d.total ?? 0);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [token, workspaceId, dateRange, source]);

  useEffect(() => { load(); }, [load]);

  const filtered = search.trim()
    ? events.filter(e =>
        e.summary.toLowerCase().includes(search.toLowerCase()) ||
        e.source.toLowerCase().includes(search.toLowerCase()) ||
        e.event_type.toLowerCase().includes(search.toLowerCase())
      )
    : events;

  const sourceBreakdown = SOURCES.slice(1).map(s => ({
    ...s,
    count: events.filter(e => e.source === s.id).length,
  })).filter(s => s.count > 0);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex-shrink-0 px-8 pt-7 pb-5 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight">Activity Log</h1>
            <p className="text-[12px] text-gray-400 mt-0.5">
              Every integration event, webhook, and system action — in real time.
            </p>
          </div>
          <button
            onClick={load}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-3 mt-5 flex-wrap">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-100">
            <span className="text-[12px] text-gray-500">Total</span>
            <span className="text-[13px] font-semibold text-gray-900 tabular-nums">{total.toLocaleString()}</span>
          </div>
          {sourceBreakdown.map(s => {
            const meta = SOURCE_META[s.id];
            const Icon = meta?.icon ?? Webhook;
            return (
              <div key={s.id} className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border",
                meta?.bg ?? "bg-gray-50 border-gray-100"
              )}>
                <Icon className={cn("h-3 w-3", meta?.color ?? "text-gray-500")} />
                <span className={cn("text-[12px]", meta?.color ?? "text-gray-500")}>{s.label}</span>
                <span className={cn("text-[13px] font-semibold tabular-nums", meta?.color ?? "text-gray-700")}>{s.count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-3 px-8 py-3 border-b border-gray-100 flex-wrap">
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

        {/* Source filter */}
        <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 rounded-lg">
          {SOURCES.map(s => (
            <button
              key={s.id}
              onClick={() => setSource(s.id)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
                source === s.id
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              {s.label}
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
            placeholder="Filter events…"
            className="pl-8 h-8 text-[12px] bg-white border-gray-200 rounded-lg focus-visible:ring-1 focus-visible:ring-gray-300 placeholder:text-gray-400"
          />
        </div>
      </div>

      {/* Log */}
      <div className="flex-1 overflow-auto">
        {loading && events.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <div className="h-4 w-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <Activity className="h-8 w-8 text-gray-200" />
            <p className="text-[13px] text-gray-400">No events yet for this period.</p>
            <p className="text-[11px] text-gray-300">Events appear here as integrations fire.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map(event => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: SystemEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hasMetadata = event.metadata && Object.keys(event.metadata).length > 0;

  return (
    <div
      className={cn(
        "px-8 py-3 hover:bg-gray-50/60 transition-colors",
        hasMetadata && "cursor-pointer"
      )}
      onClick={() => hasMetadata && setExpanded(e => !e)}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="mt-0.5 flex-shrink-0">
          <SourceIcon source={event.source} />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <SourceBadge source={event.source} />
            <EventTypeBadge eventType={event.event_type} />
            {event.contact_id && (
              <span className="inline-flex items-center gap-1 text-[10px] text-gray-400">
                <Users className="h-2.5 w-2.5" />
                contact
              </span>
            )}
          </div>
          <p className="text-[12px] text-gray-700 mt-1 leading-snug">{event.summary}</p>
        </div>

        {/* Timestamp */}
        <div className="flex-shrink-0 flex items-center gap-1.5 text-right">
          <div>
            <p className="text-[11px] text-gray-400 tabular-nums">
              {formatDistanceToNow(new Date(event.occurred_at), { addSuffix: true })}
            </p>
            <p className="text-[10px] text-gray-300 tabular-nums">
              {format(new Date(event.occurred_at), "MMM d, HH:mm")}
            </p>
          </div>
          {hasMetadata && (
            <ChevronRight className={cn(
              "h-3.5 w-3.5 text-gray-300 transition-transform flex-shrink-0",
              expanded && "rotate-90"
            )} />
          )}
        </div>
      </div>

      {/* Expanded metadata */}
      {expanded && hasMetadata && (
        <div className="mt-2 ml-7 p-2.5 rounded-lg bg-gray-50 border border-gray-100">
          <pre className="text-[10px] text-gray-500 font-mono whitespace-pre-wrap break-all leading-relaxed">
            {JSON.stringify(event.metadata, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

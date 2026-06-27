import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams, useParams } from "react-router-dom";
import { Plus, Upload, RefreshCw, FileText, X, ArrowLeft, Download, Lock, Filter, ChevronDown, Linkedin, Coins, Settings2, Calendar } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/ui/page-header";
import { parseCSVLine } from "@/components/contacts/PeopleImportModal";
import { relTime } from "@/components/mind/shared";
import { toast } from "@/components/ui/sonner";

// Lists — the Enterprise lead-list workspace. Each list is a small table the
// user shapes: fixed columns (name/email/company/linkedin) plus user-defined
// columns; leads added by mapped CSV import or one row at a time.

const apiUrl = import.meta.env.VITE_API_URL ?? "";
const IMPORT_CHUNK = 2000;

// Fixed columns — real `leads` table columns, present on every list.
const FIXED_COLS: { key: string; label: string; w: number }[] = [
  { key: "name",         label: "Name",     w: 180 },
  { key: "email",        label: "Email",    w: 210 },
  { key: "company",      label: "Company",  w: 160 },
  { key: "linkedin_url", label: "LinkedIn", w: 150 },
];
const FIXED_KEYS = new Set(FIXED_COLS.map(c => c.key));

// The default custom columns every list carries (mirrors the backend
// DEFAULT_LEAD_COLUMNS in packages/core). Surfaced on every list — even an older
// list whose stored `columns` predate them — so the default column set is always
// enforced, not just on lists created after the defaults were added.
const DEFAULT_CUSTOM_COLS: { key: string; label: string }[] = [
  { key: "title",        label: "Title" },
  { key: "industry",     label: "Industry" },
  { key: "company_size", label: "Company size" },
];
const CUSTOM_W = 150;
const STATUS_W = 100;
const SEL_W = 40;
const SKIP = "";           // mapping target: ignore this CSV column
const NEW_COL = "__new__"; // mapping target: create a new column from this header

// Filter-builder dimensions — "Where <column> is <value>". Each field key is the
// query param sent to the leads endpoint; values map to that param's accepted set.
// Filter dimensions. Most pick from a fixed value set; `type: "text"` fields
// (Channel, Source) take a free-typed substring instead — you type what to match.
const FB_FIELDS: { key: string; label: string; type?: "text"; values: { v: string; l: string }[] }[] = [
  { key: "size", label: "Company size", values: [
    { v: "1 to 10", l: "1–10" }, { v: "11 to 50", l: "11–50" }, { v: "51 to 200", l: "51–200" },
    { v: "201 to 500", l: "201–500" }, { v: "501 to 1,000", l: "501–1,000" },
    { v: "1,001 to 5,000", l: "1,001–5,000" }, { v: "5,001", l: "5,001–10,000" }, { v: "10,001", l: "10,000+" },
  ] },
  { key: "emailStatus", label: "Email status", values: [
    { v: "has", l: "Has email" }, { v: "none", l: "No email" },
    { v: "VERIFIED", l: "Verified" }, { v: "RISKY", l: "Risky" }, { v: "UNAVAILABLE", l: "Unavailable" },
  ] },
  { key: "channel", label: "Channel", type: "text", values: [] },
  { key: "source", label: "Source", type: "text", values: [] },
  { key: "domain", label: "Domain", values: [ { v: "has", l: "Has domain" }, { v: "none", l: "No domain" } ] },
];
const fbLabel = (field: string, value: string) => {
  const f = FB_FIELDS.find(x => x.key === field);
  return `${f?.label ?? field}: ${f?.values.find(v => v.v === value)?.l ?? value}`;
};

// CSV-header aliases for auto-mapping to the fixed columns.
const FIXED_ALIASES: Record<string, string[]> = {
  email:        ["email", "e-mail", "email address", "work email", "emails"],
  name:         ["name", "full name", "full_name", "contact name", "contact", "lead name"],
  company:      ["company", "company name", "organization", "organisation", "account", "employer"],
  linkedin_url: ["linkedin", "linkedin url", "linkedin profile", "linkedin_url", "li url", "li"],
};

// Outbound sequencers the list can export into. `kind` decides the required
// identifier (email vs LinkedIn URL) and the modal copy.
const SEQUENCER_APPS: { id: string; label: string; kind: "email" | "linkedin"; logo: string }[] = [
  { id: "instantly", label: "Instantly", kind: "email",    logo: "/provider-logos/instantly.svg" },
  { id: "heyreach",  label: "HeyReach",  kind: "linkedin", logo: "/provider-logos/heyreach.png" },
  { id: "lemlist",   label: "Lemlist",   kind: "email",    logo: "/provider-logos/lemlist.svg" },
];

interface LeadColumn { key: string; label: string; }
interface LeadList {
  id: string;
  name: string;
  source: string;
  columns: LeadColumn[];
  lead_count?: number;
  created_at: string;
}
interface Lead {
  id: string;
  email: string | null;
  name: string | null;
  company: string | null;
  linkedin_url: string | null;
  status: string;
  reply_outcome: string | null;
  domain: string | null;
  email_status: string | null;
  last_channel: string | null;
  source: string | null;
  scorecard_score: number | null;
  created_at: string | null;
  fields: Record<string, unknown>;
}

// Known interaction sources map to the platform/tool the lead went out on, so the
// Channel column shows where they were contacted or exported (Instantly, HeyReach…).
const CHANNEL_LABELS: Record<string, string> = {
  instantly: "Instantly", heyreach: "HeyReach", lemlist: "Lemlist", smartlead: "Smartlead", emailbison: "EmailBison",
  gmail: "Gmail", smtp: "Email", imap: "Email",
  linkedin: "LinkedIn", apify_linkedin: "LinkedIn", unipile: "LinkedIn",
  slack: "Slack", calendly: "Calendly", cal_com: "Cal.com", calendar: "Meeting",
  // Enrichment is not a channel — never surface it (also excluded server-side).
  prospeo: "", apollo: "",
};
// Map an interaction source to its platform label. Anything not in the known set
// is a custom channel the user named on a CSV export — shown verbatim so it tracks.
function channelLabel(source: string | null): string {
  if (!source) return "";
  const known = CHANNEL_LABELS[source.toLowerCase()];
  return known !== undefined ? known : source;
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `col_${Date.now()}`;

// Split an array into fixed-size batches — used to chunk bulk delete/push so a
// single request never blows past the sequencer cap or the PostgREST URL limit.
const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

function cellValue(lead: Lead, key: string): string {
  if (key === "name") return lead.name ?? "";
  if (key === "email") return lead.email ?? "";
  if (key === "company") return lead.company ?? "";
  if (key === "linkedin_url") return lead.linkedin_url ?? "";
  // Synthetic column: when the lead joined this list (collection added_at). On the
  // engagers list that's when they engaged; elsewhere it's when they were added.
  if (key === "__added") return lead.created_at ? relTime(lead.created_at) : "";
  if (key === "__domain") return lead.domain ?? (typeof lead.fields?.domain === "string" ? lead.fields.domain : "");
  if (key === "__email_status") return lead.email_status ?? "";
  if (key === "__signal") return lead.reply_outcome ?? "";
  if (key === "__channel") return channelLabel(lead.last_channel);
  // ICP score — the lead's fit (0–100), surfaced as a guaranteed column. Prefer
  // the ICP fit score (fields.icp_score, set by scoring); fall back to the scorecard.
  if (key === "__icp") {
    const fit = (lead.fields?.icp_score as number | string | null | undefined) ?? lead.scorecard_score;
    return fit == null ? "" : String(fit);
  }
  // Lead source — where this lead came from. A system column, always present.
  if (key === "__source") return lead.source ?? "";
  const v = lead.fields?.[key];
  // Core columns (company/domain/email/linkedin) mirror the lead's top-level field
  // when the custom field wasn't set — e.g. a "company" column should show the
  // lead's real company even if fields.company was never written.
  if (v == null && (key === "company" || key === "domain" || key === "email" || key === "linkedin_url")) {
    const top = (lead as Record<string, unknown>)[key];
    if (top != null && top !== "") return String(top);
  }
  return v == null ? "" : String(v);
}

// Email deliverability shown as a colored pill: deliverable = green, risky =
// amber, unavailable = grey (dead). Unknown values fall back to grey.
const EMAIL_STATUS_TAG: Record<string, { label: string; cls: string }> = {
  VERIFIED:    { label: "Verified",    cls: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400" },
  DELIVERABLE: { label: "Verified",    cls: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400" }, // legacy alias
  RISKY:       { label: "Risky",       cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400" },
  UNAVAILABLE: { label: "Unavailable", cls: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400" },
  BOUNCED:     { label: "Bounced",     cls: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400" },
};
// ICP score, color-banded: 85+ green · 70+ yellow · 50+ orange · <50 gray.
function icpTag(val: string | number | null | undefined) {
  const n = val == null || val === "" ? null : Number(val);
  if (n == null || Number.isNaN(n)) return <span className="text-muted-foreground/40">—</span>;
  const col = n >= 85 ? "#15803d" : n >= 70 ? "#ca8a04" : n >= 50 ? "#ea580c" : "#6b7280";
  return <span className="text-[12px] font-semibold tabular-nums" style={{ color: col }}>{n}</span>;
}
function emailStatusTag(status: string | null) {
  if (!status) return <span className="text-muted-foreground/40">—</span>;
  const t = EMAIL_STATUS_TAG[status.toUpperCase()] ?? { label: status, cls: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" };
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${t.cls}`}>{t.label}</span>;
}

// Lifecycle status / reply outcome as a colored pill: positive = green,
// in-flight = blue, neutral = grey, negative = amber/red.
const STATUS_TAG: Record<string, string> = {
  interested:  "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400",
  replied:     "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400",
  sent:        "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
  messaged:    "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
  connected:   "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-400",
  pending:     "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  objection:   "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
  wrong_fit:   "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  bounced:     "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
  unsubscribe: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
};
function statusTag(lead: Lead) {
  // Lifecycle only (pending/sent/replied/bounced). The reply disposition lives in
  // its own Signal column now — keep the two axes distinct.
  const v = (lead.status || "").toString();
  if (!v) return <span className="text-muted-foreground/40">—</span>;
  const cls = STATUS_TAG[v] ?? "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium capitalize ${cls}`}>{v.replace(/_/g, " ")}</span>;
}

// Reply disposition (the canonical reply signal) as its own colored pill —
// distinct from STATUS (lifecycle) and EMAIL STATUS (deliverability). Covers the
// canonical taxonomy plus the legacy reply_outcome / sentiment vocabularies.
const SIGNAL_TAG: Record<string, string> = {
  positive:       "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400",
  interested:     "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400",
  objection:      "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
  neutral:        "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  auto_reply:     "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  negative:       "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
  wrong_fit:      "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  unsubscribe:    "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
  do_not_contact: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
  bounce:         "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
};
function signalTag(lead: Lead) {
  const v = (lead.reply_outcome || "").toString();
  if (!v) return <span className="text-muted-foreground/40">—</span>;
  const cls = SIGNAL_TAG[v] ?? "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium capitalize ${cls}`}>{v.replace(/_/g, " ")}</span>;
}

// Guess a mapping for each CSV header: a fixed column, an existing custom
// column, or — for anything unrecognised — a new column.
function autoMap(headers: string[], customCols: LeadColumn[]): Record<string, string> {
  const map: Record<string, string> = {};
  const usedFixed = new Set<string>();
  for (const h of headers) {
    const lh = h.trim().toLowerCase();
    const fixed = Object.entries(FIXED_ALIASES).find(
      ([key, aliases]) => !usedFixed.has(key) && aliases.includes(lh),
    );
    if (fixed) { map[h] = fixed[0]; usedFixed.add(fixed[0]); continue; }
    const custom = customCols.find(c => c.label.toLowerCase() === lh || c.key === slugify(lh));
    map[h] = custom ? custom.key : NEW_COL;
  }
  return map;
}

// Reload-instant cache. The in-memory ref cache is wiped on every page reload,
// so a refresh always paid two sequential round-trips (lists → then leads)
// before anything painted. These mirror the last-viewed lists + leads pages to
// sessionStorage, scoped per workspace, so a reload repaints the previous view
// immediately and only revalidates in the background.
const SS_LISTS = (ws: string) => `lists.lists.${ws}`;
const SS_LEADS = (ws: string) => `lists.leadsCache.${ws}`;
const LEADS_CACHE_CAP = 12; // most-recent (list+page+filter) pages kept on disk

function ssGet<T>(key: string): T | null {
  try { const v = sessionStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; }
  catch { return null; }
}
function ssSet(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* quota or disabled */ }
}

export default function Lists() {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";
  const navigate = useNavigate();
  // Single-click a lead name opens its full record (the tabbed detail at
  // /people/:id). The 200ms gate lets a double-click still rename inline.
  const nameClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // The active list now lives in the path — /lists/:listId, each list its own
  // page. (Named routeListId so it doesn't shadow the local listId in addBlankRow.)
  const { listId: routeListId } = useParams<{ listId?: string }>();
  // List + page restored from the URL on first load (so a refresh stays put,
  // instead of bouncing back to the first/native list). The legacy ?list= query
  // is still honored for old bookmarks.
  const initialListRef = useRef(routeListId ?? searchParams.get("list"));
  const firstActiveRef = useRef(true);
  // Per-(list+page+filters) leads cache — stale-while-revalidate so switching
  // back to a list or page shows instantly and only re-fetches in the background.
  const leadsCache = useRef<Map<string, { leads: Lead[]; counts: { icp: number; non_icp: number } | null }>>(new Map());

  const jsonHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const authHeaders = { Authorization: `Bearer ${token}` };

  const [lists, setLists] = useState<LeadList[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [gated, setGated] = useState(false);
  const [busy, setBusy] = useState(false);

  // Inline cell editing — double-click a cell to edit it in place.
  const [editCell, setEditCell] = useState<{ id: string; key: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  // New rows are appended optimistically with a temp id; these resolve the real id
  // once the background create returns, so adding + editing feel instant.
  const blankSeq = useRef(0);
  const blankCreates = useRef<Map<string, Promise<string | null>>>(new Map());
  const [addingCol, setAddingCol] = useState(false);
  const [newColLabel, setNewColLabel] = useState("");

  // Manage panel for the auto-managed "LinkedIn Engagers" list.
  type EngagementInfo = {
    available: boolean;
    reason: string | null;
    enabled: boolean;
    reads_from: string | null;
    schedule: string;
    window: { posts: number; days: number };
    self_host: boolean;
    last_run: { summary: string; at: string; metadata?: unknown } | null;
  };
  const [engageOpen, setEngageOpen] = useState(false);
  const [engageInfo, setEngageInfo] = useState<EngagementInfo | null>(null);
  const [engageBusy, setEngageBusy] = useState(false);

  // Mapped CSV import
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [importStep, setImportStep] = useState<"upload" | "mapping">("upload");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  // Lead source for this import — stamped on every row so the agent can always
  // read where a lead came from (campaign A vs B reporting). Defaults to the
  // list's own source; the user can override it per import.
  const [importSource, setImportSource] = useState("");
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null);
  // ICP segmentation filter — sales-nav-builder tags each lead fields.icp true/false.
  // Persisted (localStorage) so the choice survives navigation + reloads until changed.
  const [icpFilter, setIcpFilter] = useState<"all" | "icp" | "non">(() => {
    try { return (localStorage.getItem("nous.lists.icpFilter") as "all" | "icp" | "non") || "all"; }
    catch { return "all"; }
  });
  // Outbound filters — by lifecycle status and reply outcome.
  const [statusFilter, setStatusFilter] = useState("");
  const [replyFilter, setReplyFilter] = useState("");
  // Filter builder — extra "Where <column> is <value>" filters (size/email/channel/domain).
  const [fbFilters, setFbFilters] = useState<{ field: string; value: string }[]>([]);
  const [fbOpen, setFbOpen] = useState(false);
  const [fbField, setFbField] = useState(FB_FIELDS[0].key);
  const [fbValue, setFbValue] = useState("");
  // Export menu + export-to-sequencer (push selected leads into a campaign).
  const [exportOpen, setExportOpen] = useState(false);
  // Which set the open export menu/modals act on: the whole (filtered) list, or
  // just the ticked rows. Set when an Export button is clicked.
  const [exportScope, setExportScope] = useState<"all" | "selected">("all");
  // CSV export — names the channel/tool so even a plain download is tracked.
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvName, setCsvName] = useState("");
  const [csvBusy, setCsvBusy] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [pushProvider, setPushProvider] = useState("instantly");
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [campaignsConn, setCampaignsConn] = useState<boolean | null>(null);
  const [pushCampaign, setPushCampaign] = useState("");
  const [pushing, setPushing] = useState(false);
  // Selected lead ids — the manual delete control after ICP scoring.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // "Select all N matching" — the selection spans every record matching the
  // current filters, not just the loaded page. Resolved to concrete ids/rows at
  // action time (via fetchAllMatching), so it survives paging.
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  // Server-side pagination — the leads view is expensive per row, so we never
  // load more than one page (50) at a time. Initial page comes from the URL.
  const [page, setPage] = useState(() => {
    const p = parseInt(searchParams.get("page") || "1", 10);
    return Number.isFinite(p) && p > 1 ? p - 1 : 0;
  });
  // Sort + ICP counts (server-side). Sort is persisted (localStorage) so an ICP
  // sort sticks across navigation + reloads until the user changes it.
  const [sort, setSort] = useState<"recent" | "icp_score_desc" | "icp_score_asc">(() => {
    try { return (localStorage.getItem("nous.lists.sort") as "recent" | "icp_score_desc" | "icp_score_asc") || "recent"; }
    catch { return "recent"; }
  });
  const [counts, setCounts] = useState<{ icp: number; non_icp: number } | null>(null);
  // Persist sort + ICP filter so they survive navigation and reloads until changed.
  useEffect(() => { try { localStorage.setItem("nous.lists.sort", sort); } catch { /* ignore */ } }, [sort]);
  useEffect(() => { try { localStorage.setItem("nous.lists.icpFilter", icpFilter); } catch { /* ignore */ } }, [icpFilter]);
  // Connect → message → reply funnel counts for the native LinkedIn Connections list.
  const [funnel, setFunnel] = useState<{ connected: number; messaged: number; replied: number } | null>(null);
  const [syncingConn, setSyncingConn] = useState(false);
  // Per-column width overrides (drag-to-resize), keyed by column key, persisted.
  const [colW, setColW] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("lists.colW") || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem("lists.colW", JSON.stringify(colW)); } catch { /* ignore */ }
  }, [colW]);
  // Per-list column order (drag-to-reorder), keyed by list id → ordered column
  // keys. Name stays pinned first; any column not listed keeps its default spot.
  const [colOrder, setColOrder] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem("lists.colOrder") || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem("lists.colOrder", JSON.stringify(colOrder)); } catch { /* ignore */ }
  }, [colOrder]);
  const dragColRef = useRef<string | null>(null);
  const resizeRef = useRef<{ key: string; startX: number; startW: number } | null>(null);
  function startResize(e: React.MouseEvent, key: string, w: number) {
    e.preventDefault();
    resizeRef.current = { key, startX: e.clientX, startW: w };
    const onMove = (ev: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      setColW(prev => ({ ...prev, [r.key]: Math.max(60, r.startW + (ev.clientX - r.startX)) }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      resizeRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  const fileRef = useRef<HTMLInputElement>(null);
  // Guards the lists-changed re-dispatch so the shared event can't loop back into
  // itself when our own listener (below) triggers a reload.
  const suppressListNotify = useRef(false);

  const loadLists = useCallback(async () => {
    if (!workspaceId || !token) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/lead-lists?workspaceId=${workspaceId}`, { headers: authHeaders });
      if (res.status === 402) { setGated(true); setLoading(false); return; }
      const d = res.ok ? await res.json() : {};
      const next: LeadList[] = d.lead_lists ?? [];
      setLists(next);
      ssSet(SS_LISTS(workspaceId), next);
      // Let the sidebar's Lists dropdown refresh (create/delete/import/rename).
      if (!suppressListNotify.current) { try { window.dispatchEvent(new Event("nous:lists-changed")); } catch { /* ignore */ } }
      setActiveId(prev => {
        if (prev && next.some(l => l.id === prev)) return prev;
        const fromUrl = initialListRef.current;
        if (fromUrl && next.some(l => l.id === fromUrl)) return fromUrl;
        return next[0]?.id ?? null;
      });
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [workspaceId, token]);

  useEffect(() => { loadLists(); }, [loadLists]);

  // Sidebar create/rename/delete fires "nous:lists-changed" — mirror it here so the
  // page (active list, name, counts) stays in sync. Suppress our own re-dispatch.
  useEffect(() => {
    const onChanged = () => {
      suppressListNotify.current = true;
      loadLists().finally(() => { suppressListNotify.current = false; });
    };
    window.addEventListener("nous:lists-changed", onChanged);
    return () => window.removeEventListener("nous:lists-changed", onChanged);
  }, [loadLists]);

  // Before the network returns, repaint the last view from sessionStorage: the
  // sidebar lists, the active list, and the leads-page cache. Runs once, in a
  // layout effect (pre-paint) so there's no empty flash on reload.
  const rehydrated = useRef(false);
  useLayoutEffect(() => {
    if (!workspaceId || rehydrated.current) return;
    rehydrated.current = true;
    const savedLeads = ssGet<Record<string, { leads: Lead[]; counts: { icp: number; non_icp: number } | null }>>(SS_LEADS(workspaceId));
    if (savedLeads) for (const [k, v] of Object.entries(savedLeads)) leadsCache.current.set(k, v);
    const savedLists = ssGet<LeadList[]>(SS_LISTS(workspaceId));
    if (savedLists && savedLists.length) {
      setLists(savedLists);
      setLoading(false);
      setActiveId(prev => {
        if (prev && savedLists.some(l => l.id === prev)) return prev;
        const fromUrl = initialListRef.current;
        if (fromUrl && savedLists.some(l => l.id === fromUrl)) return fromUrl;
        return savedLists[0]?.id ?? null;
      });
    }
  }, [workspaceId]);

  // Drop both the in-memory and on-disk leads cache (called on every mutation so
  // a reload never repaints stale rows). Reassigns rather than .clear() so it's
  // unambiguous at the call sites below.
  const clearLeadsCache = useCallback(() => {
    leadsCache.current = new Map();
    try { sessionStorage.removeItem(SS_LEADS(workspaceId)); } catch { /* ignore */ }
  }, [workspaceId]);

  const PAGE_SIZE = 50;
  const loadLeads = useCallback(
    async (listId: string, pg: number, filt: "all" | "icp" | "non", srt: string) => {
      const icpParam = filt === "all" ? "" : `&icp=${filt === "icp" ? "true" : "false"}`;
      const outParam = `${statusFilter ? `&status=${statusFilter}` : ""}${replyFilter ? `&reply=${replyFilter}` : ""}`;
      const fbParam = fbFilters.map(f => `&${f.field}=${encodeURIComponent(f.value)}`).join("");
      const cacheKey = `${listId}|${pg}|${filt}|${srt}|${outParam}|${fbParam}`;
      // Stale-while-revalidate: paint the cached page instantly (no spinner), then
      // refresh in the background. Cold pages show the loading state.
      const cached = leadsCache.current.get(cacheKey);
      if (cached) { setLeads(cached.leads); if (cached.counts) setCounts(cached.counts); setLeadsLoading(false); }
      else setLeadsLoading(true);
      try {
        // Ask for the ICP counts only on the first page.
        const countsParam = pg === 0 ? "&counts=1" : "";
        const res = await fetch(
          `${apiUrl}/api/lead-lists/${listId}/leads?workspaceId=${workspaceId}&limit=${PAGE_SIZE}&offset=${pg * PAGE_SIZE}&sort=${srt}${icpParam}${outParam}${fbParam}${countsParam}`,
          { headers: authHeaders });
        const d = res.ok ? await res.json() : {};
        const nextLeads: Lead[] = d.leads ?? [];
        const nextCounts = d.counts ?? cached?.counts ?? null;
        setLeads(nextLeads);
        if (d.counts) setCounts(d.counts);
        leadsCache.current.set(cacheKey, { leads: nextLeads, counts: nextCounts });
        // Mirror the most-recent pages to disk so a reload repaints instantly.
        const entries = Array.from(leadsCache.current.entries()).slice(-LEADS_CACHE_CAP);
        ssSet(SS_LEADS(workspaceId), Object.fromEntries(entries));
      } catch { if (!cached) setLeads([]); }
      finally { setLeadsLoading(false); }
    }, [workspaceId, token, statusFilter, replyFilter, fbFilters]);

  // The active filter set as a query string (icp + status/reply + filter-builder),
  // shared by the leads view and by full-list fetches so they always agree.
  const buildFilterQS = useCallback(() => {
    const icpParam = icpFilter === "all" ? "" : `&icp=${icpFilter === "icp" ? "true" : "false"}`;
    const outParam = `${statusFilter ? `&status=${statusFilter}` : ""}${replyFilter ? `&reply=${replyFilter}` : ""}`;
    const fbParam = fbFilters.map(f => `&${f.field}=${encodeURIComponent(f.value)}`).join("");
    return `${icpParam}${outParam}${fbParam}`;
  }, [icpFilter, statusFilter, replyFilter, fbFilters]);

  // Backfill the LinkedIn Connections list from the user's existing connections
  // (Unipile relations). One-time/on-demand; the webhooks keep it current after.
  const syncConnections = async () => {
    if (!activeId || syncingConn) return;
    setSyncingConn(true);
    try {
      const res = await fetch(`${apiUrl}/api/linkedin/connections/sync`, {
        method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (res.status === 409) { toast("Connect your LinkedIn account in Integrations first."); return; }
      if (res.status === 503) { toast("LinkedIn isn't configured on this workspace."); return; }
      if (!res.ok) { toast("Couldn't sync connections — try again."); return; }
      const d = await res.json();
      toast.success(`Synced ${Number(d.synced ?? 0).toLocaleString()} connections from LinkedIn.`);
      clearLeadsCache();
      await loadLists();
      await loadLeads(activeId, 0, "all", "recent");
    } catch { toast("Couldn't sync connections — try again."); }
    finally { setSyncingConn(false); }
  };

  // Every lead matching the current filters across all pages — paged in 1000s.
  // Backs "select all matching" and whole-list exports; the variable cost is one
  // fetch at action time, so paging the table never has to load everything.
  const fetchAllMatching = useCallback(async (): Promise<Lead[]> => {
    if (!activeId) return [];
    const qs = buildFilterQS();
    const all: Lead[] = [];
    for (let off = 0; ; off += 1000) {
      const res = await fetch(
        `${apiUrl}/api/lead-lists/${activeId}/leads?workspaceId=${workspaceId}&limit=1000&offset=${off}${qs}`,
        { headers: authHeaders });
      const batch: Lead[] = (res.ok ? await res.json() : {}).leads ?? [];
      all.push(...batch);
      if (batch.length < 1000) break;
    }
    return all;
  }, [activeId, workspaceId, token, buildFilterQS]);

  useEffect(() => {
    if (activeId) loadLeads(activeId, page, icpFilter, sort);
    else setLeads([]);
  }, [activeId, page, icpFilter, sort, statusFilter, replyFilter, loadLeads]);

  // Connect → message → reply funnel counts — fetched only for the native
  // LinkedIn Connections list (its header stat), so it never adds count queries
  // to other lists' page loads.
  useEffect(() => {
    const isConn = lists.find(l => l.id === activeId)?.source === "linkedin_connections";
    if (!activeId || !workspaceId || !isConn) { setFunnel(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/lead-lists/${activeId}/leads?workspaceId=${workspaceId}&limit=1&funnel=1`, { headers: authHeaders });
        const d = res.ok ? await res.json() : {};
        if (!cancelled && d.funnel) setFunnel(d.funnel);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [activeId, workspaceId, lists]);

  // Switching lists resets filters, sort, selection, counts. The page is kept on
  // the very first activeId (restored from the URL); later switches reset it.
  useEffect(() => {
    if (!activeId) return;
    setIcpFilter("all"); setStatusFilter(""); setReplyFilter(""); setFbFilters([]); setSort("recent"); setSelected(new Set()); setSelectAllMatching(false); setCounts(null);
    setEditCell(null); resetImport();
    if (firstActiveRef.current) firstActiveRef.current = false;
    else setPage(0);
  }, [activeId]);
  // Changing any filter or sort goes back to page 1 and clears the selection
  // (the matching set changed, so "all matching" no longer means the same thing).
  useEffect(() => { setPage(0); setSelected(new Set()); setSelectAllMatching(false); }, [icpFilter, sort, statusFilter, replyFilter, fbFilters]);

  // Route param → active list. /lists/:listId selects that list; the bare /lists
  // index (or a stale/unknown id, e.g. after deleting the active list) falls back
  // to the first list so a list is always selected.
  useEffect(() => {
    if (loading) return;
    if (routeListId && lists.some(l => l.id === routeListId)) {
      if (routeListId !== activeId) setActiveId(routeListId);
      return;
    }
    if (lists.length && (!activeId || !lists.some(l => l.id === activeId))) {
      setActiveId(lists[0].id);
    }
  }, [routeListId, lists, loading, activeId]);

  // Active list → URL. When the URL ALREADY points at a real list, that list is the
  // source of truth — never navigate away from it (the route→activeId effect above
  // syncs activeId to it). Navigating on a transient activeId≠routeListId mismatch
  // is what caused the two effects to fight and the list to flip back and forth.
  // We only push the path when the URL holds no valid list (default selection on
  // first load, after a delete, or a stale/legacy ?list= id); otherwise just keep
  // ?page in sync so a refresh stays put.
  useEffect(() => {
    if (!activeId) return;
    const routeValid = !!routeListId && lists.some(l => l.id === routeListId);
    if (!routeValid) {
      navigate(page > 0 ? `/lists/${activeId}?page=${page + 1}` : `/lists/${activeId}`, { replace: true });
      return;
    }
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      if (page > 0) p.set("page", String(page + 1)); else p.delete("page");
      return p;
    }, { replace: true });
  }, [activeId, page, routeListId, lists, navigate, setSearchParams]);

  const activeList = lists.find(l => l.id === activeId) ?? null;
  // Always include the default custom columns, even on older lists whose stored
  // `columns` predate them — the default column set is enforced for every list.
  const customCols = (() => {
    // Drop any stored ICP column — the always-present system `__icp` column
    // already shows the fit score (and is the sortable one), so a custom
    // `icp`/`icp_score` column would render a duplicate "ICP" header.
    const stored = (activeList?.columns ?? []).filter(c => c.key !== "icp" && c.key !== "icp_score");
    const have = new Set(stored.map(c => c.key));
    return [...stored, ...DEFAULT_CUSTOM_COLS.filter(d => !have.has(d.key))];
  })();
  // ICP is a default segmentation on every list, so the All / ICP / Non-ICP
  // filter is always shown — never gated on whether the list was scored yet.
  const hasIcp = true;

  // Filter builder — add/replace (one active value per field) and remove.
  const fbFieldDef = FB_FIELDS.find(f => f.key === fbField) ?? FB_FIELDS[0];
  const addFbFilter = () => {
    const value = fbValue.trim();
    if (!value) return;
    setFbFilters(prev => [...prev.filter(f => f.field !== fbField), { field: fbField, value }]);
    setFbValue(""); setFbOpen(false);
  };
  const removeFbFilter = (field: string) => setFbFilters(prev => prev.filter(f => f.field !== field));
  const pushApp = SEQUENCER_APPS.find(a => a.id === pushProvider) ?? SEQUENCER_APPS[0];

  // Total records matching the current filters, when it's known from data already
  // in hand (no extra request). Null when status/reply/filter-builder filters are
  // active — the exact figure is then resolved at action time. Drives the
  // "Select all N matching" affordance and the scoped export counts.
  const matchingTotal: number | null =
    statusFilter || replyFilter || fbFilters.length
      ? null
      : icpFilter === "icp"
        ? counts?.icp ?? null
        : icpFilter === "non"
          ? counts?.non_icp ?? null
          : hasIcp && counts
            ? counts.icp + counts.non_icp
            : activeList?.lead_count ?? null;

  // Row selection. `selectAllMatching` means "every record matching the filters",
  // so a row reads as checked regardless of the per-page `selected` set.
  const allVisibleSelected = selectAllMatching || (leads.length > 0 && leads.every(l => selected.has(l.id)));
  const isRowSelected = (id: string) => selectAllMatching || selected.has(id);
  const clearSelection = () => { setSelected(new Set()); setSelectAllMatching(false); };
  const toggleOne = (id: string) => {
    if (selectAllMatching) {
      // Stepping out of "all matching" into an explicit, page-local selection.
      const n = new Set(leads.map(l => l.id));
      n.delete(id);
      setSelectAllMatching(false);
      setSelected(n);
      return;
    }
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleAllVisible = () => {
    if (selectAllMatching) { clearSelection(); return; }
    setSelected(prev => {
      const n = new Set(prev);
      if (leads.every(l => prev.has(l.id))) leads.forEach(l => n.delete(l.id));
      else leads.forEach(l => n.add(l.id));
      return n;
    });
  };
  // How many leads the open export menu/modals will act on. Null = "matching"
  // (count resolved at action time when extra filters hide the exact figure).
  const exportCount: number | null =
    exportScope === "all" || selectAllMatching ? matchingTotal : selected.size;
  // Human phrase for the export scope, shown in the CSV / campaign modals.
  const exportNoun: string =
    exportScope === "all"
      ? exportCount != null ? `${exportCount.toLocaleString()} lead${exportCount === 1 ? "" : "s"}` : "every matching lead"
      : selectAllMatching
        ? exportCount != null ? `all ${exportCount.toLocaleString()} matching lead${exportCount === 1 ? "" : "s"}` : "all matching leads"
        : `${selected.size} selected lead${selected.size === 1 ? "" : "s"}`;
  // The lead ids a selection-bar action targets: the explicit ticks, or — when
  // "all matching" is on — every record matching the current filters (resolved
  // across all pages).
  const resolveSelectedIds = async (): Promise<string[]> =>
    selectAllMatching ? (await fetchAllMatching()).map(l => l.id) : [...selected];

  async function deleteSelected() {
    if (!activeId || (selected.size === 0 && !selectAllMatching)) return;
    setBusy(true);
    try {
      const ids = await resolveSelectedIds();
      const idSet = new Set(ids);
      // Optimistic — drop the rows from the table NOW so they don't sit there
      // "spinning" while the deletes run, and so a stale reload can't make them
      // reappear. The reload below reconciles if a server delete actually failed.
      setLeads(prev => prev.filter(l => !idSet.has(l.id)));
      setLists(prev => prev.map(l => l.id === activeId ? { ...l, lead_count: Math.max(0, (l.lead_count ?? 0) - ids.length) } : l));
      clearSelection();
      clearLeadsCache();
      // Chunk so a single DELETE never exceeds the PostgREST IN-list URL limit.
      for (const batch of chunk(ids, 500)) {
        await fetch(`${apiUrl}/api/lead-lists/${activeId}/leads`, {
          method: "DELETE",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, ids: batch }),
        });
      }
      await loadLeads(activeId, page, icpFilter, sort);
      await loadLists();
    } catch { /* silent */ }
    finally { setBusy(false); }
  }

  // Find emails for the selected leads via the workspace's Prospeo/Apollo key.
  async function enrichSelected() {
    if (!activeId || (selected.size === 0 && !selectAllMatching)) return;
    setBusy(true);
    try {
      const ids = await resolveSelectedIds();
      const res = await fetch(`${apiUrl}/api/lead-lists/${activeId}/enrich`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, ids }),
      });
      if (res.ok) {
        const d = await res.json();
        setOpResult(buildResult("enrich", d));
      } else if (res.status === 402) {
        toast("Enrichment allowance exhausted — connect Prospeo/Apollo in Integrations or upgrade.");
      } else {
        toast("Couldn't enrich — try again.");
      }
      clearSelection();
      clearLeadsCache();
      await loadLeads(activeId, page, icpFilter, sort);
    } catch { toast("Couldn't enrich — try again."); }
    finally { setBusy(false); }
  }

  async function verifySelected(provider?: string) {
    if (!activeId || (selected.size === 0 && !selectAllMatching)) return;
    setBusy(true);
    try {
      const ids = await resolveSelectedIds();
      const res = await fetch(`${apiUrl}/api/lead-lists/${activeId}/verify`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, ids, provider }),
      });
      if (res.ok) {
        const d = await res.json();
        setOpResult(buildResult("verify", d));
      } else if (res.status === 409) {
        toast("Connect MillionVerifier or NeverBounce in Integrations to verify emails.");
      } else if (res.status === 402) {
        toast("Verification allowance exhausted — connect a verifier in Integrations or upgrade.");
      } else {
        toast("Couldn't verify — try again.");
      }
      clearSelection();
      clearLeadsCache();
      await loadLeads(activeId, page, icpFilter, sort);
    } catch { toast("Couldn't verify — try again."); }
    finally { setBusy(false); }
  }

  // ── Pre-flight confirmation for enrich/verify ────────────────────────────────
  // Both run a free dry-run preview first so the modal can show an exact cost
  // breakdown (chargeable / reused-free / skipped) before any credit is spent.
  type OpPreview = {
    total: number; chargeable: number; reused: number;
    no_identifier?: number; no_email?: number; connected_verifiers?: string[];
  };
  const [confirmOp, setConfirmOp] = useState<null | "enrich" | "verify">(null);
  const [opPreview, setOpPreview] = useState<OpPreview | null>(null);
  const [opLoading, setOpLoading] = useState(false);
  const [verifyProvider, setVerifyProvider] = useState("");
  // Selections above this run async as a background job (worker drains with
  // live progress); at/under it they run inline in the request.
  const SYNC_MAX = 200;
  type BulkJob = { id: string; kind: string; status: string; total: number; processed: number; provider?: string; result?: any };
  const [bulkJob, setBulkJob] = useState<BulkJob | null>(null);
  const jobActive = !!bulkJob && (bulkJob.status === "pending" || bulkJob.status === "running");

  // Completion summary popup (shown after a sync run OR an async job finishes).
  type ResultRow = { label: string; n: number; tone: "green" | "amber" | "red" | "muted" };
  type OpResult = { kind: "enrich" | "verify"; rows: ResultRow[]; headline: number };
  const [opResult, setOpResult] = useState<OpResult | null>(null);

  // Normalize a sync response OR an async job.result into the summary rows.
  // Sync verify keys: deliverable/risky/undeliverable/skipped_already_verified/skipped_no_email.
  // Async verify keys: deliverable/risky/undeliverable/reused/no_email. (enrich analogous.)
  function buildResult(kind: "enrich" | "verify", r: any): OpResult {
    if (kind === "verify") {
      const verified = r.deliverable || 0, risky = r.risky || 0, unavailable = r.undeliverable || 0;
      const reused = r.skipped_already_verified ?? r.reused ?? 0;
      const noEmail = r.skipped_no_email ?? r.no_email ?? 0;
      return {
        kind, headline: verified + risky + unavailable,
        rows: [
          { label: "Verified", n: verified, tone: "green" },
          { label: "Risky", n: risky, tone: "amber" },
          { label: "Unavailable", n: unavailable, tone: "red" },
          ...(reused ? [{ label: "Recently verified — free", n: reused, tone: "muted" as const }] : []),
          ...(noEmail ? [{ label: "No email — skipped", n: noEmail, tone: "muted" as const }] : []),
        ],
      };
    }
    const enriched = r.enriched || 0;
    const reused = r.skipped_already_verified ?? r.reused ?? 0;
    const noId = r.skipped_no_identifier ?? r.no_identifier ?? 0;
    return {
      kind, headline: enriched,
      rows: [
        { label: "Emails found", n: enriched, tone: "green" },
        ...(reused ? [{ label: "Enriched recently — free", n: reused, tone: "muted" as const }] : []),
        ...(noId ? [{ label: "No email or LinkedIn — skipped", n: noId, tone: "muted" as const }] : []),
      ],
    };
  }

  // The true selection size.
  const hasSelection = selected.size > 0 || selectAllMatching;
  const selCount: number = selectAllMatching ? (matchingTotal ?? 0) : selected.size;

  async function openConfirm(op: "enrich" | "verify") {
    if (!activeId || (selected.size === 0 && !selectAllMatching)) return;
    setConfirmOp(op); setOpPreview(null); setVerifyProvider(""); setOpLoading(true);
    try {
      const ids = await resolveSelectedIds();
      const res = await fetch(`${apiUrl}/api/lead-lists/${activeId}/${op}`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, ids, preview: true }),
      });
      if (res.status === 409) { // verify only — no verifier connected
        setConfirmOp(null);
        toast("Connect MillionVerifier or NeverBounce in Integrations to verify emails.");
        return;
      }
      if (!res.ok) { setConfirmOp(null); toast("Couldn't prepare — try again."); return; }
      const d: OpPreview = await res.json();
      setOpPreview(d);
      if (op === "verify") setVerifyProvider(d.connected_verifiers?.[0] || "");
    } catch { setConfirmOp(null); toast("Couldn't prepare — try again."); }
    finally { setOpLoading(false); }
  }

  async function runConfirmed() {
    const op = confirmOp;
    setConfirmOp(null);
    if (!op) return;
    // Large selections → async background job; small → inline run.
    if (selCount > SYNC_MAX) { await startBulkJob(op); return; }
    if (op === "enrich") await enrichSelected();
    else await verifySelected(verifyProvider || undefined);
  }

  // Kick off an async bulk job and start tracking its progress.
  async function startBulkJob(op: "enrich" | "verify") {
    if (!activeId) return;
    try {
      const ids = await resolveSelectedIds();
      const body: Record<string, unknown> = { workspaceId, ids, background: true };
      if (op === "verify") body.provider = verifyProvider || undefined;
      const res = await fetch(`${apiUrl}/api/lead-lists/${activeId}/${op}`, {
        method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (res.status === 409) { toast("Connect MillionVerifier or NeverBounce in Integrations to verify emails."); return; }
      if (!res.ok) { toast("Couldn't start — try again."); return; }
      const d = await res.json();
      clearSelection();
      setBulkJob({ id: d.job_id, kind: op, status: "pending", total: d.total, processed: 0, provider: d.provider });
      toast.success(`${op === "enrich" ? "Enriching" : "Verifying"} ${Number(d.total).toLocaleString()} in the background…`);
    } catch { toast("Couldn't start — try again."); }
  }

  // Poll the active bulk job until it finishes; refresh rows + toast on completion.
  useEffect(() => {
    if (!activeId || !jobActive || !bulkJob) return;
    const jobId = bulkJob.id;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`${apiUrl}/api/lead-lists/${activeId}/jobs/${jobId}?workspaceId=${workspaceId}`, { headers: authHeaders });
        if (!res.ok) return;
        const { job } = await res.json();
        if (!job) return;
        setBulkJob(job);
        if (job.status === "complete" || job.status === "failed") {
          clearInterval(t);
          clearLeadsCache();
          await loadLeads(activeId, page, icpFilter, sort);
          if (job.status === "complete") {
            setOpResult(buildResult(job.kind as "enrich" | "verify", job.result || {}));
          } else {
            toast(job.error === "no_verifier_connected" ? "No verifier connected — add one in Integrations." : "Bulk job failed — try again.");
          }
          setTimeout(() => setBulkJob(null), 4000);
        }
      } catch { /* transient */ }
    }, 2500);
    return () => clearInterval(t);
  }, [activeId, workspaceId, jobActive, bulkJob?.id]);

  // On list switch, resume any in-flight bulk job's progress bar.
  useEffect(() => {
    if (!activeId || !workspaceId) return;
    let cancelled = false;
    fetch(`${apiUrl}/api/lead-lists/${activeId}/jobs/active?workspaceId=${workspaceId}`, { headers: authHeaders })
      .then(r => (r.ok ? r.json() : { job: null }))
      .then(({ job }) => { if (!cancelled) setBulkJob(job || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeId, workspaceId]);

  // Load the connected sequencer's campaigns when the export modal opens.
  useEffect(() => {
    if (!pushOpen || !workspaceId) return;
    setCampaigns([]); setCampaignsConn(null); setPushCampaign("");
    fetch(`${apiUrl}/api/lead-lists/sequencer/campaigns?workspaceId=${workspaceId}&provider=${pushProvider}`, { headers: authHeaders })
      .then(r => r.ok ? r.json() : { connected: false, campaigns: [] })
      .then(d => { setCampaignsConn(!!d.connected); setCampaigns(d.campaigns || []); })
      .catch(() => setCampaignsConn(false));
  }, [pushOpen, pushProvider, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pushToCampaign() {
    if (!activeId || !pushCampaign) return;
    setPushing(true);
    try {
      // The whole filtered list, or just the ticked rows — depending on which
      // Export button opened the menu (and whether "all matching" is on).
      const ids = exportScope === "all"
        ? (await fetchAllMatching()).map(l => l.id)
        : await resolveSelectedIds();
      if (ids.length === 0) { toast("No leads to push."); setPushing(false); return; }
      const camp = campaigns.find(c => c.id === pushCampaign);
      const app = SEQUENCER_APPS.find(a => a.id === pushProvider);
      // Push in batches of MAX_PUSH (server cap) so a large selection all lands.
      let pushed = 0, skipped = 0, notConnected = false, failed = false;
      for (const batch of chunk(ids, 1000)) {
        const res = await fetch(`${apiUrl}/api/lead-lists/${activeId}/push`, {
          method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, provider: pushProvider, campaignId: pushCampaign, campaignName: camp?.name, ids: batch }),
        });
        if (res.ok) { const d = await res.json(); pushed += d.pushed ?? 0; skipped += d.skipped ?? 0; }
        else if (res.status === 409) { notConnected = true; break; }
        else { failed = true; break; }
      }
      if (notConnected) {
        toast(`${app?.label || "That sequencer"} isn't connected — add it in Integrations first.`);
      } else if (failed && pushed === 0) {
        toast("Push failed — try again.");
      } else {
        const missing = app?.kind === "linkedin" ? "no LinkedIn URL" : "no email";
        toast.success(`Pushed ${pushed} to ${app?.label || "campaign"} · ${camp?.name || "campaign"}${skipped ? ` · ${skipped} skipped (${missing})` : ""}`);
        setPushOpen(false); clearSelection();
        clearLeadsCache();
        await loadLeads(activeId, page, icpFilter, sort);
      }
    } catch { toast("Push failed — try again."); }
    finally { setPushing(false); }
  }

  const baseCols = [
    ...FIXED_COLS,
    { key: "__domain", label: "Domain", w: 120 },
    { key: "__icp", label: "ICP", w: 64 },
    ...customCols.map(c => ({ key: c.key, label: c.label, w: CUSTOM_W })),
    { key: "__source", label: "Source", w: 130 },
    { key: "__email_status", label: "Email status", w: 100 },
    { key: "__signal", label: "Signal", w: 110 },
    { key: "__channel", label: "Channel", w: 84 },
    { key: "__added", label: activeList?.source === "linkedin_engagement" ? "Engaged" : activeList?.source === "linkedin_connections" ? "Connected" : "Added", w: 96 },
  ];
  // Apply the saved per-list column order. Name (the frozen first column) is
  // always pinned leftmost; movable columns sort by the saved order, and any
  // column missing from it (e.g. a newly added one) keeps its default position.
  const savedOrder = (activeId && colOrder[activeId]) || [];
  const orderRank = new Map(savedOrder.map((k, i) => [k, i]));
  const movable = baseCols.filter(c => c.key !== "name");
  const defaultIdx = new Map(movable.map((c, i) => [c.key, i]));
  const rank = (k: string) => (orderRank.has(k) ? orderRank.get(k)! : 1000 + (defaultIdx.get(k) ?? 0));
  const allCols = [
    ...baseCols.filter(c => c.key === "name"),
    ...[...movable].sort((a, b) => rank(a.key) - rank(b.key)),
  ].map(c => ({ ...c, w: Math.max(60, colW[c.key] ?? c.w) }));

  // Drop column `dragged` at the position of column `target` (both movable, i.e.
  // not the pinned Name), persisting the new order for the active list.
  const moveColumn = (dragged: string, target: string) => {
    if (!activeId || dragged === target || dragged === "name" || target === "name") return;
    const keys = allCols.map(c => c.key).filter(k => k !== "name");
    const from = keys.indexOf(dragged);
    const to = keys.indexOf(target);
    if (from < 0 || to < 0) return;
    keys.splice(from, 1);
    keys.splice(to, 0, dragged);
    setColOrder(prev => ({ ...prev, [activeId]: keys }));
  };

  const resetImport = () => {
    setImporting(false); setImportStep("upload");
    setCsvHeaders([]); setCsvRows([]); setMapping({}); setResult(null); setImportSource("");
  };

  // Open the LinkedIn Engagers manage panel and (re)load its status.
  const openEngagement = async () => {
    setEngageOpen(true);
    setEngageInfo(null);
    try {
      const res = await fetch(`${apiUrl}/api/linkedin/engagement?workspaceId=${workspaceId}`, { headers: authHeaders });
      if (res.ok) setEngageInfo(await res.json());
    } catch { /* leave null — panel shows a loading/empty state */ }
  };

  // Flip the weekly scrape on/off.
  const toggleEngagement = async (next: boolean) => {
    if (engageBusy) return;
    setEngageBusy(true);
    setEngageInfo(prev => (prev ? { ...prev, enabled: next } : prev)); // optimistic
    try {
      const res = await fetch(`${apiUrl}/api/linkedin/engagement`, {
        method: "PATCH", headers: jsonHeaders,
        body: JSON.stringify({ workspaceId, enabled: next }),
      });
      if (!res.ok) throw new Error("toggle failed");
    } catch {
      setEngageInfo(prev => (prev ? { ...prev, enabled: !next } : prev)); // revert
      toast("Couldn't update — try again.");
    } finally { setEngageBusy(false); }
  };
  // Export to CSV — the whole filtered list, or just the ticked rows, depending
  // on which Export button opened the menu. Then tag every exported lead with the
  // named channel/tool so the export is tracked like a native push.
  const exportCsvNamed = async () => {
    const channel = csvName.trim();
    if (!activeList || csvBusy || !channel) return;
    setCsvBusy(true);
    try {
      const all = await fetchAllMatching();
      const rows = exportScope === "all" || selectAllMatching
        ? all
        : all.filter(l => selected.has(l.id));
      if (rows.length === 0) { toast("No leads to export."); setCsvBusy(false); return; }
      // Export follows the on-screen column order (minus the Added timestamp).
      const exportCols = allCols.filter(c => c.key !== "__added");
      const keys = exportCols.map(c => c.key);
      const labels = exportCols.map(c => c.label);
      const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csv = [[...labels, "Channel"].map(esc).join(","),
        ...rows.map(l => [...keys.map(k => cellValue(l, k)), channel].map(esc).join(","))].join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${activeList.name.replace(/[^a-z0-9]+/gi, "_")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      // Tag only the exported leads with the channel so the Channel column tracks it.
      const ids = rows.map(l => l.id);
      for (const batch of chunk(ids, 5000)) {
        await fetch(`${apiUrl}/api/lead-lists/${activeList.id}/tag-channel`, {
          method: "POST", headers: jsonHeaders,
          body: JSON.stringify({ workspaceId, channel, ids: batch }),
        }).catch(() => {});
      }
      clearLeadsCache();
      toast.success(`Exported ${rows.length} lead${rows.length === 1 ? "" : "s"} · tagged channel “${channel}”`);
      setCsvOpen(false); setCsvName("");
      if (exportScope === "selected") clearSelection();
      if (activeId) await loadLeads(activeId, page, icpFilter, sort);
    } catch { toast("Export failed — try again."); }
    finally { setCsvBusy(false); }
  };

  const addColumn = async () => {
    const label = newColLabel.trim();
    if (!label || !activeList || busy) return;
    const key = slugify(label);
    setNewColLabel(""); setAddingCol(false);
    // No-op on a duplicate key (e.g. re-adding a default column's name).
    if (customCols.some(c => c.key === key)) return;
    const columns = [...customCols, { key, label }];
    const listId = activeList.id;
    setBusy(true);
    // Optimistic — show the new column immediately by updating the active list's
    // stored columns; customCols/allCols recompute from it on the next render.
    setLists(prev => prev.map(l => l.id === listId ? { ...l, columns } : l));
    try {
      await fetch(`${apiUrl}/api/lead-lists/${listId}`, {
        method: "PATCH", headers: jsonHeaders,
        body: JSON.stringify({ workspaceId, columns }),
      });
      await loadLists();
    } catch { /* keep the optimistic column */ }
    finally { setBusy(false); }
  };

  // Airtable-style "+ add row" — drops a blank row at the bottom INSTANTLY (temp
  // id, optimistic) with the cursor in its Name cell, and creates it server-side
  // in the background. The real id is swapped in when the create returns.
  const addBlankRow = () => {
    if (!activeId) return;
    const listId = activeId;
    const tempId = `temp-${blankSeq.current++}`;
    const blank: Lead = {
      id: tempId, email: null, name: null, company: null, linkedin_url: null,
      status: "pending", reply_outcome: null, domain: null, email_status: null,
      last_channel: null, created_at: new Date().toISOString(), fields: {},
    };
    setLeads(prev => [...prev, blank]);
    setLists(prev => prev.map(l => l.id === listId ? { ...l, lead_count: (l.lead_count ?? 0) + 1 } : l));
    clearLeadsCache();
    setEditValue("");
    setEditCell({ id: tempId, key: "name" });

    const p = fetch(`${apiUrl}/api/lead-lists/${listId}/leads/blank`, {
      method: "POST", headers: jsonHeaders, body: JSON.stringify({ workspaceId }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { id?: string } | null) => {
        const realId = d?.id ?? null;
        if (realId) {
          setLeads(prev => prev.map(l => (l.id === tempId ? { ...l, id: realId } : l)));
          setEditCell(ec => (ec && ec.id === tempId ? { ...ec, id: realId } : ec));
        }
        return realId;
      })
      .catch(() => null);
    blankCreates.current.set(tempId, p);
  };

  // ── Inline cell editing — double-click a cell, Enter/blur saves ──────────────
  // Editable: the fixed name/email/company/linkedin columns, the Domain column,
  // and any custom field. The other synthetic columns (channel/email status/
  // added/icp/source) stay read-only.
  const isEditableCol = (key: string) =>
    key === "name" || key === "email" || key === "company" || key === "linkedin_url" ||
    key === "__domain" || customCols.some(c => c.key === key);

  const startEdit = (lead: Lead, key: string) => {
    if (!isEditableCol(key)) return;
    setEditValue(cellValue(lead, key));
    setEditCell({ id: lead.id, key });
  };

  const saveEdit = async () => {
    if (!editCell || !activeId) return;
    const { key } = editCell;
    let id = editCell.id;
    const value = editValue;
    // The Domain column is the synthetic "__domain" key in the table, but it
    // persists as the lead's `domain` claim — translate it for the API.
    const apiKey = key === "__domain" ? "domain" : key;
    setEditCell(null);
    // Optimistic — patch the row in place so the change shows instantly.
    setLeads(prev => prev.map(l => {
      if (l.id !== id) return l;
      if (key === "__domain") return { ...l, domain: value || null };
      if (key === "name" || key === "email" || key === "company" || key === "linkedin_url") return { ...l, [key]: value };
      return { ...l, fields: { ...l.fields, [key]: value } };
    }));
    clearLeadsCache();
    // A brand-new row may still be creating server-side — wait for its real id.
    if (id.startsWith("temp-")) {
      const real = await (blankCreates.current.get(id) ?? Promise.resolve(null));
      if (!real) return;
      id = real;
    }
    try {
      await fetch(`${apiUrl}/api/lead-lists/${activeId}/leads/${id}`, {
        method: "PATCH", headers: jsonHeaders,
        body: JSON.stringify({ workspaceId, key: apiKey, value }),
      });
    } catch { /* keep the optimistic value */ }
  };

  // ── Mapped CSV import ────────────────────────────────────────────────────────

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "").replace(/^﻿/, "").trim();
        const lines = text.split(/\r?\n/).filter(Boolean);
        if (lines.length < 2) return;
        const headers = parseCSVLine(lines[0]).map(h => h.trim()).filter(Boolean);
        const rows = lines.slice(1).map(line => {
          const vals = parseCSVLine(line);
          const row: Record<string, string> = {};
          headers.forEach((h, i) => { row[h] = (vals[i] ?? "").trim(); });
          return row;
        });
        setCsvHeaders(headers);
        setCsvRows(rows);
        setMapping(autoMap(headers, customCols));
        setImportStep("mapping");
      } catch { /* silent */ }
    };
    reader.readAsText(file);
  };

  const runImport = async () => {
    if (!activeId || !activeList || busy || csvRows.length === 0) return;
    setBusy(true); setResult(null);
    try {
      // 1. New columns — headers mapped to "create a column".
      const seen = new Set(customCols.map(c => c.key));
      const headerKey: Record<string, string> = {};   // header → custom column key
      const newCols: LeadColumn[] = [];
      for (const [header, target] of Object.entries(mapping)) {
        if (target === NEW_COL) {
          const key = slugify(header);
          if (!seen.has(key)) { newCols.push({ key, label: header.trim() }); seen.add(key); }
          headerKey[header] = key;
        } else if (target && target !== SKIP && !FIXED_KEYS.has(target)) {
          headerKey[header] = target;
        }
      }
      if (newCols.length) {
        await fetch(`${apiUrl}/api/lead-lists/${activeList.id}`, {
          method: "PATCH", headers: jsonHeaders,
          body: JSON.stringify({ workspaceId, columns: [...customCols, ...newCols] }),
        });
      }

      // 2. Build lead rows from the mapping.
      const rows = csvRows.map(r => {
        const lead: Record<string, unknown> = { fields: {} as Record<string, string> };
        for (const [header, target] of Object.entries(mapping)) {
          const val = (r[header] ?? "").trim();
          if (!val || !target || target === SKIP) continue;
          if (FIXED_KEYS.has(target)) lead[target] = val;
          else { const k = headerKey[header]; if (k) (lead.fields as Record<string, string>)[k] = val; }
        }
        return lead;
      });

      // 3. Chunked upload — the API skips rows without an email or LinkedIn URL.
      let inserted = 0, skipped = 0;
      for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
        const res = await fetch(`${apiUrl}/api/lead-lists/${activeId}/leads`, {
          method: "POST", headers: jsonHeaders,
          body: JSON.stringify({ workspaceId, leads: rows.slice(i, i + IMPORT_CHUNK), source: importSource.trim() || undefined }),
        });
        if (res.ok) { const d = await res.json(); inserted += d.inserted ?? 0; skipped += d.skipped ?? 0; }
      }
      setResult({ inserted, skipped });
      setImporting(false); setImportStep("upload");
      setCsvHeaders([]); setCsvRows([]); setMapping({});
      clearLeadsCache();
      loadLeads(activeId, page, icpFilter, sort);
      loadLists();
    } catch { /* silent */ }
    finally { setBusy(false); }
  };

  // ── Gated — requires Pro or above (crmSync/leadLists unlock at Pro) ──────────
  if (gated) {
    return (
      <div className="h-full overflow-y-auto bg-background">
        <div className="px-8 py-7">
          <PageHeader title="Lists" />
          <div className="rounded-xl border border-border bg-muted/40 px-6 py-10 text-center">
            <p className="text-[14px] font-semibold text-foreground">Lists is a Pro-plan feature</p>
            <p className="text-[13px] text-muted-foreground mt-1.5 max-w-md mx-auto">
              Storing lead lists as context for the workspace is available on the Pro plan and above.
            </p>
            <button onClick={() => navigate("/usage")}
              className="mt-4 inline-flex items-center h-9 px-4 rounded-lg bg-foreground text-background text-[13px] font-semibold hover:opacity-90 transition-opacity">
              View plans
            </button>
          </div>
        </div>
      </div>
    );
  }

  const rowWidth = allCols.reduce((s, c) => s + c.w, 0) + STATUS_W + SEL_W;
  const mapTargets = [
    ...FIXED_COLS.map(c => ({ value: c.key, label: c.label })),
    ...customCols.map(c => ({ value: c.key, label: c.label })),
  ];

  // The Export dropdown — shared by the top-right (whole filtered list) and the
  // selection-bar (ticked rows) buttons. `exportScope` is set by the opener and
  // read by the push/CSV modals, so the same menu drives both.
  const renderExportMenu = () => (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
      <div className="absolute right-0 top-10 z-50 w-60 rounded-lg border border-border bg-background shadow-xl py-1.5">
        <div className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">Send to campaign</div>
        {SEQUENCER_APPS.map(app => (
          <button key={app.id}
            onClick={() => { setPushProvider(app.id); setPushOpen(true); setExportOpen(false); }}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] text-foreground hover:bg-muted/50 transition-colors">
            <img src={app.logo} alt="" className="h-4 w-4 object-contain rounded-sm" />
            <span className="flex-1 text-left">{app.label}</span>
            <span className="text-[10px] text-muted-foreground/60">{app.kind === "linkedin" ? "LinkedIn" : "Email"}</span>
          </button>
        ))}
        <div className="my-1 border-t border-border/60" />
        <button onClick={() => { setExportOpen(false); setCsvName(""); setCsvOpen(true); }}
          className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] text-foreground hover:bg-muted/50 transition-colors">
          <FileText className="h-4 w-4 text-muted-foreground" /> Export to CSV
        </button>
      </div>
    </>
  );

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="px-8 pt-7 flex-shrink-0">
        <PageHeader
          title={activeList?.name ?? "Lists"}
          actions={
            <>
              <button
                onClick={() => navigate("/lists/clean")}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors"
                title="Pre-flight dedup any list against the workspace's engagement history"
              >
                Clean a list →
              </button>
              {activeList?.source === "linkedin_engagement" && (
                <button onClick={openEngagement} title="Manage this auto-updating list"
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors">
                  <Settings2 className="h-3.5 w-3.5" /> Manage
                </button>
              )}
              {activeList && (
                <div className="relative">
                  <button
                    onClick={() => { const open = exportOpen && exportScope === "all"; setExportScope("all"); setExportOpen(!open); }}
                    disabled={busy}
                    title="Export the whole list (matching your filters)"
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors disabled:opacity-40"
                  >
                    <Download className="h-3.5 w-3.5" /> Export
                    <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                  </button>
                  {exportOpen && exportScope === "all" && renderExportMenu()}
                </div>
              )}
            </>
          }
        />

        {/* List switching, creating, renaming and deleting all live in the sidebar
            Lists dropdown now (hover a list for rename/delete; + to create). */}

        {result && (
          <div className="mb-4 text-[13px] text-green-700 dark:text-green-500">
            Imported {result.inserted} lead{result.inserted === 1 ? "" : "s"}
            {result.skipped ? ` · ${result.skipped} skipped (no email or LinkedIn)` : ""}.
          </div>
        )}

        {/* Filters — ICP segmentation on the left, filter builder + status/reply on the right */}
        {activeList && (
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            {/* LEFT — the connect→message→reply funnel for the Connections list,
                otherwise the ICP segmentation chips. */}
            <div className="flex items-center gap-1.5">
              {activeList?.source === "linkedin_connections" ? (
                <>
                {funnel ? ([
                  { label: "Connected", n: funnel.connected, cls: "text-foreground" },
                  { label: "Messaged",  n: funnel.messaged,  cls: "text-foreground" },
                  { label: "Replied",   n: funnel.replied,   cls: "text-green-700 dark:text-green-500" },
                ]).map((s, i) => (
                  <span key={s.label} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-muted-foreground/40 text-[12px]">→</span>}
                    <span className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium border border-border bg-background ${s.cls}`}>
                      {s.label} <span className="tabular-nums opacity-70">{s.n.toLocaleString()}</span>
                    </span>
                  </span>
                )) : <span className="text-[12px] text-muted-foreground/50">Loading funnel…</span>}
                <button onClick={syncConnections} disabled={syncingConn}
                  title="Pull your existing LinkedIn connections into this list"
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 ml-1 rounded-md text-[12px] font-medium border border-border text-foreground/80 hover:bg-muted/50 transition-colors disabled:opacity-40">
                  <RefreshCw className={`h-3.5 w-3.5 ${syncingConn ? "animate-spin" : ""}`} /> {syncingConn ? "Syncing…" : "Sync from LinkedIn"}
                </button>
                </>
              ) : hasIcp && ([
                ["all", "All", activeList?.lead_count ?? (counts ? counts.icp + counts.non_icp : null)],
                ["icp", "ICP", counts?.icp ?? null],
                ["non", "Non-ICP", counts?.non_icp ?? null],
              ] as const).map(([key, label, n]) => (
                <button
                  key={key}
                  onClick={() => setIcpFilter(key)}
                  className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium border transition-colors ${
                    icpFilter === key
                      ? "bg-foreground text-background border-foreground"
                      : "bg-background text-muted-foreground border-border hover:text-foreground"
                  }`}
                >
                  {label}
                  {n !== null ? <span className="tabular-nums opacity-70">{n}</span> : null}
                </button>
              ))}
            </div>
            {/* RIGHT — active filter chips + filter builder + status/reply */}
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {/* Active filter-builder chips */}
              {fbFilters.map(f => (
                <span key={f.field} className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-md text-[12px] font-medium bg-foreground text-background">
                  {fbLabel(f.field, f.value)}
                  <button onClick={() => removeFbFilter(f.field)} className="rounded p-0.5 hover:bg-background/20" aria-label="Remove filter">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {/* Filter builder */}
            <div className="relative">
              <button
                onClick={() => setFbOpen(o => !o)}
                title="Add a filter"
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium border transition-colors ${
                  fbOpen ? "bg-muted border-border text-foreground" : "bg-background border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <Filter className="h-3.5 w-3.5" /> Filter
              </button>
              {fbOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setFbOpen(false)} />
                  <div className="absolute right-0 top-9 z-30 w-72 rounded-lg border border-border bg-background shadow-xl p-3">
                    <div className="text-[11px] font-medium text-muted-foreground/70 mb-2">Add a filter</div>
                    <div className="flex items-center gap-1.5 text-[12px] mb-2">
                      <span className="text-muted-foreground">Where</span>
                      <select
                        value={fbField}
                        onChange={e => { setFbField(e.target.value); setFbValue(""); }}
                        className="h-8 flex-1 rounded-md border border-border bg-background text-[12px] text-foreground px-2 outline-none focus:border-muted-foreground"
                      >
                        {FB_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>
                      <span className="text-muted-foreground">is</span>
                    </div>
                    {fbFieldDef.type === "text" ? (
                      <input
                        value={fbValue}
                        onChange={e => setFbValue(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") addFbFilter(); }}
                        autoFocus
                        placeholder={`Type a ${fbFieldDef.label.toLowerCase()}…`}
                        className="h-8 w-full rounded-md border border-border bg-background text-[12px] text-foreground px-2 outline-none focus:border-muted-foreground"
                      />
                    ) : (
                      <select
                        value={fbValue}
                        onChange={e => setFbValue(e.target.value)}
                        className="h-8 w-full rounded-md border border-border bg-background text-[12px] text-foreground px-2 outline-none focus:border-muted-foreground"
                      >
                        <option value="">Select a value…</option>
                        {fbFieldDef.values.map(v => <option key={v.v} value={v.v}>{v.l}</option>)}
                      </select>
                    )}
                    <button
                      onClick={addFbFilter}
                      disabled={!fbValue}
                      className="mt-3 w-full h-8 rounded-md bg-foreground text-background text-[12px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-30"
                    >
                      Add filter
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="h-7 rounded-md border border-border bg-background text-[12px] text-foreground px-2 outline-none focus:border-muted-foreground">
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="sent">Sent</option>
                <option value="replied">Replied</option>
                <option value="bounced">Bounced</option>
              </select>
              <select value={replyFilter} onChange={e => setReplyFilter(e.target.value)}
                className="h-7 rounded-md border border-border bg-background text-[12px] text-foreground px-2 outline-none focus:border-muted-foreground">
                <option value="">Any reply</option>
                <option value="interested">Interested</option>
                <option value="objection">Objection</option>
                <option value="wrong_fit">Wrong fit</option>
                <option value="unsubscribe">Unsubscribe / DNC</option>
              </select>
              {(statusFilter || replyFilter) && (
                <button onClick={() => { setStatusFilter(""); setReplyFilter(""); }}
                  className="text-[12px] text-muted-foreground hover:text-foreground">Clear</button>
              )}
              {/* Enrich / Verify live on the filter line — disabled until you
                  select leads, so there's no separate action row. */}
              <div className="h-5 w-px bg-border mx-0.5" />
              <button onClick={() => openConfirm("enrich")} disabled={busy || jobActive || !hasSelection}
                title="Find missing emails for the selected leads (Prospeo / Apollo)"
                className="h-7 px-2.5 rounded-md text-[12px] font-medium border border-border text-foreground/80 hover:bg-muted/50 transition-colors disabled:opacity-40">
                {busy ? "Enriching…" : "Enrich"}
              </button>
              <button onClick={() => openConfirm("verify")} disabled={busy || jobActive || !hasSelection}
                title="Validate email deliverability for the selected leads (MillionVerifier / NeverBounce)"
                className="h-7 px-2.5 rounded-md text-[12px] font-medium border border-border text-foreground/80 hover:bg-muted/50 transition-colors disabled:opacity-40">
                {busy ? "Verifying…" : "Verify"}
              </button>
            </div>
            </div>
          </div>
        )}

        {/* Selection action bar — only when leads are ticked or a bulk job is
            running. Enrich/Verify moved up to the filter line. */}
        {activeList && (hasSelection || (jobActive && bulkJob)) && (
          <div className="flex items-center gap-2 mb-3">
            {hasSelection && (
              <>
                <span className="text-[12px] text-muted-foreground tabular-nums">
                  {selectAllMatching
                    ? matchingTotal != null
                      ? `All ${matchingTotal.toLocaleString()} matching selected`
                      : "All matching records selected"
                    : `${selected.size} selected`}
                </span>
                {/* Expand the page selection to every record matching the filters */}
                {!selectAllMatching && allVisibleSelected &&
                  (matchingTotal == null ? leads.length === PAGE_SIZE || page > 0 : matchingTotal > selected.size) && (
                  <button onClick={() => setSelectAllMatching(true)}
                    className="text-[12px] font-medium text-foreground underline underline-offset-2 hover:opacity-80">
                    Select all {matchingTotal != null ? matchingTotal.toLocaleString() : ""} matching
                  </button>
                )}
              </>
            )}
            <div className="mr-auto" />
            {/* Live progress for an async bulk enrich/verify job */}
            {jobActive && bulkJob && (
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <span className="inline-block w-28 h-1.5 rounded-full bg-muted overflow-hidden">
                  <span className="block h-full bg-foreground transition-all"
                    style={{ width: `${bulkJob.total ? Math.min(100, Math.round((bulkJob.processed / bulkJob.total) * 100)) : 0}%` }} />
                </span>
                <span className="tabular-nums">
                  {bulkJob.kind === "verify" ? "Verifying" : "Enriching"} {bulkJob.processed.toLocaleString()}/{bulkJob.total.toLocaleString()}
                </span>
              </div>
            )}
            {hasSelection && (
              <div className="relative">
                <button
                  onClick={() => { const open = exportOpen && exportScope === "selected"; setExportScope("selected"); setExportOpen(!open); }}
                  disabled={busy}
                  title="Export the selected leads"
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium border border-border text-foreground/80 hover:bg-muted/50 transition-colors disabled:opacity-40">
                  <Download className="h-3.5 w-3.5" /> Export
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
                {exportOpen && exportScope === "selected" && renderExportMenu()}
              </div>
            )}
            {hasSelection && (
              <button onClick={deleteSelected} disabled={busy}
                className="h-7 px-2.5 rounded-md text-[12px] font-medium border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40 transition-colors disabled:opacity-40">
                Delete
              </button>
            )}
            {hasSelection && (
              <button onClick={clearSelection} className="text-[12px] text-muted-foreground hover:text-foreground">Clear</button>
            )}
          </div>
        )}
      </div>

      {/* Table — full-bleed Airtable-style grid that fills to the bottom */}
      {lists.length === 0 && !loading ? (
        <div className="mx-8 rounded-xl border border-border px-6 py-12 text-center">
          <p className="text-[13px] text-muted-foreground">No lists yet — create one to upload leads into.</p>
        </div>
      ) : activeList ? (
        <div className="flex-1 min-h-0 pl-8 flex flex-col">
          <div className="flex-1 min-h-0 border-t border-l border-border overflow-auto">
            <div>
              <div style={{ minWidth: rowWidth + 140 }}>
                {/* Header — sticky to the top while scrolling */}
                <div className="flex bg-muted/50 border-b border-border sticky top-0 z-20">
                  <div className="px-2 py-2.5 flex items-center flex-shrink-0 sticky left-0 z-30 bg-muted/50" style={{ width: SEL_W }}>
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      className="h-3.5 w-3.5 accent-foreground cursor-pointer"
                    />
                  </div>
                  {allCols.map((c, i) => {
                    const sortable = c.key === "icp_score" || c.key === "__icp";
                    return (
                    <div key={c.key}
                      draggable={i !== 0}
                      onDragStart={e => { if (i === 0) return; dragColRef.current = c.key; e.dataTransfer.effectAllowed = "move"; }}
                      onDragOver={e => { if (i !== 0 && dragColRef.current && dragColRef.current !== c.key) e.preventDefault(); }}
                      onDrop={e => { e.preventDefault(); if (dragColRef.current) moveColumn(dragColRef.current, c.key); dragColRef.current = null; }}
                      onDragEnd={() => { dragColRef.current = null; }}
                      title={i !== 0 ? "Drag to reorder" : undefined}
                      className={`relative px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 flex-shrink-0 ${i !== 0 ? "cursor-grab active:cursor-grabbing" : ""} ${i === 0 ? "sticky left-10 z-30 bg-muted/50 border-r border-border" : ""}`} style={{ width: c.w }}>
                      {sortable ? (
                        <button
                          onClick={() => setSort(s => (s === "icp_score_desc" ? "icp_score_asc" : "icp_score_desc"))}
                          title="Sort by ICP score"
                          className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground transition-colors"
                        >
                          {c.label}
                          <span className="text-[10px]">
                            {sort === "icp_score_desc" ? "▼" : sort === "icp_score_asc" ? "▲" : "⇅"}
                          </span>
                        </button>
                      ) : (
                        c.label
                      )}
                      <div
                        draggable={false}
                        onMouseDown={e => startResize(e, c.key, c.w)}
                        title="Drag to resize"
                        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-foreground/20"
                      />
                    </div>
                    );
                  })}
                  <div className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 flex-shrink-0" style={{ width: STATUS_W }}>
                    Status
                  </div>
                  <div className="px-2 py-1.5 flex items-center flex-shrink-0" style={{ width: 140 }}>
                    {addingCol ? (
                      <input
                        value={newColLabel} onChange={e => setNewColLabel(e.target.value)} autoFocus placeholder="Column name"
                        onKeyDown={e => { if (e.key === "Enter") addColumn(); if (e.key === "Escape") { setAddingCol(false); setNewColLabel(""); } }}
                        onBlur={() => { if (newColLabel.trim()) addColumn(); else setAddingCol(false); }}
                        className="h-7 w-full rounded-md border border-border bg-background px-2 text-[12px] outline-none focus:border-muted-foreground"
                      />
                    ) : (
                      <button onClick={() => setAddingCol(true)}
                        className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
                        <Plus className="h-3.5 w-3.5" /> Column
                      </button>
                    )}
                  </div>
                </div>

                {/* Rows */}
                {leadsLoading ? (
                  /* Skeleton rows — keep the exact column geometry so the table
                     never collapses; loading → loaded is a shimmer, not a jump. */
                  <>
                    {Array.from({ length: 12 }).map((_, r) => (
                      <div key={r} className="flex border-b border-border/60">
                        <div className="px-2 py-2.5 flex items-center flex-shrink-0 sticky left-0 z-10 bg-background" style={{ width: SEL_W }}>
                          <div className="h-3.5 w-3.5 rounded-sm bg-muted animate-pulse" />
                        </div>
                        {allCols.map((c, i) => (
                          <div key={c.key}
                            className={`px-3 py-2.5 flex-shrink-0 ${i === 0 ? "sticky left-10 z-10 border-r border-border bg-background" : ""}`}
                            style={{ width: c.w }}>
                            <div className="h-3 rounded bg-muted animate-pulse" style={{ width: `${55 + ((r * 7 + i * 13) % 35)}%` }} />
                          </div>
                        ))}
                        <div className="px-3 py-2.5 flex-shrink-0" style={{ width: STATUS_W }}>
                          <div className="h-3 w-12 rounded bg-muted animate-pulse" />
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <>
                    {leads.map(l => (
                      <div key={l.id} className={`group flex border-b border-border/60 transition-colors ${isRowSelected(l.id) ? "bg-muted/60" : "hover:bg-muted/40"}`}>
                        <div className={`px-2 py-2.5 flex items-center flex-shrink-0 sticky left-0 z-10 ${isRowSelected(l.id) ? "bg-muted/60" : "bg-background group-hover:bg-muted/40"}`} style={{ width: SEL_W }}>
                          <input
                            type="checkbox"
                            aria-label="Select lead"
                            checked={isRowSelected(l.id)}
                            onChange={() => toggleOne(l.id)}
                            className="h-3.5 w-3.5 accent-foreground cursor-pointer"
                          />
                        </div>
                        {allCols.map((c, i) => {
                          const val = cellValue(l, c.key);
                          const isLink = c.key === "linkedin_url" && val;
                          const editable = isEditableCol(c.key);
                          const isEditing = editCell?.id === l.id && editCell?.key === c.key;
                          return (
                          <div key={c.key}
                            onDoubleClick={editable && !isEditing && c.key !== "name" ? () => startEdit(l, c.key) : undefined}
                            title={editable && !isEditing && c.key !== "name" ? "Double-click to edit" : undefined}
                            className={`px-3 py-2.5 text-[13px] truncate flex-shrink-0 ${editable ? "cursor-text" : ""} ${isEditing ? "ring-1 ring-inset ring-foreground/25 bg-background" : ""} ${i === 0 ? `text-foreground font-medium sticky left-10 z-10 border-r border-border ${isRowSelected(l.id) ? "bg-muted/60" : "bg-background group-hover:bg-muted/40"}` : "text-muted-foreground"}`} style={{ width: c.w }}>
                            {isEditing ? (
                              <input
                                autoFocus
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                onBlur={saveEdit}
                                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); saveEdit(); } if (e.key === "Escape") setEditCell(null); }}
                                className="w-full bg-transparent p-0 text-[13px] text-foreground outline-none border-0"
                              />
                            ) : c.key === "__email_status" ? (
                              emailStatusTag(l.email_status)
                            ) : c.key === "__signal" ? (
                              signalTag(l)
                            ) : c.key === "__icp" ? (
                              icpTag(val)
                            ) : c.key === "name" ? (
                              <span
                                onClick={() => { if (nameClickTimer.current) return; nameClickTimer.current = setTimeout(() => { nameClickTimer.current = null; navigate(`/people/${l.id}`, { state: { from: `/lists/${routeListId}` } }); }, 200); }}
                                onDoubleClick={() => { if (nameClickTimer.current) { clearTimeout(nameClickTimer.current); nameClickTimer.current = null; } if (editable) startEdit(l, "name"); }}
                                title="Open record · double-click to rename"
                                className="cursor-pointer hover:underline">
                                {val || <span className="text-muted-foreground/40">—</span>}
                              </span>
                            ) : isLink ? (
                              <a href={val} target="_blank" rel="noopener noreferrer"
                                 onClick={e => e.stopPropagation()}
                                 title="Open LinkedIn profile"
                                 className="inline-flex items-center text-[#0A66C2] hover:opacity-70 transition-opacity">
                                <Linkedin className="h-[18px] w-[18px]" fill="currentColor" stroke="white" strokeWidth={1.5} />
                              </a>
                            ) : (
                              val || <span className="text-muted-foreground/40">—</span>
                            )}
                          </div>
                          );
                        })}
                        <div className="px-3 py-2.5 text-[12px] flex-shrink-0" style={{ width: STATUS_W }}>
                          {statusTag(l)}
                        </div>
                      </div>
                    ))}

                    {/* Add row — instantly drops a blank row, cursor in its Name cell */}
                    {(
                      <button onClick={addBlankRow}
                        className="sticky left-0 flex items-center gap-1.5 px-3 py-2.5 text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
                        <Plus className="h-3.5 w-3.5" /> Add lead
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        ) : null}

        {/* Pagination — the leads view is heavy, so 50 per page, server-side */}
        {activeList && (page > 0 || leads.length === PAGE_SIZE) && (
          <div className="flex items-center gap-3 px-8 py-2.5 border-t border-border flex-shrink-0">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0 || leadsLoading}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-md border border-border bg-background text-[13px] text-foreground/80 hover:bg-muted/50 transition-colors disabled:opacity-30"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Prev
            </button>
            <span className="text-[12px] text-muted-foreground tabular-nums">
              Page {page + 1}
              {leadsLoading ? " · loading…" : ` · ${leads.length} on this page`}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={leads.length < PAGE_SIZE || leadsLoading}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-md border border-border bg-background text-[13px] text-foreground/80 hover:bg-muted/50 transition-colors disabled:opacity-30"
            >
              Next <ArrowLeft className="h-3.5 w-3.5 rotate-180" />
            </button>
          </div>
        )}

      {/* Import CSV modal — drag-and-drop upload, then column mapping */}
      {importing && activeList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !busy && resetImport()}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-lg rounded-xl border border-border bg-background p-5 shadow-xl">
            {importStep === "upload" ? (
              <>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[15px] font-semibold text-foreground">Import a CSV into “{activeList.name}”</span>
                  <button onClick={resetImport} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                </div>
                <p className="text-[12px] text-muted-foreground mb-3">
                  Any CSV — a Clay export, an Apollo download. The next step maps its columns to this list.
                </p>
                <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
                  className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center cursor-pointer transition-colors ${
                    dragOver ? "border-foreground bg-muted/50" : "border-border hover:border-foreground/40 hover:bg-muted/30"
                  }`}
                >
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <div className="text-[13px] font-medium text-foreground">Drop a CSV here, or click to choose</div>
                  <div className="text-[12px] text-muted-foreground">We’ll map its columns in the next step</div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[15px] font-semibold text-foreground">
                    Map columns — {csvRows.length.toLocaleString()} rows
                  </span>
                  <button onClick={resetImport} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                </div>
                <p className="text-[12px] text-muted-foreground mb-3">
                  Match each CSV column to a list column, create a new one, or skip it.
                </p>
                <div className="space-y-1.5 mb-3 max-h-[50vh] overflow-y-auto pr-1">
                  {csvHeaders.map(h => (
                    <div key={h} className="flex items-center gap-3">
                      <span className="text-[13px] text-foreground/80 truncate flex-1" title={h}>{h}</span>
                      <span className="text-[12px] text-muted-foreground/50">→</span>
                      <select
                        value={mapping[h] ?? SKIP}
                        onChange={e => setMapping(m => ({ ...m, [h]: e.target.value }))}
                        className="h-8 w-52 flex-shrink-0 rounded-md border border-border bg-background text-[13px] text-foreground px-2 outline-none focus:border-muted-foreground"
                      >
                        {mapTargets.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        <option value={NEW_COL}>+ New column “{h}”</option>
                        <option value={SKIP}>Skip</option>
                      </select>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[13px] text-foreground/80 flex-shrink-0">Lead source</span>
                  <input
                    value={importSource}
                    onChange={e => setImportSource(e.target.value)}
                    placeholder={activeList?.source || "Where these leads came from"}
                    className="h-8 flex-1 rounded-md border border-border bg-background text-[13px] text-foreground px-2 outline-none focus:border-muted-foreground"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground/70 -mt-2 mb-3">
                  Stamped on every imported lead — separate from the outreach Channel. Used for per-source reporting.
                </p>
                <div className="flex items-center gap-3">
                  <button onClick={() => { setImportStep("upload"); setCsvHeaders([]); setCsvRows([]); }}
                    className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="h-3.5 w-3.5" /> Choose another file
                  </button>
                  <div className="flex-1" />
                  <button onClick={runImport} disabled={busy}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-foreground text-background text-[13px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-30">
                    {busy ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Importing…</> : `Import ${csvRows.length.toLocaleString()} rows`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Enrich / Verify pre-flight — exact cost breakdown from a free dry-run
          before any credit is spent. Verify also picks the provider here. */}
      {confirmOp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !busy && setConfirmOp(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[15px] font-semibold text-foreground">{confirmOp === "enrich" ? "Enrich leads" : "Verify emails"}</span>
              <button onClick={() => setConfirmOp(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>

            {opLoading || !opPreview ? (
              <div className="text-[13px] text-muted-foreground py-8 text-center">
                Checking {selCount.toLocaleString()} lead{selCount === 1 ? "" : "s"}…
              </div>
            ) : (() => {
              const provider = verifyProvider;
              const providerLabel = provider === "neverbounce" ? "NeverBounce" : provider === "millionverifier" ? "MillionVerifier" : "your provider";
              const creditLabel = confirmOp === "enrich" ? "your Prospeo / Apollo credits" : `your ${providerLabel} credits`;
              const skipped = confirmOp === "enrich" ? (opPreview.no_identifier ?? 0) : (opPreview.no_email ?? 0);
              const skipLabel = confirmOp === "enrich" ? "no email or LinkedIn" : "no email";
              const reuseLabel = confirmOp === "enrich" ? "enriched recently" : "verified recently";
              return (
                <>
                  {/* Provider picker — only when more than one verifier is connected */}
                  {confirmOp === "verify" && (opPreview.connected_verifiers?.length ?? 0) > 1 && (
                    <div className="mb-3">
                      <div className="text-[11px] font-medium text-muted-foreground/70 mb-1.5">Verify with</div>
                      <select value={verifyProvider} onChange={e => setVerifyProvider(e.target.value)}
                        className="w-full h-9 rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none focus:border-muted-foreground">
                        {opPreview.connected_verifiers!.map(p => (
                          <option key={p} value={p}>{p === "neverbounce" ? "NeverBounce" : "MillionVerifier"}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Hero: the chargeable count, with a coins glyph */}
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3 mb-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/40 flex-shrink-0">
                      <Coins className="h-[18px] w-[18px] text-amber-600 dark:text-amber-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[18px] font-semibold text-foreground tabular-nums leading-tight">{opPreview.chargeable.toLocaleString()}</div>
                      <div className="text-[11px] text-muted-foreground">will use {creditLabel}</div>
                    </div>
                  </div>

                  {/* Secondary breakdown — only the lines that apply */}
                  {(opPreview.reused > 0 || skipped > 0) && (
                    <div className="rounded-lg border border-border text-[12px] divide-y divide-border mb-3">
                      {opPreview.reused > 0 && (
                        <div className="flex items-center justify-between px-3 py-2 text-muted-foreground">
                          <span>{reuseLabel} — free</span>
                          <span className="tabular-nums">{opPreview.reused.toLocaleString()}</span>
                        </div>
                      )}
                      {skipped > 0 && (
                        <div className="flex items-center justify-between px-3 py-2 text-muted-foreground">
                          <span>{skipLabel} — skipped</span>
                          <span className="tabular-nums">{skipped.toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <p className="text-[11px] text-muted-foreground/70 mb-1">
                    Runs on your own connected key, billed at your provider's rate. Recently {confirmOp === "enrich" ? "enriched" : "verified"} leads are reused free.
                  </p>
                  {selCount > SYNC_MAX && (
                    <p className="text-[11px] text-muted-foreground/70 mb-1">
                      Runs in the background with a live progress bar — you can keep working.
                      {selCount > opPreview.total && ` Processing the first ${opPreview.total.toLocaleString()} of ${selCount.toLocaleString()}.`}
                    </p>
                  )}

                  <div className="flex items-center justify-end gap-2 mt-4">
                    <button onClick={() => setConfirmOp(null)} className="text-[13px] text-muted-foreground hover:text-foreground px-3 py-1.5">Cancel</button>
                    <button onClick={runConfirmed} disabled={busy || opPreview.chargeable === 0}
                      className="h-9 px-4 rounded-lg bg-foreground text-background text-[13px] font-semibold hover:opacity-90 disabled:opacity-40">
                      {confirmOp === "enrich" ? `Enrich ${opPreview.chargeable.toLocaleString()}` : `Verify ${opPreview.chargeable.toLocaleString()}`}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Completion summary — shown after a run (sync) or job (async) finishes,
          with each outcome on its own color-coded line. */}
      {opResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOpResult(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-sm rounded-xl border border-border bg-background p-5 shadow-xl">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[15px] font-semibold text-foreground">{opResult.kind === "verify" ? "Verification complete" : "Enrichment complete"}</span>
              <button onClick={() => setOpResult(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-[12px] text-muted-foreground mb-3">
              {opResult.kind === "verify"
                ? `${opResult.headline.toLocaleString()} email${opResult.headline === 1 ? "" : "s"} checked.`
                : `${opResult.headline.toLocaleString()} email${opResult.headline === 1 ? "" : "s"} found.`}
            </p>
            <div className="rounded-lg border border-border divide-y divide-border mb-4">
              {opResult.rows.map(r => {
                const dot = r.tone === "green" ? "bg-green-500" : r.tone === "amber" ? "bg-amber-500" : r.tone === "red" ? "bg-red-500" : "bg-zinc-400";
                return (
                  <div key={r.label} className="flex items-center justify-between px-3 py-2.5 text-[13px]">
                    <span className="flex items-center gap-2 text-foreground">
                      <span className={`h-2 w-2 rounded-full ${dot} flex-shrink-0`} />
                      {r.label}
                    </span>
                    <span className="tabular-nums font-medium text-foreground">{r.n.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end">
              <button onClick={() => setOpResult(null)}
                className="h-9 px-4 rounded-lg bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LinkedIn Engagers — manage panel (visibility + on/off) */}
      {engageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEngageOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-xl">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <Linkedin className="h-4 w-4 text-[#0a66c2]" />
                <span className="text-[15px] font-semibold text-foreground">LinkedIn Engagers</span>
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Auto-managed</span>
              </div>
              <button onClick={() => setEngageOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>

            {!engageInfo ? (
              <p className="text-[13px] text-muted-foreground mt-4">Loading…</p>
            ) : (
              <>
                <p className="text-[13px] text-muted-foreground mt-3 leading-relaxed">
                  Every Monday, Nous reads everyone who commented on or reacted to your last{" "}
                  {engageInfo.window.posts} LinkedIn posts (past {engageInfo.window.days} days) and adds them here.
                  Each engagement also lands on that person’s timeline across your accounts. They become People the
                  moment they actually reply.
                </p>

                <div className="mt-4 space-y-2 text-[13px]">
                  {engageInfo.reads_from && (
                    <div className="flex items-center gap-2 text-foreground/80">
                      <Linkedin className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Reads from</span>
                      <span className="font-medium text-foreground truncate">{engageInfo.reads_from}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-foreground/80">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Schedule</span>
                    <span className="font-medium text-foreground">{engageInfo.schedule}</span>
                  </div>
                  {engageInfo.last_run && (
                    <div className="flex items-start gap-2 text-foreground/80">
                      <RefreshCw className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                      <span className="text-muted-foreground">Last run</span>
                      <span className="font-medium text-foreground">{engageInfo.last_run.summary}</span>
                    </div>
                  )}
                </div>

                {/* On/off — shown when there's a connection to govern */}
                {engageInfo.reason !== "not_connected" && engageInfo.reason !== "not_configured" ? (
                  <div className="mt-5 flex items-center justify-between rounded-lg border border-border px-3.5 py-3">
                    <div>
                      <div className="text-[13px] font-medium text-foreground">Weekly engagement scrape</div>
                      <div className="text-[12px] text-muted-foreground">
                        {engageInfo.enabled ? "On — runs every Monday" : "Off — no engagers are pulled"}
                      </div>
                    </div>
                    <button
                      role="switch" aria-checked={engageInfo.enabled} disabled={engageBusy}
                      onClick={() => toggleEngagement(!engageInfo.enabled)}
                      className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${engageInfo.enabled ? "bg-foreground" : "bg-muted-foreground/30"}`}
                    >
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-background transition-transform ${engageInfo.enabled ? "translate-x-[22px]" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                ) : null}

                {/* Availability note when it can't actually run here */}
                {!engageInfo.available && (
                  <div className="mt-4 rounded-lg bg-muted/60 px-3.5 py-3 text-[12.5px] text-muted-foreground">
                    {engageInfo.reason === "not_configured" && (
                      engageInfo.self_host
                        ? "Set APIFY_TOKEN in your worker environment to enable engagement scraping."
                        : "Engagement scraping isn’t configured on this deployment yet."
                    )}
                    {engageInfo.reason === "not_connected" && (
                      <>Connect your LinkedIn first to start pulling engagers.{" "}
                        <button onClick={() => navigate("/integrations")} className="underline hover:text-foreground">Connect LinkedIn →</button>
                      </>
                    )}
                    {engageInfo.reason === "needs_plan" && (
                      <>Available on the Pro plan and up.{" "}
                        <button onClick={() => navigate("/usage")} className="underline hover:text-foreground">Upgrade →</button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Export-to-CSV modal — names the channel so the export is tracked */}
      {csvOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !csvBusy && setCsvOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[15px] font-semibold text-foreground">Export to CSV</span>
              <button onClick={() => setCsvOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-[12px] text-muted-foreground mb-3">
              Exporting <span className="font-medium text-foreground">{exportNoun}</span>. Name the channel or tool you're sending them into. Every exported lead is tagged with it, so you can track where they went — even for tools Nous doesn't integrate with directly.
            </p>
            <div className="text-[11px] font-medium text-muted-foreground/70 mb-1.5">Channel name</div>
            <input
              value={csvName}
              onChange={e => setCsvName(e.target.value)}
              autoFocus
              placeholder="e.g. LinkedIn sequencer, Email Campaign 1, Custom tool"
              onKeyDown={e => { if (e.key === "Enter") exportCsvNamed(); if (e.key === "Escape") setCsvOpen(false); }}
              className="w-full h-9 rounded-lg border border-border bg-background px-3 text-[13px] text-foreground mb-4 outline-none focus:border-muted-foreground"
            />
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setCsvOpen(false)} className="text-[13px] text-muted-foreground hover:text-foreground px-3 py-1.5">Cancel</button>
              <button onClick={exportCsvNamed} disabled={csvBusy || !csvName.trim()}
                className="h-9 px-4 rounded-lg bg-foreground text-background text-[13px] font-semibold hover:opacity-90 disabled:opacity-40">
                {csvBusy ? "Exporting…" : "Export to CSV"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export-to-campaign modal */}
      {pushOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !pushing && setPushOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[15px] font-semibold text-foreground">Export to a campaign</span>
              <button onClick={() => setPushOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-[12px] text-muted-foreground mb-3">
              Push <span className="font-medium text-foreground">{exportNoun}</span> into a {pushApp.label} campaign. Leads without {pushApp.kind === "linkedin" ? "a LinkedIn URL" : "an email"} are skipped.
            </p>
            <div className="text-[11px] font-medium text-muted-foreground/70 mb-1.5">Platform</div>
            <div className="h-9 rounded-lg border border-border bg-muted/40 px-3 flex items-center justify-between text-[13px] text-foreground mb-3">
              <span>{pushApp.label}</span>
              <span className="text-[11px] text-muted-foreground/60">{pushApp.kind === "linkedin" ? "LinkedIn" : "Email"}</span>
            </div>
            <div className="text-[11px] font-medium text-muted-foreground/70 mb-1.5">Campaign</div>
            {campaignsConn === false ? (
              <div className="text-[12px] text-amber-700 border border-amber-200 bg-amber-50 rounded-lg px-3 py-2 mb-3">{pushApp.label} isn't connected — add it in Integrations first.</div>
            ) : campaignsConn === null ? (
              <div className="text-[12px] text-muted-foreground px-1 py-2 mb-3">Loading campaigns…</div>
            ) : (
              <select value={pushCampaign} onChange={e => setPushCampaign(e.target.value)}
                className="w-full h-9 rounded-lg border border-border bg-background px-3 text-[13px] text-foreground mb-3 outline-none focus:border-muted-foreground">
                <option value="">Select a campaign…</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setPushOpen(false)} className="text-[13px] text-muted-foreground hover:text-foreground px-3 py-1.5">Cancel</button>
              <button onClick={pushToCampaign} disabled={pushing || !pushCampaign || (exportScope === "selected" && selected.size === 0 && !selectAllMatching)}
                className="h-9 px-4 rounded-lg bg-foreground text-background text-[13px] font-semibold hover:opacity-90 disabled:opacity-40">
                {pushing ? "Pushing…" : exportCount != null ? `Push ${exportCount.toLocaleString()} lead${exportCount === 1 ? "" : "s"}` : "Push matching leads"}
              </button>
            </div>
            {exportScope === "selected" && selected.size === 0 && !selectAllMatching && <p className="text-[11px] text-muted-foreground/70 mt-2">Tip: tick leads in the table first, then export.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

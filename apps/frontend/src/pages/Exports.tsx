import { useState, useEffect, useCallback } from "react";
import { Download, Check, RefreshCw, Plus, Trash2, Search, FileDown } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { systemLogOpName, agentOpName } from "@/lib/operationName";
import { toast } from "@/components/ui/sonner";
import { PageHeader } from "@/components/ui/page-header";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

// One normalized operation record — the export's row shape.
interface OpRow {
  id: string;
  timestamp: string;
  operation: string;
  detail: string;
  source: string;
  event_type: string;
}

// A completed export job, persisted client-side.
interface ExportRecord {
  id: string;
  createdAt: string;
  range: Range;
  format: Fmt;
  fields: string[];
  recordCount: number;
  filename: string;
  content: string;
}

const FIELDS: { key: keyof OpRow; label: string; type: string; sample: string }[] = [
  { key: "id",         label: "id",         type: "string",  sample: "op_8f2c…" },
  { key: "timestamp",  label: "timestamp",  type: "ISO 8601", sample: "2026-05-21T09:24:01.677Z" },
  { key: "operation",  label: "operation",  type: "string",  sample: "linkedin.webhook.ingest.message" },
  { key: "detail",     label: "detail",     type: "string",  sample: "LinkedIn message from Bhavya Goel" },
  { key: "source",     label: "source",     type: "enum",    sample: "system" },
  { key: "event_type", label: "event_type", type: "string",  sample: "webhook_ingest" },
];

type Fmt = "json" | "ndjson" | "csv";
type Range = "1d" | "7d" | "30d" | "all";

const RANGE_DAYS: Record<Range, number> = { "1d": 1, "7d": 7, "30d": 30, all: 365 };
const RANGE_LABEL: Record<Range, string> = { "1d": "Last 24h", "7d": "Last 7 days", "30d": "Last 30 days", all: "All time" };
const FMT_LABEL: Record<Fmt, string> = { json: "JSON", ndjson: "NDJSON", csv: "CSV" };

// ── client-side export history ─────────────────────────────────────────────

const storeKey = (ws: string) => `nous_ops_exports_${ws}`;

function loadExports(ws: string): ExportRecord[] {
  try { return JSON.parse(localStorage.getItem(storeKey(ws)) || "[]"); } catch { return []; }
}
function saveExports(ws: string, list: ExportRecord[]) {
  try { localStorage.setItem(storeKey(ws), JSON.stringify(list.slice(0, 12))); } catch { /* quota */ }
}

const BTN_PRIMARY = "inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors";
const BTN_SECONDARY = "inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-accent disabled:opacity-40 transition-colors";

function downloadBlob(content: string, filename: string, fmt: Fmt) {
  const mime = fmt === "csv" ? "text/csv" : fmt === "ndjson" ? "application/x-ndjson" : "application/json";
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Create-export modal ────────────────────────────────────────────────────

function CreateExportModal({
  open, onOpenChange, token, workspaceId, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  token: string;
  workspaceId: string;
  onCreated: (rec: ExportRecord) => void;
}) {
  const [selected, setSelected] = useState<Set<keyof OpRow>>(new Set(FIELDS.map(f => f.key)));
  const [fmt, setFmt] = useState<Fmt>("json");
  const [range, setRange] = useState<Range>("7d");
  const [generating, setGenerating] = useState(false);

  const keys = FIELDS.filter(f => selected.has(f.key)).map(f => f.key);

  const toggleField = (k: keyof OpRow) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };

  const schemaPreview = "{\n" +
    FIELDS.filter(f => selected.has(f.key))
      .map(f => `  "${f.key}": ${f.type === "ISO 8601" ? '"<ISO 8601>"' : f.type === "enum" ? '"system | agent | mcp | sdk | api"' : `"<${f.type}>"`}`)
      .join(",\n") +
    "\n}";

  const generate = async () => {
    if (keys.length === 0) { toast.error("Select at least one field to export"); return; }
    if (!token || !workspaceId) { toast.error("Not ready — try again in a moment"); return; }
    setGenerating(true);
    try {
      const days = RANGE_DAYS[range];
      const headers = { Authorization: `Bearer ${token}` };
      const [sysRes, reqRes] = await Promise.all([
        fetch(`${apiUrl}/api/workspace/system-log?workspace_id=${workspaceId}&days=${days}&limit=1000`, { headers }),
        fetch(`${apiUrl}/api/requests/log?days=${days}&limit=1000`, { headers }),
      ]);
      const sys = sysRes.ok ? await sysRes.json() : { events: [] };
      const req = reqRes.ok ? await reqRes.json() : { requests: [] };

      const rows: OpRow[] = [
        ...(sys.events ?? []).map((e: any) => {
          const op = systemLogOpName(e.source, e.event_type, e.metadata);
          return {
            id: e.id,
            timestamp: e.occurred_at,
            operation: op.name,
            detail: e.summary || e.source || "",
            source: e.source === "mcp" ? "agent" : "system",
            event_type: e.event_type || "",
          };
        }),
        ...(req.requests ?? []).map((r: any) => {
          const op = agentOpName(r.op_type, r.entity_type);
          return {
            id: r.id,
            timestamp: r.created_at,
            operation: op.name,
            detail: r.entity_type || "",
            source: "agent",
            event_type: r.op_type || "",
          };
        }),
      ]
        .filter(r => r.timestamp && !isNaN(new Date(r.timestamp).getTime()))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      if (rows.length === 0) { toast.error("No operations found in this range"); return; }

      const shaped = rows.map(r => {
        const o: Record<string, any> = {};
        keys.forEach(k => { o[k] = r[k]; });
        return o;
      });

      let content = "", ext = "";
      if (fmt === "json") {
        content = JSON.stringify(shaped, null, 2); ext = "json";
      } else if (fmt === "ndjson") {
        content = shaped.map(o => JSON.stringify(o)).join("\n"); ext = "ndjson";
      } else {
        const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        content = [keys.join(","), ...shaped.map(o => keys.map(k => esc(o[k])).join(","))].join("\n");
        ext = "csv";
      }

      const now = new Date();
      const rec: ExportRecord = {
        id: "exp_" + Math.random().toString(36).slice(2, 10),
        createdAt: now.toISOString(),
        range, format: fmt,
        fields: keys as string[],
        recordCount: rows.length,
        filename: `nous-operations-${range}-${now.toISOString().slice(0, 10)}.${ext}`,
        content,
      };
      downloadBlob(rec.content, rec.filename, fmt);
      onCreated(rec);
      onOpenChange(false);
      toast.success(`Exported ${rows.length} operations`);
    } catch {
      toast.error("Export failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[16px] font-bold tracking-tight text-foreground">Create export</DialogTitle>
        </DialogHeader>
        <p className="text-[12px] text-muted-foreground -mt-1">
          Export your operations log in a structured format using a customizable schema.
        </p>

        <div className="space-y-5 mt-2">
          {/* Range */}
          <div>
            <h3 className="text-[13px] font-semibold text-foreground mb-2">Time range</h3>
            <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5 gap-0.5">
              {(Object.keys(RANGE_DAYS) as Range[]).map(r => (
                <button key={r} onClick={() => setRange(r)}
                  className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                    range === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}>
                  {RANGE_LABEL[r]}
                </button>
              ))}
            </div>
          </div>

          {/* Schema */}
          <div>
            <h3 className="text-[13px] font-semibold text-foreground mb-0.5">Schema</h3>
            <p className="text-[12px] text-muted-foreground mb-2.5">Pick the fields each exported record should carry.</p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {FIELDS.map(f => {
                const on = selected.has(f.key);
                return (
                  <button key={f.key} onClick={() => toggleField(f.key)}
                    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                      on ? "border-foreground bg-muted/50" : "border-border hover:border-border"
                    }`}>
                    <span className={`h-4 w-4 rounded flex items-center justify-center flex-shrink-0 border ${
                      on ? "bg-primary border-primary" : "border-border"
                    }`}>
                      {on && <Check className="h-3 w-3 text-primary-foreground" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-mono text-foreground truncate">{f.label}</span>
                      <span className="block text-[11px] text-muted-foreground/70 truncate">{f.sample}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-1.5">Record shape</p>
            <pre className="text-[12px] leading-relaxed text-foreground/80 font-mono bg-muted/50 border border-border/60 rounded-lg px-4 py-3 overflow-x-auto whitespace-pre">
{keys.length ? schemaPreview : "// select at least one field"}
            </pre>
          </div>

          {/* Format */}
          <div>
            <h3 className="text-[13px] font-semibold text-foreground mb-2">Format</h3>
            <div className="inline-flex rounded-lg border border-border bg-muted/50 p-0.5 gap-0.5">
              {(Object.keys(FMT_LABEL) as Fmt[]).map(f => (
                <button key={f} onClick={() => setFmt(f)}
                  className={`px-3.5 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                    fmt === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}>
                  {FMT_LABEL[f]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-border/60">
          <button onClick={() => onOpenChange(false)} className={BTN_SECONDARY}>Cancel</button>
          <button onClick={generate} disabled={generating || keys.length === 0} className={BTN_PRIMARY}>
            {generating
              ? <><RefreshCw className="h-4 w-4 animate-spin" /> Generating…</>
              : <><Download className="h-4 w-4" /> Generate export</>}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Exports page ───────────────────────────────────────────────────────────

export default function Exports() {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";

  const [exports, setExports] = useState<ExportRecord[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const reload = useCallback(() => {
    if (workspaceId) setExports(loadExports(workspaceId));
  }, [workspaceId]);

  useEffect(() => { reload(); }, [reload]);

  const onCreated = (rec: ExportRecord) => {
    setExports(prev => {
      const next = [rec, ...prev].slice(0, 12);
      saveExports(workspaceId, next);
      return next;
    });
  };

  const remove = (id: string) => {
    setExports(prev => {
      const next = prev.filter(e => e.id !== id);
      saveExports(workspaceId, next);
      return next;
    });
  };

  const q = search.trim().toLowerCase();
  const rows = exports.filter(e =>
    !q || e.id.toLowerCase().includes(q) || e.format.includes(q) || RANGE_LABEL[e.range].toLowerCase().includes(q)
  );

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-8 py-7">
        <PageHeader
          title="Exports"
          subtitle="Export your operations log in a structured format using a customizable schema."
          actions={
            <>
              <button onClick={reload} className={BTN_SECONDARY}>
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </button>
              <button onClick={() => setModalOpen(true)} className={BTN_PRIMARY}>
                <Plus className="h-3.5 w-3.5" /> Create export
              </button>
            </>
          }
        />

        {/* Search */}
        <div className="relative max-w-sm mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by ID, format, or range…"
            className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground/70 focus:border-ring outline-none"
          />
        </div>

        {/* Table */}
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-16 text-center">
            <FileDown className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-[13px] font-medium text-foreground/80 mb-1">
              {exports.length === 0 ? "No exports yet" : "No exports match your search"}
            </p>
            <p className="text-[12px] text-muted-foreground/70">
              {exports.length === 0 ? "Create your first export to see it here." : "Try a different search term."}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="grid grid-cols-[1.3fr_1fr_1.1fr_0.8fr_0.8fr_1.2fr_84px] gap-4 px-4 py-2.5 bg-muted/50 border-b border-border">
              {["ID", "Status", "Range", "Format", "Records", "Created", "Actions"].map(h => (
                <p key={h} className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{h}</p>
              ))}
            </div>
            {rows.map(e => (
              <div key={e.id}
                className="grid grid-cols-[1.3fr_1fr_1.1fr_0.8fr_0.8fr_1.2fr_84px] gap-4 items-center px-4 py-3 border-b border-border/60 last:border-0 hover:bg-accent transition-colors">
                <span className="text-[13px] font-mono text-foreground/80 truncate">{e.id}</span>
                <span>
                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700">
                    <Check className="h-3 w-3" /> Completed
                  </span>
                </span>
                <span className="text-[13px] text-foreground/80">{RANGE_LABEL[e.range]}</span>
                <span className="text-[13px] text-foreground/80">{FMT_LABEL[e.format]}</span>
                <span className="text-[13px] text-foreground/80 tabular-nums">{e.recordCount.toLocaleString()}</span>
                <span className="text-[12px] text-muted-foreground/70">{format(new Date(e.createdAt), "MMM d, HH:mm")}</span>
                <span className="flex items-center gap-1">
                  <button
                    onClick={() => downloadBlob(e.content, e.filename, e.format)}
                    title="Download"
                    className="p-1.5 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => remove(e.id)}
                    title="Delete"
                    className="p-1.5 rounded-md text-muted-foreground/70 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <CreateExportModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        token={token}
        workspaceId={workspaceId}
        onCreated={onCreated}
      />
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Upload, RefreshCw, FileText, X, ArrowLeft, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/ui/page-header";
import { parseCSVLine } from "@/components/contacts/PeopleImportModal";

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
const CUSTOM_W = 150;
const STATUS_W = 100;
const SEL_W = 40;
const SKIP = "";           // mapping target: ignore this CSV column
const NEW_COL = "__new__"; // mapping target: create a new column from this header

// CSV-header aliases for auto-mapping to the fixed columns.
const FIXED_ALIASES: Record<string, string[]> = {
  email:        ["email", "e-mail", "email address", "work email", "emails"],
  name:         ["name", "full name", "full_name", "contact name", "contact", "lead name"],
  company:      ["company", "company name", "organization", "organisation", "account", "employer"],
  linkedin_url: ["linkedin", "linkedin url", "linkedin profile", "linkedin_url", "li url", "li"],
};

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
  fields: Record<string, unknown>;
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `col_${Date.now()}`;

function cellValue(lead: Lead, key: string): string {
  if (key === "name") return lead.name ?? "";
  if (key === "email") return lead.email ?? "";
  if (key === "company") return lead.company ?? "";
  if (key === "linkedin_url") return lead.linkedin_url ?? "";
  const v = lead.fields?.[key];
  return v == null ? "" : String(v);
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

export default function Lists() {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";
  const navigate = useNavigate();

  const jsonHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const authHeaders = { Authorization: `Bearer ${token}` };

  const [lists, setLists] = useState<LeadList[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [gated, setGated] = useState(false);
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [addingRow, setAddingRow] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [addingCol, setAddingCol] = useState(false);
  const [newColLabel, setNewColLabel] = useState("");

  // Mapped CSV import
  const [importing, setImporting] = useState(false);
  const [importStep, setImportStep] = useState<"upload" | "mapping">("upload");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null);
  // ICP segmentation filter — sales-nav-builder tags each lead fields.icp true/false.
  const [icpFilter, setIcpFilter] = useState<"all" | "icp" | "non">("all");
  // Selected lead ids — the manual delete control after ICP scoring.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const loadLists = useCallback(async () => {
    if (!workspaceId || !token) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/lead-lists?workspaceId=${workspaceId}`, { headers: authHeaders });
      if (res.status === 402) { setGated(true); setLoading(false); return; }
      const d = res.ok ? await res.json() : {};
      const next: LeadList[] = d.lead_lists ?? [];
      setLists(next);
      setActiveId(prev => (prev && next.some(l => l.id === prev) ? prev : next[0]?.id ?? null));
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [workspaceId, token]);

  useEffect(() => { loadLists(); }, [loadLists]);

  const loadLeads = useCallback(async (listId: string) => {
    setLeadsLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/lead-lists/${listId}/leads?workspaceId=${workspaceId}&limit=500`, { headers: authHeaders });
      const d = res.ok ? await res.json() : {};
      setLeads(d.leads ?? []);
    } catch { setLeads([]); }
    finally { setLeadsLoading(false); }
  }, [workspaceId, token]);

  useEffect(() => {
    if (activeId) loadLeads(activeId);
    else setLeads([]);
  }, [activeId, loadLeads]);

  // Reset the ICP filter and selection when switching lists.
  useEffect(() => { setIcpFilter("all"); setSelected(new Set()); }, [activeId]);

  const activeList = lists.find(l => l.id === activeId) ?? null;
  const customCols = activeList?.columns ?? [];
  // ICP segmentation — show the filter only when the list has ICP-scored leads.
  const icpCount = leads.filter(l => l.fields?.icp === true).length;
  const nonIcpCount = leads.filter(l => l.fields?.icp === false).length;
  const hasIcp = icpCount > 0 || nonIcpCount > 0;
  const visibleLeads =
    !hasIcp || icpFilter === "all"
      ? leads
      : leads.filter(l => (icpFilter === "icp" ? l.fields?.icp === true : l.fields?.icp === false));

  // Row selection + delete (the manual control step).
  const allVisibleSelected = visibleLeads.length > 0 && visibleLeads.every(l => selected.has(l.id));
  const toggleOne = (id: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAllVisible = () =>
    setSelected(prev => {
      const n = new Set(prev);
      if (visibleLeads.every(l => prev.has(l.id))) visibleLeads.forEach(l => n.delete(l.id));
      else visibleLeads.forEach(l => n.add(l.id));
      return n;
    });
  async function deleteSelected() {
    if (!activeId || selected.size === 0) return;
    setBusy(true);
    try {
      await fetch(`${apiUrl}/api/lead-lists/${activeId}/leads`, {
        method: "DELETE",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, ids: [...selected] }),
      });
      setSelected(new Set());
      await loadLeads(activeId);
      await loadLists();
    } catch { /* silent */ }
    finally { setBusy(false); }
  }
  const allCols = [
    ...FIXED_COLS,
    ...customCols.map(c => ({ key: c.key, label: c.label, w: CUSTOM_W })),
  ];

  const resetImport = () => {
    setImporting(false); setImportStep("upload");
    setCsvHeaders([]); setCsvRows([]); setMapping({}); setResult(null);
  };

  const createList = async () => {
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/lead-lists`, {
        method: "POST", headers: jsonHeaders,
        body: JSON.stringify({ workspaceId, name: newName.trim(), source: "csv" }),
      });
      const d = res.ok ? await res.json() : null;
      setNewName(""); setCreating(false);
      await loadLists();
      if (d?.lead_list?.id) setActiveId(d.lead_list.id);
    } catch { /* silent */ }
    finally { setBusy(false); }
  };

  const addColumn = async () => {
    const label = newColLabel.trim();
    if (!label || !activeList || busy) return;
    setBusy(true);
    try {
      const columns = [...customCols, { key: slugify(label), label }];
      await fetch(`${apiUrl}/api/lead-lists/${activeList.id}`, {
        method: "PATCH", headers: jsonHeaders,
        body: JSON.stringify({ workspaceId, columns }),
      });
      setNewColLabel(""); setAddingCol(false);
      loadLists();
    } catch { /* silent */ }
    finally { setBusy(false); }
  };

  const addRow = async () => {
    if (!activeId || !draft.email?.trim() || busy) return;
    setBusy(true);
    try {
      const fields: Record<string, string> = {};
      for (const c of customCols) {
        const v = draft[c.key]?.trim();
        if (v) fields[c.key] = v;
      }
      await fetch(`${apiUrl}/api/lead-lists/${activeId}/leads`, {
        method: "POST", headers: jsonHeaders,
        body: JSON.stringify({
          workspaceId,
          leads: [{
            email: draft.email.trim(),
            name: draft.name?.trim() || null,
            company: draft.company?.trim() || null,
            linkedin_url: draft.linkedin_url?.trim() || null,
            fields,
          }],
        }),
      });
      setDraft({}); setAddingRow(false);
      loadLeads(activeId);
      loadLists();
    } catch { /* silent */ }
    finally { setBusy(false); }
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
          body: JSON.stringify({ workspaceId, leads: rows.slice(i, i + IMPORT_CHUNK) }),
        });
        if (res.ok) { const d = await res.json(); inserted += d.inserted ?? 0; skipped += d.skipped ?? 0; }
      }
      setResult({ inserted, skipped });
      setImporting(false); setImportStep("upload");
      setCsvHeaders([]); setCsvRows([]); setMapping({});
      loadLeads(activeId);
      loadLists();
    } catch { /* silent */ }
    finally { setBusy(false); }
  };

  // ── Gated — not on the Scale plan ───────────────────────────────────────────
  if (gated) {
    return (
      <div className="h-full overflow-y-auto bg-background">
        <div className="px-8 py-7">
          <PageHeader title="Lists" subtitle="Upload and store lead lists as workspace context." />
          <div className="rounded-xl border border-border bg-muted/40 px-6 py-10 text-center">
            <p className="text-[14px] font-semibold text-foreground">Lists is a Scale-plan feature</p>
            <p className="text-[13px] text-muted-foreground mt-1.5 max-w-md mx-auto">
              Storing lead lists as context for the workspace is available on the Scale plan.
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

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-8 py-7">
        <PageHeader
          title="Lists"
          subtitle="Upload lead lists and store them as context for the workspace."
          actions={
            <>
              <button
                onClick={() => navigate("/lists/clean")}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors"
                title="Pre-flight dedup any list against the workspace's engagement history"
              >
                Clean a list →
              </button>
              {activeList && (
                <button
                  onClick={() => { if (importing) resetImport(); else { setImporting(true); setResult(null); } }}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-foreground text-background text-[13px] font-semibold hover:opacity-90 transition-opacity"
                >
                  <Upload className="h-3.5 w-3.5" /> Import CSV
                </button>
              )}
            </>
          }
        />

        {/* Tabs — one per list */}
        <div className="flex items-center gap-1 border-b border-border mb-4 overflow-x-auto">
          {lists.map(l => (
            <button
              key={l.id}
              onClick={() => { setActiveId(l.id); resetImport(); setAddingRow(false); }}
              className={`flex items-center gap-1.5 px-3 py-2 text-[13px] border-b-2 -mb-px whitespace-nowrap transition-colors ${
                l.id === activeId
                  ? "border-foreground text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {l.name}
              <span className="text-[11px] text-muted-foreground/60 tabular-nums">{l.lead_count ?? 0}</span>
            </button>
          ))}
          {creating ? (
            <span className="flex items-center gap-1.5 px-2 py-1">
              <input
                value={newName} onChange={e => setNewName(e.target.value)} autoFocus placeholder="List name"
                onKeyDown={e => { if (e.key === "Enter") createList(); if (e.key === "Escape") { setCreating(false); setNewName(""); } }}
                className="h-7 w-36 rounded-md border border-border bg-background px-2 text-[13px] outline-none focus:border-muted-foreground"
              />
              <button onClick={createList} disabled={busy || !newName.trim()}
                className="h-7 px-2.5 rounded-md bg-foreground text-background text-[12px] font-medium disabled:opacity-30">Add</button>
              <button onClick={() => { setCreating(false); setNewName(""); }}
                className="text-[12px] text-muted-foreground hover:text-foreground">Cancel</button>
            </span>
          ) : (
            <button onClick={() => setCreating(true)}
              className="flex items-center gap-1 px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">
              <Plus className="h-3.5 w-3.5" /> New list
            </button>
          )}
        </div>

        {/* Import — upload → map */}
        {importing && activeList && (
          <div className="rounded-xl border border-border bg-muted/40 p-4 mb-4">
            {importStep === "upload" ? (
              <>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[13px] font-semibold text-foreground">Import a CSV into “{activeList.name}”</span>
                  <button onClick={resetImport} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                </div>
                <p className="text-[12px] text-muted-foreground mb-3">
                  Any CSV — a Clay export, an Apollo download. The next step maps its columns to this list.
                </p>
                <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
                <button onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground text-[13px] font-semibold hover:bg-muted/50 transition-colors">
                  <FileText className="h-3.5 w-3.5" /> Choose CSV file
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[13px] font-semibold text-foreground">
                    Map columns — {csvRows.length.toLocaleString()} rows
                  </span>
                  <button onClick={resetImport} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                </div>
                <p className="text-[12px] text-muted-foreground mb-3">
                  Match each CSV column to a list column, create a new one, or skip it.
                </p>
                <div className="space-y-1.5 mb-3">
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
        )}

        {result && (
          <div className="mb-4 text-[13px] text-green-700 dark:text-green-500">
            Imported {result.inserted} lead{result.inserted === 1 ? "" : "s"}
            {result.skipped ? ` · ${result.skipped} skipped (no email or LinkedIn)` : ""}.
          </div>
        )}

        {/* ICP segmentation filter — only when the active list has scored leads */}
        {activeList && hasIcp && !leadsLoading && (
          <div className="flex items-center gap-1.5 mb-3">
            {([
              ["all", "All", leads.length],
              ["icp", "ICP", icpCount],
              ["non", "Non-ICP", nonIcpCount],
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
                <span className="tabular-nums opacity-70">{n}</span>
              </button>
            ))}
          </div>
        )}

        {/* Delete control — appears when rows are selected */}
        {activeList && selected.size > 0 && (
          <div className="flex items-center gap-3 mb-3">
            <span className="text-[12px] text-muted-foreground tabular-nums">{selected.size} selected</span>
            <button
              onClick={deleteSelected}
              disabled={busy}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40 transition-colors disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete selected
            </button>
            <button onClick={() => setSelected(new Set())} className="text-[12px] text-muted-foreground hover:text-foreground">
              Clear
            </button>
          </div>
        )}

        {/* Table */}
        {lists.length === 0 && !loading ? (
          <div className="rounded-xl border border-border px-6 py-12 text-center">
            <p className="text-[13px] text-muted-foreground">No lists yet — create one to upload leads into.</p>
          </div>
        ) : activeList ? (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <div style={{ minWidth: rowWidth + 140 }}>
                {/* Header */}
                <div className="flex bg-muted/50 border-b border-border">
                  <div className="px-2 py-2.5 flex items-center flex-shrink-0" style={{ width: SEL_W }}>
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      className="h-3.5 w-3.5 accent-foreground cursor-pointer"
                    />
                  </div>
                  {allCols.map(c => (
                    <div key={c.key} className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 flex-shrink-0" style={{ width: c.w }}>
                      {c.label}
                    </div>
                  ))}
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
                  <div className="text-[13px] text-muted-foreground py-12 text-center">Loading…</div>
                ) : (
                  <>
                    {visibleLeads.map(l => (
                      <div key={l.id} className={`flex border-b border-border/60 transition-colors ${selected.has(l.id) ? "bg-muted/60" : "hover:bg-muted/40"}`}>
                        <div className="px-2 py-2.5 flex items-center flex-shrink-0" style={{ width: SEL_W }}>
                          <input
                            type="checkbox"
                            aria-label="Select lead"
                            checked={selected.has(l.id)}
                            onChange={() => toggleOne(l.id)}
                            className="h-3.5 w-3.5 accent-foreground cursor-pointer"
                          />
                        </div>
                        {allCols.map((c, i) => (
                          <div key={c.key} className={`px-3 py-2.5 text-[13px] truncate flex-shrink-0 ${i === 0 ? "text-foreground" : "text-muted-foreground"}`} style={{ width: c.w }}>
                            {cellValue(l, c.key) || <span className="text-muted-foreground/40">—</span>}
                          </div>
                        ))}
                        <div className="px-3 py-2.5 text-[12px] capitalize flex-shrink-0" style={{ width: STATUS_W }}>
                          <span className={l.reply_outcome ? "text-green-700 dark:text-green-500" : "text-muted-foreground/60"}>
                            {l.reply_outcome || l.status}
                          </span>
                        </div>
                      </div>
                    ))}

                    {/* Add row */}
                    {addingRow ? (
                      <div className="flex border-b border-border/60 bg-muted/40 items-center">
                        <div className="flex-shrink-0" style={{ width: SEL_W }} />
                        {allCols.map(c => (
                          <div key={c.key} className="px-1.5 py-1.5 flex-shrink-0" style={{ width: c.w }}>
                            <input
                              value={draft[c.key] ?? ""}
                              onChange={e => setDraft(d => ({ ...d, [c.key]: e.target.value }))}
                              placeholder={FIXED_KEYS.has(c.key) ? c.label : ""}
                              autoFocus={c.key === "name"}
                              onKeyDown={e => { if (e.key === "Enter") addRow(); if (e.key === "Escape") { setAddingRow(false); setDraft({}); } }}
                              className="h-7 w-full rounded border border-border bg-background px-2 text-[13px] outline-none focus:border-muted-foreground"
                            />
                          </div>
                        ))}
                        <div className="px-2 py-1.5 flex items-center gap-1.5 flex-shrink-0" style={{ width: STATUS_W }}>
                          <button onClick={addRow} disabled={busy || !draft.email?.trim()}
                            className="h-7 px-2 rounded-md bg-foreground text-background text-[12px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-30">Add</button>
                          <button onClick={() => { setAddingRow(false); setDraft({}); }}
                            className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setAddingRow(true)}
                        className="flex items-center gap-1.5 px-3 py-2.5 text-[13px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
                        <Plus className="h-3.5 w-3.5" /> Add lead
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {activeList && leads.length > 0 && (
          <p className="text-[12px] text-muted-foreground mt-3 tabular-nums">
            {visibleLeads.length === leads.length
              ? `${leads.length} leads`
              : `${visibleLeads.length} of ${leads.length} leads`}
          </p>
        )}
      </div>
    </div>
  );
}

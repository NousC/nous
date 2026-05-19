import { useState, useEffect, useRef } from "react";
import { X, FileText, RefreshCw, Check } from "lucide-react";
import { toast } from "@/components/ui/sonner";

const apiUrl = import.meta.env.VITE_API_URL ?? "";
const MONO = { fontFamily: "'JetBrains Mono',monospace" } as const;

// ── CSV helpers ────────────────────────────────────────────────────────────

export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim()); current = "";
    } else current += ch;
  }
  result.push(current.trim());
  return result;
}

export const IMPORT_FIELDS = [
  { key: "email",          label: "Email" },
  { key: "full_name",      label: "Full Name" },
  { key: "first_name",     label: "First Name" },
  { key: "last_name",      label: "Last Name" },
  { key: "company",        label: "Company" },
  { key: "domain",         label: "Domain" },
  { key: "job_title",      label: "Job Title" },
  { key: "phone",          label: "Phone" },
  { key: "deal_stage",     label: "Deal Stage" },
  { key: "source",         label: "Source" },
  { key: "linkedin_url",   label: "LinkedIn URL" },
  { key: "notes",          label: "Notes" },
  { key: "seniority",      label: "Seniority" },
  { key: "department",     label: "Department" },
  { key: "pipeline_stage", label: "Pipeline Stage" },
] as const;

export const IMPORT_AUTO_MATCH: Record<string, string[]> = {
  email:          ["email", "emailaddress", "mail"],
  first_name:     ["first_name", "firstname", "fname"],
  last_name:      ["last_name", "lastname", "lname", "surname"],
  full_name:      ["full_name", "fullname", "name"],
  company:        ["company", "companyname", "organization", "account"],
  domain:         ["domain", "website", "companydomain", "company_domain", "url", "web"],
  job_title:      ["title", "job_title", "jobtitle", "position", "role"],
  phone:          ["phone", "phonenumber", "mobile", "tel"],
  deal_stage:     ["deal_stage", "dealstage"],
  source:         ["source", "leadsource", "lead_source"],
  linkedin_url:   ["linkedin_url", "linkedin", "linkedinurl"],
  notes:          ["notes", "note", "comment", "description"],
  seniority:      ["seniority", "senioritylevel", "level"],
  department:     ["department", "dept", "team"],
  pipeline_stage: ["pipeline_stage", "pipelinestage", "pipeline"],
};

export function detectImportMappings(headers: string[]): Record<string, string> {
  const used = new Set<string>();
  const map: Record<string, string> = {};
  for (const h of headers) {
    const lh = h.toLowerCase().replace(/[-_\s]/g, "");
    for (const [field, aliases] of Object.entries(IMPORT_AUTO_MATCH)) {
      if (!used.has(field) && aliases.some(a => lh === a)) { map[h] = field; used.add(field); break; }
    }
    if (map[h] === undefined) map[h] = "";
  }
  return map;
}

export const SOURCE_LABELS: Record<string, string> = {
  gmail: "Gmail", smtp: "Email (SMTP)", linkedin: "LinkedIn",
  instantly: "Instantly", slack: "Slack",
};

// ── Importer body (state machine, no chrome) ───────────────────────────────

interface PeopleImportProps {
  workspaceId: string;
  token: string;
  onClose: () => void;
  onDone: () => void;
  /** When true, parses CSV client-side but skips the real /api/contacts/import call. */
  testMode?: boolean;
}

function useImportState({ workspaceId, token, onClose, onDone, testMode }: PeopleImportProps) {
  const [step, setStep] = useState<"upload" | "mapping" | "scanning">("upload");
  const [dragOver, setDragOver] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvSampleRow, setCsvSampleRow] = useState<Record<string, string>>({});
  const [csvAllRows, setCsvAllRows] = useState<Record<string, string>[]>([]);
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; updated: number } | null>(null);
  const [enrichJobId, setEnrichJobId] = useState<string | null>(null);
  const [enrichProgress, setEnrichProgress] = useState<{ contacts: any[]; done: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step !== "scanning" || !enrichJobId || !token || testMode) return;
    const poll = async () => {
      try {
        const r = await fetch(`${apiUrl}/api/contacts/enrich-progress/${enrichJobId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return;
        const d = await r.json();
        if (d.found) setEnrichProgress({ contacts: d.contacts, done: d.done });
      } catch { /* silent */ }
    };
    poll();
    const id = setInterval(poll, 1500);
    return () => clearInterval(id);
  }, [step, enrichJobId, token, testMode]);

  const parseCSVFile = async (file: File) => {
    try {
      const text = await file.text();
      const lines = text.replace(/^﻿/, "").trim().split(/\r?\n/);
      if (lines.length < 2) { toast.error("CSV is empty or has no data rows"); return; }
      const headers = parseCSVLine(lines[0]);
      const rows = lines.slice(1).map(line => {
        const vals = parseCSVLine(line);
        const row: Record<string, string> = {};
        headers.forEach((h, i) => { row[h] = vals[i]?.trim() || ""; });
        return row;
      }).filter(r => Object.values(r).some(v => v));
      setCsvHeaders(headers); setCsvAllRows(rows);
      setCsvSampleRow(rows[0] || {}); setFieldMappings(detectImportMappings(headers));
      setStep("mapping");
    } catch { toast.error("Failed to parse CSV"); }
  };

  const runImport = async () => {
    setImporting(true);
    try {
      const rows = csvAllRows.map(row => {
        const mapped: Record<string, string> = {};
        for (const [col, field] of Object.entries(fieldMappings)) {
          if (field && row[col]) mapped[field] = row[col];
        }
        if (mapped.full_name && !mapped.first_name && !mapped.last_name) {
          const parts = mapped.full_name.trim().split(/\s+/);
          mapped.first_name = parts[0] || "";
          mapped.last_name = parts.slice(1).join(" ") || "";
          delete mapped.full_name;
        }
        return mapped;
      }).filter(r => r.email || r.linkedin_url);

      if (!rows.length) {
        toast.error("No rows with a mapped Email or LinkedIn URL — please map at least one column");
        return;
      }

      if (testMode) {
        await new Promise(r => setTimeout(r, 500));
        setImportResult({ created: rows.length, updated: 0 });
        setEnrichProgress({ contacts: [], done: true });
        setStep("scanning");
        return;
      }

      const res = await fetch(`${apiUrl}/api/contacts/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setImportResult({ created: data.created || 0, updated: data.updated || 0 });

      if (data.jobId) {
        setEnrichJobId(data.jobId);
        setEnrichProgress(null);
        setStep("scanning");
      } else {
        toast.success(data.created > 0 ? `${data.created} contacts imported` : `${data.updated} contacts updated`);
        onDone();
      }
    } catch (err: any) {
      toast.error(err.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return {
    step, setStep, dragOver, setDragOver, csvHeaders, csvSampleRow, csvAllRows,
    fieldMappings, setFieldMappings, importing, importResult, enrichProgress,
    fileRef, parseCSVFile, runImport, onClose, onDone,
  };
}

function ImportBody(s: ReturnType<typeof useImportState>) {
  if (s.step === "scanning") {
    return (
      <div className="px-6 py-5">
        <div className="flex items-center gap-2 mb-4">
          {s.enrichProgress?.done
            ? <Check className="h-3.5 w-3.5 text-emerald-500" />
            : <RefreshCw className="h-3.5 w-3.5 animate-spin text-violet-400" />}
          <span className="text-[12px] text-foreground/80">
            {s.enrichProgress?.done ? "Scan complete" : "Scanning contact history…"}
          </span>
          {s.importResult && (
            <span className="text-[10px] text-muted-foreground/40 ml-auto">
              {s.importResult.created} new · {s.importResult.updated} updated
            </span>
          )}
        </div>

        <div className="space-y-2 max-h-[55vh] overflow-y-auto">
          {(s.enrichProgress?.contacts ?? []).map((contact: any) => {
            const entries = Object.entries(contact.sources as Record<string, { status: string; count: number }>);
            const active = entries.filter(([, val]) => val.status !== "skipped");
            const allSkipped = active.length === 0;
            return (
              <div key={contact.id} className="border border-border/20 px-4 py-3">
                <div className="text-[11px] text-foreground/70 mb-2">
                  {contact.name}
                  {contact.email && <span className="text-muted-foreground/35 ml-2">{contact.email}</span>}
                </div>
                {allSkipped ? (
                  <div className="text-[9px] text-muted-foreground/25 italic">no integrations connected</div>
                ) : (
                  <div className="space-y-1">
                    {active.map(([src, val]) => (
                      <div key={src} className="flex items-center justify-between">
                        <span className="text-[9px] text-muted-foreground/50">{SOURCE_LABELS[src] ?? src}</span>
                        {val.status === "pending" && <span className="text-[9px] text-muted-foreground/25">waiting…</span>}
                        {val.status === "scanning" && (
                          <span className="flex items-center gap-1 text-[9px] text-violet-400/70">
                            <span className="w-1 h-1 rounded-full bg-violet-400 animate-pulse" />scanning…
                          </span>
                        )}
                        {val.status === "done" && val.count > 0 && (
                          <span className="flex items-center gap-1 text-[9px] text-emerald-500/70">
                            <Check className="h-2.5 w-2.5" />{val.count} found
                          </span>
                        )}
                        {val.status === "done" && val.count === 0 && (
                          <span className="text-[9px] text-muted-foreground/20">—</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {s.enrichProgress?.done && (s.enrichProgress.contacts?.length ?? 0) === 0 && (
            <div className="mt-3 text-[9px] text-muted-foreground/35 text-center">
              Connect Gmail, LinkedIn, or other integrations to scan contact history automatically.
            </div>
          )}
          {!s.enrichProgress && (
            <div className="flex justify-center py-8">
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground/20" />
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-border/20">
          <button
            disabled={!s.enrichProgress?.done}
            onClick={() => { s.onDone(); s.onClose(); }}
            className="w-full text-[10px] px-4 py-2 bg-violet-500/20 border border-violet-500/30 text-violet-400/80 hover:bg-violet-500/30 transition-colors disabled:opacity-30"
          >
            {s.enrichProgress?.done ? "done — close" : "scanning…"}
          </button>
        </div>
      </div>
    );
  }

  if (s.step === "upload") {
    return (
      <div className="px-6 py-5">
        <div
          onDragOver={e => { e.preventDefault(); s.setDragOver(true); }}
          onDragLeave={() => s.setDragOver(false)}
          onDrop={e => {
            e.preventDefault(); s.setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f?.name.endsWith(".csv")) s.parseCSVFile(f); else toast.error("Please drop a .csv file");
          }}
          onClick={() => s.fileRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-3 h-36 border border-dashed cursor-pointer transition-colors select-none ${
            s.dragOver ? "border-violet-500/60 bg-violet-500/5" : "border-border/40 hover:border-border/70 hover:bg-muted/10"
          }`}
        >
          <FileText className="h-5 w-5 text-muted-foreground/30" />
          <div className="text-center">
            <p className="text-[11px] text-foreground/60">
              drop a .csv or <span className="text-violet-400">click to upload</span>
            </p>
            <p className="text-[9px] text-muted-foreground/30 mt-0.5">column mapping in next step</p>
          </div>
        </div>
        <input
          ref={s.fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) s.parseCSVFile(f); }}
        />
      </div>
    );
  }

  // mapping
  return (
    <div>
      <div className="overflow-y-auto" style={{ maxHeight: "60vh" }}>
        <div className="flex items-center px-5 py-2 border-b border-border/20 bg-muted/10">
          <span className="text-[9px] text-muted-foreground/35 tracking-widest flex-1">CSV COLUMN</span>
          <span className="text-[9px] text-muted-foreground/35 tracking-widest" style={{ width: 170 }}>MAPS TO</span>
          <span className="text-[9px] text-muted-foreground/35 tracking-widest flex-1 pl-4">SAMPLE</span>
        </div>
        {s.csvHeaders.map(col => (
          <div key={col} className="flex items-center px-5 py-2.5 border-b border-border/10">
            <span className="text-[11px] text-foreground/70 flex-1 truncate pr-2">{col}</span>
            <select
              value={s.fieldMappings[col] || ""}
              onChange={e => s.setFieldMappings(p => ({ ...p, [col]: e.target.value }))}
              className="bg-background border border-border/40 text-[10px] text-foreground/65 px-2 py-1.5 outline-none hover:border-border focus:border-violet-500/50 transition-colors flex-shrink-0"
              style={{ width: 170 }}
            >
              <option value="">— skip —</option>
              {IMPORT_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <span className="text-[10px] text-violet-400/70 flex-1 truncate pl-4">{s.csvSampleRow[col] || "—"}</span>
          </div>
        ))}
      </div>
      <div className="px-5 py-3 border-t border-border/20 flex items-center justify-between">
        <button onClick={() => s.setStep("upload")} className="text-[10px] text-muted-foreground/40 hover:text-foreground/60 transition-colors">← back</button>
        <div className="flex items-center gap-3">
          <span className="text-[9px] text-muted-foreground/30">{s.csvAllRows.length} rows</span>
          <button
            onClick={s.runImport}
            disabled={s.importing}
            className="flex items-center gap-2 text-[10px] px-4 py-1.5 bg-violet-500/20 border border-violet-500/30 text-violet-400/80 hover:bg-violet-500/30 transition-colors disabled:opacity-40"
          >
            {s.importing ? <><RefreshCw className="h-3 w-3 animate-spin" />importing…</> : "import people"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Embeddable panel — no backdrop, no breadcrumb. Caller wraps it however.
export function PeopleImportPanel(props: PeopleImportProps) {
  const state = useImportState(props);
  return <ImportBody {...state} />;
}

// Full modal — backdrop + breadcrumb + panel. Drop-in replacement for the old inline version.
export function PeopleImportModal(props: PeopleImportProps) {
  const state = useImportState(props);
  const maxWidth = state.step === "mapping" ? 580 : state.step === "scanning" ? 480 : 400;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={state.step === "scanning" ? undefined : props.onClose}
    >
      <div
        className="bg-background border border-border shadow-2xl w-full mx-4"
        style={{ maxWidth, ...MONO }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/40 flex-shrink-0">
          <span className="text-[9px] text-muted-foreground/40 tracking-widest">
            NOUS / MIND / PEOPLE / IMPORT
          </span>
          <button
            onClick={props.onClose}
            className="text-muted-foreground/40 hover:text-foreground/70 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <ImportBody {...state} />
      </div>
    </div>
  );
}

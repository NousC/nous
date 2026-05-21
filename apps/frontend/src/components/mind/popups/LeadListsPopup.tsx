import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { ArrowLeft, Plus, Upload, RefreshCw } from "lucide-react";
import { PopupModal } from "../shared";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

interface LeadList {
  id: string;
  name: string;
  source: string;
  lead_count?: number;
  created_at: string;
}

interface Lead {
  id: string;
  email: string | null;
  name: string | null;
  company: string | null;
  status: string;
  reply_outcome: string | null;
  scorecard_score: number | null;
  created_at: string;
}

interface Props {
  leadLists: LeadList[];
  workspaceId: string;
  token: string;
  onClose: () => void;
  onRefresh: () => void;
}

const SOURCES = ["csv", "linkedin", "instantly", "apollo"];
const IMPORT_CHUNK = 2000; // matches the API's per-request cap

// Parse pasted lines into lead rows. One lead per line: "email, name, company".
// The first field containing "@" is treated as the email.
function parseLeads(text: string) {
  return text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.split(/[,\t]/).map(p => p.trim()).filter(Boolean);
      const email = parts.find(p => p.includes("@")) ?? null;
      const rest = parts.filter(p => p !== email);
      return { email, name: rest[0] || null, company: rest[1] || null };
    })
    .filter(r => r.email);
}

// ─── Detail view — one list's leads, with an importer ─────────────────────────

function LeadListDetail({ list, workspaceId, token, onBack, onClose, onImported }: {
  list: LeadList; workspaceId: string; token: string;
  onBack: () => void; onClose: () => void; onImported: () => void;
}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`${apiUrl}/api/lead-lists/${list.id}/leads?workspaceId=${workspaceId}&limit=500`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : { leads: [] }))
      .then(d => { setLeads(d.leads ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [list.id, workspaceId, token]);

  useEffect(() => { load(); }, [load]);

  const doImport = async () => {
    const parsed = parseLeads(raw);
    if (parsed.length === 0 || busy) return;
    setBusy(true);
    setResult(null);
    try {
      let inserted = 0, skipped = 0;
      for (let i = 0; i < parsed.length; i += IMPORT_CHUNK) {
        const chunk = parsed.slice(i, i + IMPORT_CHUNK);
        const res = await fetch(`${apiUrl}/api/lead-lists/${list.id}/leads`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ workspaceId, leads: chunk }),
        });
        if (res.ok) {
          const d = await res.json();
          inserted += d.inserted ?? 0;
          skipped += d.skipped ?? 0;
        }
      }
      setResult({ inserted, skipped });
      setRaw("");
      load();
      onImported();
    } catch { /* silent */ }
    finally { setBusy(false); }
  };

  return (
    <PopupModal label={`NOUS / MIND / LEAD LISTS / ${list.name.toUpperCase()}`} onClose={onClose}>
      <div className="px-5 py-3 border-b border-border/20 flex items-center gap-3">
        <button onClick={onBack} className="text-muted-foreground/40 hover:text-foreground/70 transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-[11px] text-foreground/75">{list.name}</span>
        <span className="text-[9px] text-muted-foreground/35 uppercase tracking-wide">{list.source}</span>
        <button onClick={() => setImporting(v => !v)}
          className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground/40 hover:text-foreground/70 transition-colors">
          import leads <Upload className="h-2.5 w-2.5" />
        </button>
      </div>

      {importing && (
        <div className="px-5 py-3 border-b border-border/20 space-y-2">
          <p className="text-[9px] text-muted-foreground/35">
            One lead per line — <span className="text-foreground/50">email, name, company</span>. Email required.
          </p>
          <textarea value={raw} onChange={e => setRaw(e.target.value)} rows={6}
            placeholder={"jane@acme.com, Jane Doe, Acme\njohn@globex.com, John Smith, Globex"}
            className="w-full bg-muted/20 border border-border/40 text-[11px] text-foreground px-3 py-2 outline-none resize-none placeholder:text-muted-foreground/25 leading-relaxed focus:border-violet-500/40" />
          <div className="flex items-center gap-3">
            <button onClick={doImport} disabled={busy || !raw.trim()}
              className="flex items-center gap-1 text-[10px] px-3 py-1 bg-violet-500/20 border border-violet-500/30 text-violet-400/80 hover:bg-violet-500/30 transition-colors disabled:opacity-30">
              {busy ? <><RefreshCw className="h-3 w-3 animate-spin" />importing…</> : "import"}
            </button>
            {result && (
              <span className="text-[10px] text-emerald-500/70">
                {result.inserted} added{result.skipped ? ` · ${result.skipped} skipped` : ""}
              </span>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="px-5 py-10 text-[11px] text-muted-foreground/30 text-center">loading…</div>
      ) : leads.length === 0 ? (
        <div className="px-5 py-10 text-[11px] text-muted-foreground/30 text-center">no leads — import some above</div>
      ) : (
        <div className="divide-y divide-border/10">
          {leads.map(l => (
            <div key={l.id} className="flex items-center gap-3 px-5 py-2.5">
              <span className="text-[11px] text-foreground/70 flex-1 truncate">{l.name || l.email || "—"}</span>
              <span className="text-[9px] text-muted-foreground/40 flex-1 truncate">{l.email}</span>
              <span className="text-[9px] text-muted-foreground/35 w-24 truncate">{l.company || ""}</span>
              <span className="text-[8px] uppercase tracking-wide w-16 text-right"
                style={{ color: l.reply_outcome ? "#4ade80" : "#9ca3af" }}>
                {l.reply_outcome || l.status}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-border/20 px-5 py-2.5 text-[9px] text-muted-foreground/30">
        {leads.length} lead{leads.length !== 1 ? "s" : ""}
      </div>
    </PopupModal>
  );
}

// ─── List view ────────────────────────────────────────────────────────────────

export default function LeadListsPopup({ leadLists, workspaceId, token, onClose, onRefresh }: Props) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSource, setNewSource] = useState("csv");
  const [busy, setBusy] = useState(false);

  const detail = detailId ? leadLists.find(l => l.id === detailId) ?? null : null;

  const createList = async () => {
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      await fetch(`${apiUrl}/api/lead-lists`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, name: newName.trim(), source: newSource }),
      });
      setNewName("");
      setCreating(false);
      onRefresh();
    } catch { /* silent */ }
    finally { setBusy(false); }
  };

  if (detail) {
    return (
      <LeadListDetail list={detail} workspaceId={workspaceId} token={token}
        onBack={() => setDetailId(null)} onClose={onClose} onImported={onRefresh} />
    );
  }

  return (
    <PopupModal label="NOUS / MIND / LEAD LISTS" onClose={onClose}>
      <div className="divide-y divide-border/10">
        {leadLists.map(l => (
          <button key={l.id} onClick={() => setDetailId(l.id)}
            className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-muted/20 transition-colors">
            <span className="text-[11px] text-foreground/75 flex-1 truncate">{l.name}</span>
            <span className="text-[9px] text-muted-foreground/35 uppercase tracking-wide">{l.source}</span>
            <span className="text-[10px] text-muted-foreground/50 tabular-nums w-20 text-right">{l.lead_count ?? 0} leads</span>
            <span className="text-[8px] text-muted-foreground/25 w-14 text-right">{format(new Date(l.created_at), "MMM d")}</span>
          </button>
        ))}
        {leadLists.length === 0 && (
          <div className="px-5 py-10 text-[11px] text-muted-foreground/30 text-center">no lead lists yet</div>
        )}
      </div>

      {creating && (
        <div className="border-t border-border/20 px-5 py-3 space-y-2">
          <input value={newName} onChange={e => setNewName(e.target.value)} autoFocus
            placeholder="list name…" onKeyDown={e => { if (e.key === "Enter") createList(); }}
            className="w-full bg-muted/20 border border-border/40 text-[11px] text-foreground px-3 py-1.5 outline-none focus:border-violet-500/40" />
          <div className="flex items-center gap-2">
            <select value={newSource} onChange={e => setNewSource(e.target.value)}
              className="bg-muted/20 border border-border/40 text-[10px] text-foreground/70 px-2 py-1 outline-none">
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={createList} disabled={!newName.trim() || busy}
              className="text-[10px] px-3 py-1 bg-violet-500/20 border border-violet-500/30 text-violet-400/80 hover:bg-violet-500/30 transition-colors disabled:opacity-30">
              create
            </button>
            <button onClick={() => { setCreating(false); setNewName(""); }}
              className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
              cancel
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-border/20 px-5 py-2.5 flex justify-between items-center text-[9px] text-muted-foreground/30">
        <span>{leadLists.length} list{leadLists.length !== 1 ? "s" : ""}</span>
        {!creating && (
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-1 hover:text-muted-foreground/60 transition-colors">
            new list <Plus className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    </PopupModal>
  );
}

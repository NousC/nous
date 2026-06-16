import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Linkedin, Trash2, RefreshCw, Search, Download, Upload, FileText } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { relTime, eventTime } from "@/components/mind/shared";
import { PeopleImportModal } from "@/components/contacts/PeopleImportModal";
import { ContactInfo, healthColor, stageColor, ActivityIcon, mapContact } from "@/components/mind/entities";
import { useColumnWidths, ColResizer } from "@/components/mind/resizableColumns";
import { PageHeader } from "@/components/ui/page-header";

const apiUrl = import.meta.env.VITE_API_URL ?? "";
const PAGE_SIZE = 50;
const PIPELINE_STAGES = ["identified", "aware", "connected", "interested", "evaluating", "client"];

// Default widths for the resizable columns. "Last Int." is the elastic flex-1
// column and the action "Enrich" cell is fixed, so neither is listed here.
// Persisted per user in localStorage; see useColumnWidths.
const PEOPLE_COL_DEFAULTS: Record<string, number> = {
  name: 170, company: 115, domain: 100, li: 40, stage: 88,
  icp: 42, deal: 88, segment: 72, health: 60, lastActivity: 120,
};
const PEOPLE_COL_KEYS = ["name","company","domain","li","stage","icp","deal","segment","health","lastActivity"];

type DetailTab = "activity" | "emails" | "linkedin" | "slack" | "calls" | "notes" | "signals" | "company" | "memory";

// ─── PeopleDetail — tabbed contact record ────────────────────────────────────

function PeopleDetail({ contact, token, onBack }: { contact: ContactInfo; token: string; onBack: () => void }) {
  const [tab, setTab] = useState<DetailTab>("activity");
  const [loading, setLoading] = useState(true);
  const [acts, setActs] = useState<any[]>([]);
  const [mems, setMems] = useState<any[]>([]);
  const [signals, setSignals] = useState<any[]>([]);
  const [raw, setRaw] = useState<any>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [localOverrides, setLocalOverrides] = useState<Record<string, string | null>>({});
  const [lostMarking, setLostMarking] = useState(false);
  const [lostMarked, setLostMarked] = useState(false);

  // Record an explicit closed-lost — a real negative the Mind learns from,
  // unlike a contact that simply goes quiet.
  const markLost = async () => {
    if (lostMarking || lostMarked) return;
    if (!window.confirm("Mark this account as closed-lost? It teaches the scoring model from a real loss.")) return;
    setLostMarking(true);
    try {
      await fetch(`${apiUrl}/api/contacts/${contact.id}/mark-lost`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      setLostMarked(true);
    } catch { /* silent */ }
    finally { setLostMarking(false); }
  };

  useEffect(() => {
    setLoading(true);
    fetch(`${apiUrl}/api/contacts/${contact.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setActs((d.activities ?? []).filter((a: any) => a.activity_type !== 'icp_scored')); setMems(d.memories ?? []); setSignals(d.signals ?? []); setRaw(d.contact ?? null); } setLoading(false); })
      .catch(() => setLoading(false));
  }, [contact.id, token]);

  const patchContact = async (patchKey: string, value: string) => {
    setSaving(true);
    try {
      await fetch(`${apiUrl}/api/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [patchKey]: value || null }),
      });
      setLocalOverrides(prev => ({ ...prev, [patchKey]: value || null }));
    } catch { /* silent */ }
    finally { setSaving(false); setEditingField(null); }
  };

  const startEdit = (key: string, current: string | null) => {
    setEditingField(key); setEditValue(current ?? "");
  };

  const get = (patchKey: string, fallback: string | null | undefined) =>
    patchKey in localOverrides ? localOverrides[patchKey] : (fallback ?? null);

  const emails  = acts.filter(a => a.source === "gmail" || ["email_sent","email_opened","email_reply","email_bounced"].some(t => a.activity_type?.includes(t)));
  const linkedin = acts.filter(a => a.source === "linkedin" || a.activity_type?.includes("linkedin"));
  const slack   = acts.filter(a => a.source === "slack"    || a.activity_type?.includes("slack"));
  const calls   = acts.filter(a => ["call","meeting"].some(t => a.activity_type?.includes(t)));
  // Documents (meeting briefs, transcripts, notes) live in the notes layer with a
  // doc_type; plain atomic facts are the rest. Documents → Notes tab, facts → Facts.
  const documents = mems.filter((m: any) => m.metadata?.doc_type);
  const facts     = mems.filter((m: any) => !m.metadata?.doc_type);
  // `signals` come from d.signals (signal.* claims) — see fetch above.

  const TABS: { id: DetailTab; label: string; count?: number }[] = [
    { id:"activity",  label:"Activity",  count: acts.length    },
    { id:"emails",    label:"Emails",    count: emails.length  },
    { id:"linkedin",  label:"LinkedIn",  count: linkedin.length },
    { id:"slack",     label:"Slack",     count: slack.length   },
    { id:"calls",     label:"Calls",     count: calls.length   },
    { id:"notes",     label:"Notes",     count: documents.length },
    { id:"signals",   label:"Signals",   count: signals.length },
    { id:"company",   label:"Company"                          },
    { id:"memory",    label:"Facts",     count: facts.length   },
  ];

  const tabItems = tab==="activity" ? acts : tab==="emails" ? emails : tab==="linkedin" ? linkedin : tab==="slack" ? slack : tab==="calls" ? calls : [];

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex-shrink-0 px-8 pt-7 pb-0">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={onBack}
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors flex-shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-[20px] font-semibold tracking-tight text-foreground">{contact.name}</h1>
        </div>
        <div className="flex items-center gap-2 pl-11 mb-4 flex-wrap">
          {contact.email && <span className="text-[13px] text-muted-foreground">{contact.email}</span>}
          {contact.lastActivityAt && <span className="text-[12px] text-muted-foreground/70">· {relTime(contact.lastActivityAt)}</span>}
        </div>
        <div className="flex gap-6 border-b border-border overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 pb-2.5 text-[13px] font-medium transition-colors flex-shrink-0 ${
                tab===t.id ? "text-foreground border-b-2 border-foreground -mb-px" : "text-muted-foreground/70 hover:text-foreground/80"
              }`}>
              {t.label}
              {t.count !== undefined && <span className={`text-[11px] ${tab===t.id ? "text-muted-foreground/70" : "text-muted-foreground/50"}`}>{t.count}</span>}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-[13px] text-muted-foreground/70">Loading…</div>
      ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Main content */}
          <div className="flex-1 overflow-y-auto px-8 py-4">
            {(tab !== "company" && tab !== "memory" && tab !== "notes" && tab !== "signals") && (
              tabItems.length === 0
                ? <p className="text-[13px] text-muted-foreground/70 py-12 text-center">Nothing here yet</p>
                : <div className="divide-y divide-border/60">
                    {tabItems.map((a: any) => {
                      const body = a.subtitle || a.raw_data?.text || a.raw_data?.body || null;
                      const title = a.title || a.activity_type?.replace(/_/g," ").toLowerCase();
                      // A held call carries its full AI summary — that belongs in the Notes
                      // document, not as a wall of text in the timeline. Keep the activity to a
                      // one-line gist and link to the full write-up. Everything else clamps to
                      // 3 lines so the feed stays scannable.
                      const isCall = a.activity_type === "meeting_held" || a.activity_type === "call_held";
                      return (
                        <div key={a.id} className="py-3">
                          <div className="flex items-center gap-2.5 mb-1.5">
                            <ActivityIcon source={a.source} type={a.activity_type || ""} />
                            <span className="text-[13px] font-medium text-foreground flex-1 truncate">
                              {title}
                            </span>
                            <span className="text-[12px] text-muted-foreground/70 tabular-nums flex-shrink-0">{eventTime(a.created_at || a.occurred_at, a.activity_type)}</span>
                          </div>
                          {body && (
                            <p className={`text-[13px] text-muted-foreground leading-relaxed pl-[26px] ${isCall ? "line-clamp-1" : "line-clamp-3"}`}>{body}</p>
                          )}
                          {isCall && (
                            <button
                              onClick={() => setTab("notes")}
                              className="pl-[26px] mt-1 inline-flex items-center gap-1 text-[12px] text-muted-foreground/70 hover:text-foreground transition-colors"
                            >
                              <FileText className="h-3 w-3" /> Meeting notes
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
            )}
            {tab === "company" && (
              <div className="py-4 space-y-1">
                <div className="text-[15px] font-semibold text-foreground">{contact.companyName ?? raw?.company ?? "—"}</div>
                {(contact.domain ?? raw?.domain) && <div className="text-[13px] text-muted-foreground">{contact.domain ?? raw?.domain}</div>}
              </div>
            )}
            {tab === "notes" && (
              documents.length === 0
                ? <p className="text-[13px] text-muted-foreground/70 py-12 text-center">No notes or documents yet</p>
                : <div className="divide-y divide-border/60">
                    {documents.map((m: any) => {
                      const when = m.metadata?.date || m.created_at;
                      const text = String(m.content || "").replace(/\s+/g, " ").trim();
                      const long = text.length > 220;
                      return (
                        <div key={m.id} className="py-3 flex items-start gap-2.5">
                          <FileText className="h-4 w-4 text-muted-foreground/60 flex-shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2">
                              <span className="text-[13px] font-medium text-foreground/85 truncate">{m.metadata?.title || m.category}</span>
                              <span className="text-[12px] text-muted-foreground/70 ml-auto flex-shrink-0">{relTime(when)}</span>
                            </div>
                            <p className="text-[13px] text-muted-foreground leading-relaxed line-clamp-2 mt-0.5">{long ? text.slice(0, 220) + "…" : text}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
            )}
            {tab === "memory" && (
              facts.length === 0
                ? <p className="text-[13px] text-muted-foreground/70 py-12 text-center">No facts yet</p>
                : <div className="divide-y divide-border/60">
                    {facts.map((m: any) => (
                      <div key={m.id} className="py-3">
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 capitalize">{m.category?.toLowerCase()}</span>
                          <span className="text-[12px] text-muted-foreground/70 ml-auto">{relTime(m.created_at)}</span>
                        </div>
                        <p className="text-[13px] text-foreground/80 leading-relaxed">{m.content}</p>
                      </div>
                    ))}
                  </div>
            )}
            {tab === "signals" && (
              signals.length === 0
                ? <p className="text-[13px] text-muted-foreground/70 py-12 text-center">No signals yet — run signal-scan on this account</p>
                : <div className="divide-y divide-border/60">
                    {signals.map((s: any) => {
                      const col = s.score == null ? "#6b7280" : s.score >= 8 ? "#15803d" : s.score >= 5 ? "#b45309" : "#6b7280";
                      return (
                        <div key={s.signal_class} className="py-3">
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 capitalize">{s.signal_class}</span>
                            {s.score != null && <span className="text-[12px] font-semibold tabular-nums" style={{ color: col }}>{s.score}/10</span>}
                            {s.updated_at && <span className="text-[12px] text-muted-foreground/70 ml-auto">{relTime(s.updated_at)}</span>}
                          </div>
                          <p className="text-[13px] text-foreground/80 leading-relaxed">{s.detected}{s.implies ? ` — ${s.implies}` : ""}</p>
                          {s.angle && <p className="text-[12px] text-muted-foreground italic mt-1">Angle: {s.angle}</p>}
                        </div>
                      );
                    })}
                  </div>
            )}
          </div>

          {/* Record Details sidebar — editable */}
          <div className="w-64 flex-shrink-0 border-l border-border px-5 py-5 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Record Details</span>
              {saving && <span className="text-[11px] text-muted-foreground/70">saving…</span>}
            </div>
            {/* ICP score — read-only, computed by the Scorecard */}
            {(() => {
              const sc = contact.icpScore;
              const fit = sc == null ? null : sc >= 75 ? "Strong fit" : sc >= 50 ? "Potential fit" : "Weak fit";
              const col = sc == null ? "#9ca3af" : sc >= 75 ? "#15803d" : sc >= 50 ? "#b45309" : "#6b7280";
              return (
                <div className="mb-4 pb-3.5 border-b border-border/60">
                  <div className="text-[11px] font-medium text-muted-foreground/70 mb-1">ICP Score</div>
                  {sc == null ? (
                    <div className="text-[13px] text-muted-foreground/50 italic">Not scored yet</div>
                  ) : (
                    <div className="flex items-baseline gap-2">
                      <span className="text-[22px] font-semibold tabular-nums leading-none" style={{ color: col }}>{sc}</span>
                      <span className="text-[12px] text-muted-foreground/70">/ 100 · {fit}</span>
                    </div>
                  )}
                </div>
              );
            })()}
            <div className="space-y-3.5">
              {([
                { label:"First Name",     key:"firstName",      val: get("firstName",      raw?.first_name)                },
                { label:"Last Name",      key:"lastName",       val: get("lastName",       raw?.last_name)                 },
                { label:"Email",          key:"email",          val: get("email",          contact.email)                  },
                { label:"Phone",          key:"phone",          val: get("phone",          contact.phone)                  },
                { label:"Job Title",      key:"jobTitle",       val: get("jobTitle",       raw?.job_title ?? contact.title) },
                { label:"Company",        key:"company",        val: get("company",        contact.companyName??raw?.company)},
                { label:"LinkedIn",       key:"linkedinUrl",    val: get("linkedinUrl",    contact.linkedinUrl)            },
                { label:"Pipeline Stage", key:"pipeline_stage", val: get("pipeline_stage", contact.pipelineStage), type:"select", opts: PIPELINE_STAGES },
                { label:"Deal Stage",     key:"dealStage",      val: get("dealStage",      contact.dealStage??raw?.deal_stage)},
                { label:"Deal Value",     key:"dealValue",      val: get("dealValue",      contact.dealValue!=null?String(contact.dealValue):null), type:"number" },
                { label:"Lead Source",    key:"lead_source",    val: get("lead_source",    contact.source??raw?.lead_source)},
                { label:"Industry",       key:"industry",       val: get("industry",       raw?.industry)                  },
                { label:"Department",     key:"department",     val: get("department",     raw?.department ?? contact.department) },
                { label:"Seniority",      key:"seniority",      val: get("seniority",      raw?.seniority ?? contact.seniority) },
                { label:"City",           key:"city",           val: get("city",           contact.city)                   },
                { label:"Country",        key:"country",        val: get("country",        contact.country)                },
                { label:"Notes",          key:"notes",          val: get("notes",          raw?.notes), type:"textarea"     },
              ] as { label:string; key:string; val:string|null; type?:string; opts?:string[] }[]).map(({ label, key, val, type, opts }) => {
                const isEditing = editingField === key;
                return (
                  <div key={key}>
                    <div className="text-[11px] font-medium text-muted-foreground/70 mb-1">{label}</div>
                    {isEditing ? (
                      type === "select" ? (
                        <select value={editValue} autoFocus
                          onChange={e => { setEditValue(e.target.value); patchContact(key, e.target.value); }}
                          className="w-full rounded-md border border-border bg-background text-[13px] text-foreground px-2 py-1 outline-none focus:border-foreground/40">
                          {opts?.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : type === "textarea" ? (
                        <textarea value={editValue} autoFocus rows={3}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={() => patchContact(key, editValue)}
                          onKeyDown={e => { if (e.key==="Escape") setEditingField(null); }}
                          className="w-full rounded-md border border-border bg-background text-[13px] text-foreground px-2 py-1 outline-none focus:border-foreground/40 resize-none leading-relaxed" />
                      ) : (
                        <input type={type==="number"?"number":"text"} value={editValue} autoFocus
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={() => patchContact(key, editValue)}
                          onKeyDown={e => { if (e.key==="Enter") patchContact(key, editValue); if (e.key==="Escape") setEditingField(null); }}
                          className="w-full rounded-md border border-border bg-background text-[13px] text-foreground px-2 py-1 outline-none focus:border-foreground/40" />
                      )
                    ) : (
                      <div onClick={() => startEdit(key, val)}
                        className={`text-[13px] leading-snug break-words cursor-pointer rounded-md px-1.5 -mx-1.5 py-1 transition-colors hover:bg-muted/50 ${val ? "text-foreground/80" : "text-muted-foreground/50 italic"}`}>
                        {val ?? "—"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              onClick={markLost}
              disabled={lostMarking || lostMarked}
              className="mt-5 w-full h-8 rounded-md border border-red-500/30 text-[12px] font-semibold text-red-600/90 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              title="Records a closed-lost so the scoring model learns from a real loss"
            >
              {lostMarked ? "Marked lost ✓" : lostMarking ? "Marking…" : "Mark as lost"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── People — standalone page ────────────────────────────────────────────────

export default function People({ embedded = false, leadingTab = null }: { embedded?: boolean; leadingTab?: React.ReactNode } = {}) {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";
  const { id } = useParams();
  const navigate = useNavigate();

  const [contacts, setContacts] = useState<ContactInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token || !workspaceId) return;
    try {
      const res = await fetch(`${apiUrl}/api/contacts?workspaceId=${workspaceId}&limit=2000`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res.ok ? await res.json() : {};
      setContacts((data.contacts ?? []).map(mapContact));
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [token, workspaceId]);

  useEffect(() => { load(); }, [load]);

  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [page, setPage] = useState(0);
  const [sortCol, setSortCol] = useState<"lastActivity"|"deal"|"icp"|null>(null);
  const [sortDir, setSortDir] = useState<"asc"|"desc">("asc");
  const { widths, startResize } = useColumnWidths("nous.people.colWidths", PEOPLE_COL_DEFAULTS);
  const colW = (c: string) => widths[c] ?? PEOPLE_COL_DEFAULTS[c];
  // Total content width (all columns + 78px enrich col + px-4 row padding) so the
  // table scrolls horizontally instead of squeezing columns into a fixed width.
  const ROW_MIN = PEOPLE_COL_KEYS.reduce((s,k)=>s+colW(k),0) + 78 + 32;
  const [showImport, setShowImport] = useState(false);
  const [enriching, setEnriching] = useState<Set<string>>(new Set());
  const [enriched, setEnriched] = useState<Set<string>>(new Set());
  const [enrichErr, setEnrichErr] = useState<Set<string>>(new Set());
  const stages = ["identified","aware","connected","interested","evaluating","client"];

  const detail = useMemo<ContactInfo | null>(
    () => id ? contacts.find(c => c.id === id) ?? null : null,
    [id, contacts]
  );
  const setDetail = (c: ContactInfo | null) => navigate(c ? `/people/${c.id}` : "/accounts?tab=people");

  const deleteContact = async (cid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setContacts(prev => prev.filter(c => c.id !== cid));
    fetch(`${apiUrl}/api/contacts/${cid}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  };

  const handleEnrich = async (c: ContactInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    if (enriching.has(c.id) || enriched.has(c.id)) return;
    setEnriching(prev => new Set(prev).add(c.id));
    setEnrichErr(prev => { const s = new Set(prev); s.delete(c.id); return s; });
    try {
      const res = await fetch(`${apiUrl}/api/contacts/${c.id}/enrich`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setEnriched(prev => new Set(prev).add(c.id));
        // Refresh so the new title/seniority/company + ICP score show without a
        // full page reload. A short second pass catches the async claim pipeline.
        load();
        setTimeout(() => load(), 2500);
      }
      else setEnrichErr(prev => new Set(prev).add(c.id));
    } catch { setEnrichErr(prev => new Set(prev).add(c.id)); }
    finally { setEnriching(prev => { const s = new Set(prev); s.delete(c.id); return s; }); }
  };

  // firstDir = the direction the first click applies. Cycle: off → firstDir →
  // opposite → off. ICP passes "desc" so the first click puts the best fits on top.
  const cycleSort = (col: "lastActivity"|"deal"|"icp", firstDir: "asc"|"desc" = "asc") => {
    if (sortCol !== col) { setSortCol(col); setSortDir(firstDir); }
    else if (sortDir === firstDir) setSortDir(firstDir === "asc" ? "desc" : "asc");
    else { setSortCol(null); setPage(0); }
  };

  const filtered = contacts.filter(c => {
    const qs = q.toLowerCase();
    return (!q || c.name.toLowerCase().includes(qs) || (c.email??"").toLowerCase().includes(qs) || (c.companyName??"").toLowerCase().includes(qs))
      && (!stage || c.pipelineStage === stage);
  });
  const sorted = [...filtered].sort((a,b) => {
    if (sortCol === "lastActivity") {
      const cmp = (a.lastActivityAt??"").localeCompare(b.lastActivityAt??"");
      return sortDir === "asc" ? cmp : -cmp;
    }
    if (sortCol === "deal") {
      const cmp = (a.dealStage??"").localeCompare(b.dealStage??"");
      return sortDir === "asc" ? cmp : -cmp;
    }
    if (sortCol === "icp") {
      // Unscored contacts sort to the bottom in either direction.
      const av = a.icpScore ?? -1, bv = b.icpScore ?? -1;
      return sortDir === "asc" ? av - bv : bv - av;
    }
    return (b.lastActivityAt??"").localeCompare(a.lastActivityAt??"");
  });
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSearch = (v: string) => { setQ(v); setPage(0); };
  const handleStage  = (s: string) => { setStage(p => p===s ? "" : s); setPage(0); };

  const handleExport = () => {
    const headers = ["Name","Email","Company","Pipeline Stage","Deal Stage","Segment","Health","ICP","Last Activity","LinkedIn"];
    const rows = contacts.map(c => [
      c.name, c.email??"", c.companyName??"", c.pipelineStage,
      c.dealStage??"", c.segmentLabel??"",
      c.dealHealthScore!=null?String(c.dealHealthScore):"",
      c.icpScore!=null?String(c.icpScore):"",
      c.lastActivityAt??"", c.linkedinUrl??""
    ]);
    const csv = [headers,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    const a = document.createElement("a"); a.href=url; a.download="contacts.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // Sortable + resizable header cell (fixed-width columns). The relative wrapper
  // anchors the drag handle to the cell's right edge; widthKey ties the width to
  // the persisted store (defaults to the sort column name).
  const SortBtn = ({ col, label, widthKey, firstDir = "asc" }: { col:"deal"|"icp"; label:string; widthKey?:string; firstDir?:"asc"|"desc" }) => {
    const wk = widthKey ?? col;
    return (
      <div className="relative flex items-center flex-shrink-0 overflow-hidden" style={{width: colW(wk)}}>
        <button onClick={() => { cycleSort(col, firstDir); setPage(0); }}
          className="w-full min-w-0 text-[11px] font-semibold uppercase tracking-wide flex items-center gap-0.5 group">
          <span className={`truncate min-w-0 ${sortCol===col ? "text-foreground/80" : "text-muted-foreground/70 group-hover:text-foreground/80 transition-colors"}`}>{label}</span>
          {sortCol===col && <span className="text-[10px] text-muted-foreground ml-0.5 flex-shrink-0">{sortDir==="asc"?"↑":"↓"}</span>}
        </button>
        <ColResizer onMouseDown={e=>startResize(wk, e)} />
      </div>
    );
  };

  // Sortable "Last Int." header — a fixed-width, resizable column like the rest
  // (it used to be flex-1 and absorb all slack, which squeezed other columns).
  const SortBtnFlex = ({ col, label, firstDir = "asc" }: { col:"lastActivity"; label:string; firstDir?:"asc"|"desc" }) => (
    <div className="relative flex items-center flex-shrink-0 overflow-hidden" style={{width: colW("lastActivity")}}>
      <button onClick={() => { cycleSort(col, firstDir); setPage(0); }}
        className="w-full min-w-0 text-[11px] font-semibold uppercase tracking-wide flex items-center gap-0.5 group text-left">
        <span className={`truncate min-w-0 ${sortCol===col ? "text-foreground/80" : "text-muted-foreground/70 group-hover:text-foreground/80 transition-colors"}`}>{label}</span>
        {sortCol===col && <span className="text-[10px] text-muted-foreground ml-0.5 flex-shrink-0">{sortDir==="asc"?"↑":"↓"}</span>}
      </button>
      <ColResizer onMouseDown={e=>startResize("lastActivity", e)} />
    </div>
  );

  // Static (non-sortable) but still resizable header cell.
  const PlainHdr = ({ label, widthKey }: { label:string; widthKey:string }) => (
    <div className="relative flex items-center flex-shrink-0 overflow-hidden" style={{width: colW(widthKey)}}>
      <span className="w-full min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</span>
      <ColResizer onMouseDown={e=>startResize(widthKey, e)} />
    </div>
  );

  // When the route carries an id we're in detail mode — render the record (or a
  // brief loader while the contact resolves), never the list. Avoids flashing the
  // table for a moment before the detail appears.
  if (id) {
    return (
      <div className="h-full bg-background">
        {detail
          ? <PeopleDetail contact={detail} token={token} onBack={() => setDetail(null)} />
          : <div className="h-full flex items-center justify-center text-[13px] text-muted-foreground/70">Loading…</div>}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {showImport && <PeopleImportModal workspaceId={workspaceId} token={token} onClose={()=>setShowImport(false)} onDone={()=>{ setShowImport(false); load(); }}/>}
      <div className="px-8 pt-7 flex-shrink-0">
        <PageHeader
          title={embedded ? "Accounts" : "People"}
          actions={
            <>
              <button onClick={handleExport}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors">
                <Download className="h-3.5 w-3.5" /> Export
              </button>
              <button onClick={() => setShowImport(true)}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors">
                <Upload className="h-3.5 w-3.5" /> Import
              </button>
            </>
          }
        />

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {leadingTab}
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70 pointer-events-none" />
              <input value={q} onChange={e=>handleSearch(e.target.value)} placeholder="Search people…" autoFocus
                className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground/70 focus:border-foreground/40 outline-none" />
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {stages.map(s => (
              <button key={s} onClick={() => handleStage(s)}
                className={`text-[12px] px-2.5 py-1 rounded-md border transition-colors capitalize ${stage===s ? "text-foreground border-foreground bg-muted/50 font-medium" : "text-muted-foreground border-border hover:border-foreground/40"}`}>
                {s}
              </button>
            ))}
            <span className="text-[12px] text-muted-foreground/70 ml-1 tabular-nums">{sorted.length} of {contacts.length}</span>
          </div>
        </div>
      </div>

      {/* Table — full-bleed, fills to the right and bottom (left padding kept) */}
      <div className="flex-1 min-h-0 pl-8 flex flex-col">
        <div className="flex-1 min-h-0 border-t border-l border-border overflow-auto">
          <div style={{ minWidth: ROW_MIN }}>
          {/* Table header — sticky top; Name frozen left */}
          <div className="flex items-center px-4 py-2.5 bg-muted/50 border-b border-border sticky top-0 z-20">
            <div className="relative flex items-center flex-shrink-0 overflow-hidden sticky left-0 z-30 bg-muted/50" style={{width: colW("name")}}>
              <span className="w-full min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Name</span>
              <ColResizer onMouseDown={e=>startResize("name", e)} />
            </div>
            <PlainHdr label="Company" widthKey="company" />
            <PlainHdr label="Domain"  widthKey="domain" />
            <PlainHdr label="LI"      widthKey="li" />
            <PlainHdr label="Stage"   widthKey="stage" />
            <SortBtn  col="icp"  label="ICP"  firstDir="desc" />
            <SortBtn  col="deal" label="Deal" />
            <PlainHdr label="Segment" widthKey="segment" />
            <PlainHdr label="Health"  widthKey="health" />
            <SortBtnFlex col="lastActivity" label="Last Int." />
            {/* Trailing filler — grows only on wide screens, shrinks to 0 (then the
                grid scrolls) so it never steals width from a column being resized. */}
            <div className="flex-1 min-w-0" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 flex-shrink-0 text-right" style={{width:78}}>Enrich</span>
          </div>
          {/* Rows */}
          {loading && contacts.length === 0 && <div className="text-[13px] text-muted-foreground/70 text-center py-12">Loading…</div>}
          {pageRows.map(c => (
            <div key={c.id} className="flex items-center px-4 py-3 border-b border-border/60 last:border-0 hover:bg-muted/50 transition-colors group">
              <button onClick={() => setDetail(c)} className="flex-shrink-0 text-left min-w-0 pr-3 sticky left-0 z-10 bg-background group-hover:bg-muted/50" style={{width:colW("name")}}>
                <div className="text-[13px] font-medium text-foreground truncate">{c.name}</div>
                {c.title && <div className="text-[12px] text-muted-foreground/70 truncate">{c.title}</div>}
              </button>
              <button onClick={() => setDetail(c)} className="text-[13px] text-muted-foreground truncate pr-2 flex-shrink-0 text-left" style={{width:colW("company")}}>{c.companyName ?? "—"}</button>
              <span className="text-[13px] text-muted-foreground/70 truncate pr-2 flex-shrink-0" style={{width:colW("domain")}}>{c.domain ?? "—"}</span>
              <div className="flex-shrink-0" style={{width:colW("li")}}>
                {c.linkedinUrl
                  ? <a href={c.linkedinUrl} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}
                      className="text-muted-foreground/70 hover:text-foreground transition-colors flex items-center">
                      <Linkedin className="h-3.5 w-3.5" />
                    </a>
                  : <span className="text-muted-foreground/50 text-[12px]">—</span>
                }
              </div>
              <button onClick={() => setDetail(c)} className="text-[13px] pr-2 flex-shrink-0 text-left capitalize" style={{width:colW("stage"),color:stageColor(c.pipelineStage)}}>{c.pipelineStage}</button>
              <button onClick={() => setDetail(c)} className="text-[13px] text-muted-foreground pr-2 flex-shrink-0 text-left tabular-nums" style={{width:colW("icp")}}>{c.icpScore != null ? c.icpScore : "—"}</button>
              <button onClick={() => setDetail(c)} className="text-[13px] text-muted-foreground truncate pr-2 flex-shrink-0 text-left" style={{width:colW("deal")}}>{c.dealStage ?? "—"}</button>
              <button onClick={() => setDetail(c)} className="text-[13px] text-muted-foreground truncate pr-2 flex-shrink-0 text-left" style={{width:colW("segment")}}>{c.segmentLabel ?? "—"}</button>
              <button onClick={() => setDetail(c)} className="text-[13px] tabular-nums pr-2 flex-shrink-0 text-left" style={{width:colW("health"),color:c.dealHealthScore!=null?healthColor(c.dealHealthScore):""}}>
                {c.dealHealthScore!=null ? `${c.dealHealthScore}` : "—"}
              </button>
              <button onClick={() => setDetail(c)} className="text-[13px] text-muted-foreground flex-shrink-0 truncate pr-2 text-left" style={{width:colW("lastActivity")}}>{relTime(c.lastActivityAt)}</button>
              <div className="flex-1 min-w-0" />
              <div className="flex-shrink-0 flex items-center justify-end gap-2" style={{width:78}}>
                {enriched.has(c.id) ? (
                  <span className="text-[11px] text-emerald-600">enriched</span>
                ) : enrichErr.has(c.id) ? (
                  <span className="text-[11px] text-red-500">failed</span>
                ) : (
                  <button onClick={e => handleEnrich(c, e)} disabled={enriching.has(c.id)}
                    className="text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 flex items-center gap-0.5">
                    {enriching.has(c.id) ? <RefreshCw className="h-3 w-3 animate-spin"/> : <span>Enrich</span>}
                  </button>
                )}
                <button onClick={e => deleteContact(c.id, e)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/50 hover:text-red-500 flex-shrink-0">
                  <Trash2 className="h-3.5 w-3.5"/>
                </button>
              </div>
            </div>
          ))}
          {!loading && sorted.length===0 && <div className="text-[13px] text-muted-foreground/70 text-center py-12">No results</div>}
          </div>
          </div>
        </div>

        {/* Pagination footer */}
        <div className="flex items-center justify-between px-8 py-2.5 border-t border-border flex-shrink-0">
          <span className="text-[12px] text-muted-foreground/70 tabular-nums">page {page+1} of {totalPages} · {sorted.length} people</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p=>p-1)} disabled={page===0}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors disabled:opacity-30">Prev</button>
            <button onClick={() => setPage(p=>p+1)} disabled={page>=totalPages-1}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors disabled:opacity-30">Next</button>
          </div>
        </div>
    </div>
  );
}

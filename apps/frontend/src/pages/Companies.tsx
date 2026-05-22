import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, Trash2, Search } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { relTime } from "@/components/mind/shared";
import { Company, healthColor, stageColor, ActivityIcon, mapContact, buildCompanies } from "@/components/mind/entities";
import { PageHeader } from "@/components/ui/page-header";

const apiUrl = import.meta.env.VITE_API_URL ?? "";
const PAGE_SIZE = 50;

type CoTab = "overview" | "activity" | "memory";
type CoSort = { col: string; dir: "asc"|"desc" };

export default function Companies() {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";
  const { id } = useParams();
  const navigate = useNavigate();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token || !workspaceId) return;
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [coRes, ctRes] = await Promise.all([
        fetch(`${apiUrl}/api/companies/list?workspaceId=${workspaceId}`, { headers }),
        fetch(`${apiUrl}/api/contacts?workspaceId=${workspaceId}&limit=2000`, { headers }),
      ]);
      const coData = coRes.ok ? await coRes.json() : {};
      const ctData = ctRes.ok ? await ctRes.json() : {};
      const contacts = (ctData.contacts ?? []).map(mapContact);
      setCompanies(buildCompanies(coData.companies ?? [], contacts));
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [token, workspaceId]);

  useEffect(() => { load(); }, [load]);

  const [q, setQ] = useState("");
  const detail = useMemo<Company | null>(
    () => id ? companies.find(c => c.id === id) ?? null : null,
    [id, companies]
  );
  const setDetail = (c: Company | null) => navigate(c ? `/companies/${c.id}` : "/companies");
  const [coTab, setCoTab] = useState<CoTab>("overview");
  const [coActs, setCoActs] = useState<any[]>([]);
  const [coMems, setCoMems] = useState<any[]>([]);
  const [coLoading, setCoLoading] = useState(false);
  const [coEditField, setCoEditField] = useState<string | null>(null);
  const [coEditValue, setCoEditValue] = useState("");
  const [coSaving, setCoSaving] = useState(false);
  const [coLocalOverrides, setCoLocalOverrides] = useState<Record<string, string | null>>({});
  const [coSort, setCoSort] = useState<CoSort>({ col:"dealHealthScore", dir:"desc" });
  const [page, setPage] = useState(0);

  const deleteCompany = async (cid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCompanies(prev => prev.filter(c => c.id !== cid));
    fetch(`${apiUrl}/api/companies/${cid}?workspaceId=${workspaceId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  };

  useEffect(() => {
    if (!detail) return;
    setCoActs([]); setCoMems([]); setCoLoading(true); setCoLocalOverrides({});
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      Promise.all(detail.contacts.slice(0,5).map(c =>
        fetch(`${apiUrl}/api/contacts/${c.id}`, { headers })
          .then(r => r.ok ? r.json() : null)
          .then(d => (d?.activities ?? []).map((a: any) => ({ ...a, contactName: c.name })))
          .catch(() => [])
      )).then(results => results.flat().sort((a:any,b:any) =>
        new Date(b.created_at||b.occurred_at||0).getTime() - new Date(a.created_at||a.occurred_at||0).getTime()
      )),
      fetch(`${apiUrl}/api/workspace/memories?workspaceId=${workspaceId}&company_id=${detail.id}&limit=50`, { headers })
        .then(r => r.ok ? r.json() : {})
        .then(d => d.memories ?? [])
        .catch(() => []),
    ]).then(([acts, mems]) => {
      setCoActs(acts); setCoMems(mems); setCoLoading(false);
    });
  }, [detail?.id]);

  const patchCompany = async (key: string, value: string) => {
    if (!detail) return;
    setCoSaving(true);
    try {
      await fetch(`${apiUrl}/api/companies/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type":"application/json", Authorization:`Bearer ${token}` },
        body: JSON.stringify({ [key]: value || null }),
      });
      setCoLocalOverrides(prev => ({ ...prev, [key]: value || null }));
    } catch { /* silent */ }
    finally { setCoSaving(false); setCoEditField(null); }
  };

  const getCoVal = (key: string, fallback: string|null|undefined) =>
    key in coLocalOverrides ? coLocalOverrides[key] : (fallback ?? null);

  const toggleSort = (col: string) => {
    setPage(0);
    setCoSort(prev => prev.col===col ? { col, dir:prev.dir==="asc"?"desc":"asc" } : { col, dir:"desc" });
  };

  const filtered = [...companies].filter(co =>
    !q || co.name.toLowerCase().includes(q.toLowerCase()) ||
    (co.domain??"").toLowerCase().includes(q.toLowerCase()) ||
    (co.industry??"").toLowerCase().includes(q.toLowerCase())
  );
  const sortedList = [...filtered].sort((a,b) => {
    let av: any, bv: any;
    if (coSort.col==="name")            { av=a.name; bv=b.name; }
    else if (coSort.col==="lastActivity"){ av=a.lastActivityAt??""; bv=b.lastActivityAt??""; }
    else if (coSort.col==="industry")   { av=a.industry??""; bv=b.industry??""; }
    else if (coSort.col==="employees")  { av=a.employeeCount??-1; bv=b.employeeCount??-1; }
    else if (coSort.col==="contacts")   { av=a.contactCount; bv=b.contactCount; }
    else                                 { av=a.dealHealthScore??-1; bv=b.dealHealthScore??-1; }
    if (av<bv) return coSort.dir==="asc"?-1:1;
    if (av>bv) return coSort.dir==="asc"?1:-1;
    return 0;
  });
  const totalPages = Math.ceil(sortedList.length / PAGE_SIZE);
  const pageRows = sortedList.slice(page*PAGE_SIZE, (page+1)*PAGE_SIZE);

  const SortHdr = ({ col, label, style, className }: { col:string; label:string; style?:React.CSSProperties; className?:string }) => (
    <button onClick={()=>toggleSort(col)} style={style}
      className={`text-[11px] font-semibold uppercase tracking-wide flex-shrink-0 flex items-center gap-0.5 hover:text-foreground/80 transition-colors ${coSort.col===col?"text-foreground/80":"text-muted-foreground/70"} ${className??""}`}>
      {label}{coSort.col===col&&<span className="text-[8px]">{coSort.dir==="asc"?"▲":"▼"}</span>}
    </button>
  );

  if (detail) {
    const CO_TABS: { id: CoTab; label: string; count?: number }[] = [
      { id:"overview",  label:"Overview"                    },
      { id:"activity",  label:"Activity",  count:coActs.length },
      { id:"memory",    label:"Memory",    count:coMems.length },
    ];
    return (
      <div className="h-full bg-background">
        <div className="flex h-full">
          {/* Main area */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <div className="flex-shrink-0 px-8 pt-7 pb-0">
              <div className="flex items-center gap-3 mb-3">
                <button onClick={() => { setDetail(null); setCoTab("overview"); }}
                  className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors">
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <h1 className="text-[20px] font-semibold tracking-tight text-foreground">{getCoVal("name",detail.name)??detail.name}</h1>
                {detail.domain && <span className="text-[13px] text-muted-foreground/70">{detail.domain}</span>}
              </div>
              <div className="flex gap-6 border-b border-border overflow-x-auto">
                {CO_TABS.map(t => (
                  <button key={t.id} onClick={() => setCoTab(t.id)}
                    className={`flex items-center gap-1.5 pb-2.5 text-[13px] font-medium transition-colors flex-shrink-0 ${
                      coTab===t.id ? "text-foreground border-b-2 border-foreground -mb-px" : "text-muted-foreground/70 hover:text-foreground/80"
                    }`}>
                    {t.label}
                    {t.count !== undefined && <span className={`text-[11px] ${coTab===t.id?"text-muted-foreground/70":"text-muted-foreground/50"}`}>{t.count}</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-8 py-5">
              {coLoading ? (
                <div className="text-[13px] text-muted-foreground/70 text-center py-12">Loading…</div>
              ) : coTab === "overview" ? (
                <div>
                  {detail.contacts.length > 0 && (
                    <>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-3">Contacts ({detail.contacts.length})</div>
                      <div className="rounded-xl border border-border overflow-hidden">
                        {detail.contacts.map(c => (
                          <div key={c.id} className="flex items-center gap-4 px-4 py-3 border-b border-border/60 last:border-0">
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-medium text-foreground">{c.name}</div>
                              {c.title && <div className="text-[12px] text-muted-foreground/70">{c.title}</div>}
                            </div>
                            <span className="text-[12px] flex-shrink-0" style={{color:stageColor(c.pipelineStage)}}>{c.pipelineStage}</span>
                            {c.icpScore!=null && <span className="text-[12px] text-muted-foreground/70 tabular-nums">{c.icpScore}</span>}
                            {c.lastActivityAt && <span className="text-[12px] text-muted-foreground/70 flex-shrink-0">{relTime(c.lastActivityAt)}</span>}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {detail.contacts.length === 0 && <p className="text-[13px] text-muted-foreground/70 text-center py-12">No contacts yet</p>}
                </div>
              ) : coTab === "activity" ? (
                coActs.length === 0
                  ? <p className="text-[13px] text-muted-foreground/70 text-center py-12">No activity yet</p>
                  : <div className="divide-y divide-border/60">
                      {coActs.slice(0,50).map((a:any, i:number) => {
                        const body = a.subtitle || a.raw_data?.text || a.raw_data?.body || null;
                        return (
                          <div key={a.id ?? i} className="py-3">
                            <div className="flex items-center gap-2.5 mb-1">
                              <ActivityIcon source={a.source} type={a.activity_type||""} />
                              <span className="text-[12px] text-muted-foreground flex-1 truncate">{a.activity_type?.replace(/_/g," ").toLowerCase()}</span>
                              <span className="text-[12px] text-muted-foreground/70 flex-shrink-0">{a.contactName}</span>
                              <span className="text-[12px] text-muted-foreground/70 tabular-nums flex-shrink-0">{relTime(a.created_at||a.occurred_at)}</span>
                            </div>
                            {body && <p className="text-[13px] text-foreground/80 leading-relaxed pl-[26px]">{body}</p>}
                          </div>
                        );
                      })}
                    </div>
              ) : (
                coMems.length === 0
                  ? <p className="text-[13px] text-muted-foreground/70 text-center py-12">No memories yet</p>
                  : <div className="divide-y divide-border/60">
                      {coMems.map((m:any) => (
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
            </div>
          </div>
          {/* Right sidebar — editable */}
          <div className="w-64 flex-shrink-0 border-l border-border px-5 py-5 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Record Details</span>
              {coSaving && <span className="text-[11px] text-muted-foreground/70">saving…</span>}
            </div>
            <div className="space-y-3.5">
              {([
                { label:"Name",          key:"name",           val: getCoVal("name", detail.name) },
                { label:"Domain",        key:"domain",         val: getCoVal("domain", detail.domain) },
                { label:"Industry",      key:"industry",       val: getCoVal("industry", detail.industry) },
                { label:"Employees",     key:"employee_count", val: getCoVal("employee_count", detail.employeeCount!=null?String(detail.employeeCount):null), type:"number" },
                { label:"Location",      key:"location",       val: getCoVal("location", detail.location) },
                { label:"Revenue Range", key:"revenue_range",  val: getCoVal("revenue_range", detail.revenueRange) },
                { label:"Deal Health",   key:"_ro_health",     val: detail.dealHealthScore!=null?`${detail.dealHealthScore}/100`:null },
                { label:"Contacts",      key:"_ro_contacts",   val: String(detail.contactCount) },
                { label:"Last Activity", key:"_ro_last",       val: detail.lastActivityAt?relTime(detail.lastActivityAt):null },
              ] as { label:string; key:string; val:string|null; type?:string }[]).map(({ label, key, val, type }) => {
                const isReadOnly = key.startsWith("_ro_");
                const isEditing = coEditField===key;
                return (
                  <div key={key}>
                    <div className="text-[11px] font-medium text-muted-foreground/70 mb-1">{label}</div>
                    {isReadOnly ? (
                      <div className={`text-[13px] leading-snug break-words ${val?"text-foreground/80":"text-muted-foreground/50 italic"}`}>{val??"—"}</div>
                    ) : isEditing ? (
                      <input type={type==="number"?"number":"text"} value={coEditValue} autoFocus
                        onChange={e=>setCoEditValue(e.target.value)}
                        onBlur={()=>patchCompany(key,coEditValue)}
                        onKeyDown={e=>{if(e.key==="Enter")patchCompany(key,coEditValue);if(e.key==="Escape")setCoEditField(null);}}
                        className="w-full rounded-md border border-border bg-background text-[13px] text-foreground px-2 py-1 outline-none focus:border-foreground/40"/>
                    ) : (
                      <div onClick={()=>{setCoEditField(key);setCoEditValue(val??"");}}
                        className={`text-[13px] leading-snug break-words cursor-pointer rounded-md px-1.5 -mx-1.5 py-1 transition-colors hover:bg-muted/50 ${val?"text-foreground/80":"text-muted-foreground/50 italic"}`}>
                        {val??"—"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-8 py-7">
        <PageHeader title="Companies" subtitle="Every account in your workspace, ranked by deal health." />

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70 pointer-events-none" />
            <input value={q} onChange={e=>{setQ(e.target.value);setPage(0);}} placeholder="Search companies…" autoFocus
              className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground/70 focus:border-foreground/40 outline-none" />
          </div>
          <span className="text-[12px] text-muted-foreground/70 flex-shrink-0 tabular-nums">{filtered.length} of {companies.length}</span>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border overflow-hidden">
          {/* Table header */}
          <div className="flex items-center px-4 py-2.5 bg-muted/50 border-b border-border">
            <SortHdr col="name"         label="Company"   style={{width:170}} />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 flex-shrink-0" style={{width:110}}>Domain</span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 flex-1 min-w-0">Top Contacts</span>
            <SortHdr col="lastActivity" label="Last Act." style={{width:92}} />
            <SortHdr col="industry"     label="Industry"  style={{width:92}} />
            <SortHdr col="employees"    label="Emp."      style={{width:70}} className="justify-end" />
            <SortHdr col="contacts"     label="Contacts"  style={{width:62}} className="justify-end" />
            <SortHdr col="dealHealthScore" label="Health" style={{width:70}} className="justify-end" />
            <span className="flex-shrink-0" style={{width:28}} />
          </div>
          {/* Rows */}
          {loading && companies.length === 0 && <div className="text-[13px] text-muted-foreground/70 text-center py-12">Loading…</div>}
          {pageRows.map(co => {
            const topContacts = co.contacts.slice(0,3).map(c=>c.name.split(" ")[0]).join(", ");
            return (
            <div key={co.id} className="flex items-center px-4 py-3 border-b border-border/60 last:border-0 hover:bg-muted/50 transition-colors group">
              <button onClick={() => setDetail(co)} className="flex items-center gap-2 flex-shrink-0 text-left" style={{width:170}}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{backgroundColor:healthColor(co.dealHealthScore)}} />
                <span className="text-[13px] font-medium text-foreground truncate">{co.name}</span>
              </button>
              <span className="text-[13px] text-muted-foreground flex-shrink-0 truncate pr-2" style={{width:110}}>{co.domain??"—"}</span>
              <button onClick={()=>setDetail(co)} className="text-[13px] text-muted-foreground flex-1 min-w-0 truncate pr-2 text-left">{topContacts||"—"}</button>
              <span className="text-[13px] text-muted-foreground flex-shrink-0 pr-2" style={{width:92}}>{relTime(co.lastActivityAt)}</span>
              <span className="text-[13px] text-muted-foreground flex-shrink-0 truncate pr-2" style={{width:92}}>{co.industry??"—"}</span>
              <span className="text-[13px] text-muted-foreground flex-shrink-0 text-right tabular-nums" style={{width:70}}>{co.employeeCount!=null?co.employeeCount.toLocaleString():"—"}</span>
              <span className="text-[13px] text-foreground/80 flex-shrink-0 text-right tabular-nums" style={{width:62}}>{co.contactCount}</span>
              <span className="text-[13px] flex-shrink-0 text-right tabular-nums" style={{width:70,color:co.dealHealthScore!=null?healthColor(co.dealHealthScore):""}}>
                {co.dealHealthScore!=null?`${co.dealHealthScore}`:"—"}
              </span>
              <button onClick={e=>deleteCompany(co.id,e)}
                className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 flex justify-end text-muted-foreground/50 hover:text-red-500" style={{width:28}}>
                <Trash2 className="h-3.5 w-3.5"/>
              </button>
            </div>
            );
          })}
          {!loading && pageRows.length===0 && <div className="text-[13px] text-muted-foreground/70 text-center py-12">No results</div>}
        </div>

        {/* Pagination footer */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}
              className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30">
              <ChevronLeft className="h-4 w-4"/>Prev
            </button>
            <span className="text-[12px] text-muted-foreground/70 tabular-nums">
              {page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE,sortedList.length)} of {sortedList.length}
            </span>
            <button onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} disabled={page>=totalPages-1}
              className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30">
              Next<ChevronRight className="h-4 w-4"/>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

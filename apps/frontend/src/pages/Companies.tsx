import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  Building2,
  Search,
  Globe,
  ArrowLeft,
  Download,
  ListFilter,
  ChevronDown,
  Check,
  Trash2,
  Loader2,
  Zap,
  Brain,
  Mail,
  Phone,
  FileText,
  Eye,
  Activity,
  GitFork,
  PhoneCall,
  StickyNote,
  Circle,
  Target,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { CompanyGraph } from "@/components/crm/CompanyGraph";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContactSummary {
  id: string;
  name: string;
  email: string;
  pipelineStage: string;
  title: string | null;
}

interface Company {
  name: string;
  domain: string | null;
  industry: string | null;
  employee_count: number | null;
  location: string | null;
  contactCount: number;
  contactIds: string[];
  contacts: ContactSummary[];
  topContact: string | null;
  lastInteraction: string | null;
  dealStage: string | null;
  dealHealthScore: number | null;
}

// ─── Industry filter dropdown ─────────────────────────────────────────────────

const INDUSTRIES = ["All industries","Technology","Finance","Healthcare","Retail","Logistics","SaaS","Agency","Media","Education","Other"];

const DEAL_STAGES = [
  "Website Inbound",
  "Positive Cold Outbound",
  "Social Outbound",
  "Discovery",
  "Proposal Sent",
  "Closed Won",
  "Closed Lost",
];

function IndustryDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "flex items-center gap-1.5 px-3 py-2 text-[12px] rounded-md transition-colors",
          value ? "bg-teal-50 text-teal-700 font-medium" : "text-gray-500 hover:text-gray-800 hover:bg-gray-50",
        )}
      >
        <ListFilter className="h-3 w-3 text-gray-400" />
        {value ? `Industry: ${value}` : "Industry: All"}
        <ChevronDown className="h-3 w-3 text-gray-400" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-44 bg-white border border-gray-200 rounded-xl shadow-xl py-1 overflow-hidden">
          {INDUSTRIES.map(ind => (
            <button
              key={ind}
              onClick={() => { onChange(ind === "All industries" ? "" : ind); setOpen(false); }}
              className="w-full flex items-center justify-between px-3.5 py-2 text-[13px] text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {ind}
              {(ind === "All industries" ? !value : value === ind) && <Check className="h-3.5 w-3.5 text-teal-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DealStageFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const options = [{ value: "", label: "All stages" }, ...DEAL_STAGES.map(s => ({ value: s, label: s }))];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "flex items-center gap-1.5 px-3 py-2 text-[12px] rounded-md transition-colors",
          value ? "bg-teal-50 text-teal-700 font-medium" : "text-gray-500 hover:text-gray-800 hover:bg-gray-50",
        )}
      >
        <ListFilter className="h-3 w-3 text-gray-400" />
        {value ? `Stage: ${value}` : "Deal Stage"}
        <ChevronDown className="h-3 w-3 text-gray-400" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-48 bg-white border border-gray-200 rounded-xl shadow-xl py-1 overflow-hidden max-h-72 overflow-y-auto">
          {options.map(o => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className="w-full flex items-center justify-between px-3.5 py-2 text-[13px] text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {o.label}
              {value === o.value && <Check className="h-3.5 w-3.5 text-teal-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Company detail panel ─────────────────────────────────────────────────────

interface CompanyRecord {
  id: string; name: string; domain: string | null; industry: string | null;
  employee_count: number | null; location: string | null; tech_stack: string[] | null;
  revenue_range: string | null; enrichment_status: string | null; enriched_at: string | null;
  apollo_raw: Record<string, unknown> | null; contactCount: number;
}

type CompanyTab = 'overview' | 'activity' | 'memory' | 'graph';

interface CompanyEvt {
  id: string;
  activity_type: string;
  source: string | null;
  title: string;
  subtitle: string | null;
  created_at: string;
  contact_name: string | null;
  is_public: boolean;
}

interface CompanyMem {
  content: string;
  category: string;
  source_type: 'company' | 'contact';
  contact_name: string | null;
}

function CompanyEvtIcon({ activityType, source }: { activityType: string; source: string | null }) {
  const b = "h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden";
  const logoEl = (src: string, bg = "bg-white border border-gray-100") => (
    <div className={cn(b, bg, "p-[5px]")}>
      <img src={src} className="h-full w-full object-contain" alt="" />
    </div>
  );

  if (['linkedin_connected','linkedin_message','linkedin_replied'].includes(activityType))
    return logoEl('/provider-logos/linkedin.png', 'bg-[#0A66C2]');

  if (['email_sent','email_received','email_reply','email_opened','email_bounced'].includes(activityType)) {
    if (source === 'instantly') return logoEl('/provider-logos/instantly.svg');
    return logoEl('/provider-logos/gmail.svg');
  }

  if (['meeting_held','meeting_scheduled'].includes(activityType)) {
    if (source === 'fireflies') return logoEl('/provider-logos/fireflies.svg');
    if (source === 'fathom')    return logoEl('/provider-logos/fathom.svg');
    if (source === 'granola')   return logoEl('/provider-logos/granola.svg');
    return <div className={cn(b,"bg-emerald-50 border border-emerald-100")}><PhoneCall className="h-3.5 w-3.5 text-emerald-500"/></div>;
  }

  if (['website_visit','website_revisit','page_view'].includes(activityType))
    return logoEl('/provider-logos/rb2b.svg');

  if (activityType === 'intent_signal')
    return <div className={cn(b,"bg-purple-50 border border-purple-100")}><Zap className="h-3.5 w-3.5 text-purple-500"/></div>;

  if (activityType === 'enrichment_run') {
    if (source === 'prospeo') return logoEl('/provider-logos/prospeo.svg');
    if (source === 'apollo')  return logoEl('/provider-logos/apollo.svg');
    return <div className={cn(b,"bg-blue-50 border border-blue-100")}><Search className="h-3.5 w-3.5 text-blue-500"/></div>;
  }

  if (activityType === 'icp_scored')
    return <div className={cn(b,"bg-indigo-50 border border-indigo-100")}><Target className="h-3.5 w-3.5 text-indigo-500"/></div>;

  if (activityType === 'call')
    return <div className={cn(b,"bg-gray-100 border border-gray-200")}><Phone className="h-3.5 w-3.5 text-gray-500"/></div>;

  if (['proposal_sent','proposal_viewed'].includes(activityType))
    return <div className={cn(b,"bg-gray-100 border border-gray-200")}><FileText className="h-3.5 w-3.5 text-gray-500"/></div>;

  if (['note','contact_created','manual'].includes(activityType))
    return <div className={cn(b,"bg-amber-50 border border-amber-100")}><StickyNote className="h-3.5 w-3.5 text-amber-500"/></div>;

  return <div className={cn(b,"bg-gray-900 border border-gray-800")}><Circle className="h-2.5 w-2.5 text-white fill-white"/></div>;
}

function fmtRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60)   return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30)   return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function CompanyDetail({ company, onBack, token, apiUrl, workspaceId }: {
  company: Company; onBack: () => void;
  token: string; apiUrl: string; workspaceId: string;
}) {
  const [record, setRecord]       = useState<CompanyRecord | null>(null);
  const [loading, setLoading]     = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [tab, setTab]             = useState<CompanyTab>('overview');

    // Activity + Memory state
  const [activities, setActivities]   = useState<CompanyEvt[]>([]);
  const [memories,   setMemories]     = useState<CompanyMem[]>([]);
  const [actLoading, setActLoading]   = useState(false);
  const [memLoading, setMemLoading]   = useState(false);
  const [actFilter,  setActFilter]    = useState<'all' | 'meetings' | 'signals'>('all');

  // Editable field local state
  const [industry,  setIndustry]  = useState("");
  const [employees, setEmployees] = useState("");
  const [location,  setLocation]  = useState("");
  const [revenue,   setRevenue]   = useState("");

  const fetchRecord = useCallback(async () => {
    if (!company.domain) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/companies/by-domain?domain=${encodeURIComponent(company.domain)}&workspaceId=${workspaceId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      const r: CompanyRecord | null = data.company || null;
      setRecord(r);
      setIndustry(r?.industry ?? company.industry ?? "");
      setEmployees(r?.employee_count != null ? String(r.employee_count) : "");
      setLocation(r?.location ?? "");
      setRevenue(r?.revenue_range ?? "");
    } catch { setRecord(null); }
    setLoading(false);
  }, [company.domain, company.industry, apiUrl, workspaceId, token]);

  useEffect(() => { fetchRecord(); }, [fetchRecord]);

  // Fetch activity + memory when we have a record.id and switch to those tabs
  useEffect(() => {
    if (!record?.id) return;
    if (tab === 'activity' && activities.length === 0 && !actLoading) {
      setActLoading(true);
      fetch(`${apiUrl}/api/companies/${record.id}/activity-and-memory?workspaceId=${workspaceId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(d => { setActivities(d.activities || []); setMemories(d.memories || []); })
        .catch(() => {})
        .finally(() => setActLoading(false));
    }
    if (tab === 'memory' && memories.length === 0 && !memLoading) {
      setMemLoading(true);
      fetch(`${apiUrl}/api/companies/${record.id}/activity-and-memory?workspaceId=${workspaceId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(d => { setActivities(d.activities || []); setMemories(d.memories || []); })
        .catch(() => {})
        .finally(() => setMemLoading(false));
    }
  }, [tab, record?.id, apiUrl, workspaceId, token, activities.length, memories.length, actLoading, memLoading]);

  const saveField = async (field: string, value: string) => {
    if (!record?.id) return;
    const body: Record<string, string | number | null> = {};
    if (field === 'employee_count') body[field] = value === '' ? null : Number(value) || null;
    else body[field] = value || null;
    try {
      const res = await fetch(`${apiUrl}/api/companies/${record.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setRecord(prev => prev ? { ...prev, ...data.company } : prev);
      }
    } catch { /* silent */ }
  };

  const handleEnrich = async () => {
    if (!company.domain || enriching) return;
    setEnriching(true);
    try {
      const res = await fetch(`${apiUrl}/api/companies/enrich`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ domain: company.domain, workspaceId, companyId: company.id }),
      });
      if (res.ok) await fetchRecord();
    } catch { /* silent */ }
    setEnriching(false);
  };

  const contactCount = record?.contactCount ?? company.contactCount;

  const TABS: { id: CompanyTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <Building2 className="h-3.5 w-3.5" /> },
    { id: 'activity', label: 'Activity',  icon: <Activity  className="h-3.5 w-3.5" /> },
    { id: 'memory',   label: 'Memory',    icon: <Brain     className="h-3.5 w-3.5" /> },
    { id: 'graph',    label: 'Graph',     icon: <GitFork   className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex-shrink-0 px-8 pt-7 pb-0">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-700 transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2.5">
            {company.domain && (
              <img
                src={`https://www.google.com/s2/favicons?domain=${company.domain}&sz=32`}
                alt="" className="h-6 w-6 rounded-md flex-shrink-0"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <h2 className="text-[22px] font-semibold text-gray-900 tracking-tight">{company.name}</h2>
          </div>
          <div className="flex-1" />
          {company.domain && (
            <button
              onClick={handleEnrich}
              disabled={enriching}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {enriching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              {enriching ? "Enriching…" : "Enrich · 5 cr"}
            </button>
          )}
        </div>

        {/* Meta chips */}
        <div className="flex items-center gap-2 pl-[52px] mb-4 flex-wrap">
          {company.domain && (
            <a href={`https://${company.domain}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-100 text-[12px] font-medium text-gray-600 hover:bg-gray-200 transition-colors">
              <Globe className="h-3 w-3 text-gray-400" />{company.domain}
            </a>
          )}
          {industry && <span className="text-[12px] text-gray-400">{industry}</span>}
          <span className="text-[12px] text-gray-400">·</span>
          <span className="text-[12px] text-gray-400">{contactCount} {contactCount === 1 ? "contact" : "contacts"}</span>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b border-gray-100">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors",
                tab === t.id
                  ? "border-gray-900 text-gray-900"
                  : "border-transparent text-gray-400 hover:text-gray-700"
              )}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left: tab content ── */}
        <div className={`flex-1 relative ${tab === 'graph' ? 'overflow-hidden flex flex-col' : 'overflow-y-auto px-8 py-7'}`}>

        {/* ── Overview ── */}
        {tab === 'overview' && (
          loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
            </div>
          ) : (
            <div className="space-y-6">

              {/* 2-column stat card grid */}
              <div className="grid grid-cols-2 gap-3">

                {/* Industry — editable */}
                <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3 group">
                  <p className="text-[11px] text-gray-400 mb-1.5 uppercase tracking-wide font-medium">Industry</p>
                  <input
                    value={industry} onChange={e => setIndustry(e.target.value)}
                    onBlur={() => saveField('industry', industry)}
                    onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    placeholder="Add…"
                    className="w-full text-[14px] font-semibold text-gray-900 bg-transparent border-0 outline-none p-0 placeholder:text-gray-300 placeholder:font-normal leading-tight"
                  />
                </div>

                {/* Employees — editable */}
                <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3 group">
                  <p className="text-[11px] text-gray-400 mb-1.5 uppercase tracking-wide font-medium">Employees</p>
                  <input
                    value={employees} onChange={e => setEmployees(e.target.value)}
                    onBlur={() => saveField('employee_count', employees)}
                    onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    placeholder="Add…" inputMode="numeric"
                    className="w-full text-[14px] font-semibold text-gray-900 bg-transparent border-0 outline-none p-0 placeholder:text-gray-300 placeholder:font-normal leading-tight"
                  />
                </div>

                {/* Location — editable */}
                <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3 group">
                  <p className="text-[11px] text-gray-400 mb-1.5 uppercase tracking-wide font-medium">Location</p>
                  <input
                    value={location} onChange={e => setLocation(e.target.value)}
                    onBlur={() => saveField('location', location)}
                    onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    placeholder="Add…"
                    className="w-full text-[14px] font-semibold text-gray-900 bg-transparent border-0 outline-none p-0 placeholder:text-gray-300 placeholder:font-normal leading-tight"
                  />
                </div>

                {/* Revenue — editable */}
                <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3 group">
                  <p className="text-[11px] text-gray-400 mb-1.5 uppercase tracking-wide font-medium">Revenue</p>
                  <input
                    value={revenue} onChange={e => setRevenue(e.target.value)}
                    onBlur={() => saveField('revenue_range', revenue)}
                    onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    placeholder="Add…"
                    className="w-full text-[14px] font-semibold text-gray-900 bg-transparent border-0 outline-none p-0 placeholder:text-gray-300 placeholder:font-normal leading-tight"
                  />
                </div>

                {/* Contacts — read-only */}
                <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
                  <p className="text-[11px] text-gray-400 mb-1.5 uppercase tracking-wide font-medium">Contacts</p>
                  <p className="text-[14px] font-semibold text-gray-900 leading-tight">{contactCount}</p>
                </div>

                {/* Deal stage — read-only */}
                <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
                  <p className="text-[11px] text-gray-400 mb-1.5 uppercase tracking-wide font-medium">Deal stage</p>
                  <p className="text-[14px] font-semibold text-gray-900 leading-tight">{company.dealStage ?? "—"}</p>
                </div>
              </div>

              {/* Domain */}
              {company.domain && (
                <div className="flex items-center gap-2 px-1">
                  <Globe className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                  <a href={`https://${company.domain}`} target="_blank" rel="noopener noreferrer"
                    className="text-[13px] text-teal-600 hover:text-teal-700 font-medium transition-colors">
                    {company.domain}
                  </a>
                  {company.topContact && (
                    <>
                      <span className="text-gray-300">·</span>
                      <span className="text-[13px] text-gray-400">Top contact: {company.topContact}</span>
                    </>
                  )}
                </div>
              )}

              {/* About */}
              {(record?.apollo_raw as any)?.short_description && (
                <div className="border-t border-gray-50 pt-5">
                  <p className="text-[11px] text-gray-400 uppercase tracking-wide font-medium mb-2">About</p>
                  <p className="text-[13px] text-gray-600 leading-relaxed">{(record?.apollo_raw as any).short_description}</p>
                </div>
              )}

              {/* Tech stack */}
              {record?.tech_stack && record.tech_stack.length > 0 && (
                <div className="border-t border-gray-50 pt-5">
                  <p className="text-[11px] text-gray-400 uppercase tracking-wide font-medium mb-3">Tech stack</p>
                  <div className="flex flex-wrap gap-1.5">
                    {record.tech_stack.map(t => (
                      <span key={t} className="px-2.5 py-1 rounded-md bg-gray-100 text-[12px] text-gray-700 font-medium">{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* People */}
              {company.contacts.length > 0 && (
                <div className="border-t border-gray-50 pt-5">
                  <p className="text-[11px] text-gray-400 uppercase tracking-wide font-medium mb-3">
                    People <span className="normal-case font-normal">({company.contacts.length})</span>
                  </p>
                  <div className="space-y-1">
                    {company.contacts.map(c => (
                      <div key={c.id} className="flex items-center gap-3 py-1.5 rounded-lg px-1 hover:bg-gray-50 transition-colors">
                        <div className="h-7 w-7 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-[11px] font-medium text-gray-500">{c.name.charAt(0).toUpperCase()}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-gray-900 truncate">{c.name}</p>
                          {c.title && <p className="text-[11px] text-gray-400 truncate">{c.title}</p>}
                        </div>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                          c.pipelineStage === 'client'     ? 'bg-emerald-50 text-emerald-700' :
                          c.pipelineStage === 'evaluating' ? 'bg-blue-50 text-blue-700' :
                          c.pipelineStage === 'interested' ? 'bg-violet-50 text-violet-700' :
                          c.pipelineStage === 'aware'      ? 'bg-amber-50 text-amber-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>{c.pipelineStage}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        )}

        {/* ── Activity ── */}
        {tab === 'activity' && (
          actLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
            </div>
          ) : (() => {
            const MEETING_TYPES = new Set(['meeting_held','meeting_scheduled']);
            const filtered = activities.filter(e =>
              actFilter === 'all'      ? true :
              actFilter === 'signals'  ? e.is_public :
              actFilter === 'meetings' ? MEETING_TYPES.has(e.activity_type) :
              true
            );

            // Group by "Month Year"
            const groups: { label: string; items: CompanyEvt[] }[] = [];
            for (const evt of filtered) {
              const d = new Date(evt.created_at);
              const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
              const last = groups[groups.length - 1];
              if (last && last.label === label) last.items.push(evt);
              else groups.push({ label, items: [evt] });
            }

            const signalCount  = activities.filter(e => e.is_public).length;
            const meetingCount = activities.filter(e => MEETING_TYPES.has(e.activity_type)).length;
            const filters: ('all' | 'meetings' | 'signals')[] = [
              'all',
              'meetings',
              ...(signalCount > 0 ? ['signals' as const] : []),
            ];

            return (
              <div className="space-y-4">
                {/* Filter pills */}
                <div className="flex items-center gap-1.5">
                  {filters.map(f => (
                    <button
                      key={f}
                      onClick={() => setActFilter(f)}
                      className={cn(
                        "px-3 py-1 rounded-full text-[12px] font-medium transition-colors",
                        actFilter === f
                          ? f === 'signals' ? "bg-blue-50 text-blue-600" : "bg-gray-900 text-white"
                          : "text-gray-400 hover:text-gray-700 hover:bg-gray-50"
                      )}
                    >
                      {f === 'all'      ? `All (${activities.length})` :
                       f === 'signals'  ? `Signals (${signalCount})` :
                       `Meetings (${meetingCount})`}
                    </button>
                  ))}
                </div>

                {filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <Activity className="h-7 w-7 text-gray-200 mb-3" />
                    <p className="text-[13px] font-medium text-gray-400">
                      {actFilter === 'signals'  ? 'No signals recorded yet' :
                       actFilter === 'meetings' ? 'No meetings yet' :
                       'No activity yet'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {groups.map(group => (
                      <div key={group.label}>
                        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">{group.label}</p>
                        <div>
                          {group.items.map((evt, i) => (
                            <div key={evt.id} className="flex gap-3 pb-4 relative">
                              {i < group.items.length - 1 && (
                                <div className="absolute left-[13px] top-7 bottom-0 w-px bg-gray-100" />
                              )}
                              <CompanyEvtIcon activityType={evt.activity_type} source={evt.source} />
                              <div className="flex-1 min-w-0 pt-0.5">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <p className="text-[13px] font-medium text-gray-900 leading-snug">{evt.title}</p>
                                    {evt.is_public && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-500 font-medium">signal</span>
                                    )}
                                  </div>
                                  <span className="text-[11px] text-gray-400 flex-shrink-0 mt-0.5">{fmtRelative(evt.created_at)}</span>
                                </div>
                                {evt.contact_name && (
                                  <p className="text-[11px] text-gray-400 mt-0.5">{evt.contact_name}</p>
                                )}
                                {evt.subtitle && (
                                  <p className="text-[12px] text-gray-500 mt-1 leading-relaxed line-clamp-2">{evt.subtitle}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()
        )}

        {/* ── Memory ── */}
        {tab === 'memory' && (
          memLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
            </div>
          ) : memories.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24">
              <Brain className="h-8 w-8 text-gray-200 mb-3" />
              <p className="text-[14px] font-medium text-gray-500">No memories yet</p>
              <p className="text-[13px] text-gray-400 mt-1">The AI agent builds memory from calls, emails, and interactions</p>
            </div>
          ) : (() => {
            const companyMems = memories.filter(m => m.source_type === 'company');
            const contactMems = memories.filter(m => m.source_type === 'contact');
            return (
              <div className="space-y-6">
                {/* Company-level memories */}
                {companyMems.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-1.5">
                      <Building2 className="h-3 w-3" />Company
                    </p>
                    <div className="space-y-2">
                      {companyMems.map((mem, i) => (
                        <div key={i} className="rounded-xl bg-teal-50/60 border border-teal-100/80 px-4 py-3">
                          <p className="text-[10px] font-medium text-teal-600 uppercase tracking-wide mb-1">{mem.category}</p>
                          <p className="text-[13px] text-gray-700 leading-relaxed">{mem.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Contact-level memories */}
                {contactMems.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-1.5">
                      <Brain className="h-3 w-3" />People
                    </p>
                    <div className="space-y-2">
                      {contactMems.map((mem, i) => (
                        <div key={i} className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">{mem.category}</p>
                            {mem.contact_name && (
                              <span className="text-[10px] text-gray-400">via {mem.contact_name}</span>
                            )}
                          </div>
                          <p className="text-[13px] text-gray-700 leading-relaxed">{mem.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()
        )}

        {/* ── Graph ── */}
        {tab === 'graph' && (
          <div className="flex-1 min-h-0">
            <CompanyGraph
              key={company.name}
              companyId={record?.id}
              contactIds={company.contactIds}
              companyName={company.name}
              companyDomain={company.domain ?? undefined}
              token={token}
              apiUrl={apiUrl}
              workspaceId={workspaceId}
            />
          </div>
        )}

        </div>{/* end left pane */}

        {/* ── Right sidebar: company details (Activity + Memory + Graph tabs) ── */}
        {tab !== 'overview' && (
          <div className="w-[260px] flex-shrink-0 overflow-y-auto px-5 py-6 mr-8 space-y-5 border-l border-gray-100">

            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Company Details</p>

            {/* Editable fields */}
            <div className="space-y-4">
              {[
                { label: 'Industry',  value: industry,  setter: setIndustry,  field: 'industry',        placeholder: '—' },
                { label: 'Employees', value: employees, setter: setEmployees, field: 'employee_count',   placeholder: '—', numeric: true },
                { label: 'Location',  value: location,  setter: setLocation,  field: 'location',         placeholder: '—' },
                { label: 'Revenue',   value: revenue,   setter: setRevenue,   field: 'revenue_range',    placeholder: '—' },
              ].map(({ label, value, setter, field, placeholder, numeric }) => (
                <div key={field}>
                  <p className="text-[11px] text-gray-400 mb-0.5">{label}</p>
                  <input
                    value={value}
                    onChange={e => setter(e.target.value)}
                    onBlur={() => saveField(field, value)}
                    onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    placeholder={placeholder}
                    inputMode={numeric ? 'numeric' : undefined}
                    className="w-full text-[14px] font-medium text-gray-900 bg-transparent border-0 outline-none focus:ring-0 placeholder:text-gray-300 leading-snug p-0"
                  />
                </div>
              ))}
            </div>

            <div className="border-t border-gray-100" />

            {/* Read-only fields */}
            <div className="space-y-4">
              {([
                ['Contacts',      String(contactCount)],
                ['Deal stage',    company.dealStage ?? '—'],
                ['Top contact',   company.topContact ?? '—'],
              ] as [string, string][]).map(([lbl, val]) => (
                <div key={lbl}>
                  <p className="text-[11px] text-gray-400">{lbl}</p>
                  <p className="text-[14px] font-medium text-gray-900 mt-0.5 leading-snug">{val}</p>
                </div>
              ))}

              {company.domain && (
                <div>
                  <p className="text-[11px] text-gray-400 mb-0.5">Website</p>
                  <a href={`https://${company.domain}`} target="_blank" rel="noopener noreferrer"
                    className="text-[14px] font-medium text-teal-600 hover:text-teal-700 transition-colors leading-snug block truncate">
                    {company.domain}
                  </a>
                </div>
              )}
            </div>

            {/* People */}
            {company.contacts.length > 0 && (
              <>
                <div className="border-t border-gray-100" />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">People</p>
                  <div className="space-y-2">
                    {company.contacts.map(c => (
                      <div key={c.id} className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-[10px] font-medium text-gray-500">{c.name.charAt(0).toUpperCase()}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium text-gray-900 truncate">{c.name}</p>
                          {c.title && <p className="text-[11px] text-gray-400 truncate">{c.title}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

          </div>
        )}

      </div>{/* end body flex */}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Companies() {
  const { userData, session } = useAuth();
  const [searchParams] = useSearchParams();
  const workspaceId = userData?.workspace?.id;
  const apiUrl = import.meta.env.VITE_API_URL ?? "";

  const [search, setSearch]               = useState(searchParams.get("q") ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(searchParams.get("q") ?? "");
  const [industry, setIndustry]           = useState("");
  const [dealStageFilter, setDealStageFilter] = useState("");
  const [companies, setCompanies]         = useState<Company[]>([]);
  const [loading, setLoading]             = useState(false);
  const [selected, setSelected]           = useState<Company | null>(null);
  const [checked, setChecked]             = useState<Set<string>>(new Set());
  const [deleting, setDeleting]           = useState(false);

  // Debounce search so typing doesn't fire a request per keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // Column widths (px) — draggable, persisted to localStorage
  const COL_WIDTHS_KEY = "companies_col_widths";
  const defaultColWidths = { name: 220, domain: 160, industry: 130, employees: 110, contacts: 90, lastInteraction: 140, dealStage: 150, dealHealth: 130, topContact: 160 };
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(COL_WIDTHS_KEY);
      return saved ? { ...defaultColWidths, ...JSON.parse(saved) } : defaultColWidths;
    } catch {
      return defaultColWidths;
    }
  });
  const resizeRef = useRef<{ col: string; startX: number; startW: number } | null>(null);
  useEffect(() => { localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(colWidths)); }, [colWidths]);

  const startResize = (col: string, e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { col, startX: e.clientX, startW: colWidths[col] };
    const onMove = (mv: MouseEvent) => {
      if (!resizeRef.current) return;
      const { col, startX, startW } = resizeRef.current;
      const delta = mv.clientX - startX;
      setColWidths(prev => ({ ...prev, [col]: Math.max(60, startW + delta) }));
    };
    const onUp = () => {
      resizeRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const fetchCompanies = useCallback(async () => {
    if (!workspaceId || !session?.access_token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ workspaceId, limit: "500" });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());

      const res = await fetch(`${apiUrl}/api/contacts?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();

      // Group by company
      const map = new Map<string, Company>();
      for (const p of (data.contacts || [])) {
        if (!p.company) continue;
        const key = p.company.toLowerCase().trim();
        const contactName = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
        if (!map.has(key)) {
          map.set(key, {
            name: p.company,
            domain: p.domain || null,
            industry: p.industry || null,
            employee_count: null,
            location: null,
            contactCount: 0,
            contactIds: [],
            contacts: [],
            topContact: null,
            lastInteraction: p.last_activity_at || null,
            dealStage: p.deal_stage || null,
            dealHealthScore: null,
          });
        }
        const c = map.get(key)!;
        c.contactCount++;
        c.contactIds.push(p.id);
        if (!c.industry && p.industry) c.industry = p.industry;
        if (!c.topContact) c.topContact = contactName;
        c.contacts.push({
          id: p.id,
          name: contactName,
          email: p.email,
          pipelineStage: p.pipeline_stage || 'identified',
          title: p.job_title || null,
        });
      }

      // Merge enriched company data (industry, employees, location) from companies table
      try {
        const enrichRes = await fetch(`${apiUrl}/api/companies/list?workspaceId=${workspaceId}`, {
          headers: { Authorization: `Bearer ${session!.access_token}` },
        });
        if (enrichRes.ok) {
          const { companies: enriched } = await enrichRes.json();
          for (const ec of (enriched || [])) {
            const key = ec.name?.toLowerCase().trim();
            if (key && map.has(key)) {
              const c = map.get(key)!;
              if (ec.industry)                    c.industry        = ec.industry;
              if (ec.employee_count)              c.employee_count  = ec.employee_count;
              if (ec.location)                    c.location        = ec.location;
              if (ec.deal_health_score != null)   c.dealHealthScore = ec.deal_health_score;
            }
          }
        }
      } catch { /* non-fatal */ }

      setCompanies(Array.from(map.values()));
    } catch {
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, session?.access_token, debouncedSearch, apiUrl]);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  // Auto-select if navigated here with ?q=
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && companies.length > 0) {
      const match = companies.find(c => c.name.toLowerCase() === q.toLowerCase());
      if (match) setSelected(match);
    }
  }, [searchParams, companies]);

  // ── Delete selected ────────────────────────────────────────────────────────
  const deleteChecked = async () => {
    if (!session?.access_token || checked.size === 0 || deleting) return;
    setDeleting(true);
    const toDelete = companies.filter(c => checked.has(c.name));
    const allIds = toDelete.flatMap(c => c.contactIds);
    try {
      await Promise.allSettled(allIds.map(id =>
        fetch(`${apiUrl}/api/contacts/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
      ));
      setChecked(new Set());
      await fetchCompanies();
    } finally {
      setDeleting(false);
    }
  };

  // ── Export CSV ─────────────────────────────────────────────────────────────
  const exportCSV = () => {
    if (!displayed.length) return;
    const headers = ["Company","Domain","Industry","Contacts","Last Activity","Deal Stage","Deal Health","Top Contact"];
    const rows = displayed.map(c => [c.name, c.domain ?? "", c.industry ?? "", c.contactCount, c.lastInteraction ?? "", c.dealStage ?? "", c.dealHealthScore ?? "", c.topContact ?? ""]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "companies.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  if (selected) return (
    <CompanyDetail
      company={selected}
      onBack={() => setSelected(null)}
      token={session?.access_token ?? ""}
      apiUrl={apiUrl}
      workspaceId={workspaceId ?? ""}
    />
  );

  let displayed = industry ? companies.filter(c => c.industry === industry) : companies;
  if (dealStageFilter) displayed = displayed.filter(c => c.dealStage === dealStageFilter);
  if (search.trim()) {
    const q = search.toLowerCase();
    displayed = displayed.filter(c => c.name.toLowerCase().includes(q) || (c.domain ?? "").includes(q));
  }

  const toggleCheck = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setChecked(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  };

  const toggleAll = () => {
    if (checked.size === displayed.length && displayed.length > 0) setChecked(new Set());
    else setChecked(new Set(displayed.map(c => c.name)));
  };

  const ResizeHandle = ({ col }: { col: string }) => (
    <div
      onMouseDown={e => startResize(col, e)}
      className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-teal-300 opacity-0 group-hover/th:opacity-100 transition-opacity"
    />
  );

  return (
    <div className="flex flex-col h-full bg-white">

      {/* ── Page header ─────────────────────── */}
      <div className="flex-shrink-0 px-6 pt-6 pb-0">

        {/* Title row */}
        <div className="flex items-center gap-3 mb-3">
          <h1 className="text-[24px] font-semibold text-gray-900 tracking-tight">Companies</h1>
        </div>

        {/* Filter strip */}
        <div className="flex items-center border-b border-gray-100 pb-0 gap-0">
          <IndustryDropdown value={industry} onChange={setIndustry} />
          <span className="h-4 w-px bg-gray-200 mx-2" />
          <DealStageFilter value={dealStageFilter} onChange={setDealStageFilter} />
          <div className="flex-1" />
          <div className="flex items-center gap-2 py-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search companies…"
                className="pl-9 pr-3 h-7 w-44 text-[12px] bg-white border-gray-200 rounded-md shadow-sm focus-visible:ring-1 focus-visible:ring-teal-500/30 focus-visible:border-teal-400 placeholder:text-gray-400 transition-all"
              />
            </div>
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] text-gray-500 hover:text-gray-800 hover:bg-gray-50 rounded-md transition-colors border border-gray-200"
            >
              <Download className="h-3.5 w-3.5" />Export
            </button>
          </div>
        </div>
      </div>

      {/* ── Table ───────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div>
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-6 py-4 border-b border-gray-50">
                <div className="h-3.5 w-3.5 rounded border border-gray-200 flex-shrink-0" />
                <div className="h-3.5 w-32 bg-gray-100 rounded animate-pulse" />
                <div className="h-3.5 w-20 bg-gray-100 rounded animate-pulse ml-4" />
                <div className="flex-1" />
                <div className="h-3.5 w-16 bg-gray-100 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          <table className="table-fixed" style={{ width: "100%" }}>
            <colgroup>
              <col style={{ width: 40 }} />
              <col style={{ width: colWidths.name }} />
              <col style={{ width: colWidths.domain }} />
              <col style={{ width: colWidths.industry }} />
              <col style={{ width: colWidths.employees }} />
              <col style={{ width: colWidths.contacts }} />
              <col style={{ width: colWidths.lastInteraction }} />
              <col style={{ width: colWidths.dealStage }} />
              <col style={{ width: colWidths.dealHealth }} />
              <col style={{ width: colWidths.topContact }} />
              <col />
            </colgroup>
            <thead>
              <tr className="border-b border-gray-100">
                <th className="pl-6 pr-3 py-3 text-left">
                  <div
                    onClick={toggleAll}
                    className={cn(
                      "h-3.5 w-3.5 rounded border transition-colors cursor-pointer flex items-center justify-center",
                      checked.size === displayed.length && displayed.length > 0
                        ? "bg-gray-900 border-gray-900"
                        : "border-gray-300 hover:border-gray-400",
                    )}
                  >
                    {checked.size === displayed.length && displayed.length > 0 && <Check className="h-2.5 w-2.5 text-white" />}
                  </div>
                </th>
                {(["name","domain","industry","employees","contacts","lastInteraction","dealStage","dealHealth","topContact"] as const).map(col => {
                  const labels: Record<string,string> = {
                    name:"Company", domain:"Domain", industry:"Industry", employees:"Employees",
                    contacts:"Contacts", lastInteraction:"Last activity", dealStage:"Deal Stage", dealHealth:"Deal Health", topContact:"Top contact",
                  };
                  return (
                    <th key={col} className="group/th relative px-3 py-3 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap select-none">
                      {labels[col]}
                      <ResizeHandle col={col} />
                    </th>
                  );
                })}
                <th />
              </tr>
            </thead>
            <tbody>
              {displayed.map(c => (
                <tr
                  key={c.name}
                  className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors group cursor-pointer"
                  onClick={() => setSelected(c)}
                >
                  <td className="pl-6 pr-3 py-3.5">
                    <div
                      onClick={e => toggleCheck(c.name, e)}
                      className={cn(
                        "h-3.5 w-3.5 rounded border transition-colors cursor-pointer flex items-center justify-center",
                        checked.has(c.name) ? "bg-gray-900 border-gray-900" : "border-gray-300 group-hover:border-gray-400",
                      )}
                    >
                      {checked.has(c.name) && <Check className="h-2.5 w-2.5 text-white" />}
                    </div>
                  </td>
                  <td className="px-3 py-3.5">
                    <div className="flex items-center gap-1.5">
                      {c.domain && (
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${c.domain}&sz=32`}
                          alt=""
                          className="h-4 w-4 rounded-sm flex-shrink-0"
                          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                        />
                      )}
                      <span className="text-[13px] font-medium text-gray-900 group-hover:text-teal-700 transition-colors truncate">{c.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3.5">
                    <span className="text-[13px] text-gray-400 truncate block">{c.domain ?? "—"}</span>
                  </td>
                  <td className="px-3 py-3.5">
                    <span className="text-[13px] text-gray-600 truncate block">{c.industry ?? "—"}</span>
                  </td>
                  <td className="px-3 py-3.5">
                    <span className="text-[13px] text-gray-600">{c.employee_count ?? "—"}</span>
                  </td>
                  <td className="px-3 py-3.5">
                    <span className="text-[13px] text-gray-600">{c.contactCount}</span>
                  </td>
                  <td className="px-3 py-3.5">
                    <span className="text-[13px] text-gray-600">{c.lastInteraction ?? "—"}</span>
                  </td>
                  <td className="px-3 py-3.5">
                    <span className="text-[13px] text-gray-500">{c.dealStage ?? "—"}</span>
                  </td>
                  <td className="px-3 py-3.5">
                    {c.dealHealthScore !== null ? (
                      <span className={cn(
                        "inline-flex items-center gap-1.5 text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded whitespace-nowrap",
                        c.dealHealthScore >= 75 ? "bg-teal-50 text-teal-700" :
                        c.dealHealthScore >= 45 ? "bg-yellow-50 text-yellow-700" :
                        "bg-red-50 text-red-500"
                      )}>
                        {c.dealHealthScore >= 75 ? "Healthy" : c.dealHealthScore >= 45 ? "Needs attention" : "At risk"}
                        <span className="opacity-60">·</span>
                        {c.dealHealthScore}
                      </span>
                    ) : (
                      <span className="text-gray-300 text-[13px]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3.5">
                    <span className="text-[13px] text-gray-500 truncate block">{c.topContact ?? "—"}</span>
                  </td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!loading && displayed.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24">
            <p className="text-[15px] font-medium text-gray-800">No companies yet</p>
            <p className="text-[13px] text-gray-400 mt-1">Companies are derived from your contacts</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-gray-100 px-6 py-2.5">
        {checked.size > 0 ? (
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-gray-500">{checked.size} selected</span>
            <button
              onClick={deleteChecked}
              disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors border border-red-200 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />{deleting ? "Deleting…" : "Delete selected"}
            </button>
            <button onClick={() => setChecked(new Set())} className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors">
              Cancel
            </button>
          </div>
        ) : (
          <p className="text-[12px] text-gray-400">{displayed.length} {displayed.length === 1 ? "company" : "companies"}</p>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  ArrowLeft,
  Mail,
  Phone,
  StickyNote,
  Building2,
  Brain,
  Zap,
  Circle,
  Upload,
  Download,
  Search,
  ListFilter,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Info,
  Trash2,
  Loader2,
  X,
  FileText,
  Globe,
  MailOpen,
  RotateCcw,
  PhoneCall,
  Users,
  Plus,
  Clock,
  ArrowRight,
  ExternalLink,
  MessageSquare,
  Target,
  Hash,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";


// ─── Types ────────────────────────────────────────────────────────────────────

type PipelineStage = "identified" | "aware" | "interested" | "evaluating" | "client";
type Source        = "posthog" | "gmail" | "linkedin" | "rb2b" | "instantly" | string;

interface Person {
  id: string; name: string; email: string;
  company: string | null; domain: string | null;
  pipelineStage: PipelineStage; pipelineStageUpdatedAt: string | null;
  pipelineStageSource: 'auto' | 'manual' | null;
  lastInteraction: string;
  lastActivityAt: string | null;
  icpFit: boolean | null; icpScore: number | null; icpReasoning: string | null;
  enrichmentStatus: string | null; enrichedAt: string | null;
  source: Source | null;
  segmentLabel: string | null;
  dealStage: string | null; dealValue: number | null;
  title: string | null; firstContact: string | null;
  dealHealthScore: number | null;
  phone: string | null;
  linkedinUrl: string | null;
  seniority: string | null;
  department: string | null;
  city: string | null;
  country: string | null;
  createdAt: string | null;
}

type EnrichSourceStatus = { status: 'pending' | 'scanning' | 'done' | 'skipped'; count: number };
type EnrichContact = {
  id: string; name: string; email: string;
  sources: Record<string, EnrichSourceStatus>;
};

type MockEvt = {
  id: string;
  icon: "email" | "posthog" | "agent" | "call" | "note";
  title: string; subtitle: string; time: string; month: string;
  activityType: string;
  source: string;
  occurredAt: string;
  rawData?: Record<string, unknown> | null;
};

// ─── Pipeline stage config ────────────────────────────────────────────────────

const STAGE_CONFIG: Record<PipelineStage, {
  label: string;
  dot: string;
  badge: string;
  text: string;
  description: string;
}> = {
  identified: {
    label:       "Identified",
    dot:         "bg-gray-300",
    badge:       "bg-gray-50 text-gray-500",
    text:        "text-gray-500",
    description: "In your database — no engagement signals yet.",
  },
  aware: {
    label:       "Aware",
    dot:         "bg-yellow-400",
    badge:       "bg-yellow-50 text-yellow-700",
    text:        "text-yellow-700",
    description: "Low-intent signal: website visit, email opened, LinkedIn view, or social engagement in last 30 days.",
  },
  interested: {
    label:       "Interested",
    dot:         "bg-orange-400",
    badge:       "bg-orange-50 text-orange-700",
    text:        "text-orange-700",
    description: "Medium-intent signal: replied to email, LinkedIn message, content download, or 2+ website visits in last 30 days.",
  },
  evaluating: {
    label:       "Evaluating",
    dot:         "bg-blue-500",
    badge:       "bg-blue-50 text-blue-700",
    text:        "text-blue-700",
    description: "High-intent signal: meeting held, pricing page visit, proposal sent/viewed, or positive outbound reply in last 60 days.",
  },
  client: {
    label:       "Client",
    dot:         "bg-emerald-500",
    badge:       "bg-emerald-50 text-emerald-700",
    text:        "text-emerald-700",
    description: "Signed a proposal, deal won, or payment received. This stage never decays.",
  },
};

// ─── Pipeline stage signal taxonomy ──────────────────────────────────────────

const STAGE_SIGNALS: Record<PipelineStage, string[]> = {
  identified: [],
  aware:       ['website_visit','email_opened','linkedin_view','social_engagement','ad_impression','newsletter_signup'],
  interested:  ['email_reply','linkedin_message','linkedin_connected','content_download','community_joined','event_attended','website_revisit'],
  evaluating:  ['meeting_held','pricing_page_visit','proposal_sent','proposal_viewed','outbound_positive_reply','deal_created','trial_started'],
  client:      ['proposal_signed','deal_won','payment_received'],
};

const SIGNAL_LABEL: Record<string, string> = {
  website_visit:           'Website visit',
  email_opened:            'Email opened',
  linkedin_view:           'LinkedIn view',
  social_engagement:       'Social engagement',
  ad_impression:           'Ad impression',
  newsletter_signup:       'Newsletter signup',
  email_reply:             'Email reply',
  linkedin_connected:      'LinkedIn connected',
  content_download:        'Content download',
  community_joined:        'Community joined',
  event_attended:          'Event attended',
  website_revisit:         'Website revisit',
  meeting_held:            'Meeting held',
  pricing_page_visit:      'Pricing page visit',
  proposal_sent:           'Proposal sent',
  proposal_viewed:         'Proposal viewed',
  outbound_positive_reply: 'Positive reply',
  deal_created:            'Deal created',
  trial_started:           'Trial started',
  proposal_signed:         'Proposal signed',
  deal_won:                'Deal won',
  payment_received:        'Payment received',
  airtable_imported:       'Imported from Airtable',
  airtable_synced:         'Synced from Airtable',
  airtable_pushed:         'Pushed to Airtable',
  linkedin_message:        'LinkedIn message sent',
  linkedin_replied:        'LinkedIn reply received',
};

// ─── Deal stage options ───────────────────────────────────────────────────────

const DEAL_STAGES = [
  "Connected",
  "Engaged",
  "Meeting Held",
  "Client",
  "Closed Lost",
];


// ─── Helpers ──────────────────────────────────────────────────────────────────

function iconForType(type: string): MockEvt["icon"] {
  const EMAIL_TYPES = new Set(["email","email_sent","email_opened","email_reply","email_bounced","newsletter_signup"]);
  const CALL_TYPES  = new Set(["call","meeting_held","meeting_scheduled"]);
  const NOTE_TYPES  = new Set(["note","contact_created","manual","airtable_imported","airtable_synced","airtable_pushed"]);
  if (EMAIL_TYPES.has(type)) return "email";
  if (CALL_TYPES.has(type))  return "call";
  if (NOTE_TYPES.has(type))  return "note";
  if (type === "posthog" || type === "pageview" || type === "website_visit" || type === "website_revisit") return "posthog";
  return "agent";
}

function monthLabel(isoString: string) {
  return new Date(isoString).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function timeLabel(isoString: string, source?: string | null) {
  const diffDays = Math.floor((Date.now() - new Date(isoString).getTime()) / 86400000);
  let rel: string;
  if (diffDays < 0) {
    // Future date (e.g. scheduled meeting) — show the date
    rel = new Date(isoString).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } else if (diffDays === 0) {
    rel = "Today";
  } else if (diffDays === 1) {
    rel = "Yesterday";
  } else if (diffDays < 7) {
    rel = `${diffDays} days ago`;
  } else if (diffDays < 14) {
    rel = "1 week ago";
  } else {
    rel = new Date(isoString).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return source && source !== "manual" ? `${rel} · ${source}` : rel;
}

// ─── CSV import helpers ───────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim()); current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

const PEOPLE_FIELDS = [
  { key: 'email',          label: 'Email'          },
  { key: 'full_name',      label: 'Full Name'      },
  { key: 'first_name',     label: 'First Name'     },
  { key: 'last_name',      label: 'Last Name'      },
  { key: 'company',        label: 'Company'        },
  { key: 'domain',         label: 'Domain'         },
  { key: 'job_title',      label: 'Job Title'      },
  { key: 'phone',          label: 'Phone'          },
  { key: 'deal_stage',     label: 'Deal Stage'     },
  { key: 'source',         label: 'Source'         },
  { key: 'linkedin_url',   label: 'LinkedIn URL'   },
  { key: 'notes',          label: 'Notes'          },
  { key: 'seniority',      label: 'Seniority'      },
  { key: 'department',     label: 'Department'     },
  { key: 'pipeline_stage',  label: 'Pipeline Stage'  },
  { key: 'crm_record_id',  label: 'CRM Record ID'   },
] as const;

const AUTO_MATCH: Record<string, string[]> = {
  email:          ['email', 'emailaddress', 'mail'],
  first_name:     ['first_name', 'firstname', 'fname', 'givenname', 'forename'],
  last_name:      ['last_name', 'lastname', 'lname', 'surname', 'familyname'],
  company:        ['company', 'companyname', 'organization', 'org', 'employer', 'account'],
  domain:         ['domain', 'website', 'companydomain', 'company_domain', 'url', 'web'],
  job_title:      ['title', 'job_title', 'jobtitle', 'position', 'role'],
  phone:          ['phone', 'phonenumber', 'mobile', 'tel', 'telephone', 'cell'],
  deal_stage:     ['deal_stage', 'dealstage', 'stage', 'salestage'],
  source:         ['source', 'leadsource', 'lead_source', 'origin'],
  linkedin_url:   ['linkedin_url', 'linkedin', 'linkedinurl', 'linkedinprofile'],
  notes:          ['notes', 'note', 'comment', 'comments', 'description'],
  seniority:      ['seniority', 'senioritylevel', 'level'],
  department:     ['department', 'dept', 'team'],
  pipeline_stage: ['pipeline_stage', 'pipelinestage', 'pipeline'],
  crm_record_id:  ['record_id', 'recordid', 'crm_record_id', 'hubspot_record_id', 'contact_id', 'id'],
};

function detectMappings(headers: string[]): Record<string, string> {
  const used = new Set<string>();
  const map: Record<string, string> = {};
  for (const h of headers) {
    const lh = h.toLowerCase().replace(/[-_\s]/g, '');
    for (const [field, aliases] of Object.entries(AUTO_MATCH)) {
      if (!used.has(field) && aliases.some(a => lh === a)) {
        map[h] = field; used.add(field); break;
      }
    }
    if (map[h] === undefined) map[h] = '';
  }
  return map;
}

function mapContactToPerson(c: any): Person {
  return {
    id: c.id,
    name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
    email: c.email,
    company: c.company || null,
    domain: c.domain || null,
    pipelineStage: (c.pipeline_stage || 'identified') as PipelineStage,
    pipelineStageUpdatedAt: c.pipeline_stage_updated_at || null,
    pipelineStageSource: c.pipeline_stage_source || null,
    lastInteraction: c.last_activity_at ? timeLabel(c.last_activity_at) : '—',
    lastActivityAt: c.last_activity_at || null,
    icpFit: c.icp_fit ?? null,
    icpScore: c.icp_score ?? null,
    icpReasoning: c.icp_reasoning || null,
    enrichmentStatus: c.enrichment_status || null,
    enrichedAt: c.enriched_at || null,
    source: c.source || null,
    segmentLabel: c.source_tag || null,
    dealStage: c.deal_stage || null,
    dealValue: null,
    title: c.job_title || null,
    firstContact: c.first_seen_at
      ? new Date(c.first_seen_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null,
    dealHealthScore: c.deal_health_score ?? null,
    phone: c.phone || null,
    linkedinUrl: c.linkedin_url || null,
    seniority: c.seniority || null,
    department: c.department || null,
    city: c.city || null,
    country: c.country || null,
    createdAt: c.created_at || null,
  };
}

// ─── Source logo atoms ────────────────────────────────────────────────────────

function SourceLogo({ s }: { s: Source | null }) {
  if (!s) return <span className="text-gray-300 text-[13px]">—</span>;

  const logos: Record<string, React.ReactNode> = {
    posthog: (
      <span className="inline-flex items-center gap-1.5">
        <svg width="13" height="13" viewBox="0 0 32 32" fill="none">
          <path d="M0 8h32L24 16H8L0 8Z" fill="#F54E00"/>
          <path d="M8 16h16l-8 8H0l8-8Z" fill="#F54E00" opacity=".65"/>
          <path d="M0 24h16l-8 8H-8l8-8Z" fill="#F54E00" opacity=".35"/>
        </svg>
        <span className="text-[12px] font-medium text-[#F54E00]">PostHog</span>
      </span>
    ),
    gmail: (
      <span className="inline-flex items-center gap-1.5">
        <svg width="14" height="11" viewBox="0 0 32 24" fill="none">
          <path d="M0 4C0 1.8 1.8 0 4 0h24c2.2 0 4 1.8 4 4v16c0 2.2-1.8 4-4 4H4c-2.2 0-4-1.8-4-4V4Z" fill="white"/>
          <path d="M0 4l16 11L32 4" stroke="#EA4335" strokeWidth="2.5" fill="none"/>
          <path d="M0 4L16 15 32 4v16H0V4Z" fill="white"/>
          <path d="M0 4l16 11L32 4" fill="none" stroke="#EA4335" strokeWidth="2.5"/>
          <path d="M0 5v15l7.5-7.5L0 5Z" fill="#4285F4"/>
          <path d="M32 5v15l-7.5-7.5L32 5Z" fill="#34A853"/>
          <path d="M0 20l7.5-7.5h17L32 20H0Z" fill="#FBBC05"/>
          <path d="M0 4l7.5 8.5h17L32 4H0Z" fill="#EA4335"/>
        </svg>
        <span className="text-[12px] font-medium text-[#4285F4]">Gmail</span>
      </span>
    ),
    linkedin: (
      <span className="inline-flex items-center gap-1.5">
        <svg width="13" height="13" viewBox="0 0 24 24">
          <rect width="24" height="24" rx="4" fill="#0A66C2"/>
          <path d="M7 10h2.5v7H7v-7Zm1.25-4a1.25 1.25 0 1 1 0 2.5A1.25 1.25 0 0 1 8.25 6ZM11 10h2.4v.96h.04c.33-.63 1.15-1.29 2.37-1.29 2.54 0 3.01 1.67 3.01 3.84V17H16.3v-3.03c0-1.02-.37-1.72-1.29-1.72-.7 0-1.12.47-1.3.93a1.73 1.73 0 0 0-.08.62V17H11v-7Z" fill="white"/>
        </svg>
        <span className="text-[12px] font-medium text-[#0A66C2]">LinkedIn</span>
      </span>
    ),
    instantly: (
      <span className="inline-flex items-center gap-1.5">
        <img src="/provider-logos/instantly.svg" alt="Instantly" className="h-3.5 w-3.5 rounded-sm" />
        <span className="text-[12px] font-medium text-indigo-600">Instantly</span>
      </span>
    ),
    rb2b: (
      <span className="inline-flex items-center gap-1.5">
        <img src="/provider-logos/rb2b.svg" alt="RB2B" className="h-3.5 w-3.5 rounded-sm" />
        <span className="text-[12px] font-medium text-orange-600">RB2B</span>
      </span>
    ),
  };

  return <span>{logos[s] ?? <span className="text-[12px] text-gray-500">{s}</span>}</span>;
}

// ─── Pipeline stage badge with hover description tooltip ─────────────────────

function StageBadge({ s }: { s: PipelineStage }) {
  const [show, setShow] = useState(false);
  const cfg = STAGE_CONFIG[s] ?? STAGE_CONFIG.identified;

  return (
    <div className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[12px] font-semibold cursor-default select-none",
        cfg.badge,
      )}>
        {cfg.label}
        <Info className="h-2.5 w-2.5 opacity-40" />
      </span>
      {show && (
        <div className="absolute bottom-full left-0 mb-2 z-50 w-64 bg-gray-900 text-white text-[11px] leading-relaxed rounded-lg px-3 py-2.5 shadow-xl pointer-events-none">
          <p className="font-semibold mb-1 opacity-50 uppercase tracking-wider text-[10px]">{cfg.label} — auto-scored by</p>
          <p className="opacity-90">{cfg.description}</p>
        </div>
      )}
    </div>
  );
}

// ─── EvtIcon + EvtRow ─────────────────────────────────────────────────────────

function EvtIcon({ activityType, source }: { activityType: string; source: string }) {
  const b = "h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden";
  const logoEl = (src: string, bg = "bg-white border border-gray-100") => (
    <div className={cn(b, bg, "p-[5px]")}>
      <img src={src} className="h-full w-full object-contain" alt="" />
    </div>
  );

  if (['linkedin_connected','linkedin_message','linkedin_replied'].includes(activityType))
    return logoEl('/provider-logos/linkedin.png', 'bg-[#0A66C2]');

  if (['slack_message','slack_dm','slack_reaction'].includes(activityType))
    return logoEl('/provider-logos/slack.svg', 'bg-white border border-gray-100');

  if (['airtable_imported','airtable_synced','airtable_pushed'].includes(activityType))
    return logoEl('/provider-logos/airtable.svg');

  if (['email_sent','email_received','email_reply','email_opened','email_bounced','newsletter_signup'].includes(activityType)) {
    if (source === 'smtp')     return logoEl('/provider-logos/smtp.svg');
    if (source === 'instantly') return logoEl('/provider-logos/instantly.svg');
    return logoEl('/provider-logos/gmail.svg');
  }

  if (['meeting_held','meeting_scheduled'].includes(activityType)) {
    if (source === 'fathom')    return logoEl('/provider-logos/fathom.svg');
    if (source === 'fireflies') return logoEl('/provider-logos/fireflies.svg');
    if (source === 'granola')   return logoEl('/provider-logos/granola.svg');
    return <div className={cn(b,"bg-emerald-50 border border-emerald-100")}><PhoneCall className="h-3 w-3 text-emerald-500"/></div>;
  }

  if (['website_visit','website_revisit','page_view'].includes(activityType))
    return logoEl('/provider-logos/rb2b.svg');

  if (activityType === 'intent_signal')
    return <div className={cn(b,"bg-purple-50 border border-purple-100")}><Zap className="h-3 w-3 text-purple-500"/></div>;

  if (activityType === 'enrichment_run') {
    if (source === 'prospeo') return logoEl('/provider-logos/prospeo.svg');
    if (source === 'apollo')  return logoEl('/provider-logos/apollo.svg');
    return <div className={cn(b,"bg-blue-50 border border-blue-100")}><Search className="h-3 w-3 text-blue-500"/></div>;
  }

  if (activityType === 'icp_scored')
    return <div className={cn(b,"bg-indigo-50 border border-indigo-100")}><Target className="h-3 w-3 text-indigo-500"/></div>;

  if (['note','contact_created','manual','airtable_imported','airtable_synced','airtable_pushed'].includes(activityType))
    return <div className={cn(b,"bg-amber-50 border border-amber-100")}><StickyNote className="h-3 w-3 text-amber-500"/></div>;

  return <div className={cn(b,"bg-gray-900 border border-gray-800")}><Circle className="h-2.5 w-2.5 text-white fill-white"/></div>;
}

function EvtRow({ e }: { e: MockEvt }) {
  const [expanded, setExpanded] = useState(false);

  const isEmail = ['email_sent','email_received','email_reply','email_opened'].includes(e.activityType);
  const rd = e.rawData as Record<string, unknown> | null | undefined;
  const emailBody = isEmail && rd
    ? (rd.reply_text ?? rd.body ?? rd.email_body ?? rd.text ?? null) as string | null
    : null;
  const emailSubject = isEmail && rd
    ? (rd.subject ?? null) as string | null
    : null;

  return (
    <div className="border-b border-gray-50 last:border-0">
      <div
        className={cn("flex gap-3 py-3", isEmail && emailBody && "cursor-pointer")}
        onClick={() => isEmail && emailBody && setExpanded(v => !v)}
      >
        <EvtIcon activityType={e.activityType} source={e.source} />
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-[13px] font-medium text-gray-900 leading-snug">{e.title}</p>
          {e.subtitle && <p className="text-[12px] text-gray-500 mt-1 leading-snug">{e.subtitle}</p>}
          <p className="text-[11px] text-gray-400 mt-1">{e.time}</p>
        </div>
        {isEmail && emailBody && (
          <ChevronDown className={cn("h-3.5 w-3.5 text-gray-400 flex-shrink-0 mt-1 transition-transform", expanded && "rotate-180")} />
        )}
      </div>
      {expanded && emailBody && (
        <div className="ml-9 mb-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
          {emailSubject && (
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {emailSubject}
            </p>
          )}
          <p className="text-[12px] text-gray-700 leading-relaxed whitespace-pre-wrap">{emailBody}</p>
        </div>
      )}
    </div>
  );
}

// ─── Deal stage single-select ─────────────────────────────────────────────────

function DealStageSelect({ value, personId, token, apiUrl, onChange }: {
  value: string | null; personId: string; token: string; apiUrl: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const select = async (stage: string) => {
    setOpen(false);
    onChange(stage);
    try {
      await fetch(`${apiUrl}/api/contacts/${personId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dealStage: stage }),
      });
    } catch { /* silent */ }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[14px] font-medium text-gray-900 hover:text-gray-600 transition-colors"
      >
        {value ?? <span className="text-gray-400 font-normal text-[13px]">Set stage…</span>}
        <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-48 bg-white border border-gray-200 rounded-xl shadow-xl py-1 overflow-hidden">
          {DEAL_STAGES.map(stage => (
            <button
              key={stage}
              onClick={() => select(stage)}
              className="w-full flex items-center justify-between px-3.5 py-2 text-[13px] text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {stage}
              {value === stage && <Check className="h-3.5 w-3.5 text-emerald-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Detail view ──────────────────────────────────────────────────────────────

type Tab = "activity" | "emails" | "calls" | "notes" | "company" | "memory" | "linkedin" | "slack";

interface CompanyData {
  name?: string; domain?: string; industry?: string;
  employee_count?: number; tech_stack?: string[]; location?: string; revenue_range?: string;
}

type ContactMemory = { id: string; content: string; category: string; source: string; created_at: string };

function Detail({ p, onBack, activities, memories, setMemories, company, token, apiUrl, onDealStageChange, onDealValueChange }: {
  p: Person; onBack: () => void; activities: MockEvt[]; memories: ContactMemory[];
  setMemories: React.Dispatch<React.SetStateAction<ContactMemory[]>>;
  company: CompanyData | null; token: string; apiUrl: string;
  onDealStageChange: (id: string, stage: string) => void;
  onDealValueChange: (id: string, value: number | null) => void;
}) {
  const [tab, setTab] = useState<Tab>("activity");
  const [dealStage, setDealStage] = useState(p.dealStage);
  const [dealValue, setDealValue] = useState<string>(p.dealValue != null ? String(p.dealValue) : "");
  const [editCompany,      setEditCompany]      = useState(p.company      ?? "");
  const [editJobTitle,     setEditJobTitle]     = useState(p.title        ?? "");
  const [editLinkedinUrl,  setEditLinkedinUrl]  = useState(p.linkedinUrl  ?? "");
  const [editPhone,        setEditPhone]        = useState(p.phone        ?? "");
  const [editEmail,        setEditEmail]        = useState(p.email        ?? "");
  const [enriching, setEnriching] = useState(false);
  const [enrichStatus, setEnrichStatus] = useState<string | null>(p.enrichmentStatus);
  const [enrichedAt, setEnrichedAt] = useState<string | null>(p.enrichedAt);

  const handleEnrich = async () => {
    if (!p.email?.trim()) {
      toast.error("Can't run enrichment — please make sure this contact has an email address.");
      return;
    }
    setEnriching(true);
    try {
      const res = await fetch(`${apiUrl}/api/contacts/${p.id}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      if (res.status === 402) {
        toast.error("Not enough credits to enrich. Upgrade your plan for more.");
      } else if (res.ok) {
        const { contact, creditsUsed } = await res.json();
        setEnrichStatus(contact.enrichment_status);
        setEnrichedAt(contact.enriched_at);
        if (contact.job_title) setEditJobTitle(contact.job_title);
        if (contact.company)   setEditCompany(contact.company);
        if (contact.enrichment_status === 'complete') {
          toast.success(creditsUsed > 0 ? `Contact enriched · ${creditsUsed} credits used` : "Contact enriched");
        } else if (contact.enrichment_status === 'not_found') {
          toast("No data found", { description: "Couldn't find a match for this contact in our database.", duration: 6000 });
        } else if (contact.enrichment_status === 'failed') {
          toast.error("Enrichment failed. Please try again.", { duration: 6000 });
        }
      } else {
        toast.error("Enrichment failed. Please try again.");
      }
    } catch { toast.error("Enrichment failed. Please try again."); }
    finally { setEnriching(false); }
  };

  const saveDealValue = async () => {
    const num = dealValue.trim() === "" ? null : parseFloat(dealValue.replace(/[^0-9.]/g, ""));
    onDealValueChange(p.id, isNaN(num as number) ? null : num);
    try {
      await fetch(`${apiUrl}/api/contacts/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dealValue: num }),
      });
    } catch { /* silent */ }
  };

  const saveField = async (field: string, value: string) => {
    const toApi: Record<string, string> = { job_title: "jobTitle", linkedin_url: "linkedinUrl" };
    const apiKey = toApi[field] ?? field;
    try {
      await fetch(`${apiUrl}/api/contacts/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [apiKey]: value.trim() || null }),
      });
    } catch { /* silent */ }
  };

  const saveEmail = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === p.email) return;
    try {
      const res = await fetch(`${apiUrl}/api/contacts/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: trimmed }),
      });
      if (res.status === 409) {
        toast.error("A contact with this email already exists.");
        setEditEmail(p.email ?? "");
      } else if (!res.ok) {
        toast.error("Failed to update email.");
        setEditEmail(p.email ?? "");
      }
    } catch { toast.error("Failed to update email."); setEditEmail(p.email ?? ""); }
  };

  const all      = activities;
  const emails   = all.filter(e => e.icon === "email");
  const calls    = all.filter(e => e.icon === "call");
  const notes    = all.filter(e => e.icon === "note");
  const liMsgs   = all.filter(e => e.source === "linkedin" && e.activityType === "linkedin_message")
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  const slackMsgs = all.filter(e => ['slack_message','slack_dm','slack_reaction'].includes(e.activityType))
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  const byYear = all.reduce<Record<string, Record<string, MockEvt[]>>>((acc, e) => {
    const parts = e.month.split(" ");
    const year  = parts[parts.length - 1];
    const month = parts.slice(0, -1).join(" ");
    ((acc[year] ||= {})[month] ||= []).push(e);
    return acc;
  }, {});

  const tabs: { id: Tab; label: string; Icon: React.ComponentType<{className?:string}>; count?: number }[] = [
    { id:"activity", label:"Activity",  Icon:Zap,          count:all.length      },
    { id:"emails",   label:"Emails",    Icon:Mail,          count:emails.length   },
    { id:"linkedin", label:"LinkedIn",  Icon:MessageSquare, count:liMsgs.length   },
    { id:"slack",    label:"Slack",     Icon:Hash,          count:slackMsgs.length },
    { id:"calls",    label:"Calls",     Icon:Phone,         count:calls.length    },
    { id:"notes",    label:"Notes",     Icon:StickyNote,    count:notes.length    },
    { id:"company",  label:"Company",   Icon:Building2                            },
    { id:"memory",   label:"Memory",    Icon:Brain,         count:memories.length },
  ];

  const renderList = (evts: MockEvt[]) =>
    evts.length === 0
      ? <p className="text-[13px] text-gray-400 py-16 text-center">Nothing here yet.</p>
      : <div className="py-4">{evts.map(e => <EvtRow key={e.id} e={e} />)}</div>;

  const isScanning = Object.keys(byYear).length === 0
    && p.createdAt
    && (Date.now() - new Date(p.createdAt).getTime()) < 5 * 60 * 1000;

  const renderTimeline = () => (
    <div className="py-4">
      {Object.keys(byYear).length === 0 && (
        isScanning ? (
          <div className="py-10 flex flex-col items-center gap-3 text-center">
            <div className="flex items-center gap-2 text-[13px] text-gray-400 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
              Scanning activity history…
            </div>
            <p className="text-[12px] text-gray-400 max-w-[260px]">
              Checking Gmail, LinkedIn, Google Calendar, Fireflies & more. Activities will appear here shortly.
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-gray-400 py-16 text-center">No activity logged yet.</p>
        )
      )}
      {Object.entries(byYear).sort(([a], [b]) => Number(b) - Number(a)).map(([year, months]) => (
        <div key={year}>
          <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">{year}</p>
          {Object.entries(months)
            .sort(([a], [b]) => new Date(`1 ${b} 2000`).getTime() - new Date(`1 ${a} 2000`).getTime())
            .map(([month, evts]) => (
            <div key={month} className="mb-5">
              <p className="text-[12px] text-gray-400 mb-2">{month}</p>
              {[...evts].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()).map(e => <EvtRow key={e.id} e={e} />)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  const renderCompany = () => (
    <div className="py-4 space-y-3">
      <div className="rounded-xl border border-gray-100 p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
            <Building2 className="h-5 w-5 text-gray-400" />
          </div>
          <div>
            <p className="text-[15px] font-semibold text-gray-900">{company?.name || p.company || "—"}</p>
            <p className="text-[12px] text-gray-400 mt-0.5">{company?.domain || p.domain || "—"}</p>
          </div>
        </div>
        {company ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 pt-4 border-t border-gray-100">
            {[
              ["Industry",  company.industry],
              ["Employees", company.employee_count ? company.employee_count.toLocaleString() : null],
              ["Location",  company.location],
              ["Revenue",   company.revenue_range],
              ["Tech stack", company.tech_stack?.join(", ")],
            ].filter(([, v]) => v).map(([l, v]) => (
              <div key={l as string}>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">{l}</p>
                <p className="text-[13px] font-medium text-gray-800 mt-1">{v}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-gray-400 pt-4 border-t border-gray-100">
            No company data yet — will populate after enrichment.
          </p>
        )}
      </div>
    </div>
  );

  const [addingMemory, setAddingMemory]   = useState(false);
  const [memoryDraft,  setMemoryDraft]    = useState("");
  const [memoryCategory, setMemoryCategory] = useState("General");
  const [savingMemory, setSavingMemory]   = useState(false);

  const MEMORY_CATEGORIES = ["General", "Pain Points", "Budget", "Timeline", "Objections", "Preferences", "Relationships"];

  const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
    agent:            { label: "Agent",  cls: "bg-violet-50 text-violet-600" },
    signal_extraction:{ label: "Signal", cls: "bg-blue-50 text-blue-500" },
    manual:           { label: "You",    cls: "bg-gray-100 text-gray-500" },
    mcp:              { label: "MCP",    cls: "bg-emerald-50 text-emerald-600" },
  };

  const handleAddMemory = async () => {
    if (!memoryDraft.trim()) return;
    setSavingMemory(true);
    try {
      const res = await fetch(`${apiUrl}/api/contacts/${p.id}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: memoryDraft.trim(), category: memoryCategory }),
      });
      if (!res.ok) throw new Error();
      const { memory } = await res.json();
      setMemories(prev => [memory, ...prev]);
      setMemoryDraft("");
      setAddingMemory(false);
    } catch { /* silent */ }
    finally { setSavingMemory(false); }
  };

  const renderMemories = () => (
    <div className="py-4 space-y-2">
      {/* Add memory row */}
      {addingMemory ? (
        <div className="mb-3 rounded-xl border border-violet-100 bg-violet-50/40 p-3 space-y-2">
          <textarea
            autoFocus
            value={memoryDraft}
            onChange={e => setMemoryDraft(e.target.value)}
            placeholder="Write a fact about this person…"
            rows={3}
            className="w-full text-[13px] text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-violet-300 placeholder:text-gray-400"
          />
          <div className="flex items-center gap-2">
            <select
              value={memoryCategory}
              onChange={e => setMemoryCategory(e.target.value)}
              className="text-[11px] border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 focus:outline-none"
            >
              {MEMORY_CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
            <div className="flex-1" />
            <button onClick={() => { setAddingMemory(false); setMemoryDraft(""); }} className="text-[12px] text-gray-400 hover:text-gray-600 px-2 py-1">Cancel</button>
            <button
              onClick={handleAddMemory}
              disabled={savingMemory || !memoryDraft.trim()}
              className="text-[12px] bg-violet-600 text-white rounded-lg px-3 py-1 hover:bg-violet-700 disabled:opacity-40"
            >
              {savingMemory ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAddingMemory(true)}
          className="w-full flex items-center gap-2 px-3 py-2 mb-1 rounded-xl border border-dashed border-gray-200 text-[12px] text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> Add memory
        </button>
      )}

      {memories.length === 0
        ? <p className="text-[13px] text-gray-400 py-12 text-center">No memories yet. Agents write here automatically.</p>
        : memories.map(m => {
            const badge = SOURCE_BADGE[m.source] ?? { label: m.source, cls: "bg-gray-100 text-gray-500" };
            const ago = (() => {
              if (!m.created_at) return "";
              const d = Math.floor((Date.now() - new Date(m.created_at).getTime()) / 86400000);
              if (isNaN(d) || d < 0) return "Today";
              if (d === 0) return "Today"; if (d === 1) return "Yesterday"; return `${d}d ago`;
            })();
            const showCategory = m.category && m.category !== 'General';
            const showSource = m.source && m.source !== 'api';
            return (
              <div key={m.id} className="rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <div className="flex items-baseline gap-2">
                  <p className="text-[13px] text-gray-800 leading-relaxed flex-1">{m.content}</p>
                  {ago && <span className="text-[11px] text-gray-400 shrink-0">{ago}</span>}
                </div>
                {(showCategory || showSource) && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {showCategory && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-600 border border-indigo-100">{m.category}</span>
                    )}
                    {showSource && (
                      <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-md", badge.cls)}>{badge.label}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })
      }
    </div>
  );


  const content =
    tab === "activity" ? renderTimeline() :
    tab === "emails"   ? renderList(emails) :
    tab === "linkedin" ? renderList(liMsgs) :
    tab === "slack"    ? renderList(slackMsgs) :
    tab === "calls"    ? renderList(calls)  :
    tab === "notes"    ? renderList(notes)  :
    tab === "memory"   ? renderMemories()   :
    renderCompany();

  const stageCfg = STAGE_CONFIG[p.pipelineStage] ?? STAGE_CONFIG.identified;
  const stageSignalSet = new Set(STAGE_SIGNALS[p.pipelineStage] ?? []);
  const lastSignal = activities.find(a => stageSignalSet.has(a.activityType));

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ── Header ─────────────────────────────── */}
      <div className="flex-shrink-0 px-8 pt-7 pb-0">

        {/* Row 1: back + name */}
        <div className="flex items-center gap-3 mb-2">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-700 transition-colors flex-shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h2 className="text-[22px] font-semibold text-gray-900 tracking-tight">{p.name}</h2>
        </div>

        {/* Row 2: meta chips aligned with name */}
        <div className="flex items-center gap-2 pl-7 mb-6 flex-wrap">
          {p.title && <span className="text-[12px] text-gray-500">{p.title}</span>}
          {p.company && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-100 text-[12px] font-medium text-gray-700">
              <Building2 className="h-3 w-3 text-gray-400" />{p.company}
            </span>
          )}
          <span className="text-[12px] text-gray-400">{p.email} · {p.lastInteraction}</span>
        </div>

        {/* Tabs */}
        <div className="flex items-end border-b border-gray-100">
          {tabs.map(({ id, label, Icon, count }) => (
            <button key={id} onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-1.5 mr-7 pb-3 text-[13px] border-b-2 transition-colors",
                tab === id ? "border-gray-900 text-gray-900 font-medium" : "border-transparent text-gray-400 hover:text-gray-700",
              )}>
              <Icon className={cn("h-3.5 w-3.5", tab === id ? "text-gray-600" : "text-gray-400")} />
              {label}
              {count !== undefined && (
                <span className={cn("text-[11px]", tab === id ? "text-gray-400" : "text-gray-300")}>{count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ───────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Main content */}
        <div className="flex-1 overflow-y-auto px-8">{content}</div>

        {/* ── Right panel — inset from right edge ─ */}
        <div className="w-[270px] flex-shrink-0 overflow-y-auto px-5 py-6 mr-16 space-y-4 border-l border-gray-100">

          {/* Record details box */}
          <div className="rounded-xl border border-gray-200 p-5 space-y-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Record Details</p>

            {/* Deal stage — editable */}
            <div>
              <p className="text-[11px] text-gray-400 mb-1">Deal stage</p>
              <DealStageSelect
                value={dealStage}
                personId={p.id}
                token={token}
                apiUrl={apiUrl}
                onChange={(v) => { setDealStage(v); onDealStageChange(p.id, v); }}
              />
            </div>

            {/* Deal value — shown whenever a stage is set */}
            {dealStage && (
              <div>
                <p className="text-[11px] text-gray-400 mb-1">Deal value</p>
                <div className="flex items-center gap-1">
                  <span className="text-[13px] text-gray-400">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={dealValue}
                    onChange={e => setDealValue(e.target.value)}
                    onBlur={saveDealValue}
                    onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    placeholder="0"
                    className="w-full text-[14px] font-medium text-gray-900 bg-transparent border-0 outline-none focus:ring-0 placeholder:text-gray-300"
                  />
                </div>
              </div>
            )}

            <div className="border-t border-gray-100" />

            {([
              ["Name",             p.name],
              ["Deal Health",       p.dealHealthScore !== null ? `${p.dealHealthScore}/100` : "—"],
              ["First contact",    p.firstContact ?? "—"],
              ["Last interaction", p.lastInteraction],
            ] as [string,string][]).map(([lbl, val]) => (
              <div key={lbl}>
                <p className="text-[11px] text-gray-400">{lbl}</p>
                <p className="text-[14px] font-medium text-gray-900 mt-0.5 break-words leading-snug">{val}</p>
              </div>
            ))}

            <div>
              <p className="text-[11px] text-gray-400 mb-0.5">Email</p>
              <input
                type="email"
                value={editEmail}
                onChange={e => setEditEmail(e.target.value)}
                onBlur={() => saveEmail(editEmail)}
                onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                placeholder="—"
                className="w-full text-[14px] font-medium text-gray-900 bg-transparent border-0 outline-none focus:ring-0 placeholder:text-gray-300 leading-snug"
              />
            </div>

            <div>
              <p className="text-[11px] text-gray-400 mb-0.5">Company</p>
              <input
                type="text"
                value={editCompany}
                onChange={e => setEditCompany(e.target.value)}
                onBlur={() => saveField("company", editCompany)}
                onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                placeholder="—"
                className="w-full text-[14px] font-medium text-gray-900 bg-transparent border-0 outline-none focus:ring-0 placeholder:text-gray-300 -ml-0 leading-snug"
              />
            </div>

            <div>
              <p className="text-[11px] text-gray-400 mb-0.5">Job title</p>
              <input
                type="text"
                value={editJobTitle}
                onChange={e => setEditJobTitle(e.target.value)}
                onBlur={() => saveField("job_title", editJobTitle)}
                onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                placeholder="—"
                className="w-full text-[14px] font-medium text-gray-900 bg-transparent border-0 outline-none focus:ring-0 placeholder:text-gray-300 -ml-0 leading-snug"
              />
            </div>

            {p.seniority && (
              <div>
                <p className="text-[11px] text-gray-400">Seniority</p>
                <p className="text-[14px] font-medium text-gray-900 mt-0.5 capitalize">{p.seniority.replace('_', ' ')}</p>
              </div>
            )}

            {p.department && (
              <div>
                <p className="text-[11px] text-gray-400">Department</p>
                <p className="text-[14px] font-medium text-gray-900 mt-0.5 capitalize">{p.department}</p>
              </div>
            )}

            <div>
              <p className="text-[11px] text-gray-400 mb-0.5">Phone</p>
              <input
                type="tel"
                value={editPhone}
                onChange={e => setEditPhone(e.target.value)}
                onBlur={() => saveField("phone", editPhone)}
                onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                placeholder="—"
                className="w-full text-[14px] font-medium text-gray-900 bg-transparent border-0 outline-none focus:ring-0 placeholder:text-gray-300 leading-snug"
              />
            </div>

            {(p.city || p.country) && (
              <div>
                <p className="text-[11px] text-gray-400">Location</p>
                <p className="text-[14px] font-medium text-gray-900 mt-0.5">{[p.city, p.country].filter(Boolean).join(', ')}</p>
              </div>
            )}

            <div>
              <div className="flex items-center gap-1.5 mb-0.5">
                <p className="text-[11px] text-gray-400">LinkedIn</p>
                {editLinkedinUrl && (
                  <a href={editLinkedinUrl} target="_blank" rel="noopener noreferrer" className="text-gray-300 hover:text-[#0A66C2] transition-colors">
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <input
                type="text"
                value={editLinkedinUrl}
                onChange={e => setEditLinkedinUrl(e.target.value)}
                onBlur={() => saveField("linkedin_url", editLinkedinUrl)}
                onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                placeholder="—"
                className="w-full text-[14px] font-medium text-gray-900 bg-transparent border-0 outline-none focus:ring-0 placeholder:text-gray-300 leading-snug"
              />
            </div>

            <div>
              <p className="text-[11px] text-gray-400">Pipeline stage</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={cn("h-2.5 w-2.5 rounded-full flex-shrink-0", stageCfg.dot)} />
                <p className={cn("text-[14px] font-medium", stageCfg.text)}>{stageCfg.label}</p>
              </div>
              {p.pipelineStageSource === 'manual' ? (
                <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">Manually set.</p>
              ) : lastSignal ? (
                <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                  Last signal: <span className="text-gray-600">{SIGNAL_LABEL[lastSignal.activityType] ?? lastSignal.activityType}</span> · {lastSignal.time}
                </p>
              ) : (
                <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{stageCfg.description}</p>
              )}
              {p.pipelineStageUpdatedAt && (
                <p className="text-[10px] text-gray-300 mt-0.5">Updated {timeLabel(p.pipelineStageUpdatedAt)}</p>
              )}
            </div>

            <div>
              <p className="text-[11px] text-gray-400 mb-1.5">ICP Fit</p>
              {p.icpFit === null ? (
                <span className="text-[13px] text-gray-300">—</span>
              ) : p.icpFit ? (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold bg-emerald-50 text-emerald-700">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                    ICP Match
                  </span>
                  {(p as any).icpScore != null && (
                    <span className="text-[12px] font-medium text-gray-400">{(p as any).icpScore}<span className="text-gray-300">/100</span></span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium bg-gray-100 text-gray-400">
                    No fit
                  </span>
                  {(p as any).icpScore != null && (
                    <span className="text-[12px] font-medium text-gray-400">{(p as any).icpScore}<span className="text-gray-300">/100</span></span>
                  )}
                </div>
              )}
              {(p as any).icpReasoning && (
                <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">{(p as any).icpReasoning}</p>
              )}
            </div>

            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-gray-400">Enrichment</p>
                {enrichStatus === 'complete' && enrichedAt && (
                  <p className="text-[10px] text-gray-300">{timeLabel(enrichedAt)}</p>
                )}
              </div>
              <button
                onClick={handleEnrich}
                disabled={enriching}
                className={cn(
                  "w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-colors",
                  enrichStatus === 'complete'
                    ? "border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                    : "bg-gray-900 text-white hover:bg-gray-800",
                  enriching && "opacity-60 cursor-not-allowed"
                )}
              >
                {enriching
                  ? <><Loader2 className="h-3 w-3 animate-spin" />Enriching…</>
                  : enrichStatus === 'complete'
                    ? "Re-enrich · 5 credits"
                    : "Enrich · 5 credits"
                }
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── Source filter dropdown ───────────────────────────────────────────────────

const SOURCES = [
  { value: "",          label: "All sources" },
  { value: "rb2b",      label: "RB2B"        },
  { value: "instantly", label: "Instantly"   },
  { value: "linkedin",  label: "LinkedIn"    },
  { value: "gmail",     label: "Gmail"       },
  { value: "apollo",    label: "Apollo"      },
  { value: "fireflies", label: "Fireflies"   },
  { value: "calendly",  label: "Calendly"    },
  { value: "hubspot",   label: "HubSpot"     },
  { value: "manual",    label: "Manual"      },
];

function SourceDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const current = SOURCES.find(s => s.value === value) ?? SOURCES[0];

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
        {value ? `Source: ${current.label}` : "Source: All"}
        <ChevronDown className="h-3 w-3 text-gray-400" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-40 bg-white border border-gray-200 rounded-xl shadow-xl py-1 overflow-hidden">
          {SOURCES.map(s => (
            <button
              key={s.value}
              onClick={() => { onChange(s.value); setOpen(false); }}
              className="w-full flex items-center justify-between px-3.5 py-2 text-[13px] text-gray-700 hover:bg-gray-50 transition-colors"
            >
              {s.label}
              {value === s.value && <Check className="h-3.5 w-3.5 text-teal-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Deal stage filter dropdown ───────────────────────────────────────────────

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

// ─── List view ────────────────────────────────────────────────────────────────

type Filter = "all" | "aware" | "interested" | "evaluating" | "client";
type SortKey = "last_interaction" | "interactions_desc" | "interactions_asc";

export default function People() {
  const { userData, session } = useAuth();
  const navigate = useNavigate();
  const workspaceId = userData?.workspace?.id;
  const apiUrl = import.meta.env.VITE_API_URL ?? "";

  const [filter, setFilter]           = useState<Filter>(() => (localStorage.getItem("people_filter") as Filter) || "all");
  const [source, setSource]           = useState(() => localStorage.getItem("people_source") || "");
  const [dealStageFilter, setDealStageFilter] = useState(() => localStorage.getItem("people_deal_stage") || "");
  const [sort, setSort]               = useState<SortKey>(() => (localStorage.getItem("people_sort") as SortKey) || "last_interaction");
  const [search, setSearch]           = useState("");
  const [page, setPage]               = useState(0);
  const PAGE_SIZE = 50;
  const [selected, setSelected]       = useState<Person | null>(null);

  // Persist filter/sort to localStorage
  useEffect(() => { localStorage.setItem("people_filter", filter); }, [filter]);
  useEffect(() => { localStorage.setItem("people_source", source); }, [source]);
  useEffect(() => { localStorage.setItem("people_deal_stage", dealStageFilter); }, [dealStageFilter]);
  useEffect(() => { localStorage.setItem("people_sort", sort); }, [sort]);

  // Reset to page 0 whenever filters/search/sort change
  useEffect(() => { setPage(0); }, [search, filter, source, sort]);
  const [checked, setChecked]         = useState<Set<string>>(new Set());
  const [deleting, setDeleting]       = useState(false);
  const [showTaskModal, setShowTaskModal]     = useState(false);
  const [selectedTaskId, setSelectedTaskId]   = useState<string | null>(null);
  const [creatingTask, setCreatingTask]       = useState(false);
  const [importing, setImporting]     = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [dragOver, setDragOver]        = useState(false);
  const [crmImporting, setCrmImporting] = useState<'hubspot' | 'salesforce' | null>(null);
  const [crmImportResult, setCrmImportResult] = useState<{ provider: string; imported: number } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [importStep, setImportStep]       = useState<'upload' | 'mapping' | 'scanning'>('upload');
  const [enrichJobId, setEnrichJobId]     = useState<string | null>(null);
  const [enrichProgress, setEnrichProgress] = useState<{contacts: EnrichContact[], done: boolean} | null>(null);
  const [csvHeaders, setCsvHeaders]       = useState<string[]>([]);
  const [csvSampleRow, setCsvSampleRow]   = useState<Record<string, string>>({});
  const [csvAllRows, setCsvAllRows]       = useState<Record<string, string>[]>([]);
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>({});

  // Column widths (px) — draggable
  const COL_WIDTHS_KEY = "people_col_widths";
  const DEFAULT_COL_WIDTHS = {
    name: 170, company: 145, domain: 155, linkedin: 80, connection: 115,
    dealHealth: 110, lastInteraction: 130, icpFit: 95, source: 135, segment: 120, dealStage: 140, enrichment: 110,
  };
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(COL_WIDTHS_KEY);
      return saved ? { ...DEFAULT_COL_WIDTHS, ...JSON.parse(saved) } : DEFAULT_COL_WIDTHS;
    } catch { return DEFAULT_COL_WIDTHS; }
  });
  const resizeRef = useRef<{ col: string; startX: number; startW: number } | null>(null);

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
      if (resizeRef.current) {
        setColWidths(prev => {
          try { localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(prev)); } catch {}
          return prev;
        });
      }
      resizeRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const [people, setPeople]     = useState<Person[]>([]);
  const [loading, setLoading]   = useState(false);
  const [total, setTotal]       = useState(0);
  const [error, setError]       = useState(false);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [prospectUsage, setProspectUsage] = useState<{ current: number; limit: number | null; percentage: number } | null>(null);

  const [detailActivities, setDetailActivities] = useState<MockEvt[]>([]);
  const [detailMemories, setDetailMemories]     = useState<ContactMemory[]>([]);
  const [detailCompany, setDetailCompany]       = useState<CompanyData | null>(null);

  // ── Fetch prospect usage ────────────────────────────────────────────────────
  useEffect(() => {
    if (!session?.access_token) return;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/usage`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        const p = data?.usage?.prospects;
        if (p) setProspectUsage({ current: p.current, limit: p.limit, percentage: p.percentage });
      } catch {}
    })();
  }, [session?.access_token, apiUrl]);

  // ── Fetch list ──────────────────────────────────────────────────────────────
  const fetchPeople = useCallback(async () => {
    if (!workspaceId || !session?.access_token) return;
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams({ workspaceId });
      if (search.trim()) params.set("search", search.trim());
      if (filter !== "all") params.set("filter", filter);
      if (source) params.set("source", source);
      if (sort !== "last_interaction") params.set("sort", sort);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(page * PAGE_SIZE));

      const res = await fetch(`${apiUrl}/api/contacts?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPeople((data.contacts || []).map(mapContactToPerson));
      setTotal(data.total || 0);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, session?.access_token, search, filter, source, sort, page, apiUrl]);

  useEffect(() => { fetchPeople(); }, [fetchPeople]);

  // ── Enrichment progress polling ─────────────────────────────────────────────
  useEffect(() => {
    if (importStep !== 'scanning' || !enrichJobId || !session?.access_token) return;
    const poll = async () => {
      try {
        const r = await fetch(`${apiUrl}/api/contacts/enrich-progress/${enrichJobId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!r.ok) return;
        const d = await r.json();
        if (d.found) {
          setEnrichProgress({ contacts: d.contacts, done: d.done });
          if (d.done) fetchPeople();
        }
      } catch { /* silent */ }
    };
    poll();
    const id = setInterval(poll, 1500);
    return () => clearInterval(id);
  }, [importStep, enrichJobId, session?.access_token, apiUrl]);

  // ── Export CSV ──────────────────────────────────────────────────────────────
  const exportCSV = () => {
    if (!people.length) return;
    const headers = ["Name","Email","Company","Domain","Pipeline Stage","Deal Stage","ICP Fit","Source","Deal Health","Last Interaction","First Contact"];
    const rows = people.map(p => [
      p.name, p.email, p.company ?? "", p.domain ?? "", STAGE_CONFIG[p.pipelineStage]?.label ?? p.pipelineStage,
      p.dealStage ?? "", p.icpFit === null ? "" : p.icpFit ? "Yes" : "No",
      p.source ?? "", p.dealHealthScore ?? "", p.lastInteraction, p.firstContact ?? "",
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a"); a.href = url; a.download = "people.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Open detail ─────────────────────────────────────────────────────────────
  const openDetail = useCallback(async (person: Person) => {
    if (!session?.access_token) return;
    setSelected(person);
    setDetailActivities([]);
    setDetailMemories([]);
    setDetailCompany(null);
    try {
      const res = await fetch(`${apiUrl}/api/contacts/${person.id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();

      const acts: MockEvt[] = (data.activities || []).map((a: {
        id:string; activity_type:string; title:string; subtitle:string|null; source:string; created_at:string; raw_data?: Record<string,unknown>|null;
      }) => ({
        id: a.id,
        icon: iconForType(a.activity_type),
        title: a.title,
        subtitle: a.subtitle || "",
        time: timeLabel(a.created_at, a.source !== "manual" ? a.source : undefined),
        month: monthLabel(a.created_at),
        activityType: a.activity_type,
        source: a.source || "",
        occurredAt: a.created_at,
        rawData: a.raw_data || null,
      }));

      setDetailActivities(acts);
      setDetailMemories(data.memories || []);
      setDetailCompany(data.company || null);
    } catch {
      setDetailActivities([]);
      setDetailMemories([]);
      setDetailCompany(null);
    }
  }, [session?.access_token, apiUrl]);

  const handleDealStageChange = (id: string, stage: string) => {
    setPeople(prev => prev.map(p => p.id === id ? { ...p, dealStage: stage } : p));
    setSelected(prev => prev?.id === id ? { ...prev, dealStage: stage } : prev);
  };

  const handleDealValueChange = (id: string, value: number | null) => {
    setPeople(prev => prev.map(p => p.id === id ? { ...p, dealValue: value } : p));
    setSelected(prev => prev?.id === id ? { ...prev, dealValue: value } : prev);
  };

  const handleEnrichRow = async (contactId: string) => {
    if (enrichingId || !session?.access_token) return;
    setEnrichingId(contactId);
    try {
      const res = await fetch(`${apiUrl}/api/contacts/${contactId}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 402) {
        toast.error("Not enough credits to enrich. Upgrade your plan for more.");
      } else if (res.ok) {
        const { contact, creditsUsed } = await res.json();
        if (contact.enrichment_status === 'complete') {
          toast.success(creditsUsed > 0 ? `Contact enriched · ${creditsUsed} credits used` : "Contact enriched");
        } else if (contact.enrichment_status === 'not_found') {
          toast("No data found", { description: "Couldn't find a match for this contact in our database.", duration: 6000 });
        } else if (contact.enrichment_status === 'failed') {
          toast.error("Enrichment failed. Please try again.", { duration: 6000 });
        }
        const enriched = (base: Person) => ({
          ...base,
          company:          contact.company ?? base.company,
          domain:           contact.domain  ?? base.domain,
          title:            contact.job_title    ?? base.title,
          phone:            contact.phone        ?? base.phone,
          seniority:        contact.seniority    ?? base.seniority,
          department:       contact.department   ?? base.department,
          city:             contact.city         ?? base.city,
          country:          contact.country      ?? base.country,
          linkedinUrl:      contact.linkedin_url ?? base.linkedinUrl,
          icpFit:           contact.icp_fit      ?? base.icpFit,
          icpScore:         contact.icp_score    ?? base.icpScore,
          icpReasoning:     contact.icp_reasoning ?? base.icpReasoning,
          enrichmentStatus: contact.enrichment_status ?? base.enrichmentStatus,
          enrichedAt:       contact.enriched_at  ?? base.enrichedAt,
        });
        setPeople(prev => prev.map(p => p.id === contactId ? enriched(p) : p));
        setSelected(prev => prev?.id === contactId ? enriched(prev) : prev);
      } else {
        toast.error("Enrichment failed. Please try again.");
      }
    } catch { toast.error("Enrichment failed. Please try again."); }
    finally { setEnrichingId(null); }
  };

  // ── Set up new task — open template picker modal ─────────────────────────────
  const handleSetupTask = () => setShowTaskModal(true);

  const TASK_TEMPLATES = [
    {
      id: 'website_inbound_email', Icon: Globe,
      name: 'Website Inbound Follow-up',
      description: 'Visitor identified on your site → assistant creates contact & sends personalized outreach',
      triggerType: 'rb2b_webhook',
      steps: [
        { logo: '/provider-logos/rb2b.svg', label: 'Visitor identified' },
        { wait: '10 minutes' },
        { logo: '/newlogoP.png', label: 'Assistant' },
      ],
    },
    {
      id: 'cold_outreach_followup', Icon: MailOpen,
      name: 'Cold Outreach Follow-up',
      description: 'Positive reply in Instantly → assistant sends warm follow-up email',
      triggerType: 'instantly_webhook',
      steps: [
        { logo: '/provider-logos/instantly.svg', label: 'Positive reply' },
        { wait: '7 minutes' },
        { logo: '/newlogoP.png', label: 'Assistant' },
      ],
    },
    {
      id: 'blank', Icon: Plus,
      name: 'Start from Scratch',
      description: 'Build a fully custom task in the task builder',
      triggerType: 'manual',
      steps: [] as Array<{ logo: string; label: string } | { wait: string }>,
    },
  ] as const;

  const buildTemplateSteps = (id: string): { steps: any[]; triggerType: string } => {
    const t = Date.now();
    const base = (order: number, extra: object) => ({
      field_mappings: {}, expressions: {},
      ...extra,
      id: `step-${t + order}`,
      order,
    });

    if (id === 'website_inbound_email') {
      return {
        triggerType: 'rb2b_webhook',
        steps: [
          base(0, { type: 'trigger', category: 'trigger', name: 'Visitor Identified (RB2B)', config: { action: 'rb2b_webhook', settings: {} }, outputs: { schema: {} } }),
          base(1, { type: 'utility', category: 'utility', name: 'Wait 10 minutes', config: { action: 'wait', settings: { duration_ms: 600_000 } } }),
          base(2, {
            type: 'action', category: 'ai', name: 'Assistant', provider_logo: '/newlogoP.png',
            config: {
              action: 'assistant_call',
              settings: {
                model: 'claude-haiku-4-5-20251001',
                instructions: `A website visitor was just identified via RB2B. The trigger data contains their email, name, company, LinkedIn URL, and the page(s) they visited.\n\nStep 1 — Look them up: Call get_contact with their email to check if they already exist in the CRM.\n\nStep 2 — Save them: Call upsert_contact to create or update the contact with their name, company, and any other details from the trigger data.\n\nStep 3 — Update their stage: Call update_pipeline_stage to move them to "aware" (they visited the site — first real signal).\n\nStep 4 — Save a memory: Call save_contact_memory with a fact like "Visited [page name] via RB2B on [date]" so the agent has context next time.\n\nStep 5 — Send the email: Call send_email via Gmail. Write a short, genuinely curious message — 2–3 sentences max. No pitch, no "just checking in", no formal opener. Reference the specific page they visited to show it's not a blast email. Examples by page:\n- Pricing page: "Saw you were checking out our pricing — happy to walk you through what makes sense for your setup if helpful."\n- Features/product page: "Noticed you were looking around [page name] — curious if you had any questions or if there's something specific you were trying to figure out."\n- Blog/docs: "Saw you came across our [article/docs] — let me know if anything sparked questions."\n\nSign off with your name only. No subject line fluff like "Quick question" or "Following up". Keep the subject simple: "Hey [first name]" or just use their company context.`,
                tool_calls: [{ id: `tc-${t}`, platform: 'gmail', platform_label: 'Gmail', action: 'send_email', action_label: 'Send Email', logo: '/provider-logos/gmail.svg' }],
              },
            },
            outputs: { schema: { response: { type: 'string' } } },
          }),
        ],
      };
    }
    if (id === 'cold_outreach_followup') {
      return {
        triggerType: 'instantly_webhook',
        steps: [
          base(0, { type: 'trigger', category: 'trigger', name: 'Positive Reply (Instantly)', config: { action: 'instantly_webhook', settings: {} }, outputs: { schema: {} } }),
          base(1, { type: 'utility', category: 'utility', name: 'Wait 7 minutes', config: { action: 'wait', settings: { duration_ms: 420_000 } } }),
          base(2, {
            type: 'action', category: 'ai', name: 'Assistant', provider_logo: '/newlogoP.png',
            config: {
              action: 'assistant_call',
              settings: {
                model: 'claude-haiku-4-5-20251001',
                instructions: `A lead just replied positively to a cold outreach email sent via Instantly. The trigger data contains their email (lead_email), name (lead_name), company, the campaign name, and their reply text.\n\nStep 1 — Look them up: Call get_contact with lead_email to check if they already exist.\n\nStep 2 — Save them: Call upsert_contact to create or update them with their name, company, and source "instantly".\n\nStep 3 — Update their stage: Call update_pipeline_stage to move them to "interested" — they replied positively, this is a real buying signal.\n\nStep 4 — Save a memory: Call save_contact_memory with a fact like "Replied positively to [campaign_name] outreach — [brief summary of their reply]" so the context is preserved.\n\nStep 5 — Send the follow-up: Call send_email via Gmail. Your one goal is to get a call booked. Rules:\n- Acknowledge their reply warmly but briefly — one sentence max.\n- Ask for a 15–20 min call to figure out if there's a fit.\n- Either suggest 2–3 concrete time slots OR ask them to share their calendar link.\n- Do NOT re-pitch the product. Do NOT attach anything. Do NOT use phrases like "circling back", "as per my last email", "hope this finds you well".\n- Keep it to 3–4 sentences total. Conversational, direct.\n\nExample tone: "Great to hear from you! Would love to connect for a quick 15 min call to see if we can help — are you free Thursday or Friday afternoon? Happy to work around your schedule."`,
                tool_calls: [{ id: `tc-${t}`, platform: 'gmail', platform_label: 'Gmail', action: 'send_email', action_label: 'Send Email', logo: '/provider-logos/gmail.svg' }],
              },
            },
            outputs: { schema: { response: { type: 'string' } } },
          }),
        ],
      };
    }
    if (id === 'discovery_call_proposal') {
      return {
        triggerType: 'discover_call',
        steps: [
          base(0, { type: 'trigger', category: 'trigger', name: 'Call Transcribed (Fireflies)', config: { action: 'discover_call', settings: {} }, outputs: { schema: {} } }),
          base(1, {
            type: 'action', category: 'ai', name: 'Assistant', provider_logo: '/newlogoP.png',
            config: {
              action: 'assistant_call',
              settings: {
                model: 'claude-haiku-4-5-20251001',
                instructions: `A discovery call was just transcribed. The meeting data is in the trigger (participants, transcript summary).\n\nLog a "meeting" activity for the contact, move them to "evaluating" stage, then send a follow-up email: thank them for the call, recap key pain points, explain how we can help, and suggest a next step. Professional but warm.`,
                tool_calls: [{ id: `tc-${t}`, platform: 'gmail', platform_label: 'Gmail', action: 'send_email', action_label: 'Send Email', logo: '/provider-logos/gmail.svg' }],
              },
            },
            outputs: { schema: { response: { type: 'string' } } },
          }),
        ],
      };
    }
    if (id === 'linkedin_social_followup') {
      return {
        triggerType: 'webhook',
        steps: [
          base(0, { type: 'trigger', category: 'trigger', name: 'New Connection (LinkedIn)', config: { action: 'webhook', settings: {} }, outputs: { schema: {} } }),
          base(1, {
            type: 'action', category: 'ai', name: 'Assistant', provider_logo: '/newlogoP.png',
            config: {
              action: 'assistant_call',
              settings: {
                model: 'claude-haiku-4-5-20251001',
                instructions: `A new LinkedIn connection just came in. Their details are in the trigger data.\n\nCreate or update them as a contact, log "Connected on LinkedIn", then send a short intro email. Don't pitch — just introduce yourself, mention you saw their profile, and open a conversation. 3–4 sentences max.`,
                tool_calls: [{ id: `tc-${t}`, platform: 'gmail', platform_label: 'Gmail', action: 'send_email', action_label: 'Send Email', logo: '/provider-logos/gmail.svg' }],
              },
            },
            outputs: { schema: { response: { type: 'string' } } },
          }),
        ],
      };
    }
    return { triggerType: 'manual', steps: [] };
  };

  const handlePickTemplate = async (tpl: typeof TASK_TEMPLATES[0]) => {
    if (!session?.access_token || !workspaceId || creatingTask) return;
    setCreatingTask(true);
    try {
      const { steps, triggerType } = buildTemplateSteps(tpl.id);
      const res = await fetch(`${apiUrl}/api/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: tpl.id === 'blank' ? 'New task' : tpl.name,
          display_mode: 'task',
          trigger_type: triggerType,
          definition: { steps, variables: {} },
        }),
      });
      const data = await res.json();
      console.log('[CREATE_TASK] response', res.status, JSON.stringify(data));
      if (!res.ok) {
        if (data?.code === 'WORKFLOW_LIMIT_EXCEEDED') {
          toast.error(`Task limit reached (${data.current_count}/${data.limit}). Upgrade your plan to create more.`);
        } else {
          toast.error(data?.message || `Failed to create task (${res.status})`);
        }
        return;
      }
      setShowTaskModal(false);
      navigate(`/workflows/${data.workflow?.id || data.id}/builder`);
    } catch (e) {
      console.error('[People] Failed to create task:', e);
      toast.error('Failed to create task');
    } finally {
      setCreatingTask(false);
    }
  };

  // ── CSV import ───────────────────────────────────────────────────────────────
  const parseCSVFile = async (file: File) => {
    try {
      const text = await file.text();
      const lines = text.trim().split(/\r?\n/);
      if (lines.length < 2) { toast.error("CSV file is empty or has no data rows"); return; }
      const headers = parseCSVLine(lines[0]);
      if (!headers.length) { toast.error("Could not read CSV headers"); return; }
      const rows = lines.slice(1)
        .map(line => {
          const vals = parseCSVLine(line);
          const row: Record<string, string> = {};
          headers.forEach((h, i) => { row[h] = vals[i]?.trim() || ''; });
          return row;
        })
        .filter(r => Object.values(r).some(v => v));
      setCsvHeaders(headers);
      setCsvAllRows(rows);
      setCsvSampleRow(rows[0] || {});
      setFieldMappings(detectMappings(headers));
      setImportStep('mapping');
    } catch {
      toast.error("Failed to parse CSV file");
    }
  };

  const runImport = async () => {
    if (!session?.access_token || !workspaceId) return;
    setImporting(true);
    try {
      const rows = csvAllRows
        .map(row => {
          const mapped: Record<string, string> = {};
          for (const [csvCol, field] of Object.entries(fieldMappings)) {
            if (field && row[csvCol]) mapped[field] = row[csvCol];
          }
          // Split full_name into first_name / last_name if needed
          if (mapped.full_name && !mapped.first_name && !mapped.last_name) {
            const parts = mapped.full_name.trim().split(/\s+/);
            mapped.first_name = parts[0] || '';
            mapped.last_name = parts.slice(1).join(' ') || '';
            delete mapped.full_name;
          }
          return mapped;
        })
        .filter(r => r.email || r.linkedin_url);

      if (!rows.length) {
        toast.error("No rows with a mapped Email or LinkedIn URL column — please map at least one");
        setImporting(false);
        return;
      }

      const res = await fetch(`${apiUrl}/api/contacts/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspaceId, rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      fetchPeople();
      if (data.jobId && data.created > 0) {
        setEnrichJobId(data.jobId);
        setEnrichProgress(null);
        setImportStep('scanning');
      } else {
        toast.success(data.updated > 0 ? `${data.updated} contacts updated` : "Import complete");
        setShowImportModal(false);
        setImportStep('upload');
      }
    } catch (err: any) {
      toast.error(err.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) parseCSVFile(file);
  };

  const handleCrmImport = async (provider: 'hubspot' | 'salesforce') => {
    if (!session?.access_token || !workspaceId) return;
    setCrmImporting(provider);
    setCrmImportResult(null);
    try {
      const r = await fetch(`${apiUrl}/api/crm/sync-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspaceId, provider }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Import failed');
      setCrmImportResult({ provider, imported: d.imported });
      fetchPeople();
    } catch (e: any) {
      if (e.message?.includes('Sync not configured')) {
        window.location.href = '/integrations';
      } else {
        toast.error(e.message || 'CRM import failed');
      }
    } finally {
      setCrmImporting(null);
    }
  };

  // ── Delete selected ──────────────────────────────────────────────────────────
  const deleteChecked = async () => {
    if (!session?.access_token || checked.size === 0 || deleting) return;
    setDeleting(true);
    const ids = Array.from(checked);
    try {
      await Promise.allSettled(ids.map(id =>
        fetch(`${apiUrl}/api/contacts/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
      ));
      setChecked(new Set());
      await fetchPeople();
    } finally {
      setDeleting(false);
    }
  };

  if (selected && session?.access_token) {
    return (
      <Detail
        p={selected}
        onBack={() => setSelected(null)}
        activities={detailActivities}
        memories={detailMemories}
        setMemories={setDetailMemories}
        company={detailCompany}
        token={session.access_token}
        apiUrl={apiUrl}
        onDealStageChange={handleDealStageChange}
        onDealValueChange={handleDealValueChange}
      />
    );
  }

  const toggleCheck = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setChecked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleAll = () => {
    if (checked.size === people.length) setChecked(new Set());
    else setChecked(new Set(people.map(p => p.id)));
  };

  // Client-side deal stage filter applied on top of server results
  const displayed = dealStageFilter
    ? people.filter(p => p.dealStage === dealStageFilter)
    : people;

  const filterTabs: { id: Filter; label: string; dot?: string }[] = [
    { id:"all",        label:"All"        },
    { id:"aware",      label:"Aware",      dot: STAGE_CONFIG.aware.dot      },
    { id:"interested", label:"Interested", dot: STAGE_CONFIG.interested.dot },
    { id:"evaluating", label:"Evaluating", dot: STAGE_CONFIG.evaluating.dot },
    { id:"client",     label:"Client",     dot: STAGE_CONFIG.client.dot     },
  ];

  // helper: resize handle
  const ResizeHandle = ({ col }: { col: string }) => (
    <div
      onMouseDown={e => startResize(col, e)}
      className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-teal-300 opacity-0 group-hover/th:opacity-100 transition-opacity"
    />
  );

  return (
    <div className="flex flex-col h-full bg-white">
      <style>{`
        @keyframes enrich-scan {
          0%   { background-position: -100% 0; }
          100% { background-position: 250% 0; }
        }
        @keyframes enrich-dot {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40%            { transform: scale(1);   opacity: 1;   }
        }
      `}</style>

      {/* ── Prospect limit banner ──────────────── */}
      {prospectUsage && prospectUsage.limit !== null && prospectUsage.percentage >= 80 && (
        <div className={cn(
          "flex items-center justify-between gap-3 px-5 py-2.5 text-[12px] font-medium border-b",
          prospectUsage.percentage >= 100
            ? "bg-red-50 border-red-100 text-red-700"
            : "bg-amber-50 border-amber-100 text-amber-700"
        )}>
          <span>
            {prospectUsage.percentage >= 100
              ? `You've hit your ${prospectUsage.limit.toLocaleString()} prospect limit — new contacts are blocked.`
              : `${prospectUsage.current.toLocaleString()} / ${prospectUsage.limit.toLocaleString()} prospects used (${prospectUsage.percentage}%). Upgrade before you run out.`
            }
          </span>
          <button
            onClick={() => window.location.href = '/settings?tab=billing'}
            className={cn(
              "shrink-0 px-3 py-1 rounded-full text-[11px] font-semibold transition-colors",
              prospectUsage.percentage >= 100
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-amber-500 text-white hover:bg-amber-600"
            )}
          >
            Upgrade
          </button>
        </div>
      )}

      {/* ── Task Template Modal ─────────────────── */}
      {showTaskModal && (() => {
        const selected = TASK_TEMPLATES.find(t => t.id === selectedTaskId) ?? null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={() => { setShowTaskModal(false); setSelectedTaskId(null); }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
                <div>
                  <h2 className="text-[15px] font-semibold text-gray-900">Set up a task</h2>
                  <p className="text-[11px] text-gray-400 mt-0.5">Pick a template or start from scratch</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => selected && handlePickTemplate(selected)}
                    disabled={!selected || creatingTask}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all",
                      selected && !creatingTask
                        ? "bg-gray-900 text-white hover:bg-gray-800"
                        : "bg-gray-100 text-gray-400 cursor-not-allowed"
                    )}
                  >
                    {creatingTask ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    Create Task
                  </button>
                  <button onClick={() => { setShowTaskModal(false); setSelectedTaskId(null); }} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                    <X className="h-4 w-4 text-gray-400" />
                  </button>
                </div>
              </div>

              {/* Template list */}
              <div className="overflow-y-auto max-h-[440px] divide-y divide-gray-50 pb-6">
                {TASK_TEMPLATES.map(tpl => {
                  const isOpen = selectedTaskId === tpl.id;
                  const TplIcon = tpl.Icon;
                  return (
                    <div key={tpl.id}>
                      <button
                        onClick={() => setSelectedTaskId(isOpen ? null : tpl.id)}
                        className={cn(
                          "w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors",
                          isOpen ? "bg-gray-50" : "hover:bg-gray-50/70"
                        )}
                      >
                        <div className={cn(
                          "flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 transition-colors",
                          isOpen ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"
                        )}>
                          <TplIcon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-gray-900 leading-snug">{tpl.name}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{tpl.description}</p>
                        </div>
                        <ChevronRight className={cn("h-4 w-4 text-gray-300 flex-shrink-0 transition-transform", isOpen && "rotate-90")} />
                      </button>

                      {/* Expanded step flow */}
                      {isOpen && (
                        <div className="px-5 pb-4 bg-gray-50">
                          {tpl.steps.length === 0 ? (
                            <p className="text-[12px] text-gray-400 py-2">Opens the task builder with a blank canvas.</p>
                          ) : (
                            <div className="flex flex-col gap-0 pt-1">
                              {tpl.steps.map((step, i) => (
                                <div key={i} className="flex items-center gap-3 relative">
                                  {/* Connector line */}
                                  {i < tpl.steps.length - 1 && (
                                    <div className="absolute left-[14px] top-[28px] w-px h-[calc(100%-4px)] bg-gray-150" style={{ background: '#e5e7eb' }} />
                                  )}
                                  {/* Step number */}
                                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white border border-gray-200 flex items-center justify-center z-10">
                                    <span className="text-[10px] font-semibold text-gray-400">{i + 1}</span>
                                  </div>
                                  {/* Content */}
                                  <div className={cn("flex items-center gap-2 py-3", i < tpl.steps.length - 1 && "pb-3")}>
                                    {'wait' in step ? (
                                      <>
                                        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-gray-100">
                                          <Clock className="h-3.5 w-3.5 text-gray-400" />
                                        </div>
                                        <span className="text-[12px] text-gray-500">Wait <span className="font-medium text-gray-700">{step.wait}</span></span>
                                      </>
                                    ) : (
                                      <>
                                        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-white border border-gray-100 shadow-sm">
                                          <img src={step.logo} alt="" className="h-3.5 w-3.5 object-contain" />
                                        </div>
                                        <span className="text-[12px] font-medium text-gray-800">{step.label}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── CSV Import Modal ─────────────────── */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
          <div className={cn("bg-white rounded-2xl shadow-2xl w-full mx-4 overflow-hidden", importStep === 'mapping' ? "max-w-xl" : "max-w-md")}>
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <h2 className="text-[15px] font-semibold text-gray-900">Import people</h2>
              <button
                onClick={() => { setShowImportModal(false); setImportStep('upload'); setEnrichJobId(null); setEnrichProgress(null); }}
                className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {importStep === 'scanning' ? (() => {
              const LABELS: Record<string, string> = {
                gmail: 'Gmail', smtp: 'Email (SMTP)', linkedin: 'LinkedIn',
                instantly: 'Instantly', slack: 'Slack',
              };
              const totalFound = enrichProgress?.contacts.reduce((sum, c) =>
                sum + Object.values(c.sources).reduce((s, src) => s + (src.count || 0), 0), 0) ?? 0;
              return (
                <div className="px-6 py-5">
                  <div className="flex items-center gap-2 mb-4">
                    {enrichProgress?.done
                      ? <Check className="h-4 w-4 text-green-500" />
                      : <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                    <span className="text-[14px] font-semibold text-gray-900">
                      {enrichProgress?.done
                        ? `Scan complete · ${totalFound} activit${totalFound !== 1 ? 'ies' : 'y'} found`
                        : 'Scanning contact history…'}
                    </span>
                  </div>

                  <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
                    {enrichProgress?.contacts.map(contact => {
                      const active = Object.entries(contact.sources).filter(([, s]) => s.status !== 'skipped');
                      return (
                        <div key={contact.id} className="bg-gray-50 rounded-xl p-3.5">
                          <p className="text-[13px] font-semibold text-gray-800 mb-2">{contact.name}
                            <span className="font-normal text-gray-400 ml-1.5">{contact.email}</span>
                          </p>
                          <div className="space-y-1.5">
                            {active.map(([src, s]) => (
                              <div key={src} className="flex items-center justify-between">
                                <span className="text-[12px] text-gray-500">{LABELS[src] ?? src}</span>
                                {s.status === 'pending' && <span className="text-[11px] text-gray-300">waiting…</span>}
                                {s.status === 'scanning' && (
                                  <span className="flex items-center gap-1 text-[11px] text-blue-500">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse inline-block" />
                                    scanning…
                                  </span>
                                )}
                                {s.status === 'done' && s.count > 0 && (
                                  <span className="flex items-center gap-1 text-[11px] text-green-600">
                                    <Check className="h-3 w-3" />{s.count} found
                                  </span>
                                )}
                                {s.status === 'done' && s.count === 0 && (
                                  <span className="text-[11px] text-gray-300">—</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {!enrichProgress && (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <button
                      disabled={!enrichProgress?.done}
                      onClick={() => { setShowImportModal(false); setImportStep('upload'); setEnrichJobId(null); setEnrichProgress(null); }}
                      className="w-full py-2.5 text-[13px] font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {enrichProgress?.done ? 'Done' : 'Scanning…'}
                    </button>
                  </div>
                </div>
              );
            })() : importStep === 'upload' ? (
              <div className="px-6 py-5">
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => {
                    e.preventDefault(); setDragOver(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file && file.name.endsWith(".csv")) parseCSVFile(file);
                    else toast.error("Please drop a .csv file");
                  }}
                  onClick={() => importRef.current?.click()}
                  className={cn(
                    "flex flex-col items-center justify-center gap-3 h-40 rounded-xl border-2 border-dashed cursor-pointer transition-colors select-none",
                    dragOver ? "border-teal-400 bg-teal-50" : "border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-gray-100"
                  )}
                >
                  <div className="h-10 w-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center shadow-sm">
                    <FileText className="h-5 w-5 text-gray-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-[13px] font-medium text-gray-700">Drop a CSV here or <span className="text-teal-600">click to upload</span></p>
                    <p className="text-[11px] text-gray-400 mt-0.5">You'll map columns to your fields in the next step</p>
                  </div>
                </div>
                <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={handleImportFile} />

                {/* CRM Sync */}
                <div className="mt-4">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">CRM Sync</p>
                  <div className="flex gap-2">
                    {[
                      { provider: 'hubspot' as const, logo: '/provider-logos/hubspot.svg', label: 'HubSpot' },
                      { provider: 'salesforce' as const, logo: '/provider-logos/salesforce.svg', label: 'Salesforce' },
                    ].map(({ provider, logo, label }) => (
                      <button
                        key={provider}
                        onClick={() => handleCrmImport(provider)}
                        disabled={!!crmImporting}
                        className="flex items-center gap-2 flex-1 px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-white transition-all disabled:opacity-50"
                      >
                        {crmImporting === provider
                          ? <Loader2 className="h-4 w-4 animate-spin text-gray-400 shrink-0" />
                          : <img src={logo} alt={label} className="h-4 w-4 object-contain shrink-0" />
                        }
                        <span className="text-[12px] font-medium text-gray-700">
                          {crmImporting === provider ? 'Importing…' : label}
                        </span>
                        {crmImportResult?.provider === provider && (
                          <span className="ml-auto text-[11px] text-emerald-600 font-medium">{crmImportResult.imported} new</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1.5">Connect a CRM first in <a href="/integrations" className="text-teal-600 hover:underline">Integrations</a> to import contacts.</p>
                </div>
              </div>
            ) : (
              <div>
                <div className="overflow-y-auto max-h-[60vh]">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide w-[35%]">Column in CSV</th>
                        <th className="px-4 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide w-[38%]">Maps to</th>
                        <th className="px-6 py-3 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Sample</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvHeaders.map(col => (
                        <tr key={col} className="border-b border-gray-50">
                          <td className="px-6 py-3 text-[13px] text-gray-700 font-medium">{col}</td>
                          <td className="px-4 py-3">
                            <select
                              value={fieldMappings[col] || ''}
                              onChange={e => setFieldMappings(prev => ({ ...prev, [col]: e.target.value }))}
                              className="w-full text-[12px] border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-teal-400 focus:border-teal-400"
                            >
                              <option value="">Do not import</option>
                              {PEOPLE_FIELDS.map(f => (
                                <option key={f.key} value={f.key}>{f.label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-6 py-3 text-[13px] text-teal-700 font-medium truncate max-w-[140px]">
                            {csvSampleRow[col] || <span className="text-gray-300">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
                  <button onClick={() => setImportStep('upload')} className="text-[13px] text-gray-400 hover:text-gray-600 transition-colors">
                    ← Back
                  </button>
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] text-gray-400">{csvAllRows.length} rows</span>
                    <button
                      onClick={runImport}
                      disabled={importing}
                      className="flex items-center gap-2 px-4 py-2 text-[13px] font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {importing ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Importing…</> : "Import people"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Page header ─────────────────────── */}
      <div className="flex-shrink-0 px-6 pt-5 pb-0">

        {/* Title row */}
        <div className="flex items-center mb-1.5">
          <h1 className="text-[24px] font-semibold text-gray-900 tracking-tight">People</h1>
          <div className="flex-1" />
        </div>

        {/* Filter strip */}
        <div className="flex items-center border-b border-gray-100 pb-0 gap-0">
          <div className="flex items-center gap-0.5 mr-2">
            {filterTabs.map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-[13px] rounded-md transition-colors",
                  filter === f.id ? "bg-gray-100 text-gray-900 font-medium" : "text-gray-500 hover:text-gray-800 hover:bg-gray-50",
                )}>
                {f.dot && <span className={cn("h-2 w-2 rounded-full flex-shrink-0", f.dot)} />}
                {f.label}
              </button>
            ))}
          </div>
          <span className="h-4 w-px bg-gray-200 mx-2" />
          <button
            onClick={() => setSort(s => s === "interactions_desc" ? "interactions_asc" : s === "interactions_asc" ? "last_interaction" : "interactions_desc")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-[12px] rounded-md transition-colors",
              sort !== "last_interaction" ? "bg-teal-50 text-teal-700 font-medium" : "text-gray-500 hover:text-gray-800 hover:bg-gray-50",
            )}
          >
            <ArrowUpDown className="h-3 w-3 text-gray-400" />
            {sort === "interactions_asc" ? "Interactions ↑" : sort === "interactions_desc" ? "Interactions ↓" : "Sort: Interactions"}
          </button>
          <SourceDropdown value={source} onChange={setSource} />
          <DealStageFilter value={dealStageFilter} onChange={setDealStageFilter} />
          <div className="flex-1" />
          <div className="flex items-center gap-2 py-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search people…"
                className="pl-9 pr-3 h-7 w-44 text-[12px] bg-white border-gray-200 rounded-md shadow-sm focus-visible:ring-1 focus-visible:ring-teal-500/30 focus-visible:border-teal-400 placeholder:text-gray-400 transition-all"
              />
            </div>
            <button
              onClick={() => { setShowImportModal(true); setImportStep('upload'); setCsvHeaders([]); setCsvAllRows([]); setFieldMappings({}); }}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] text-gray-500 hover:text-gray-800 hover:bg-gray-50 rounded-md transition-colors border border-gray-200"
            >
              <Upload className="h-3.5 w-3.5" />Import
            </button>
            <button onClick={exportCSV} className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] text-gray-500 hover:text-gray-800 hover:bg-gray-50 rounded-md transition-colors border border-gray-200">
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
                <div className="h-3.5 w-28 bg-gray-100 rounded animate-pulse" />
                <div className="h-3.5 w-20 bg-gray-100 rounded animate-pulse ml-4" />
                <div className="flex-1" />
                <div className="h-3.5 w-16 bg-gray-100 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-24">
            <p className="text-[15px] font-medium text-gray-800">Couldn't load contacts</p>
            <button onClick={fetchPeople} className="mt-2 text-[13px] text-gray-400 hover:text-gray-700 underline">Retry</button>
          </div>
        ) : (
          <table className="table-fixed" style={{ width: "100%" }}>
            <colgroup>
              <col style={{ width: 40 }} />
              <col style={{ width: colWidths.name }} />
              <col style={{ width: colWidths.company }} />
              <col style={{ width: colWidths.domain }} />
              <col style={{ width: colWidths.linkedin }} />
              <col style={{ width: colWidths.connection }} />
              <col style={{ width: colWidths.dealHealth }} />
              <col style={{ width: colWidths.lastInteraction }} />
              <col style={{ width: colWidths.icpFit }} />
              <col style={{ width: colWidths.source }} />
              <col style={{ width: colWidths.segment }} />
              <col style={{ width: colWidths.dealStage }} />
              <col style={{ width: colWidths.enrichment }} />
              <col />
            </colgroup>
            <thead>
              <tr className="border-b border-gray-100">
                {/* Select-all checkbox */}
                <th className="pl-6 pr-3 py-3 text-left">
                  <div
                    onClick={toggleAll}
                    className={cn(
                      "h-3.5 w-3.5 rounded border transition-colors cursor-pointer flex items-center justify-center",
                      checked.size === people.length && people.length > 0
                        ? "bg-gray-900 border-gray-900"
                        : "border-gray-300 hover:border-gray-400",
                    )}
                  >
                    {checked.size === people.length && people.length > 0 && <Check className="h-2.5 w-2.5 text-white" />}
                  </div>
                </th>
                {(["name","company","domain","linkedin","connection","dealHealth","lastInteraction","icpFit","source","segment","dealStage","enrichment"] as const).map((col, i) => {
                  const labels: Record<string,string> = {
                    name:"Name", company:"Company", domain:"Domain", linkedin:"LinkedIn",
                    connection:"Stage", dealHealth:"Deal Health", lastInteraction:"Last interaction",
                    icpFit:"ICP Fit", source:"Source", segment:"Segment", dealStage:"Deal Stage", enrichment:"Enrichment",
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
              {displayed.map(p => (
                <tr
                  key={p.id}
                  className={cn(
                    "border-b border-gray-50 transition-colors group",
                    enrichingId !== p.id && "hover:bg-gray-50/60"
                  )}
                  style={enrichingId === p.id ? {
                    backgroundImage: 'linear-gradient(90deg, transparent 0%, rgba(20,184,166,0.07) 40%, rgba(20,184,166,0.18) 50%, rgba(20,184,166,0.07) 60%, transparent 100%)',
                    backgroundSize: '300% 100%',
                    animation: 'enrich-scan 1.6s ease-in-out infinite',
                  } : undefined}
                >
                  <td className="pl-6 pr-3 py-3.5">
                    <div
                      onClick={e => toggleCheck(p.id, e)}
                      className={cn(
                        "h-3.5 w-3.5 rounded border transition-colors cursor-pointer flex items-center justify-center",
                        checked.has(p.id) ? "bg-gray-900 border-gray-900" : "border-gray-300 group-hover:border-gray-400",
                      )}
                    >
                      {checked.has(p.id) && <Check className="h-2.5 w-2.5 text-white" />}
                    </div>
                  </td>
                  <td className="px-3 py-3.5">
                    <button onClick={() => openDetail(p)} className="text-[13px] font-medium text-gray-900 hover:text-teal-700 transition-colors text-left leading-snug truncate max-w-full">
                      {p.name}
                    </button>
                  </td>
                  <td className="px-3 py-3.5">
                    {p.company ? (
                      <button onClick={() => navigate(`/companies?q=${encodeURIComponent(p.company!)}`)} className="text-[13px] text-gray-600 hover:text-teal-700 transition-colors text-left truncate max-w-full">
                        {p.company}
                      </button>
                    ) : <span className="text-gray-300 text-[13px]">—</span>}
                  </td>
                  <td className="px-3 py-3.5"><span className="text-[13px] text-gray-400 truncate block">{p.domain ?? "—"}</span></td>
                  <td className="px-3 py-3.5 text-center">
                    {p.linkedinUrl ? (
                      <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-blue-50 transition-colors" title={p.linkedinUrl}>
                        <svg width="13" height="13" viewBox="0 0 24 24" className="flex-shrink-0">
                          <rect width="24" height="24" rx="4" fill="#0A66C2"/>
                          <path d="M7 10h2.5v7H7v-7Zm1.25-4a1.25 1.25 0 1 1 0 2.5A1.25 1.25 0 0 1 8.25 6ZM11 10h2.4v.96h.04c.33-.63 1.15-1.29 2.37-1.29 2.54 0 3.01 1.67 3.01 3.84V17H16.3v-3.03c0-1.02-.37-1.72-1.29-1.72-.7 0-1.12.47-1.3.93a1.73 1.73 0 0 0-.08.62V17H11v-7Z" fill="white"/>
                        </svg>
                      </a>
                    ) : <span className="text-gray-200 text-[13px]">—</span>}
                  </td>
                  <td className="px-3 py-3.5">
                    <StageBadge s={p.pipelineStage} />
                  </td>
                  <td className="px-3 py-3.5">
                    {p.dealHealthScore !== null && p.pipelineStage !== 'client' ? (
                      <span className={cn(
                        "inline-flex items-center gap-1.5 text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded whitespace-nowrap",
                        p.dealHealthScore >= 75 ? "bg-teal-50 text-teal-700" :
                        p.dealHealthScore >= 45 ? "bg-yellow-50 text-yellow-700" :
                        "bg-red-50 text-red-500"
                      )}>
                        {p.dealHealthScore >= 75 ? "Healthy" : p.dealHealthScore >= 45 ? "Needs attention" : "At risk"}
                        <span className="opacity-60">·</span>
                        {p.dealHealthScore}
                      </span>
                    ) : (
                      <span className="text-gray-300 text-[13px]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3.5"><span className="text-[13px] text-gray-600">{p.lastInteraction}</span></td>
                  <td className="px-3 py-3.5">
                    {p.icpFit === null ? (
                      <span className="text-gray-300 text-[13px]">—</span>
                    ) : p.icpFit ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 whitespace-nowrap">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                        Fit{p.icpScore != null && <span className="opacity-50 font-normal ml-0.5">· {p.icpScore}</span>}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-400 whitespace-nowrap">
                        No fit
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3.5"><SourceLogo s={p.source} /></td>
                  <td className="px-3 py-3.5">
                    {p.segmentLabel
                      ? <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-violet-50 text-violet-700 truncate max-w-full">{p.segmentLabel}</span>
                      : <span className="text-gray-300 text-[13px]">—</span>
                    }
                  </td>
                  <td className="px-3 py-3.5"><span className="text-[13px] text-gray-600">{p.dealStage ?? "—"}</span></td>
                  <td className="px-3 py-3.5">
                    {p.enrichmentStatus === 'complete' ? (
                      <button
                        onClick={e => { e.stopPropagation(); handleEnrichRow(p.id); }}
                        disabled={enrichingId === p.id}
                        className="text-[11px] text-gray-400 hover:text-gray-700 transition-colors"
                      >Enriched ↻</button>
                    ) : enrichingId === p.id ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-900 text-white w-fit">
                        <span className="flex items-center gap-[3px]">
                          {[0, 150, 300].map(delay => (
                            <span
                              key={delay}
                              className="block w-[3px] h-[3px] rounded-full bg-white"
                              style={{ animation: `enrich-dot 1s ease-in-out ${delay}ms infinite` }}
                            />
                          ))}
                        </span>
                        <span className="text-[11px] font-medium">Enriching</span>
                      </div>
                    ) : (p.enrichmentStatus === 'not_found' || p.enrichmentStatus === 'failed') ? (
                      <button
                        onClick={e => { e.stopPropagation(); handleEnrichRow(p.id); }}
                        className="text-[11px] text-gray-400 hover:text-gray-700 transition-colors"
                        title="No data found — click to retry"
                      >No data ↻</button>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); handleEnrichRow(p.id); }}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-900 hover:bg-gray-700 text-white transition-colors"
                      >
                        <span className="text-[11px] font-medium">Enrich · 5 cr</span>
                      </button>
                    )}
                  </td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!loading && !error && displayed.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24">
            <p className="text-[15px] font-medium text-gray-800">No people yet</p>
            <p className="text-[13px] text-gray-400 mt-1">Add contacts to get started</p>
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
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-gray-400">
              {total === 0 ? "0 people" : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total} ${total === 1 ? "person" : "people"}`}
            </p>
            {total > PAGE_SIZE && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => p - 1)}
                  disabled={page === 0}
                  className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-[12px] text-gray-500 px-1">{page + 1} / {Math.ceil(total / PAGE_SIZE)}</span>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={(page + 1) * PAGE_SIZE >= total}
                  className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

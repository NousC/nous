// Shared entity types, helpers, and small components used by the standalone
// People / Companies / Integrations pages (extracted from Mind.tsx).

import { Phone, FileText, MessageSquare } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContactInfo {
  id: string;
  name: string;
  email: string | null;
  title: string | null;
  pipelineStage: string;
  icpScore: number | null;
  icpFit: boolean | null;
  seniority: string | null;
  companyId: string | null;
  companyName: string | null;
  domain: string | null;
  linkedinUrl: string | null;
  lastActivityAt: string | null;
  dealHealthScore: number | null;
  dealStage: string | null;
  dealValue: number | null;
  source: string | null;
  segmentLabel: string | null;
  firstContact: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  department: string | null;
  createdAt: string | null;
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  revenueRange: string | null;
  contactCount: number;
  contacts: ContactInfo[];
  dealHealthScore: number | null;
  lastActivityAt: string | null;
  employeeCount: number | null;
}

export interface IntegrationConn {
  id: string;
  name: string;
  is_verified: boolean;
  provider: { display_name: string; logo_url?: string; category?: string; name?: string; auth_type?: string } | null;
}

export interface AuthField {
  name: string;
  label: string;
  type?: "text" | "password" | "number";
  placeholder?: string;
  description?: string;
  optional?: boolean;
}

export interface AvailableProvider {
  id: string;
  name: string;
  display_name: string;
  logo_url?: string;
  category?: string;
  description?: string;
  auth_type?: string;
  auth_fields?: AuthField[];
}

export interface MemoryFact {
  id: string;
  category: string;
  content: string;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function healthColor(h: number | null) {
  if (h === null) return "#6b7280";
  return h >= 70 ? "#4ade80" : h >= 40 ? "#facc15" : "#f87171";
}

export function stageColor(s: string) {
  return s === "client" ? "#4ade80" : s === "evaluating" ? "#60a5fa" : s === "interested" ? "#fb923c" : s === "aware" ? "#facc15" : "#9ca3af";
}

// ─── ActivityIcon ─────────────────────────────────────────────────────────────

export function ActivityIcon({ source, type }: { source: string | null; type: string }) {
  const s = (source || "").toLowerCase();
  const t = (type || "").toLowerCase();
  const logo = (src: string) => (
    <img src={src} alt="" className="w-3.5 h-3.5 rounded-sm object-contain flex-shrink-0"
      onError={e=>{(e.target as HTMLImageElement).style.display="none";}} />
  );
  // Dogfood checks first — `welcome_email_sent` contains "email", so the generic
  // email-icon check below would otherwise win and we'd render the Gmail logo.
  // `nous-mark.svg` is the brand mark; pinning a versioned filename also forces
  // a fresh download when the underlying svg gets updated.
  if (t.includes("signed_up") || t.includes("welcome_email"))     return logo("/provider-logos/nous-mark.svg");
  if (s === "stripe"          || t.includes("subscription"))      return logo("/provider-logos/stripe.svg");
  if (s === "linkedin"        || t.includes("linkedin"))          return <img src="/provider-logos/linkedin.png" alt="" className="w-3.5 h-3.5 rounded-sm object-contain flex-shrink-0" />;
  if (s === "gmail"           || s === "email" || s === "smtp" || t.includes("email")) return logo("/provider-logos/gmail.svg");
  if (s === "google_calendar" || s === "google-calendar"       || t.includes("calendar")) return logo("/provider-logos/google.svg");
  if (s === "slack"           || t.includes("slack"))             return logo("/provider-logos/slack.svg");
  if (s === "hubspot"         || t.includes("hubspot"))           return logo("/provider-logos/hubspot.svg");
  if (s === "fireflies"       || t.includes("fireflies"))         return logo("/provider-logos/fireflies.svg");
  if (s === "granola"         || t.includes("granola"))           return logo("/provider-logos/granola.svg");
  if (s === "fathom"          || t.includes("fathom"))            return logo("/provider-logos/fathom.svg");
  if (s === "calendly"        || t.includes("calendly"))          return logo("/provider-logos/calendly.svg");
  if (s === "cal_com"         || s === "cal.com" || t.includes("cal.com")) return logo("/provider-logos/cal_com.svg");
  if (s === "apollo"          || t.includes("apollo"))            return logo("/provider-logos/apollo.svg");
  if (t.includes("meeting")   || t.includes("call"))              return <Phone className="w-3.5 h-3.5 text-muted-foreground/45 flex-shrink-0" />;
  if (t.includes("note")      || t.includes("manual"))            return <FileText className="w-3.5 h-3.5 text-muted-foreground/45 flex-shrink-0" />;
  return <MessageSquare className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />;
}

// ─── IntegrationLogo ──────────────────────────────────────────────────────────

const LOGO_FALLBACK: Record<string, string> = {
  apollo: "/provider-logos/apollo.svg",
  "apollo.io": "/provider-logos/apollo.svg",
  gmail: "/provider-logos/gmail.svg",
  linkedin: "/provider-logos/linkedin.png",
  hubspot: "/provider-logos/hubspot.svg",
  slack: "/provider-logos/slack.svg",
  instantly: "/provider-logos/instantly.svg",
  rb2b: "/provider-logos/rb2b.png",
  fireflies: "/provider-logos/fireflies.svg",
  fathom: "/provider-logos/fathom.svg",
  calendly: "/provider-logos/calendly.svg",
  cal_com: "/provider-logos/cal_com.svg",
  "cal.com": "/provider-logos/cal_com.svg",
  emailbison: "/provider-logos/emailbison.png",
  heyreach: "/provider-logos/heyreach.png",
  smartlead: "/provider-logos/smartlead.png",
};

// Logos whose marks are predominantly black/dark — they need a light tile.
const DARK_LOGOS = new Set(["apollo", "cal_com", "calcom", "cal.com", "notion", "linear", "anthropic"]);

export function IntegrationLogo({ url, name, size=28 }: { url?: string; name: string; size?: number }) {
  const key = name.toLowerCase().replace(/[^a-z0-9._]/g, "");
  const src = url || LOGO_FALLBACK[key] || LOGO_FALLBACK[key.split(".")[0]];
  const isDark = DARK_LOGOS.has(key) || DARK_LOGOS.has(key.split(".")[0]);
  if (src) {
    if (isDark) {
      return (
        <div className="rounded bg-white flex items-center justify-center flex-shrink-0 border border-border/20"
          style={{ width: size, height: size }}>
          <img src={src} alt={name} className="object-contain"
            style={{ width: size * 0.7, height: size * 0.7 }}
            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
        </div>
      );
    }
    return <img src={src} alt={name} className="rounded object-contain flex-shrink-0"
      style={{ width: size, height: size }}
      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />;
  }
  return (
    <div className="rounded bg-muted/40 flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}>
      <span className="text-[9px] text-muted-foreground/40">{name.slice(0,2).toUpperCase()}</span>
    </div>
  );
}

// ─── Data mapping ─────────────────────────────────────────────────────────────
// Mirrors the raw-API → view-model mapping that Mind.tsx does in loadData().

export function mapContact(c: any): ContactInfo {
  return {
    id: c.id,
    name: [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "—",
    email: c.email ?? null,
    title: c.job_title ?? null,
    pipelineStage: c.pipeline_stage ?? "identified",
    icpScore: c.icp_score ?? null,
    icpFit: c.icp_fit ?? null,
    seniority: c.seniority ?? null,
    companyId: c.company_id ?? null,
    companyName: c.company ?? null,
    domain: c.domain ?? null,
    linkedinUrl: c.linkedin_url ?? null,
    lastActivityAt: c.last_activity_at ?? null,
    dealHealthScore: c.deal_health_score ?? null,
    dealStage: c.deal_stage ?? null,
    dealValue: c.deal_value ?? null,
    source: c.source ?? null,
    segmentLabel: c.segment_label ?? null,
    firstContact: c.first_contact ?? null,
    phone: c.phone ?? null,
    city: c.city ?? null,
    country: c.country ?? null,
    department: c.department ?? null,
    createdAt: c.created_at ?? null,
  };
}

export function buildCompanies(rawCompanies: any[], contacts: ContactInfo[]): Company[] {
  const byCompany = new Map<string, ContactInfo[]>();
  for (const c of contacts) {
    if (c.companyId) {
      const arr = byCompany.get(c.companyId) ?? [];
      arr.push(c);
      byCompany.set(c.companyId, arr);
    }
  }
  return (rawCompanies ?? []).map((co: any) => {
    const coContacts = byCompany.get(co.id) ?? [];
    const lastActivityAt = coContacts.reduce<string | null>((best, c) => {
      if (!c.lastActivityAt) return best;
      if (!best || c.lastActivityAt > best) return c.lastActivityAt;
      return best;
    }, null);
    return {
      id: co.id,
      name: co.name,
      domain: co.domain ?? null,
      industry: co.industry ?? null,
      location: co.location ?? null,
      revenueRange: co.revenue_range ?? null,
      contactCount: coContacts.length,
      contacts: coContacts,
      dealHealthScore: co.deal_health_score ?? null,
      lastActivityAt,
      employeeCount: co.employee_count ?? co.employees ?? null,
    };
  });
}

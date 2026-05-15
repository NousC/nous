import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Eye, EyeOff, Loader2, RefreshCw, Trash2, Key, Zap,
  MoreVertical, CheckCircle2, X, Shield, Plus, Link2, Copy, Webhook, ChevronRight, Send, Database,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import AirtableSyncConfig from "@/components/AirtableSyncConfig";
import CrmSyncConfig from "@/components/CrmSyncConfig";

// ─── Logo helpers ─────────────────────────────────────────────────────────────

const LOCAL_LOGOS: Record<string, string> = {
  stripe:     "/provider-logos/stripe.svg",
  openai:     "/provider-logos/openai.svg",
  anthropic:  "/provider-logos/anthropic.svg",
  slack:      "/provider-logos/slack.svg",
  hubspot:    "/provider-logos/hubspot.svg",
  pipedrive:  "/provider-logos/pipedrive.svg",
  clickup:    "/provider-logos/clickup.svg",
  airtable:   "/provider-logos/airtable.svg",
  gmail_oauth:"/provider-logos/gmail.svg",
  gmail:      "/provider-logos/gmail.svg",
  google:     "/provider-logos/google.svg",
  granola:    "/provider-logos/granola.svg",
  attio:      "/provider-logos/attio.svg",
  fathom:     "/provider-logos/fathom.svg",
  apollo:     "/provider-logos/apollo.svg",
  prospeo:    "/provider-logos/prospeo.svg",
  signalbase: "/provider-logos/signalbase.svg",
  instantly:  "/provider-logos/instantly.svg",
  lemlist:    "/provider-logos/lemlist.svg",
  calendly:   "/provider-logos/calendly.svg",
};

const CATEGORY_LABEL: Record<string, string> = {
  outbound:      "Outbound",
  crm:           "CRM",
  enrichment:    "Enrichment",
  signals:       "Signals",
  meetings:      "Meetings",
  communication: "Communication",
  payment:       "Payments",
  ai:            "AI",
  analytics:     "Analytics",
  database:      "Database",
  productivity:  "Productivity",
  other:         "Other",
};

const CATEGORY_OVERRIDE: Record<string, string> = {
  airtable: "database",
};

function ProviderLogo({ provider, size = 44 }: { provider: any; size?: number }) {
  const name = (provider?.name || "").toLowerCase();
  const src = LOCAL_LOGOS[name] || provider?.logo_url;
  const [ok, setOk] = useState(!!src);

  if (src && ok) {
    return (
      <div style={{ width: size, height: size }} className="rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
        <img src={src} alt={provider?.display_name} style={{ width: size * 0.54, height: size * 0.54 }} className="object-contain" onError={() => setOk(false)} />
      </div>
    );
  }
  return (
    <div style={{ width: size, height: size }} className="rounded-xl bg-gray-100 border border-gray-100 flex items-center justify-center flex-shrink-0">
      <Link2 className="h-4 w-4 text-gray-400" />
    </div>
  );
}

const maskCredential = (value: string) => {
  if (!value || value.length < 12) return "••••••••";
  return `${value.slice(0, 8)}••••••${value.slice(-4)}`;
};

// ─── Provider capabilities (what each integration unlocks) ───────────────────

const PROVIDER_CAPABILITIES: Record<string, { label: string; action: string }[]> = {
  hubspot: [
    { label: "Search & fetch contacts",    action: "hubspot_get_contact"       },
    { label: "Create / update contact",    action: "hubspot_upsert_contact"    },
    { label: "Create deal",                action: "hubspot_create_deal"       },
    { label: "Update deal stage",          action: "hubspot_update_deal"       },
    { label: "Log activity note",          action: "hubspot_log_activity"      },
    { label: "Get company",                action: "hubspot_get_company"       },
    { label: "Sync contact on webhook",    action: "hubspot_webhook_sync"      },
  ],
  pipedrive: [
    { label: "Search persons",             action: "pipedrive_search_persons"  },
    { label: "Create / update person",     action: "pipedrive_upsert_person"   },
    { label: "Create deal",                action: "pipedrive_create_deal"     },
    { label: "Update deal stage",          action: "pipedrive_update_deal"     },
    { label: "Add note",                   action: "pipedrive_add_note"        },
  ],
  apollo: [
    { label: "Enrich contact by email",    action: "apollo_person_match"       },
    { label: "Enrich company by domain",   action: "apollo_org_match"          },
    { label: "Auto-enrich new contacts",   action: "apollo_auto_enrich"        },
    { label: "Score ICP fit",              action: "apollo_icp_score"          },
  ],
  prospeo: [
    { label: "Enrich contact by email",    action: "prospeo_person_match"      },
    { label: "Enrich by LinkedIn URL",     action: "prospeo_linkedin_match"    },
    { label: "Auto-enrich new contacts",   action: "prospeo_auto_enrich"       },
    { label: "Score ICP fit",              action: "prospeo_icp_score"         },
  ],
  signalbase: [
    { label: "Job change signals",         action: "signalbase_job_changes"    },
    { label: "Funding round signals",      action: "signalbase_funding"        },
    { label: "Hiring intent signals",      action: "signalbase_hiring"         },
    { label: "Auto-scan on enrichment",    action: "signalbase_auto_scan"      },
  ],
  slack: [
    { label: "Log channel messages",       action: "slack_message"             },
    { label: "Log direct messages",        action: "slack_dm"                  },
    { label: "Log emoji reactions",        action: "slack_reaction"            },
    { label: "Send message to channel",    action: "slack_send_message"        },
    { label: "Send direct message",        action: "slack_send_dm"             },
    { label: "Post deal alert",            action: "slack_deal_alert"          },
  ],
  stripe: [
    { label: "Get customer",               action: "stripe_get_customer"       },
    { label: "Create invoice",             action: "stripe_create_invoice"     },
    { label: "List subscriptions",         action: "stripe_list_subscriptions" },
    { label: "Get payment history",        action: "stripe_get_payments"       },
  ],
  fathom: [
    { label: "Get site analytics",         action: "fathom_get_analytics"      },
    { label: "Get top pages",              action: "fathom_top_pages"          },
    { label: "Get referrer sources",       action: "fathom_referrers"          },
  ],
  instantly: [
    { label: "List campaigns",             action: "instantly_list_campaigns"  },
    { label: "Get campaign analytics",     action: "instantly_get_analytics"   },
    { label: "Add lead to campaign",       action: "instantly_add_lead"        },
    { label: "List leads in campaign",     action: "instantly_list_leads"      },
    { label: "Auto-log email activity",    action: "instantly_webhook_sync"    },
  ],
  lemlist: [
    { label: "List campaigns",             action: "lemlist_list_campaigns"    },
    { label: "Add lead to campaign",       action: "lemlist_add_lead"          },
    { label: "Pause / resume campaign",    action: "lemlist_toggle_campaign"   },
    { label: "Auto-log reply activity",    action: "lemlist_webhook_sync"      },
  ],
  fireflies: [
    { label: "Get meeting transcripts",    action: "fireflies_get_transcripts" },
    { label: "Search meetings by contact", action: "fireflies_search"          },
    { label: "Get meeting summary",        action: "fireflies_get_summary"     },
    { label: "Auto-log contact activity",  action: "fireflies_auto_log"        },
  ],
  calendly: [
    { label: "List event types",           action: "calendly_list_event_types" },
    { label: "Get scheduled events",       action: "calendly_get_events"       },
    { label: "Get event invitees",         action: "calendly_get_invitees"     },
    { label: "Auto-create contact on book",action: "calendly_webhook_sync"     },
  ],
  anthropic: [
    { label: "AI chat & analysis",         action: "ai_chat"                   },
    { label: "ICP scoring",                action: "ai_icp_score"              },
    { label: "Draft email / follow-up",    action: "ai_draft_email"            },
    { label: "Summarise meeting notes",    action: "ai_summarise"              },
  ],
};

// ─── Webhook sources ─────────────────────────────────────────────────────────

const WEBHOOK_CATEGORY_LABEL: Record<string, string> = {
  outbound:     "Outbound",
  crm:          "CRM",
  meetings:     "Meetings",
  intelligence: "Intelligence",
};

const WEBHOOK_SOURCES: {
  source: string; label: string; description: string; logo: string | null;
  hint: string; eventBody: string; category: string;
  events: { label: string; description: string }[];
}[] = [
  {
    source: "instantly", label: "Instantly", description: "Email opens, replies & lead signals",
    logo: "/provider-logos/instantly.svg", category: "outbound",
    hint: "Settings → Integrations → Webhooks → Add Webhook",
    events: [
      { label: "Reply Received",  description: "AI checks if positive — moves to Interested if yes" },
      { label: "Lead Interested", description: "Instantly marks lead interested → moves to Evaluating" },
      { label: "Meeting Booked",  description: "Meeting booked from sequence → moves to Evaluating" },
    ],
    eventBody: `{
  "event_type": "email_replied",
  "lead_email": "john@acme.com",
  "lead_name": "John Smith",
  "subject": "Following up on your proposal",
  "campaign_name": "Q2 Outbound",
  "timestamp": "2024-01-15T10:30:00Z"
}`,
  },
  {
    source: "lemlist", label: "Lemlist", description: "Positive replies & lead signals",
    logo: "/provider-logos/lemlist.svg", category: "outbound",
    hint: "Settings → Integrations → Webhooks → Add Webhook",
    events: [
      { label: "Reply Received",     description: "AI checks if positive — moves to Interested if yes" },
      { label: "Lead Interested",    description: "Lemlist marks lead interested → moves to Evaluating" },
      { label: "Opportunity Created",description: "Lead advanced to opportunity → moves to Evaluating" },
    ],
    eventBody: `{
  "type": "emailsReplied",
  "leadEmail": "john@acme.com",
  "leadFirstName": "John",
  "leadLastName": "Smith",
  "campaignName": "Q2 Outbound",
  "sentAt": "2024-01-15T10:30:00Z",
  "text": "Yes, I'd love to schedule a call"
}`,
  },
  {
    source: "fireflies", label: "Fireflies", description: "Meeting transcripts → contact activity",
    logo: "/provider-logos/fireflies.svg", category: "meetings",
    hint: "Integrations → Webhooks → Add webhook → select triggers below",
    events: [
      { label: "Meeting Transcribed", description: "Transcript is ready after a meeting" },
      { label: "Meeting Summarized",  description: "AI summary is ready — Proply logs activity for all participants" },
    ],
    eventBody: `{
  "meetingId": "ff_abc123",
  "title": "Discovery call with Acme",
  "date": "2024-01-15T10:00:00Z",
  "duration": 3600,
  "participants": [
    { "email": "john@acme.com", "name": "John Smith" }
  ],
  "summary": "Discussed pricing and next steps..."
}`,
  },
  {
    source: "calendly", label: "Calendly", description: "Meeting bookings → contact activity",
    logo: "/provider-logos/calendly.svg", category: "meetings",
    hint: "Integrations & apps → API & Webhooks → Webhook Subscriptions → New Webhook",
    events: [
      { label: "Invitee Created", description: "Someone books a meeting — Proply logs meeting_scheduled for matching contact" },
    ],
    eventBody: `{
  "event": "invitee.created",
  "payload": {
    "invitee": {
      "email": "john@acme.com",
      "name": "John Smith",
      "timezone": "America/New_York",
      "uri": "https://api.calendly.com/scheduled_events/.../invitees/..."
    },
    "scheduled_event": {
      "start_time": "2024-01-15T10:30:00Z",
      "end_time": "2024-01-15T11:00:00Z",
      "name": "Discovery Call",
      "location": { "join_url": "https://zoom.us/j/abc123" }
    },
    "uri": "https://api.calendly.com/scheduled_events/.../invitees/..."
  }
}`,
  },
  {
    source: "hubspot", label: "HubSpot", description: "Contact & deal updates",
    logo: LOCAL_LOGOS.hubspot, category: "crm",
    hint: "Settings → Integrations → Private Apps → Webhooks",
    events: [
      { label: "Contact Created",          description: "New contact created in HubSpot" },
      { label: "Contact Property Changed", description: "Lifecycle stage or owner changed" },
      { label: "Deal Created",             description: "New deal → moves contact to Evaluating" },
      { label: "Deal Property Changed",    description: "Deal stage update synced to Proply" },
    ],
    eventBody: `[{
  "subscriptionType": "contact.propertyChange",
  "objectId": 12345,
  "propertyName": "lifecyclestage",
  "propertyValue": "opportunity",
  "occurredAt": 1705312200000
}]`,
  },
  {
    source: "rb2b", label: "RB2B", description: "Website visitor identification",
    logo: "/provider-logos/rb2b.svg", category: "intelligence",
    hint: "Integrations → Webhooks → paste URL",
    events: [
      { label: "Visitor Identified", description: "RB2B de-anonymised a website visitor — Proply creates the contact" },
    ],
    eventBody: `{
  "person": {
    "email": "john@acme.com",
    "first_name": "John",
    "last_name": "Smith",
    "job_title": "VP Sales",
    "linkedin_url": "https://linkedin.com/in/johnsmith",
    "company": "Acme Inc"
  },
  "pageUrl": "https://yoursite.com/pricing",
  "timestamp": "2024-01-15T10:30:00Z"
}`,
  },
  {
    source: "fathom", label: "Fathom", description: "Meeting recordings → contact activity",
    logo: "/provider-logos/fathom.svg", category: "meetings",
    hint: "Settings → Webhooks → Add Webhook",
    events: [
      { label: "Meeting Recorded", description: "Recording is ready — Proply logs meeting_held for all participants" },
    ],
    eventBody: `{
  "title": "Discovery call with Acme",
  "url": "https://fathom.video/call/...",
  "started_at": "2024-01-15T10:00:00Z",
  "ended_at": "2024-01-15T11:00:00Z",
  "attendees": [
    { "email": "john@acme.com", "name": "John Smith" }
  ],
  "summary": "Discussed pricing and next steps..."
}`,
  },
];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Integrations() {
  const { userData, session } = useAuth();
  const [connections, setConnections] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("All");

  // Add flow
  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<"integration" | "webhook" | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<any>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [connectionName, setConnectionName] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ verified: boolean; message: string; mode?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [webhookUrls, setWebhookUrls]           = useState<Record<string, string>>({});
  const [webhookCopied, setWebhookCopied]         = useState<string | null>(null);
  const [subscriptions, setSubscriptions]         = useState<Record<string, {status: string}>>({});
  const [activatingWebhook, setActivatingWebhook] = useState<string | null>(null);
  const [removingWebhook, setRemovingWebhook]     = useState<string | null>(null);
  const [testingWebhook, setTestingWebhook]       = useState<string | null>(null);
  const [webhookDetail, setWebhookDetail]         = useState<string | null>(null);
  const [webhookTestResult, setWebhookTestResult] = useState<{ source: string; ok: boolean } | null>(null);
  const [viewingConnection, setViewingConnection] = useState<any>(null);
  const [togglingEnrichment, setTogglingEnrichment] = useState(false);

  // Edit / delete
  const [editingConnection, setEditingConnection] = useState<any>(null);
  const [editCredentials, setEditCredentials] = useState<Record<string, string>>({});
  const [updatingCredentials, setUpdatingCredentials] = useState(false);
  const [connectionToDelete, setConnectionToDelete] = useState<{ id: string; name: string } | null>(null);
  const [retestingConnection, setRetestingConnection] = useState<string | null>(null);

  // Airtable sync config modal
  const [airtableSyncConnection, setAirtableSyncConnection] = useState<any>(null);

  // CRM sync config modal (HubSpot, Salesforce)
  const [crmSyncConnection, setCrmSyncConnection] = useState<{ connection: any; provider: "hubspot" | "salesforce" } | null>(null);

  // LinkedIn (Unipile OAuth)
  const [linkedinConnection, setLinkedinConnection] = useState<any>(null);
  const [linkedinLoading, setLinkedinLoading] = useState(false);
  const [connectingLinkedIn, setConnectingLinkedIn] = useState(false);

  const workspaceId = userData?.workspace?.id || localStorage.getItem("selectedWorkspaceId");
  const apiUrl = import.meta.env.VITE_API_URL ?? "";

  // Hardcoded providers that always appear regardless of DB state
  const HARDCODED_PROVIDERS = [
    {
      id: "instantly", name: "instantly", display_name: "Instantly",
      auth_type: "api_key", category: "outbound",
      logo_url: "/provider-logos/instantly.svg",
      auth_fields: [{ name: "api_key", label: "API Key", type: "password", placeholder: "Enter your Instantly API key", description: "Find in Instantly → Settings → API & Integrations → API Keys" }],
    },
    {
      id: "lemlist", name: "lemlist", display_name: "Lemlist",
      auth_type: "api_key", category: "outbound",
      logo_url: "/provider-logos/lemlist.svg",
      auth_fields: [{ name: "api_key", label: "API Key", type: "password", placeholder: "Enter your Lemlist API key", description: "Find in Lemlist → Settings → Integrations → API Key" }],
    },
    {
      id: "apollo", name: "apollo", display_name: "Apollo",
      auth_type: "api_key", category: "enrichment",
      logo_url: "/provider-logos/apollo.svg",
      auth_fields: [{ name: "api_key", label: "API Key", type: "password", placeholder: "Enter your Apollo API key", description: "Find in Apollo → Settings → Integrations → API Keys" }],
    },
    {
      id: "prospeo", name: "prospeo", display_name: "Prospeo",
      auth_type: "api_key", category: "enrichment",
      logo_url: "/provider-logos/prospeo.svg",
      auth_fields: [{ name: "api_key", label: "API Key", type: "password", placeholder: "Enter your Prospeo API key", description: "Find in Prospeo → Settings → API Key" }],
    },
    {
      id: "signalbase", name: "signalbase", display_name: "SignalBase",
      auth_type: "api_key", category: "signals",
      logo_url: "/provider-logos/signalbase.svg",
      auth_fields: [{ name: "api_key", label: "API Key", type: "password", placeholder: "Enter your SignalBase API key", description: "Find at trysignalbase.com/workspace/api" }],
    },
  ];

  useEffect(() => {
    if (session?.access_token && workspaceId) { fetchData(); fetchLinkedIn(); }
  }, [session, workspaceId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [pr, cr] = await Promise.all([
        fetch(`${apiUrl}/api/workflow-providers`, { headers: { Authorization: `Bearer ${session.access_token}` } }),
        fetch(`${apiUrl}/api/workflow-providers/connections?workspace_id=${workspaceId}`, { headers: { Authorization: `Bearer ${session.access_token}` } }),
      ]);
      if (pr.ok) {
        const d = await pr.json();
        const list = d.providers || d || [];
        const excluded = ["assetly","gmail","mailchimp","google_analytics","granola","notion","clickup","openai","gemini","google","fireflies","calendly","rb2b","fathom","anthropic","stripe"];
        const filtered = list.filter((p: any) => p.auth_type !== "none" && !excluded.includes(p.name));
        // HARDCODED_PROVIDERS always win (correct labels/category); strip DB versions of hardcoded names
        const hardcodedNames = new Set(HARDCODED_PROVIDERS.map(h => h.name));
        const dbOnly = filtered.filter((p: any) => !hardcodedNames.has(p.name));
        const merged = [...HARDCODED_PROVIDERS, ...dbOnly].map(p =>
          CATEGORY_OVERRIDE[p.name] ? { ...p, category: CATEGORY_OVERRIDE[p.name] } : p
        );
        setProviders(merged);
      }
      if (cr.ok) {
        const d = await cr.json();
        setConnections(d.connections || []);
      }
    } catch { toast.error("Failed to load integrations"); }
    finally { setLoading(false); }
  };

  const fetchLinkedIn = async () => {
    if (!session?.access_token || !workspaceId) return;
    try {
      const res = await fetch(`${apiUrl}/api/linkedin/status?workspaceId=${workspaceId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setLinkedinConnection(data.connected ? data.connection : null);
      }
    } catch {}
  };

  const handleLinkedInConnect = async () => {
    if (!session?.access_token || !workspaceId) return;
    setConnectingLinkedIn(true);
    try {
      const res = await fetch(`${apiUrl}/api/linkedin/connect?workspaceId=${workspaceId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.message || "LinkedIn not configured — contact support");
        return;
      }
      const { url } = await res.json();
      const w = 600, h = 700;
      const popup = window.open(url, "LinkedInOAuth", `width=${w},height=${h},left=${window.screenX + (window.outerWidth - w) / 2},top=${window.screenY + (window.outerHeight - h) / 2}`);
      const handler = (e: MessageEvent) => {
        if (e.data?.type === "linkedin_auth") {
          window.removeEventListener("message", handler);
          popup?.close();
          setConnectingLinkedIn(false);
          if (e.data.success) { toast.success("LinkedIn connected!"); fetchLinkedIn(); }
          else toast.error(e.data.error || "LinkedIn connection failed");
        }
      };
      window.addEventListener("message", handler);
      const pollClosed = setInterval(() => {
        if (popup?.closed) { clearInterval(pollClosed); window.removeEventListener("message", handler); setConnectingLinkedIn(false); fetchLinkedIn(); }
      }, 800);
    } catch { toast.error("Failed to initiate LinkedIn connection"); setConnectingLinkedIn(false); }
  };

  const handleLinkedInDisconnect = async () => {
    if (!session?.access_token || !workspaceId) return;
    setLinkedinLoading(true);
    try {
      await fetch(`${apiUrl}/api/linkedin/disconnect?workspaceId=${workspaceId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      setLinkedinConnection(null);
      toast.success("LinkedIn disconnected");
    } catch { toast.error("Failed to disconnect"); }
    finally { setLinkedinLoading(false); }
  };

  // ── Category tabs derived from connected tools ────────────────────────────
  const hasWebhooks = Object.keys(subscriptions).length > 0;
  const apiCategories = Array.from(new Set(connections.map(c => CATEGORY_LABEL[c.provider?.category] ?? "Other")));
  const categories = ["All", ...(hasWebhooks ? ["Webhooks"] : []), ...apiCategories];

  const displayed = activeCategory === "All"
    ? connections
    : activeCategory === "Webhooks"
    ? []
    : connections.filter(c => (CATEGORY_LABEL[c.provider?.category] ?? "Other") === activeCategory);

  // ── Connect flow ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session?.access_token || !workspaceId) return;
    const h = { Authorization: `Bearer ${session.access_token}` };
    Promise.all([
      fetch(`${apiUrl}/api/webhooks/urls?workspaceId=${workspaceId}`, { headers: h }).then(r => r.json()),
      fetch(`${apiUrl}/api/webhooks/subscriptions?workspaceId=${workspaceId}`, { headers: h }).then(r => r.json()),
    ]).then(([urlsData, subsData]) => {
      const urlMap: Record<string, string> = {};
      (urlsData.urls || []).forEach((u: any) => { urlMap[u.source] = u.url; });
      setWebhookUrls(urlMap);
      const subMap: Record<string, {status: string}> = {};
      (subsData.subscriptions || []).forEach((s: any) => { subMap[s.source] = { status: s.status || 'pending' }; });
      setSubscriptions(subMap);
    }).catch(() => {});
  }, [session, workspaceId]);

  const activateWebhook = async (source: string) => {
    const wid = userData?.workspace?.id || workspaceId;
    if (!session?.access_token || !wid) {
      toast.error("No workspace found — please reload the page");
      return;
    }
    setActivatingWebhook(source);
    try {
      const res = await fetch(`${apiUrl}/api/webhooks/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspaceId: wid, source }),
      });
      if (res.ok) {
        setSubscriptions(prev => ({ ...prev, [source]: { status: 'pending' } }));
        setWebhookDetail(source);
        setAddOpen(false);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || `Failed to create ${source} webhook`);
      }
    } catch {
      toast.error("Network error — could not create webhook");
    } finally { setActivatingWebhook(null); }
  };

  const removeWebhook = async (source: string) => {
    if (!session?.access_token || !workspaceId) return;
    setRemovingWebhook(source);
    try {
      await fetch(`${apiUrl}/api/webhooks/subscriptions/${source}?workspaceId=${workspaceId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      setSubscriptions(prev => { const n = { ...prev }; delete n[source]; return n; });
      setWebhookDetail(null);
    } finally { setRemovingWebhook(null); }
  };

  const testWebhook = async (source: string) => {
    if (!session?.access_token || !workspaceId) return;
    setTestingWebhook(source);
    setWebhookTestResult(null);
    try {
      const res = await fetch(`${apiUrl}/api/webhooks/subscriptions/${source}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await res.json();
      if (data.success && data.status === 'live') {
        setSubscriptions(prev => ({ ...prev, [source]: { status: 'live' } }));
        setWebhookTestResult({ source, ok: true });
      } else {
        setWebhookTestResult({ source, ok: false });
      }
    } catch {
      setWebhookTestResult({ source, ok: false });
    } finally { setTestingWebhook(null); }
  };

  const closeAdd = () => {
    setAddOpen(false);
    setAddType(null);
    setSelectedProvider(null);
    setCredentials({});
    setConnectionName("");
    setTestResult(null);
    setOauthLoading(false);
  };

  const copyWebhook = (source: string) => {
    const url = webhookUrls[source];
    if (!url) return;
    navigator.clipboard.writeText(url);
    setWebhookCopied(source);
    setTimeout(() => setWebhookCopied(null), 2000);
  };

  const handleTestConnection = async () => {
    if (!selectedProvider) return;
    setTesting(true); setTestResult(null);
    try {
      // Instantly / Lemlist / Calendly / Apollo / Fireflies have dedicated test endpoints
      if (["instantly", "lemlist", "apollo", "prospeo", "signalbase"].includes(selectedProvider.name)) {
        const res = await fetch(`${apiUrl}/api/workflow-providers/${selectedProvider.name}/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ api_key: credentials.api_key }),
        });
        setTestResult(await res.json());
        return;
      }
      const res = await fetch(`${apiUrl}/api/workflow-providers/connections/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ provider_id: selectedProvider.id, credentials }),
      });
      setTestResult(await res.json());
    } catch { setTestResult({ verified: false, message: "Failed to test connection" }); }
    finally { setTesting(false); }
  };

  const handleSaveConnection = async () => {
    if (!selectedProvider || !connectionName.trim()) { toast.error("Please provide a connection name"); return; }
    if (!testResult?.verified) { toast.error("Please test and verify the connection first"); return; }
    setSaving(true);
    try {
      // Instantly / Lemlist / Calendly / Apollo / Fireflies use dedicated connect endpoints
      if (["instantly", "lemlist", "apollo", "prospeo", "signalbase"].includes(selectedProvider.name)) {
        const res = await fetch(`${apiUrl}/api/workflow-providers/${selectedProvider.name}/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ workspace_id: workspaceId, name: connectionName.trim(), api_key: credentials.api_key }),
        });
        if (res.ok) { toast.success(`${selectedProvider.display_name} connected`); closeAdd(); fetchData(); }
        else throw new Error((await res.json()).error || "Failed to save");
        return;
      }
      const res = await fetch(`${apiUrl}/api/workflow-providers/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspace_id: workspaceId, provider_id: selectedProvider.id, name: connectionName.trim(), credentials, is_verified: true }),
      });
      if (res.ok) { toast.success("Connection added"); closeAdd(); fetchData(); }
      else throw new Error((await res.json()).message || "Failed to save");
    } catch (e: any) { toast.error(e.message || "Failed to save"); }
    finally { setSaving(false); }
  };

  const handleOAuthConnect = async () => {
    if (!selectedProvider || !workspaceId || !session?.access_token) { toast.error("Please log in"); return; }
    if (!connectionName.trim()) { toast.error("Connection name is required"); return; }
    setOauthLoading(true);
    try {
      let url = `${apiUrl}/api/workflow-providers/${selectedProvider.name}/oauth/authorize?workspace_id=${workspaceId}&connectionName=${encodeURIComponent(connectionName.trim())}`;
      if (selectedProvider.name === "gmail" || selectedProvider.name === "gmail_oauth")
        url = `${apiUrl}/api/oauth/google/gmail/authorize?workspaceId=${workspaceId}&connectionName=${encodeURIComponent(connectionName.trim())}`;
      if (selectedProvider.name === "outlook_oauth")
        url = `${apiUrl}/api/workflow-providers/outlook/oauth/authorize?workspace_id=${workspaceId}&connectionName=${encodeURIComponent(connectionName.trim())}`;

      const resp = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        const notConfigured: Record<string, string> = {
          google_oauth_not_configured: "Gmail requires Google OAuth setup — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to proply.env. See docs → Providers → Gmail.",
          slack_not_configured:        "Slack requires OAuth setup — add SLACK_CLIENT_ID and SLACK_CLIENT_SECRET to proply.env. See docs → Providers → Slack.",
          airtable_not_configured:     "Airtable requires OAuth setup — add AIRTABLE_CLIENT_ID and AIRTABLE_CLIENT_SECRET to proply.env. See docs → Providers → Airtable.",
          linkedin_not_configured:     "LinkedIn requires Unipile setup — add UNIPILE_API_KEY and UNIPILE_DSN to proply.env. See docs → Providers → LinkedIn.",
        };
        throw new Error(notConfigured[body.error] || body.message || "Failed to initiate OAuth");
      }
      const data = await resp.json();
      const authUrl = data.authUrl || data.authorization_url;
      if (!authUrl) throw new Error("No authorization URL returned");

      const w = 600, h = 700;
      const popup = window.open(authUrl, `${selectedProvider.name}OAuth`, `width=${w},height=${h},left=${window.screenX + (window.outerWidth - w) / 2},top=${window.screenY + (window.outerHeight - h) / 2}`);

      const msgType = `${selectedProvider.name}_auth`;
      const msgHandler = (e: MessageEvent) => {
        if (e.data?.type === msgType) {
          window.removeEventListener("message", msgHandler);
          window.clearInterval(timer);
          popup?.close();
          setOauthLoading(false);
          if (e.data.success) { toast.success(`${selectedProvider.display_name} connected!`); closeAdd(); fetchData(); }
          else toast.error(e.data.error || `${selectedProvider.display_name} connection failed`);
        }
      };
      window.addEventListener("message", msgHandler);

      const timer = window.setInterval(() => {
        try {
          if (popup?.location?.href?.includes("/integrations") || popup?.location?.href?.includes("_success=true")) {
            window.clearInterval(timer); window.removeEventListener("message", msgHandler);
            popup?.close(); setOauthLoading(false);
            toast.success(`${selectedProvider.display_name} connected!`); closeAdd(); fetchData();
          }
        } catch {}
        if (popup?.closed) {
          window.clearInterval(timer);
          // Give postMessage 300ms to arrive before tearing down the listener
          setTimeout(() => { window.removeEventListener("message", msgHandler); setOauthLoading(false); fetchData(); }, 300);
        }
      }, 500);
    } catch (e: any) { toast.error(e.message || "Failed to initiate OAuth"); setOauthLoading(false); }
  };

  const handleDeleteConnection = async () => {
    if (!connectionToDelete) return;
    try {
      const res = await fetch(`${apiUrl}/api/workflow-providers/connections/${connectionToDelete.id}?workspace_id=${workspaceId}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) { toast.success("Connection removed"); setConnectionToDelete(null); fetchData(); }
      else throw new Error("Failed to delete");
    } catch (e: any) { toast.error(e.message || "Failed to delete"); }
  };

  const handleRetestConnection = async (connectionId: string) => {
    setRetestingConnection(connectionId);
    try {
      const res = await fetch(`${apiUrl}/api/workflow-providers/connections/${connectionId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspace_id: workspaceId }),
      });
      const data = await res.json();
      if (data.verified) { toast.success(data.message || "Verified"); setConnections(prev => prev.map(c => c.id === connectionId ? { ...c, is_verified: true } : c)); }
      else toast.error(data.message || "Verification failed");
      fetchData();
    } catch { toast.error("Failed to test"); }
    finally { setRetestingConnection(null); }
  };

  const handleEnrichmentToggle = async (connectionId: string, enabled: boolean) => {
    setTogglingEnrichment(true);
    try {
      const res = await fetch(`${apiUrl}/api/workflow-providers/connections/${connectionId}/enrichment-toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to update");
      setViewingConnection((prev: any) => ({
        ...prev,
        encrypted_credentials: { ...prev.encrypted_credentials, use_for_enrichment: enabled },
      }));
      setConnections(prev => prev.map(c =>
        c.id === connectionId
          ? { ...c, encrypted_credentials: { ...c.encrypted_credentials, use_for_enrichment: enabled } }
          : c
      ));
      toast.success(enabled ? "Using your Apollo credits for enrichment" : "Switched to Proply's built-in enrichment");
    } catch { toast.error("Failed to update enrichment setting"); }
    finally { setTogglingEnrichment(false); }
  };

  const handleUpdateCredentials = async () => {
    if (!editingConnection) return;
    if (!Object.values(editCredentials).some(v => v?.trim())) { toast.error("Enter at least one credential"); return; }
    setUpdatingCredentials(true);
    try {
      const res = await fetch(`${apiUrl}/api/workflow-providers/connections/${editingConnection.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ credentials: editCredentials }),
      });
      if (res.ok) { toast.success("Credentials updated"); setEditingConnection(null); setEditCredentials({}); fetchData(); }
      else throw new Error((await res.json()).message || "Failed to update");
    } catch (e: any) { toast.error(e.message || "Failed to update"); }
    finally { setUpdatingCredentials(false); }
  };

  const isOAuth = (p: any) => p?.auth_type === "oauth2" || ["airtable","notion","google_analytics","slack","gmail","granola","salesforce"].includes(p?.name);

  return (

    <div className="flex flex-col h-full bg-white">

      {/* ── Header ─────────────────────────────── */}
      <div className="flex-shrink-0 px-6 pt-6 pb-0">
        <div className="flex items-center mb-4">
          <h1 className="text-[24px] font-semibold text-gray-900 tracking-tight">Integrations</h1>
          <div className="flex-1" />
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add integration
          </button>
        </div>

        {/* Category tabs — underline style */}
        {categories.length > 1 && (
          <div className="flex items-end gap-0 border-b border-gray-100">
            {categories.map(cat => {
              const isWebhooks = cat === "Webhooks";
              const isActive = activeCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 text-[13px] transition-colors border-b-2 -mb-px",
                    isWebhooks
                      ? isActive
                        ? "border-violet-500 text-violet-700 font-medium"
                        : "border-transparent text-gray-400 hover:text-violet-500"
                      : isActive
                        ? "border-gray-900 text-gray-900 font-medium"
                        : "border-transparent text-gray-400 hover:text-gray-700",
                  )}
                >
                  {isWebhooks && <Webhook className="h-3 w-3" />}
                  {cat}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Connected tools grid ────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {loading ? (
          <div className="grid grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="rounded-2xl border border-gray-100 p-5 animate-pulse">
                <div className="flex items-start gap-3">
                  <div className="h-11 w-11 rounded-xl bg-gray-100 flex-shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3.5 w-24 bg-gray-100 rounded" />
                    <div className="h-3 w-36 bg-gray-100 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : displayed.length === 0 && activeCategory !== "Webhooks" ? (
          <div className="flex flex-col items-center justify-center py-32">
            <div className="h-12 w-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
              <Link2 className="h-5 w-5 text-gray-400" />
            </div>
            <p className="text-[15px] font-medium text-gray-800">No integrations yet</p>
            <p className="text-[13px] text-gray-400 mt-1 mb-5">Connect your first tool to get started</p>
            <button
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add integration
            </button>
          </div>
        ) : activeCategory === "Webhooks" ? null : (
          <div className="grid grid-cols-3 gap-4">
            {displayed.map((connection: any) => {
              const provider = connection.provider;
              const category = CATEGORY_LABEL[provider?.category] ?? "Other";
              return (
                <div
                  key={connection.id}
                  onClick={() => {
                    if (provider?.name === "airtable") return setAirtableSyncConnection(connection);
                    if (provider?.name === "hubspot") return setCrmSyncConnection({ connection, provider: "hubspot" });
                    if (provider?.name === "salesforce") return setCrmSyncConnection({ connection, provider: "salesforce" });
                    setViewingConnection(connection);
                  }}
                  className="group relative flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3 hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer"
                >
                  <ProviderLogo provider={provider} size={34} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-gray-900 leading-tight truncate">{provider?.display_name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-gray-400">{["airtable","hubspot","salesforce"].includes(provider?.name) ? "Click to configure sync" : category}</span>
                      <span className="text-gray-200">·</span>
                      <span className={cn(
                        "text-[11px] font-medium",
                        retestingConnection === connection.id ? "text-blue-500" :
                        connection.is_verified ? "text-emerald-600" : "text-amber-500"
                      )}>
                        {retestingConnection === connection.id ? "Testing…" : connection.is_verified ? "Connected" : "Unverified"}
                      </span>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        onClick={e => e.stopPropagation()}
                        className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {provider?.name === "airtable" && (
                        <DropdownMenuItem onClick={e => { e.stopPropagation(); setAirtableSyncConnection(connection); }}>
                          <Database className="h-3.5 w-3.5 mr-2" />
                          Configure sync
                        </DropdownMenuItem>
                      )}
                      {(provider?.name === "hubspot" || provider?.name === "salesforce") && (
                        <DropdownMenuItem onClick={e => { e.stopPropagation(); setCrmSyncConnection({ connection, provider: provider.name as "hubspot" | "salesforce" }); }}>
                          <Database className="h-3.5 w-3.5 mr-2" />
                          Configure sync
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => handleRetestConnection(connection.id)} disabled={retestingConnection === connection.id}>
                        <RefreshCw className={cn("h-3.5 w-3.5 mr-2", retestingConnection === connection.id && "animate-spin")} />
                        {retestingConnection === connection.id ? "Testing…" : "Test connection"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setEditingConnection(connection); setEditCredentials({}); }}>
                        <Key className="h-3.5 w-3.5 mr-2" />
                        Update credentials
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setConnectionToDelete({ id: connection.id, name: connection.name })} className="text-red-600 focus:text-red-600">
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        Disconnect
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
            {/* LinkedIn card (Unipile OAuth — separate from workflow_provider_connections) */}
            {activeCategory === "All" && linkedinConnection && (
              <div className="group relative flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3 hover:border-gray-300 hover:shadow-sm transition-all">
                <div className="h-[34px] w-[34px] rounded-xl bg-[#0077B5]/10 border border-[#0077B5]/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  <img src="/provider-logos/linkedin.png" alt="LinkedIn" className="h-[18px] w-[18px] object-contain" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-gray-900 leading-tight truncate">LinkedIn</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-gray-400 truncate">{linkedinConnection.linkedin_name || "Connected"}</span>
                    <span className="text-gray-200">·</span>
                    <span className="text-[11px] font-medium text-emerald-600">Connected</span>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      onClick={e => e.stopPropagation()}
                      className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={handleLinkedInDisconnect} disabled={linkedinLoading} className="text-red-600 focus:text-red-600">
                      <Trash2 className="h-3.5 w-3.5 mr-2" />
                      {linkedinLoading ? "Disconnecting…" : "Disconnect"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        )}

        {/* ── Active webhook cards ───────────────── */}
        {activeCategory === "Webhooks" && Object.keys(subscriptions).length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            {WEBHOOK_SOURCES.filter(w => subscriptions[w.source]).map(w => (
              <div
                key={w.source}
                onClick={() => setWebhookDetail(w.source)}
                className="group relative flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3 hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer"
              >
                <div className="h-[34px] w-[34px] rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {w.logo ? <img src={w.logo} alt={w.label} className="h-[18px] w-[18px] object-contain" /> : <Link2 className="h-4 w-4 text-gray-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-gray-900 leading-tight truncate">{w.label}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-gray-400">Webhook</span>
                    <span className="text-gray-200">·</span>
                    <span className={cn("text-[11px] font-medium", subscriptions[w.source]?.status === 'live' ? "text-emerald-600" : "text-amber-500")}>
                      {subscriptions[w.source]?.status === 'live' ? "Live" : "Pending test"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}



        <p className="text-[11px] text-gray-400 flex items-center gap-1.5 mt-8">
          <Shield className="h-3 w-3" />
          All credentials encrypted with AES-256-GCM
        </p>
      </div>

      {/* ── Add integration dialog ──────────────── */}
      <Dialog open={addOpen} onOpenChange={open => { if (!open) closeAdd(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[15px]">
              {selectedProvider ? selectedProvider.display_name : addType === "webhook" ? "Webhook endpoints" : addType === "integration" ? "Add integration" : "Add integration"}
            </DialogTitle>
          </DialogHeader>

          {/* Step 0 — choose type */}
          {!addType ? (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                onClick={() => setAddType("integration")}
                className="flex flex-col items-start gap-2 p-4 rounded-xl border border-gray-200 hover:border-gray-400 hover:bg-gray-50 transition-all text-left"
              >
                <div className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center">
                  <Link2 className="h-4 w-4 text-gray-600" />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-gray-900">Integration</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Connect via API key or OAuth</p>
                </div>
              </button>
              <button
                onClick={() => setAddType("webhook")}
                className="flex flex-col items-start gap-2 p-4 rounded-xl border border-gray-200 hover:border-gray-400 hover:bg-gray-50 transition-all text-left"
              >
                <div className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center">
                  <Webhook className="h-4 w-4 text-gray-600" />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-gray-900">Webhook</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Receive activity via inbound URL</p>
                </div>
              </button>
            </div>

          /* Step 1b — webhook list (categorized) */
          ) : addType === "webhook" && !selectedProvider ? (
            <div className="space-y-4 pt-1">
              <button onClick={() => setAddType(null)} className="text-[12px] text-gray-400 hover:text-gray-700 transition-colors">← Back</button>
              <p className="text-[12px] text-gray-400 leading-relaxed">Each generates a unique inbound URL you paste into that tool — one per platform.</p>
              {(["outbound", "crm", "meetings", "intelligence"] as const).map(cat => {
                const group = WEBHOOK_SOURCES.filter(w => w.category === cat);
                if (!group.length) return null;
                return (
                  <div key={cat}>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 px-0.5">{WEBHOOK_CATEGORY_LABEL[cat]}</p>
                    <div className="space-y-1">
                      {group.map(w => {
                        const sub = subscriptions[w.source];
                        return (
                          <div key={w.source} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-100 hover:border-gray-200 bg-gray-50/50 transition-colors">
                            <div className="h-7 w-7 rounded-lg bg-white border border-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                              {w.logo ? <img src={w.logo} alt={w.label} className="h-4 w-4 object-contain" /> : <Link2 className="h-3 w-3 text-gray-400" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-medium text-gray-900">{w.label}</p>
                              <p className="text-[10px] text-gray-400">{w.description}</p>
                            </div>
                            {sub ? (
                              <button
                                onClick={() => { setWebhookDetail(w.source); setAddOpen(false); }}
                                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-colors flex-shrink-0"
                              >
                                <span className={cn("h-1.5 w-1.5 rounded-full inline-block mr-0.5", sub.status === 'live' ? "bg-emerald-500" : "bg-amber-400")} />
                                {sub.status === 'live' ? "Live" : "Pending"} · Manage
                              </button>
                            ) : (
                              <button
                                onClick={() => activateWebhook(w.source)}
                                disabled={activatingWebhook === w.source}
                                className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md bg-gray-900 text-white hover:bg-gray-800 transition-colors flex-shrink-0 disabled:opacity-50"
                              >
                                {activatingWebhook === w.source ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                                {activatingWebhook === w.source ? "Creating…" : "Create webhook"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

          /* Step 1a — integration provider list (categorized) */
          ) : addType === "integration" && !selectedProvider ? (
            <div className="space-y-1 pt-1">
              <button onClick={() => setAddType(null)} className="text-[12px] text-gray-400 hover:text-gray-700 transition-colors mb-1">← Back</button>
              <div className="overflow-y-auto max-h-[58vh] space-y-4 pr-0.5">
                {(["outbound", "enrichment", "signals", "crm", "meetings", "communication", "payment", "ai", "analytics", "database", "productivity", "other"] as const).map(cat => {
                  const provs = providers.filter(p => p.category === cat);
                  const showLinkedIn = cat === "outbound";
                  if (!provs.length && !showLinkedIn) return null;
                  return (
                    <div key={cat}>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 px-0.5">{CATEGORY_LABEL[cat]}</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {provs.map(provider => {
                          const logoSrc = LOCAL_LOGOS[(provider.name || "").toLowerCase()] || provider.logo_url;
                          return (
                            <button
                              key={provider.id}
                              onClick={() => { setSelectedProvider(provider); setConnectionName(provider.display_name); }}
                              className="flex items-center gap-2.5 p-2.5 rounded-xl border border-gray-100 hover:border-gray-300 hover:bg-gray-50 transition-all text-left"
                            >
                              <div className="h-8 w-8 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                                {logoSrc ? <img src={logoSrc} alt={provider.display_name} className="h-[18px] w-[18px] object-contain" /> : <Link2 className="h-3.5 w-3.5 text-gray-400" />}
                              </div>
                              <p className="text-[12px] font-medium text-gray-900 truncate">{provider.display_name}</p>
                            </button>
                          );
                        })}
                        {/* LinkedIn in Outbound */}
                        {showLinkedIn && (linkedinConnection ? (
                          <div className="flex items-center gap-2.5 p-2.5 rounded-xl border border-gray-100 bg-emerald-50/30 opacity-70 cursor-not-allowed">
                            <div className="h-8 w-8 rounded-lg bg-[#0077B5]/10 border border-[#0077B5]/20 flex items-center justify-center flex-shrink-0">
                              <img src="/provider-logos/linkedin.png" alt="LinkedIn" className="h-[18px] w-[18px] object-contain" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[12px] font-medium text-gray-700 truncate">LinkedIn</p>
                              <p className="text-[10px] text-emerald-600 font-medium">Connected</p>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => { closeAdd(); handleLinkedInConnect(); }}
                            disabled={connectingLinkedIn}
                            className="flex items-center gap-2.5 p-2.5 rounded-xl border border-gray-100 hover:border-[#0077B5]/40 hover:bg-[#0077B5]/5 transition-all text-left disabled:opacity-50"
                          >
                            <div className="h-8 w-8 rounded-lg bg-[#0077B5]/10 border border-[#0077B5]/20 flex items-center justify-center flex-shrink-0">
                              <img src="/provider-logos/linkedin.png" alt="LinkedIn" className="h-[18px] w-[18px] object-contain" />
                            </div>
                            <p className="text-[12px] font-medium text-gray-900 truncate">{connectingLinkedIn ? "Connecting…" : "LinkedIn"}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-4 pt-1">
              <button
                onClick={() => { setSelectedProvider(null); setCredentials({}); setConnectionName(""); setTestResult(null); }}
                className="text-[12px] text-gray-400 hover:text-gray-700 transition-colors"
              >← Back</button>

              {/* Provider identity header */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                <ProviderLogo provider={selectedProvider} size={36} />
                <div>
                  <p className="text-[13px] font-semibold text-gray-900">{selectedProvider.display_name}</p>
                  <p className="text-[11px] text-gray-400">{CATEGORY_LABEL[selectedProvider.category] ?? "Integration"} · API Key</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="connection-name" className="text-xs font-medium">Connection name</Label>
                <Input id="connection-name" placeholder={selectedProvider.display_name} value={connectionName} onChange={e => setConnectionName(e.target.value)} className="h-9 text-sm" />
              </div>

              {isOAuth(selectedProvider) ? (
                <div className="space-y-3">
                  <Button onClick={handleOAuthConnect} disabled={oauthLoading || !connectionName.trim()} className="w-full h-9 text-sm">
                    {oauthLoading ? <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />Connecting…</> : `Connect ${selectedProvider.display_name}`}
                  </Button>
                  <p className="text-[11px] text-gray-400 text-center">You'll be redirected to authorize securely</p>
                </div>
              ) : (
                <>
                  {selectedProvider.auth_fields?.map((field: any) => {
                    const fk = field.key || field.name;
                    return (
                    <div key={fk} className="space-y-1.5">
                      <Label htmlFor={fk} className="text-xs font-medium">{field.label}</Label>
                      <div className="relative">
                        <Input
                          id={fk}
                          type={field.type === "password" && !showSecrets[fk] ? "password" : "text"}
                          placeholder={field.placeholder}
                          value={credentials[fk] || ""}
                          onChange={e => setCredentials(prev => ({ ...prev, [fk]: e.target.value }))}
                          className="pr-10 h-9 text-sm"
                        />
                        {field.type === "password" && (
                          <button type="button" onClick={() => setShowSecrets(prev => ({ ...prev, [fk]: !prev[fk] }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                            {showSecrets[fk] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        )}
                      </div>
                      {(field.description || field.help) && <p className="text-[11px] text-gray-400">{field.description || field.help}</p>}
                    </div>
                    );
                  })}

                  {testResult && (
                    <div className={cn("flex items-center gap-2 px-3 py-2.5 rounded-lg", testResult.verified ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
                      {testResult.verified ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> : <X className="h-4 w-4 flex-shrink-0" />}
                      <span className="text-xs">{testResult.message || testResult.error}</span>
                      {testResult.mode && <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-white/60">{testResult.mode === "live" ? "Live" : "Test"}</span>}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleTestConnection} disabled={testing || Object.values(credentials).every(v => !v)}>
                      {testing ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Testing…</> : "Test connection"}
                    </Button>
                    <Button size="sm" className="h-8 text-xs" onClick={handleSaveConnection} disabled={saving || !testResult?.verified || !connectionName.trim()}>
                      {saving ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Saving…</> : "Save"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Update credentials dialog ────────────── */}
      <Dialog open={!!editingConnection} onOpenChange={open => { if (!open) { setEditingConnection(null); setEditCredentials({}); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-[15px]">Update credentials</DialogTitle></DialogHeader>
          {editingConnection && (
            <div className="space-y-4 pt-1">
              {(editingConnection.provider?.auth_fields?.filter((f: any) => typeof f === "object" && (f.key || f.name)) || [{ key: "api_key", label: "API Key", type: "password" }]).map((field: any) => {
                const fk = field.key || field.name;
                return (
                <div key={fk} className="space-y-1.5">
                  <Label htmlFor={`edit-${fk}`} className="text-xs font-medium">{field.label || fk}</Label>
                  <div className="relative">
                    <Input
                      id={`edit-${fk}`}
                      type={field.type === "password" && !showSecrets[`edit-${fk}`] ? "password" : "text"}
                      placeholder={`Enter new ${field.label || fk}`}
                      value={editCredentials[fk] || ""}
                      onChange={e => setEditCredentials(prev => ({ ...prev, [fk]: e.target.value }))}
                      className="pr-10 h-9 text-sm"
                    />
                    {field.type === "password" && (
                      <button type="button" onClick={() => setShowSecrets(prev => ({ ...prev, [`edit-${fk}`]: !prev[`edit-${fk}`] }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        {showSecrets[`edit-${fk}`] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </div>
                </div>
                );
              })}
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="h-8 text-xs" onClick={handleUpdateCredentials} disabled={updatingCredentials}>
                  {updatingCredentials ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Saving…</> : "Save"}
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setEditingConnection(null); setEditCredentials({}); }} disabled={updatingCredentials}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Webhook detail modal ─────────────────── */}
      {(() => {
        const w   = WEBHOOK_SOURCES.find(s => s.source === webhookDetail);
        const sub = webhookDetail ? subscriptions[webhookDetail] : null;
        const url = webhookDetail ? (webhookUrls[webhookDetail] || "") : "";
        const masked = url ? url.replace(/secret=([^&]+)/, (_: string, s: string) => `secret=${s.slice(0,8)}••••`) : "";
        return (
          <Dialog open={!!webhookDetail} onOpenChange={open => { if (!open) setWebhookDetail(null); }}>
            <DialogContent className="max-w-lg w-[calc(100vw-2rem)] max-h-[90vh] flex flex-col overflow-hidden p-0">
              {w && (
                <>
                  {/* Header */}
                  <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
                    <div className="h-10 w-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {w.logo ? <img src={w.logo} alt={w.label} className="h-[22px] w-[22px] object-contain" /> : <Webhook className="h-4 w-4 text-gray-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <DialogTitle className="text-[15px] font-semibold">{w.label} webhook</DialogTitle>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", sub?.status === 'live' ? "bg-emerald-500" : "bg-amber-400")} />
                        <span className={cn("text-[11px] font-medium", sub?.status === 'live' ? "text-emerald-600" : "text-amber-500")}>
                          {sub?.status === 'live' ? "Live — receiving events" : "Pending — no events received yet"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Scrollable body */}
                  <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">

                    {/* Live status banner */}
                    {sub?.status === 'live' && (
                      <div className="flex items-center gap-2.5 bg-emerald-50 border border-emerald-100 rounded-xl px-3.5 py-3">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                        <p className="text-[12px] text-emerald-700 font-medium">Live — events from {w.label} are flowing into People automatically.</p>
                      </div>
                    )}

                    {/* Inbound URL */}
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">Webhook URL</p>
                      <div className="flex items-start gap-2 bg-white border border-gray-200 rounded-xl px-3.5 py-3">
                        <code className="text-[11px] text-gray-800 font-mono break-all flex-1 leading-relaxed select-all">{masked || "Loading…"}</code>
                        <button onClick={() => copyWebhook(webhookDetail!)} className="flex-shrink-0 text-gray-400 hover:text-gray-700 transition-colors mt-0.5">
                          {webhookCopied === webhookDetail ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* Events subscribed */}
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Events Proply listens for</p>
                      <div className="flex flex-wrap gap-1.5">
                        {w.events.map(ev => (
                          <span key={ev.label} className="px-2.5 py-1 bg-gray-100 text-gray-700 text-[12px] font-medium rounded-lg">{ev.label}</span>
                        ))}
                      </div>
                    </div>

                  </div>

                  {/* Footer actions */}
                  <div className="flex flex-col gap-2 px-5 py-3.5 border-t border-gray-100 flex-shrink-0 bg-white">
                    {/* Inline test result */}
                    {webhookTestResult?.source === webhookDetail && (
                      webhookTestResult.ok ? (
                        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                          <p className="text-[12px] font-medium text-emerald-700">Connected successfully — webhook is now live!</p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                          <X className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                          <p className="text-[12px] font-medium text-red-600">No events received yet. Paste the URL above and send a test event from {w.label}, then try again.</p>
                        </div>
                      )
                    )}
                    <div className="flex items-center gap-3">
                      <Button
                        onClick={() => testWebhook(webhookDetail!)}
                        disabled={testingWebhook === webhookDetail}
                        className={cn(
                          "flex-1 h-9 text-[13px]",
                          sub?.status === 'live' ? "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 shadow-none" : "bg-gray-900 hover:bg-gray-800"
                        )}
                        variant={sub?.status === 'live' ? "outline" : "default"}
                      >
                        {testingWebhook === webhookDetail
                          ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Checking…</>
                          : sub?.status === 'live'
                            ? <><RefreshCw className="h-3.5 w-3.5 mr-2" />Re-test</>
                            : <><RefreshCw className="h-3.5 w-3.5 mr-2" />Check status</>}
                      </Button>
                      <button
                        onClick={() => removeWebhook(webhookDetail!)}
                        disabled={removingWebhook === webhookDetail}
                        className="h-9 px-3 text-[12px] text-red-500 hover:text-red-700 flex items-center gap-1 transition-colors disabled:opacity-50 rounded-lg hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />Remove
                      </button>
                    </div>
                  </div>
                </>
              )}
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* ── Connection detail modal ──────────────── */}
      <Dialog open={!!viewingConnection} onOpenChange={open => { if (!open) setViewingConnection(null); }}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          {viewingConnection && (() => {
            const provider  = viewingConnection.provider;
            const caps      = PROVIDER_CAPABILITIES[(provider?.name || "").toLowerCase()] || [];
            const category  = CATEGORY_LABEL[provider?.category] ?? "Other";
            return (
              <>
                <DialogHeader>
                  <div className="flex items-center gap-3">
                    <ProviderLogo provider={provider} size={40} />
                    <div>
                      <DialogTitle className="text-[15px]">{provider?.display_name}</DialogTitle>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-gray-400">{category}</span>
                        <span className="text-gray-300">·</span>
                        <span className={cn("text-[11px] font-medium", viewingConnection.is_verified ? "text-emerald-600" : "text-amber-500")}>
                          {viewingConnection.is_verified ? "Connected" : "Unverified"}
                        </span>
                      </div>
                    </div>
                  </div>
                </DialogHeader>

                {caps.length > 0 && (
                  <div className="mt-1">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Zap className="h-3.5 w-3.5 text-gray-400" />
                      <p className="text-[12px] font-semibold text-gray-700">{caps.length} actions available</p>
                    </div>
                    <div className="space-y-1">
                      {caps.map(cap => (
                        <div key={cap.action} className="flex items-center justify-between py-1.5 px-2.5 rounded-lg hover:bg-gray-50 transition-colors">
                          <span className="text-[12px] text-gray-800">{cap.label}</span>
                          <code className="text-[10px] text-gray-400 font-mono">{cap.action}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {provider?.name === 'apollo' && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 pr-4">
                        <p className="text-[12px] font-semibold text-gray-800">Use Apollo for contact enrichment</p>
                        <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                          {viewingConnection.encrypted_credentials?.use_for_enrichment
                            ? "On — enrichment uses your Apollo credits"
                            : "Off — enrichment uses your connected Prospeo key (or Proply's built-in)"}
                        </p>
                      </div>
                      <Switch
                        checked={!!viewingConnection.encrypted_credentials?.use_for_enrichment}
                        disabled={togglingEnrichment}
                        onCheckedChange={v => handleEnrichmentToggle(viewingConnection.id, v)}
                      />
                    </div>
                  </div>
                )}

                {provider?.name === 'prospeo' && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5">
                    <p className="text-[12px] font-semibold text-gray-800">Prospeo enrichment active</p>
                    <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                      Your Prospeo key is used for contact enrichment when Apollo is not enabled. Covers email, title, seniority, company data, and ICP scoring.
                    </p>
                  </div>
                )}

                {provider?.name === 'signalbase' && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5">
                    <p className="text-[12px] font-semibold text-gray-800">SignalBase signals active</p>
                    <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                      After every contact enrichment, Proply scans SignalBase for job changes, funding rounds, and hiring signals at their company and logs them as activity.
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                  <Button
                    size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                    onClick={() => { setViewingConnection(null); setEditingConnection(viewingConnection); setEditCredentials({}); }}
                  >
                    <Key className="h-3 w-3" />Update credentials
                  </Button>
                  <Button
                    size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                    onClick={() => handleRetestConnection(viewingConnection.id)}
                    disabled={retestingConnection === viewingConnection.id}
                  >
                    <RefreshCw className={cn("h-3 w-3", retestingConnection === viewingConnection.id && "animate-spin")} />
                    {retestingConnection === viewingConnection.id ? "Testing…" : "Test"}
                  </Button>
                  <button
                    onClick={() => { setViewingConnection(null); setConnectionToDelete({ id: viewingConnection.id, name: viewingConnection.name }); }}
                    className="ml-auto text-[12px] text-red-500 hover:text-red-700 transition-colors flex items-center gap-1"
                  >
                    <Trash2 className="h-3.5 w-3.5" />Disconnect
                  </button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ─────────────────────── */}
      <AlertDialog open={!!connectionToDelete} onOpenChange={open => !open && setConnectionToDelete(null)}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove "{connectionToDelete?.name}" and revoke access.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConnection} className="bg-red-600 hover:bg-red-700 text-white">Disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {airtableSyncConnection && (
        <AirtableSyncConfig
          open={!!airtableSyncConnection}
          onClose={() => setAirtableSyncConnection(null)}
          workspaceId={workspaceId || ""}
          connectionId={airtableSyncConnection.id}
          connectionName={airtableSyncConnection.name}
        />
      )}

      {crmSyncConnection && (
        <CrmSyncConfig
          open={!!crmSyncConnection}
          onClose={() => setCrmSyncConnection(null)}
          workspaceId={workspaceId || ""}
          connectionId={crmSyncConnection.connection.id}
          connectionName={crmSyncConnection.connection.name}
          provider={crmSyncConnection.provider}
        />
      )}
    </div>
  );
}

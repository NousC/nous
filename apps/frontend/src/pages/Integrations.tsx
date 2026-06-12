import { useState, useEffect } from "react";
import { ArrowLeft, Check, RefreshCw, Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { watchOAuthPopup } from "@/lib/oauthPopup";
import { IntegrationConn, AvailableProvider, IntegrationLogo } from "@/components/mind/entities";
import { PageHeader } from "@/components/ui/page-header";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NousInstallTabs } from "@/components/integrations/TrackYourSignupsCard";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

// Hardcoded providers (API key based) — mirrors the real Integrations page.
// "nous" is the self-integration: drop the CLI into your product and your own
// signups/sub events flow into your Nous workspace. Pinned to the top.
const HARDCODED_PROVIDERS: AvailableProvider[] = [
  { id:"nous",       name:"nous",       display_name:"Nous",       logo_url:"/nous-logo.svg",                  category:"self"         },
  { id:"instantly",  name:"instantly",  display_name:"Instantly",  logo_url:"/provider-logos/instantly.svg",  category:"outbound"     },
  { id:"lemlist",    name:"lemlist",    display_name:"Lemlist",    logo_url:"/provider-logos/lemlist.svg",    category:"outbound"     },
  { id:"emailbison", name:"emailbison", display_name:"EmailBison", logo_url:"/provider-logos/emailbison.png", category:"outbound"     },
  { id:"heyreach",   name:"heyreach",   display_name:"HeyReach",   logo_url:"/provider-logos/heyreach.png",   category:"outbound"     },
  { id:"smartlead",  name:"smartlead",  display_name:"Smartlead",  logo_url:"/provider-logos/smartlead.png",  category:"outbound"     },
  { id:"apollo",     name:"apollo",     display_name:"Apollo",     logo_url:"/provider-logos/apollo.svg",     category:"enrichment"   },
  { id:"prospeo",    name:"prospeo",    display_name:"Prospeo",    logo_url:"/provider-logos/prospeo.svg",    category:"enrichment"   },
  { id:"millionverifier", name:"millionverifier", display_name:"MillionVerifier", logo_url:"/provider-logos/millionverifier.png", category:"verification" },
  { id:"neverbounce",     name:"neverbounce",     display_name:"NeverBounce",     logo_url:"/provider-logos/neverbounce.png",     category:"verification" },
  { id:"fireflies", name:"fireflies", display_name:"Fireflies.ai", logo_url:"/provider-logos/fireflies.svg", category:"meetings"     },
  { id:"fathom",    name:"fathom",    display_name:"Fathom",       logo_url:"/provider-logos/fathom.svg",    category:"meetings"     },
  { id:"cal_com",   name:"cal_com",   display_name:"Cal.com",      logo_url:"/provider-logos/cal_com.svg",   category:"meetings"     },
  // LinkedIn connects natively (Unipile), not via a key form — clicking Connect in
  // the catalog hands off to connectLinkedIn(). It only appears here while NOT
  // connected; once accounts exist it renders as its own row on the main list.
  { id:"linkedin",  name:"linkedin",  display_name:"LinkedIn",     logo_url:"/provider-logos/linkedin.png",  category:"communication" },
  {
    id:"smtp", name:"smtp", display_name:"Custom SMTP / IMAP",
    logo_url:"/provider-logos/smtp.svg", category:"communication",
    auth_type: "credentials",
    auth_fields: [
      { name: "host",      label: "Mail server host",      type: "text",     placeholder: "smtp.yourdomain.com",  description: "Your provider's SMTP host. We derive the IMAP host automatically (smtp. → imap.)." },
      { name: "port",      label: "SMTP port",             type: "text",     placeholder: "587",                   description: "587 (STARTTLS) or 465 (SSL). Leave blank for 587.", optional: true },
      { name: "username",  label: "Email address",         type: "text",     placeholder: "you@yourdomain.com",   description: "The mailbox we poll for incoming messages." },
      { name: "password",  label: "Password",              type: "password", placeholder: "app-specific password", description: "For Gmail / Outlook, generate an app password — login password won't work." },
      { name: "imap_host", label: "IMAP host (optional)",  type: "text",     placeholder: "imap.yourdomain.com",  description: "Only fill in if your IMAP host doesn't match the smtp. → imap. pattern.", optional: true },
      { name: "imap_port", label: "IMAP port (optional)",  type: "text",     placeholder: "993",                   description: "Defaults to 993 (SSL).", optional: true },
    ],
  },
];
const EXCLUDED = new Set(["assetly","gmail","mailchimp","google_analytics","granola","notion","clickup","openai","gemini","google","rb2b","anthropic","stripe","signalbase","salesforce"]);

const CATEGORY_ORDER = ["self","crm","outbound","enrichment","verification","meetings","communication","database","ai","analytics","productivity","other"] as const;
const CATEGORY_LABEL: Record<string,string> = {
  self:"Nous", crm:"CRM", outbound:"Outbound", enrichment:"Enrichment", verification:"Email verification", meetings:"Meetings",
  communication:"Communication", database:"Database", ai:"AI", analytics:"Analytics",
  productivity:"Productivity", other:"Other",
};
function groupByCategory<T extends { category?: string }>(items: T[]): Array<[string, T[]]> {
  const buckets = new Map<string, T[]>();
  for (const it of items) {
    const cat = (it.category && CATEGORY_ORDER.includes(it.category as any)) ? it.category : "other";
    if (!buckets.has(cat)) buckets.set(cat, []);
    buckets.get(cat)!.push(it);
  }
  return CATEGORY_ORDER
    .filter(c => buckets.has(c))
    .map(c => [c, buckets.get(c)!] as [string, T[]]);
}

export default function Integrations() {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";

  const [dbProviders, setDbProviders] = useState<AvailableProvider[]>([]);
  const [catTab, setCatTab] = useState<string>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [connecting, setConnecting] = useState<AvailableProvider|null>(null);
  const [connApiKey, setConnApiKey] = useState("");
  const [connCreds, setConnCreds] = useState<Record<string,string>>({});
  const [connName, setConnName] = useState("");
  const [connTesting, setConnTesting] = useState(false);
  const [connTestResult, setConnTestResult] = useState<{verified:boolean;message:string}|null>(null);
  const [connSaving, setConnSaving] = useState(false);
  const [connSuccess, setConnSuccess] = useState<string|null>(null);
  const [connOAuthLoading, setConnOAuthLoading] = useState(false);
  const [liveConns, setLiveConns] = useState<IntegrationConn[]>([]);
  const [linkedinStatus, setLinkedinStatus] = useState<{
    connected:boolean; needs_reconnect?:boolean; connection:any;
    connections?:any[]; limit?:number; used?:number; can_connect_more?:boolean;
  }|null>(null);
  const [linkedinBusy, setLinkedinBusy] = useState(false);

  const fetchLinkedInStatus = () => {
    if (!token || !workspaceId) return;
    fetch(`${apiUrl}/api/linkedin/status?workspaceId=${workspaceId}`, { headers:{ Authorization:`Bearer ${token}` } })
      .then(r=>r.ok?r.json():null).then(d=>{ if (d) setLinkedinStatus(d); }).catch(()=>{});
  };

  useEffect(() => {
    if (!token || !workspaceId) return;
    fetchLinkedInStatus();
    fetch(`${apiUrl}/api/workflow-providers/connections?workspace_id=${workspaceId}`, { headers:{ Authorization:`Bearer ${token}` } })
      .then(r=>r.ok?r.json():{}).then(d=>setLiveConns(d.connections??[])).catch(()=>{});
    fetch(`${apiUrl}/api/workflow-providers`, { headers:{ Authorization:`Bearer ${token}` } })
      .then(r=>r.ok?r.json():{}).then(d=>{
        const list: any[] = d.providers || d || [];
        const hardcodedNames = new Set(HARDCODED_PROVIDERS.map(h=>h.name));
        const filtered = list.filter((p:any) => p.auth_type !== "none" && !EXCLUDED.has(p.name) && !hardcodedNames.has(p.name));
        setDbProviders(filtered);
      }).catch(()=>{});
  }, [token, workspaceId]);

  const allProviders: AvailableProvider[] = [...HARDCODED_PROVIDERS, ...dbProviders];
  const visibleConns = liveConns.filter(c => !EXCLUDED.has((c.provider?.name || "").toLowerCase()));
  const connected  = visibleConns.filter(i=>i.is_verified);
  const needsAuth  = visibleConns.filter(i=>!i.is_verified);
  const linkedinAccountCount = linkedinStatus?.connections?.length ?? 0;
  const notConnected = allProviders.filter(p => {
    // LinkedIn lives in workspace_linkedin_connections (native), not workflow
    // connections — show it in the catalog only until at least one account is on.
    if (p.name === "linkedin") return linkedinAccountCount === 0;
    return !visibleConns.some(i=>i.provider?.name===p.name||i.name===p.name);
  });

  const isOAuth = (p: AvailableProvider | null) =>
    p?.auth_type === "oauth2" || ["airtable","notion","google_analytics","slack","gmail","granola","salesforce"].includes(p?.name ?? "");

  const startConnect = (p: AvailableProvider) => {
    // LinkedIn is native (Unipile) — hand off to its own popup flow, not the
    // credential form. Close the catalog so the popup is unobstructed.
    if (p.name === "linkedin") { setAddOpen(false); connectLinkedIn(); return; }
    const hardcoded = HARDCODED_PROVIDERS.find(h => h.name === p.name);
    const merged = hardcoded ? { ...p, auth_fields: hardcoded.auth_fields, auth_type: hardcoded.auth_type } : p;
    setConnecting(merged); setConnApiKey(""); setConnCreds({}); setConnName(merged.display_name);
    setConnTestResult(null); setConnSuccess(null); setConnOAuthLoading(false);
  };

  // LinkedIn (Unipile) — its own native connection, separate from the
  // workflow-provider OAuth/API-key flow. Opens the Unipile hosted-auth popup.
  const connectLinkedIn = async () => {
    if (!token || !workspaceId) return;
    setLinkedinBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/linkedin/connect?workspaceId=${workspaceId}`, { headers:{ Authorization:`Bearer ${token}` } });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.message || e.error || "Couldn't start LinkedIn connection"); }
      const { url } = await res.json();
      const w = 600, h = 700;
      window.open(url, "LinkedInUnipile", `width=${w},height=${h},left=${window.screenX+(window.outerWidth-w)/2},top=${window.screenY+(window.outerHeight-h)/2}`);
      let cleanup: (()=>void)|null = null;
      const onMessage = (e: MessageEvent) => {
        if (e.data?.type !== "linkedin_auth") return;
        window.removeEventListener("message", onMessage); cleanup?.(); setLinkedinBusy(false);
        if (e.data.success) { toast.success("LinkedIn connected"); fetchLinkedInStatus(); }
        else toast.error("LinkedIn connection failed. Please try again.");
      };
      window.addEventListener("message", onMessage);
      cleanup = watchOAuthPopup({ onClose: () => { window.removeEventListener("message", onMessage); setLinkedinBusy(false); fetchLinkedInStatus(); } });
    } catch (err: any) { toast.error(err.message || "Failed to connect LinkedIn"); setLinkedinBusy(false); }
  };

  const disconnectLinkedIn = async (accountId?: string) => {
    if (!token || !workspaceId) return;
    if (!window.confirm(accountId
      ? "Disconnect this LinkedIn account? This removes the Unipile link and stops its signals + weekly engagement run."
      : "Disconnect LinkedIn? This removes the Unipile link and stops LinkedIn signals + the weekly engagement run.")) return;
    setLinkedinBusy(true);
    try {
      const qs = accountId ? `&accountId=${encodeURIComponent(accountId)}` : "";
      const res = await fetch(`${apiUrl}/api/linkedin/disconnect?workspaceId=${workspaceId}${qs}`, { method:"DELETE", headers:{ Authorization:`Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to disconnect");
      toast.success("LinkedIn disconnected");
      fetchLinkedInStatus();
    } catch (err: any) { toast.error(err.message || "Failed to disconnect"); }
    finally { setLinkedinBusy(false); }
  };

  const handleOAuthConnect = async () => {
    if (!connecting || !workspaceId || !token) return;
    setConnOAuthLoading(true);
    try {
      let url = `${apiUrl}/api/workflow-providers/${connecting.name}/oauth/authorize?workspace_id=${workspaceId}&connectionName=${encodeURIComponent(connName.trim() || connecting.display_name)}`;
      if (connecting.name === "gmail" || connecting.name === "gmail_oauth")
        url = `${apiUrl}/api/oauth/google/gmail/authorize?workspaceId=${workspaceId}&connectionName=${encodeURIComponent(connName.trim() || connecting.display_name)}`;

      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setConnTestResult({ verified: false, message: body.message || "Failed to initiate OAuth" });
        setConnOAuthLoading(false);
        return;
      }
      const data = await resp.json();
      const authUrl = data.authUrl || data.authorization_url;
      if (!authUrl) { setConnTestResult({ verified: false, message: "No authorization URL returned" }); setConnOAuthLoading(false); return; }

      const w = 600, h = 700;
      window.open(authUrl, `${connecting.name}OAuth`, `width=${w},height=${h},left=${window.screenX + (window.outerWidth - w) / 2},top=${window.screenY + (window.outerHeight - h) / 2}`);

      watchOAuthPopup({
        onClose: () => {
          setConnOAuthLoading(false);
          setConnSuccess(connecting.display_name);
          setLiveConns(prev => [...prev, { id: Date.now().toString(), name: connName.trim() || connecting.display_name, is_verified: true, provider: { display_name: connecting.display_name, logo_url: connecting.logo_url, category: connecting.category, name: connecting.name, auth_type: connecting.auth_type } }]);
          setTimeout(() => { setConnecting(null); setConnSuccess(null); setAddOpen(false); }, 1500);
        },
      });
    } catch { setConnTestResult({ verified: false, message: "OAuth failed" }); setConnOAuthLoading(false); }
  };

  const [disconnecting, setDisconnecting] = useState<string|null>(null);
  const disconnect = async (conn: IntegrationConn) => {
    if (!workspaceId || !token) return;
    if (!window.confirm(`Disconnect ${conn.provider?.display_name || conn.name}? This removes the credentials and any auto-registered webhooks.`)) return;
    setDisconnecting(conn.id);
    try {
      const res = await fetch(`${apiUrl}/api/workflow-providers/connections/${conn.id}?workspace_id=${workspaceId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to disconnect");
      setLiveConns(prev => prev.filter(c => c.id !== conn.id));
      toast.success(`${conn.provider?.display_name || conn.name} disconnected`);
    } catch (e: any) {
      toast.error(e.message || "Disconnect failed");
    } finally {
      setDisconnecting(null);
    }
  };

  const isMultiField = !!connecting?.auth_fields && connecting.auth_fields.length > 0
    && !(connecting.auth_fields.length === 1 && connecting.auth_fields[0].name === "api_key");

  const credsComplete = () => {
    if (!connecting) return false;
    if (!isMultiField) return !!connApiKey.trim();
    return (connecting.auth_fields || [])
      .filter(f => !f.optional)
      .every(f => (connCreds[f.name] || "").trim() !== "");
  };

  const testConnection = async () => {
    if (!connecting || !credsComplete()) return;
    setConnTesting(true); setConnTestResult(null);
    try {
      let res: Response;
      if (isMultiField) {
        const provRes = await fetch(`${apiUrl}/api/workflow-providers`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const provData = await provRes.json().catch(() => ({}));
        const provider = (provData.providers || []).find((p: any) => p.name === connecting.name);
        if (!provider?.id) throw new Error(`Provider ${connecting.name} not found`);
        res = await fetch(`${apiUrl}/api/workflow-providers/connections/test`, {
          method:"POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${token}`},
          body: JSON.stringify({ provider_id: provider.id, credentials: connCreds }),
        });
      } else {
        res = await fetch(`${apiUrl}/api/workflow-providers/${connecting.name}/test`, {
          method:"POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${token}`},
          body: JSON.stringify({ api_key: connApiKey }),
        });
      }
      setConnTestResult(await res.json());
    } catch (e: any) { setConnTestResult({ verified:false, message: e.message || "Connection failed" }); }
    finally { setConnTesting(false); }
  };

  const saveConnection = async () => {
    if (!connecting || !connTestResult?.verified) return;
    setConnSaving(true);
    try {
      let res: Response;
      if (isMultiField) {
        const provRes = await fetch(`${apiUrl}/api/workflow-providers`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const provData = await provRes.json().catch(() => ({}));
        const provider = (provData.providers || []).find((p: any) => p.name === connecting.name);
        if (!provider?.id) throw new Error(`Provider ${connecting.name} not found`);
        res = await fetch(`${apiUrl}/api/workflow-providers/connections`, {
          method:"POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${token}`},
          body: JSON.stringify({ workspace_id: workspaceId, provider_id: provider.id, name: connName.trim()||connecting.display_name, credentials: connCreds, is_verified: true }),
        });
      } else {
        res = await fetch(`${apiUrl}/api/workflow-providers/${connecting.name}/connect`, {
          method:"POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${token}`},
          body: JSON.stringify({ workspace_id: workspaceId, name: connName.trim()||connecting.display_name, api_key: connApiKey }),
        });
      }
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.note) toast.info(body.note);
        setConnSuccess(connecting.display_name);
        setLiveConns(prev => [...prev, { id: Date.now().toString(), name: connName.trim()||connecting.display_name, is_verified: true, provider: { display_name: connecting.display_name, logo_url: connecting.logo_url, category: connecting.category, name: connecting.name } }]);
        setTimeout(() => { setConnecting(null); setConnSuccess(null); setAddOpen(false); }, 1500);
      } else {
        const err = await res.json().catch(()=>({}));
        setConnTestResult({ verified:false, message: err.error||"Failed to save" });
      }
    } catch { setConnTestResult({ verified:false, message:"Save failed" }); }
    finally { setConnSaving(false); }
  };

  // Connected list — category tabs derive from connected providers
  const allConns = [...connected, ...needsAuth];
  const connsWithCat = allConns.map(c => ({ ...c, category: c.provider?.category }));
  const connectedGrouped = groupByCategory(connsWithCat);
  const connectedCats = connectedGrouped.map(([cat]) => cat);
  // LinkedIn renders as its own row on the main list only once at least one account
  // is connected; before that it lives in the Add-integration catalog like any tool.
  const showLinkedInRow = (catTab === "all" || catTab === "communication") && linkedinAccountCount > 0;
  const filteredConns = catTab === "all"
    ? connsWithCat
    : connsWithCat.filter(c => {
        const cat = (c.category && CATEGORY_ORDER.includes(c.category as any)) ? c.category : "other";
        return cat === catTab;
      });

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-8 py-7">
        <PageHeader
          title="Integrations"
          actions={
            <button onClick={() => { setConnecting(null); setAddOpen(true); }}
              aria-label="Add an integration"
              className="h-9 w-9 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 flex items-center justify-center transition-colors">
              <Plus className="h-4 w-4" />
            </button>
          }
        />

        {/* Category tab row */}
        <div className="flex gap-6 border-b border-border mb-5 overflow-x-auto">
          {([["all", `All (${allConns.length})`], ...connectedCats.map(c => [c, CATEGORY_LABEL[c]] as [string,string])]).map(([t,label]) => (
            <button key={t} onClick={()=>setCatTab(t)}
              className={`pb-2.5 text-[13px] font-medium transition-colors flex-shrink-0 ${catTab===t?"text-foreground border-b-2 border-foreground -mb-px":"text-muted-foreground/70 hover:text-foreground/80"}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Integrations list — connected LinkedIn (native Unipile) sits inline as the
            first row; when nothing is connected it's offered in the + catalog instead. */}
        {(showLinkedInRow || filteredConns.length > 0) ? (
          <div className="rounded-xl border border-border overflow-hidden">
            {showLinkedInRow && (
              <div className="px-4 py-3.5 border-b border-border/60 last:border-0 hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-4 group">
                  <IntegrationLogo url="/provider-logos/linkedin.png" name="LinkedIn" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-foreground">LinkedIn</div>
                    <div className="text-[12px] text-muted-foreground/70 truncate">
                      {(linkedinStatus?.connections?.length ?? 0) > 0
                        ? `${linkedinStatus?.used ?? linkedinStatus?.connections?.length} of ${linkedinStatus?.limit ?? 0} account${(linkedinStatus?.limit ?? 0) === 1 ? "" : "s"} connected · one per rep`
                        : "Sync your LinkedIn messages, connections, and post engagers"}
                    </div>
                  </div>
                  {linkedinStatus?.can_connect_more === false ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-md border text-muted-foreground border-border bg-muted/30 flex-shrink-0"
                      title={(linkedinStatus?.limit ?? 0) === 0 ? "Connecting LinkedIn isn't on this plan" : "You've reached your plan's LinkedIn limit — upgrade or contact us"}>
                      {(linkedinStatus?.limit ?? 0) === 0 ? "Not on this plan" : "Limit reached"}
                    </span>
                  ) : (
                    <button onClick={() => connectLinkedIn()} disabled={linkedinBusy}
                      className="text-[12px] font-medium flex-shrink-0 rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:bg-primary/90 disabled:opacity-40">
                      {linkedinBusy ? "Connecting…" : (linkedinStatus?.connections?.length ?? 0) > 0 ? "Add account" : "Connect"}
                    </button>
                  )}
                </div>
                {(linkedinStatus?.connections?.length ?? 0) > 0 && (
                  <div className="mt-2.5 space-y-1.5 pl-[52px]">
                    {linkedinStatus!.connections!.map((c:any) => (
                      <div key={c.id} className="flex items-center gap-3 group/acct">
                        <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${c.linkedin_profile_url ? "bg-emerald-500" : "bg-amber-500"}`} />
                        <div className="flex-1 min-w-0 text-[12.5px] text-foreground truncate">
                          {c.linkedin_name || c.unipile_account_id}
                          {!c.linkedin_profile_url && <span className="text-amber-600 ml-2 text-[11px]">needs reconnect</span>}
                        </div>
                        <button onClick={() => disconnectLinkedIn(c.unipile_account_id)} disabled={linkedinBusy}
                          className="text-[11.5px] font-medium text-muted-foreground hover:text-red-500 transition-colors opacity-0 group-hover/acct:opacity-100 flex-shrink-0 rounded-md border border-border px-2 py-0.5 hover:border-red-200 disabled:opacity-40">
                          Disconnect
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {filteredConns.map((conn: any) => {
              const providerForConnect: AvailableProvider = {
                id: conn.provider?.name ?? conn.name,
                name: conn.provider?.name ?? conn.name,
                display_name: conn.provider?.display_name ?? conn.name,
                logo_url: conn.provider?.logo_url,
                category: conn.provider?.category,
                auth_type: conn.provider?.auth_type,
              };
              return (
                <div key={conn.id} className="flex items-center gap-4 px-4 py-3.5 border-b border-border/60 last:border-0 hover:bg-muted/50 transition-colors group">
                  <IntegrationLogo url={conn.provider?.logo_url} name={conn.provider?.display_name??conn.name} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-foreground">{conn.provider?.display_name??conn.name}</div>
                    {conn.name && conn.name !== (conn.provider?.display_name??"") && (
                      <div className="text-[12px] text-muted-foreground/70 truncate">{conn.name}</div>
                    )}
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded-md border flex-shrink-0 ${conn.is_verified?"text-emerald-700 border-emerald-200 bg-emerald-50":"text-amber-700 border-amber-200 bg-amber-50"}`}>
                    {conn.is_verified ? "Connected" : "Needs auth"}
                  </span>
                  {(conn.provider?.name === "calendly" || conn.provider?.name === "cal_com") && conn.webhook_registered && (
                    <span title="Webhook auto-registered — bookings and cancellations flow into your CRM automatically." className="text-[11px] px-2 py-0.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 flex-shrink-0">
                      Webhook ✓
                    </span>
                  )}
                  <button onClick={()=>{ startConnect(providerForConnect); setAddOpen(true); }}
                    className="text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0 ml-2 rounded-md border border-border px-2.5 py-1 hover:bg-muted/50">
                    Update
                  </button>
                  <button onClick={()=>disconnect(conn)} disabled={disconnecting===conn.id}
                    title="Disconnect this integration"
                    className="text-[12px] font-medium text-muted-foreground hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0 rounded-md border border-border px-2.5 py-1 hover:border-red-200 disabled:opacity-40">
                    {disconnecting===conn.id ? "Removing…" : "Disconnect"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : allConns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-12 text-center">
            <p className="text-[13px] font-medium text-foreground/80 mb-1">No integrations connected yet</p>
            <p className="text-[12px] text-muted-foreground/70">Click the + button to connect your first tool.</p>
          </div>
        ) : (
          <div className="text-[13px] text-muted-foreground/70 text-center py-12">No integrations in this category</div>
        )}
      </div>

      {/* Add an integration modal */}
      <Dialog open={addOpen} onOpenChange={(o)=>{ setAddOpen(o); if (!o) setConnecting(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[18px] font-bold tracking-tight text-foreground">
              {connecting ? (
                <span className="flex items-center gap-2.5">
                  <button onClick={()=>setConnecting(null)}
                    className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors">
                    <ArrowLeft className="h-3.5 w-3.5"/>
                  </button>
                  <IntegrationLogo url={connecting.logo_url} name={connecting.display_name} size={24}/>
                  {connecting.display_name}
                </span>
              ) : "Add an integration"}
            </DialogTitle>
          </DialogHeader>

          {connecting ? (
            connSuccess ? (
              <div className="text-center py-10">
                <Check className="h-9 w-9 text-emerald-600 mx-auto mb-2"/>
                <div className="text-[14px] font-semibold text-emerald-700">{connSuccess} connected</div>
              </div>
            ) : connecting.name === "nous" ? (
              <div className="rounded-xl border border-border p-5">
                <NousInstallTabs />
              </div>
            ) : isOAuth(connecting) ? (
              <div className="rounded-xl border border-border p-5 space-y-4">
                <div>
                  <div className="text-[11px] font-medium text-muted-foreground/70 mb-1.5">Connection name</div>
                  <input value={connName} onChange={e=>setConnName(e.target.value)}
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-[13px] text-foreground focus:border-foreground/40 outline-none"/>
                </div>
                {connTestResult && (
                  <div className="text-[12px] px-3 py-2 rounded-lg border text-red-600 border-red-200 bg-red-50">
                    {connTestResult.message}
                  </div>
                )}
                <button onClick={handleOAuthConnect} disabled={connOAuthLoading}
                  className="w-full inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40">
                  {connOAuthLoading ? <><RefreshCw className="h-3.5 w-3.5 animate-spin"/>Connecting…</> : `Connect ${connecting?.display_name} via OAuth`}
                </button>
                <p className="text-[12px] text-muted-foreground/70 text-center">You'll be redirected to authorize securely</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border p-5 space-y-4">
                <div>
                  <div className="text-[11px] font-medium text-muted-foreground/70 mb-1.5">Connection name</div>
                  <input value={connName} onChange={e=>setConnName(e.target.value)}
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-[13px] text-foreground focus:border-foreground/40 outline-none"/>
                </div>

                {isMultiField ? (
                  (connecting?.auth_fields || []).map(f => (
                    <div key={f.name}>
                      <div className="text-[11px] font-medium text-muted-foreground/70 mb-1.5">{f.label}{f.optional ? <span className="text-muted-foreground/50 ml-1.5">(optional)</span> : null}</div>
                      <input
                        type={f.type === "password" ? "password" : "text"}
                        value={connCreds[f.name] || ""}
                        onChange={e => setConnCreds(prev => ({ ...prev, [f.name]: e.target.value }))}
                        placeholder={f.placeholder || ""}
                        onKeyDown={e => { if (e.key === "Enter" && credsComplete()) testConnection(); }}
                        className="w-full h-9 rounded-lg border border-border bg-background px-3 text-[13px] text-foreground focus:border-foreground/40 outline-none placeholder:text-muted-foreground/70"
                      />
                      {f.description && <p className="text-[12px] text-muted-foreground/70 mt-1">{f.description}</p>}
                    </div>
                  ))
                ) : (
                  <div>
                    <div className="text-[11px] font-medium text-muted-foreground/70 mb-1.5">API key</div>
                    <input type="password" value={connApiKey} onChange={e=>setConnApiKey(e.target.value)}
                      placeholder="Enter API key…"
                      onKeyDown={e=>{if(e.key==="Enter")testConnection();}}
                      className="w-full h-9 rounded-lg border border-border bg-background px-3 text-[13px] text-foreground focus:border-foreground/40 outline-none placeholder:text-muted-foreground/70"/>
                  </div>
                )}

                {connTestResult && (
                  <div className={`text-[12px] px-3 py-2 rounded-lg border ${connTestResult.verified?"text-emerald-700 border-emerald-200 bg-emerald-50":"text-red-600 border-red-200 bg-red-50"}`}>
                    {connTestResult.message}
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={testConnection} disabled={connTesting||!credsComplete()}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors disabled:opacity-40">
                    {connTesting?<><RefreshCw className="h-3.5 w-3.5 animate-spin"/>Testing…</>:"Test connection"}
                  </button>
                  <button onClick={saveConnection} disabled={connSaving||!connTestResult?.verified}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40">
                    {connSaving?<><RefreshCw className="h-3.5 w-3.5 animate-spin"/>Saving…</>:"Save"}
                  </button>
                </div>
              </div>
            )
          ) : (
            notConnected.length === 0 ? (
              <div className="text-[13px] text-muted-foreground/70 text-center py-12">All providers connected</div>
            ) : (
              <div className="space-y-5">
                {groupByCategory(notConnected).map(([cat, items]) => (
                  <div key={cat}>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-2">
                      {CATEGORY_LABEL[cat]} <span className="text-muted-foreground/50 font-normal ml-1">{items.length}</span>
                    </div>
                    <div className="rounded-xl border border-border overflow-hidden">
                      {items.map(p => {
                        const isSoon = (p as any).coming_soon;
                        return (
                          <div key={p.id} className={`flex items-center gap-4 px-4 py-3.5 border-b border-border/60 last:border-0 transition-colors group ${isSoon ? "opacity-60" : "hover:bg-muted/50"}`}>
                            <IntegrationLogo url={p.logo_url} name={p.display_name} />
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-semibold text-foreground">{p.display_name}</div>
                            </div>
                            {isSoon ? (
                              <span className="text-[11px] text-muted-foreground/70 rounded-md border border-border px-2 py-0.5 flex-shrink-0 uppercase tracking-wide">
                                Coming soon
                              </span>
                            ) : (
                              <button onClick={()=>startConnect(p)}
                                className="text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 rounded-md border border-border px-2.5 py-1 hover:bg-muted/50">
                                Connect
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

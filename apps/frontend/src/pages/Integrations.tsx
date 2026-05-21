import { useState, useEffect } from "react";
import { ArrowLeft, Check, RefreshCw, Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { watchOAuthPopup } from "@/lib/oauthPopup";
import { IntegrationConn, AvailableProvider, IntegrationLogo } from "@/components/mind/entities";
import { PageHeader } from "@/components/ui/page-header";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

// Hardcoded providers (API key based) — mirrors the real Integrations page
const HARDCODED_PROVIDERS: AvailableProvider[] = [
  { id:"instantly",  name:"instantly",  display_name:"Instantly",  logo_url:"/provider-logos/instantly.svg",  category:"outbound"     },
  { id:"lemlist",    name:"lemlist",    display_name:"Lemlist",    logo_url:"/provider-logos/lemlist.svg",    category:"outbound"     },
  { id:"apollo",     name:"apollo",     display_name:"Apollo",     logo_url:"/provider-logos/apollo.svg",     category:"enrichment"   },
  { id:"prospeo",    name:"prospeo",    display_name:"Prospeo",    logo_url:"/provider-logos/prospeo.svg",    category:"enrichment"   },
  { id:"fireflies", name:"fireflies", display_name:"Fireflies.ai", logo_url:"/provider-logos/fireflies.svg", category:"meetings"     },
  { id:"fathom",    name:"fathom",    display_name:"Fathom",       logo_url:"/provider-logos/fathom.svg",    category:"meetings"     },
  { id:"cal_com",   name:"cal_com",   display_name:"Cal.com",      logo_url:"/provider-logos/cal_com.svg",   category:"meetings"     },
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
const EXCLUDED = new Set(["assetly","nous","gmail","mailchimp","google_analytics","granola","notion","clickup","openai","gemini","google","rb2b","anthropic","stripe","signalbase","salesforce"]);

const CATEGORY_ORDER = ["crm","outbound","enrichment","meetings","communication","database","ai","analytics","productivity","other"] as const;
const CATEGORY_LABEL: Record<string,string> = {
  crm:"CRM", outbound:"Outbound", enrichment:"Enrichment", meetings:"Meetings",
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

  useEffect(() => {
    if (!token || !workspaceId) return;
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
  const notConnected = allProviders.filter(p=>!visibleConns.some(i=>i.provider?.name===p.name||i.name===p.name));

  const isOAuth = (p: AvailableProvider | null) =>
    p?.auth_type === "oauth2" || ["airtable","notion","google_analytics","slack","gmail","granola","salesforce"].includes(p?.name ?? "");

  const startConnect = (p: AvailableProvider) => {
    const hardcoded = HARDCODED_PROVIDERS.find(h => h.name === p.name);
    const merged = hardcoded ? { ...p, auth_fields: hardcoded.auth_fields, auth_type: hardcoded.auth_type } : p;
    setConnecting(merged); setConnApiKey(""); setConnCreds({}); setConnName(merged.display_name);
    setConnTestResult(null); setConnSuccess(null); setConnOAuthLoading(false);
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
  const filteredConns = catTab === "all"
    ? connsWithCat
    : connsWithCat.filter(c => {
        const cat = (c.category && CATEGORY_ORDER.includes(c.category as any)) ? c.category : "other";
        return cat === catTab;
      });

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="px-8 py-7">
        <PageHeader
          title="Integrations"
          subtitle="Connect the tools your team already uses to push signals into Nous."
          actions={
            <button onClick={() => { setConnecting(null); setAddOpen(true); }}
              aria-label="Add an integration"
              className="h-9 w-9 rounded-lg bg-gray-900 text-white hover:bg-gray-800 flex items-center justify-center transition-colors">
              <Plus className="h-4 w-4" />
            </button>
          }
        />

        {/* Category tab row */}
        <div className="flex gap-6 border-b border-gray-200 mb-5 overflow-x-auto">
          {([["all", `All (${allConns.length})`], ...connectedCats.map(c => [c, CATEGORY_LABEL[c]] as [string,string])]).map(([t,label]) => (
            <button key={t} onClick={()=>setCatTab(t)}
              className={`pb-2.5 text-[13px] font-medium transition-colors flex-shrink-0 ${catTab===t?"text-gray-900 border-b-2 border-gray-900 -mb-px":"text-gray-400 hover:text-gray-700"}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Connected integrations list */}
        {allConns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center">
            <p className="text-[13px] font-medium text-gray-700 mb-1">No integrations connected yet</p>
            <p className="text-[12px] text-gray-400">Click the + button to connect your first tool.</p>
          </div>
        ) : filteredConns.length === 0 ? (
          <div className="text-[13px] text-gray-400 text-center py-12">No integrations in this category</div>
        ) : (
          <div className="rounded-xl border border-gray-200 overflow-hidden">
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
                <div key={conn.id} className="flex items-center gap-4 px-4 py-3.5 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors group">
                  <IntegrationLogo url={conn.provider?.logo_url} name={conn.provider?.display_name??conn.name} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-gray-900">{conn.provider?.display_name??conn.name}</div>
                    {conn.name && conn.name !== (conn.provider?.display_name??"") && (
                      <div className="text-[12px] text-gray-400 truncate">{conn.name}</div>
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
                    className="text-[12px] font-medium text-gray-500 hover:text-gray-900 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0 ml-2 rounded-md border border-gray-200 px-2.5 py-1 hover:bg-gray-50">
                    Update
                  </button>
                  <button onClick={()=>disconnect(conn)} disabled={disconnecting===conn.id}
                    title="Disconnect this integration"
                    className="text-[12px] font-medium text-gray-500 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0 rounded-md border border-gray-200 px-2.5 py-1 hover:border-red-200 disabled:opacity-40">
                    {disconnecting===conn.id ? "Removing…" : "Disconnect"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add an integration modal */}
      <Dialog open={addOpen} onOpenChange={(o)=>{ setAddOpen(o); if (!o) setConnecting(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[18px] font-bold tracking-tight text-gray-900">
              {connecting ? (
                <span className="flex items-center gap-2.5">
                  <button onClick={()=>setConnecting(null)}
                    className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors">
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
            ) : isOAuth(connecting) ? (
              <div className="rounded-xl border border-gray-200 p-5 space-y-4">
                <div>
                  <div className="text-[11px] font-medium text-gray-400 mb-1.5">Connection name</div>
                  <input value={connName} onChange={e=>setConnName(e.target.value)}
                    className="w-full h-9 rounded-lg border border-gray-200 bg-white px-3 text-[13px] text-gray-900 focus:border-gray-400 outline-none"/>
                </div>
                {connTestResult && (
                  <div className="text-[12px] px-3 py-2 rounded-lg border text-red-600 border-red-200 bg-red-50">
                    {connTestResult.message}
                  </div>
                )}
                <button onClick={handleOAuthConnect} disabled={connOAuthLoading}
                  className="w-full inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-gray-900 text-white text-[13px] font-semibold hover:bg-gray-800 transition-colors disabled:opacity-40">
                  {connOAuthLoading ? <><RefreshCw className="h-3.5 w-3.5 animate-spin"/>Connecting…</> : `Connect ${connecting?.display_name} via OAuth`}
                </button>
                <p className="text-[12px] text-gray-400 text-center">You'll be redirected to authorize securely</p>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 p-5 space-y-4">
                <div>
                  <div className="text-[11px] font-medium text-gray-400 mb-1.5">Connection name</div>
                  <input value={connName} onChange={e=>setConnName(e.target.value)}
                    className="w-full h-9 rounded-lg border border-gray-200 bg-white px-3 text-[13px] text-gray-900 focus:border-gray-400 outline-none"/>
                </div>

                {isMultiField ? (
                  (connecting?.auth_fields || []).map(f => (
                    <div key={f.name}>
                      <div className="text-[11px] font-medium text-gray-400 mb-1.5">{f.label}{f.optional ? <span className="text-gray-300 ml-1.5">(optional)</span> : null}</div>
                      <input
                        type={f.type === "password" ? "password" : "text"}
                        value={connCreds[f.name] || ""}
                        onChange={e => setConnCreds(prev => ({ ...prev, [f.name]: e.target.value }))}
                        placeholder={f.placeholder || ""}
                        onKeyDown={e => { if (e.key === "Enter" && credsComplete()) testConnection(); }}
                        className="w-full h-9 rounded-lg border border-gray-200 bg-white px-3 text-[13px] text-gray-900 focus:border-gray-400 outline-none placeholder:text-gray-400"
                      />
                      {f.description && <p className="text-[12px] text-gray-400 mt-1">{f.description}</p>}
                    </div>
                  ))
                ) : (
                  <div>
                    <div className="text-[11px] font-medium text-gray-400 mb-1.5">API key</div>
                    <input type="password" value={connApiKey} onChange={e=>setConnApiKey(e.target.value)}
                      placeholder="Enter API key…"
                      onKeyDown={e=>{if(e.key==="Enter")testConnection();}}
                      className="w-full h-9 rounded-lg border border-gray-200 bg-white px-3 text-[13px] text-gray-900 focus:border-gray-400 outline-none placeholder:text-gray-400"/>
                  </div>
                )}

                {connTestResult && (
                  <div className={`text-[12px] px-3 py-2 rounded-lg border ${connTestResult.verified?"text-emerald-700 border-emerald-200 bg-emerald-50":"text-red-600 border-red-200 bg-red-50"}`}>
                    {connTestResult.message}
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={testConnection} disabled={connTesting||!credsComplete()}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-white border border-gray-200 text-gray-700 text-[13px] font-semibold hover:bg-gray-50 transition-colors disabled:opacity-40">
                    {connTesting?<><RefreshCw className="h-3.5 w-3.5 animate-spin"/>Testing…</>:"Test connection"}
                  </button>
                  <button onClick={saveConnection} disabled={connSaving||!connTestResult?.verified}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-gray-900 text-white text-[13px] font-semibold hover:bg-gray-800 transition-colors disabled:opacity-40">
                    {connSaving?<><RefreshCw className="h-3.5 w-3.5 animate-spin"/>Saving…</>:"Save"}
                  </button>
                </div>
              </div>
            )
          ) : (
            notConnected.length === 0 ? (
              <div className="text-[13px] text-gray-400 text-center py-12">All providers connected</div>
            ) : (
              <div className="space-y-5">
                {groupByCategory(notConnected).map(([cat, items]) => (
                  <div key={cat}>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                      {CATEGORY_LABEL[cat]} <span className="text-gray-300 font-normal ml-1">{items.length}</span>
                    </div>
                    <div className="rounded-xl border border-gray-200 overflow-hidden">
                      {items.map(p => {
                        const isSoon = (p as any).coming_soon;
                        return (
                          <div key={p.id} className={`flex items-center gap-4 px-4 py-3.5 border-b border-gray-100 last:border-0 transition-colors group ${isSoon ? "opacity-60" : "hover:bg-gray-50"}`}>
                            <IntegrationLogo url={p.logo_url} name={p.display_name} />
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-semibold text-gray-900">{p.display_name}</div>
                            </div>
                            {isSoon ? (
                              <span className="text-[11px] text-gray-400 rounded-md border border-gray-200 px-2 py-0.5 flex-shrink-0 uppercase tracking-wide">
                                Coming soon
                              </span>
                            ) : (
                              <button onClick={()=>startConnect(p)}
                                className="text-[12px] font-medium text-gray-500 hover:text-gray-900 transition-colors flex-shrink-0 rounded-md border border-gray-200 px-2.5 py-1 hover:bg-gray-50">
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

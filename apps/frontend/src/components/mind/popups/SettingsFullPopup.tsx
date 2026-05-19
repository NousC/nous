import { useState, useEffect } from "react";
import { Sun, Moon, LogOut, Plus, Trash2, X, Copy, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "@/components/ui/sonner";
import { PopupModal, generateCodename, relTime, type SettingsTab } from "../shared";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

interface Props {
  workspaceId: string;
  onClose: () => void;
  initialTab?: SettingsTab;
}

export default function SettingsFullPopup({ workspaceId, onClose, initialTab = "profile" }: Props) {
  const { userData, session, refreshUserData, signOut } = useAuth();
  const handleSignOut = async () => { try { await signOut(); } catch { /* ignore */ } onClose(); };
  const { theme, toggleTheme } = useTheme();
  const token = session?.access_token;
  const teamId = userData?.team?.id;

  const [tab, setTab] = useState<SettingsTab>(initialTab);

  // Profile
  const [name, setName] = useState(userData?.user?.name ?? "");
  const [nameSaving, setNameSaving] = useState(false);

  // Team
  const [members, setMembers] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [workspaceName, setWorkspaceName] = useState(userData?.team?.name ?? "");
  const [wsNameSaving, setWsNameSaving] = useState(false);

  // API Keys
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);

  // Billing
  const [billing, setBilling] = useState<any>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  // Usage
  const [usageData, setUsageData] = useState<any>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    setName(userData?.user?.name ?? "");
    setWorkspaceName(userData?.team?.name ?? "");
  }, [userData]);

  const loadTeam = async () => {
    if (!teamId || !token) return;
    setTeamLoading(true);
    try {
      const h = { Authorization: `Bearer ${token}` };
      const [mRes, iRes] = await Promise.all([
        fetch(`${apiUrl}/api/teams/${teamId}/members`, { headers: h }),
        fetch(`${apiUrl}/api/teams/${teamId}/invitations`, { headers: h }),
      ]);
      if (mRes.ok) setMembers((await mRes.json()).members ?? []);
      if (iRes.ok) setInvitations((await iRes.json()).invitations ?? []);
    } finally { setTeamLoading(false); }
  };

  const loadKeys = async () => {
    if (!token) return;
    setKeysLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/workspace/api-keys?workspaceId=${workspaceId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setApiKeys((await res.json()).api_keys ?? []);
    } finally { setKeysLoading(false); }
  };

  const loadBilling = async () => {
    if (!token) return;
    setBillingLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/billing/packs`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setBilling(await res.json());
    } finally { setBillingLoading(false); }
  };

  const loadUsage = async () => {
    if (!token) return;
    setUsageLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/usage`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setUsageData(await res.json());
    } finally { setUsageLoading(false); }
  };

  useEffect(() => {
    if (tab === "team")     loadTeam();
    if (tab === "api-keys") loadKeys();
    if (tab === "billing")  loadBilling();
    if (tab === "usage")    loadUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const saveName = async () => {
    if (!token) return;
    setNameSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/users/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) { toast.success("Name updated"); refreshUserData(); }
      else { const e = await res.json().catch(() => ({})); toast.error(e.error || "Failed to update name"); }
    } finally { setNameSaving(false); }
  };

  const saveWsName = async () => {
    if (!token || !teamId) return;
    setWsNameSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/teams/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: workspaceName.trim() }),
      });
      if (res.ok) { toast.success("Workspace name updated"); refreshUserData(); }
      else { const e = await res.json().catch(() => ({})); toast.error(e.error || "Failed to update workspace name"); }
    } finally { setWsNameSaving(false); }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !teamId || !token) return;
    setInviting(true);
    try {
      const res = await fetch(`${apiUrl}/api/teams/${teamId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      if (res.ok) { toast.success(`Invitation sent to ${inviteEmail}`); setInviteEmail(""); setShowInvite(false); await loadTeam(); }
      else { const e = await res.json().catch(() => ({})); toast.error(e.error || "Failed to send invitation"); }
    } finally { setInviting(false); }
  };

  const cancelInvitation = async (id: string) => {
    if (!teamId || !token || !confirm("Cancel this invitation?")) return;
    await fetch(`${apiUrl}/api/teams/${teamId}/invitations/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    await loadTeam();
  };

  const removeMember = async (userId: string) => {
    if (!teamId || !token || !confirm("Remove this member from the team?")) return;
    await fetch(`${apiUrl}/api/teams/${teamId}/members/${userId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    await loadTeam();
  };

  const createKey = async () => {
    if (!newKeyName.trim() || !token) return;
    setCreatingKey(true);
    try {
      const res = await fetch(`${apiUrl}/api/workspace/api-keys?workspaceId=${workspaceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      if (res.ok) { const d = await res.json(); setNewKeyValue(d.key); setNewKeyName(""); await loadKeys(); toast.success("API key created"); }
      else { const e = await res.json().catch(() => ({})); toast.error(e.error || "Failed to create key"); }
    } finally { setCreatingKey(false); }
  };

  const deleteKey = async (id: string) => {
    if (!token || !confirm("Delete this API key? This cannot be undone.")) return;
    await fetch(`${apiUrl}/api/workspace/api-keys/${id}?workspaceId=${workspaceId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    await loadKeys();
    toast.success("Key deleted");
  };

  const purchasePack = async (packId: string) => {
    if (!token) return;
    setCheckoutLoading(packId);
    try {
      const res = await fetch(`${apiUrl}/api/billing/purchase-pack`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ packId }),
      });
      if (res.ok) { const d = await res.json(); if (d.url) window.location.href = d.url; }
      else { const e = await res.json().catch(() => ({})); toast.error(e.error || "Checkout failed"); }
    } finally { setCheckoutLoading(null); }
  };

  const TABS: { id: SettingsTab; label: string }[] = [
    { id: "profile",  label: "Profile"  },
    { id: "team",     label: "Team"     },
    { id: "api-keys", label: "API Keys" },
    { id: "billing",  label: "Billing"  },
    { id: "usage",    label: "Usage"    },
  ];

  return (
    <PopupModal label="NOUS / MIND / SETTINGS" onClose={onClose}>
      <div className="flex" style={{ height: "70vh" }}>
        {/* Left nav */}
        <div className="w-40 flex-shrink-0 border-r border-border/20 py-4 flex flex-col">
          <div className="flex-1 space-y-0.5">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`w-full text-left px-5 py-2 text-[11px] transition-colors ${tab === t.id ? "text-foreground bg-muted/20" : "text-muted-foreground/50 hover:text-foreground/70 hover:bg-muted/10"}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="border-t border-border/20 px-5 pt-3 pb-3 space-y-2">
            <button onClick={toggleTheme} className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40 hover:text-foreground/60 transition-colors">
              {theme === "dark" ? <><Sun className="h-3 w-3" />Light mode</> : <><Moon className="h-3 w-3" />Dark mode</>}
            </button>
            <button onClick={handleSignOut} className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40 hover:text-red-400 transition-colors">
              <LogOut className="h-3 w-3" />Log out
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── Profile ── */}
          {tab === "profile" && (
            <div className="space-y-6 max-w-sm">
              <div className="text-[9px] text-muted-foreground/30 tracking-widest">PROFILE</div>
              <div className="space-y-5">
                <div>
                  <div className="text-[9px] text-muted-foreground/35 mb-1">EMAIL</div>
                  <div className="text-[11px] text-muted-foreground/50">{userData?.user?.email}</div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground/35 mb-1">DISPLAY NAME</div>
                  <div className="flex items-center gap-2">
                    <input value={name} onChange={e => setName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveName(); }}
                      className="flex-1 bg-muted/20 border border-border/40 text-[11px] text-foreground px-2.5 py-1.5 outline-none focus:border-violet-500/40" />
                    <button onClick={saveName} disabled={nameSaving || !name.trim()}
                      className="text-[10px] px-3 py-1.5 bg-violet-500/15 border border-violet-500/30 text-violet-400/80 hover:bg-violet-500/25 transition-colors disabled:opacity-30">
                      {nameSaving ? "…" : "save"}
                    </button>
                  </div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground/35 mb-1">WORKSPACE CODENAME</div>
                  <div className="text-[10px] text-muted-foreground/30 font-mono">{userData?.workspace?.id ? generateCodename(userData.workspace.id) : "—"}</div>
                </div>
              </div>
            </div>
          )}

          {/* ── Team ── */}
          {tab === "team" && (
            <div className="space-y-6 max-w-lg">
              <div>
                <div className="text-[9px] text-muted-foreground/30 tracking-widest mb-3">WORKSPACE NAME</div>
                <div className="flex items-center gap-2">
                  <input value={workspaceName} onChange={e => setWorkspaceName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") saveWsName(); }}
                    className="flex-1 bg-muted/20 border border-border/40 text-[11px] text-foreground px-2.5 py-1.5 outline-none focus:border-violet-500/40" />
                  <button onClick={saveWsName} disabled={wsNameSaving || !workspaceName.trim()}
                    className="text-[10px] px-3 py-1.5 bg-violet-500/15 border border-violet-500/30 text-violet-400/80 hover:bg-violet-500/25 transition-colors disabled:opacity-30">
                    {wsNameSaving ? "…" : "save"}
                  </button>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[9px] text-muted-foreground/30 tracking-widest">MEMBERS {members.length > 0 && `(${members.length})`}</div>
                  <button onClick={() => setShowInvite(v => !v)}
                    className="text-[9px] text-violet-400/60 hover:text-violet-400/90 transition-colors flex items-center gap-1">
                    <Plus className="h-2.5 w-2.5" />invite
                  </button>
                </div>
                {showInvite && (
                  <div className="flex items-center gap-2 mb-4 p-3 border border-border/30 bg-muted/5">
                    <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") handleInvite(); if (e.key === "Escape") setShowInvite(false); }}
                      placeholder="email@example.com" autoFocus
                      className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/25 outline-none" />
                    <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                      className="bg-background border border-border/40 text-[9px] text-muted-foreground/60 px-1.5 py-1 outline-none">
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                    <button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}
                      className="text-[9px] px-2 py-1 bg-violet-500/15 border border-violet-500/30 text-violet-400/80 disabled:opacity-30">
                      {inviting ? "…" : "send"}
                    </button>
                    <button onClick={() => setShowInvite(false)} className="text-muted-foreground/30 hover:text-foreground/60"><X className="h-3 w-3" /></button>
                  </div>
                )}
                {teamLoading ? (
                  <div className="text-[10px] text-muted-foreground/30 py-4">loading…</div>
                ) : (
                  <div className="divide-y divide-border/10">
                    {members.map(m => (
                      <div key={m.id ?? m.user_id} className="flex items-center gap-3 py-2.5 group">
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] text-foreground/80">{m.name ?? m.user?.name ?? "—"}</div>
                          <div className="text-[9px] text-muted-foreground/40">{m.email ?? m.user?.email ?? ""}</div>
                        </div>
                        <span className="text-[9px] text-muted-foreground/30 flex-shrink-0">{m.role}</span>
                        {(m.user_id ?? m.id) !== userData?.user?.id && (
                          <button onClick={() => removeMember(m.user_id ?? m.id)}
                            className="text-muted-foreground/20 hover:text-red-400/60 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                    {members.length === 0 && !teamLoading && <div className="text-[10px] text-muted-foreground/30 py-4">no members yet</div>}
                  </div>
                )}
              </div>
              {invitations.length > 0 && (
                <div>
                  <div className="text-[9px] text-muted-foreground/30 tracking-widest mb-3">PENDING INVITATIONS</div>
                  <div className="divide-y divide-border/10">
                    {invitations.map(inv => (
                      <div key={inv.id} className="flex items-center gap-3 py-2.5 group">
                        <span className="flex-1 text-[11px] text-muted-foreground/60">{inv.email}</span>
                        <span className="text-[9px] text-amber-500/50 flex-shrink-0">pending</span>
                        <button onClick={() => cancelInvitation(inv.id)}
                          className="text-muted-foreground/20 hover:text-red-400/60 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── API Keys ── */}
          {tab === "api-keys" && (
            <div className="space-y-5 max-w-lg">
              <div className="text-[9px] text-muted-foreground/30 tracking-widest">API KEYS</div>
              {newKeyValue && (
                <div className="p-3 border border-emerald-500/20 bg-emerald-500/5">
                  <div className="text-[9px] text-emerald-500/60 mb-2">New key created — copy it now, won't be shown again</div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-[10px] text-emerald-400/80 font-mono break-all">{newKeyValue}</code>
                    <button onClick={() => { navigator.clipboard.writeText(newKeyValue); toast.success("Copied"); }}
                      className="text-[9px] text-emerald-500/60 hover:text-emerald-400 flex items-center gap-1 flex-shrink-0">
                      <Copy className="h-3 w-3" />copy
                    </button>
                    <button onClick={() => setNewKeyValue(null)} className="text-muted-foreground/30 hover:text-foreground/60 flex-shrink-0"><X className="h-3 w-3" /></button>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") createKey(); }}
                  placeholder="key name…"
                  className="flex-1 bg-muted/20 border border-border/40 text-[11px] text-foreground px-2.5 py-1.5 outline-none focus:border-violet-500/40 placeholder:text-muted-foreground/25" />
                <button onClick={createKey} disabled={creatingKey || !newKeyName.trim()}
                  className="text-[10px] px-3 py-1.5 bg-violet-500/15 border border-violet-500/30 text-violet-400/80 hover:bg-violet-500/25 disabled:opacity-30 flex items-center gap-1.5 flex-shrink-0">
                  {creatingKey ? <><RefreshCw className="h-3 w-3 animate-spin" />creating…</> : <><Plus className="h-3 w-3" />create key</>}
                </button>
              </div>
              {keysLoading ? (
                <div className="text-[10px] text-muted-foreground/30">loading…</div>
              ) : (
                <div className="divide-y divide-border/10">
                  {apiKeys.map(k => (
                    <div key={k.id} className="flex items-center gap-3 py-3 group">
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-foreground/80">{k.name}</div>
                        <div className="text-[9px] text-muted-foreground/30 tabular-nums">created {relTime(k.created_at)}</div>
                      </div>
                      <div className="text-[9px] text-muted-foreground/25 flex-shrink-0">
                        {k.last_used_at ? `used ${relTime(k.last_used_at)}` : "never used"}
                      </div>
                      <button onClick={() => deleteKey(k.id)}
                        className="text-muted-foreground/20 hover:text-red-400/60 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {apiKeys.length === 0 && !keysLoading && <div className="text-[10px] text-muted-foreground/30 py-4">no API keys yet</div>}
                </div>
              )}
            </div>
          )}

          {/* ── Billing ── */}
          {tab === "billing" && (
            <div className="space-y-6 max-w-lg">
              <div className="text-[9px] text-muted-foreground/30 tracking-widest">BILLING</div>
              {billingLoading ? (
                <div className="text-[10px] text-muted-foreground/30">loading…</div>
              ) : billing?.billing_disabled ? (
                <div className="text-[11px] text-muted-foreground/40 py-4">Billing is not enabled on this instance.</div>
              ) : billing ? (
                <>
                  {/* Balance */}
                  <div className="p-4 border border-border/30 bg-muted/5 space-y-2">
                    <div className="text-[9px] text-muted-foreground/30 tracking-widest mb-3">BALANCE</div>
                    <div className="flex items-baseline gap-3">
                      <span className="text-[22px] font-semibold text-foreground tabular-nums">{(billing.balance?.opsRemaining ?? 0).toLocaleString()}</span>
                      <span className="text-[10px] text-muted-foreground/50">ops remaining</span>
                    </div>
                    <div className="flex gap-6 text-[9px] text-muted-foreground/40">
                      <span>{(billing.balance?.opsUsed ?? 0).toLocaleString()} used</span>
                      <span>{(billing.balance?.opsTotalPurchased ?? 0).toLocaleString()} purchased total</span>
                      <span>limit: {billing.balance?.accountsLimit ?? 50} contacts</span>
                    </div>
                  </div>

                  {/* Packs */}
                  <div>
                    <div className="text-[9px] text-muted-foreground/30 tracking-widest mb-3">OP PACKS</div>
                    <div className="grid grid-cols-2 gap-2">
                      {(billing.packs ?? []).map((p: any) => (
                        <div key={p.id} className={`p-3 border ${p.popular ? "border-violet-500/30 bg-violet-500/5" : "border-border/20 bg-muted/5"} space-y-2`}>
                          <div className="flex items-baseline gap-2">
                            <span className="text-[13px] font-semibold text-foreground/80">{(p.ops/1000).toFixed(0)}k</span>
                            <span className="text-[9px] text-muted-foreground/40">ops</span>
                            {p.popular && <span className="text-[8px] text-violet-400/70 ml-auto">popular</span>}
                          </div>
                          <div className="text-[10px] text-muted-foreground/50">{p.accountsLimit} contacts · ${p.priceUSD}</div>
                          <button onClick={() => purchasePack(p.id)} disabled={!!checkoutLoading}
                            className={`w-full text-[9px] py-1 border transition-colors disabled:opacity-40 ${p.popular ? "border-violet-500/40 text-violet-400/80 hover:bg-violet-500/10" : "border-border/40 text-muted-foreground/60 hover:text-foreground hover:border-border"}`}>
                            {checkoutLoading === p.id ? "…" : `$${p.priceUSD}`}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recent purchases */}
                  {billing.purchases?.length > 0 && (
                    <div>
                      <div className="text-[9px] text-muted-foreground/30 tracking-widest mb-3">RECENT PURCHASES</div>
                      <div className="divide-y divide-border/10">
                        {billing.purchases.slice(0, 5).map((p: any, i: number) => (
                          <div key={i} className="flex items-center gap-3 py-2.5">
                            <span className="flex-1 text-[10px] text-foreground/70">{(p.ops_granted ?? 0).toLocaleString()} ops</span>
                            <span className="text-[9px] text-muted-foreground/35">${((p.amount_usd_cents ?? 0) / 100).toFixed(2)}</span>
                            <span className="text-[9px] text-muted-foreground/25">{relTime(p.created_at)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          )}

          {/* ── Usage ── */}
          {tab === "usage" && (
            <div className="space-y-6 max-w-md">
              <div className="text-[9px] text-muted-foreground/30 tracking-widest">USAGE</div>
              {usageLoading ? (
                <div className="text-[10px] text-muted-foreground/30">loading…</div>
              ) : usageData ? (
                <>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-[9px] text-muted-foreground/35 tracking-widest">PLAN</span>
                    <span className="text-[10px] text-foreground/70 uppercase tracking-wide">{usageData.plan}</span>
                  </div>
                  <div className="space-y-4">
                    {[
                      { label: "Contacts", cur: usageData.usage?.prospects?.current, lim: usageData.usage?.prospects?.limit },
                      { label: "Documents", cur: usageData.usage?.documents?.current, lim: null },
                      { label: "Templates", cur: usageData.usage?.templates?.current, lim: null },
                      { label: "Workspaces", cur: usageData.usage?.workspaces?.current, lim: null },
                      { label: "Ops Balance", cur: usageData.usage?.ops?.balance, lim: null },
                      { label: "AI Credits Limit", cur: usageData.usage?.credits?.limit, lim: null },
                    ].map(({ label, cur, lim }) => (
                      <div key={label}>
                        <div className="flex items-baseline justify-between mb-1.5">
                          <span className="text-[10px] text-muted-foreground/50">{label}</span>
                          <span className="text-[11px] text-foreground/70 tabular-nums">
                            {(cur ?? 0).toLocaleString()}{lim !== null && lim !== undefined ? ` / ${lim === null ? "∞" : lim.toLocaleString()}` : ""}
                          </span>
                        </div>
                        {lim != null && lim > 0 && (
                          <div className="h-0.5 bg-muted/30 rounded-full overflow-hidden">
                            <div className="h-full bg-violet-500/40 rounded-full transition-all"
                              style={{ width: `${Math.min(100, ((cur ?? 0) / lim) * 100)}%` }} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          )}

        </div>
      </div>
    </PopupModal>
  );
}

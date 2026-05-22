import { useState, useEffect } from "react";
import { Sun, Moon, LogOut, Plus, Trash2, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "@/components/ui/sonner";
import { generateCodename, type SettingsTab } from "@/components/mind/shared";
import { PageHeader } from "@/components/ui/page-header";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

export default function Settings() {
  const { userData, session, refreshUserData, signOut } = useAuth();
  const handleSignOut = async () => { try { await signOut(); } catch { /* ignore */ } };
  const { theme, toggleTheme } = useTheme();
  const token = session?.access_token;
  const teamId = userData?.team?.id;
  const workspaceId = userData?.workspace?.id ?? "";

  const [tab, setTab] = useState<SettingsTab>("profile");

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

  useEffect(() => {
    if (tab === "team") loadTeam();
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

  const TABS: { id: SettingsTab; label: string }[] = [
    { id: "profile", label: "Profile" },
    { id: "team",    label: "Team"    },
  ];

  // ── shared light styles ───────────────────────────────────────────────────
  const inputCls =
    "w-full border border-border rounded-lg px-3 py-2 text-[13px] text-foreground " +
    "outline-none focus:border-foreground/40 transition-colors placeholder:text-muted-foreground/70";
  const primaryBtn =
    "h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-[13px] font-medium " +
    "hover:bg-primary/90 transition-colors disabled:opacity-40 flex-shrink-0";
  const fieldLabel = "text-[12px] font-medium text-muted-foreground mb-1.5";

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-8 py-7">
        <PageHeader
          title="Settings"
          actions={
            <>
              <button
                onClick={toggleTheme}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors"
              >
                {theme === "dark" ? <><Sun className="h-3.5 w-3.5" />Light mode</> : <><Moon className="h-3.5 w-3.5" />Dark mode</>}
              </button>
              <button
                onClick={handleSignOut}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />Log out
              </button>
            </>
          }
        />

        {/* Tabs */}
        <div className="flex gap-6 border-b border-border mb-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`pb-2.5 text-[13px] font-medium transition-colors ${
                tab === t.id
                  ? "text-foreground border-b-2 border-foreground -mb-px"
                  : "text-muted-foreground/70 hover:text-foreground/80"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Profile ── */}
        {tab === "profile" && (
          <div className="max-w-sm">
            <h3 className="text-[15px] font-semibold text-foreground mb-5">Profile</h3>
            <div className="space-y-5">
              <div>
                <div className={fieldLabel}>Email</div>
                <div className="text-[13px] text-muted-foreground">{userData?.user?.email}</div>
              </div>
              <div>
                <div className={fieldLabel}>Display name</div>
                <div className="flex items-center gap-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveName(); }}
                    className={inputCls}
                  />
                  <button onClick={saveName} disabled={nameSaving || !name.trim()} className={primaryBtn}>
                    {nameSaving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
              <div>
                <div className={fieldLabel}>Workspace codename</div>
                <div className="text-[13px] text-muted-foreground/70">
                  {workspaceId ? generateCodename(workspaceId) : "—"}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Team ── */}
        {tab === "team" && (
          <div className="max-w-lg space-y-7">
            <div>
              <h3 className="text-[15px] font-semibold text-foreground mb-3">Workspace</h3>
              <div className={fieldLabel}>Workspace name</div>
              <div className="flex items-center gap-2">
                <input
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveWsName(); }}
                  className={inputCls}
                />
                <button onClick={saveWsName} disabled={wsNameSaving || !workspaceName.trim()} className={primaryBtn}>
                  {wsNameSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[15px] font-semibold text-foreground">
                  Members{members.length > 0 && <span className="text-muted-foreground/70 font-normal"> · {members.length}</span>}
                </h3>
                <button
                  onClick={() => setShowInvite((v) => !v)}
                  className="flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />Invite
                </button>
              </div>

              {showInvite && (
                <div className="flex items-center gap-2 mb-4 p-3 rounded-xl border border-border bg-muted/50/60">
                  <input
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleInvite(); if (e.key === "Escape") setShowInvite(false); }}
                    placeholder="email@example.com"
                    autoFocus
                    className="flex-1 bg-background border border-border rounded-lg px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-foreground/40 placeholder:text-muted-foreground/70"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="bg-background border border-border rounded-lg text-[12px] text-foreground/80 px-2 py-1.5 outline-none"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()} className={primaryBtn}>
                    {inviting ? "…" : "Send"}
                  </button>
                  <button onClick={() => setShowInvite(false)} className="text-muted-foreground/50 hover:text-foreground/80">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {teamLoading ? (
                <div className="text-[13px] text-muted-foreground/70 py-4">Loading…</div>
              ) : (
                <div className="rounded-xl border border-border divide-y divide-border/60">
                  {members.map((m) => (
                    <div key={m.id ?? m.user_id} className="flex items-center gap-3 px-3.5 py-2.5 group">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-foreground">{m.name ?? m.user?.name ?? "—"}</div>
                        <div className="text-[11px] text-muted-foreground/70">{m.email ?? m.user?.email ?? ""}</div>
                      </div>
                      <span className="text-[11px] text-muted-foreground/70 flex-shrink-0 capitalize">{m.role}</span>
                      {(m.user_id ?? m.id) !== userData?.user?.id && (
                        <button
                          onClick={() => removeMember(m.user_id ?? m.id)}
                          className="text-muted-foreground/50 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  {members.length === 0 && (
                    <div className="text-[13px] text-muted-foreground/70 px-3.5 py-4">No members yet</div>
                  )}
                </div>
              )}
            </div>

            {invitations.length > 0 && (
              <div>
                <h3 className="text-[15px] font-semibold text-foreground mb-3">Pending invitations</h3>
                <div className="rounded-xl border border-border divide-y divide-border/60">
                  {invitations.map((inv) => (
                    <div key={inv.id} className="flex items-center gap-3 px-3.5 py-2.5 group">
                      <span className="flex-1 text-[13px] text-foreground/80">{inv.email}</span>
                      <span className="text-[11px] text-amber-600 flex-shrink-0">Pending</span>
                      <button
                        onClick={() => cancelInvitation(inv.id)}
                        className="text-muted-foreground/50 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

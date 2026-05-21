import { useState, useEffect } from "react";
import { Sun, Moon, LogOut, Plus, Trash2, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "@/components/ui/sonner";
import { PopupModal, generateCodename, type SettingsTab } from "../shared";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

interface Props {
  workspaceId: string;
  onClose: () => void;
  initialTab?: SettingsTab;
}

export default function SettingsFullPopup({ onClose, initialTab = "profile" }: Props) {
  const { userData, session, refreshUserData, signOut } = useAuth();
  const handleSignOut = async () => { try { await signOut(); } catch { /* ignore */ } onClose(); };
  const { theme, toggleTheme } = useTheme();
  const token = session?.access_token;
  const teamId = userData?.team?.id;

  const startTab: SettingsTab = initialTab === "team" ? "team" : "profile";
  const [tab, setTab] = useState<SettingsTab>(startTab);

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
    "w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-900 " +
    "outline-none focus:border-gray-400 transition-colors placeholder:text-gray-400";
  const primaryBtn =
    "h-9 px-3.5 rounded-lg bg-gray-900 text-white text-[13px] font-medium " +
    "hover:bg-gray-800 transition-colors disabled:opacity-40 flex-shrink-0";
  const fieldLabel = "text-[12px] font-medium text-gray-500 mb-1.5";

  return (
    <PopupModal label="Settings" onClose={onClose}>
      <div className="flex bg-white" style={{ height: "66vh" }}>
        {/* Left nav */}
        <div className="w-44 flex-shrink-0 border-r border-gray-200 bg-gray-50/60 py-3 flex flex-col">
          <div className="flex-1 px-2 space-y-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`w-full text-left px-3 py-1.5 rounded-lg text-[13px] transition-colors ${
                  tab === t.id
                    ? "bg-gray-200/70 text-gray-900 font-semibold"
                    : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="border-t border-gray-200 mx-2 pt-3 mt-2 space-y-1">
            <button
              onClick={toggleTheme}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            >
              {theme === "dark" ? <><Sun className="h-3.5 w-3.5" />Light mode</> : <><Moon className="h-3.5 w-3.5" />Dark mode</>}
            </button>
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />Log out
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-white px-7 py-6">
          {/* ── Profile ── */}
          {tab === "profile" && (
            <div className="max-w-sm">
              <h3 className="text-[15px] font-semibold text-gray-900 mb-5">Profile</h3>
              <div className="space-y-5">
                <div>
                  <div className={fieldLabel}>Email</div>
                  <div className="text-[13px] text-gray-500">{userData?.user?.email}</div>
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
                  <div className="text-[12px] text-gray-400 font-mono">
                    {userData?.workspace?.id ? generateCodename(userData.workspace.id) : "—"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Team ── */}
          {tab === "team" && (
            <div className="max-w-lg space-y-7">
              <div>
                <h3 className="text-[15px] font-semibold text-gray-900 mb-3">Workspace</h3>
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
                  <h3 className="text-[15px] font-semibold text-gray-900">
                    Members{members.length > 0 && <span className="text-gray-400 font-normal"> · {members.length}</span>}
                  </h3>
                  <button
                    onClick={() => setShowInvite((v) => !v)}
                    className="flex items-center gap-1 text-[12px] font-medium text-gray-500 hover:text-gray-900 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />Invite
                  </button>
                </div>

                {showInvite && (
                  <div className="flex items-center gap-2 mb-4 p-3 rounded-xl border border-gray-200 bg-gray-50/60">
                    <input
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleInvite(); if (e.key === "Escape") setShowInvite(false); }}
                      placeholder="email@example.com"
                      autoFocus
                      className="flex-1 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-[13px] text-gray-900 outline-none focus:border-gray-400 placeholder:text-gray-400"
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      className="bg-white border border-gray-200 rounded-lg text-[12px] text-gray-600 px-2 py-1.5 outline-none"
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()} className={primaryBtn}>
                      {inviting ? "…" : "Send"}
                    </button>
                    <button onClick={() => setShowInvite(false)} className="text-gray-300 hover:text-gray-600">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {teamLoading ? (
                  <div className="text-[13px] text-gray-400 py-4">Loading…</div>
                ) : (
                  <div className="rounded-xl border border-gray-200 divide-y divide-gray-100">
                    {members.map((m) => (
                      <div key={m.id ?? m.user_id} className="flex items-center gap-3 px-3.5 py-2.5 group">
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] text-gray-900">{m.name ?? m.user?.name ?? "—"}</div>
                          <div className="text-[11px] text-gray-400">{m.email ?? m.user?.email ?? ""}</div>
                        </div>
                        <span className="text-[11px] text-gray-400 flex-shrink-0 capitalize">{m.role}</span>
                        {(m.user_id ?? m.id) !== userData?.user?.id && (
                          <button
                            onClick={() => removeMember(m.user_id ?? m.id)}
                            className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    {members.length === 0 && (
                      <div className="text-[13px] text-gray-400 px-3.5 py-4">No members yet</div>
                    )}
                  </div>
                )}
              </div>

              {invitations.length > 0 && (
                <div>
                  <h3 className="text-[15px] font-semibold text-gray-900 mb-3">Pending invitations</h3>
                  <div className="rounded-xl border border-gray-200 divide-y divide-gray-100">
                    {invitations.map((inv) => (
                      <div key={inv.id} className="flex items-center gap-3 px-3.5 py-2.5 group">
                        <span className="flex-1 text-[13px] text-gray-600">{inv.email}</span>
                        <span className="text-[11px] text-amber-600 flex-shrink-0">Pending</span>
                        <button
                          onClick={() => cancelInvitation(inv.id)}
                          className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
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
    </PopupModal>
  );
}

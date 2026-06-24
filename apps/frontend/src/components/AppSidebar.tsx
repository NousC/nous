import React, { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { VersionWidget } from "@/components/VersionWidget";
import {
  Package,
  FlaskConical,
  Key,
  Activity,
  Users,
  Plug,
  Webhook,
  Zap,
  Brain,
  List,
  Lock,
  CreditCard,
  BookOpen,
  ChevronDown,
  PanelLeftClose,
  PanelLeft,
  Sparkles,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import { SidebarWorkspaceSelector } from "@/components/SidebarWorkspaceSelector";
import { AskAgentsModal } from "@/components/AskAgentsModal";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";

type NavItem = { title: string; url: string; icon: React.ElementType };

const apiUrl = import.meta.env.VITE_API_URL ?? "";

// SETUP — collapsible dropdown group. Holds the connect-once / configure-once
// surfaces (install, keys, integrations, webhooks, triggers) plus the playground.
const setupItems: NavItem[] = [
  { title: "Install",      url: "/install",      icon: Package      },
  { title: "Playground",   url: "/playground",   icon: FlaskConical },
  { title: "API Keys",     url: "/keys",         icon: Key          },
  { title: "Integrations", url: "/integrations", icon: Plug         },
  { title: "Webhooks",     url: "/webhooks",     icon: Webhook      },
  { title: "Triggers",     url: "/triggers",     icon: Zap          },
];

// Main navigation — the day-to-day surfaces you return to.
const mainNavItems: NavItem[] = [
  { title: "Ops",      url: "/ops",          icon: Activity },
  { title: "Accounts", url: "/accounts",     icon: Users    },
  { title: "ICP",      url: "/icp",          icon: Brain    },
];

// Surfaces rendered inline under Accounts. Lists (lead database) is open on
// self-host and Pro+ on cloud.
const listsNavItem: NavItem  = { title: "Lists",    url: "/lists",    icon: List     };

// Bottom navigation — Settings is reached via the profile button below.
const bottomNavItems: NavItem[] = [
  { title: "Usage & Billing", url: "/usage", icon: CreditCard },
];

export function AppSidebar() {
  const { userData, session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // Persist the collapsed state so a page reload keeps the sidebar as the user left it.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("nous.sidebar.collapsed") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("nous.sidebar.collapsed", collapsed ? "1" : "0"); } catch { /* ignore */ }
  }, [collapsed]);
  // Setup drawer: stays open until the first integration is connected, so new
  // workspaces are nudged toward connecting one. A manual toggle wins and persists.
  const [setupManual, setSetupManual] = useState<boolean | null>(() => {
    try {
      const v = localStorage.getItem("nous.sidebar.setupOpen");
      return v === null ? null : v === "1";
    } catch { return null; }
  });
  const [hasIntegration, setHasIntegration] = useState(false);
  const [plan, setPlan] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  // Lead lists shown as a dropdown under the Lists nav item — each list is its
  // own page (/lists/:id).
  const [leadLists, setLeadLists] = useState<{ id: string; name: string; source: string; lead_count?: number }[]>([]);
  const [listsOpen, setListsOpen] = useState(true);
  // Create / rename / delete are owned here in the sidebar now.
  const [creatingList, setCreatingList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const workspaceId = (userData as { workspace?: { id?: string } })?.workspace?.id;

  // Whether at least one integration is connected, to decide the Setup default.
  useEffect(() => {
    const token = session?.access_token;
    if (!token || !workspaceId) return;
    fetch(`${apiUrl}/api/workflow-providers/connections?workspace_id=${workspaceId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (Array.isArray(d?.connections)) {
          setHasIntegration(d.connections.some((c: { is_verified?: boolean }) => c.is_verified === true));
        }
      })
      .catch(() => {});
  }, [session?.access_token, workspaceId]);

  // Manual choice (persisted) wins; otherwise default open until an integration exists.
  const setupOpen = setupManual !== null ? setupManual : !hasIntegration;
  const toggleSetup = () => {
    const next = !setupOpen;
    setSetupManual(next);
    try { localStorage.setItem("nous.sidebar.setupOpen", next ? "1" : "0"); } catch { /* ignore */ }
  };

  // Lists is a Pro-tier feature — fetch the plan so we can surface it for
  // workspaces actually entitled to it.
  useEffect(() => {
    const token = session?.access_token;
    if (!token) return;
    fetch(`${apiUrl}/api/billing/state`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.plan) setPlan(String(d.plan).toLowerCase()); })
      .catch(() => {});
  }, [session?.access_token]);
  // Lists (lead database) is part of the Cloud team layer — cloud-only (Pro+), not
  // on self-host. Gates match access.mjs (leadLists cloud-only; icpScoring is open
  // on self-host) + plans.mjs. ('scale' = Partner plan.)
  const selfHosted = (userData as { self_hosted?: boolean })?.self_hosted === true;
  const showLeadLists =
    !selfHosted && (plan === "pro" || plan === "growth" || plan === "scale");
  // Lead-related surfaces (Lists, lead/campaign analytics) unlock with lead lists.
  const showCloudFeatures = showLeadLists;

  // Fetch the lead lists for the dropdown. Also refetches when the Lists page edits
  // them (import/enrich changes counts) via a window event, so the dropdown stays
  // in sync without a reload.
  const token = session?.access_token;
  const reloadLists = useCallback(async () => {
    if (!showLeadLists || !token || !workspaceId) { setLeadLists([]); return; }
    try {
      const r = await fetch(`${apiUrl}/api/lead-lists?workspaceId=${workspaceId}`, { headers: { Authorization: `Bearer ${token}` } });
      const d = r.ok ? await r.json() : null;
      if (Array.isArray(d?.lead_lists)) setLeadLists(d.lead_lists);
    } catch { /* ignore */ }
  }, [showLeadLists, token, workspaceId]);
  useEffect(() => {
    reloadLists();
    window.addEventListener("nous:lists-changed", reloadLists);
    return () => window.removeEventListener("nous:lists-changed", reloadLists);
  }, [reloadLists]);

  const jsonHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` };
  const notifyListsChanged = () => { try { window.dispatchEvent(new Event("nous:lists-changed")); } catch { /* ignore */ } };

  // Create a list (the sidebar "+"), seed three blank rows so it opens to the
  // familiar starting table, then jump to it.
  const createList = async () => {
    const name = newListName.trim();
    if (!name || listBusy || !workspaceId) return;
    setListBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/lead-lists`, {
        method: "POST", headers: jsonHeaders,
        body: JSON.stringify({ workspaceId, name, source: "csv" }),
      });
      const d = res.ok ? await res.json() : null;
      const newId = d?.lead_list?.id ?? null;
      if (newId) {
        await Promise.all([0, 1, 2].map(() =>
          fetch(`${apiUrl}/api/lead-lists/${newId}/leads/blank`, {
            method: "POST", headers: jsonHeaders, body: JSON.stringify({ workspaceId }),
          }).catch(() => {})));
      }
      setNewListName(""); setCreatingList(false);
      await reloadLists();
      notifyListsChanged();
      if (newId) { setListsOpen(true); navigate(`/lists/${newId}`); }
    } catch { /* ignore */ } finally { setListBusy(false); }
  };

  // Rename a list (hover → pencil → inline input). Optimistic — the new name
  // shows instantly; the PATCH + reconcile happen in the background.
  const renameList = (id: string) => {
    const name = renameValue.trim();
    setRenamingId(null); setRenameValue("");
    if (!name || !workspaceId) return;
    setLeadLists(prev => prev.map(l => l.id === id ? { ...l, name } : l));
    fetch(`${apiUrl}/api/lead-lists/${id}`, {
      method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ workspaceId, name }),
    }).then(() => { reloadLists(); notifyListsChanged(); }, () => reloadLists());
  };

  // Delete a list (hover → trash → confirm dialog). Optimistic — it disappears
  // immediately; the DELETE + reconcile happen in the background.
  const deleteList = () => {
    const list = deleteTarget;
    setDeleteTarget(null);
    if (!list || !workspaceId) return;
    setLeadLists(prev => prev.filter(l => l.id !== list.id));
    if (location.pathname === `/lists/${list.id}`) navigate("/lists");
    fetch(`${apiUrl}/api/lead-lists/${list.id}?workspaceId=${workspaceId}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token ?? ""}` },
    }).then(() => { reloadLists(); notifyListsChanged(); }, () => reloadLists());
  };
  // Billing is a cloud-only surface — self-host is unmetered with no subscription,
  // so drop "Usage & Billing" entirely (ops are visible on the Ops page).
  const visibleBottomNavItems = selfHosted
    ? bottomNavItems.filter((i) => i.url !== "/usage")
    : bottomNavItems;

  const isItemActive = (url: string) => {
    if (url === "/") return location.pathname === "/";
    return location.pathname === url || location.pathname.startsWith(url + "/");
  };

  const renderNavItem = (item: NavItem) => {
    const active = isItemActive(item.url);
    const iconColor = active ? "text-gray-900 dark:text-white" : "text-gray-800 dark:text-white/50";

    return (
      <li key={item.title}>
        <NavLink
          to={item.url}
          end={item.url === "/"}
          className={`group flex w-full items-center rounded-lg px-2.5 py-1.5 transition-all duration-150 ${
            collapsed ? "justify-center" : ""
          } ${active ? "bg-gray-200/60 dark:bg-white/[0.07]" : "hover:bg-gray-100/70 dark:hover:bg-white/[0.04]"}`}
          activeClassName=""
        >
          <div className="flex items-center gap-3">
            <item.icon
              className={`h-[17px] w-[17px] flex-shrink-0 transition-colors ${iconColor}`}
              strokeWidth={active ? 2 : 1.75}
            />
            {!collapsed && (
              <span
                className={`text-[13px] leading-tight truncate transition-colors ${
                  active
                    ? "text-gray-900 dark:text-white font-semibold"
                    : "text-gray-700 dark:text-white/50 group-hover:text-gray-900 dark:group-hover:text-white"
                }`}
              >
                {item.title}
              </span>
            )}
          </div>
        </NavLink>
      </li>
    );
  };

  return (
    <aside
      className={`flex-shrink-0 h-screen flex flex-col bg-[#FCFCFC] dark:bg-[#0d0d0d] border-r border-gray-200/60 dark:border-white/[0.08] overflow-hidden transition-all duration-200 ${
        collapsed ? "w-[60px]" : "w-[260px]"
      }`}
    >
      {/* Header: Workspace + collapse toggle */}
      <div className={collapsed ? "flex flex-col items-center gap-1.5 px-2 pt-3 pb-2" : "flex items-center gap-2 px-3 pt-3 pb-2"}>
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="p-1.5 rounded-md text-gray-400 dark:text-muted-foreground hover:text-gray-600 dark:hover:text-foreground hover:bg-gray-100/70 dark:hover:bg-white/[0.05] transition-colors"
            title="Expand sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        )}
        <div className={collapsed ? "" : "flex-1 min-w-0"}>
          <SidebarWorkspaceSelector collapsed={collapsed} />
        </div>
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="p-1.5 rounded-md text-gray-400 dark:text-muted-foreground hover:text-gray-600 dark:hover:text-foreground hover:bg-gray-100/70 dark:hover:bg-white/[0.05] transition-colors flex-shrink-0"
            title="Collapse sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* SETUP — collapsible group */}
      <nav className="px-2.5 pt-2">
        {!collapsed && (
          <button
            onClick={toggleSetup}
            className="flex w-full items-center justify-between px-2.5 py-1 group"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-white/30">
              Setup
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 text-gray-400 dark:text-white/30 transition-transform duration-150 ${
                setupOpen ? "" : "-rotate-90"
              }`}
            />
          </button>
        )}
        {/* Expanded: the open Setup drawer lists every setup surface. Collapsed:
            the drawer reads as closed, so only its entry point (Install) shows —
            the rest live one click away once the sidebar is expanded. */}
        {(setupOpen || collapsed) && (
          <ul className="flex flex-col gap-0.5 mt-0.5">
            {(collapsed ? setupItems.slice(0, 1) : setupItems).map(renderNavItem)}
          </ul>
        )}
      </nav>

      {/* Main navigation — Ops / Accounts / ICP, with Lists (self-host, or Pro+
          on cloud) surfaced inline. */}
      <nav className="px-2.5 pt-7">
        <ul className="flex flex-col gap-0.5">
          {mainNavItems.map(renderNavItem)}
          {showLeadLists && (collapsed ? (
            renderNavItem(listsNavItem)
          ) : (
            <li>
              {/* Lists — the nav item links to the index; the chevron toggles the
                  dropdown of individual lists, each its own page (/lists/:id). */}
              <div className="flex items-center">
                <NavLink
                  to="/lists"
                  end
                  className={`group flex flex-1 items-center rounded-lg px-2.5 py-1.5 transition-all duration-150 ${
                    isItemActive("/lists") ? "bg-gray-200/60 dark:bg-white/[0.07]" : "hover:bg-gray-100/70 dark:hover:bg-white/[0.04]"
                  }`}
                  activeClassName=""
                >
                  <div className="flex items-center gap-3">
                    <List
                      className={`h-[17px] w-[17px] flex-shrink-0 transition-colors ${isItemActive("/lists") ? "text-gray-900 dark:text-white" : "text-gray-800 dark:text-white/50"}`}
                      strokeWidth={isItemActive("/lists") ? 2 : 1.75}
                    />
                    <span className={`text-[13px] leading-tight truncate transition-colors ${
                      isItemActive("/lists") ? "text-gray-900 dark:text-white font-semibold" : "text-gray-700 dark:text-white/50 group-hover:text-gray-900 dark:group-hover:text-white"
                    }`}>
                      Lists
                    </span>
                  </div>
                </NavLink>
                {/* + create a new list (always available) */}
                <button
                  onClick={() => { setCreatingList(true); setListsOpen(true); }}
                  className="p-1 rounded-md text-gray-400 dark:text-white/30 hover:text-gray-600 dark:hover:text-white/60 hover:bg-gray-100/70 dark:hover:bg-white/[0.05] transition-colors"
                  title="New list"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                {leadLists.length > 0 && (
                  <button
                    onClick={() => setListsOpen(o => !o)}
                    className="p-1 mr-0.5 rounded-md text-gray-400 dark:text-white/30 hover:text-gray-600 dark:hover:text-white/60 hover:bg-gray-100/70 dark:hover:bg-white/[0.05] transition-colors"
                    title={listsOpen ? "Collapse lists" : "Expand lists"}
                  >
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 ${listsOpen ? "" : "-rotate-90"}`} />
                  </button>
                )}
              </div>
              {listsOpen && (leadLists.length > 0 || creatingList) && (
                <ul className="mt-0.5 ml-[18px] flex flex-col gap-0.5 border-l border-gray-200/60 dark:border-white/[0.08] pl-2">
                  {/* Inline create row (the sidebar "+") */}
                  {creatingList && (
                    <li>
                      <input
                        value={newListName}
                        onChange={e => setNewListName(e.target.value)}
                        autoFocus
                        placeholder="List name"
                        disabled={listBusy}
                        onKeyDown={e => { if (e.key === "Enter") createList(); if (e.key === "Escape") { setCreatingList(false); setNewListName(""); } }}
                        onBlur={() => { if (!newListName.trim()) { setCreatingList(false); setNewListName(""); } }}
                        className="w-full rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-white/[0.03] px-2 py-1 text-[13px] text-gray-900 dark:text-white outline-none focus:border-gray-400 dark:focus:border-white/30 disabled:opacity-50"
                      />
                    </li>
                  )}
                  {leadLists.map(l => {
                    const native = l.source === "linkedin_engagement" || l.source === "linkedin_connections";
                    const active = isItemActive(`/lists/${l.id}`);
                    const renaming = renamingId === l.id;
                    if (renaming) {
                      return (
                        <li key={l.id}>
                          <input
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            autoFocus
                            disabled={listBusy}
                            onKeyDown={e => { if (e.key === "Enter") renameList(l.id); if (e.key === "Escape") { setRenamingId(null); setRenameValue(""); } }}
                            onBlur={() => renameList(l.id)}
                            className="w-full rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-white/[0.03] px-2 py-1 text-[13px] text-gray-900 dark:text-white outline-none focus:border-gray-400 dark:focus:border-white/30 disabled:opacity-50"
                          />
                        </li>
                      );
                    }
                    return (
                      <li key={l.id} className="group/list relative">
                        <NavLink
                          to={`/lists/${l.id}`}
                          end
                          className={`group flex items-center justify-between rounded-lg px-2.5 py-1.5 transition-all duration-150 ${
                            active ? "bg-gray-200/60 dark:bg-white/[0.07]" : "hover:bg-gray-100/70 dark:hover:bg-white/[0.04]"
                          }`}
                          activeClassName=""
                        >
                          <span className="flex items-center gap-1.5 min-w-0">
                            {native && <Lock className="h-3 w-3 flex-shrink-0 opacity-50" />}
                            <span className={`text-[13px] leading-tight truncate transition-colors ${
                              active ? "text-gray-900 dark:text-white font-medium" : "text-gray-700 dark:text-white/50 group-hover:text-gray-900 dark:group-hover:text-white"
                            }`}>
                              {l.name}
                            </span>
                          </span>
                          {/* Lead count — fades out on hover for user lists so the
                              rename/delete actions can take its place. */}
                          <span className={`text-[11px] tabular-nums text-gray-400 dark:text-white/30 flex-shrink-0 ml-1.5 ${native ? "" : "group-hover/list:opacity-0"}`}>{l.lead_count ?? 0}</span>
                        </NavLink>
                        {/* Hover actions — rename + delete (user lists only; the
                            native LinkedIn lists are system-managed). */}
                        {!native && (
                          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover/list:flex items-center gap-0.5">
                            <button
                              onClick={e => { e.preventDefault(); e.stopPropagation(); setRenamingId(l.id); setRenameValue(l.name); }}
                              title="Rename list"
                              className="p-1 rounded text-gray-400 hover:text-gray-700 dark:text-white/40 dark:hover:text-white hover:bg-gray-200/70 dark:hover:bg-white/10 transition-colors"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              onClick={e => { e.preventDefault(); e.stopPropagation(); setDeleteTarget({ id: l.id, name: l.name }); }}
                              title="Delete list"
                              className="p-1 rounded text-gray-400 hover:text-red-600 dark:text-white/40 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Self-host version / update status (only renders when self_hosted) */}
      <VersionWidget collapsed={collapsed} />

      {/* Bottom: Usage & Billing + Docs */}
      <nav className="px-2.5 pb-1">
        <ul className="flex flex-col gap-0.5">
          {visibleBottomNavItems.map(renderNavItem)}
          {/* Docs — external link to the documentation site */}
          <li>
            <a
              href="https://docs.opennous.cloud"
              target="_blank"
              rel="noopener noreferrer"
              className={`group flex w-full items-center rounded-lg px-2.5 py-1.5 transition-all duration-150 hover:bg-gray-100/70 dark:hover:bg-white/[0.04] ${
                collapsed ? "justify-center" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <BookOpen
                  className="h-[17px] w-[17px] flex-shrink-0 text-gray-800 dark:text-white/50 transition-colors"
                  strokeWidth={1.75}
                />
                {!collapsed && (
                  <span className="text-[13px] leading-tight truncate text-gray-700 dark:text-white/50 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                    Docs
                  </span>
                )}
              </div>
            </a>
          </li>
        </ul>
      </nav>

      {/* Ask your agents — opens a modal of ready-to-use prompts */}
      <nav className="px-2.5 pb-1">
        <button
          onClick={() => setAskOpen(true)}
          title="Ask your agents"
          className={`group flex w-full items-center rounded-lg px-2.5 py-1.5 transition-all duration-150 hover:bg-gray-100/70 dark:hover:bg-white/[0.04] ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <div className="flex items-center gap-3">
            <Sparkles
              className="h-[17px] w-[17px] flex-shrink-0 text-gray-800 dark:text-white/50 transition-colors"
              strokeWidth={1.75}
            />
            {!collapsed && (
              <span className="text-[13px] leading-tight truncate text-gray-700 dark:text-white/50 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                Ask your agents
              </span>
            )}
          </div>
        </button>
      </nav>

      <AskAgentsModal open={askOpen} onOpenChange={setAskOpen} leadsUnlocked={showCloudFeatures} />

      {/* Profile row */}
      <div className="px-2.5 pb-3 pt-1">
        <div className="mx-1.5 mb-2 border-t border-gray-200/60 dark:border-white/[0.08]" />
        <button
          onClick={() => navigate("/settings")}
          className={`group flex w-full items-center rounded-lg px-2.5 py-2 transition-all duration-150 hover:bg-gray-100/70 dark:hover:bg-white/8 ${
            collapsed ? "justify-center" : "gap-2.5"
          }`}
        >
          <Avatar className="h-6 w-6 flex-shrink-0 border border-gray-200/60 dark:border-white/10">
            <AvatarImage src={userData?.user?.profile_picture_url || undefined} alt={userData?.user?.name || "User"} />
            <AvatarFallback className="text-[10px] font-semibold bg-gray-900 text-white">
              {((userData?.user?.name || userData?.user?.email || "U").charAt(0)).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <span className="text-[13px] text-gray-700 dark:text-white/50 group-hover:text-gray-900 dark:group-hover:text-white truncate leading-tight transition-colors">
              {userData?.user?.name || userData?.user?.email?.split("@")[0] || "Account"}
            </span>
          )}
        </button>
      </div>

      {/* Delete-list confirmation (hover → trash on a list). */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        onConfirm={deleteList}
        title="Delete list"
        itemName={deleteTarget?.name}
        description={`The list "${deleteTarget?.name ?? ""}" and all its rows are removed. The contacts and their history stay in Nous.`}
      />
    </aside>
  );
}

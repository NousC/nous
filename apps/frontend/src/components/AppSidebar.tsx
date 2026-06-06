import React, { useState, useEffect } from "react";
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
  Database,
  List,
  CreditCard,
  BookOpen,
  ChevronDown,
  PanelLeftClose,
  PanelLeft,
  Sparkles,
} from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import { SidebarWorkspaceSelector } from "@/components/SidebarWorkspaceSelector";
import { AskAgentsModal } from "@/components/AskAgentsModal";

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
  { title: "Context",  url: "/intelligence", icon: Brain    },
];

// Cloud-only, Pro+ surfaces. Rendered inline under Context (not a separate group).
const cloudFeatureItems: NavItem[] = [
  { title: "CRM Sync", url: "/crm-sync", icon: Database },
  { title: "Lists",    url: "/lists",    icon: List     },
];

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

  // CRM Sync + Lists are a Pro-tier feature — fetch the plan so we can surface
  // them for workspaces actually entitled to them.
  useEffect(() => {
    const token = session?.access_token;
    if (!token) return;
    fetch(`${apiUrl}/api/billing/state`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.plan) setPlan(String(d.plan).toLowerCase()); })
      .catch(() => {});
  }, [session?.access_token]);
  // CRM Sync + Lists are cloud-only (never on self-host) and gated to Pro and up,
  // matching the backend entitlement in plans.mjs (crmSync/leadLists on Pro + Scale).
  const selfHosted = (userData as { self_hosted?: boolean })?.self_hosted === true;
  const showCloudFeatures =
    !selfHosted && (plan === "pro" || plan === "scale" || plan === "enterprise");
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
        {(setupOpen || collapsed) && (
          <ul className="flex flex-col gap-0.5 mt-0.5">
            {setupItems.map(renderNavItem)}
          </ul>
        )}
      </nav>

      {/* Main navigation — Ops / Accounts / Context, with the cloud-only
          CRM Sync + Lists surfaced inline under Context for Pro+ workspaces. */}
      <nav className="px-2.5 pt-7">
        <ul className="flex flex-col gap-0.5">
          {mainNavItems.map(renderNavItem)}
          {showCloudFeatures && cloudFeatureItems.map(renderNavItem)}
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

      {!collapsed && (
        <div className="px-3.5 pb-3 pt-0.5">
          <p className="text-[10px] leading-tight text-gray-400 dark:text-white/25">
            Unified customer graph for Agents
          </p>
        </div>
      )}
    </aside>
  );
}

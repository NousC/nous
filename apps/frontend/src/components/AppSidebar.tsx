import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Package,
  FlaskConical,
  Key,
  Activity,
  Users,
  Building2,
  Plug,
  Webhook,
  FileDown,
  Brain,
  Database,
  CreditCard,
  BookOpen,
  ChevronDown,
  PanelLeftClose,
  PanelLeft,
  Sun,
  Moon,
} from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { SidebarWorkspaceSelector } from "@/components/SidebarWorkspaceSelector";

type NavItem = { title: string; url: string; icon: React.ElementType };

const apiUrl = import.meta.env.VITE_API_URL ?? "";

// SETUP — collapsible dropdown group
const setupItems: NavItem[] = [
  { title: "Install",  url: "/install",   icon: Package      },
  { title: "Playground", url: "/playground", icon: FlaskConical },
  { title: "API Keys", url: "/keys",      icon: Key          },
];

// Main navigation
const mainNavItems: NavItem[] = [
  { title: "Ops",          url: "/ops",          icon: Activity  },
  { title: "People",       url: "/people",       icon: Users     },
  { title: "Companies",    url: "/companies",    icon: Building2 },
  { title: "Integrations", url: "/integrations", icon: Plug      },
  { title: "Webhooks",     url: "/webhooks",     icon: Webhook   },
  { title: "Exports",      url: "/exports",      icon: FileDown  },
  { title: "Intelligence", url: "/intelligence", icon: Brain     },
];

// ENTERPRISE — Scale / Enterprise plans only
const enterpriseItems: NavItem[] = [
  { title: "CRM Sync", url: "/crm-sync", icon: Database },
];

// Bottom navigation — Settings is reached via the profile button below.
const bottomNavItems: NavItem[] = [
  { title: "Usage & Billing", url: "/usage", icon: CreditCard },
];

export function AppSidebar() {
  const { userData, session } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);
  const [enterpriseOpen, setEnterpriseOpen] = useState(true);
  const [plan, setPlan] = useState<string | null>(null);

  const isAdmin = userData?.user?.is_admin === true;

  // CRM sync is a Scale-tier feature — only surface the Enterprise section
  // for workspaces actually on the Scale or Enterprise plan.
  useEffect(() => {
    const token = session?.access_token;
    if (!token) return;
    fetch(`${apiUrl}/api/billing/state`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.plan) setPlan(String(d.plan).toLowerCase()); })
      .catch(() => {});
  }, [session?.access_token]);
  const showEnterprise = plan === "scale" || plan === "enterprise";

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
          } ${active ? "bg-gray-200/60 dark:bg-white/10" : "hover:bg-gray-100/70 dark:hover:bg-white/8"}`}
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

  const adminItems: NavItem[] = [
    { title: "CMS",        icon: Package, url: "/admin/cms"        },
    { title: "Updates",    icon: Package, url: "/admin/updates"    },
    { title: "Roadmap",    icon: Package, url: "/admin/roadmap"    },
    { title: "Changelog",  icon: Package, url: "/admin/changelog"  },
    { title: "Media",      icon: Package, url: "/admin/media"      },
  ];

  return (
    <aside
      className={`flex-shrink-0 h-screen flex flex-col bg-[#FCFCFC] dark:bg-[#0d0d0d] border-r border-gray-200/60 dark:border-white/8 overflow-hidden transition-all duration-200 ${
        collapsed ? "w-[60px]" : "w-[260px]"
      }`}
    >
      {/* Header: Workspace + collapse toggle */}
      <div className={collapsed ? "flex flex-col items-center gap-1.5 px-2 pt-3 pb-2" : "flex items-center gap-2 px-3 pt-3 pb-2"}>
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-white/80 transition-colors"
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
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-white/80 transition-colors flex-shrink-0"
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
            onClick={() => setSetupOpen(o => !o)}
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

      {/* Main navigation */}
      <nav className="px-2.5 pt-7">
        <ul className="flex flex-col gap-0.5">
          {mainNavItems.map(renderNavItem)}
        </ul>
      </nav>

      {/* ENTERPRISE — Scale / Enterprise plans only */}
      {showEnterprise && (
        <nav className="px-2.5 pt-7">
          {!collapsed && (
            <button
              onClick={() => setEnterpriseOpen(o => !o)}
              className="flex w-full items-center justify-between px-2.5 py-1 group"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-white/30">
                Enterprise
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-gray-400 dark:text-white/30 transition-transform duration-150 ${
                  enterpriseOpen ? "" : "-rotate-90"
                }`}
              />
            </button>
          )}
          {(enterpriseOpen || collapsed) && (
            <ul className="flex flex-col gap-0.5 mt-0.5">
              {enterpriseItems.map(renderNavItem)}
            </ul>
          )}
        </nav>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Admin section */}
      {isAdmin && (
        <div className="px-2.5 pb-1">
          <ul className="flex flex-col gap-0.5">
            {adminItems.map((item) => (
              <li key={item.title}>
                <NavLink
                  to={item.url}
                  className={`group flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 transition-all duration-150 hover:bg-blue-50 dark:hover:bg-blue-500/10 ${
                    collapsed ? "justify-center" : ""
                  }`}
                  activeClassName="bg-blue-50 dark:bg-blue-500/10"
                >
                  <item.icon className="h-4 w-4 text-blue-500 flex-shrink-0" strokeWidth={1.75} />
                  {!collapsed && <span className="text-xs text-blue-600 dark:text-blue-400">{item.title}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Bottom: Usage & Billing + Docs */}
      <nav className="px-2.5 pb-1">
        <ul className="flex flex-col gap-0.5">
          {bottomNavItems.map(renderNavItem)}
          {/* Docs — external link to the documentation site */}
          <li>
            <a
              href="https://docs.opennous.cloud"
              target="_blank"
              rel="noopener noreferrer"
              className={`group flex w-full items-center rounded-lg px-2.5 py-1.5 transition-all duration-150 hover:bg-gray-100/70 dark:hover:bg-white/8 ${
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

      {/* Profile row */}
      <div className="px-2.5 pb-3 pt-1">
        <div className="mx-1.5 mb-2 border-t border-gray-200/60 dark:border-white/10" />
        <button
          onClick={toggleTheme}
          className={`group flex w-full items-center rounded-lg px-2.5 py-1.5 mb-1 transition-all duration-150 hover:bg-gray-100/70 dark:hover:bg-white/8 ${collapsed ? "justify-center" : "gap-2.5"}`}
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}
        >
          {theme === "dark"
            ? <Sun className="h-[17px] w-[17px] flex-shrink-0 text-gray-500 dark:text-white/40 group-hover:text-gray-900 dark:group-hover:text-white/70 transition-colors" strokeWidth={1.75} />
            : <Moon className="h-[17px] w-[17px] flex-shrink-0 text-gray-800 group-hover:text-gray-900 transition-colors" strokeWidth={1.75} />
          }
          {!collapsed && (
            <span className="text-[13px] text-gray-700 dark:text-white/40 group-hover:text-gray-900 dark:group-hover:text-white/70 transition-colors">
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </span>
          )}
        </button>
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
    </aside>
  );
}

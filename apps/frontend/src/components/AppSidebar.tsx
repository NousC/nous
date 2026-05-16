import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Newspaper,
  Image,
  Users,
  Handshake,
  PanelLeftClose,
  PanelLeft,
  Building2,
  Plug,
  Database,
  Brain,
  ListChecks,
  CreditCard,
  ClipboardList,
  Terminal,
  Rss,
  BookOpen,
  BarChart2,
  Sun,
  Moon,
  Github,
} from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { SidebarWorkspaceSelector } from "@/components/SidebarWorkspaceSelector";

// Main navigation — all items rendered with uniform spacing
const mainNavItems = [
  { title: "Mind",         url: "/",              icon: Brain     },
  { title: "People",       url: "/people",        icon: Users     },
  { title: "Companies",    url: "/companies",     icon: Building2 },
  { title: "Integrations", url: "/integrations",  icon: Plug      },
  { title: "CRM",          url: "/crm",           icon: Database  },
  { title: "Memories",     url: "/memories",      icon: Brain     },
];

const IS_CLOUD = !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

// Bottom utility nav
const bottomNavItems = [
  { title: "Docs",    url: "/docs",      icon: BookOpen  },
  { title: "Usage",   url: "/usage",     icon: BarChart2 },
  ...(IS_CLOUD ? [{ title: "Billing", url: "/billing", icon: CreditCard }] : []),
  { title: "API",     url: "/developer", icon: Terminal  },
];

// Hidden — kept for future re-activation
// const hiddenItems = [
//   { title: "Documents",  url: "/documents",              icon: FileText       },
//   { title: "Templates",  url: "/templates/my-templates", icon: LayoutTemplate },
//   { title: "Reporting",  url: "/reporting",              icon: BarChart3      },
// ];

const CRM_LOGOS: Record<string, string> = {
  hubspot:   "/provider-logos/hubspot.svg",
  pipedrive: "/provider-logos/pipedrive.svg",
  attio:     "/provider-logos/attio.svg",
};

export function AppSidebar() {
  const { userData } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [connectedCrmProvider, setConnectedCrmProvider] = useState<string | null>(
    () => localStorage.getItem("connectedCrmProvider")
  );

  useEffect(() => {
    const sync = () => setConnectedCrmProvider(localStorage.getItem("connectedCrmProvider"));
    window.addEventListener("storage", sync);
    window.addEventListener("crm-provider-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("crm-provider-changed", sync);
    };
  }, []);

  const isAdmin = userData?.user?.is_admin === true;

  const isItemActive = (url: string) => {
    if (url === "/") return location.pathname === "/";
    return (
      location.pathname === url ||
      location.pathname.startsWith(url + "/")
    );
  };

  const renderNavItem = (item: { title: string; url: string; icon: React.ElementType }) => {
    const active = isItemActive(item.url);
    const iconColor = active ? "text-gray-900 dark:text-white" : "text-gray-800 dark:text-white/50";
    const crmLogo = item.url === "/crm" && connectedCrmProvider ? CRM_LOGOS[connectedCrmProvider] : null;

    const content = (
      <div className="flex items-center gap-3">
        {crmLogo ? (
          <img src={crmLogo} alt={connectedCrmProvider!} className="h-[17px] w-[17px] flex-shrink-0 object-contain" />
        ) : (
        <item.icon
          className={`h-[17px] w-[17px] flex-shrink-0 transition-colors ${iconColor}`}
          strokeWidth={active ? 2 : 1.75}
        />
        )}
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
    );

    return (
      <li key={item.title}>
        <NavLink
          to={item.url}
          end={item.url === "/"}
          className={`group flex w-full items-center rounded-lg px-2.5 py-1.5 transition-all duration-150 ${
            active ? "bg-gray-200/60 dark:bg-white/10" : "hover:bg-gray-100/70 dark:hover:bg-white/8"
          }`}
          activeClassName=""
        >
          {content}
        </NavLink>
      </li>
    );
  };

  const adminItems = [
    { title: "CMS",        icon: Newspaper,    url: "/admin/cms"        },
    { title: "Updates",    icon: Rss,          url: "/admin/updates"    },
    { title: "Roadmap",    icon: ListChecks,   url: "/admin/roadmap"    },
    { title: "Changelog",  icon: ClipboardList, url: "/admin/changelog" },
    { title: "Media",      icon: Image,        url: "/admin/media"      },
    { title: "Users",      icon: Users,        url: "/admin/support"    },
    { title: "Affiliates", icon: Handshake,    url: "/admin/affiliates" },
  ];

  return (
    <>
      <aside
        className={`flex-shrink-0 h-screen flex flex-col bg-[#FCFCFC] dark:bg-[#0d0d0d] border-r border-gray-200/60 dark:border-white/8 overflow-hidden transition-all duration-200 ${
          collapsed ? "w-[60px]" : "w-[260px]"
        }`}
      >
        {/* Header: Collapse toggle + Workspace */}
        <div className={collapsed ? "flex flex-col items-center gap-1.5 px-2 pt-3 pb-2" : "flex items-center gap-2 px-3 pt-3 pb-2"}>
          {collapsed && (
            <button
              onClick={() => setCollapsed(false)}
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-white/80 transition-colors"
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
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Main Navigation — uniform spacing for all items */}
        <nav className="px-2.5 py-1">
          <ul className="flex flex-col gap-0.5">
            {mainNavItems.map((item) => renderNavItem(item))}
          </ul>
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Admin Section */}
        {isAdmin && (
          <div className="px-1.5 pb-1">
            <ul className="flex flex-col gap-0.5">
              {adminItems.map((item) => (
                <li key={item.title}>
                  <NavLink
                    to={item.url}
                    className={`group flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 transition-all duration-150 hover:bg-blue-50 ${
                      collapsed ? "justify-center" : ""
                    }`}
                    activeClassName="bg-blue-50"
                  >
                    <item.icon
                      className="h-4 w-4 text-blue-500 flex-shrink-0"
                      strokeWidth={1.75}
                    />
                    {!collapsed && (
                      <span className="text-xs text-blue-600">{item.title}</span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Bottom Navigation */}
        <div className="px-2.5 pb-1">
          <ul className="flex flex-col gap-0.5">
            {/* Docs link — points to external documentation */}
            <li>
              <a
                href={import.meta.env.VITE_DOCS_URL || "https://github.com/bennetglinder1/proply-crm"}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex w-full items-center rounded-lg px-2.5 py-1.5 transition-all duration-150 hover:bg-gray-100/70 dark:hover:bg-white/8"
              >
                <div className="flex items-center gap-3">
                  <BookOpen
                    className="h-[17px] w-[17px] flex-shrink-0 text-gray-800 dark:text-white/50 transition-colors group-hover:text-gray-900 dark:group-hover:text-white"
                    strokeWidth={1.75}
                  />
                  {!collapsed && (
                    <span className="text-[13px] leading-tight text-gray-700 dark:text-white/50 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                      Docs
                    </span>
                  )}
                </div>
              </a>
            </li>
            {bottomNavItems.filter(i => i.url !== "/docs").map((item) => renderNavItem(item))}
          </ul>
        </div>

        {/* GitHub + Discord */}
        {!collapsed && (
          <div className="px-4 pb-2 flex items-center gap-3">
            <a href="https://github.com/bennetglinder1/proply-crm" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors">
              <Github className="h-[15px] w-[15px]" strokeWidth={1.75} />
            </a>
            <a href="https://discord.gg/npa59RTgs" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors">
              <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
            </a>
          </div>
        )}

        {/* Profile row */}
        <div className="px-2.5 pb-3 pt-1">
          <div className="mx-1.5 mb-2 border-t border-gray-200/60 dark:border-white/10" />
          {/* Theme toggle */}
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
            } ${isItemActive("/settings") ? "bg-gray-200/60 dark:bg-white/10" : ""}`}
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

    </>
  );
}

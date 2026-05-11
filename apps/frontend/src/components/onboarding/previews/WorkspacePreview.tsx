import { ChevronDown, Home, LayoutTemplate, FileText, ClipboardList, Workflow, BarChart3, Settings, Code } from "lucide-react";
import { cn } from "@/lib/utils";
import { getWorkspaceIcon } from "@/utils/workspaceIcons";

interface WorkspacePreviewProps {
  workspaceName: string;
  companyLogo?: string | null;
}

export function WorkspacePreview({ workspaceName, companyLogo }: WorkspacePreviewProps) {
  const displayName = workspaceName || "Your Workspace";
  const initials = displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  // Get the selected icon component
  const IconComponent = getWorkspaceIcon(companyLogo);

  return (
    <div className="w-full max-w-[280px]">
      {/* Actual Sidebar Mockup */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
        {/* Workspace Selector - matches SidebarWorkspaceSelector */}
        <div className="p-3 border-b border-gray-100">
          <div
            className={cn(
              "flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-all duration-300",
              workspaceName && "bg-gray-50 ring-1 ring-emerald-500/30"
            )}
          >
            {/* Workspace Icon */}
            <div className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-semibold transition-all",
              workspaceName ? "bg-emerald-600" : "bg-gray-400"
            )}>
              {IconComponent ? (
                <IconComponent className="w-4 h-4" />
              ) : (
                initials || "W"
              )}
            </div>

            {/* Workspace Info */}
            <div className="flex-1 min-w-0">
              <p
                className={cn(
                  "text-sm font-medium truncate transition-all duration-300",
                  workspaceName ? "text-gray-900" : "text-gray-400"
                )}
              >
                {displayName}
              </p>
            </div>

            <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
          </div>
        </div>

        {/* Navigation Items - matches AppSidebar */}
        <div className="p-2">
          {/* Main nav items */}
          <div className="space-y-0.5">
            {[
              { label: "Home", icon: Home, active: true },
              { label: "Templates", icon: LayoutTemplate },
              { label: "Documents", icon: FileText },
              { label: "Forms", icon: ClipboardList },
              { label: "Workflows", icon: Workflow },
              { label: "Reporting", icon: BarChart3 },
            ].map((item) => (
              <div
                key={item.label}
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors",
                  item.active
                    ? "bg-gray-100 text-gray-900 font-medium"
                    : "text-gray-600"
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="my-2 border-t border-gray-100" />

          {/* Bottom items */}
          <div className="space-y-0.5">
            {[
              { label: "API", icon: Code },
              { label: "Settings", icon: Settings },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-gray-600"
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}

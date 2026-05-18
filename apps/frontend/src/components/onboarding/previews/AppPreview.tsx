import {
  LayoutDashboard,
  FileText,
  Folder,
  BarChart2,
  Settings,
  PenTool,
  Workflow,
} from "lucide-react";

export function AppPreview() {
  return (
    <div className="w-full max-w-md">
      {/* Mockup App Window */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-2xl overflow-hidden">
        {/* Window Chrome */}
        <div className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-50 border-b border-gray-100">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
          <span className="ml-3 text-xs text-gray-400 font-medium">Nous</span>
        </div>

        {/* App Content */}
        <div className="flex h-[320px]">
          {/* Sidebar */}
          <div className="w-14 bg-gray-50 border-r border-gray-100 flex flex-col items-center py-4 gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <LayoutDashboard className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors">
              <FileText className="w-4 h-4 text-gray-400" />
            </div>
            <div className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors">
              <PenTool className="w-4 h-4 text-gray-400" />
            </div>
            <div className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors">
              <Workflow className="w-4 h-4 text-gray-400" />
            </div>
            <div className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors">
              <Folder className="w-4 h-4 text-gray-400" />
            </div>
            <div className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors">
              <BarChart2 className="w-4 h-4 text-gray-400" />
            </div>
            <div className="mt-auto">
              <div className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors">
                <Settings className="w-4 h-4 text-gray-400" />
              </div>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="h-5 w-24 bg-gray-200 rounded animate-pulse" />
              <div className="h-7 w-20 bg-emerald-500/20 rounded-md" />
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="p-2.5 rounded-lg border border-gray-100 bg-gray-50"
                >
                  <div className="h-3 w-12 bg-gray-200 rounded mb-1.5" />
                  <div className="h-5 w-8 bg-gray-300 rounded" />
                </div>
              ))}
            </div>

            {/* Content List */}
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 p-2 rounded-lg border border-gray-100"
                >
                  <div className="w-8 h-8 rounded bg-gray-100" />
                  <div className="flex-1">
                    <div className="h-3 w-24 bg-gray-200 rounded mb-1" />
                    <div className="h-2 w-16 bg-gray-100 rounded" />
                  </div>
                  <div className="h-5 w-12 bg-gray-100 rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Caption */}
      <p className="text-center text-sm text-gray-500 mt-6">
        Your workspace is ready to go
      </p>
    </div>
  );
}

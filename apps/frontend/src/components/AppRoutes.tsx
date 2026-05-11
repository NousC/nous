import { Routes, Route, Navigate } from "react-router-dom";
import React, { lazy, Suspense } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { ProfileDropdown } from "@/components/ProfileDropdown";
import { useChatSessions } from "@/hooks/useChatSessions";
import { AdminRoute } from "@/components/AdminRoute";

const lazyWithErrorBoundary = (importFn: () => Promise<any>) => {
  return lazy(() =>
    importFn().catch((error) => {
      console.error('Failed to load chunk:', error);
      return {
        default: () => (
          <div className="flex flex-col items-center justify-center min-h-screen p-8">
            <h2 className="text-2xl font-semibold mb-2">Failed to load page</h2>
            <p className="text-muted-foreground mb-4">Please refresh the page and try again.</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            >
              Reload Page
            </button>
          </div>
        ),
      };
    })
  );
};

const DeveloperPortal = lazyWithErrorBoundary(() => import("@/pages/DeveloperPortal"));
const People          = lazyWithErrorBoundary(() => import("@/pages/People"));
const Companies       = lazyWithErrorBoundary(() => import("@/pages/Companies"));
const CRM             = lazyWithErrorBoundary(() => import("@/pages/CRM"));
const Integrations    = lazyWithErrorBoundary(() => import("@/pages/Integrations"));
const Memories        = lazyWithErrorBoundary(() => import("@/pages/Memories"));
const Requests        = lazyWithErrorBoundary(() => import("@/pages/Requests"));
const Inbox           = lazyWithErrorBoundary(() => import("@/pages/Inbox"));
const Reporting       = lazyWithErrorBoundary(() => import("@/pages/AdvancedAnalytics"));
const API             = lazyWithErrorBoundary(() => import("@/pages/API"));
const Settings        = lazyWithErrorBoundary(() => import("@/pages/Settings"));
const SystemLog       = lazyWithErrorBoundary(() => import("@/pages/SystemLog"));
const NotFound        = lazyWithErrorBoundary(() => import("@/pages/NotFound"));

const AdminCMS              = lazyWithErrorBoundary(() => import("@/pages/AdminCMS"));
const AdminChangelog        = lazyWithErrorBoundary(() => import("@/pages/AdminChangelog"));
const AdminRoadmap          = lazyWithErrorBoundary(() => import("@/pages/AdminRoadmap"));
const AdminUpdates          = lazyWithErrorBoundary(() => import("@/pages/AdminUpdates"));
const AdminMedia            = lazyWithErrorBoundary(() => import("@/pages/AdminMedia"));
const AdminSupportDashboard = lazyWithErrorBoundary(() => import("@/pages/AdminSupportDashboard"));
const AdminAffiliates       = lazyWithErrorBoundary(() => import("@/pages/AdminAffiliates"));

const MinimalLoader = () => <div className="flex flex-col h-full" />;

const TableLoader = () => (
  <div className="flex flex-col h-full">
    <div className="border-b border-border/40">
      <div className="container mx-auto px-6 py-4 flex items-center gap-4">
        <div className="h-6 w-32 bg-muted/40 rounded animate-pulse" />
        <div className="flex-1" />
        <div className="h-9 w-24 bg-muted/20 rounded-md animate-pulse" />
      </div>
    </div>
    <div className="container mx-auto px-6 py-6 flex-1">
      <div className="space-y-3">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-14 bg-muted/30 rounded-lg animate-pulse" />
        ))}
      </div>
    </div>
  </div>
);

function AdminFullScreen({ children }: { children: React.ReactNode }) {
  return (
    <AdminRoute>
      <div className="min-h-screen bg-background">
        {children}
      </div>
    </AdminRoute>
  );
}

export function AppRoutes() {
  const chatSessionsHook = useChatSessions();

  return (
    <Routes>
      {/* Full-screen admin pages — no sidebar/header */}
      <Route path="/admin/cms" element={<AdminFullScreen><Suspense fallback={<MinimalLoader />}><AdminCMS /></Suspense></AdminFullScreen>} />
      <Route path="/admin/support" element={<AdminFullScreen><Suspense fallback={<MinimalLoader />}><AdminSupportDashboard /></Suspense></AdminFullScreen>} />

      {/* Standard layout — sidebar + header */}
      <Route path="*" element={
        <div className="flex h-screen w-full bg-white overflow-hidden">
          <AppSidebar
            chatSessions={chatSessionsHook.sessions}
            activeChatSessionId={chatSessionsHook.activeSessionId}
            onNewChat={() => chatSessionsHook.createSession()}
            onSelectChat={(id) => chatSessionsHook.selectSession(id)}
            onDeleteChat={(id) => chatSessionsHook.deleteSession(id)}
          />
          <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <header className="flex-shrink-0 flex h-14 items-center justify-end gap-4 border-b border-gray-100 bg-white px-5">
              <ProfileDropdown />
            </header>
            <div className="flex-1 overflow-auto">
              <Routes>
                <Route path="/" element={<Suspense fallback={<MinimalLoader />}><DeveloperPortal /></Suspense>} />
                <Route path="/developer" element={<Suspense fallback={<MinimalLoader />}><DeveloperPortal /></Suspense>} />
                <Route path="/billing" element={<Suspense fallback={<MinimalLoader />}><DeveloperPortal /></Suspense>} />
                <Route path="/usage" element={<Suspense fallback={<MinimalLoader />}><DeveloperPortal /></Suspense>} />

                <Route path="/people" element={<Suspense fallback={<TableLoader />}><People /></Suspense>} />
                <Route path="/companies" element={<Suspense fallback={<TableLoader />}><Companies /></Suspense>} />
                <Route path="/crm" element={<Suspense fallback={<TableLoader />}><CRM /></Suspense>} />
                <Route path="/memories" element={<Suspense fallback={<TableLoader />}><Memories /></Suspense>} />

                <Route path="/integrations" element={<Suspense fallback={<TableLoader />}><Integrations /></Suspense>} />
                <Route path="/requests" element={<Suspense fallback={<TableLoader />}><Requests /></Suspense>} />
                <Route path="/inbox" element={<Suspense fallback={<TableLoader />}><Inbox /></Suspense>} />

                <Route path="/reporting" element={<Suspense fallback={<TableLoader />}><Reporting /></Suspense>} />
                <Route path="/analytics" element={<Navigate to="/reporting" replace />} />

                <Route path="/api" element={<Suspense fallback={<MinimalLoader />}><API /></Suspense>} />
                <Route path="/settings" element={<Suspense fallback={<MinimalLoader />}><Settings /></Suspense>} />
                <Route path="/settings/*" element={<Suspense fallback={<MinimalLoader />}><Settings /></Suspense>} />
                <Route path="/system-log" element={<Suspense fallback={<TableLoader />}><SystemLog /></Suspense>} />

                {/* Admin pages with sidebar */}
                <Route path="/admin/changelog" element={<AdminRoute><Suspense fallback={<MinimalLoader />}><AdminChangelog /></Suspense></AdminRoute>} />
                <Route path="/admin/roadmap" element={<AdminRoute><Suspense fallback={<MinimalLoader />}><AdminRoadmap /></Suspense></AdminRoute>} />
                <Route path="/admin/updates" element={<AdminRoute><Suspense fallback={<MinimalLoader />}><AdminUpdates /></Suspense></AdminRoute>} />
                <Route path="/admin/media" element={<AdminRoute><Suspense fallback={<MinimalLoader />}><AdminMedia /></Suspense></AdminRoute>} />
                <Route path="/admin/affiliates" element={<AdminRoute><Suspense fallback={<MinimalLoader />}><AdminAffiliates /></Suspense></AdminRoute>} />

                <Route path="*" element={<Suspense fallback={<MinimalLoader />}><NotFound /></Suspense>} />
              </Routes>
            </div>
          </main>
        </div>
      } />
    </Routes>
  );
}

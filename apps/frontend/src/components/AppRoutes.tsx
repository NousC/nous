import { Routes, Route, Navigate } from "react-router-dom";
import React, { lazy, Suspense } from "react";
import { AdminRoute } from "@/components/AdminRoute";
import { AppSidebar } from "@/components/AppSidebar";
import { OpsLimitBanner } from "@/components/OpsLimitBanner";
import ComingSoon from "@/pages/ComingSoon";
import { useAuth } from "@/contexts/AuthContext";

// Cloud-only routes (Lists) — on a self-hosted instance these features
// don't exist, so redirect home instead of rendering the page.
function CloudOnly({ children }: { children: React.ReactNode }) {
  const { userData } = useAuth();
  if ((userData as { self_hosted?: boolean })?.self_hosted === true) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

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

const Settings        = lazyWithErrorBoundary(() => import("@/pages/Settings"));
const Install         = lazyWithErrorBoundary(() => import("@/pages/Install"));
const Playground      = lazyWithErrorBoundary(() => import("@/pages/Playground"));
const ApiKeys         = lazyWithErrorBoundary(() => import("@/pages/ApiKeys"));
const Webhooks        = lazyWithErrorBoundary(() => import("@/pages/Webhooks"));
const Triggers        = lazyWithErrorBoundary(() => import("@/pages/Triggers"));
const Ops             = lazyWithErrorBoundary(() => import("@/pages/Ops"));
const People          = lazyWithErrorBoundary(() => import("@/pages/People"));
const Companies       = lazyWithErrorBoundary(() => import("@/pages/Companies"));
const Accounts        = lazyWithErrorBoundary(() => import("@/pages/Accounts"));
const Galaxy          = lazyWithErrorBoundary(() => import("@/pages/Galaxy"));
const Integrations    = lazyWithErrorBoundary(() => import("@/pages/Integrations"));
const UsageBilling    = lazyWithErrorBoundary(() => import("@/pages/UsageBilling"));
const Inbox           = lazyWithErrorBoundary(() => import("@/pages/Inbox"));
const Intelligence    = lazyWithErrorBoundary(() => import("@/pages/Intelligence"));
const Lists           = lazyWithErrorBoundary(() => import("@/pages/Lists"));
// Reports hidden for now.
// const Reports         = lazyWithErrorBoundary(() => import("@/pages/Reports"));
const Note            = lazyWithErrorBoundary(() => import("@/pages/Note"));
// const ReportView      = lazyWithErrorBoundary(() => import("@/pages/Report"));
const PlaybookView    = lazyWithErrorBoundary(() => import("@/pages/Playbook"));
const NotFound        = lazyWithErrorBoundary(() => import("@/pages/NotFound"));
const ConnectGate     = lazyWithErrorBoundary(() => import("@/pages/ConnectGate"));

const AdminCMS              = lazyWithErrorBoundary(() => import("@/pages/AdminCMS"));
const AdminResources        = lazyWithErrorBoundary(() => import("@/pages/AdminResources"));
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

// App shell — persistent sidebar + scrollable main pane
function StandardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <AppSidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <OpsLimitBanner />
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}

export function AppRoutes() {
  // First-run gate: until the agent has onboarded the workspace (business_type
  // set by set_workspace_profile), the whole app — sidebar and all — is replaced
  // by the full-screen Connect screen. No access to anything until setup is done.
  const { isAuthenticated, userData } = useAuth();
  const wsId = (userData as { workspace?: { id?: string } })?.workspace?.id;
  const onboarded = !!(userData as { workspace?: { business_type?: string } })?.workspace?.business_type;
  // "Skip for now" is scoped to THIS workspace, so a different/new account in the
  // same browser still gets the gate.
  let skipped = false;
  try { skipped = !!wsId && localStorage.getItem(`nous_connect_skipped:${wsId}`) === "1"; } catch { /* ignore */ }
  if (isAuthenticated && wsId && !onboarded && !skipped) {
    return <Suspense fallback={<MinimalLoader />}><ConnectGate /></Suspense>;
  }

  return (
    <Routes>
      {/* Full-screen admin pages — no sidebar/header */}
      <Route path="/admin/cms" element={<AdminFullScreen><Suspense fallback={<MinimalLoader />}><AdminCMS /></Suspense></AdminFullScreen>} />
      <Route path="/admin/resources" element={<AdminFullScreen><Suspense fallback={<MinimalLoader />}><AdminResources /></Suspense></AdminFullScreen>} />
      <Route path="/admin/support" element={<AdminFullScreen><Suspense fallback={<MinimalLoader />}><AdminSupportDashboard /></Suspense></AdminFullScreen>} />

      {/* Playground is its own immersive canvas — no app sidebar.
          Lives outside StandardLayout so the chat + tool-trace UI gets the
          full viewport, matching the Mem0 playground pattern. */}
      <Route path="/playground" element={
        <CloudOnly>
          <div className="h-screen w-full bg-background overflow-hidden">
            <Suspense fallback={<MinimalLoader />}><Playground /></Suspense>
          </div>
        </CloudOnly>
      } />

      {/* Context graph — its own immersive full-viewport surface, no app sidebar. */}
      <Route path="/graph" element={
        <div className="h-screen w-full bg-background overflow-hidden">
          <Suspense fallback={<MinimalLoader />}><Galaxy /></Suspense>
        </div>
      } />

      {/* Standalone note + report pages — opened in a new tab, clean full-page markdown. */}
      <Route path="/note/:id" element={<Suspense fallback={<MinimalLoader />}><Note /></Suspense>} />
      {/* Reports hidden for now. <Route path="/report/:id" element={<Suspense fallback={<MinimalLoader />}><ReportView /></Suspense>} /> */}
      <Route path="/playbook/:id" element={<Suspense fallback={<MinimalLoader />}><PlaybookView /></Suspense>} />

      {/* Standard layout — sidebar + conditional header */}
      <Route path="*" element={
        <StandardLayout>
          <Routes>
            {/* Live ops log — its own page. */}
            <Route path="/ops"        element={<Suspense fallback={<MinimalLoader />}><Ops /></Suspense>} />
            <Route path="/operations" element={<Navigate to="/ops" replace />} />
            <Route path="/requests"   element={<Navigate to="/ops" replace />} />
            {/* Setup */}
            <Route path="/install"    element={<Suspense fallback={<MinimalLoader />}><Install /></Suspense>} />
            {/* /playground and /graph are mounted above as full-screen routes — no sidebar */}
            <Route path="/keys"       element={<Suspense fallback={<MinimalLoader />}><ApiKeys /></Suspense>} />
            {/* Main nav */}
            <Route path="/webhooks"   element={<Suspense fallback={<MinimalLoader />}><Webhooks /></Suspense>} />
            <Route path="/triggers"   element={<CloudOnly><Suspense fallback={<MinimalLoader />}><Triggers /></Suspense></CloudOnly>} />

            <Route path="/billing" element={<Suspense fallback={<MinimalLoader />}><UsageBilling /></Suspense>} />
            <Route path="/usage" element={<CloudOnly><Suspense fallback={<MinimalLoader />}><UsageBilling /></Suspense></CloudOnly>} />

            <Route path="/" element={<Navigate to="/ops" replace />} />
            <Route path="/settings" element={<Suspense fallback={<MinimalLoader />}><Settings /></Suspense>} />

            {/* Standalone pages — extracted from Mind */}
            <Route path="/accounts"      element={<Suspense fallback={<MinimalLoader />}><Accounts /></Suspense>} />
            <Route path="/people"        element={<Navigate to="/accounts?tab=people" replace />} />
            <Route path="/people/:id"    element={<Suspense fallback={<MinimalLoader />}><People /></Suspense>} />
            <Route path="/companies"     element={<Navigate to="/accounts?tab=companies" replace />} />
            <Route path="/companies/:id" element={<Suspense fallback={<MinimalLoader />}><Companies /></Suspense>} />
            <Route path="/integrations"  element={<Suspense fallback={<MinimalLoader />}><Integrations /></Suspense>} />
            <Route path="/lists"         element={<CloudOnly><Suspense fallback={<MinimalLoader />}><Lists /></Suspense></CloudOnly>} />
            {/* Reports hidden for now. <Route path="/reports"       element={<CloudOnly><Suspense fallback={<MinimalLoader />}><Reports /></Suspense></CloudOnly>} /> */}
            {/* Each list on its own page — /lists/:listId. */}
            <Route path="/lists/:listId" element={<CloudOnly><Suspense fallback={<MinimalLoader />}><Lists /></Suspense></CloudOnly>} />
            <Route path="/playbooks"     element={<Suspense fallback={<MinimalLoader />}><Intelligence /></Suspense>} />
            <Route path="/icp"           element={<Navigate to="/playbooks" replace />} />
            <Route path="/playbook"      element={<Navigate to="/icp" replace />} />
            <Route path="/intelligence"  element={<Navigate to="/playbooks" replace />} />
            <Route path="/settings/*" element={<Navigate to="/settings" replace />} />

            <Route path="/inbox" element={<Suspense fallback={<TableLoader />}><Inbox /></Suspense>} />

            <Route path="/admin/changelog" element={<AdminRoute><Suspense fallback={<MinimalLoader />}><AdminChangelog /></Suspense></AdminRoute>} />
            <Route path="/admin/roadmap" element={<AdminRoute><Suspense fallback={<MinimalLoader />}><AdminRoadmap /></Suspense></AdminRoute>} />
            <Route path="/admin/updates" element={<AdminRoute><Suspense fallback={<MinimalLoader />}><AdminUpdates /></Suspense></AdminRoute>} />
            <Route path="/admin/media" element={<AdminRoute><Suspense fallback={<MinimalLoader />}><AdminMedia /></Suspense></AdminRoute>} />
            <Route path="/admin/affiliates" element={<AdminRoute><Suspense fallback={<MinimalLoader />}><AdminAffiliates /></Suspense></AdminRoute>} />

            <Route path="*" element={<Suspense fallback={<MinimalLoader />}><NotFound /></Suspense>} />
          </Routes>
        </StandardLayout>
      } />
    </Routes>
  );
}

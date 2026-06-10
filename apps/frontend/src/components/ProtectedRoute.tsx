import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireOnboarding?: boolean; // kept for backwards compat, unused
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, loading, userDataLoading, userData } = useAuth();
  const location = useLocation();

  // Only block the UI on the initial auth check, OR while we're fetching
  // userData for the first time. Once we have userData, background
  // refreshes (TOKEN_REFRESHED, tab-focus revalidations, workspace
  // switches) happen silently — the page stays mounted with stale data.
  const showInitialLoader = loading || (userDataLoading && !userData);

  if (showInitialLoader) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Onboarding moved to the agent: you set up Nous by talking to Claude, not a
  // web wizard. The app stays LOCKED to the Install ("Connect your agent")
  // screen until the agent has onboarded the workspace — signalled by the
  // workspace having a business_type, which set_workspace_profile sets (and the
  // old wizard set too, so existing onboarded workspaces are never locked).
  // /cli-login is exempt so a brand-new user can approve their first key.
  const onboarded = !!(userData as { workspace?: { business_type?: string } })?.workspace?.business_type;
  if (!onboarded && location.pathname !== '/install' && location.pathname !== '/cli-login') {
    return <Navigate to="/install" replace />;
  }

  return <>{children}</>;
}

import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export type ChecklistStep = {
  id: string;
  label: string;
  completed: boolean;
  href: string;
};

export type Checklist = {
  steps: ChecklistStep[];
  completed_count: number;
  total: number;
  debug?: unknown;
};

export function useChecklist() {
  const { session, userData, isAuthenticated } = useAuth();
  const workspaceId = userData?.workspace?.id;
  const { pathname } = useLocation();
  const [data, setData] = useState<Checklist | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchChecklist = useCallback(async () => {
    if (!isAuthenticated || !session?.access_token || !workspaceId) return;
    setLoading(true);
    try {
      const url = `${API_URL}/api/onboarding/checklist?workspaceId=${encodeURIComponent(workspaceId)}`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (r.ok) setData(await r.json());
    } catch {
      /* swallow — non-critical */
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, session?.access_token, workspaceId]);

  // Refetch on mount, on auth/session change, on workspace change, on route change, on tab focus.
  useEffect(() => { fetchChecklist(); }, [fetchChecklist, pathname]);

  useEffect(() => {
    const onFocus = () => fetchChecklist();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchChecklist]);

  return { data, loading, refetch: fetchChecklist };
}

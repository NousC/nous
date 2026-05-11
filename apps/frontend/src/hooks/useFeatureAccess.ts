import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { hasFeatureAccess, FeatureAccess } from '@/config/plans';

export function useFeatureAccess() {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [currentPlan, setCurrentPlan] = useState<string>('starter');
  const [isTrialUser, setIsTrialUser] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [creditsLimit, setCreditsLimit] = useState<number | null>(null);

  useEffect(() => {
    const fetchPlan = async () => {
      if (!session?.access_token) {
        setLoading(false);
        return;
      }

      try {
        const apiUrl = import.meta.env.VITE_API_URL ?? '';
        // Use /api/usage endpoint which has proper trial and subscription info
        const response = await fetch(`${apiUrl}/api/usage`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          // Get plan name from usage endpoint
          const planName = data.plan || 'starter';
          setCurrentPlan(planName.toLowerCase());

          // Check if user is on trial - usage endpoint has trial info
          const isTrial = data.trial?.is_active === true;
          setIsTrialUser(isTrial);

          // Get credit info from usage endpoint
          if (data.usage?.credits) {
            setCreditsRemaining(data.usage.credits.remaining ?? null);
            setCreditsLimit(data.usage.credits.limit ?? null);
          }
        }
      } catch (error) {
        console.error('Error fetching plan:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPlan();
  }, [session]);

  const checkAccess = (feature: keyof FeatureAccess): boolean => {
    return hasFeatureAccess(currentPlan, feature, isTrialUser);
  };

  // While loading, show all features optimistically to avoid layout shift
  // Once loaded, use actual feature access based on plan
  const showOptimistically = loading;

  return {
    loading,
    currentPlan,
    isTrialUser,
    creditsRemaining,
    creditsLimit,
    checkAccess,
    hasFormsAccess: showOptimistically || hasFeatureAccess(currentPlan, 'forms', isTrialUser),
    hasWorkflowsAccess: showOptimistically || hasFeatureAccess(currentPlan, 'workflows', isTrialUser),
    hasCrmIntegrationsAccess: showOptimistically || hasFeatureAccess(currentPlan, 'crmIntegrations', isTrialUser),
    hasCustomBrandingAccess: showOptimistically || hasFeatureAccess(currentPlan, 'customBranding', isTrialUser),
  };
}

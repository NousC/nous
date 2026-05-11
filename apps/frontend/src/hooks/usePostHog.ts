import { useEffect } from 'react';
import { posthog } from '@/lib/posthog';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Hook to use PostHog analytics
 * Automatically identifies users when they log in
 */
export function usePostHog() {
  const { userData, session } = useAuth();

  // Identify user when they log in
  useEffect(() => {
    if (userData && session && posthog) {
      posthog.identify(userData.id, {
        email: userData.email,
        name: userData.full_name || userData.email,
        // Add any other user properties you want to track
      });
    }
  }, [userData, session]);

  return posthog;
}


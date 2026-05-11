export interface CreditError {
  creditsRemaining: number;
  creditsRequired: number;
  currentPlan: string;
  featureType: 'graphic' | 'background' | 'content';
}

export interface CreditCheckResult {
  sufficient: boolean;
  creditsRemaining: number;
  currentPlan: string;
}

/**
 * Check if user has sufficient credits for an operation.
 * This is a plain async function (not a hook) to avoid hook ordering issues.
 *
 * @param accessToken - The user's session access token
 * @param requiredCredits - Number of credits needed
 * @returns CreditCheckResult with sufficient flag and credit info
 */
export async function checkCredits(
  accessToken: string | undefined,
  requiredCredits: number
): Promise<CreditCheckResult> {
  if (!accessToken) {
    // No session — let server enforce
    return { sufficient: true, creditsRemaining: 0, currentPlan: 'starter' };
  }

  try {
    const apiUrl = import.meta.env.VITE_API_URL ?? '';
    const response = await fetch(`${apiUrl}/api/usage`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      // Fetch failed — let server enforce
      return { sufficient: true, creditsRemaining: 0, currentPlan: 'starter' };
    }

    const data = await response.json();
    const currentPlan = (data.plan || 'starter').toLowerCase();
    const rawRemaining = data.usage?.credits?.remaining;

    // null means unlimited credits (VIP/admin users) - always sufficient
    if (rawRemaining === null || rawRemaining === undefined) {
      return {
        sufficient: true,
        creditsRemaining: Infinity,
        currentPlan,
      };
    }

    // Normal users - check against required credits
    return {
      sufficient: rawRemaining >= requiredCredits,
      creditsRemaining: rawRemaining,
      currentPlan,
    };
  } catch {
    // Network error — let server enforce
    return { sufficient: true, creditsRemaining: 0, currentPlan: 'starter' };
  }
}

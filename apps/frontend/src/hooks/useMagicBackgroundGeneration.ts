import { useState, useCallback } from 'react';
import { useAuth } from './useAuth';
import { toast } from 'sonner';
import { checkCredits, CreditError } from './useCreditCheck';

export interface MagicBackgroundOptions {
  pageType?: 'auto' | 'cover' | 'inner';
  customPrompt?: string;
  oneOffInspirationUrl?: string; // One-off reference image for this generation only
  applyToAll?: boolean;
}

export interface MagicBackgroundResult {
  pageIndex: number;
  imageUrl: string;
}

export interface SavedMagicBackground {
  id: string;
  image_url: string;
  page_type: string;
  custom_prompt: string | null;
  created_at: string;
}

export function useMagicBackgroundGeneration() {
  const { session } = useAuth();
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; progress: number } | null>(null);
  const [savedBackgrounds, setSavedBackgrounds] = useState<SavedMagicBackground[]>([]);
  const [loadingGallery, setLoadingGallery] = useState(false);
  const [creditError, setCreditError] = useState<CreditError | null>(null);

  const clearCreditError = useCallback(() => setCreditError(null), []);

  const generateBackground = async (
    templateId: string,
    pageIndex: number,
    options: MagicBackgroundOptions = {},
    creditsRequired: number = 15,
  ): Promise<MagicBackgroundResult[]> => {
    if (!session?.access_token) {
      throw new Error('Not authenticated');
    }

    // Pre-flight credit check
    const creditCheck = await checkCredits(session.access_token, creditsRequired);
    if (!creditCheck.sufficient) {
      setCreditError({
        creditsRemaining: creditCheck.creditsRemaining,
        creditsRequired,
        currentPlan: creditCheck.currentPlan,
        featureType: 'background',
      });
      return [];
    }

    setGenerating(true);
    setProgress({ stage: 'preparing', progress: 10 });

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";

      setProgress({ stage: 'generating', progress: 30 });

      const response = await fetch(
        `${apiUrl}/api/templates/${templateId}/pages/${pageIndex}/backgrounds/magic-generate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            pageType: options.pageType || 'auto',
            customPrompt: options.customPrompt || '',
            oneOffInspirationUrl: options.oneOffInspirationUrl || null,
            applyToAll: options.applyToAll || false,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        // Handle insufficient credits from server (fallback)
        if (response.status === 403 && errorData.error === 'insufficient_credits') {
          setCreditError({
            creditsRemaining: errorData.credits_remaining ?? 0,
            creditsRequired: errorData.credits_required ?? creditsRequired,
            currentPlan: errorData.current_plan ?? 'freelancer',
            featureType: 'background',
          });
          return [];
        }

        throw new Error(errorData.detail || errorData.message || errorData.error || `Failed to generate background: ${response.status}`);
      }

      setProgress({ stage: 'finalizing', progress: 90 });

      const data = await response.json();

      setProgress({ stage: 'complete', progress: 100 });

      const results = data.results || [];

      // Refresh gallery after generation
      if (templateId) {
        fetchSavedBackgrounds(templateId);
      }

      return results;
    } catch (error: any) {
      console.error('[MAGIC_BG] Generation error:', error);
      throw error;
    } finally {
      setGenerating(false);
      setTimeout(() => setProgress(null), 1000);
    }
  };

  const fetchSavedBackgrounds = useCallback(async (templateId: string) => {
    if (!session?.access_token || !templateId) return;

    setLoadingGallery(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";

      const response = await fetch(
        `${apiUrl}/api/templates/${templateId}/magic-backgrounds`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      if (!response.ok) {
        // Don't throw - just set empty array to avoid blocking
        setSavedBackgrounds([]);
        return;
      }

      const data = await response.json();
      setSavedBackgrounds(data.backgrounds || []);
    } catch (error) {
      console.error('[MAGIC_BG_GALLERY] Error fetching saved backgrounds:', error);
      setSavedBackgrounds([]);
    } finally {
      setLoadingGallery(false);
    }
  }, [session?.access_token]);

  return {
    generateBackground,
    generating,
    progress,
    savedBackgrounds,
    loadingGallery,
    fetchSavedBackgrounds,
    creditError,
    clearCreditError,
  };
}

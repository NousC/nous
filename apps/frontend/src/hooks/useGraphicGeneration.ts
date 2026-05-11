/**
 * Hook for graphic generation logic
 * Handles API calls, progress tracking, and error handling
 */

import { useState, useCallback, useRef } from "react";
import { useAuth } from "./useAuth";
import { toast } from "sonner";
import { checkCredits, CreditError } from "./useCreditCheck";

export interface GraphicSettings {
  graphicType: 'graphic';
  language: string;
  levelOfDetail: 'concise' | 'normal';
  customInfo?: string;
  colors?: string; // Comma-separated color values (hex codes or color names)
}

interface GenerateGraphicOptions {
  modelId?: string;
  seed?: number;
  variation?: number;
  settings?: GraphicSettings;
  retryAttempt?: number;
  placeholderBlockId?: string; // ID of the placeholder block to update
}

interface GenerationProgress {
  stage: 'analysis' | 'generation' | 'optimization' | 'complete';
  progress: number;
}

export function useGraphicGeneration() {
  const { session } = useAuth();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [creditError, setCreditError] = useState<CreditError | null>(null);
  const generatingRef = useRef(false); // Guard against concurrent calls

  const clearCreditError = useCallback(() => setCreditError(null), []);

  const generateGraphic = useCallback(async (
    templateId: string,
    blockId: string,
    options: GenerateGraphicOptions = {}
  ) => {
    console.log('\n========== [FRONTEND] GRAPHIC GENERATION STARTED ==========');
    console.log('[FRONTEND] Timestamp:', new Date().toISOString());
    console.log('[FRONTEND] Template ID:', templateId);
    console.log('[FRONTEND] Block ID:', blockId);
    console.log('[FRONTEND] Options:', options);
    console.log('[FRONTEND] Already generating?', generatingRef.current);

    // Guard against concurrent calls
    if (generatingRef.current) {
      console.warn('[FRONTEND] ⚠ Generation already in progress, ignoring duplicate call');
      return null;
    }

    if (!session?.access_token) {
      console.error('[FRONTEND] ✗ No session or access token available');
      console.error('[FRONTEND] Session:', session ? 'exists but no token' : 'null');
      toast.error("Please sign in to generate graphics");
      return null;
    }

    // Pre-flight credit check (15 credits for graphic generation)
    const creditCheck = await checkCredits(session.access_token, 15);
    if (!creditCheck.sufficient) {
      setCreditError({
        creditsRemaining: creditCheck.creditsRemaining,
        creditsRequired: 15,
        currentPlan: creditCheck.currentPlan,
        featureType: 'graphic',
      });
      return null;
    }

    console.log('[FRONTEND] ✓ Session and token available');
    generatingRef.current = true;
    setIsGenerating(true);
    setGenerationError(null);
    setGenerationProgress({ stage: 'analysis', progress: 10 });

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";

      console.log('[FRONTEND] API URL:', apiUrl);
      console.log('[FRONTEND] Starting generation:', { templateId, blockId, modelId: options.modelId });

      // Update progress
      setGenerationProgress({ stage: 'generation', progress: 30 });

      const requestBody = {
        modelId: options.modelId || 'gemini-3-pro-image-preview',
        seed: options.seed,
        variation: options.variation,
        settings: options.settings,
        placeholderBlockId: options.placeholderBlockId, // Pass placeholder ID so backend can update it
      };
      console.log('[FRONTEND] Request body:', requestBody);
      console.log('[FRONTEND] Making fetch request...');

      // Add timeout to prevent hanging (5 minutes for image generation)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.error('[FRONTEND] ✗ Request timeout after 5 minutes');
        controller.abort();
      }, 5 * 60 * 1000); // 5 minutes

      let response;
      try {
        response = await fetch(
          `${apiUrl}/api/templates/${templateId}/blocks/${blockId}/generate-graphic`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          throw new Error('Request timed out after 5 minutes. Please try again.');
        }
        throw fetchError;
      }

      console.log('[FRONTEND] Response received');
      console.log('[FRONTEND] Response status:', response.status);
      console.log('[FRONTEND] Response ok:', response.ok);

      if (!response.ok) {
        console.error('[FRONTEND] ✗ Response not OK');
        let errorData;
        try {
          const text = await response.text();
          console.error('[FRONTEND] Error response text:', text);
          errorData = JSON.parse(text);
        } catch (e) {
          errorData = { error: 'Unknown error', detail: `Status ${response.status}` };
        }
        console.error('[FRONTEND] API error data:', errorData);

        // Handle auth errors (401 only)
        if (response.status === 401) {
          const errorMessage = "Session expired. Please refresh the page and try again.";
          console.error('[FRONTEND] ✗ Auth error:', errorMessage);
          setGenerationError(errorMessage);
          toast.error(errorMessage);
          return null;
        }

        // Handle insufficient credits (403)
        if (response.status === 403 && errorData.error === 'insufficient_credits') {
          console.error('[FRONTEND] ✗ Insufficient credits');
          setCreditError({
            creditsRemaining: errorData.credits_remaining ?? 0,
            creditsRequired: errorData.credits_required ?? 15,
            currentPlan: errorData.current_plan ?? 'freelancer',
            featureType: 'graphic',
          });
          return null;
        }

      const errorMessage = errorData.detail || errorData.error || `Failed to generate graphic (${response.status})`;
      console.error('[FRONTEND] ✗ Throwing error:', errorMessage);

      // Check error message for model failures that should trigger fallback
      // Server returns 500, not 503, so we check the error message instead
      const currentModelId = options.modelId || 'gemini-3-pro-image-preview';
      const errorText = (errorData.detail || errorData.error || errorMessage || "").toLowerCase();
      const isModelOverloaded = errorText.includes("overloaded") || errorText.includes("503");
      const isRateLimited = errorText.includes("rate limit") || errorText.includes("429") || errorText.includes("quota");
      const isGeminiModel = currentModelId.includes("gemini") || errorText.includes("gemini");
      const isNotGrokFlux = !currentModelId.includes("grok-flux");
      const hasNotRetried = !(options.retryAttempt && options.retryAttempt > 0);

      // If Gemini fails (overloaded, rate limited, etc.) and we haven't retried yet, fallback to Grok-FLUX
      if ((isModelOverloaded || isRateLimited) && isGeminiModel && isNotGrokFlux && hasNotRetried) {
        const fallbackModelId = "grok-flux";
        console.warn('[FRONTEND] Gemini model failed, retrying with fallback model:', fallbackModelId);
        const reason = isModelOverloaded ? "overloaded" : "rate limited";
        toast.info(`Gemini 3 Pro is ${reason} right now. Trying Grok-FLUX as a fallback.`);
        return generateGraphic(templateId, blockId, {
          ...options,
          modelId: fallbackModelId,
          retryAttempt: (options.retryAttempt || 0) + 1,
        });
      }

      throw new Error(errorMessage);
      }

      console.log('[FRONTEND] ✓ Response OK, parsing JSON...');
      setGenerationProgress({ stage: 'optimization', progress: 80 });

      const data = await response.json();
      console.log('[FRONTEND] ✓ Data received:', {
        graphicVersionId: data.graphicVersionId,
        imageUrl: data.imageUrl ? 'present' : 'missing',
        modelName: data.modelName,
      });

      setGenerationProgress({ stage: 'complete', progress: 100 });

      // Small delay to show completion
      await new Promise(resolve => setTimeout(resolve, 500));

      console.log('[FRONTEND] ========== GENERATION SUCCESS ==========\n');
      return data;
    } catch (error: any) {
      console.error('\n========== [FRONTEND] ERROR ==========');
      console.error('[FRONTEND] Error type:', error?.constructor?.name);
      console.error('[FRONTEND] Error message:', error?.message);
      console.error('[FRONTEND] Error stack:', error?.stack);

      // Check for network errors
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        console.error('[FRONTEND] ✗ Network error - server may be unreachable');
        const networkError = "Network error: Unable to connect to server. Please check your connection.";
        setGenerationError(networkError);
        toast.error(networkError);
      } else if (error.message?.includes('timeout') || error.message?.includes('aborted')) {
        console.error('[FRONTEND] ✗ Request timeout');
        const timeoutError = "Request timed out. The server may be taking too long to respond.";
        setGenerationError(timeoutError);
        toast.error(timeoutError);
      } else {
        setGenerationError(error.message || "Failed to generate graphic");
        toast.error(error.message || "Failed to generate graphic");
      }

      console.error('[FRONTEND] ====================================\n');
      return null;
    } finally {
      generatingRef.current = false;
      setIsGenerating(false);
      setGenerationProgress(null);
    }
  }, [session]);

  const regenerateGraphic = useCallback(async (
    templateId: string,
    graphicVersionId: string,
    options: GenerateGraphicOptions = {}
  ) => {
    if (!session?.access_token) {
      toast.error("Authentication required");
      return null;
    }

    setIsGenerating(true);
    setGenerationError(null);
    setGenerationProgress({ stage: 'generation', progress: 50 });

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";

      const response = await fetch(
        `${apiUrl}/api/templates/${templateId}/graphics/${graphicVersionId}/regenerate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            modelId: options.modelId,
            seed: options.seed,
            variation: options.variation,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.detail || errorData.error || `Failed to regenerate graphic (${response.status})`;
        throw new Error(errorMessage);
      }

      setGenerationProgress({ stage: 'optimization', progress: 80 });

      const data = await response.json();

      setGenerationProgress({ stage: 'complete', progress: 100 });

      await new Promise(resolve => setTimeout(resolve, 500));

      return data;
    } catch (error: any) {
      console.error('[GRAPHIC_REGENERATION] Error:', error);
      setGenerationError(error.message || "Failed to regenerate graphic");
      toast.error(error.message || "Failed to regenerate graphic");
      return null;
    } finally {
      setIsGenerating(false);
      setGenerationProgress(null);
    }
  }, [session]);

  const reset = useCallback(() => {
    setIsGenerating(false);
    setGenerationProgress(null);
    setGenerationError(null);
  }, []);

  return {
    generateGraphic,
    regenerateGraphic,
    isGenerating,
    generationProgress,
    generationError,
    creditError,
    clearCreditError,
    reset,
  };
}

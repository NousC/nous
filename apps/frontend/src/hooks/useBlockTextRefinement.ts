/**
 * Hook for refining/improving text in template blocks
 * Uses Claude Haiku for fast text refinement
 */

import { useState, useCallback, useRef } from "react";
import { useAuth } from "./useAuth";

interface RefineTextOptions {
  language?: string;
  userInstruction?: string;
}

interface RefinementResult {
  refinedText: string;
  originalText: string;
}

export function useBlockTextRefinement() {
  const { session } = useAuth();
  const [isRefining, setIsRefining] = useState(false);
  const [refiningBlockId, setRefiningBlockId] = useState<string | null>(null);
  const [refinementError, setRefinementError] = useState<string | null>(null);
  const refiningRef = useRef(false); // Guard against concurrent calls
  const sessionRef = useRef(session); // Keep fresh reference to session

  // Update session ref when session changes
  sessionRef.current = session;

  const refineBlockText = useCallback(async (
    templateId: string,
    blockId: string,
    originalText: string,
    blockType: string,
    options: RefineTextOptions = {}
  ): Promise<RefinementResult | null> => {
    // Use ref to get latest session value
    const currentSession = sessionRef.current;

    console.log('[REFINE_TEXT] Starting refinement:', { templateId, blockId, blockType, textLength: originalText?.length });
    console.log('[REFINE_TEXT] Session available:', !!currentSession?.access_token);

    // Guard against concurrent calls
    if (refiningRef.current) {
      console.warn('[REFINE_TEXT] Refinement already in progress');
      return null;
    }

    if (!currentSession?.access_token) {
      console.error('[REFINE_TEXT] No session/access token');
      setRefinementError("Please sign in to refine text");
      return null;
    }

    if (!originalText || originalText.trim().length === 0) {
      console.error('[REFINE_TEXT] No text to refine');
      setRefinementError("No text to refine");
      return null;
    }

    refiningRef.current = true;
    setIsRefining(true);
    setRefiningBlockId(blockId);
    setRefinementError(null);

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      console.log('[REFINE_TEXT] API URL:', apiUrl);
      console.log('[REFINE_TEXT] Making request to:', `${apiUrl}/api/templates/${templateId}/blocks/${blockId}/refine-text`);

      const response = await fetch(
        `${apiUrl}/api/templates/${templateId}/blocks/${blockId}/refine-text`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${currentSession.access_token}`,
          },
          body: JSON.stringify({
            originalText,
            blockType,
            language: options.language,
            userInstruction: options.userInstruction,
          }),
        }
      );

      console.log('[REFINE_TEXT] Response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[REFINE_TEXT] Error response:', errorData);
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }

      const data = await response.json();
      console.log('[REFINE_TEXT] Success! Refined text length:', data.refinedText?.length);

      return {
        refinedText: data.refinedText,
        originalText: data.originalText || originalText,
      };
    } catch (err) {
      console.error('[REFINE_TEXT_ERROR]', err);
      setRefinementError("Failed to refine text");
      return null;
    } finally {
      refiningRef.current = false;
      setIsRefining(false);
      setRefiningBlockId(null);
    }
  }, []); // Remove session dependency - we use ref now

  const clearError = useCallback(() => {
    setRefinementError(null);
  }, []);

  return {
    refineBlockText,
    isRefining,
    refiningBlockId,
    refinementError,
    clearError,
  };
}

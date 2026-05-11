/**
 * Hook for graphics gallery with pagination and lazy loading
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./useAuth";

interface Graphic {
  id: string;
  title: string;
  image_url: string;
  thumbnail_url: string;
  model_name: string;
  created_at: string;
  seed?: number;
  prompt_used?: any; // Stage 1 analysis data
}

interface GraphicsGalleryData {
  graphics: Graphic[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export function useGraphicsGallery(templateId: string | undefined) {
  const { session } = useAuth();
  const [graphics, setGraphics] = useState<Graphic[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);

  const fetchGraphics = useCallback(async (pageNum: number = 1, append: boolean = false) => {
    if (!templateId || !session?.access_token) {
      return;
    }

    setLoading(true);

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(
        `${apiUrl}/api/templates/${templateId}/graphics?page=${pageNum}&limit=20`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch graphics: ${response.status}`);
      }

      const data: GraphicsGalleryData = await response.json();

      if (append) {
        setGraphics(prev => [...prev, ...data.graphics]);
      } else {
        setGraphics(data.graphics);
      }

      setPage(data.page);
      setHasMore(data.hasMore);
      setTotal(data.total);
    } catch (error) {
      console.error('[GRAPHICS_GALLERY] Error fetching graphics:', error);
    } finally {
      setLoading(false);
    }
  }, [templateId, session]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      fetchGraphics(page + 1, true);
    }
  }, [page, hasMore, loading, fetchGraphics]);

  const refresh = useCallback(() => {
    setPage(1);
    setGraphics([]);
    fetchGraphics(1, false);
  }, [fetchGraphics]);

  useEffect(() => {
    if (templateId) {
      fetchGraphics(1, false);
    }
  }, [templateId]); // Only depend on templateId, fetchGraphics is stable

  return {
    graphics,
    loading,
    hasMore,
    total,
    loadMore,
    refresh,
  };
}


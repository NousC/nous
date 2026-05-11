/**
 * Video URL parsing utilities for embedding videos from various platforms.
 * Supports YouTube, Vimeo, Loom, and Tella.
 */

export interface ParsedVideoUrl {
  embedUrl: string;
  platform: string;
  thumbnailUrl?: string;
}

/**
 * Parse a video URL and return the embed URL and platform information.
 */
export function parseVideoUrl(url: string): ParsedVideoUrl | null {
  if (!url || !url.trim()) return null;

  const trimmedUrl = url.trim();

  // YouTube
  // https://www.youtube.com/watch?v=VIDEO_ID
  // https://youtu.be/VIDEO_ID
  // https://www.youtube.com/embed/VIDEO_ID
  const youtubeWatchMatch = trimmedUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);
  if (youtubeWatchMatch) {
    const videoId = youtubeWatchMatch[1];
    return {
      embedUrl: `https://www.youtube.com/embed/${videoId}`,
      platform: "YouTube",
      thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    };
  }

  // Tella
  // https://tella.tv/video/VIDEO_ID
  // https://www.tella.tv/video/VIDEO_ID
  const tellaMatch = trimmedUrl.match(/(?:www\.)?tella\.tv\/video\/([a-zA-Z0-9_-]+)/);
  if (tellaMatch) {
    return {
      embedUrl: `https://www.tella.tv/video/${tellaMatch[1]}/embed`,
      platform: "Tella",
    };
  }

  // Loom
  // https://www.loom.com/share/VIDEO_ID
  const loomMatch = trimmedUrl.match(/loom\.com\/share\/([a-zA-Z0-9_-]+)/);
  if (loomMatch) {
    const videoId = loomMatch[1];
    return {
      embedUrl: `https://www.loom.com/embed/${videoId}`,
      platform: "Loom",
      thumbnailUrl: `https://cdn.loom.com/sessions/thumbnails/${videoId}-with-play.gif`,
    };
  }

  // Vimeo
  // https://vimeo.com/VIDEO_ID
  // https://player.vimeo.com/video/VIDEO_ID
  const vimeoMatch = trimmedUrl.match(/(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d+)/);
  if (vimeoMatch) {
    return {
      embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}`,
      platform: "Vimeo",
    };
  }

  // If it's already an embed URL, return as-is
  if (trimmedUrl.includes('/embed/') || trimmedUrl.includes('player.vimeo.com')) {
    return {
      embedUrl: trimmedUrl,
      platform: "Unknown",
    };
  }

  return null;
}

/**
 * Get a video thumbnail URL for display in cards/lists.
 * Returns a platform-specific thumbnail or null.
 */
export function getVideoThumbnail(url: string): string | null {
  const parsed = parseVideoUrl(url);
  return parsed?.thumbnailUrl || null;
}

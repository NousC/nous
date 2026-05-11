/**
 * JSONB Update Utilities
 *
 * Efficient utilities for updating page_backgrounds JSONB column
 * Uses jsonb_set for partial updates instead of full object replacement
 */

import { supabase } from "@/lib/supabase";
import { PageBackgroundSettings, PageBackgroundsMap, PageLayoutSettings, PageLayoutsMap } from "@/types/template";

/**
 * Calculate theme_type (dark or light) from a hex color
 * Uses luminance calculation matching server-side isColorDark() function
 * @param hexColor - Hex color string (e.g., "#ffffff" or "#000")
 * @returns 'dark' if the color is dark (needs white text), 'light' if bright (needs dark text)
 */
export function calculateThemeTypeFromColor(hexColor: string | null): 'dark' | 'light' {
  if (!hexColor) return 'light';

  // Remove # if present
  const hex = hexColor.replace('#', '');

  // Handle both 3 and 6 character hex codes
  let r: number, g: number, b: number;
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (hex.length === 6) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else {
    return 'light'; // Invalid hex, default to light
  }

  // Calculate perceived luminance using the standard formula
  // Values: 0.299, 0.587, 0.114 approximate human eye sensitivity
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // If luminance is below 0.5, the color is "dark" and needs white text
  return luminance < 0.5 ? 'dark' : 'light';
}

/**
 * Get background settings for a specific page with fallback logic
 * @param pageBackgrounds - The page_backgrounds JSONB object
 * @param pageIndex - The page index (0-based)
 * @returns PageBackgroundSettings with fallback chain
 */
export function getPageBackground(
  pageBackgrounds: PageBackgroundsMap | null | undefined,
  pageIndex: number
): PageBackgroundSettings {
  const pageKey = pageIndex.toString();
  
  // First check page-specific background entry
  if (pageBackgrounds?.[pageKey]) {
    return pageBackgrounds[pageKey];
  }
  
  // Default fallback - return clear background (white, no image)
  return {
    background_image: null,
    background_color: null,
    background_image_opacity: 1.0,
  };
}

/**
 * Get the explicit background entry for a page without falling back to other pages.
 */
export function getExplicitPageBackground(
  pageBackgrounds: PageBackgroundsMap | null | undefined,
  pageIndex: number
): PageBackgroundSettings | null {
  const pageKey = pageIndex.toString();
  return pageBackgrounds?.[pageKey] ?? null;
}

/**
 * Update page background using efficient jsonb_set
 * This uses a server-side RPC function or direct SQL update
 * @param templateId - Template ID
 * @param pageIndex - Page index (0-based)
 * @param settings - Background settings to set
 * @returns Promise that resolves when update completes
 */
export async function updatePageBackground(
  templateId: string,
  pageIndex: number,
  settings: PageBackgroundSettings
): Promise<void> {
  const pageKey = pageIndex.toString();

  // Auto-calculate theme_type from background_color if color is set and theme_type isn't provided
  // This ensures font colors can be correctly determined for solid color backgrounds
  const settingsWithTheme: PageBackgroundSettings = { ...settings };
  if (settings.background_color && !settings.theme_type) {
    settingsWithTheme.theme_type = calculateThemeTypeFromColor(settings.background_color);
  }

  // Use Supabase RPC to call jsonb_set efficiently
  // First, try to use a direct update with jsonb_set
  // Since Supabase client doesn't support jsonb_set directly, we'll use a workaround:
  // 1. Get current page_backgrounds
  // 2. Update the object in memory
  // 3. Update with the new object
  //
  // For true jsonb_set, we'd need a server-side endpoint, but for now this works

  const { data: current, error: fetchError } = await supabase
    .from("template_settings")
    .select("page_backgrounds")
    .eq("template_id", templateId)
    .single();

  if (fetchError && fetchError.code !== "PGRST116") {
    throw new Error(`Failed to fetch current settings: ${fetchError.message}`);
  }

  // Merge the new page background into existing page_backgrounds
  const currentPageBackgrounds = current?.page_backgrounds || {};
  const updatedPageBackgrounds = {
    ...currentPageBackgrounds,
    [pageKey]: settingsWithTheme,
  };
  
  // Update with merged object
  const { error: updateError } = await supabase
    .from("template_settings")
    .upsert({
      template_id: templateId,
      page_backgrounds: updatedPageBackgrounds,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'template_id'
    });
  
  if (updateError) {
    throw new Error(`Failed to update page background: ${updateError.message}`);
  }

  // NEW: If background_color was set, add it to used_colors
  if (settings.background_color) {
    try {
      await addUsedColor(templateId, settings.background_color);
    } catch (error) {
      console.warn('Failed to add background color to palette:', error);
      // Don't throw - this is non-critical
    }
  }
}

/**
 * Apply a background to a page with automatic theme detection
 * This calls the server endpoint which analyzes the image/color to determine theme_type
 * @param templateId - Template ID
 * @param pageIndex - Page index (0-based)
 * @param imageUrl - Background image URL (optional)
 * @param backgroundColor - Background color (optional)
 * @param backgroundSource - Source of the background (default: 'gallery')
 * @param accessToken - User's access token for authentication
 * @returns The applied background settings including theme_type
 */
export async function applyBackgroundWithThemeDetection(
  templateId: string,
  pageIndex: number,
  imageUrl: string | null,
  backgroundColor: string | null,
  backgroundSource: 'magic_ai' | 'upload' | 'color' | 'gallery' = 'gallery',
  accessToken: string
): Promise<PageBackgroundSettings> {
  const apiUrl = import.meta.env.VITE_API_URL ?? "";

  const response = await fetch(
    `${apiUrl}/api/templates/${templateId}/pages/${pageIndex}/backgrounds/apply`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        imageUrl,
        backgroundColor,
        backgroundSource,
      }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to apply background: ${response.status}`);
  }

  const data = await response.json();
  return data.background;
}

/**
 * Update multiple page backgrounds at once
 * @param templateId - Template ID
 * @param updates - Map of page index to settings
 */
export async function updateMultiplePageBackgrounds(
  templateId: string,
  updates: { [pageIndex: number]: PageBackgroundSettings }
): Promise<void> {
  const { data: current, error: fetchError } = await supabase
    .from("template_settings")
    .select("page_backgrounds")
    .eq("template_id", templateId)
    .single();

  if (fetchError && fetchError.code !== "PGRST116") {
    throw new Error(`Failed to fetch current settings: ${fetchError.message}`);
  }

  const currentPageBackgrounds = current?.page_backgrounds || {};
  const updatedPageBackgrounds = { ...currentPageBackgrounds };

  // Apply all updates with auto-calculated theme_type for colors
  for (const [pageIndex, settings] of Object.entries(updates)) {
    // Auto-calculate theme_type from background_color if color is set and theme_type isn't provided
    const settingsWithTheme: PageBackgroundSettings = { ...settings };
    if (settings.background_color && !settings.theme_type) {
      settingsWithTheme.theme_type = calculateThemeTypeFromColor(settings.background_color);
    }
    updatedPageBackgrounds[pageIndex.toString()] = settingsWithTheme;
  }
  
  const { error: updateError } = await supabase
    .from("template_settings")
    .upsert({
      template_id: templateId,
      page_backgrounds: updatedPageBackgrounds,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'template_id'
    });
  
  if (updateError) {
    throw new Error(`Failed to update page backgrounds: ${updateError.message}`);
  }
}

/**
 * Remove a page background and shift remaining backgrounds
 * @param templateId - Template ID
 * @param deletedPageIndex - Index of the deleted page (0-based)
 * @param totalPagesAfterDeletion - Total number of pages after deletion
 */
export async function removePageBackgroundAndShift(
  templateId: string,
  deletedPageIndex: number,
  totalPagesAfterDeletion: number
): Promise<void> {
  const { data: current, error: fetchError } = await supabase
    .from("template_settings")
    .select("page_backgrounds")
    .eq("template_id", templateId)
    .single();
  
  if (fetchError && fetchError.code !== "PGRST116") {
    throw new Error(`Failed to fetch current settings: ${fetchError.message}`);
  }
  
  const currentPageBackgrounds = current?.page_backgrounds || {};
  const updatedPageBackgrounds: PageBackgroundsMap = {};
  
  // Shift backgrounds: remove deleted page, shift pages after it down by 1
  Object.entries(currentPageBackgrounds).forEach(([key, value]) => {
    const idx = Number(key);
    if (idx === deletedPageIndex) {
      // Skip deleted page
      return;
    }
    if (idx > deletedPageIndex) {
      // Shift down by 1
      const newIndex = idx - 1;
      if (newIndex >= 0 && newIndex < totalPagesAfterDeletion) {
        updatedPageBackgrounds[newIndex.toString()] = value;
      }
    } else {
      // Keep as is
      updatedPageBackgrounds[key] = value;
    }
  });
  
  const { error: updateError } = await supabase
    .from("template_settings")
    .upsert({
      template_id: templateId,
      page_backgrounds: updatedPageBackgrounds,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'template_id'
    });
  
  if (updateError) {
    throw new Error(`Failed to update page backgrounds: ${updateError.message}`);
  }
}

/**
 * Check if a page has a custom background
 * @param pageBackgrounds - The page_backgrounds JSONB object
 * @param pageIndex - The page index (0-based)
 * @returns true if page has custom background
 */
export function hasCustomPageBackground(
  pageBackgrounds: PageBackgroundsMap | null | undefined,
  pageIndex: number
): boolean {
  const pageKey = pageIndex.toString();
  const pageBg = pageBackgrounds?.[pageKey];
  
  if (!pageBg) return false;
  
  // Has custom background if it has image or non-default color
  return !!(
    pageBg.background_image ||
    (pageBg.background_color && pageBg.background_color !== "#ffffff")
  );
}

/**
 * Get default page layout settings
 */
export function getDefaultPageLayout(): PageLayoutSettings {
  return {
    footer: {
      enabled: false,  // Footer OFF by default
      text: "",
      fontFamily: "Times New Roman",
      fontSize: 12,
      color: "#000000",
    },
    showPageNumbers: false,  // Page numbers OFF by default
    pageNumberFontFamily: "Times New Roman",
    pageNumberFontSize: 12,
    pageNumberColor: "#000000",
    // Show logo in footer (bottom-right corner)
    showLogo: false,  // Logo OFF by default
    // Default margins (equivalent to previous p-16 padding ~64px)
    marginTop: 64,
    marginRight: 64,
    marginBottom: 64,
    marginLeft: 64,
  };
}

/**
 * Get layout settings for a specific page with fallback logic
 * @param pageLayouts - The page_layouts JSONB object
 * @param pageIndex - The page index (0-based)
 * @returns PageLayoutSettings with fallback to default
 */
export function getPageLayout(
  pageLayouts: PageLayoutsMap | null | undefined,
  pageIndex: number
): PageLayoutSettings {
  const pageKey = pageIndex.toString();
  const defaultLayout = getDefaultPageLayout();
  
  // First check page-specific layout
  if (pageLayouts?.[pageKey]) {
    const pageLayout = pageLayouts[pageKey];
    // CRITICAL: Always merge with defaults to ensure all properties exist
    // This prevents errors when page layout has partial structure (e.g., only showPageNumbers, no footer)
    return {
      ...defaultLayout,
      ...pageLayout,
      // Ensure footer is always a complete object, even if pageLayout.footer is undefined or partial
      footer: {
        ...defaultLayout.footer,
        ...(pageLayout.footer || {}),
      },
      // Ensure other properties have defaults if missing
      showPageNumbers: pageLayout.showPageNumbers ?? defaultLayout.showPageNumbers,
      pageNumberFontFamily: pageLayout.pageNumberFontFamily || defaultLayout.pageNumberFontFamily,
      pageNumberFontSize: pageLayout.pageNumberFontSize ?? defaultLayout.pageNumberFontSize,
      pageNumberColor: pageLayout.pageNumberColor || defaultLayout.pageNumberColor,
      showLogo: pageLayout.showLogo ?? defaultLayout.showLogo,
    };
  }
  
  // For margins: always use defaults (don't inherit from page 0)
  // For footer/page numbers: can inherit from page 0 if it exists
  // If page 0 exists, merge its footer/page number settings but keep default margins
  if (pageLayouts?.["0"]) {
    const page0Layout = pageLayouts["0"];
    return {
      ...defaultLayout,
      // Inherit footer and page number settings from page 0, with fallback to defaults
      footer: {
        ...defaultLayout.footer,
        ...(page0Layout.footer || {}),
      },
      showPageNumbers: page0Layout.showPageNumbers ?? defaultLayout.showPageNumbers,
      pageNumberFontFamily: page0Layout.pageNumberFontFamily || defaultLayout.pageNumberFontFamily,
      pageNumberFontSize: page0Layout.pageNumberFontSize ?? defaultLayout.pageNumberFontSize,
      pageNumberColor: page0Layout.pageNumberColor || defaultLayout.pageNumberColor,
      showLogo: page0Layout.showLogo ?? defaultLayout.showLogo,
      // But use default margins (not page 0's margins)
      marginTop: defaultLayout.marginTop,
      marginRight: defaultLayout.marginRight,
      marginBottom: defaultLayout.marginBottom,
      marginLeft: defaultLayout.marginLeft,
    };
  }
  
  // Default fallback
  return defaultLayout;
}

/**
 * Update page layout using efficient jsonb_set pattern
 * @param templateId - Template ID
 * @param pageIndex - Page index (0-based)
 * @param settings - Layout settings to set
 * @returns Promise that resolves when update completes
 */
export async function updatePageLayout(
  templateId: string,
  pageIndex: number,
  settings: PageLayoutSettings
): Promise<void> {
  const pageKey = pageIndex.toString();
  
  const { data: current, error: fetchError } = await supabase
    .from("template_settings")
    .select("page_layouts")
    .eq("template_id", templateId)
    .single();
  
  if (fetchError && fetchError.code !== "PGRST116") {
    throw new Error(`Failed to fetch current settings: ${fetchError.message}`);
  }
  
  // Merge the new page layout into existing page_layouts
  const currentPageLayouts = current?.page_layouts || {};
  const updatedPageLayouts = {
    ...currentPageLayouts,
    [pageKey]: settings,
  };
  
  // Update with merged object
  const { error: updateError } = await supabase
    .from("template_settings")
    .upsert({
      template_id: templateId,
      page_layouts: updatedPageLayouts,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'template_id'
    });
  
  if (updateError) {
    throw new Error(`Failed to update page layout: ${updateError.message}`);
  }
}

/**
 * Update multiple page layouts at once
 * @param templateId - Template ID
 * @param updates - Map of page index to settings
 */
export async function updateMultiplePageLayouts(
  templateId: string,
  updates: { [pageIndex: number]: PageLayoutSettings }
): Promise<void> {
  const { data: current, error: fetchError } = await supabase
    .from("template_settings")
    .select("page_layouts")
    .eq("template_id", templateId)
    .single();
  
  if (fetchError && fetchError.code !== "PGRST116") {
    throw new Error(`Failed to fetch current settings: ${fetchError.message}`);
  }
  
  const currentPageLayouts = current?.page_layouts || {};
  const updatedPageLayouts = { ...currentPageLayouts };
  
  // Apply all updates
  for (const [pageIndex, settings] of Object.entries(updates)) {
    updatedPageLayouts[pageIndex.toString()] = settings;
  }
  
  const { error: updateError } = await supabase
    .from("template_settings")
    .upsert({
      template_id: templateId,
      page_layouts: updatedPageLayouts,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'template_id'
    });
  
  if (updateError) {
    throw new Error(`Failed to update page layouts: ${updateError.message}`);
  }
}

/**
 * Add a color to the used_colors array if it doesn't already exist
 * @param templateId - Template ID
 * @param color - Hex color code to add (e.g., "#000000")
 * @returns Promise that resolves when update completes
 */
export async function addUsedColor(
  templateId: string,
  color: string
): Promise<void> {
  // Normalize color to uppercase hex format
  const normalizedColor = color.startsWith("#") ? color.toUpperCase() : `#${color.toUpperCase()}`;
  
  // Ensure it's a valid hex color
  if (!/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(normalizedColor)) {
    console.warn(`Invalid color format: ${color}`);
    return;
  }
  
  // Normalize 3-digit hex to 6-digit
  let finalColor = normalizedColor;
  if (normalizedColor.length === 4) {
    const r = normalizedColor[1];
    const g = normalizedColor[2];
    const b = normalizedColor[3];
    finalColor = `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  
  const { data: current, error: fetchError } = await supabase
    .from("template_settings")
    .select("used_colors")
    .eq("template_id", templateId)
    .single();
  
  if (fetchError && fetchError.code !== "PGRST116") {
    throw new Error(`Failed to fetch current settings: ${fetchError.message}`);
  }
  
  // Get current used_colors array or default to empty
  const currentUsedColors = current?.used_colors || [];
  if (!Array.isArray(currentUsedColors)) {
    // If it's not an array (shouldn't happen, but be safe), reset to empty array
    console.warn("used_colors is not an array, resetting to empty array");
  }
  
  // Check if color already exists (case-insensitive)
  const existingIndex = Array.isArray(currentUsedColors) 
    ? currentUsedColors.findIndex((c: string) => c.toUpperCase() === finalColor.toUpperCase())
    : -1;
  
  let updatedUsedColors: string[];
  
  if (existingIndex >= 0) {
    // Color already exists - move it to the front (most recent)
    const colorsArray = [...currentUsedColors];
    colorsArray.splice(existingIndex, 1); // Remove from current position
    updatedUsedColors = [finalColor, ...colorsArray]; // Add to front
  } else {
    // New color - add to the front (most recent)
    updatedUsedColors = Array.isArray(currentUsedColors) 
      ? [finalColor, ...currentUsedColors]
      : [finalColor];
  }
  
  // Limit to max 8 colors (keep only the 8 most recent)
  if (updatedUsedColors.length > 8) {
    updatedUsedColors = updatedUsedColors.slice(0, 8);
  }
  
  // Update with merged array
  const { error: updateError } = await supabase
    .from("template_settings")
    .upsert({
      template_id: templateId,
      used_colors: updatedUsedColors,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'template_id'
    });
  
  if (updateError) {
    throw new Error(`Failed to update used colors: ${updateError.message}`);
  }
}

/**
 * Extract all unique colors from blocks and save them to used_colors
 * Useful when loading an existing template to populate the color picker
 * @param templateId - Template ID
 * @param blocks - Array of template blocks
 */
export async function extractAndSaveColorsFromBlocks(
  templateId: string,
  blocks: any[]
): Promise<void> {
  const colors = new Set<string>();
  
  // Extract colors from block styling and content
  blocks.forEach((block) => {
    // Check block-level styling
    if (block.styling?.color) {
      let color = block.styling.color;
      if (color.startsWith("#")) {
        colors.add(color.toUpperCase());
      } else if (color.startsWith("rgb")) {
        // Convert RGB to hex (basic conversion)
        const rgb = color.match(/\d+/g);
        if (rgb && rgb.length >= 3) {
          const r = parseInt(rgb[0]).toString(16).padStart(2, "0");
          const g = parseInt(rgb[1]).toString(16).padStart(2, "0");
          const b = parseInt(rgb[2]).toString(16).padStart(2, "0");
          colors.add(`#${r}${g}${b}`.toUpperCase());
        }
      }
    }
    
    // Check inline styles in HTML content
    if (block.content?.html) {
      const html = block.content.html;
      // Extract colors from style attributes in HTML
      const styleMatches = html.match(/color:\s*([^;]+)/gi);
      if (styleMatches) {
        styleMatches.forEach((match) => {
          const colorValue = match.replace(/color:\s*/i, "").trim();
          if (colorValue.startsWith("#")) {
            colors.add(colorValue.toUpperCase());
          } else if (colorValue.startsWith("rgb")) {
            const rgb = colorValue.match(/\d+/g);
            if (rgb && rgb.length >= 3) {
              const r = parseInt(rgb[0]).toString(16).padStart(2, "0");
              const g = parseInt(rgb[1]).toString(16).padStart(2, "0");
              const b = parseInt(rgb[2]).toString(16).padStart(2, "0");
              colors.add(`#${r}${g}${b}`.toUpperCase());
            }
          }
        });
      }
    }
  });
  
  // Normalize all colors (3-digit to 6-digit hex)
  const normalizedColors = Array.from(colors).map((color) => {
    if (color.length === 4) {
      const r = color[1];
      const g = color[2];
      const b = color[3];
      return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
    }
    return color.toUpperCase();
  });
  
  // If we found colors, update the database
  if (normalizedColors.length > 0) {
    const { data: current, error: fetchError } = await supabase
      .from("template_settings")
      .select("used_colors")
      .eq("template_id", templateId)
      .single();
    
    if (fetchError && fetchError.code !== "PGRST116") {
      console.warn("Failed to fetch current settings for color extraction:", fetchError.message);
      return;
    }
    
    const currentUsedColors = current?.used_colors || [];
    const existingColors = Array.isArray(currentUsedColors) 
      ? new Set(currentUsedColors.map((c: string) => c.toUpperCase()))
      : new Set<string>();
    
    // Merge new colors with existing ones
    normalizedColors.forEach((color) => {
      existingColors.add(color.toUpperCase());
    });
    
    // Merge: prioritize new colors (from blocks) first, then existing colors
    // This ensures extracted colors appear first (most recent)
    const newColorsArray = normalizedColors.filter(c => !existingColors.has(c.toUpperCase()));
    const existingColorsArray = Array.from(existingColors).filter(c => 
      !normalizedColors.some(nc => nc.toUpperCase() === c.toUpperCase())
    );
    const mergedColors = [...newColorsArray, ...existingColorsArray];
    
    // Limit to max 8 colors (keep only the 8 most recent/newest)
    const limitedColors = mergedColors.slice(0, 8);
    
    // Update database
    const { error: updateError } = await supabase
      .from("template_settings")
      .upsert({
        template_id: templateId,
        used_colors: limitedColors,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'template_id'
      });
    
    if (updateError) {
      console.warn("Failed to save extracted colors:", updateError.message);
    }
  }
}

/**
 * Extract background colors from page_backgrounds and add them to used_colors
 * @param templateId - Template ID
 * @param pageBackgrounds - The page_backgrounds JSONB object
 */
export async function extractAndAddBackgroundColors(
  templateId: string,
  pageBackgrounds: PageBackgroundsMap | null | undefined
): Promise<void> {
  if (!pageBackgrounds || typeof pageBackgrounds !== 'object') {
    return;
  }

  // Extract all background_color values
  const backgroundColors: string[] = [];
  Object.values(pageBackgrounds).forEach((pageBg) => {
    if (pageBg?.background_color) {
      backgroundColors.push(pageBg.background_color);
    }
  });

  // Add each unique color to used_colors
  for (const color of backgroundColors) {
    try {
      await addUsedColor(templateId, color);
    } catch (error) {
      console.warn(`Failed to add background color ${color} to palette:`, error);
      // Continue with other colors even if one fails
    }
  }
}


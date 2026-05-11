import { useState, useEffect, useRef } from "react";
import { Image, Loader2, Trash2, Upload, X, Edit2, Save, Sparkles, ChevronDown, ChevronRight, Camera, Palette, Grid3X3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { supabase } from "@/lib/supabase";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type BackgroundType = 'photographic' | 'visual' | 'pattern';

interface BackgroundInspiration {
  id: string;
  page_type: 'cover' | 'inner'; // Renamed from 'type'
  background_type: BackgroundType | null; // photographic, visual, pattern (conceptual + textural merged)
  title: string | null;
  tags: string[];
  category: string | null; // Whitepaper, Proposal, Report, Audit, Other Document Types
  style: string | null; // elegant, modern, creative, corporate, minimalistic
  colors: string[]; // Array of color names
  theme_type: string | null; // dark or light
  use_case: string | null; // Use case description
  image_url: string;
  storage_path: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface GroupedInspirations {
  'photographic': BackgroundInspiration[];
  'visual': BackgroundInspiration[];
  'pattern': BackgroundInspiration[];
  'uncategorized': BackgroundInspiration[];
}

interface BackgroundInspirationsPanelProps {
  onInspirationSelect?: (inspiration: BackgroundInspiration) => void;
}

// Background type display config (3 categories: photographic, visual, pattern)
const BACKGROUND_TYPE_CONFIG: Record<BackgroundType | 'uncategorized', { label: string; icon: React.ReactNode; description: string }> = {
  'photographic': { label: 'Photographic', icon: <Camera className="h-4 w-4" />, description: 'Real photos, photography-based imagery - used directly without AI' },
  'visual': { label: 'Visual', icon: <Palette className="h-4 w-4" />, description: 'Illustrations, bold graphics - AI generates variations with brand colors' },
  'pattern': { label: 'Pattern', icon: <Grid3X3 className="h-4 w-4" />, description: 'Geometric patterns, textures - recolored to brand colors' },
  'uncategorized': { label: 'Uncategorized', icon: <Image className="h-4 w-4" />, description: 'Not yet tagged with a background type' },
};

export function BackgroundInspirationsPanel({ onInspirationSelect }: BackgroundInspirationsPanelProps) {
  const { session } = useAuth();
  const [inspirations, setInspirations] = useState<GroupedInspirations>({
    'photographic': [],
    'visual': [],
    'pattern': [],
    'uncategorized': [],
  });

  // Collapsible section state
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    'photographic': true,
    'visual': true,
    'pattern': true,
    'uncategorized': true,
  });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [inspirationToDelete, setInspirationToDelete] = useState<BackgroundInspiration | null>(null);
  const [editingInspiration, setEditingInspiration] = useState<BackgroundInspiration | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editColors, setEditColors] = useState('');
  const [editCategory, setEditCategory] = useState<string>('none');
  const [editBackgroundType, setEditBackgroundType] = useState<string>('none');
  const [editStyle, setEditStyle] = useState<string>('none');
  const [editThemeType, setEditThemeType] = useState<string>('none');
  const [editActive, setEditActive] = useState(true);

  // Upload state (single image only - no pairs)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadPageType, setUploadPageType] = useState<string>('cover');
  const [uploadBackgroundType, setUploadBackgroundType] = useState<string>('none');
  const [uploadCategory, setUploadCategory] = useState<string>('none');
  const [uploadStyle, setUploadStyle] = useState<string>('none');
  const [uploadThemeType, setUploadThemeType] = useState<string>('none');
  const [uploadColors, setUploadColors] = useState<string>('');
  const [uploadTitle, setUploadTitle] = useState<string>('');
  const [uploadTags, setUploadTags] = useState<string>('');
  const uploadFileInputRef = useRef<HTMLInputElement>(null);
  
  // AI Generation state
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiPageType, setAiPageType] = useState<string>('cover');
  const [aiCategory, setAiCategory] = useState<string>('none');
  const [aiStyle, setAiStyle] = useState<string>('none');
  const [aiBackgroundType, setAiBackgroundType] = useState<string>('none');
  const [aiThemeType, setAiThemeType] = useState<string>('none');
  const [aiColors, setAiColors] = useState<string>('');
  const [aiTitle, setAiTitle] = useState<string>('');
  const [aiTags, setAiTags] = useState<string>('');
  const [aiReferenceImage, setAiReferenceImage] = useState<string | null>(null);
  const [aiReferenceImageUploading, setAiReferenceImageUploading] = useState(false);
  const [aiReferenceIsDragging, setAiReferenceIsDragging] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiGeneratedImage, setAiGeneratedImage] = useState<string | null>(null);
  const [aiGeneratedMetadata, setAiGeneratedMetadata] = useState<{style: string|null, colors: string[], themeType: string|null} | null>(null);
  const [aiSaving, setAiSaving] = useState(false);
  const aiReferenceImageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (session?.access_token) {
      loadInspirations();
    }
  }, [session?.access_token]);

  const loadInspirations = async () => {
    if (!session?.access_token) {
      console.log('[BG_INSPIRATIONS] No session token, skipping load');
      return;
    }

    setLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(
        `${apiUrl}/api/admin/background-inspirations`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || errorData.error || "Failed to load inspirations");
      }

      const data = await response.json();
      // Group inspirations by background_type (3 categories: photographic, visual, pattern)
      const grouped: GroupedInspirations = {
        'photographic': [],
        'visual': [],
        'pattern': [],
        'uncategorized': [],
      };

      // Handle both old format (grouped by category) and new format (flat array)
      const allInspirations: BackgroundInspiration[] = [];
      if (Array.isArray(data.inspirations)) {
        allInspirations.push(...data.inspirations);
      } else if (data.inspirations) {
        // Old format - flatten from category groups
        Object.values(data.inspirations).forEach((categoryGroup: any) => {
          if (Array.isArray(categoryGroup)) {
            allInspirations.push(...categoryGroup);
          }
        });
      }

      // Group by background_type - also handle legacy 'type' column
      allInspirations.forEach((insp: any) => {
        // Normalize page_type (handle legacy 'type' column)
        if (!insp.page_type && insp.type) {
          insp.page_type = insp.type;
        }
        const bgType = insp.background_type || 'uncategorized';
        if (grouped[bgType as keyof GroupedInspirations]) {
          grouped[bgType as keyof GroupedInspirations].push(insp);
        } else {
          grouped['uncategorized'].push(insp);
        }
      });

      setInspirations(grouped);
    } catch (error: any) {
      console.error("Error loading inspirations:", error);
      toast.error(error.message || "Failed to load inspirations");
      // Set empty grouped object on error so UI still renders
      setInspirations({
        'photographic': [],
        'visual': [],
        'pattern': [],
        'uncategorized': [],
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (file: File) => {
    if (!session?.access_token) return;

    setUploading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";

      // Upload image
      const formData = new FormData();
      formData.append('image', file);

      const uploadResponse = await fetch(
        `${apiUrl}/api/admin/background-inspirations/upload-image`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          body: formData,
        }
      );

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json().catch(() => ({}));
        throw new Error(errorData.detail || "Failed to upload image");
      }

      const uploadData = await uploadResponse.json();

      // Create inspiration record
      const createResponse = await fetch(
        `${apiUrl}/api/admin/background-inspirations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            page_type: 'cover',
            title: null,
            tags: [],
            category: null,
            background_type: null,
            imageUrl: uploadData.url,
            storagePath: uploadData.path,
          }),
        }
      );

      if (!createResponse.ok) {
        throw new Error("Failed to create inspiration");
      }

      toast.success("Inspiration uploaded successfully");
      await loadInspirations();
    } catch (error: any) {
      console.error("Error uploading inspiration:", error);
      toast.error(error.message || "Failed to upload inspiration");
    } finally {
      setUploading(false);
    }
  };

  // Handle file selection (click or input change)
  const handleFileSelection = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    setUploadFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setUploadPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelection(file);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileSelection(files[0]);
    }
  };

  // Single image upload handler
  const handleUploadSubmit = async () => {
    if (!uploadFile || !session?.access_token) {
      toast.error("Please select an image");
      return;
    }

    if (!uploadBackgroundType || uploadBackgroundType === 'none') {
      toast.error("Please select a background type");
      return;
    }

    if (!uploadThemeType || uploadThemeType === 'none') {
      toast.error("Please select a theme (light/dark)");
      return;
    }

    // Pattern requires colors for recoloring
    if (uploadBackgroundType === 'pattern' && !uploadColors.trim()) {
      toast.error("Please enter colors for the pattern");
      return;
    }

    setUploadingFile(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";

      // Upload image
      const formData = new FormData();
      formData.append('image', uploadFile);
      const uploadResponse = await fetch(
        `${apiUrl}/api/admin/background-inspirations/upload-image`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          body: formData,
        }
      );

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.json().catch(() => ({}));
        throw new Error(errorData.detail || "Failed to upload image");
      }

      const uploadData = await uploadResponse.json();

      // Parse colors from comma-separated string
      const colorsArray = uploadColors
        .split(',')
        .map(c => c.trim())
        .filter(c => c.length > 0);

      // Create inspiration record - log the data we're sending
      const requestBody = {
        page_type: uploadPageType,
        title: uploadTitle || null,
        tags: uploadTags.split(',').map(t => t.trim()).filter(t => t),
        category: uploadPageType === 'cover' && uploadCategory && uploadCategory !== 'none' ? uploadCategory : null,
        background_type: uploadBackgroundType && uploadBackgroundType !== 'none' ? uploadBackgroundType : null,
        style: uploadStyle && uploadStyle !== 'none' ? uploadStyle : null,
        themeType: uploadThemeType && uploadThemeType !== 'none' ? uploadThemeType : null,
        colors: colorsArray,
        imageUrl: uploadData.url,
        storagePath: uploadData.path,
      };
      console.log('[UPLOAD] Creating inspiration with:', requestBody);

      const createResponse = await fetch(
        `${apiUrl}/api/admin/background-inspirations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!createResponse.ok) {
        const errorData = await createResponse.json().catch(() => ({}));
        console.error('[UPLOAD] Server error:', errorData);
        throw new Error(errorData.detail || errorData.error || "Failed to create inspiration");
      }

      toast.success("Inspiration uploaded successfully");
      resetUploadForm();
      await loadInspirations();
    } catch (error: any) {
      console.error("Error uploading inspiration:", error);
      toast.error(error.message || "Failed to upload inspiration");
    } finally {
      setUploadingFile(false);
    }
  };

  const resetUploadForm = () => {
    setUploadDialogOpen(false);
    setUploadFile(null);
    setUploadPreview(null);
    setUploadPageType('cover');
    setUploadBackgroundType('none');
    setUploadCategory('none');
    setUploadStyle('none');
    setUploadThemeType('none');
    setUploadColors('');
    setUploadTitle('');
    setUploadTags('');
    if (uploadFileInputRef.current) {
      uploadFileInputRef.current.value = '';
    }
  };

  const handleDeleteClick = (inspiration: BackgroundInspiration, e: React.MouseEvent) => {
    e.stopPropagation();
    setInspirationToDelete(inspiration);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!inspirationToDelete || !session?.access_token) {
      toast.error("Unable to delete inspiration");
      setDeleteDialogOpen(false);
      setInspirationToDelete(null);
      return;
    }

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(
        `${apiUrl}/api/admin/background-inspirations/${inspirationToDelete.id}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to delete inspiration");
      }

      toast.success("Inspiration deleted");
      await loadInspirations();
    } catch (error: any) {
      console.error("Error deleting inspiration:", error);
      toast.error(error.message || "Failed to delete inspiration");
    } finally {
      setDeleteDialogOpen(false);
      setInspirationToDelete(null);
    }
  };

  const handleEditClick = (inspiration: BackgroundInspiration, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingInspiration(inspiration);
    setEditTitle(inspiration.title || '');
    setEditTags(inspiration.tags.join(', '));
    setEditColors(inspiration.colors?.join(', ') || '');
    setEditCategory(inspiration.category || 'none');
    setEditBackgroundType(inspiration.background_type || 'none');
    setEditStyle(inspiration.style || 'none');
    setEditThemeType(inspiration.theme_type || 'none');
    setEditActive(inspiration.active);
  };

  const handleSaveEdit = async () => {
    if (!editingInspiration || !session?.access_token) return;

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(
        `${apiUrl}/api/admin/background-inspirations/${editingInspiration.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            title: editTitle || null,
            tags: editTags.split(',').map(t => t.trim()).filter(t => t),
            colors: editColors.split(',').map(c => c.trim()).filter(c => c),
            category: editingInspiration.page_type === 'cover' && editCategory && editCategory !== 'none' ? editCategory : null,
            background_type: editBackgroundType && editBackgroundType !== 'none' ? editBackgroundType : null,
            style: editStyle && editStyle !== 'none' ? editStyle : null,
            themeType: editThemeType && editThemeType !== 'none' ? editThemeType : null,
            active: editActive,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to update inspiration");
      }

      toast.success("Inspiration updated");
      setEditingInspiration(null);
      await loadInspirations();
    } catch (error: any) {
      console.error("Error updating inspiration:", error);
      toast.error(error.message || "Failed to update inspiration");
    }
  };

  // Compress image client-side before upload - more aggressive compression
  const compressImage = (file: File, maxWidth: number = 1600, quality: number = 0.75): Promise<File> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = document.createElement('img');
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Resize if larger than maxWidth
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error('Failed to compress image'));
                return;
              }
              const compressedFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now(),
              });
              resolve(compressedFile);
            },
            'image/jpeg',
            quality
          );
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  const handleAiReferenceImageUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(`Image is too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Please use an image smaller than 10MB.`);
      return;
    }

    if (!session?.access_token) {
      toast.error("Session not available");
      return;
    }

    setAiReferenceImageUploading(true);

    try {
      // Skip client-side compression - server will handle optimization much faster
      // This eliminates UI blocking and improves upload speed
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const formData = new FormData();
      formData.append("image", file); // Upload original file directly

      console.log(`[UPLOAD] Uploading ${(file.size / 1024).toFixed(0)}KB file...`);
      const startTime = Date.now();

      const response = await fetch(`${apiUrl}/api/admin/background-inspirations/upload-image`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
        // Removed timeout/abort signal for debugging - will add back once we confirm it works
      });

      const uploadTime = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`[UPLOAD] Upload completed in ${uploadTime}s`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.detail || errorData.error || `Upload failed (${response.status})`;
        
        if (response.status === 400 && errorData.detail?.includes('file_too_large')) {
          throw new Error('File is too large. Please use an image smaller than 10MB.');
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      
      if (!data?.url) {
        throw new Error('Upload succeeded but no URL was returned');
      }

      console.log(`[UPLOAD] Success! Image URL: ${data.url}`);
      setAiReferenceImage(data.url);
      toast.success('Reference image uploaded successfully');
    } catch (error: any) {
      console.error('[UPLOAD] Error uploading reference image:', error);
      
      if (error?.name === 'AbortError') {
        toast.error('Upload timed out after 30 seconds. The file may be too large or your connection is slow. Please try again or use a smaller image.');
      } else if (error.message?.includes('file_too_large')) {
        toast.error(error.message);
      } else if (error.message?.includes('Failed to fetch') || error.message?.includes('network')) {
        toast.error('Network error: Unable to connect to server. Please check your internet connection and try again.');
      } else {
        toast.error(error.message || 'Failed to upload image. Please try again.');
      }
    } finally {
      setAiReferenceImageUploading(false);
    }
  };

  const handleAiGenerate = async () => {
    if (!session?.access_token) return;
    if (!aiPrompt && !aiReferenceImage) {
      toast.error('Please provide a prompt or a reference image');
      return;
    }

    setAiGenerating(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      // Generate single image
      const response = await fetch(
        `${apiUrl}/api/admin/background-inspirations/generate-single`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            prompt: aiPrompt || '',
            pageType: aiPageType,
            referenceImageUrl: aiReferenceImage || null,
            style: aiStyle && aiStyle !== 'none' ? aiStyle : null,
            backgroundType: aiBackgroundType && aiBackgroundType !== 'none' ? aiBackgroundType : null,
            themeType: aiThemeType && aiThemeType !== 'none' ? aiThemeType : null,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || "Failed to generate background");
      }

      const data = await response.json();
      setAiGeneratedImage(data.imageUrl);
      // Store extracted metadata
      if (data.metadata) {
        setAiGeneratedMetadata(data.metadata);
      }
      toast.success('Background generated successfully');
    } catch (error: any) {
      console.error("Error generating background:", error);
      toast.error(error.message || "Failed to generate background");
    } finally {
      setAiGenerating(false);
    }
  };

  const handleAiSaveToInspirations = async () => {
    if (!aiGeneratedImage || !session?.access_token) return;

    setAiSaving(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";

      // Download the generated image
      const imageResponse = await fetch(aiGeneratedImage);
      const imageBlob = await imageResponse.blob();

      // Upload to storage
      const fileName = `admin-generated-${Date.now()}.webp`;
      const storagePath = `background-inspirations/${fileName}`;

      const uploadResult = await supabase.storage.from('template-images').upload(storagePath, imageBlob, {
        contentType: 'image/webp',
        upsert: false
      });

      if (uploadResult.error) {
        throw new Error('Failed to upload generated image');
      }

      // Get public URL
      const urlData = supabase.storage.from('template-images').getPublicUrl(storagePath);

      if (!urlData.data?.publicUrl) {
        throw new Error('Failed to get image URL');
      }

      // Parse colors from form
      const colorsArray = aiColors
        .split(',')
        .map(c => c.trim())
        .filter(c => c.length > 0);

      // Create inspiration record
      const createResponse = await fetch(
        `${apiUrl}/api/admin/background-inspirations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            page_type: aiPageType,
            title: aiTitle || null,
            tags: aiTags.split(',').map(t => t.trim()).filter(t => t),
            category: aiPageType === 'cover' && aiCategory && aiCategory !== 'none' ? aiCategory : null,
            background_type: aiBackgroundType && aiBackgroundType !== 'none' ? aiBackgroundType : null,
            style: aiGeneratedMetadata?.style || (aiStyle && aiStyle !== 'none' ? aiStyle : null),
            themeType: aiGeneratedMetadata?.themeType || (aiThemeType && aiThemeType !== 'none' ? aiThemeType : null),
            colors: aiGeneratedMetadata?.colors?.length ? aiGeneratedMetadata.colors : colorsArray,
            imageUrl: urlData.data.publicUrl,
            storagePath: storagePath,
          }),
        }
      );

      if (!createResponse.ok) {
        throw new Error("Failed to create inspiration");
      }

      toast.success("Background added to inspirations");
      resetAiForm();
      await loadInspirations();
    } catch (error: any) {
      console.error("Error saving generated background:", error);
      toast.error(error.message || "Failed to save background");
    } finally {
      setAiSaving(false);
    }
  };

  const resetAiForm = () => {
    setAiDialogOpen(false);
    setAiPrompt('');
    setAiPageType('cover');
    setAiCategory('none');
    setAiStyle('none');
    setAiBackgroundType('none');
    setAiThemeType('none');
    setAiColors('');
    setAiTitle('');
    setAiTags('');
    setAiReferenceImage(null);
    setAiGeneratedImage(null);
    setAiGeneratedMetadata(null);
    if (aiReferenceImageInputRef.current) {
      aiReferenceImageInputRef.current.value = '';
    }
  };

  // Drag and drop handlers for AI reference image
  const handleAiReferenceDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setAiReferenceIsDragging(true);
  };

  const handleAiReferenceDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setAiReferenceIsDragging(false);
  };

  const handleAiReferenceDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setAiReferenceIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await handleAiReferenceImageUpload(files[0]);
    }
  };

  const totalInspirations =
    inspirations['photographic'].length +
    inspirations['visual'].length +
    inspirations['pattern'].length +
    inspirations['uncategorized'].length;

  const toggleSection = (sectionKey: string) => {
    setOpenSections(prev => ({
      ...prev,
      [sectionKey]: !prev[sectionKey]
    }));
  };

  const renderBackgroundTypeSection = (bgType: BackgroundType | 'uncategorized', items: BackgroundInspiration[]) => {
    if (items.length === 0) return null;

    const config = BACKGROUND_TYPE_CONFIG[bgType];
    const isOpen = openSections[bgType];

    return (
      <Collapsible key={bgType} open={isOpen} onOpenChange={() => toggleSection(bgType)}>
        <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-muted/50 rounded-lg transition-colors">
          <div className="flex items-center gap-3">
            <div className="text-muted-foreground">
              {config.icon}
            </div>
            <div className="text-left">
              <h3 className="text-sm font-semibold text-foreground">
                {config.label}
              </h3>
              <p className="text-xs text-muted-foreground">
                {config.description}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {items.length}
            </Badge>
            {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3 pb-4">
          <div className="grid grid-cols-3 gap-3">
            {items.map((inspiration) => (
              <div
                key={inspiration.id}
                className="relative group"
              >
                <Card
                  className="cursor-pointer hover:border-primary/50 transition-colors relative"
                  onClick={() => onInspirationSelect?.(inspiration)}
                >
                  <CardContent className="p-0">
                    <div className="relative aspect-[4/5] overflow-hidden rounded-t-lg bg-muted/20">
                      <img
                        src={inspiration.image_url}
                        alt="Background inspiration"
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      {/* Metadata badges on hover */}
                      <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity flex flex-wrap gap-1">
                        {inspiration.page_type && (
                          <Badge variant="secondary" className="text-[10px] capitalize">
                            {inspiration.page_type}
                          </Badge>
                        )}
                        {inspiration.style && (
                          <Badge variant="outline" className="text-[10px] capitalize bg-background/80">
                            {inspiration.style}
                          </Badge>
                        )}
                      </div>
                      {/* Action buttons on hover */}
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                        {!inspiration.active && (
                          <Badge variant="destructive" className="text-xs">
                            Inactive
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 bg-background/90 backdrop-blur-sm hover:bg-primary/10"
                          onClick={(e) => handleEditClick(inspiration, e)}
                          title="Edit"
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 bg-background/90 backdrop-blur-sm hover:bg-destructive/10 hover:text-destructive"
                          onClick={(e) => handleDeleteClick(inspiration, e)}
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="p-2">
                      {inspiration.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {inspiration.tags.slice(0, 2).map((tag, i) => (
                            <Badge key={i} variant="outline" className="text-[10px] px-1 py-0">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <div className="w-full max-w-4xl min-h-[200px]">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wider font-medium text-muted-foreground">
            Background Inspirations
          </Label>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAiDialogOpen(true)}
              disabled={uploading || aiGenerating}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              AI Generate
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUploadDialogOpen(true)}
              disabled={uploading || uploadingFile}
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload
            </Button>
          </div>
        </div>

        <ScrollArea className="h-[500px]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !session?.access_token ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">Please log in to view inspirations</p>
            </div>
          ) : totalInspirations === 0 ? (
            <div className="text-center py-12">
              <Image className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
              <p className="text-sm text-muted-foreground mb-2">
                No inspirations yet
              </p>
              <p className="text-xs text-muted-foreground/70">
                Upload images or generate with AI to use as inspiration for AI background generation
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {renderBackgroundTypeSection('photographic', inspirations['photographic'])}
              {renderBackgroundTypeSection('visual', inspirations['visual'])}
              {renderBackgroundTypeSection('pattern', inspirations['pattern'])}
              {renderBackgroundTypeSection('uncategorized', inspirations['uncategorized'])}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editingInspiration} onOpenChange={(open) => !open && setEditingInspiration(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Inspiration</DialogTitle>
            <DialogDescription>
              Update metadata for this {editBackgroundType !== 'none' ? editBackgroundType : ''} background.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Background Type - FIRST because it controls what other fields show */}
            <div className="space-y-2">
              <Label htmlFor="edit-background-type">Background Type *</Label>
              <Select value={editBackgroundType} onValueChange={setEditBackgroundType}>
                <SelectTrigger id="edit-background-type">
                  <SelectValue placeholder="Select background type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="photographic">
                    <div className="flex items-center gap-2">
                      <Camera className="h-4 w-4" />
                      <span>Photographic</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="pattern">
                    <div className="flex items-center gap-2">
                      <Grid3X3 className="h-4 w-4" />
                      <span>Pattern</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="visual">
                    <div className="flex items-center gap-2">
                      <Palette className="h-4 w-4" />
                      <span>Visual</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {editBackgroundType === 'photographic' && 'Real photos used directly as cover backgrounds'}
                {editBackgroundType === 'pattern' && 'Geometric patterns recolored to brand colors'}
                {editBackgroundType === 'visual' && 'Illustrations used as AI inspiration'}
                {editBackgroundType === 'none' && 'Select a type to see relevant options'}
              </p>
            </div>

            {/* Theme Type - always shown (important for all types) */}
            {editBackgroundType !== 'none' && (
              <div className="space-y-2">
                <Label>Theme (Light/Dark) *</Label>
                <Select value={editThemeType} onValueChange={setEditThemeType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select theme" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light Theme</SelectItem>
                    <SelectItem value="dark">Dark Theme</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Colors - for Pattern (required) and Visual (optional) */}
            {(editBackgroundType === 'pattern' || editBackgroundType === 'visual') && (
              <div className="space-y-2">
                <Label htmlFor="edit-colors">
                  Colors {editBackgroundType === 'pattern' ? '*' : '(optional)'}
                </Label>
                <Input
                  id="edit-colors"
                  value={editColors}
                  onChange={(e) => setEditColors(e.target.value)}
                  placeholder="e.g., blue, purple, navy"
                />
                <p className="text-xs text-muted-foreground">
                  {editBackgroundType === 'pattern'
                    ? 'Used for filtering and recoloring to brand colors'
                    : 'Helps AI understand the color palette'}
                </p>
              </div>
            )}

            {/* Design Style - only for Visual */}
            {editBackgroundType === 'visual' && (
              <div className="space-y-2">
                <Label>Design Style</Label>
                <Select value={editStyle} onValueChange={setEditStyle}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select style" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Any Style</SelectItem>
                    <SelectItem value="elegant">Elegant</SelectItem>
                    <SelectItem value="modern">Modern</SelectItem>
                    <SelectItem value="creative">Creative</SelectItem>
                    <SelectItem value="corporate">Corporate</SelectItem>
                    <SelectItem value="minimalistic">Minimalistic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Title - only for Visual */}
            {editBackgroundType === 'visual' && (
              <div className="space-y-2">
                <Label htmlFor="edit-title">Title (optional)</Label>
                <Input
                  id="edit-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="e.g., Abstract Tech Waves"
                />
              </div>
            )}

            {/* Active toggle - always shown */}
            <div className="flex items-center justify-between pt-2 border-t">
              <div>
                <Label htmlFor="edit-active">Active</Label>
                <p className="text-xs text-muted-foreground">
                  Inactive inspirations won't appear in selection
                </p>
              </div>
              <Switch
                id="edit-active"
                checked={editActive}
                onCheckedChange={setEditActive}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingInspiration(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit}>
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Dialog with Drag and Drop */}
      <Dialog open={uploadDialogOpen} onOpenChange={(open) => {
        if (!open) resetUploadForm();
        else setUploadDialogOpen(true);
      }}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upload Background Inspiration</DialogTitle>
            <DialogDescription>
              Upload a background image with metadata to add to your inspiration library.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Image Upload with Drag and Drop */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Background Image *</Label>
              <input
                ref={uploadFileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileInputChange}
                className="hidden"
              />
              {uploadPreview ? (
                <div className="relative max-w-[250px] mx-auto aspect-[8.5/11] rounded-lg border-2 border-border overflow-hidden bg-muted/20">
                  <img
                    src={uploadPreview}
                    alt="Preview"
                    className="w-full h-full object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setUploadFile(null);
                      setUploadPreview(null);
                      if (uploadFileInputRef.current) {
                        uploadFileInputRef.current.value = '';
                      }
                    }}
                    className="absolute top-2 right-2 p-1 bg-background/90 backdrop-blur-sm rounded-full hover:bg-background transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => uploadFileInputRef.current?.click()}
                  className={`w-full h-40 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors ${
                    isDragging
                      ? 'border-primary bg-primary/5'
                      : 'border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/30'
                  }`}
                >
                  <Upload className={`h-8 w-8 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
                  <div className="text-center">
                    <p className={`text-sm font-medium ${isDragging ? 'text-primary' : 'text-muted-foreground'}`}>
                      {isDragging ? 'Drop image here' : 'Drag & drop or click to select'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      PNG, JPG, WebP up to 10MB
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Metadata Section */}
            <div className="border-t border-border pt-4 space-y-4">
              <h4 className="text-sm font-medium text-muted-foreground">Metadata</h4>

              {/* Background Type - FIRST because it controls what other fields show */}
              <div className="space-y-2">
                <Label htmlFor="upload-bg-type">Background Type *</Label>
                <Select value={uploadBackgroundType} onValueChange={(value) => {
                  setUploadBackgroundType(value);
                  // Auto-set page type for photographic (cover only)
                  if (value === 'photographic') {
                    setUploadPageType('cover');
                  }
                }}>
                  <SelectTrigger id="upload-bg-type">
                    <SelectValue placeholder="Select background type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="photographic">
                      <div className="flex items-center gap-2">
                        <Camera className="h-4 w-4" />
                        <span>Photographic</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="pattern">
                      <div className="flex items-center gap-2">
                        <Grid3X3 className="h-4 w-4" />
                        <span>Pattern</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="visual">
                      <div className="flex items-center gap-2">
                        <Palette className="h-4 w-4" />
                        <span>Visual</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                {/* Contextual description based on type */}
                <p className="text-xs text-muted-foreground">
                  {uploadBackgroundType === 'photographic' && 'Real photos used directly as cover backgrounds (no AI generation)'}
                  {uploadBackgroundType === 'pattern' && 'Geometric patterns recolored to match brand colors'}
                  {uploadBackgroundType === 'visual' && 'Illustrations used as AI inspiration for generating variations'}
                  {uploadBackgroundType === 'none' && 'Select a type to see relevant options'}
                </p>
              </div>

              {/* Page Type - only show for pattern and visual (photographic is always cover) */}
              {uploadBackgroundType !== 'photographic' && uploadBackgroundType !== 'none' && (
                <div className="space-y-2">
                  <Label>Page Type *</Label>
                  <Select value={uploadPageType} onValueChange={setUploadPageType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select page type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cover">Cover Page</SelectItem>
                      <SelectItem value="inner">Inner Page</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Theme Type - always shown (important for all types) */}
              {uploadBackgroundType !== 'none' && (
                <div className="space-y-2">
                  <Label>Theme (Light/Dark) *</Label>
                  <Select value={uploadThemeType} onValueChange={setUploadThemeType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select theme" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Light Theme</SelectItem>
                      <SelectItem value="dark">Dark Theme</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Colors - important for Pattern (filtering/recoloring), optional for Visual */}
              {(uploadBackgroundType === 'pattern' || uploadBackgroundType === 'visual') && (
                <div className="space-y-2">
                  <Label htmlFor="upload-colors">
                    Colors {uploadBackgroundType === 'pattern' ? '*' : '(optional)'}
                  </Label>
                  <Input
                    id="upload-colors"
                    value={uploadColors}
                    onChange={(e) => setUploadColors(e.target.value)}
                    placeholder="e.g., blue, purple, navy"
                  />
                  <p className="text-xs text-muted-foreground">
                    {uploadBackgroundType === 'pattern'
                      ? 'Used for filtering and recoloring to brand colors'
                      : 'Helps AI understand the color palette'}
                  </p>
                </div>
              )}

              {/* Design Style - only for Visual (AI uses it as reference) */}
              {uploadBackgroundType === 'visual' && (
                <div className="space-y-2">
                  <Label>Design Style</Label>
                  <Select value={uploadStyle} onValueChange={setUploadStyle}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select style" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Any Style</SelectItem>
                      <SelectItem value="elegant">Elegant</SelectItem>
                      <SelectItem value="modern">Modern</SelectItem>
                      <SelectItem value="creative">Creative</SelectItem>
                      <SelectItem value="corporate">Corporate</SelectItem>
                      <SelectItem value="minimalistic">Minimalistic</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Helps match this inspiration to user's design style preference
                  </p>
                </div>
              )}

              {/* Title - only for Visual (helps identify) */}
              {uploadBackgroundType === 'visual' && (
                <div className="space-y-2">
                  <Label htmlFor="upload-title">Title (optional)</Label>
                  <Input
                    id="upload-title"
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    placeholder="e.g., Abstract Tech Waves"
                  />
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => resetUploadForm()}
              disabled={uploadingFile}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUploadSubmit}
              disabled={
                !uploadFile ||
                uploadingFile ||
                !uploadBackgroundType ||
                uploadBackgroundType === 'none' ||
                !uploadThemeType ||
                uploadThemeType === 'none' ||
                (uploadBackgroundType === 'pattern' && !uploadColors.trim())
              }
            >
              {uploadingFile ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Generation Dialog */}
      <Dialog open={aiDialogOpen} onOpenChange={(open) => {
        if (!open) resetAiForm();
        else setAiDialogOpen(true);
      }}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate Background with AI</DialogTitle>
            <DialogDescription>
              Generate a background inspiration image. Fill in metadata and provide a prompt or reference image.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="ai-title">Title (Optional)</Label>
              <Input
                id="ai-title"
                value={aiTitle}
                onChange={(e) => setAiTitle(e.target.value)}
                placeholder="e.g., Modern Tech Gradient"
              />
            </div>

            {/* Page Type */}
            <div className="space-y-2">
              <Label>Page Type *</Label>
              <Select value={aiPageType} onValueChange={setAiPageType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select page type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cover">Cover Page</SelectItem>
                  <SelectItem value="inner">Inner Page</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Background Type */}
            <div className="space-y-2">
              <Label htmlFor="ai-bg-type">Background Type *</Label>
              <Select value={aiBackgroundType} onValueChange={setAiBackgroundType}>
                <SelectTrigger id="ai-bg-type">
                  <SelectValue placeholder="Select background type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (Uncategorized)</SelectItem>
                  <SelectItem value="photographic">Photographic (Real photos - used directly)</SelectItem>
                  <SelectItem value="visual">Visual (Illustrations - AI generates variations)</SelectItem>
                  <SelectItem value="pattern">Pattern (Geometric patterns - recolored to brand)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                This determines which gallery section the inspiration appears in
              </p>
            </div>

            {/* Two Column Layout for Selects */}
            <div className="grid grid-cols-2 gap-4">
              {/* Document Category (only for cover) */}
              {aiPageType === 'cover' && (
                <div className="space-y-2">
                  <Label>Document Category</Label>
                  <Select value={aiCategory} onValueChange={setAiCategory}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="Whitepaper">Whitepaper</SelectItem>
                      <SelectItem value="Document">Document (Proposals, Reports, etc.)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Style */}
              <div className="space-y-2">
                <Label>Design Style</Label>
                <Select value={aiStyle} onValueChange={setAiStyle}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select style" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="elegant">Elegant</SelectItem>
                    <SelectItem value="modern">Modern</SelectItem>
                    <SelectItem value="creative">Creative</SelectItem>
                    <SelectItem value="corporate">Corporate</SelectItem>
                    <SelectItem value="minimalistic">Minimalistic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Theme Type */}
            <div className="space-y-2">
              <Label>Theme Type</Label>
              <Select value={aiThemeType} onValueChange={setAiThemeType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select theme type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Colors */}
            <div className="space-y-2">
              <Label htmlFor="ai-colors">Colors (comma-separated)</Label>
              <Input
                id="ai-colors"
                value={aiColors}
                onChange={(e) => setAiColors(e.target.value)}
                placeholder="e.g., blue, white, navy"
              />
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label htmlFor="ai-tags">Tags (comma-separated)</Label>
              <Input
                id="ai-tags"
                value={aiTags}
                onChange={(e) => setAiTags(e.target.value)}
                placeholder="e.g., tech, gradient, professional"
              />
            </div>

            {/* Generation Prompt */}
            <div className="space-y-2 pt-2 border-t border-border">
              <Label className="text-sm font-medium">Generation Prompt</Label>
              <Textarea
                placeholder="e.g., Bold geometric patterns with vibrant blue gradients, professional and modern design, abstract shapes"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                rows={3}
                className="resize-none text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Describe the background you want the AI to generate
              </p>
            </div>

            {/* Reference Image Upload with Drag and Drop */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Reference Image (Optional)</Label>

              {aiReferenceImage ? (
                <div className="space-y-2">
                  <div className="relative w-full h-32 rounded-lg border-2 border-border overflow-hidden bg-muted">
                    <img
                      src={aiReferenceImage}
                      alt="Reference inspiration"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setAiReferenceImage(null);
                        if (aiReferenceImageInputRef.current) {
                          aiReferenceImageInputRef.current.value = '';
                        }
                      }}
                      className="absolute top-2 right-2 p-1 bg-background/90 backdrop-blur-sm rounded-full hover:bg-background transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={handleAiReferenceDragOver}
                  onDragLeave={handleAiReferenceDragLeave}
                  onDrop={handleAiReferenceDrop}
                  onClick={() => aiReferenceImageInputRef.current?.click()}
                  className={`w-full h-32 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors ${
                    aiReferenceIsDragging
                      ? 'border-primary bg-primary/5'
                      : 'border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/30'
                  }`}
                >
                  {aiReferenceImageUploading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  ) : (
                    <Upload className={`h-6 w-6 ${aiReferenceIsDragging ? 'text-primary' : 'text-muted-foreground'}`} />
                  )}
                  <p className={`text-sm ${aiReferenceIsDragging ? 'text-primary' : 'text-muted-foreground'}`}>
                    {aiReferenceImageUploading ? 'Uploading...' : aiReferenceIsDragging ? 'Drop image here' : 'Drag & drop or click'}
                  </p>
                </div>
              )}

              <input
                ref={aiReferenceImageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    await handleAiReferenceImageUpload(file);
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                The AI will use this image as a style reference for generation
              </p>
            </div>

            {/* Generated Preview */}
            {aiGeneratedImage && (
              <div className="space-y-2 pt-2 border-t border-border">
                <Label className="text-sm font-medium">Generated Background</Label>
                <div className="relative max-w-[300px] mx-auto aspect-[8.5/11] rounded-lg border-2 border-border overflow-hidden bg-muted">
                  <img
                    src={aiGeneratedImage}
                    alt="Generated background"
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>
            )}

            {/* Generate Button */}
            <div className="pt-2 border-t border-border">
              <Button
                type="button"
                onClick={handleAiGenerate}
                disabled={aiGenerating || (!aiPrompt && !aiReferenceImage)}
                className="w-full"
              >
                {aiGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate Background
                  </>
                )}
              </Button>
            </div>

            {/* Save Button */}
            {aiGeneratedImage && (
              <Button
                type="button"
                onClick={handleAiSaveToInspirations}
                disabled={aiSaving}
                className="w-full"
              >
                {aiSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Add to Inspirations
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Inspiration</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{inspirationToDelete?.title || 'this inspiration'}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setDeleteDialogOpen(false);
              setInspirationToDelete(null);
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useState, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ArrowRight, Upload, FileText, X, Loader2, Plus, Check, Sun, Moon, Globe, Paintbrush } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

interface AssetLibraryEntry {
  id: string;
  type: "document" | "url" | "research";
  title: string;
  file_path?: string;
  url?: string;
  status?: string;
  created_at?: string;
}

const DESIGN_STYLES = [
  { value: 'corporate', label: 'Corporate', description: 'Professional, clean, business-focused' },
  { value: 'creative', label: 'Creative', description: 'Bold, artistic, innovative' },
  { value: 'minimalist', label: 'Minimalist', description: 'Simple, clean, lots of whitespace' },
  { value: 'elegant', label: 'Elegant', description: 'Sophisticated, refined, premium' },
  { value: 'modern', label: 'Modern', description: 'Contemporary, fresh, trendy' },
];

interface AccountSetupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (workspaceId: string) => void;
  workspaceId: string;
  defaultWorkspaceName: string;
}

export function AccountSetupModal({
  open,
  onOpenChange,
  onComplete,
  workspaceId,
  defaultWorkspaceName,
}: AccountSetupModalProps) {
  const { session, refreshUserData } = useAuth();
  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [workspaceName, setWorkspaceName] = useState(defaultWorkspaceName || "");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ companyName?: string; websiteUrl?: string; workspaceName?: string }>({});

  // Design & brand preferences
  const [defaultLanguage, setDefaultLanguage] = useState('en');
  const [designStyle, setDesignStyle] = useState('corporate');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [secondaryColor, setSecondaryColor] = useState('#8b5cf6');
  const [colorMode, setColorMode] = useState<'accent' | 'consistent'>('accent');
  const [darkCoverStyle, setDarkCoverStyle] = useState<'secondary' | 'accents'>('secondary');

  // File upload state
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentTitle, setDocumentTitle] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [uploadedEntries, setUploadedEntries] = useState<AssetLibraryEntry[]>([]);
  // Pending files when no workspace exists yet
  const [pendingFiles, setPendingFiles] = useState<Array<{ file: File; title: string }>>([]);

  const validateForm = (): boolean => {
    const newErrors: typeof errors = {};

    if (!companyName.trim()) {
      newErrors.companyName = "Company name is required";
    }

    if (!websiteUrl.trim()) {
      newErrors.websiteUrl = "Website URL is required";
    } else if (!websiteUrl.match(/^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/.*)?$/i)) {
      newErrors.websiteUrl = "Please enter a valid website URL";
    }

    if (!workspaceName.trim()) {
      newErrors.workspaceName = "Workspace name is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size must be less than 10MB");
      return;
    }

    setSelectedFile(file);
    const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
    setDocumentTitle(fileNameWithoutExt);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileSelect(files);
    }
  };

  const handleFileUpload = async () => {
    if (!selectedFile) {
      toast.error('Please select a file first');
      return;
    }

    const titleToUse = documentTitle.trim() || selectedFile.name.replace(/\.[^/.]+$/, '');

    // If no workspace exists yet, store file as pending
    if (!workspaceId) {
      setPendingFiles(prev => [...prev, { file: selectedFile, title: titleToUse }]);
      toast.success(`${titleToUse} will be uploaded when setup completes`);
      setSelectedFile(null);
      setDocumentTitle('');
      return;
    }

    // Upload immediately if workspace exists
    setUploading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('title', titleToUse);
      formData.append('type', 'document');

      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/knowledge-base/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}` },
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        toast.success(`${data.entry?.title || titleToUse} added`);
        setUploadedEntries(prev => [...prev, data.entry]);
        setSelectedFile(null);
        setDocumentTitle('');
      } else {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || errorData.error || 'Failed to upload file');
      }
    } catch (error: any) {
      console.error('Error uploading file:', error);
      toast.error(`Failed to upload ${selectedFile.name}`);
    } finally {
      setUploading(false);
    }
  };

  // Upload pending files to a workspace
  const uploadPendingFiles = async (targetWorkspaceId: string) => {
    if (pendingFiles.length === 0) return;

    const apiUrl = import.meta.env.VITE_API_URL ?? '';

    for (const { file, title } of pendingFiles) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', title);
        formData.append('type', 'document');

        await fetch(`${apiUrl}/api/workspaces/${targetWorkspaceId}/knowledge-base/upload`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session?.access_token}` },
          body: formData,
        });
      } catch (error) {
        console.error('Error uploading pending file:', error);
      }
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!workspaceId || !session?.access_token) return;

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/knowledge-base/${entryId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        setUploadedEntries(prev => prev.filter(e => e.id !== entryId));
        toast.success('Entry removed');
      } else {
        throw new Error('Failed to delete entry');
      }
    } catch (error) {
      console.error('Error deleting entry:', error);
      toast.error('Failed to remove entry');
    }
  };

  const handleRemovePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  const scrapeWebsiteToWorkspace = async (normalizedUrl: string, targetWorkspaceId: string) => {
    if (!targetWorkspaceId || !session?.access_token) return;

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const response = await fetch(`${apiUrl}/api/workspaces/${targetWorkspaceId}/company-assets/url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          url: normalizedUrl,
          title: `${companyName.trim()} Website`,
        }),
      });

      if (response.ok) {
        console.log('Website scraping initiated successfully');
      } else {
        // Don't show error to user - scraping is best effort
        console.error('Website scraping failed:', await response.text());
      }
    } catch (error) {
      console.error('Error scraping website:', error);
    }
  };

  const handleContinue = async () => {
    if (!validateForm()) return;

    setSaving(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? '';

      // Normalize website URL
      let normalizedUrl = websiteUrl.trim();
      if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
        normalizedUrl = 'https://' + normalizedUrl;
      }

      const response = await fetch(`${apiUrl}/api/account-setup/complete`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          company_name: companyName.trim(),
          website_url: normalizedUrl,
          workspace_id: workspaceId || undefined,
          workspace_name: workspaceName.trim(),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const newWorkspaceId = data.workspace_id || workspaceId;

        // Upload any pending files to the workspace
        if (newWorkspaceId && pendingFiles.length > 0) {
          await uploadPendingFiles(newWorkspaceId);
        }

        // Scrape website in background (fire and forget) - use new workspace ID
        if (newWorkspaceId) {
          scrapeWebsiteToWorkspace(normalizedUrl, newWorkspaceId);
        }

        // Save design & brand preferences (non-blocking)
        if (newWorkspaceId) {
          // Brand theme
          fetch(`${apiUrl}/api/workspaces/${newWorkspaceId}/settings/brand-theme`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${session?.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              brand_theme: {
                theme,
                secondary_color: secondaryColor,
                color_mode: colorMode,
                dark_cover_style: darkCoverStyle,
              },
            }),
          }).catch((err) => console.warn('Failed to save brand theme:', err));

          // Design preferences
          fetch(`${apiUrl}/api/workspaces/${newWorkspaceId}/design-preferences`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${session?.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              design_style: designStyle,
              default_language: defaultLanguage,
            }),
          }).catch((err) => console.warn('Failed to save design preferences:', err));
        }

        // Refresh user data to get updated account_setup_completed_at
        await refreshUserData();
        toast.success('Account setup complete!');
        onComplete(newWorkspaceId);
      } else {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || errorData.error || 'Failed to save account setup');
      }
    } catch (error: any) {
      console.error('Error saving account setup:', error);
      toast.error(error.message || 'Failed to save account setup');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {/* Prevent closing */}}>
      <DialogContent
        className="sm:max-w-[520px] p-0 border-none shadow-[0_0_60px_-15px_rgba(0,0,0,0.15)] bg-white rounded-[24px] overflow-hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        hideCloseButton={true}
        variant="onboarding"
      >
        <div className="px-10 py-12 flex flex-col space-y-8 max-h-[85vh] overflow-y-auto">
          {/* Header */}
          <div className="text-center space-y-3">
            <div className="flex items-center justify-center mb-2">
              <div className="flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-gray-300" />
                <div className="w-1 h-1 rounded-full bg-gray-900" />
                <div className="w-1 h-1 rounded-full bg-gray-300" />
              </div>
            </div>
            <h2 className="text-[26px] font-semibold text-gray-900 tracking-[-0.02em] leading-[1.2]">Set up your account</h2>
            <p className="text-[15px] text-gray-500 leading-relaxed max-w-[400px] mx-auto">
              Tell us about your company to personalize your experience
            </p>
          </div>

          <div className="space-y-5">
            {/* Company Name */}
            <div className="space-y-2">
              <Label htmlFor="company-name" className="text-[13px] font-medium text-gray-700">
                Company Name
              </Label>
              <Input
                id="company-name"
                value={companyName}
                onChange={(e) => {
                  setCompanyName(e.target.value);
                  if (errors.companyName) setErrors(prev => ({ ...prev, companyName: undefined }));
                }}
                placeholder="Acme Inc."
                className={cn(
                  "h-11 border-gray-200 focus:border-gray-900 focus:ring-gray-900 rounded-[10px] text-[15px]",
                  errors.companyName && "border-red-300 focus:border-red-500 focus:ring-red-500"
                )}
              />
              {errors.companyName && (
                <p className="text-[13px] text-red-500">{errors.companyName}</p>
              )}
            </div>

            {/* Website URL */}
            <div className="space-y-2">
              <Label htmlFor="website-url" className="text-[13px] font-medium text-gray-700">
                Website URL
              </Label>
              <Input
                id="website-url"
                value={websiteUrl}
                onChange={(e) => {
                  setWebsiteUrl(e.target.value);
                  if (errors.websiteUrl) setErrors(prev => ({ ...prev, websiteUrl: undefined }));
                }}
                placeholder="www.acme.com"
                className={cn(
                  "h-11 border-gray-200 focus:border-gray-900 focus:ring-gray-900 rounded-[10px] text-[15px]",
                  errors.websiteUrl && "border-red-300 focus:border-red-500 focus:ring-red-500"
                )}
              />
              {errors.websiteUrl && (
                <p className="text-[13px] text-red-500">{errors.websiteUrl}</p>
              )}
            </div>

            {/* Workspace Name */}
            <div className="space-y-2">
              <Label htmlFor="workspace-name" className="text-[13px] font-medium text-gray-700">
                Workspace Name
              </Label>
              <Input
                id="workspace-name"
                value={workspaceName}
                onChange={(e) => {
                  setWorkspaceName(e.target.value);
                  if (errors.workspaceName) setErrors(prev => ({ ...prev, workspaceName: undefined }));
                }}
                placeholder="Marketing Team"
                className={cn(
                  "h-11 border-gray-200 focus:border-gray-900 focus:ring-gray-900 rounded-[10px] text-[15px]",
                  errors.workspaceName && "border-red-300 focus:border-red-500 focus:ring-red-500"
                )}
              />
              {errors.workspaceName && (
                <p className="text-[13px] text-red-500">{errors.workspaceName}</p>
              )}
            </div>

            {/* ── Document Preferences ── */}
            <div className="pt-3 border-t border-gray-100">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-[8px] bg-gray-50 border border-gray-100 flex items-center justify-center">
                  <Paintbrush className="h-4 w-4 text-gray-500" />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-gray-900">Document Preferences</p>
                  <p className="text-[11px] text-gray-400">How your generated documents will look</p>
                </div>
              </div>

              <div className="space-y-4">
                {/* Default Language */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5 text-gray-400" />
                    <Label htmlFor="default-language" className="text-[12px] font-medium text-gray-500">
                      Language
                    </Label>
                  </div>
                  <Select value={defaultLanguage} onValueChange={setDefaultLanguage}>
                    <SelectTrigger className="h-10 border-gray-200 focus:border-gray-900 focus:ring-gray-900 rounded-[10px] text-[14px]">
                      <SelectValue placeholder="Select language" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="de">German (Deutsch)</SelectItem>
                      <SelectItem value="fr">French (Fran&#231;ais)</SelectItem>
                      <SelectItem value="es">Spanish (Espa&#241;ol)</SelectItem>
                      <SelectItem value="it">Italian (Italiano)</SelectItem>
                      <SelectItem value="pt">Portuguese (Portugu&#234;s)</SelectItem>
                      <SelectItem value="nl">Dutch (Nederlands)</SelectItem>
                      <SelectItem value="pl">Polish (Polski)</SelectItem>
                      <SelectItem value="sv">Swedish (Svenska)</SelectItem>
                      <SelectItem value="da">Danish (Dansk)</SelectItem>
                      <SelectItem value="no">Norwegian (Norsk)</SelectItem>
                      <SelectItem value="fi">Finnish (Suomi)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Design Style */}
                <div className="space-y-1.5">
                  <Label className="text-[12px] font-medium text-gray-500">Style</Label>
                  <div className="flex flex-wrap gap-2">
                    {DESIGN_STYLES.map((style) => (
                      <button
                        key={style.value}
                        type="button"
                        onClick={() => setDesignStyle(style.value)}
                        className={cn(
                          "px-3.5 py-2 rounded-full border text-[13px] transition-all duration-200",
                          designStyle === style.value
                            ? "border-gray-900 bg-gray-900 text-white shadow-sm"
                            : "border-gray-200 text-gray-600 hover:border-gray-400 hover:bg-gray-50"
                        )}
                      >
                        {style.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Theme Toggle */}
                <div className="space-y-1.5">
                  <Label className="text-[12px] font-medium text-gray-500">Theme</Label>
                  <div className="flex gap-1 p-1 bg-gray-100 rounded-[10px]">
                    <button
                      type="button"
                      onClick={() => setTheme('light')}
                      className={cn(
                        "flex-1 py-2 px-3 text-[13px] font-medium rounded-[8px] transition-all flex items-center justify-center gap-1.5",
                        theme === 'light'
                          ? "bg-white text-gray-900 shadow-sm"
                          : "text-gray-500 hover:text-gray-700"
                      )}
                    >
                      <Sun className="h-3.5 w-3.5" />
                      Light
                    </button>
                    <button
                      type="button"
                      onClick={() => setTheme('dark')}
                      className={cn(
                        "flex-1 py-2 px-3 text-[13px] font-medium rounded-[8px] transition-all flex items-center justify-center gap-1.5",
                        theme === 'dark'
                          ? "bg-white text-gray-900 shadow-sm"
                          : "text-gray-500 hover:text-gray-700"
                      )}
                    >
                      <Moon className="h-3.5 w-3.5" />
                      Dark
                    </button>
                  </div>
                </div>

                {/* Secondary Color */}
                <div className="space-y-1.5">
                  <Label className="text-[12px] font-medium text-gray-500">Brand Color</Label>
                  <div className="flex items-center gap-2.5">
                    <div className="relative">
                      <input
                        type="color"
                        value={secondaryColor}
                        onChange={(e) => setSecondaryColor(e.target.value)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div
                        className="w-10 h-10 rounded-[10px] border border-gray-200 shadow-sm cursor-pointer"
                        style={{ backgroundColor: secondaryColor }}
                      />
                    </div>
                    <Input
                      value={secondaryColor}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (/^#[0-9a-fA-F]{0,6}$/.test(val)) setSecondaryColor(val);
                      }}
                      placeholder="#8b5cf6"
                      className="h-10 w-28 border-gray-200 rounded-[10px] text-[13px] font-mono tracking-wide"
                    />
                    <span className="text-[11px] text-gray-400 hidden sm:block">Used for covers, headers, and accents</span>
                  </div>
                </div>

                {/* Color Application (light theme only) */}
                {theme === 'light' && (
                  <div className="space-y-1.5">
                    <Label className="text-[12px] font-medium text-gray-500">Color Application</Label>
                    <div className="space-y-1.5">
                      <label
                        onClick={() => setColorMode('accent')}
                        className={cn(
                          "flex items-start gap-2.5 p-2.5 rounded-[10px] border cursor-pointer transition-all",
                          colorMode === 'accent'
                            ? "border-gray-900 bg-gray-50/80"
                            : "border-gray-200 hover:border-gray-300 hover:bg-gray-50/30"
                        )}
                      >
                        <div className={cn(
                          "mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                          colorMode === 'accent' ? "border-gray-900" : "border-gray-300"
                        )}>
                          {colorMode === 'accent' && <div className="w-2 h-2 rounded-full bg-gray-900" />}
                        </div>
                        <div>
                          <p className="text-[13px] font-medium text-gray-900">Accent only</p>
                          <p className="text-[11px] text-gray-400 leading-snug">Cover and headers use color. Inner pages stay white.</p>
                        </div>
                      </label>
                      <label
                        onClick={() => setColorMode('consistent')}
                        className={cn(
                          "flex items-start gap-2.5 p-2.5 rounded-[10px] border cursor-pointer transition-all",
                          colorMode === 'consistent'
                            ? "border-gray-900 bg-gray-50/80"
                            : "border-gray-200 hover:border-gray-300 hover:bg-gray-50/30"
                        )}
                      >
                        <div className={cn(
                          "mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                          colorMode === 'consistent' ? "border-gray-900" : "border-gray-300"
                        )}>
                          {colorMode === 'consistent' && <div className="w-2 h-2 rounded-full bg-gray-900" />}
                        </div>
                        <div>
                          <p className="text-[13px] font-medium text-gray-900">Consistent theme</p>
                          <p className="text-[11px] text-gray-400 leading-snug">Light color tints on inner page backgrounds too.</p>
                        </div>
                      </label>
                    </div>
                  </div>
                )}

                {/* Cover Page Style (dark theme only) */}
                {theme === 'dark' && (
                  <div className="space-y-1.5">
                    <Label className="text-[12px] font-medium text-gray-500">Cover Page Style</Label>
                    <div className="space-y-1.5">
                      <label
                        onClick={() => setDarkCoverStyle('secondary')}
                        className={cn(
                          "flex items-start gap-2.5 p-2.5 rounded-[10px] border cursor-pointer transition-all",
                          darkCoverStyle === 'secondary'
                            ? "border-gray-900 bg-gray-50/80"
                            : "border-gray-200 hover:border-gray-300 hover:bg-gray-50/30"
                        )}
                      >
                        <div className={cn(
                          "mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                          darkCoverStyle === 'secondary' ? "border-gray-900" : "border-gray-300"
                        )}>
                          {darkCoverStyle === 'secondary' && <div className="w-2 h-2 rounded-full bg-gray-900" />}
                        </div>
                        <div>
                          <p className="text-[13px] font-medium text-gray-900">Color background</p>
                          <p className="text-[11px] text-gray-400 leading-snug">Cover uses your brand color as full background.</p>
                        </div>
                      </label>
                      <label
                        onClick={() => setDarkCoverStyle('accents')}
                        className={cn(
                          "flex items-start gap-2.5 p-2.5 rounded-[10px] border cursor-pointer transition-all",
                          darkCoverStyle === 'accents'
                            ? "border-gray-900 bg-gray-50/80"
                            : "border-gray-200 hover:border-gray-300 hover:bg-gray-50/30"
                        )}
                      >
                        <div className={cn(
                          "mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                          darkCoverStyle === 'accents' ? "border-gray-900" : "border-gray-300"
                        )}>
                          {darkCoverStyle === 'accents' && <div className="w-2 h-2 rounded-full bg-gray-900" />}
                        </div>
                        <div>
                          <p className="text-[13px] font-medium text-gray-900">Black with accents</p>
                          <p className="text-[11px] text-gray-400 leading-snug">Black cover with color used for lines and accents.</p>
                        </div>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Company Knowledge (Optional) */}
            <div className="space-y-3 pt-3">
              <div className="flex items-center justify-between">
                <Label className="text-[13px] font-medium text-gray-700">
                  Company Knowledge
                </Label>
                <span className="text-[12px] text-gray-400">Optional</span>
              </div>
              <p className="text-[13px] text-gray-500 leading-relaxed">
                Add files, website content, or notes to help AI understand your brand.
              </p>

              {/* Uploaded entries and pending files list */}
              {(uploadedEntries.length > 0 || pendingFiles.length > 0) && (
                <div className="rounded-[12px] border border-gray-200 bg-gray-50/30 divide-y divide-gray-200">
                  {uploadedEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between px-4 py-3 group"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-white border border-gray-200">
                          <FileText className="h-4 w-4 text-gray-500" />
                        </div>
                        <span className="truncate text-[14px] text-gray-700">{entry.title}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all"
                        onClick={() => handleDeleteEntry(entry.id)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  {pendingFiles.map((pf, index) => (
                    <div
                      key={`pending-${index}`}
                      className="flex items-center justify-between px-4 py-3 group"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-white border border-gray-200">
                          <FileText className="h-4 w-4 text-gray-400" />
                        </div>
                        <span className="truncate text-[14px] text-gray-600">{pf.title}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all"
                        onClick={() => handleRemovePendingFile(index)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {/* File upload area */}
              {!selectedFile ? (
                <Card
                  className={cn(
                    "border-2 border-dashed rounded-[12px] p-6 text-center cursor-pointer transition-all duration-200",
                    dragActive
                      ? "border-gray-900 bg-gray-50"
                      : "border-gray-200 hover:border-gray-300 hover:bg-gray-50/50"
                  )}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById('account-file-input')?.click()}
                >
                  <input
                    id="account-file-input"
                    type="file"
                    accept=".pdf,.doc,.docx,.txt"
                    onChange={(e) => handleFileSelect(e.target.files)}
                    disabled={uploading}
                    className="hidden"
                  />
                  <div className="flex flex-col items-center">
                    <Upload className={cn(
                      "h-5 w-5 mb-3",
                      dragActive ? "text-gray-900" : "text-gray-400"
                    )} />
                    <p className="text-[14px] text-gray-600 font-medium mb-1">
                      {dragActive ? 'Drop file here' : 'Drag and drop or click to browse'}
                    </p>
                    <p className="text-[12px] text-gray-400">
                      PDF, DOC, DOCX, TXT (Max 10MB)
                    </p>
                  </div>
                </Card>
              ) : (
                <div className="space-y-3">
                  <div className="px-4 py-3 bg-gray-50 rounded-[12px] border border-gray-200 flex items-center justify-between">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                      <span className="text-[14px] text-gray-700 truncate">{selectedFile.name}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                      onClick={() => {
                        setSelectedFile(null);
                        setDocumentTitle('');
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <Input
                    value={documentTitle}
                    onChange={(e) => setDocumentTitle(e.target.value)}
                    placeholder="Document title (optional)"
                    className="text-[14px] h-11 border-gray-200 rounded-[10px]"
                  />
                  <Button
                    onClick={handleFileUpload}
                    disabled={uploading}
                    variant="outline"
                    size="sm"
                    className="w-full h-10 border-gray-200 hover:bg-gray-50 rounded-[10px] text-[14px]"
                  >
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Plus className="h-4 w-4 mr-2" />
                    )}
                    Add File
                  </Button>
                </div>
              )}
            </div>
          </div>

          <Button
            onClick={handleContinue}
            disabled={saving}
            className="w-full h-12 bg-gray-900 hover:bg-gray-800 text-white rounded-[12px] font-medium text-[15px] transition-all shadow-sm group"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Continue
            <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-0.5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

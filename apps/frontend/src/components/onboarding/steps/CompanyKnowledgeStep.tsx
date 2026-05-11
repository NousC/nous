import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  ArrowRight,
  Loader2,
  Globe,
  Sun,
  Moon,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";

const DESIGN_STYLES = [
  { value: "corporate", label: "Corporate", description: "Professional, clean, business-focused" },
  { value: "creative", label: "Creative", description: "Bold, artistic, innovative" },
  { value: "minimalist", label: "Minimalist", description: "Simple, clean, lots of whitespace" },
  { value: "elegant", label: "Elegant", description: "Sophisticated, refined, premium" },
  { value: "modern", label: "Modern", description: "Contemporary, fresh, trendy" },
];

interface PendingFile {
  file: File;
  title: string;
}

interface CompanyKnowledgeStepProps {
  websiteUrl: string;
  setWebsiteUrl: (value: string) => void;
  defaultLanguage: string;
  setDefaultLanguage: (value: string) => void;
  designStyle: string;
  setDesignStyle: (value: string) => void;
  theme: "light" | "dark";
  setTheme: (value: "light" | "dark") => void;
  secondaryColor: string;
  setSecondaryColor: (value: string) => void;
  backgroundTheme: string;
  setBackgroundTheme: (value: string) => void;
  logoUrl: string;
  setLogoUrl: (value: string) => void;
  workspaceId: string | null;
  pendingFiles: PendingFile[];
  setPendingFiles: (files: PendingFile[]) => void;
  onNext: () => void;
  isLoading: boolean;
}

export function CompanyKnowledgeStep({
  websiteUrl,
  setWebsiteUrl,
  defaultLanguage,
  setDefaultLanguage,
  designStyle,
  setDesignStyle,
  theme,
  setTheme,
  secondaryColor,
  setSecondaryColor,
  backgroundTheme,
  setBackgroundTheme,
  logoUrl,
  setLogoUrl,
  workspaceId,
  onNext,
  isLoading,
}: CompanyKnowledgeStepProps) {
  const { session } = useAuth();
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const canContinue = websiteUrl.trim().length > 0;

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session?.access_token || !workspaceId) return;

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`/api/workspaces/${workspaceId}/logo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        setLogoUrl(data.logo_url);
        toast.success("Logo uploaded");
      } else {
        toast.error("Failed to upload logo");
      }
    } catch {
      toast.error("Failed to upload logo");
    } finally {
      setUploadingLogo(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header - Left aligned, premium minimal style */}
      <div>
        <h1 className="text-[26px] font-normal text-gray-900 tracking-[-0.02em] mb-2">
          Set up your company knowledge
        </h1>
        <p className="text-gray-500 text-[14px] font-light">
          Help Assetly understand your brand and generate better content
        </p>
      </div>

      {/* Form Fields */}
      <div className="space-y-5">
        {/* Website URL */}
        <div className="space-y-2">
          <Label htmlFor="websiteUrl" className="text-sm font-medium text-gray-700">
            Company website *
          </Label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              id="websiteUrl"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="www.example.com"
              className="h-11 pl-10 rounded-lg border-gray-200 focus:border-emerald-500 focus:ring-emerald-500"
            />
          </div>
          <p className="text-xs text-gray-500">
            We'll automatically extract your brand information
          </p>
        </div>

        {/* Company Logo */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-gray-700">Company Logo</Label>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            onChange={handleLogoUpload}
            className="hidden"
          />
          {logoUrl ? (
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-lg border border-gray-200 bg-white flex items-center justify-center overflow-hidden">
                <img src={logoUrl} alt="Logo" className="w-full h-full object-contain p-1" />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs h-8"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={uploadingLogo}
                >
                  {uploadingLogo ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Change
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs h-8 text-gray-400 hover:text-red-500"
                  onClick={() => setLogoUrl("")}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              disabled={uploadingLogo || !workspaceId}
              className="w-full h-20 rounded-lg border-2 border-dashed border-gray-200 hover:border-gray-300 flex flex-col items-center justify-center gap-1.5 text-gray-400 hover:text-gray-500 transition-colors"
            >
              {uploadingLogo ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Upload className="h-5 w-5" />
                  <span className="text-xs">Upload your logo</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Design Preferences Grid */}
        <div className="grid grid-cols-2 gap-3">
          {/* Language */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-gray-700">Language</Label>
            <Select value={defaultLanguage} onValueChange={setDefaultLanguage}>
              <SelectTrigger className="h-11 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="de">German</SelectItem>
                <SelectItem value="fr">French</SelectItem>
                <SelectItem value="es">Spanish</SelectItem>
                <SelectItem value="it">Italian</SelectItem>
                <SelectItem value="pt">Portuguese</SelectItem>
                <SelectItem value="nl">Dutch</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Design Style */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-gray-700">Design Style</Label>
            <Select value={designStyle} onValueChange={setDesignStyle}>
              <SelectTrigger className="h-11 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DESIGN_STYLES.map((style) => (
                  <SelectItem key={style.value} value={style.value}>
                    {style.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Theme and Color */}
        <div className="grid grid-cols-2 gap-3">
          {/* Theme */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-gray-700">Theme</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTheme("light")}
                className={cn(
                  "flex-1 h-11 rounded-lg border flex items-center justify-center gap-2 text-sm transition-all",
                  theme === "light"
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-medium"
                    : "border-gray-200 text-gray-600 hover:border-gray-300"
                )}
              >
                <Sun className="w-4 h-4" />
                Light
              </button>
              <button
                type="button"
                onClick={() => setTheme("dark")}
                className={cn(
                  "flex-1 h-11 rounded-lg border flex items-center justify-center gap-2 text-sm transition-all",
                  theme === "dark"
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-medium"
                    : "border-gray-200 text-gray-600 hover:border-gray-300"
                )}
              >
                <Moon className="w-4 h-4" />
                Dark
              </button>
            </div>
          </div>

          {/* Brand Color */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-gray-700">Brand Color</Label>
            <div className="flex gap-2">
              <div className="relative">
                <input
                  type="color"
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div
                  className="w-11 h-11 rounded-lg border border-gray-200 cursor-pointer"
                  style={{ backgroundColor: secondaryColor }}
                />
              </div>
              <Input
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
                className="flex-1 h-11 rounded-lg font-mono text-sm"
              />
            </div>
          </div>
        </div>

        {/* Background Theme removed — now handled by background bundles */}
      </div>

      {/* Continue Button */}
      <Button
        onClick={onNext}
        disabled={!canContinue || isLoading}
        className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[15px] font-medium"
      >
        {isLoading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
        Continue
        <ArrowRight className="w-4 h-4 ml-2" />
      </Button>
    </div>
  );
}

import { useState, useRef, useEffect } from "react";
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
  Upload,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";

interface AgencyInfoStepProps {
  companyName: string;
  setCompanyName: (value: string) => void;
  websiteUrl: string;
  setWebsiteUrl: (value: string) => void;
  defaultLanguage: string;
  setDefaultLanguage: (value: string) => void;
  logoUrl: string;
  setLogoUrl: (value: string) => void;
  workspaceId: string | null;
  onNext: () => void;
  isLoading: boolean;
}

export function AgencyInfoStep({
  companyName,
  setCompanyName,
  websiteUrl,
  setWebsiteUrl,
  defaultLanguage,
  setDefaultLanguage,
  logoUrl,
  setLogoUrl,
  workspaceId,
  onNext,
  isLoading,
}: AgencyInfoStepProps) {
  const { session } = useAuth();
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [faviconLoaded, setFaviconLoaded] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Extract domain from websiteUrl for favicon
  const extractDomain = (url: string): string | null => {
    try {
      let normalized = url.trim();
      if (!normalized) return null;
      if (!/^https?:\/\//i.test(normalized)) normalized = "https://" + normalized;
      const hostname = new URL(normalized).hostname;
      return hostname && hostname.includes(".") ? hostname : null;
    } catch {
      return null;
    }
  };

  const faviconDomain = extractDomain(websiteUrl);
  const faviconUrl = faviconDomain
    ? `https://www.google.com/s2/favicons?domain=${faviconDomain}&sz=32`
    : null;

  // Auto-fetch company logo from Clearbit when website URL changes
  useEffect(() => {
    if (!faviconDomain || logoUrl) return;

    // Strip www. prefix — Clearbit needs root domain (e.g. rev-box.com)
    const rootDomain = faviconDomain.replace(/^www\./i, "");
    const logoApiUrl = `https://logo.clearbit.com/${rootDomain}`;
    let cancelled = false;

    const timer = setTimeout(() => {
      const img = new Image();
      img.onload = () => {
        if (!cancelled) {
          setLogoUrl(logoApiUrl);
        }
      };
      img.onerror = () => {
        // Clearbit doesn't have logo — try Google's high-res favicon as fallback
        if (cancelled) return;
        const fallbackUrl = `https://www.google.com/s2/favicons?domain=${rootDomain}&sz=128`;
        const fallback = new Image();
        fallback.onload = () => {
          if (!cancelled) setLogoUrl(fallbackUrl);
        };
        fallback.src = fallbackUrl;
      };
      img.src = logoApiUrl;
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [faviconDomain, logoUrl, setLogoUrl]);

  const canContinue = companyName.trim().length > 0;

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session?.access_token || !workspaceId) return;

    setUploadingLogo(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/logo`, {
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
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-[26px] font-normal text-gray-900 tracking-[-0.02em] mb-1">
          Tell us about your company
        </h1>
        <p className="text-gray-500 text-[14px] font-light">
          Just your website and logo — we'll handle the rest
        </p>
      </div>

      {/* Form Fields */}
      <div className="space-y-3">
        {/* Company Name + Website — same line */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="companyName" className="text-sm font-medium text-gray-700">
              Company name *
            </Label>
            <Input
              id="companyName"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Agency"
              className="h-10 rounded-lg border-gray-200 focus:border-emerald-500 focus:ring-emerald-500"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="websiteUrl" className="text-sm font-medium text-gray-700">
              Website
            </Label>
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-4 h-4">
                {faviconUrl && faviconLoaded ? (
                  <img
                    src={faviconUrl}
                    alt=""
                    className="w-4 h-4 rounded-sm object-contain"
                  />
                ) : (
                  <Globe className="w-4 h-4 text-gray-400" />
                )}
                {faviconUrl && (
                  <img
                    src={faviconUrl}
                    alt=""
                    className="hidden"
                    onLoad={() => setFaviconLoaded(true)}
                    onError={() => setFaviconLoaded(false)}
                  />
                )}
              </div>
              <Input
                id="websiteUrl"
                value={websiteUrl}
                onChange={(e) => {
                  setWebsiteUrl(e.target.value);
                  setFaviconLoaded(false);
                }}
                placeholder="www.example.com"
                className="h-10 pl-10 rounded-lg border-gray-200 focus:border-emerald-500 focus:ring-emerald-500"
              />
            </div>
          </div>
        </div>

        {/* Language */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-gray-700">Language</Label>
          <Select value={defaultLanguage} onValueChange={setDefaultLanguage}>
            <SelectTrigger className="h-10 rounded-lg">
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

        {/* Company Logo */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-gray-700">Company logo</Label>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            onChange={handleLogoUpload}
            className="hidden"
          />
          {logoUrl ? (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg border border-gray-200 bg-white flex items-center justify-center overflow-hidden">
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
              className="w-full h-14 rounded-lg border-2 border-dashed border-gray-200 hover:border-gray-300 flex items-center justify-center gap-2 text-gray-400 hover:text-gray-500 transition-colors"
            >
              {uploadingLogo ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  <span className="text-xs">Upload your logo</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Continue Button */}
      <Button
        onClick={onNext}
        disabled={!canContinue || isLoading}
        className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[15px] font-medium"
      >
        {isLoading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
        Continue
        <ArrowRight className="w-4 h-4 ml-2" />
      </Button>
    </div>
  );
}

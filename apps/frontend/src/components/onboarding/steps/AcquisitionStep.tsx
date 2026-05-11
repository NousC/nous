import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Loader2, Mail, Users, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

// SVG Logo Components
const YouTubeLogo = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

const LinkedInLogo = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>
);

const XLogo = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

const GoogleLogo = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

const ACQUISITION_SOURCES = [
  { value: "youtube", label: "YouTube", icon: YouTubeLogo, color: "text-red-600" },
  { value: "linkedin", label: "LinkedIn", icon: LinkedInLogo, color: "text-[#0A66C2]" },
  { value: "x", label: "X", icon: XLogo, color: "text-black" },
  { value: "google", label: "Google", icon: GoogleLogo, color: "" },
  { value: "referral", label: "Referral", icon: Users, color: "text-gray-600" },
  { value: "email", label: "Email", icon: Mail, color: "text-gray-600" },
  { value: "other", label: "Other", icon: Sparkles, color: "text-gray-600" },
];

interface AcquisitionStepProps {
  howHeardAboutUs: string | null;
  setHowHeardAboutUs: (value: string | null) => void;
  referralCode: string;
  setReferralCode: (value: string) => void;
  onNext: () => void;
  isLoading: boolean;
}

export function AcquisitionStep({
  howHeardAboutUs,
  setHowHeardAboutUs,
  referralCode,
  setReferralCode,
  onNext,
  isLoading,
}: AcquisitionStepProps) {
  const handleContinue = () => {
    // If nothing selected, default to "other" and continue
    if (!howHeardAboutUs) {
      setHowHeardAboutUs("other");
    }
    onNext();
  };

  return (
    <div className="space-y-8">
      {/* Header - Left aligned, premium minimal style */}
      <div>
        <h1 className="text-[26px] font-normal text-gray-900 tracking-[-0.02em] mb-2">
          How did you hear about us?
        </h1>
        <p className="text-gray-500 text-[14px] font-light">
          This helps us understand how people discover Assetly
        </p>
      </div>

      {/* Source Options Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        {ACQUISITION_SOURCES.map((source) => {
          const IconComponent = source.icon;
          const isSelected = howHeardAboutUs === source.value;
          return (
            <button
              key={source.value}
              type="button"
              onClick={() => setHowHeardAboutUs(source.value)}
              className={cn(
                "flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all text-left",
                isSelected
                  ? "border-emerald-500 bg-emerald-50/50"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50/50"
              )}
            >
              <div className={cn(
                "flex-shrink-0",
                isSelected ? "text-emerald-600" : source.color || "text-gray-500"
              )}>
                <IconComponent />
              </div>
              <span
                className={cn(
                  "text-[14px]",
                  isSelected ? "text-emerald-700 font-medium" : "text-gray-700"
                )}
              >
                {source.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Referral Code Input (shown when "referral" is selected) */}
      {howHeardAboutUs === "referral" && (
        <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
          <Label htmlFor="referralCode" className="text-sm font-medium text-gray-700">
            Referral code (optional)
          </Label>
          <Input
            id="referralCode"
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
            placeholder="Enter code"
            className="h-11 rounded-lg border-gray-200 focus:border-emerald-500 focus:ring-emerald-500 uppercase"
          />
        </div>
      )}

      {/* Continue Button */}
      <Button
        onClick={handleContinue}
        disabled={isLoading}
        className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[15px] font-medium"
      >
        {isLoading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
        Continue
        <ArrowRight className="w-4 h-4 ml-2" />
      </Button>

      {/* Skip Link */}
      <button
        onClick={() => {
          setHowHeardAboutUs("other");
          onNext();
        }}
        className="w-full text-center text-[13px] text-gray-400 hover:text-gray-600 transition-colors"
      >
        Skip this step
      </button>
    </div>
  );
}

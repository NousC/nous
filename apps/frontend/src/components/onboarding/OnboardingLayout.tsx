import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { OnboardingProgress } from "./OnboardingProgress";

interface OnboardingLayoutProps {
  children: ReactNode;
  preview?: ReactNode;
  currentStep: number;
  totalSteps: number;
  onBack?: () => void;
  showBack?: boolean;
}

export function OnboardingLayout({
  children,
  preview,
  currentStep,
  totalSteps,
  onBack,
  showBack = false,
}: OnboardingLayoutProps) {
  return (
    <div className="min-h-screen w-full flex flex-col bg-white">
      {/* Header with centered logo */}
      <header className="w-full py-6 px-8">
        <div className="max-w-7xl mx-auto flex justify-center">
          <img
            src="/nous-logo.svg"
            alt="Nous"
            className="h-10 w-auto"
          />
        </div>
      </header>

      {/* Main content area */}
      <main className="flex-1 flex">
        <div className="w-full max-w-7xl mx-auto flex flex-col lg:flex-row">
          {/* Left side - Form */}
          <div className="flex-1 lg:w-[55%] flex flex-col px-6 lg:px-16 py-6">
            {/* Back button */}
            {showBack && onBack && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onBack}
                className="w-fit mb-4 -ml-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              >
                <ArrowLeft className="w-4 h-4 mr-1.5" />
                Back
              </Button>
            )}

            {/* Form content - vertically centered, left aligned */}
            <div className="flex-1 flex flex-col justify-center max-w-md w-full">
              {children}
            </div>
          </div>

          {/* Right side - Preview (hidden on mobile) */}
          {preview && (
            <div className="hidden lg:flex lg:w-[45%] bg-gray-50 border-l border-gray-100">
              <div className="w-full h-full flex items-center justify-center p-12">
                {preview}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer with centered progress dots */}
      <footer className="w-full py-6 px-8">
        <div className="max-w-7xl mx-auto flex justify-center">
          <OnboardingProgress currentStep={currentStep} totalSteps={totalSteps} />
        </div>
      </footer>
    </div>
  );
}

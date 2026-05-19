import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, PlayCircle } from "lucide-react";

interface PostOnboardingModalsProps {
  show: boolean;
  onDismiss: () => void;
}


export function PostOnboardingModals({ show, onDismiss }: PostOnboardingModalsProps) {
  const [showWelcome, setShowWelcome] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // Read onboarding context from localStorage
  const companyName = localStorage.getItem("nous_onboarding_company_name") || "your company";

  useEffect(() => {
    if (show) {
      const timer = setTimeout(() => {
        setShowWelcome(true);
        setTimeout(() => setIsVisible(true), 50);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [show]);

  const dismissWelcome = () => {
    setIsVisible(false);
    setTimeout(() => {
      setShowWelcome(false);
      localStorage.removeItem("nous_onboarding_company_name");
      onDismiss();
    }, 200);
  };

  const handleExplore = () => {
    dismissWelcome();
  };

  if (!show) return null;

  return (
    <Dialog open={showWelcome} onOpenChange={() => {}}>
      <DialogContent
        className={`sm:max-w-[440px] p-0 border border-gray-200 shadow-xl bg-white rounded-2xl overflow-hidden transition-all duration-500 ease-out ${
          isVisible ? "opacity-100 scale-100" : "opacity-0 scale-95"
        }`}
        hideCloseButton={true}
      >
        <div className="p-6">
          {/* Logo top left */}
          <img
            src="/nous-logo.svg"
            alt="Nous"
            className="h-8 w-auto mb-5"
          />

          {/* Message style content */}
          <div className="space-y-4 text-[14px] text-gray-700 leading-relaxed">
            <p>
              Hey, I'm <span className="font-semibold text-gray-900">Nous</span> — your AI sales assistant. I've already gotten started for you!
            </p>

            <p className="font-medium text-gray-900">
              Here's what I've set up:
            </p>

            <ul className="space-y-2.5 pl-1">
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>Created a branded proposal template for <span className="font-semibold text-gray-900">{companyName}</span></span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>Set up a workflow to generate proposals from your meeting notes</span>
              </li>
            </ul>

            <div className="border-t border-gray-100 pt-4 mt-4 space-y-3">
              <p className="font-medium text-gray-900">
                Here's what I'd recommend next:
              </p>
              <ul className="space-y-2 pl-1">
                <li className="flex items-start gap-2.5 text-[13px] text-gray-600">
                  <span className="font-semibold text-gray-900 flex-shrink-0">1.</span>
                  <span>Check out your template and make any changes you like</span>
                </li>
                <li className="flex items-start gap-2.5 text-[13px] text-gray-600">
                  <span className="font-semibold text-gray-900 flex-shrink-0">2.</span>
                  <span>
                    Watch the{" "}
                    <a
                      href="https://www.tella.tv/video/how-to-get-started-with-nous-1-0ioe"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 font-medium underline underline-offset-2"
                    >
                      <PlayCircle className="w-3.5 h-3.5" />
                      10-minute getting started tutorial
                    </a>{" "}
                    to get up and running fast
                  </span>
                </li>
              </ul>
            </div>
          </div>

          {/* CTA */}
          <div className="mt-6 space-y-2">
            <Button
              asChild
              className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[14px] font-medium transition-all duration-200"
            >
              <a
                href="https://www.tella.tv/video/how-to-get-started-with-nous-1-0ioe"
                target="_blank"
                rel="noopener noreferrer"
              >
                <PlayCircle className="w-4 h-4 mr-2" />
                Watch the getting started video
              </a>
            </Button>

            <button
              onClick={handleExplore}
              className="w-full text-center text-[13px] text-gray-400 hover:text-gray-600 transition-colors py-1"
            >
              I'll explore on my own
            </button>
          </div>

          {/* Trial note */}
          <p className="text-gray-400 text-[12px] text-center mt-4">
            You're on a 7-day free trial of the Professional plan.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

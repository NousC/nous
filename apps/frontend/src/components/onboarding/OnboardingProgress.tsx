import { cn } from "@/lib/utils";

interface OnboardingProgressProps {
  currentStep: number;
  totalSteps: number;
}

export function OnboardingProgress({ currentStep, totalSteps }: OnboardingProgressProps) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: totalSteps }, (_, i) => {
        const stepNumber = i + 1;
        const isActive = stepNumber === currentStep;
        const isCompleted = stepNumber < currentStep;

        return (
          <div
            key={stepNumber}
            className={cn(
              "w-2 h-2 rounded-full transition-all duration-300",
              isActive && "w-6 bg-emerald-600",
              isCompleted && "bg-emerald-600",
              !isActive && !isCompleted && "bg-gray-200"
            )}
          />
        );
      })}
    </div>
  );
}

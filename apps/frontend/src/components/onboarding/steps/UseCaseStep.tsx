import { Button } from "@/components/ui/button";
import { ArrowRight, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const USE_CASES = [
  { value: "sales", label: "Sales" },
  { value: "marketing", label: "Marketing" },
  { value: "fulfillment", label: "Client Fulfillment" },
  { value: "proposals", label: "Business Proposals" },
  { value: "reports", label: "Reports & Analytics" },
  { value: "legal", label: "Legal Documents" },
];

interface UseCaseStepProps {
  useCases: string[];
  setUseCases: (value: string[]) => void;
  onComplete: () => void;
  isLoading: boolean;
}

export function UseCaseStep({
  useCases,
  setUseCases,
  onComplete,
  isLoading,
}: UseCaseStepProps) {
  const toggleUseCase = (value: string) => {
    if (useCases.includes(value)) {
      setUseCases(useCases.filter((uc) => uc !== value));
    } else {
      setUseCases([...useCases, value]);
    }
  };

  const handleComplete = () => {
    if (useCases.length === 0) {
      setUseCases(["other"]);
    }
    onComplete();
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-[26px] font-normal text-gray-900 tracking-[-0.02em] mb-2">
          What will you use Nous for?
        </h1>
        <p className="text-gray-500 text-[14px] font-light">
          Select all that apply
        </p>
      </div>

      {/* Use Cases - Minimal chips */}
      <div className="flex flex-wrap gap-2">
        {USE_CASES.map((useCase) => {
          const isSelected = useCases.includes(useCase.value);
          return (
            <button
              key={useCase.value}
              type="button"
              onClick={() => toggleUseCase(useCase.value)}
              className={cn(
                "px-4 py-2.5 rounded-full border text-[14px] transition-all",
                isSelected
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"
              )}
            >
              {isSelected && <Check className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />}
              {useCase.label}
            </button>
          );
        })}
      </div>

      {/* Complete Button */}
      <Button
        onClick={handleComplete}
        disabled={isLoading}
        className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[15px] font-medium"
      >
        {isLoading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
        Complete Setup
        <ArrowRight className="w-4 h-4 ml-2" />
      </Button>

      {/* Skip Link */}
      <button
        onClick={handleComplete}
        disabled={isLoading}
        className="w-full text-center text-[13px] text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
      >
        Skip for now
      </button>
    </div>
  );
}

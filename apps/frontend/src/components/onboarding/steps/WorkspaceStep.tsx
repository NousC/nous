import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { workspaceIcons } from "@/utils/workspaceIcons";

interface WorkspaceStepProps {
  companyName: string;
  setCompanyName: (value: string) => void;
  workspaceName: string;
  setWorkspaceName: (value: string) => void;
  companyLogoUrl: string;
  setCompanyLogoUrl: (value: string) => void;
  onNext: () => void;
  isLoading: boolean;
}

export function WorkspaceStep({
  companyName,
  setCompanyName,
  workspaceName,
  setWorkspaceName,
  companyLogoUrl,
  setCompanyLogoUrl,
  onNext,
  isLoading,
}: WorkspaceStepProps) {
  // Use companyLogoUrl to store selected icon name
  const selectedIcon = companyLogoUrl || "briefcase";

  // Auto-sync workspace name with company name
  const handleCompanyNameChange = (value: string) => {
    setCompanyName(value);
    // Only auto-sync if workspace name is empty or matches previous company name
    if (!workspaceName || workspaceName === companyName) {
      setWorkspaceName(value);
    }
  };

  const canContinue = companyName.trim().length > 0 && workspaceName.trim().length > 0;

  return (
    <div className="space-y-8">
      {/* Header - Left aligned, premium minimal style */}
      <div>
        <h1 className="text-[26px] font-normal text-gray-900 tracking-[-0.02em] mb-2">
          Create your workspace
        </h1>
        <p className="text-gray-500 text-[14px] font-light">
          Set up your company workspace to organize your documents
        </p>
      </div>

      {/* Form Fields */}
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="companyName" className="text-sm font-medium text-gray-700">
            Company name *
          </Label>
          <Input
            id="companyName"
            value={companyName}
            onChange={(e) => handleCompanyNameChange(e.target.value)}
            placeholder="Acme Inc."
            className="h-11 rounded-lg border-gray-200 focus:border-emerald-500 focus:ring-emerald-500"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="workspaceName" className="text-sm font-medium text-gray-700">
            Workspace name *
          </Label>
          <Input
            id="workspaceName"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            placeholder="Marketing Team"
            className="h-11 rounded-lg border-gray-200 focus:border-emerald-500 focus:ring-emerald-500"
          />
        </div>

        {/* Icon Selection */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-gray-700">
            Choose an icon
          </Label>
          <div className="grid grid-cols-6 gap-2">
            {workspaceIcons.map((item) => {
              const IconComponent = item.icon;
              const isSelected = selectedIcon === item.name;
              return (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => setCompanyLogoUrl(item.name)}
                  className={cn(
                    "h-11 w-11 rounded-lg border-2 flex items-center justify-center transition-all",
                    isSelected
                      ? "border-emerald-500 bg-emerald-50"
                      : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                  )}
                >
                  <IconComponent
                    className={cn(
                      "w-5 h-5",
                      isSelected ? "text-emerald-600" : "text-gray-500"
                    )}
                  />
                </button>
              );
            })}
          </div>
        </div>
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

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
import { ArrowRight, Loader2, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

const DESIGN_STYLES = [
  { value: "corporate", label: "Corporate" },
  { value: "creative", label: "Creative" },
  { value: "minimalist", label: "Minimalist" },
  { value: "elegant", label: "Elegant" },
  { value: "modern", label: "Modern" },
];

interface TemplateDesignStepProps {
  designStyle: string;
  setDesignStyle: (value: string) => void;
  theme: "light" | "dark";
  setTheme: (value: "light" | "dark") => void;
  secondaryColor: string;
  setSecondaryColor: (value: string) => void;
  onNext: () => void;
  isLoading: boolean;
}

export function TemplateDesignStep({
  designStyle,
  setDesignStyle,
  theme,
  setTheme,
  secondaryColor,
  setSecondaryColor,
  onNext,
  isLoading,
}: TemplateDesignStepProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-[26px] font-normal text-gray-900 tracking-[-0.02em] mb-1">
          Build your first template
        </h1>
        <p className="text-gray-500 text-[14px] font-light">
          Set your design preferences so Nous matches your brand
        </p>
      </div>

      {/* Design Style Dropdown */}
      <div className="space-y-2">
        <Label className="text-sm font-medium text-gray-700">Design style</Label>
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
        <Label className="text-sm font-medium text-gray-700">Brand color</Label>
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

      {/* Continue Button */}
      <Button
        onClick={onNext}
        disabled={isLoading}
        className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[15px] font-medium"
      >
        {isLoading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
        Continue
        <ArrowRight className="w-4 h-4 ml-2" />
      </Button>
    </div>
  );
}

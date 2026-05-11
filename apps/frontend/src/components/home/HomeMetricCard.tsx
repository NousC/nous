import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface HomeMetricCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  isLoading?: boolean;
  onClick?: () => void;
  className?: string;
}

export function HomeMetricCard({
  label,
  value,
  icon: Icon,
  isLoading = false,
  onClick,
  className,
}: HomeMetricCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "flex items-center gap-3 p-4",
        "bg-white border border-gray-100 rounded-xl",
        "transition-all duration-200",
        onClick && "hover:border-gray-200 hover:shadow-sm cursor-pointer",
        !onClick && "cursor-default",
        className
      )}
    >
      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-teal-50">
        <Icon className="w-5 h-5 text-teal-600" strokeWidth={1.75} />
      </div>
      <div className="flex flex-col items-start">
        <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
          {label}
        </span>
        {isLoading ? (
          <div className="h-6 w-10 bg-gray-100 rounded animate-pulse mt-0.5" />
        ) : (
          <span className="text-xl font-semibold text-gray-900">{value}</span>
        )}
      </div>
    </button>
  );
}

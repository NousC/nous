import { CheckCircle2 } from "lucide-react";

export function LivePreview() {
  return (
    <div className="flex flex-col items-center justify-center text-center">
      <div className="w-20 h-20 rounded-full bg-emerald-50 flex items-center justify-center mb-5">
        <CheckCircle2 className="w-10 h-10 text-emerald-500" />
      </div>
      <h2 className="text-2xl font-semibold text-gray-900 mb-2">
        You're live!
      </h2>
      <p className="text-gray-400 text-sm max-w-[220px]">
        Everything is set up and ready to go
      </p>
    </div>
  );
}

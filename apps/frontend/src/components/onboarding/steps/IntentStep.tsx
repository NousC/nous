import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Code2, Plug, Users } from "lucide-react";

const USE_CASES = [
  {
    id: "sdk",
    label: "Build smarter agents from scratch",
    desc: "Integrate Proply via SDK into your custom agent stack",
    icon: Code2,
  },
  {
    id: "mcp",
    label: "Connect to my existing agents",
    desc: "Use the MCP server to plug Proply into Claude or N8N",
    icon: Plug,
  },
  {
    id: "gtm",
    label: "Equip my GTM team with AI context",
    desc: "Use Proply as an internal memory layer for your sales team",
    icon: Users,
  },
];

const AGENT_SETUPS = [
  { id: "n8n_make", label: "N8N / Make" },
  { id: "custom_code", label: "Custom code" },
  { id: "claude_desktop", label: "Claude Desktop" },
  { id: "getting_started", label: "Just getting started" },
];

interface IntentStepProps {
  useCase: string | null;
  setUseCase: (v: string) => void;
  agentSetup: string | null;
  setAgentSetup: (v: string) => void;
  onNext: () => void;
  isLoading: boolean;
}

export function IntentStep({
  useCase,
  setUseCase,
  agentSetup,
  setAgentSetup,
  onNext,
  isLoading,
}: IntentStepProps) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">How will you use Proply?</h1>
        <p className="text-sm text-gray-500 mt-1">This helps us tailor your setup experience.</p>
      </div>

      <div className="space-y-2.5">
        {USE_CASES.map(({ id, label, desc, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setUseCase(id)}
            className={cn(
              "w-full text-left px-4 py-3.5 rounded-xl border-2 transition-all flex items-start gap-3",
              useCase === id
                ? "border-gray-900 bg-gray-50"
                : "border-gray-200 hover:border-gray-300 bg-white"
            )}
          >
            <Icon
              className={cn(
                "w-4 h-4 mt-0.5 flex-shrink-0",
                useCase === id ? "text-gray-900" : "text-gray-400"
              )}
            />
            <div>
              <p
                className={cn(
                  "text-sm font-medium",
                  useCase === id ? "text-gray-900" : "text-gray-700"
                )}
              >
                {label}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700">Current agent setup</p>
        <div className="grid grid-cols-2 gap-2">
          {AGENT_SETUPS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setAgentSetup(id)}
              className={cn(
                "px-3 py-2.5 rounded-lg border-2 text-sm transition-all text-left",
                agentSetup === id
                  ? "border-gray-900 bg-gray-50 text-gray-900 font-medium"
                  : "border-gray-200 hover:border-gray-300 text-gray-600"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Button
        onClick={onNext}
        disabled={!useCase || isLoading}
        className="w-full bg-gray-900 hover:bg-gray-800 text-white h-11"
      >
        Continue
      </Button>
    </div>
  );
}

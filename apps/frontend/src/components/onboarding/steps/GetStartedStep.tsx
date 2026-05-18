import { Button } from "@/components/ui/button";
import { Code2, Loader2, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

interface GetStartedStepProps {
  useCase: string | null;
  agentSetup: string | null;
  onComplete: () => void;
  isLoading: boolean;
}

function prefersMcp(useCase: string | null, agentSetup: string | null) {
  return useCase === "mcp" || agentSetup === "n8n_make" || agentSetup === "claude_desktop";
}

function prefersSdk(useCase: string | null, agentSetup: string | null) {
  return useCase === "sdk" || agentSetup === "custom_code";
}

const MCP_SNIPPET = `{
  "mcpServers": {
    "nous": {
      "command": "npx",
      "args": ["-y", "@opennous/mcp"],
      "env": {
        "NOUS_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}`;

const SDK_SNIPPET = `import { Nous } from '@opennous/sdk';
const nous = new Nous({ apiKey: 'YOUR_API_KEY' });

// Full context for any contact — one call
const contact = await nous.getContact('john@acme.com');

// Log what your agent did (memory updates automatically)
await nous.track({
  email: 'john@acme.com',
  type: 'email_sent',
  description: 'Sent intro email',
});`;

export function GetStartedStep({
  useCase,
  agentSetup,
  onComplete,
  isLoading,
}: GetStartedStepProps) {
  const mcpFirst = prefersMcp(useCase, agentSetup);
  const sdkFirst = prefersSdk(useCase, agentSetup);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">You're set up.</h1>
        <p className="text-sm text-gray-500 mt-1">
          Here's how to connect your agents to Nous's memory.
        </p>
      </div>

      {/* Step 1: API key */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-gray-900 text-white text-[10px] font-medium flex items-center justify-center flex-shrink-0">
            1
          </span>
          <p className="text-sm font-medium text-gray-900">Create an API key</p>
        </div>
        <p className="text-sm text-gray-500 ml-7">
          Go to{" "}
          <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-700">
            Settings → API Keys
          </span>{" "}
          to generate your first key. Each client workspace gets its own isolated key.
        </p>
      </div>

      {/* Step 2: Connect */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-gray-900 text-white text-[10px] font-medium flex items-center justify-center flex-shrink-0">
            2
          </span>
          <p className="text-sm font-medium text-gray-900">Connect your agent</p>
        </div>

        <div className="ml-7 space-y-2">
          {/* MCP block */}
          <div
            className={cn(
              "rounded-xl border-2 overflow-hidden",
              mcpFirst ? "border-gray-900" : "border-gray-200"
            )}
          >
            <div
              className={cn(
                "px-3 py-2 border-b flex items-center gap-2",
                mcpFirst ? "border-gray-700 bg-gray-900" : "border-gray-100 bg-gray-50"
              )}
            >
              <Terminal
                className={cn("w-3.5 h-3.5", mcpFirst ? "text-white" : "text-gray-400")}
              />
              <span
                className={cn(
                  "text-xs font-medium",
                  mcpFirst ? "text-white" : "text-gray-600"
                )}
              >
                MCP Server
              </span>
              {mcpFirst && (
                <span className="ml-auto text-[10px] text-gray-400">
                  Recommended for you
                </span>
              )}
            </div>
            <div className="p-3 bg-gray-950 overflow-x-auto">
              <pre className="text-xs text-emerald-400 font-mono leading-relaxed">
                {MCP_SNIPPET}
              </pre>
            </div>
            <div className="px-3 py-2 bg-white border-t border-gray-100">
              <p className="text-xs text-gray-400">
                Paste into your Claude Desktop config or N8N HTTP node.
              </p>
            </div>
          </div>

          {/* SDK block */}
          <div
            className={cn(
              "rounded-xl border-2 overflow-hidden",
              sdkFirst ? "border-gray-900" : "border-gray-200"
            )}
          >
            <div
              className={cn(
                "px-3 py-2 border-b flex items-center gap-2",
                sdkFirst ? "border-gray-700 bg-gray-900" : "border-gray-100 bg-gray-50"
              )}
            >
              <Code2
                className={cn("w-3.5 h-3.5", sdkFirst ? "text-white" : "text-gray-400")}
              />
              <span
                className={cn(
                  "text-xs font-medium",
                  sdkFirst ? "text-white" : "text-gray-600"
                )}
              >
                SDK
              </span>
              {sdkFirst && (
                <span className="ml-auto text-[10px] text-gray-400">
                  Recommended for you
                </span>
              )}
            </div>
            <div className="p-3 bg-gray-950 overflow-x-auto">
              <pre className="text-xs text-emerald-400 font-mono leading-relaxed">
                {SDK_SNIPPET}
              </pre>
            </div>
            <div className="px-3 py-2 bg-white border-t border-gray-100">
              <p className="text-xs text-gray-400">npm install @opennous/sdk</p>
            </div>
          </div>
        </div>
      </div>

      <Button
        onClick={onComplete}
        disabled={isLoading}
        className="w-full bg-gray-900 hover:bg-gray-800 text-white h-11"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Setting up...
          </>
        ) : (
          "Go to dashboard"
        )}
      </Button>
    </div>
  );
}

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  CheckCircle2,
  Eye,
  EyeOff,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/sonner";

interface IntegrationConfig {
  id: string;
  name: string;
  logo: string;
  description: string;
  steps: string[];
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  helpUrl: string;
  helpLabel: string;
}

const INTEGRATION_CONFIGS: Record<string, IntegrationConfig> = {
  fireflies: {
    id: "fireflies",
    name: "Fireflies.ai",
    logo: "https://www.google.com/s2/favicons?domain=fireflies.ai&sz=128",
    description: "Connect your Fireflies account so Proply can access your meeting transcripts.",
    steps: [
      "Log in to your Fireflies.ai account",
      "Go to Settings → Integrations → API & Webhooks",
      "Click \"Create API Key\" or copy your existing key",
      "Paste the API key below",
    ],
    apiKeyLabel: "Fireflies API Key",
    apiKeyPlaceholder: "Enter your Fireflies API key",
    helpUrl: "https://fireflies.ai/integrations",
    helpLabel: "Open Fireflies Integrations",
  },
  fathom: {
    id: "fathom",
    name: "Fathom",
    logo: "https://www.google.com/s2/favicons?domain=fathom.video&sz=128",
    description: "Connect your Fathom account so Proply can access your meeting recordings and summaries.",
    steps: [
      "Log in to your Fathom account",
      "Go to Settings → API",
      "Copy your API key",
      "Paste the API key below",
    ],
    apiKeyLabel: "Fathom API Key",
    apiKeyPlaceholder: "Enter your Fathom API key",
    helpUrl: "https://fathom.video/settings",
    helpLabel: "Open Fathom Settings",
  },
  hubspot: {
    id: "hubspot",
    name: "HubSpot",
    logo: "https://www.google.com/s2/favicons?domain=hubspot.com&sz=128",
    description: "Connect HubSpot so Proply can pull deal and contact data into your proposals.",
    steps: [
      "Log in to your HubSpot account",
      "Go to Settings → Integrations → Private Apps",
      "Click \"Create a private app\"",
      "Name it \"Proply\" and select scopes: crm.objects.contacts.read, crm.objects.deals.read",
      "Click \"Create app\" and copy the access token",
      "Paste the token below",
    ],
    apiKeyLabel: "HubSpot Private App Token",
    apiKeyPlaceholder: "pat-na1-...",
    helpUrl: "https://developers.hubspot.com/docs/api/private-apps",
    helpLabel: "HubSpot Private Apps Guide",
  },
  pipedrive: {
    id: "pipedrive",
    name: "Pipedrive",
    logo: "https://www.google.com/s2/favicons?domain=pipedrive.com&sz=128",
    description: "Connect Pipedrive so Proply can pull deal and contact data into your proposals.",
    steps: [
      "Log in to your Pipedrive account",
      "Click your profile picture → Company settings",
      "Go to Personal preferences → API",
      "Copy your \"Personal API token\"",
      "Paste the token below",
    ],
    apiKeyLabel: "Pipedrive API Token",
    apiKeyPlaceholder: "Enter your Pipedrive API token",
    helpUrl: "https://pipedrive.readme.io/docs/how-to-find-the-api-token",
    helpLabel: "Find your Pipedrive API token",
  },
  stripe: {
    id: "stripe",
    name: "Stripe",
    logo: "https://www.google.com/s2/favicons?domain=stripe.com&sz=128",
    description: "Connect Stripe to collect payments directly from your proposals and invoices.",
    steps: [
      "Log in to your Stripe Dashboard",
      "Go to Developers → API keys",
      "Copy your \"Secret key\" (starts with sk_live_ or sk_test_)",
      "Paste the key below",
    ],
    apiKeyLabel: "Stripe Secret Key",
    apiKeyPlaceholder: "sk_live_...",
    helpUrl: "https://dashboard.stripe.com/apikeys",
    helpLabel: "Open Stripe API Keys",
  },
};

interface IntegrationSetupPreviewProps {
  providerId: string;
  isConnected: boolean;
  onConnected: (providerId: string) => void;
}

export function IntegrationSetupPreview({
  providerId,
  isConnected,
  onConnected,
}: IntegrationSetupPreviewProps) {
  const { session, userData } = useAuth();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [testResult, setTestResult] = useState<{
    verified: boolean;
    message: string;
  } | null>(null);

  const config = INTEGRATION_CONFIGS[providerId];
  const apiUrl = import.meta.env.VITE_API_URL ?? "";
  const workspaceId = userData?.workspace?.id;

  if (!config) return null;

  const handleConnect = async () => {
    if (!apiKey.trim() || !session?.access_token || !workspaceId) {
      toast.error(`Please enter your ${config.apiKeyLabel}`);
      return;
    }

    setConnecting(true);
    setTestResult(null);

    try {
      // Test
      const testRes = await fetch(
        `${apiUrl}/api/workflow-providers/connections/test`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            provider_id: config.id,
            credentials: { api_key: apiKey.trim() },
          }),
        }
      );

      const testData = await testRes.json();

      if (!testData.verified) {
        setTestResult({ verified: false, message: testData.message || "Connection test failed" });
        toast.error("Connection test failed");
        setConnecting(false);
        return;
      }

      // Save
      const saveRes = await fetch(
        `${apiUrl}/api/workflow-providers/connections`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            workspace_id: workspaceId,
            provider_id: config.id,
            name: config.name,
            credentials: { api_key: apiKey.trim() },
          }),
        }
      );

      if (!saveRes.ok) throw new Error("Failed to save connection");

      setTestResult({ verified: true, message: "Connected successfully" });
      onConnected(config.id);
      toast.success(`${config.name} connected!`);
    } catch (error: any) {
      toast.error(error.message || "Failed to connect");
      setTestResult({ verified: false, message: error.message || "Connection failed" });
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="w-full max-w-[340px]">
      <div className="bg-white rounded-2xl shadow-2xl shadow-gray-200/50 border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center">
              <img
                src={config.logo}
                alt={config.name}
                className="w-6 h-6 object-contain"
              />
            </div>
            <div>
              <h3 className="text-[15px] font-medium text-gray-900">
                Connect {config.name}
              </h3>
              {isConnected && (
                <div className="flex items-center gap-1 mt-0.5">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  <span className="text-[11px] text-emerald-600 font-medium">Connected</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {isConnected ? (
          <div className="p-5 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
            <p className="text-sm text-gray-700 font-medium">All set!</p>
            <p className="text-xs text-gray-400 mt-1">
              {config.name} is connected and ready to use
            </p>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* Description */}
            <p className="text-[12px] text-gray-500 leading-relaxed">
              {config.description}
            </p>

            {/* Steps */}
            <div className="space-y-2">
              <p className="text-[11px] font-medium text-gray-700 uppercase tracking-wider">
                How to connect
              </p>
              <ol className="space-y-1.5">
                {config.steps.map((step, i) => (
                  <li key={i} className="flex gap-2 text-[12px] text-gray-600">
                    <span className="w-4 h-4 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 text-[10px] font-medium text-gray-500 mt-0.5">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Help link */}
            <a
              href={config.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-emerald-600 hover:text-emerald-700 font-medium"
            >
              <ExternalLink className="w-3 h-3" />
              {config.helpLabel}
            </a>

            {/* API Key Input */}
            <div className="space-y-1.5 pt-1">
              <Label className="text-xs text-gray-500">{config.apiKeyLabel}</Label>
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={config.apiKeyPlaceholder}
                  className="h-9 bg-gray-50 border-gray-200 text-sm font-mono pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Test Result */}
            {testResult && (
              <div
                className={cn(
                  "flex items-center gap-2 p-2 rounded-lg border text-xs",
                  testResult.verified
                    ? "bg-green-50 border-green-200 text-green-700"
                    : "bg-red-50 border-red-200 text-red-700"
                )}
              >
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{testResult.message}</span>
              </div>
            )}

            {/* Connect Button */}
            <Button
              onClick={handleConnect}
              disabled={connecting || !apiKey.trim()}
              className="w-full h-9 text-sm bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {connecting ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                  Connecting...
                </>
              ) : (
                "Test & Connect"
              )}
            </Button>

            <p className="text-[10px] text-gray-400 text-center">
              Your credentials are encrypted and stored securely
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

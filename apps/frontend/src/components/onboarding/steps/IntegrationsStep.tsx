import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, ChevronDown, ChevronUp, Eye, EyeOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/sonner";

interface IntegrationDef {
  id: string;
  name: string;
  desc: string;
  logo: string;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  steps: string[];
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "hubspot",
    name: "HubSpot",
    desc: "CRM contacts & deal data",
    logo: "https://www.google.com/s2/favicons?domain=hubspot.com&sz=128",
    apiKeyLabel: "Private App Token",
    apiKeyPlaceholder: "pat-na1-...",
    steps: [
      "Go to Settings → Integrations → Private Apps",
      "Create a private app named \"Nous\"",
      "Grant scopes: crm.objects.contacts.read, crm.objects.deals.read",
      "Copy the access token",
    ],
  },
  {
    id: "pipedrive",
    name: "Pipedrive",
    desc: "CRM contacts & pipeline",
    logo: "https://www.google.com/s2/favicons?domain=pipedrive.com&sz=128",
    apiKeyLabel: "API Token",
    apiKeyPlaceholder: "Enter your Pipedrive API token",
    steps: [
      "Click your profile picture → Company settings",
      "Go to Personal preferences → API",
      "Copy your Personal API token",
    ],
  },
  {
    id: "fireflies",
    name: "Fireflies.ai",
    desc: "Meeting transcripts & notes",
    logo: "https://www.google.com/s2/favicons?domain=fireflies.ai&sz=128",
    apiKeyLabel: "API Key",
    apiKeyPlaceholder: "Enter your Fireflies API key",
    steps: [
      "Go to Settings → Integrations → API & Webhooks",
      "Click \"Create API Key\" or copy your existing key",
    ],
  },
  {
    id: "fathom",
    name: "Fathom",
    desc: "Call recordings & summaries",
    logo: "https://www.google.com/s2/favicons?domain=fathom.video&sz=128",
    apiKeyLabel: "API Key",
    apiKeyPlaceholder: "Enter your Fathom API key",
    steps: [
      "Go to Settings → API",
      "Copy your API key",
    ],
  },
  {
    id: "stripe",
    name: "Stripe",
    desc: "Payment & invoice signals",
    logo: "https://www.google.com/s2/favicons?domain=stripe.com&sz=128",
    apiKeyLabel: "Secret Key",
    apiKeyPlaceholder: "sk_live_...",
    steps: [
      "Go to Developers → API keys",
      "Copy your Secret key (starts with sk_live_ or sk_test_)",
    ],
  },
];

interface InlineConnectFormProps {
  integration: IntegrationDef;
  onConnected: (id: string) => void;
}

function InlineConnectForm({ integration, onConnected }: InlineConnectFormProps) {
  const { session, userData } = useAuth();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const apiUrl = import.meta.env.VITE_API_URL ?? "";

  const handleConnect = async () => {
    const workspaceId = userData?.workspace?.id;
    if (!apiKey.trim() || !session?.access_token || !workspaceId) {
      toast.error(`Please enter your ${integration.apiKeyLabel}`);
      return;
    }

    setConnecting(true);
    try {
      const testRes = await fetch(`${apiUrl}/api/workflow-providers/connections/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          provider_id: integration.id,
          credentials: { api_key: apiKey.trim() },
        }),
      });

      const testData = await testRes.json();
      if (!testData.verified) {
        toast.error(testData.message || "Connection test failed");
        return;
      }

      const saveRes = await fetch(`${apiUrl}/api/workflow-providers/connections`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          provider_id: integration.id,
          name: integration.name,
          credentials: { api_key: apiKey.trim() },
        }),
      });

      if (!saveRes.ok) throw new Error("Failed to save connection");

      toast.success(`${integration.name} connected!`);
      onConnected(integration.id);
    } catch (e: any) {
      toast.error(e.message || "Failed to connect");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="space-y-3 pt-1">
      <ol className="space-y-1.5">
        {integration.steps.map((step, i) => (
          <li key={i} className="flex gap-2 text-xs text-gray-500">
            <span className="w-4 h-4 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 text-[10px] font-medium text-gray-500 mt-0.5">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <div className="relative">
        <Input
          type={showKey ? "text" : "password"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={integration.apiKeyPlaceholder}
          className="h-9 bg-gray-50 border-gray-200 text-sm font-mono pr-9"
          onKeyDown={(e) => e.key === "Enter" && handleConnect()}
        />
        <button
          type="button"
          onClick={() => setShowKey(!showKey)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>

      <Button
        onClick={handleConnect}
        disabled={connecting || !apiKey.trim()}
        size="sm"
        className="w-full h-8 text-sm bg-gray-900 hover:bg-gray-800 text-white"
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
        Credentials are encrypted and stored securely
      </p>
    </div>
  );
}

interface IntegrationsStepProps {
  connectedIntegrations: string[];
  onConnected: (id: string) => void;
  onNext: () => void;
}

export function IntegrationsStep({
  connectedIntegrations,
  onConnected,
  onNext,
}: IntegrationsStepProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const handleConnected = (id: string) => {
    onConnected(id);
    setExpanded(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Connect your tools</h1>
        <p className="text-sm text-gray-500 mt-1">
          Each integration adds richer context for your agents. You can connect more later.
        </p>
      </div>

      <div className="space-y-2">
        {INTEGRATIONS.map((integration) => {
          const { id, name, desc, logo } = integration;
          const connected = connectedIntegrations.includes(id);
          const isExpanded = expanded === id;

          return (
            <div
              key={id}
              className={cn(
                "rounded-xl border-2 overflow-hidden transition-all",
                connected ? "border-emerald-200 bg-emerald-50/40" : "border-gray-200 bg-white"
              )}
            >
              <button
                onClick={() => !connected && setExpanded(isExpanded ? null : id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white border border-gray-100 flex items-center justify-center flex-shrink-0 shadow-sm">
                    <img src={logo} alt={name} className="w-5 h-5 object-contain" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{name}</p>
                    <p className="text-xs text-gray-400">{desc}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {connected ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <>
                      <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
                        Connect
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      )}
                    </>
                  )}
                </div>
              </button>

              {isExpanded && !connected && (
                <div className="border-t border-gray-100 px-4 pb-4">
                  <InlineConnectForm
                    integration={integration}
                    onConnected={handleConnected}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Button
        onClick={onNext}
        className="w-full bg-gray-900 hover:bg-gray-800 text-white h-11"
      >
        {connectedIntegrations.length > 0 ? "Continue" : "Skip for now"}
      </Button>
    </div>
  );
}

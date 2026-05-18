import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  ArrowRight,
  Loader2,
  CheckCircle2,
} from "lucide-react";

const CRM_PROVIDERS = [
  {
    id: "hubspot",
    name: "HubSpot",
    logo: "https://www.google.com/s2/favicons?domain=hubspot.com&sz=128",
  },
  {
    id: "pipedrive",
    name: "Pipedrive",
    logo: "https://www.google.com/s2/favicons?domain=pipedrive.com&sz=128",
  },
];

interface CrmStepProps {
  onNext: () => void;
  isLoading: boolean;
  connectedCrm: string | null;
  selectedCrm: string;
  setSelectedCrm: (value: string) => void;
}

export function CrmStep({
  onNext,
  isLoading,
  connectedCrm,
  selectedCrm,
  setSelectedCrm,
}: CrmStepProps) {
  const isConnected = !!connectedCrm;
  const connectedProvider = CRM_PROVIDERS.find((p) => p.id === connectedCrm);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-[26px] font-normal text-gray-900 tracking-[-0.02em] mb-1">
          Connect your CRM
        </h1>
        <p className="text-gray-500 text-[14px] font-light">
          Proply pulls deal context to create personalized proposals
        </p>
      </div>

      {/* Dropdown */}
      <div className="space-y-2">
        <Label className="text-sm font-medium text-gray-700">Select your CRM</Label>
        <Select
          value={selectedCrm}
          onValueChange={setSelectedCrm}
          disabled={isConnected}
        >
          <SelectTrigger className="h-11 rounded-lg">
            <SelectValue placeholder="Choose a CRM" />
          </SelectTrigger>
          <SelectContent>
            {CRM_PROVIDERS.map((provider) => (
              <SelectItem key={provider.id} value={provider.id}>
                <div className="flex items-center gap-2">
                  <img
                    src={provider.logo}
                    alt={provider.name}
                    className="w-4 h-4 object-contain"
                  />
                  {provider.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Connected badge */}
      {isConnected && connectedProvider && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span className="text-sm text-emerald-700 font-medium">
            {connectedProvider.name} connected successfully
          </span>
        </div>
      )}

      {/* Hint */}
      {selectedCrm && !isConnected && (
        <p className="text-[12px] text-gray-400">
          Follow the setup instructions on the right to connect your account
        </p>
      )}

      {/* Coming soon */}
      <p className="text-[11px] text-gray-400">
        More CRMs coming soon — Zoho, Close
      </p>

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

      {!connectedCrm && (
        <button
          onClick={onNext}
          className="w-full text-center text-[13px] text-gray-400 hover:text-gray-600 transition-colors"
        >
          Skip for now
        </button>
      )}
    </div>
  );
}

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

interface StripeStepProps {
  onNext: () => void;
  isLoading: boolean;
  connectedStripe: string | null;
  selectedStripe: string;
  setSelectedStripe: (value: string) => void;
}

export function StripeStep({
  onNext,
  isLoading,
  connectedStripe,
  selectedStripe,
  setSelectedStripe,
}: StripeStepProps) {
  const isConnected = !!connectedStripe;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-[26px] font-normal text-gray-900 tracking-[-0.02em] mb-1">
          Connect Stripe
        </h1>
        <p className="text-gray-500 text-[14px] font-light">
          Collect payments directly from your proposals and invoices
        </p>
      </div>

      {/* Dropdown */}
      <div className="space-y-2">
        <Label className="text-sm font-medium text-gray-700">Payment provider</Label>
        <Select
          value={selectedStripe}
          onValueChange={setSelectedStripe}
          disabled={isConnected}
        >
          <SelectTrigger className="h-11 rounded-lg">
            <SelectValue placeholder="Choose a provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stripe">
              <div className="flex items-center gap-2">
                <img
                  src="https://www.google.com/s2/favicons?domain=stripe.com&sz=128"
                  alt="Stripe"
                  className="w-4 h-4 object-contain"
                />
                Stripe
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Connected badge */}
      {isConnected && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span className="text-sm text-emerald-700 font-medium">
            Stripe connected successfully
          </span>
        </div>
      )}

      {/* Hint */}
      {selectedStripe && !isConnected && (
        <p className="text-[12px] text-gray-400">
          Follow the setup instructions on the right to connect your Stripe account
        </p>
      )}

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

      {!connectedStripe && (
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

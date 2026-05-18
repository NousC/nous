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

interface MeetingNotesStepProps {
  onNext: () => void;
  isLoading: boolean;
  connectedMeetingTool: string | null;
  selectedMeetingTool: string;
  setSelectedMeetingTool: (value: string) => void;
}

export function MeetingNotesStep({
  onNext,
  isLoading,
  connectedMeetingTool,
  selectedMeetingTool,
  setSelectedMeetingTool,
}: MeetingNotesStepProps) {
  const isConnected = !!connectedMeetingTool;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-[26px] font-normal text-gray-900 tracking-[-0.02em] mb-1">
          Connect your meeting notes
        </h1>
        <p className="text-gray-500 text-[14px] font-light">
          Nous turns your meeting transcripts into ready-to-send proposals
        </p>
      </div>

      {/* Dropdown */}
      <div className="space-y-2">
        <Label className="text-sm font-medium text-gray-700">Select your meeting tool</Label>
        <Select
          value={selectedMeetingTool}
          onValueChange={setSelectedMeetingTool}
          disabled={isConnected}
        >
          <SelectTrigger className="h-11 rounded-lg">
            <SelectValue placeholder="Choose a tool" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fireflies">
              <div className="flex items-center gap-2">
                <img
                  src="https://www.google.com/s2/favicons?domain=fireflies.ai&sz=128"
                  alt="Fireflies"
                  className="w-4 h-4 object-contain"
                />
                Fireflies.ai
              </div>
            </SelectItem>
            <SelectItem value="fathom">
              <div className="flex items-center gap-2">
                <img
                  src="https://www.google.com/s2/favicons?domain=fathom.video&sz=128"
                  alt="Fathom"
                  className="w-4 h-4 object-contain"
                />
                Fathom
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
            {connectedMeetingTool === 'fathom' ? 'Fathom' : 'Fireflies.ai'} connected successfully
          </span>
        </div>
      )}

      {/* Hint */}
      {selectedMeetingTool && !isConnected && (
        <p className="text-[12px] text-gray-400">
          Follow the setup instructions on the right to connect your account
        </p>
      )}

      {/* Coming soon */}
      <p className="text-[11px] text-gray-400">
        More coming soon — Otter.ai, Fathom, Granola
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

      {!isConnected && (
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

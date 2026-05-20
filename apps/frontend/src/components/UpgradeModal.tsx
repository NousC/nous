import { createPortal } from "react-dom";

/**
 * Plan-gate upgrade prompt. Shown when a user hits a workspace limit or tries
 * to use a feature their plan doesn't include. Self-contained overlay so it
 * works from any surface (Mind page, settings popups, etc.).
 */
export interface UpgradePrompt {
  /** Short headline, e.g. "Workspace limit reached". */
  title: string;
  /** One- or two-sentence explanation of what's locked. */
  message: string;
  /** Plan that unlocks it, e.g. "Pro" or "Scale". Optional. */
  requiredPlan?: string;
}

interface Props {
  prompt: UpgradePrompt | null;
  onClose: () => void;
  /** Called when the user clicks the upgrade CTA — open billing. */
  onUpgrade: () => void;
}

export default function UpgradeModal({ prompt, onClose, onUpgrade }: Props) {
  if (!prompt) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[400px] max-w-[92vw] rounded-xl border border-border bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {prompt.requiredPlan ? (
          <div className="mb-3 inline-flex items-center rounded-md bg-violet-500/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-violet-500">
            {prompt.requiredPlan} plan
          </div>
        ) : null}

        <h2 className="text-base font-semibold text-foreground">{prompt.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {prompt.message}
        </p>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="h-9 rounded-md border border-border px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Not now
          </button>
          <button
            onClick={onUpgrade}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-4 text-sm font-medium text-background transition-transform hover:scale-[1.02]"
          >
            {prompt.requiredPlan ? `Upgrade to ${prompt.requiredPlan}` : "View plans"}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

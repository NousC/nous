import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, PartyPopper, X } from "lucide-react";
import { useChecklist, type Checklist } from "@/hooks/useChecklist";

const LAST_SEEN_KEY  = "nous_checklist_last_seen";
const CELEBRATED_KEY = "nous_checklist_celebrated";
const JUST_ONBOARDED = "nous_just_onboarded";

// ── Inline card for the Settings → Profile page ───────────────────────────────
// Hidden once the user has completed all steps. Stays hidden afterwards.
export function ChecklistCard() {
  const { data } = useChecklist();
  if (!data || data.completed_count >= data.total) return null;
  return <ChecklistBody data={data} dense={false} />;
}

// ── Floating top-right toast — pops on milestones, auto-dismisses ─────────────
// Triggers on: (a) first paint after onboarding completes, (b) any time the
// completed count rises, (c) hitting total → fires the celebration.
export function ChecklistToast() {
  const { data } = useChecklist();
  const [open, setOpen] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!data) return;
    const lastSeen = Number(localStorage.getItem(LAST_SEEN_KEY) ?? "0");
    const justOnboarded = localStorage.getItem(JUST_ONBOARDED) === "true";
    const shouldPop = justOnboarded || data.completed_count > lastSeen;

    if (shouldPop) {
      setOpen(true);
      localStorage.setItem(LAST_SEEN_KEY, String(data.completed_count));
      localStorage.removeItem(JUST_ONBOARDED);

      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(() => setOpen(false), 6000);
    }

    if (
      data.completed_count === data.total &&
      localStorage.getItem(CELEBRATED_KEY) !== "true"
    ) {
      localStorage.setItem(CELEBRATED_KEY, "true");
      setCelebrating(true);
      setTimeout(() => setCelebrating(false), 4000);
    }
  }, [data]);

  useEffect(() => () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
  }, []);

  return (
    <>
      {open && data && (
        <div className="fixed top-4 right-4 z-[70] w-80 rounded-xl border border-border bg-background shadow-lg overflow-hidden animate-in slide-in-from-top-2 fade-in duration-200">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-foreground">
                {data.completed_count === data.total
                  ? "All set — you're done!"
                  : `${data.completed_count} of ${data.total} steps complete`}
              </div>
              <div className="text-[12px] text-muted-foreground">
                {data.completed_count === data.total
                  ? "Nice work."
                  : "Keep going to finish setting up Nous."}
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground flex-shrink-0"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <ul className="py-1">
            {data.steps.map((s) => (
              <li key={s.id}>
                <Link
                  to={s.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-4 py-2 hover:bg-accent transition-colors"
                >
                  {s.completed ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}
                  <span className={`text-[13px] ${s.completed ? "text-muted-foreground line-through" : "text-foreground"}`}>
                    {s.label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {celebrating && <Celebration />}
    </>
  );
}

// ── Shared body ──────────────────────────────────────────────────────────────
function ChecklistBody({ data, dense }: { data: Checklist; dense: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-background overflow-hidden">
      <div className={`${dense ? "px-4 py-3" : "px-5 py-4"} border-b border-border`}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-[13px] font-semibold text-foreground">Finish setting up</div>
          <div className="text-[12px] font-medium text-muted-foreground tabular-nums">
            {data.completed_count} / {data.total}
          </div>
        </div>
        <div className="mt-2 h-1 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-foreground transition-all duration-300"
            style={{ width: `${(data.completed_count / data.total) * 100}%` }}
          />
        </div>
      </div>
      <ul className="py-1">
        {data.steps.map((s) => (
          <li key={s.id}>
            <Link
              to={s.href}
              className="flex items-center gap-3 px-5 py-2.5 hover:bg-accent transition-colors"
            >
              {s.completed ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              )}
              <span className={`text-[13px] ${s.completed ? "text-muted-foreground line-through" : "text-foreground"}`}>
                {s.label}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Celebration overlay ──────────────────────────────────────────────────────
function Celebration() {
  return (
    <div className="fixed inset-0 z-[90] pointer-events-none flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 px-8 py-7 rounded-2xl bg-background/90 border border-border shadow-xl animate-in zoom-in-50 fade-in duration-300">
        <div className="relative">
          <PartyPopper className="h-12 w-12 text-emerald-600 animate-bounce" />
          <span className="absolute -top-1 -left-2 text-2xl animate-pulse">✨</span>
          <span className="absolute -top-2 -right-3 text-2xl animate-pulse [animation-delay:120ms]">🎉</span>
          <span className="absolute -bottom-1 -left-3 text-xl animate-pulse [animation-delay:240ms]">⭐</span>
        </div>
        <div className="text-[16px] font-semibold text-foreground">All five done.</div>
        <div className="text-[13px] text-muted-foreground">Your workspace is fully wired up.</div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const API_URL = import.meta.env.VITE_API_URL ?? "";

// Browser approval page for the CLI / plugin device-login flow. The CLI opens
// /cli-login?code=<user_code>; the signed-in user approves, which mints an API
// key for their current workspace. The CLI's next poll picks it up.
export default function CliLogin() {
  const [params] = useSearchParams();
  const code = params.get("code") || "";
  const { session, userData } = useAuth();
  const workspaceId = (userData as { workspace?: { id?: string } })?.workspace?.id;
  const workspaceName = (userData as { workspace?: { name?: string } })?.workspace?.name;

  const [state, setState] = useState<"idle" | "approving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const approve = async () => {
    if (!session?.access_token || !workspaceId) {
      setError("Couldn't read your session. Reload and try again.");
      setState("error");
      return;
    }
    setState("approving");
    try {
      const r = await fetch(`${API_URL}/api/cli/auth/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ user_code: code, workspace_id: workspaceId }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error === "expired" ? "This sign-in expired. Run the command again." : "Couldn't authorize. Run the command again.");
      }
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setState("error");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-background shadow-sm p-8 text-center">
        {!code ? (
          <>
            <h1 className="text-[18px] font-semibold text-foreground">Missing sign-in code</h1>
            <p className="mt-2 text-[13px] text-muted-foreground">Start from your terminal with the Nous login command.</p>
          </>
        ) : state === "done" ? (
          <>
            <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 text-[20px]">✓</div>
            <h1 className="text-[18px] font-semibold text-foreground">You're connected</h1>
            <p className="mt-2 text-[13px] text-muted-foreground">Return to your terminal. Your agent is ready to set up Nous.</p>
          </>
        ) : (
          <>
            <h1 className="text-[18px] font-semibold text-foreground">Connect Nous to your agent</h1>
            <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
              Approve to create an API key for{" "}
              <span className="font-semibold text-foreground">{workspaceName || "your workspace"}</span>{" "}
              and finish signing in from the terminal.
            </p>
            {error && <p className="mt-3 text-[12.5px] text-red-600">{error}</p>}
            <button
              onClick={approve}
              disabled={state === "approving"}
              className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-5 text-[14px] font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {state === "approving" ? "Authorizing…" : "Approve"}
            </button>
            <p className="mt-3 text-[11.5px] text-muted-foreground/70">
              Only approve if you just ran the Nous login command yourself.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

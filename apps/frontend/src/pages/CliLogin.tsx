import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import GraphField from "@/components/GraphField";

const API_URL = import.meta.env.VITE_API_URL ?? "";

const PAGE_STYLE = {
  backgroundColor: "#f6f1e9",
  backgroundImage:
    "radial-gradient(1100px 700px at 78% -8%, rgba(217,119,87,0.07), transparent 60%), radial-gradient(900px 600px at 12% 108%, rgba(191,86,48,0.05), transparent 60%)",
} as const;

const BOX_SHADOW = {
  boxShadow:
    "0 1px 0 rgba(255,255,255,0.8) inset, 0 18px 50px -22px rgba(42,36,32,0.28), 0 6px 18px -12px rgba(191,86,48,0.16)",
} as const;

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
    <div
      className="relative overflow-hidden min-h-screen flex items-center justify-center px-4 font-mono text-[#2a2420]"
      style={PAGE_STYLE}
    >
      <GraphField />
      <div
        className="relative z-10 w-full max-w-[400px] overflow-hidden rounded-lg border border-[#e4d9c8] bg-[#fffdf9]"
        style={BOX_SHADOW}
      >
        {/* title bar */}
        <div className="flex items-center gap-2 border-b border-[#e4d9c8] px-4 py-2 text-xs text-[#8a7e6f]">
          <span className="text-[#b5532f]/80">●</span>
          <span className="text-[#d97757]/70">●</span>
          <span className="text-[#bf5630]/70">●</span>
          <span className="ml-1">nous — connect cli</span>
        </div>

        <div className="p-6 text-center">
          <div className="flex items-center justify-center gap-2">
            <img src="/nous-logo.svg" alt="" className="w-5 h-5 object-contain" />
            <span className="font-bold text-[14px] tracking-[-0.02em] text-[#2a2420]">nous</span>
          </div>

          {!code ? (
            <>
              <h1 className="mt-4 text-[20px] font-bold tracking-[-0.02em] text-[#2a2420]">
                Missing sign-in code
              </h1>
              <p className="mt-1 text-xs text-[#8a7e6f]">
                Start from your terminal with the Nous login command.
              </p>
            </>
          ) : state === "done" ? (
            <>
              <div className="mx-auto mt-4 mb-3 grid h-10 w-10 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 text-[20px]">
                ✓
              </div>
              <h1 className="text-[20px] font-bold tracking-[-0.02em] text-[#2a2420]">
                You&apos;re connected
              </h1>
              <p className="mt-1 text-xs text-[#8a7e6f]">
                Return to your terminal. Your agent is ready to set up Nous.
              </p>
            </>
          ) : (
            <>
              <h1 className="mt-4 text-[20px] font-bold tracking-[-0.02em] text-[#2a2420]">
                Connect Nous to your agent
              </h1>
              <p className="mt-1 text-xs text-[#8a7e6f] leading-relaxed">
                Approve to create an API key for{" "}
                <span className="font-semibold text-[#2a2420]">{workspaceName || "your workspace"}</span>{" "}
                and finish signing in from the terminal.
              </p>
              {error && <p className="mt-3 text-[12.5px] text-[#b5532f]">{error}</p>}
              <button
                onClick={approve}
                disabled={state === "approving"}
                className="mt-5 w-full h-12 rounded-lg pl-5 pr-1.5 flex items-center justify-between gap-2 font-medium text-sm bg-[#d97757] hover:brightness-110 text-[#fffdf9] transition-transform hover:scale-[1.005] disabled:opacity-60 disabled:hover:scale-100"
              >
                <span>{state === "approving" ? "Authorizing…" : "Approve"}</span>
                <span
                  className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-[#fffdf9] text-[#d97757]"
                  aria-hidden="true"
                >
                  →
                </span>
              </button>
              <p className="mt-3 text-[11.5px] text-[#8a7e6f]/80">
                Only approve if you just ran the Nous login command yourself.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

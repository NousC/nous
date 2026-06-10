import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const API_URL = import.meta.env.VITE_API_URL ?? "";

const STEPS: { caption: string; code: string }[] = [
  { caption: "1. Add the Nous plugin marketplace", code: "/plugin marketplace add NousC/nous" },
  { caption: "2. Install the Nous plugin", code: "/plugin install nous@nous-plugins" },
  { caption: "3. Sign in — opens your browser, saves your key", code: "npx @opennous/cli login" },
  { caption: "4. Onboard — paste this to your agent", code: "Set me up — onboard my workspace and build my playbook." },
];

function Cmd({ caption, code }: { caption: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <div>
      <div className="text-[11px] text-muted-foreground/70 mb-1">{caption}</div>
      <button
        onClick={copy}
        title="Copy"
        className="group flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-left hover:border-border/80 transition-colors"
      >
        <code className="text-[13px] font-mono text-foreground/90 truncate">{code}</code>
        {copied
          ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
          : <Copy className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-foreground/70 flex-shrink-0" />}
      </button>
    </div>
  );
}

// Full-screen first-run gate. Shown (with NO sidebar / app chrome) until the
// agent has onboarded the workspace. The app is unreachable until then — the
// only thing to do is connect the agent, which then onboards the workspace and
// unlocks Nous. Mounted by AppRoutes before the app shell.
export default function ConnectGate() {
  const { session, userData, refreshUserData, signOut } = useAuth() as ReturnType<typeof useAuth> & { signOut?: () => void };
  const navigate = useNavigate();
  const token = session?.access_token;
  const workspaceId = (userData as { workspace?: { id?: string } })?.workspace?.id;
  const email = (userData as { user?: { email?: string } })?.user?.email;

  // First-run activation: welcome email, free-plan backstop, dogfood. Idempotent
  // server-side, so firing once on this screen is safe.
  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/api/onboarding/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => {});
  }, [token]);

  // Poll setup status; reflect connect + onboard live, and unlock when done.
  useEffect(() => {
    if (!token || !workspaceId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const r = await fetch(`${API_URL}/api/onboarding/status?workspace_id=${workspaceId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return;
        const d = await r.json();
        if (stopped) return;
        if (d.onboarded) { await refreshUserData(); navigate("/intelligence", { replace: true }); }
      } catch { /* keep polling */ }
    };
    tick();
    const iv = setInterval(tick, 4000);
    return () => { stopped = true; clearInterval(iv); };
  }, [token, workspaceId, refreshUserData, navigate]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-[560px]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <img src="/nous-logo.svg" alt="" className="w-5 h-5 object-contain" />
            <span className="font-bold text-[14px] tracking-[-0.02em] text-foreground">nous</span>
          </div>
          {email && (
            <button onClick={() => signOut?.()} className="text-[12px] text-muted-foreground/70 hover:text-foreground transition-colors">
              {email} · sign out
            </button>
          )}
        </div>

        <div className="rounded-2xl border border-border/60 bg-background shadow-sm p-6 sm:p-8">
          <h1 className="text-[19px] font-semibold tracking-tight text-foreground">Connect Nous to your agent</h1>
          <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed">
            Set up happens inside Claude. Run these in Claude Code, then let your agent onboard you. This unlocks the moment it's done.
          </p>

          <div className="mt-5 space-y-3">
            {STEPS.map(s => <Cmd key={s.caption} caption={s.caption} code={s.code} />)}
          </div>

          <p className="text-[11.5px] text-muted-foreground/60 mt-6">
            On Cursor, Codex, or n8n? See the <a href="https://docs.opennous.cloud/mcp/introduction" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">install docs</a>.
          </p>
        </div>
      </div>
    </div>
  );
}

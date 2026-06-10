import { useState, useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, CheckCircle2, Plug } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const API_URL = import.meta.env.VITE_API_URL ?? "";

const ONBOARD_PROMPT = "Set me up — onboard my workspace and build my playbook.";
const LOGIN = "npx @opennous/cli login";
const LOGO_CLAUDE = "/provider-logos/claude.svg";
const LOGO_CODEX = "/provider-logos/codex.png";

type Step = { caption: string; code: string };
const TABS: { id: string; label: string; icon: ReactNode; steps: Step[] }[] = [
  {
    id: "claude",
    label: "Claude Code",
    icon: <img src={LOGO_CLAUDE} alt="" className="w-3.5 h-3.5 object-contain" />,
    steps: [
      { caption: "1. Add the Nous plugin marketplace", code: "/plugin marketplace add NousC/nous" },
      { caption: "2. Install the Nous plugin", code: "/plugin install nous@nous-plugins" },
      { caption: "3. Sign in — opens your browser, saves your key", code: LOGIN },
      { caption: "4. Onboard — paste this to your agent", code: ONBOARD_PROMPT },
    ],
  },
  {
    id: "codex",
    label: "Codex",
    icon: <img src={LOGO_CODEX} alt="" className="w-3.5 h-3.5 object-contain" />,
    steps: [
      { caption: "1. Add Nous to ~/.codex/config.toml", code: `[mcp_servers.nous]\ncommand = "npx"\nargs = ["-y", "@opennous/mcp"]` },
      { caption: "2. Sign in — opens your browser, saves your key", code: LOGIN },
      { caption: "3. Onboard — paste this to your agent", code: ONBOARD_PROMPT },
    ],
  },
  {
    id: "other",
    label: "Other MCP",
    icon: <Plug className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={1.75} />,
    steps: [
      { caption: "1. Add the Nous MCP server to your client config", code: `{\n  "mcpServers": {\n    "nous": {\n      "command": "npx",\n      "args": ["-y", "@opennous/mcp"]\n    }\n  }\n}` },
      { caption: "2. Sign in — opens your browser, saves your key", code: LOGIN },
      { caption: "3. Onboard — paste this to your agent", code: ONBOARD_PROMPT },
    ],
  },
];

function Cmd({ caption, code }: Step) {
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
        className="group flex w-full items-start justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-left hover:border-border/80 transition-colors"
      >
        <pre className="m-0 flex-1 overflow-x-auto whitespace-pre text-[13px] font-mono text-foreground/90">{code}</pre>
        {copied
          ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />
          : <Copy className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-foreground/70 flex-shrink-0 mt-0.5" />}
      </button>
    </div>
  );
}

// Full-screen first-run gate. Shown (with NO sidebar / app chrome) until the
// agent has onboarded the workspace. Onboarding is client-agnostic: whichever
// agent (Claude Code, Codex, …) calls set_workspace_profile sets business_type,
// which this screen detects by polling and then unlocks the app.
export default function ConnectGate() {
  const { session, userData, refreshUserData, signOut } = useAuth();
  const navigate = useNavigate();
  const token = session?.access_token;
  const workspaceId = (userData as { workspace?: { id?: string } })?.workspace?.id;
  const email = (userData as { user?: { email?: string } })?.user?.email;
  const [tab, setTab] = useState("claude");
  const [celebrating, setCelebrating] = useState(false);

  const active = TABS.find(t => t.id === tab) ?? TABS[0];

  // First-run activation: welcome email, free-plan backstop, dogfood. Idempotent.
  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/api/onboarding/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => {});
  }, [token]);

  // Poll setup status and unlock the app the moment the agent onboards.
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
        if (d.onboarded) setCelebrating(true);
      } catch { /* keep polling */ }
    };
    tick();
    const iv = setInterval(tick, 4000);
    return () => { stopped = true; clearInterval(iv); };
  }, [token, workspaceId]);

  // Onboarded → celebrate briefly, then open the Ops page (the live op log of
  // what the agent just did).
  useEffect(() => {
    if (!celebrating) return;
    refreshUserData();
    const t = setTimeout(() => navigate("/ops", { replace: true }), 1900);
    return () => clearTimeout(t);
  }, [celebrating, refreshUserData, navigate]);

  const skip = () => {
    try { if (workspaceId) localStorage.setItem(`nous_connect_skipped:${workspaceId}`, "1"); } catch { /* ignore */ }
    navigate("/", { replace: true });
  };

  if (celebrating) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background animate-in fade-in duration-300">
        <div className="flex flex-col items-center text-center">
          <div className="relative grid h-16 w-16 place-items-center">
            <span className="absolute h-16 w-16 rounded-full bg-emerald-500/20 animate-ping" />
            <span className="relative grid h-16 w-16 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 animate-in zoom-in duration-500">
              <CheckCircle2 className="h-9 w-9" />
            </span>
          </div>
          <div className="mt-5 text-[19px] font-semibold tracking-tight text-foreground animate-in fade-in slide-in-from-bottom-1 duration-500">
            You're all set
          </div>
          <div className="mt-1 text-[13px] text-muted-foreground">Opening your workspace…</div>
        </div>
      </div>
    );
  }

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
            Set up happens inside your agent. Connect it, then say <span className="text-foreground font-medium">“set me up”</span>. This unlocks the moment your workspace is onboarded.
          </p>

          {/* Client tabs */}
          <div className="mt-5 inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors ${
                  t.id === tab ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-3">
            {active.steps.map(s => <Cmd key={s.caption} caption={s.caption} code={s.code} />)}
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <p className="text-[11.5px] text-muted-foreground/60">
              Other client? See the <a href="https://docs.opennous.cloud/mcp/introduction" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">install docs</a>.
            </p>
            <button onClick={skip} className="text-[11.5px] text-muted-foreground/60 hover:text-foreground transition-colors whitespace-nowrap">
              Skip for now →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

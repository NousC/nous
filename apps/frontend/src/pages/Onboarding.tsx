import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import {
  Check, Copy, Eye, EyeOff, Key, RefreshCw, ExternalLink, Sparkles,
} from "lucide-react";
import { PeopleImportPanel } from "@/components/contacts/PeopleImportModal";

// ─── Option sets ─────────────────────────────────────────────────────────────
const USE_CASES = [
  { id: "gtm_agent",            label: "GTM agent" },
  { id: "ai_sdr",               label: "AI SDR" },
  { id: "outbound",             label: "outbound" },
  { id: "sales_assistant",      label: "sales assistant" },
  { id: "customer_success",     label: "customer success" },
  { id: "meeting_intelligence", label: "meeting intel" },
  { id: "custom",               label: "custom" },
];

const TOTAL_STEPS = 3;
const STORAGE_KEY = "nous_onboarding_v6";
const API_URL    = import.meta.env.VITE_API_URL ?? "";
const MONO       = { fontFamily: "'JetBrains Mono',monospace" };

// ─── Tiny primitives ─────────────────────────────────────────────────────────
function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <div className="text-[9px] text-muted-foreground/40 tracking-widest mb-1.5">
      {children}
      {optional && <span className="ml-1.5 text-muted-foreground/25 normal-case">optional</span>}
    </div>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={
        "w-full bg-muted/20 border border-border/40 text-[11px] text-foreground px-3 py-2 outline-none " +
        "placeholder:text-muted-foreground/25 focus:border-violet-500/40 transition-colors " +
        (props.className ?? "")
      }
    />
  );
}

function StepTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h2 className="text-[13px] font-medium text-foreground leading-tight">{title}</h2>
      <p className="text-[10px] text-muted-foreground/45 leading-relaxed mt-1">{desc}</p>
    </div>
  );
}

function ChipGroup({
  options, value, onChange,
}: {
  options: { id: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(({ id, label }) => {
        const selected = value.includes(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => toggle(id)}
            className={`text-[10px] px-2.5 py-1 border transition-colors ${
              selected
                ? "border-violet-500/50 text-violet-400/80 bg-violet-500/10"
                : "border-border/40 text-muted-foreground/50 hover:border-border/70"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function PrimaryButton({
  onClick, disabled, loading, children, full = true,
}: { onClick: () => void; disabled?: boolean; loading?: boolean; children: React.ReactNode; full?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={
        (full ? "w-full " : "") +
        "flex items-center justify-center gap-2 text-[11px] py-2 px-4 " +
        "bg-violet-500/20 border border-violet-500/30 text-violet-400/80 hover:bg-violet-500/30 " +
        "transition-colors disabled:opacity-30"
      }
    >
      {loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
      {children}
    </button>
  );
}

function GhostButton({
  onClick, disabled, children,
}: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-[10px] px-3 py-2 border border-border/40 text-muted-foreground/50 hover:border-border/70 hover:text-foreground/70 transition-colors disabled:opacity-30"
    >
      {children}
    </button>
  );
}

// ─── Step 1: Welcome ─────────────────────────────────────────────────────────
function StepWelcome({
  companyName, setCompanyName,
  website, setWebsite,
  useCases, setUseCases,
  onNext, isLoading,
}: {
  companyName: string; setCompanyName: (v: string) => void;
  website: string; setWebsite: (v: string) => void;
  useCases: string[]; setUseCases: (v: string[]) => void;
  onNext: () => void; isLoading: boolean;
}) {
  return (
    <div className="space-y-5">
      <StepTitle
        title="Welcome to Nous"
        desc="A few details so your memory layer knows what you're building."
      />

      <div>
        <FieldLabel>company</FieldLabel>
        <TextInput
          value={companyName}
          onChange={e => setCompanyName(e.target.value)}
          placeholder="acme corp"
          autoFocus
        />
      </div>

      <div>
        <FieldLabel optional>website</FieldLabel>
        <TextInput
          value={website}
          onChange={e => setWebsite(e.target.value)}
          placeholder="https://yourcompany.com"
          type="url"
        />
      </div>

      <div>
        <FieldLabel>what are you building?</FieldLabel>
        <ChipGroup options={USE_CASES} value={useCases} onChange={setUseCases} />
      </div>

      <PrimaryButton onClick={onNext} disabled={!companyName.trim()} loading={isLoading}>
        continue
      </PrimaryButton>
    </div>
  );
}

// ─── Step 2: Import contacts (real column-mapping importer) ──────────────────
function StepImport({
  onAdvance, onBack, onSkip, session, workspaceId, testMode,
}: {
  onAdvance: () => void;
  onBack: () => void;
  onSkip: () => void;
  session: any;
  workspaceId: string | undefined;
  testMode?: boolean;
}) {
  return (
    <div className="space-y-4">
      <StepTitle
        title="Bring your contacts in"
        desc="Drop a CSV and map columns to Nous fields. Skip to start with demo data."
      />

      <div className="border border-border/30 -mx-5">
        <PeopleImportPanel
          workspaceId={workspaceId ?? ""}
          token={session?.access_token ?? ""}
          onDone={onAdvance}
          onClose={onAdvance}
          testMode={testMode}
        />
      </div>

      <div className="flex items-center justify-between pt-1">
        <button
          onClick={onBack}
          className="text-[10px] text-muted-foreground/40 hover:text-foreground/60 transition-colors"
        >
          ← back
        </button>
        <button
          onClick={onSkip}
          className="text-[10px] text-violet-400/70 hover:text-violet-400 transition-colors"
        >
          skip — use demo data
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Create API key ──────────────────────────────────────────────────
function StepCreateKey({
  apiKey, generateKey, generating, onFinish, onBack,
}: {
  apiKey: string | null;
  generateKey: (name: string) => void;
  generating: boolean;
  onFinish: () => void;
  onBack: () => void;
}) {
  const [keyName, setKeyName] = useState("default api key");
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-5">
      <StepTitle
        title="Create your API key"
        desc={apiKey
          ? "Save this somewhere safe — you won't see the full key again."
          : "Generate a key so your agents and integrations can talk to Nous."}
      />

      {!apiKey ? (
        <>
          <div>
            <FieldLabel>key name</FieldLabel>
            <TextInput
              value={keyName}
              onChange={e => setKeyName(e.target.value)}
              placeholder="default api key"
              autoFocus
            />
          </div>
          <PrimaryButton
            onClick={() => generateKey(keyName.trim() || "default api key")}
            loading={generating}
          >
            {generating ? "generating…" : <><Key className="h-3 w-3" />generate key</>}
          </PrimaryButton>
        </>
      ) : (
        <div className="space-y-3">
          <div className="border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
            <div className="flex items-center gap-2 mb-2 text-[10px] text-emerald-500/80">
              <Check className="h-3 w-3" />
              <span className="tracking-widest">KEY CREATED</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={apiKey}
                type={showKey ? "text" : "password"}
                className="flex-1 bg-transparent text-[10px] text-foreground/80 outline-none truncate"
                style={MONO}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="text-muted-foreground/40 hover:text-foreground/70 transition-colors"
              >
                {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={copy}
                className="text-muted-foreground/40 hover:text-foreground/70 transition-colors"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-500/80" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
          </div>
          <p className="text-[9px] text-muted-foreground/35 leading-relaxed">
            You can revoke or rotate this any time from settings.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <GhostButton onClick={onBack}>back</GhostButton>
        <div className="flex-1">
          <PrimaryButton onClick={onFinish} disabled={!apiKey}>
            open workspace
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

// ─── Finishing: loading screen with tip ──────────────────────────────────────
function FinishingScreen() {
  return (
    <div className="py-2">
      <div className="flex flex-col items-center justify-center py-6">
        <RefreshCw className="h-5 w-5 animate-spin text-violet-400/70 mb-3" />
        <h2 className="text-[13px] font-medium text-foreground/80">Setting up your workspace</h2>
        <p className="text-[10px] text-muted-foreground/40 mt-1">just a moment…</p>
      </div>

      <div className="border border-violet-500/20 bg-violet-500/5 px-4 py-3">
        <div className="flex items-start gap-2">
          <Sparkles className="h-3 w-3 text-violet-400/80 mt-0.5 flex-shrink-0" />
          <p className="text-[10px] text-foreground/65 leading-relaxed">
            <span className="text-violet-400/90 font-medium tracking-wide">Tip — </span>
            click the <span className="text-foreground/80">mind status</span> indicator (it'll be offline) to set up your MCP server or SDK integration.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Step indicator ──────────────────────────────────────────────────────────
function StepBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-[2px] w-4 ${i < current ? "bg-violet-500/60" : "bg-border/40"}`}
        />
      ))}
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
interface OnboardingProps {
  testMode?: boolean;
}

type Phase = 1 | 2 | 3 | "finishing";

export default function Onboarding({ testMode = false }: OnboardingProps) {
  const navigate = useNavigate();
  const { session, userData, refreshUserData } = useAuth();

  const [phase, setPhase] = useState<Phase>(1);
  const [stepLoading, setStepLoading] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [useCases, setUseCases] = useState<string[]>([]);

  const [apiKey, setApiKey] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);

  useEffect(() => {
    if (!testMode && userData?.onboarding_completed) {
      navigate("/", { replace: true });
    }
  }, [testMode, userData?.onboarding_completed, navigate]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const p = JSON.parse(saved);
      if (p.phase && p.phase !== "finishing") setPhase(p.phase);
      if (p.companyName)  setCompanyName(p.companyName);
      if (p.website)      setWebsite(p.website);
      if (p.useCases)     setUseCases(p.useCases);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (phase === "finishing") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ phase, companyName, website, useCases }));
  }, [phase, companyName, website, useCases]);

  const auth = { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" };

  const submitStep1 = async () => {
    if (!companyName.trim()) return;
    setStepLoading(true);
    if (!testMode) {
      try {
        await fetch(`${API_URL}/api/onboarding/step-1`, {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            company_name: companyName.trim(),
            website: website.trim() || undefined,
            use_case: useCases.map(id => USE_CASES.find(u => u.id === id)?.label || id).join(", "),
          }),
        });
      } catch { /* non-blocking */ }
    }
    setStepLoading(false);
    setPhase(2);
  };

  const generateApiKey = async (name: string) => {
    if (testMode) {
      setGeneratingKey(true);
      await new Promise(r => setTimeout(r, 400));
      setApiKey("pk_test_demo_3c1f8a92b7e4d650f1ac");
      setGeneratingKey(false);
      return;
    }
    const workspaceId = userData?.workspace?.id;
    if (!workspaceId) { toast.error("workspace not ready — try again in a moment"); return; }
    setGeneratingKey(true);
    try {
      const res = await fetch(`${API_URL}/api/workspace/api-keys?workspaceId=${workspaceId}`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ name, workspaceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "failed to create api key");
      setApiKey(data.key);
    } catch (e: any) {
      toast.error(e.message || "failed to create api key");
    } finally {
      setGeneratingKey(false);
    }
  };

  const finish = async () => {
    setPhase("finishing");
    if (testMode) {
      await new Promise(r => setTimeout(r, 2800));
      toast.success("test run complete — restarting");
      localStorage.removeItem(STORAGE_KEY);
      setApiKey(null);
      setPhase(1);
      return;
    }
    try {
      await fetch(`${API_URL}/api/onboarding/complete`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({}),
      });
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem("nous_just_onboarded", "true");
      localStorage.setItem("nous_onboarding_company_name", companyName.trim());
      await new Promise(r => setTimeout(r, 1400));
      refreshUserData().catch(console.error);
    } catch { /* non-blocking */ }
    navigate("/", { replace: true });
  };

  // Modal widens when the importer panel needs space for column mapping.
  const maxWidth = phase === 2 ? 580 : 460;
  const stepLabel = phase === "finishing" ? "WRAP" : `${phase} OF ${TOTAL_STEPS}`;
  const currentDot = phase === "finishing" ? 3 : phase;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      style={MONO}
    >
      <div
        className="bg-background border border-border shadow-2xl w-full mx-4 flex flex-col"
        style={{ maxWidth, ...MONO }}
      >
        {/* breadcrumb header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/40">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-muted-foreground/40 tracking-widest">
              NOUS / ONBOARDING / {stepLabel}
            </span>
            {testMode && (
              <span className="text-[9px] text-amber-500/70 tracking-widest border border-amber-500/30 px-1.5 py-0.5">
                TEST
              </span>
            )}
          </div>
          <StepBar current={currentDot} total={TOTAL_STEPS} />
        </div>

        {/* body */}
        <div className="px-5 py-5">
          {phase === 1 && (
            <StepWelcome
              companyName={companyName} setCompanyName={setCompanyName}
              website={website} setWebsite={setWebsite}
              useCases={useCases} setUseCases={setUseCases}
              onNext={submitStep1} isLoading={stepLoading}
            />
          )}
          {phase === 2 && (
            <StepImport
              session={session}
              workspaceId={userData?.workspace?.id}
              testMode={testMode}
              onAdvance={() => setPhase(3)}
              onBack={() => setPhase(1)}
              onSkip={() => setPhase(3)}
            />
          )}
          {phase === 3 && (
            <StepCreateKey
              apiKey={apiKey}
              generateKey={generateApiKey}
              generating={generatingKey}
              onFinish={finish}
              onBack={() => setPhase(2)}
            />
          )}
          {phase === "finishing" && <FinishingScreen />}
        </div>

        {/* footer */}
        <div className="border-t border-border/20 px-5 py-2.5 flex justify-between items-center text-[9px] text-muted-foreground/35">
          <span>
            {phase === "finishing" ? "finishing up" : `step ${phase} of ${TOTAL_STEPS}`}
          </span>
          <a
            href="https://docs.opennous.cloud"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 hover:text-muted-foreground/70 transition-colors"
          >
            docs.opennous.cloud <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      </div>
    </div>
  );
}

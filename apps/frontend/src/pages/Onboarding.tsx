import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import {
  Check, Copy, Eye, EyeOff, Key, RefreshCw, ArrowLeft, ArrowRight,
} from "lucide-react";
import { PeopleImportPanel } from "@/components/contacts/PeopleImportModal";

const TOTAL_STEPS = 3;
const STORAGE_KEY = "nous_onboarding_v7";
const API_URL    = import.meta.env.VITE_API_URL ?? "";

// ─── Shared button styles (theme-aware) ──────────────────────────────────────
const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-1.5 h-10 px-5 rounded-lg text-[13px] font-semibold disabled:opacity-40 transition-colors " +
  "bg-foreground text-background hover:bg-foreground/90 " +
  "dark:bg-muted dark:text-foreground dark:hover:bg-muted/70 dark:border dark:border-border";
const BTN_SECONDARY =
  "inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 hover:text-foreground disabled:opacity-40 transition-colors";

// ─── Tiny primitives ─────────────────────────────────────────────────────────
function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <div className="text-[13px] font-medium text-foreground/80 mb-1.5">
      {children}
      {optional && <span className="ml-1.5 text-[12px] font-normal text-muted-foreground">Optional</span>}
    </div>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={
        "w-full h-10 rounded-lg border border-border bg-background px-3 text-[13px] text-foreground " +
        "placeholder:text-muted-foreground/70 focus:border-foreground/40 outline-none transition-colors " +
        (props.className ?? "")
      }
    />
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={
        "w-full min-h-[88px] rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] text-foreground " +
        "placeholder:text-muted-foreground/70 focus:border-foreground/40 outline-none transition-colors resize-y " +
        (props.className ?? "")
      }
    />
  );
}

function StepTitle({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="space-y-1">
      <h1 className="text-[20px] font-semibold tracking-tight text-foreground">{title}</h1>
      <p className="text-[13px] text-muted-foreground">{desc}</p>
    </div>
  );
}

// ─── Step 1: Welcome ─────────────────────────────────────────────────────────
function StepWelcome({
  name, setName,
  companyName, setCompanyName,
  website, setWebsite,
  icpDescription, setIcpDescription,
  onNext, isLoading,
}: {
  name: string; setName: (v: string) => void;
  companyName: string; setCompanyName: (v: string) => void;
  website: string; setWebsite: (v: string) => void;
  icpDescription: string; setIcpDescription: (v: string) => void;
  onNext: () => void; isLoading: boolean;
}) {
  return (
    <div className="space-y-6">
      <StepTitle
        title="Welcome to Nous"
        desc="A few details so the context layer knows what you're building."
      />

      <div className="space-y-5">
        <div>
          <FieldLabel>Your name</FieldLabel>
          <TextInput
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Jane Doe"
            autoFocus
          />
        </div>

        <div>
          <FieldLabel>Company</FieldLabel>
          <TextInput
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
            placeholder="Acme Corp"
          />
        </div>

        <div>
          <FieldLabel optional>Website</FieldLabel>
          <TextInput
            value={website}
            onChange={e => setWebsite(e.target.value)}
            placeholder="https://yourcompany.com"
            type="url"
          />
        </div>

        <div>
          <FieldLabel>Describe your ICP</FieldLabel>
          <TextArea
            value={icpDescription}
            onChange={e => setIcpDescription(e.target.value)}
            placeholder="B2B SaaS, 50–500 employees, US/EU, sales teams using HubSpot or Salesforce…"
            rows={3}
          />
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <button
          onClick={onNext}
          disabled={!name.trim() || !companyName.trim() || !icpDescription.trim() || isLoading}
          className={BTN_PRIMARY}
        >
          {isLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
          Continue
          {!isLoading && <ArrowRight className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

// ─── Step 2: Import contacts (real column-mapping importer) ──────────────────
function StepImport({
  onAdvance, onBack, onSkip, session, workspaceId,
}: {
  onAdvance: () => void;
  onBack: () => void;
  onSkip: () => void;
  session: any;
  workspaceId: string | undefined;
}) {
  return (
    <div className="space-y-6">
      <StepTitle
        title="Bring your contacts in"
        desc="Drop a CSV and map columns to Nous fields, or skip to start with demo data."
      />

      <div className="rounded-xl border border-border overflow-hidden">
        <PeopleImportPanel
          workspaceId={workspaceId ?? ""}
          token={session?.access_token ?? ""}
          onDone={onAdvance}
          onClose={onAdvance}
        />
      </div>

      <div className="flex items-center justify-between pt-1">
        <button onClick={onBack} className={BTN_SECONDARY}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <button
          onClick={onSkip}
          className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip — use demo data
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
  const [keyName, setKeyName] = useState("Default API key");
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-6">
      <StepTitle
        title="Create your API key"
        desc={apiKey
          ? "Save this somewhere safe — you won't see the full key again."
          : "Generate a key so your agents and integrations can talk to Nous."}
      />

      {!apiKey ? (
        <div className="space-y-5">
          <div>
            <FieldLabel>Key name</FieldLabel>
            <TextInput
              value={keyName}
              onChange={e => setKeyName(e.target.value)}
              placeholder="Default API key"
              autoFocus
            />
          </div>
          <button
            onClick={() => generateKey(keyName.trim() || "Default API key")}
            disabled={generating}
            className={BTN_PRIMARY}
          >
            {generating
              ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Generating…</>
              : <><Key className="h-3.5 w-3.5" /> Generate key</>}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-950/30 p-5">
            <div className="flex items-center gap-2 mb-3 text-[12px] font-semibold text-emerald-600 dark:text-emerald-300">
              <Check className="h-4 w-4" />
              <span>Key created</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 h-10">
              <input
                readOnly
                value={apiKey}
                type={showKey ? "text" : "password"}
                className="flex-1 bg-transparent text-[13px] text-foreground outline-none truncate font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={copy}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <p className="text-[13px] text-muted-foreground">
            You can revoke or rotate this any time from settings.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <button onClick={onBack} className={BTN_SECONDARY}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <button onClick={onFinish} disabled={!apiKey} className={BTN_PRIMARY}>
          Open workspace
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Finishing: minimal centered loader ──────────────────────────────────────
function FinishingScreen() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-3 text-center">
      <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      <p className="text-[13px] text-muted-foreground">
        Setting up your workspace, just a moment…
      </p>
    </div>
  );
}

// ─── Step indicator ──────────────────────────────────────────────────────────
function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="space-y-2.5 flex-1 min-w-0">
      <div className="text-[12px] font-medium text-muted-foreground">
        Step {current} of {total}
      </div>
      <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-foreground transition-all duration-300"
          style={{ width: `${(current / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
type Phase = 1 | 2 | 3 | "finishing";

export default function Onboarding() {
  const navigate = useNavigate();
  const { session, userData, refreshUserData } = useAuth();

  const [phase, setPhase] = useState<Phase>(1);
  const [stepLoading, setStepLoading] = useState(false);

  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [icpDescription, setIcpDescription] = useState("");

  // Pre-fill name from the signed-in user if we have it.
  useEffect(() => {
    if (!name && userData?.name) setName(userData.name);
  }, [userData?.name, name]);

  const [apiKey, setApiKey] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);

  useEffect(() => {
    if (userData?.onboarding_completed) {
      navigate("/", { replace: true });
    }
  }, [userData?.onboarding_completed, navigate]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const p = JSON.parse(saved);
      if (p.phase && p.phase !== "finishing") setPhase(p.phase);
      if (p.name)            setName(p.name);
      if (p.companyName)     setCompanyName(p.companyName);
      if (p.website)         setWebsite(p.website);
      if (p.icpDescription)  setIcpDescription(p.icpDescription);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (phase === "finishing") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ phase, name, companyName, website, icpDescription }));
  }, [phase, name, companyName, website, icpDescription]);

  const auth = { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" };

  const submitStep1 = async () => {
    if (!name.trim() || !companyName.trim()) return;
    setStepLoading(true);
    try {
      await fetch(`${API_URL}/api/onboarding/step-1`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          name: name.trim(),
          company_name: companyName.trim(),
          website: website.trim() || undefined,
          icp_description: icpDescription.trim() || undefined,
        }),
      });
    } catch { /* non-blocking */ }
    setStepLoading(false);
    setPhase(2);
  };

  const generateApiKey = async (name: string) => {
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
    try {
      await fetch(`${API_URL}/api/onboarding/complete`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          name: name.trim() || undefined,
          company_name: companyName.trim() || undefined,
          website: website.trim() || undefined,
          icp_description: icpDescription.trim() || undefined,
        }),
      });
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem("nous_just_onboarded", "true");
      localStorage.setItem("nous_onboarding_company_name", companyName.trim());
      refreshUserData().catch(console.error);
    } catch { /* non-blocking */ }
    await new Promise(r => setTimeout(r, 2500));
    navigate("/", { replace: true });
  };

  const currentStep = phase === "finishing" ? 3 : phase;
  const contentMaxWidth = phase === 2 ? 640 : 480;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-background overflow-y-auto py-10"
      style={{
        backgroundImage:
          "radial-gradient(circle, rgb(0 0 0 / 0.08) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div className="w-full mx-6 flex flex-col" style={{ maxWidth: contentMaxWidth }}>
        {phase !== "finishing" && (
          <div className="mb-6">
            <StepIndicator current={currentStep} total={TOTAL_STEPS} />
          </div>
        )}

        {phase === 1 && (
          <StepWelcome
            name={name} setName={setName}
            companyName={companyName} setCompanyName={setCompanyName}
            website={website} setWebsite={setWebsite}
            icpDescription={icpDescription} setIcpDescription={setIcpDescription}
            onNext={submitStep1} isLoading={stepLoading}
          />
        )}
        {phase === 2 && (
          <StepImport
            session={session}
            workspaceId={userData?.workspace?.id}
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
    </div>
  );
}

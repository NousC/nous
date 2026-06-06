import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import {
  Briefcase, Check, Code2, Copy, Eye, EyeOff, Key, RefreshCw, ArrowLeft, ArrowRight,
} from "lucide-react";
import { PeopleImportPanel } from "@/components/contacts/PeopleImportModal";
import {
  connectGmail, connectLinkedIn, hasGmailConnection, hasLinkedInConnection,
} from "@/lib/connect";

// Scope the onboarding state by user id so a stale phase from a previous account
// doesn't get restored when somebody else signs up in the same browser. Bumped
// to v10 with the new string-keyed phases (Connect Gmail / Connect LinkedIn).
const STORAGE_KEY_PREFIX = "nous_onboarding_v10_";
const LEGACY_STORAGE_KEYS = ["nous_onboarding_v7", "nous_onboarding_v8", "nous_onboarding_v9_"];
const API_URL    = import.meta.env.VITE_API_URL ?? "";

type BusinessType = "service" | "software";
type PlanModel = "free_plan" | "free_trial" | "both" | "paid_only";

const PLAN_MODELS: { id: PlanModel; label: string; stage: string; desc: string }[] = [
  { id: "free_plan",  label: "Free plan",  stage: "Free User", desc: 'Self-serve free tier. New signups labeled "Free User".' },
  { id: "free_trial", label: "Free trial", stage: "Trial",     desc: 'Time-limited trial. New signups labeled "Trial".' },
  { id: "both",       label: "Both",       stage: "Free User", desc: 'Free plan + trial. Defaults new signups to "Free User".' },
  { id: "paid_only",  label: "Paid only",  stage: "Lead",      desc: 'Demo or sales-led. New signups labeled "Lead".' },
];

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

// ─── Step 2: Business type + plan model ─────────────────────────────────────
function StepBusinessType({
  businessType, setBusinessType,
  planModel, setPlanModel,
  signupStage, setSignupStage,
  onNext, onBack, isLoading,
}: {
  businessType: BusinessType | null;
  setBusinessType: (v: BusinessType | null) => void;
  planModel: PlanModel | null;
  setPlanModel: (v: PlanModel | null) => void;
  signupStage: string;
  setSignupStage: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  isLoading: boolean;
}) {
  const pickBiz = (b: BusinessType) => {
    setBusinessType(b);
    if (b === "service") { setPlanModel(null); setSignupStage("Lead"); }
    else if (planModel) {
      const m = PLAN_MODELS.find(p => p.id === planModel);
      if (m) setSignupStage(m.stage);
    }
  };
  const pickPlan = (m: PlanModel) => {
    setPlanModel(m);
    const meta = PLAN_MODELS.find(p => p.id === m);
    if (meta) setSignupStage(meta.stage);
  };

  const canContinue =
    !!businessType &&
    (businessType === "service" || !!planModel) &&
    !!signupStage.trim();

  return (
    <div className="space-y-6">
      <StepTitle
        title="What kind of business?"
        desc="We tailor the CRM to how you actually talk about the people who buy from you."
      />

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => pickBiz("service")}
          className={
            "rounded-xl border-2 p-4 text-left transition-colors " +
            (businessType === "service"
              ? "border-foreground bg-muted/40"
              : "border-border hover:border-foreground/30 bg-background")
          }
        >
          <Briefcase className="h-5 w-5 text-foreground mb-2" />
          <p className="text-[14px] font-semibold text-foreground">Service</p>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Agency, consultancy, freelancer. Buyers are <strong>Clients</strong>.
          </p>
        </button>
        <button
          type="button"
          onClick={() => pickBiz("software")}
          className={
            "rounded-xl border-2 p-4 text-left transition-colors " +
            (businessType === "software"
              ? "border-foreground bg-muted/40"
              : "border-border hover:border-foreground/30 bg-background")
          }
        >
          <Code2 className="h-5 w-5 text-foreground mb-2" />
          <p className="text-[14px] font-semibold text-foreground">Software</p>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            SaaS, app, product. Buyers are <strong>Customers</strong>.
          </p>
        </button>
      </div>

      {businessType === "software" && (
        <div className="space-y-2">
          <FieldLabel>How do new users sign up?</FieldLabel>
          <div className="space-y-1.5">
            {PLAN_MODELS.map(({ id, label, desc }) => {
              const selected = planModel === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => pickPlan(id)}
                  className={
                    "w-full rounded-lg border-2 p-3 text-left transition-colors " +
                    (selected
                      ? "border-foreground bg-muted/40"
                      : "border-border hover:border-foreground/30 bg-background")
                  }
                >
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-medium text-foreground">{label}</p>
                    {selected && <Check className="h-4 w-4 text-foreground" />}
                  </div>
                  <p className="text-[12px] text-muted-foreground mt-0.5">{desc}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {businessType && (
        <div>
          <FieldLabel>Label for new signups</FieldLabel>
          <TextInput
            value={signupStage}
            onChange={e => setSignupStage(e.target.value)}
            placeholder={businessType === "service" ? "Lead" : "Free User"}
          />
          <p className="text-[12px] text-muted-foreground mt-1.5">
            You can change this anytime in Settings.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <button onClick={onBack} className={BTN_SECONDARY}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <button onClick={onNext} disabled={!canContinue || isLoading} className={BTN_PRIMARY}>
          {isLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
          Continue
          {!isLoading && <ArrowRight className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

// ─── Connect accounts (Gmail + LinkedIn on one slide) ────────────────────────
function ProviderCard({
  logo, title, desc, connected, busy, error, onConnect,
}: {
  logo: string; title: string; desc: string;
  connected: boolean; busy: boolean; error: string | null; onConnect: () => void;
}) {
  return (
    <div className="rounded-xl border border-border p-4 flex items-center gap-4">
      <img src={logo} alt="" className="h-10 w-10 flex-shrink-0 rounded-lg object-contain" />
      <div className="flex-1 min-w-0 text-left">
        <p className="text-[14px] font-semibold text-foreground">{title}</p>
        <p className="text-[12px] text-muted-foreground">{desc}</p>
        {error && <p className="mt-1 text-[12px] text-red-500">{error}</p>}
      </div>
      {connected ? (
        <span className="flex flex-shrink-0 items-center gap-1.5 text-[13px] font-semibold text-emerald-600 dark:text-emerald-400">
          <Check className="h-4 w-4" /> Connected
        </span>
      ) : (
        <button onClick={onConnect} disabled={busy} className={BTN_SECONDARY + " flex-shrink-0"}>
          {busy
            ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Connecting…</>
            : "Connect"}
        </button>
      )}
    </div>
  );
}

function StepConnectAccounts({
  workspaceId, token, onContinue, onBack,
}: {
  workspaceId: string | undefined; token: string; onContinue: () => void; onBack: () => void;
}) {
  const [gmail, setGmail] = useState({ connected: false, busy: false, error: null as string | null });
  const [linkedin, setLinkedin] = useState({ connected: false, busy: false, error: null as string | null });

  // Re-derive from the API so a mid-onboarding reload reflects reality.
  useEffect(() => {
    if (!workspaceId || !token) return;
    hasGmailConnection({ workspaceId, token }).then(c => setGmail(s => ({ ...s, connected: c }))).catch(() => {});
    hasLinkedInConnection({ workspaceId, token }).then(c => setLinkedin(s => ({ ...s, connected: c }))).catch(() => {});
  }, [workspaceId, token]);

  const connectGmailNow = async () => {
    if (!workspaceId) return;
    setGmail(s => ({ ...s, busy: true, error: null }));
    try {
      await connectGmail({
        workspaceId, token,
        onResult: ok => setGmail({ connected: ok, busy: false, error: ok ? null : "Not connected yet — finish the Google window." }),
      });
    } catch (e: any) {
      setGmail({ connected: false, busy: false, error: e.message || "Couldn't start Gmail connection" });
    }
  };

  const connectLinkedInNow = async () => {
    if (!workspaceId) return;
    setLinkedin(s => ({ ...s, busy: true, error: null }));
    try {
      await connectLinkedIn({
        workspaceId, token,
        onResult: ok => setLinkedin({ connected: ok, busy: false, error: ok ? null : "Not connected yet — finish the LinkedIn window." }),
      });
    } catch (e: any) {
      setLinkedin({ connected: false, busy: false, error: e.message || "Couldn't start LinkedIn connection" });
    }
  };

  const anyConnected = gmail.connected || linkedin.connected;

  return (
    <div className="space-y-6">
      <StepTitle
        title="Connect your accounts"
        desc="The two sources most of Nous runs on."
      />

      <div className="space-y-3">
        <ProviderCard
          logo="/provider-logos/gmail.svg"
          title="Gmail"
          desc="Pre-meeting briefs, follow-ups, reply & meeting detection."
          connected={gmail.connected} busy={gmail.busy} error={gmail.error}
          onConnect={connectGmailNow}
        />
        <ProviderCard
          logo="/provider-logos/linkedin.png"
          title="LinkedIn"
          desc="Weekly engagers, warm inbound, and profile enrichment."
          connected={linkedin.connected} busy={linkedin.busy} error={linkedin.error}
          onConnect={connectLinkedInNow}
        />
      </div>

      <p className="text-[12px] text-muted-foreground">
        You can always connect these later in Integrations.
      </p>

      <div className="flex items-center justify-between pt-1">
        <button onClick={onBack} className={BTN_SECONDARY}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <button onClick={onContinue} className={BTN_PRIMARY}>
          {anyConnected ? "Continue" : "Skip for now"}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Import contacts (real column-mapping importer) ──────────────────
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
        title="Bring your contacts from your CRM"
        desc="Export a CSV from HubSpot, Salesforce, Pipedrive or any CRM, then map the columns — or skip to start with demo data."
      />

      <div className="rounded-xl border border-border overflow-hidden">
        <PeopleImportPanel
          workspaceId={workspaceId ?? ""}
          token={session?.access_token ?? ""}
          onDone={onAdvance}
          onClose={onAdvance}
          skipScan
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
          Skip
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
type Phase = "welcome" | "connect" | "business" | "import" | "apikey" | "finishing";

export default function Onboarding() {
  const navigate = useNavigate();
  const { session, userData, refreshUserData } = useAuth();

  const [phase, setPhase] = useState<Phase>("welcome");
  const [stepLoading, setStepLoading] = useState(false);

  // On self-host, Google OAuth / Unipile are often not configured, so the
  // connect steps are cloud-only. The step list (and progress count) adapt.
  const selfHosted = (userData as { self_hosted?: boolean })?.self_hosted === true;
  const steps = useMemo<Phase[]>(
    () => selfHosted
      ? ["welcome", "business", "import", "apikey"]
      : ["welcome", "connect", "business", "import", "apikey"],
    [selfHosted],
  );
  const TOTAL_STEPS = steps.length;
  const advanceFrom = (p: Phase) => {
    const i = steps.indexOf(p);
    if (i >= 0 && i < steps.length - 1) setPhase(steps[i + 1]);
  };
  const backFrom = (p: Phase) => {
    const i = steps.indexOf(p);
    if (i > 0) setPhase(steps[i - 1]);
  };

  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [icpDescription, setIcpDescription] = useState("");
  const [businessType, setBusinessType] = useState<BusinessType | null>(null);
  const [planModel, setPlanModel] = useState<PlanModel | null>(null);
  const [signupStage, setSignupStage] = useState("");

  // Pre-fill name from the signed-in user if we have it.
  useEffect(() => {
    if (!name && userData?.name) setName(userData.name);
  }, [userData?.name, name]);

  const [apiKey, setApiKey] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);

  // Per-user storage key so a stale phase from another account never bleeds across.
  const userId = userData?.id || session?.user?.id || null;
  const storageKey = userId ? `${STORAGE_KEY_PREFIX}${userId}` : null;

  useEffect(() => {
    if (userData?.onboarding_completed) {
      navigate("/", { replace: true });
    }
  }, [userData?.onboarding_completed, navigate]);

  // Once we know the user, restore (or migrate) their state. Anything stored
  // under a legacy un-scoped key gets wiped so it can't leak to another login.
  useEffect(() => {
    if (!storageKey) return;
    try {
      LEGACY_STORAGE_KEYS.forEach(k => localStorage.removeItem(k));
      const saved = localStorage.getItem(storageKey);
      if (!saved) return;
      const p = JSON.parse(saved);
      if (p.phase && p.phase !== "finishing" && steps.includes(p.phase)) setPhase(p.phase);
      if (p.name)            setName(p.name);
      if (p.companyName)     setCompanyName(p.companyName);
      if (p.website)         setWebsite(p.website);
      if (p.icpDescription)  setIcpDescription(p.icpDescription);
      if (p.businessType)    setBusinessType(p.businessType);
      if (p.planModel)       setPlanModel(p.planModel);
      if (p.signupStage)     setSignupStage(p.signupStage);
    } catch { /* ignore */ }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || phase === "finishing") return;
    localStorage.setItem(storageKey, JSON.stringify({
      phase, name, companyName, website, icpDescription,
      businessType, planModel, signupStage,
    }));
  }, [storageKey, phase, name, companyName, website, icpDescription, businessType, planModel, signupStage]);

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
    advanceFrom("welcome");
  };

  const submitBusinessType = async () => {
    if (!businessType) return;
    setStepLoading(true);
    try {
      await fetch(`${API_URL}/api/onboarding/business-type`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          business_type: businessType,
          plan_model: businessType === "software" ? planModel : null,
          default_signup_stage: signupStage.trim() || (businessType === "service" ? "Lead" : "Free User"),
        }),
      });
    } catch { /* non-blocking */ }
    setStepLoading(false);
    advanceFrom("business");
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
      if (storageKey) localStorage.removeItem(storageKey);
      localStorage.setItem("nous_just_onboarded", "true");
      localStorage.setItem("nous_onboarding_company_name", companyName.trim());
      refreshUserData().catch(console.error);
    } catch { /* non-blocking */ }
    await new Promise(r => setTimeout(r, 2500));
    // First run lands on Install ("add Nous to your tool"), not the ops log —
    // a fresh workspace has nothing to operate on yet, so setup comes first.
    navigate("/install", { replace: true });
  };

  const currentStep = phase === "finishing" ? TOTAL_STEPS : steps.indexOf(phase) + 1;
  // The Import step needs the wider layout; everything else stays compact.
  const contentMaxWidth = phase === "import" ? 640 : 480;

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

        {phase === "welcome" && (
          <StepWelcome
            name={name} setName={setName}
            companyName={companyName} setCompanyName={setCompanyName}
            website={website} setWebsite={setWebsite}
            icpDescription={icpDescription} setIcpDescription={setIcpDescription}
            onNext={submitStep1} isLoading={stepLoading}
          />
        )}
        {phase === "connect" && (
          <StepConnectAccounts
            workspaceId={userData?.workspace?.id}
            token={session?.access_token ?? ""}
            onContinue={() => advanceFrom("connect")}
            onBack={() => backFrom("connect")}
          />
        )}
        {phase === "business" && (
          <StepBusinessType
            businessType={businessType} setBusinessType={setBusinessType}
            planModel={planModel} setPlanModel={setPlanModel}
            signupStage={signupStage} setSignupStage={setSignupStage}
            onNext={submitBusinessType} onBack={() => backFrom("business")}
            isLoading={stepLoading}
          />
        )}
        {phase === "import" && (
          <StepImport
            session={session}
            workspaceId={userData?.workspace?.id}
            onAdvance={() => advanceFrom("import")}
            onBack={() => backFrom("import")}
            onSkip={() => advanceFrom("import")}
          />
        )}
        {phase === "apikey" && (
          <StepCreateKey
            apiKey={apiKey}
            generateKey={generateApiKey}
            generating={generatingKey}
            onFinish={finish}
            onBack={() => backFrom("apikey")}
          />
        )}
        {phase === "finishing" && <FinishingScreen />}
      </div>
    </div>
  );
}

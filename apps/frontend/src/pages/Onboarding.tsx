import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import {
  Check, Copy, Eye, EyeOff, Loader2, Upload,
  FileText, Key, RefreshCw,
} from "lucide-react";

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

// ─── CSV helpers ─────────────────────────────────────────────────────────────
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/['"]/g, ""));
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const values: string[] = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { values.push(cur.trim().replace(/^"|"$/g, "")); cur = ""; }
      else { cur += ch; }
    }
    values.push(cur.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] || ""; });
    return row;
  });
}

function normalizeRow(raw: Record<string, string>): Record<string, string> {
  const get = (...keys: string[]) => keys.map(k => raw[k]).find(v => v) || "";
  const SERVER_FIELDS = [
    "email", "first_name", "last_name", "company", "domain", "phone",
    "job_title", "deal_stage", "linkedin_url", "notes", "seniority",
    "department", "pipeline_stage", "crm_record_id", "source",
  ];
  const row: Record<string, string> = {};
  SERVER_FIELDS.forEach(f => { if (raw[f]) row[f] = raw[f]; });
  if (!row.email)        row.email        = get("email address", "e-mail");
  if (!row.first_name)   row.first_name   = get("firstname", "first name", "given name");
  if (!row.last_name)    row.last_name    = get("lastname", "last name", "surname");
  if (!row.company)      row.company      = get("company name", "organization", "account");
  if (!row.job_title)    row.job_title    = get("title", "position", "role");
  if (!row.phone)        row.phone        = get("phone number", "mobile", "telephone");
  if (!row.linkedin_url) row.linkedin_url = get("linkedin", "linkedin profile");
  if (!row.domain)       row.domain       = get("website", "company domain");
  return row;
}

// ─── Tiny primitives ─────────────────────────────────────────────────────────
function Label({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
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

function ChipGroup({
  options, value, onChange, single = false,
}: {
  options: { id: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  single?: boolean;
}) {
  const toggle = (id: string) => {
    if (single) { onChange(value[0] === id ? [] : [id]); return; }
    onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  };
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
                : "border-border/40 text-muted-foreground/40 hover:border-border/70"
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
  onClick, disabled, loading, children,
}: { onClick: () => void; disabled?: boolean; loading?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full flex items-center justify-center gap-2 text-[11px] py-2 bg-violet-500/20 border border-violet-500/30 text-violet-400/80 hover:bg-violet-500/30 transition-colors disabled:opacity-30"
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
      <div>
        <div className="text-[11px] text-foreground/70 mb-1">welcome to nous</div>
        <p className="text-[10px] text-muted-foreground/40 leading-relaxed">
          a few details so your memory layer knows what you're building.
        </p>
      </div>

      <div>
        <Label>company</Label>
        <TextInput
          value={companyName}
          onChange={e => setCompanyName(e.target.value)}
          placeholder="acme corp"
          autoFocus
        />
      </div>

      <div>
        <Label optional>website</Label>
        <TextInput
          value={website}
          onChange={e => setWebsite(e.target.value)}
          placeholder="https://yourcompany.com"
          type="url"
        />
      </div>

      <div>
        <Label>what are you building?</Label>
        <ChipGroup
          options={USE_CASES}
          value={useCases}
          onChange={setUseCases}
        />
      </div>

      <PrimaryButton onClick={onNext} disabled={!companyName.trim()} loading={isLoading}>
        continue
      </PrimaryButton>
    </div>
  );
}

// ─── Step 2: Import contacts ─────────────────────────────────────────────────
function StepImport({
  onNext, onSkip, onBack, session, workspaceId, testMode,
}: {
  onNext: () => void; onSkip: () => void; onBack: () => void;
  session: any; workspaceId: string | undefined; testMode?: boolean;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) { toast.error("please upload a CSV file"); return; }
    setFileName(file.name);
    setIsUploading(true);
    try {
      const text = await file.text();
      const rows = parseCSV(text).map(normalizeRow).filter(r => r.email);
      if (!rows.length) { toast.error("no rows with a valid email column"); return; }
      if (testMode) {
        await new Promise(r => setTimeout(r, 500));
        setResult({ created: rows.length, updated: 0 });
        return;
      }
      if (!workspaceId) { toast.error("no workspace found"); return; }
      const res = await fetch(`${API_URL}/api/contacts/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ workspaceId, rows }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "import failed");
      const data = await res.json();
      setResult({ created: data.created ?? 0, updated: data.updated ?? 0 });
    } catch (e: any) {
      toast.error(e.message || "failed to import contacts");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="text-[11px] text-foreground/70 mb-1">import contacts</div>
        <p className="text-[10px] text-muted-foreground/40 leading-relaxed">
          drop a CSV from your CRM, or skip — we'll seed a demo set.
        </p>
      </div>

      {result ? (
        <div className="border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] text-emerald-500/80">
            <Check className="h-3 w-3" />
            <span>{result.created} contacts {testMode ? "parsed (test mode)" : "imported"}</span>
          </div>
          {result.updated > 0 && (
            <div className="text-[9px] text-muted-foreground/40 mt-1">{result.updated} existing updated</div>
          )}
          <div className="text-[9px] text-muted-foreground/30 mt-0.5 truncate">{fileName}</div>
        </div>
      ) : (
        <div
          onClick={() => !isUploading && fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={e => {
            e.preventDefault();
            setIsDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
          className={`flex flex-col items-center justify-center h-32 border border-dashed cursor-pointer transition-colors ${
            isUploading
              ? "border-border/30 bg-muted/10 cursor-default"
              : isDragging
                ? "border-violet-500/60 bg-violet-500/5"
                : "border-border/40 hover:border-border/70 hover:bg-muted/10"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleFile(f); }}
          />
          {isUploading ? (
            <div className="text-center">
              <RefreshCw className="h-4 w-4 text-muted-foreground/40 mx-auto animate-spin mb-2" />
              <p className="text-[10px] text-muted-foreground/40">importing…</p>
            </div>
          ) : (
            <div className="text-center">
              <Upload className="h-4 w-4 text-muted-foreground/25 mx-auto mb-2" />
              <p className="text-[10px] text-muted-foreground/40">
                drop CSV or <span className="text-violet-400/70">click to upload</span>
              </p>
              <p className="text-[9px] text-muted-foreground/25 mt-0.5">
                email, first_name, last_name, company, job_title
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <GhostButton onClick={onBack}>back</GhostButton>
        <div className="flex-1">
          <PrimaryButton onClick={result ? onNext : onSkip} disabled={isUploading}>
            {result ? "continue" : "skip — use demo data"}
          </PrimaryButton>
        </div>
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
      <div>
        <div className="text-[11px] text-foreground/70 mb-1">create your api key</div>
        <p className="text-[10px] text-muted-foreground/40 leading-relaxed">
          {apiKey
            ? "save this somewhere safe — you won't see the full key again."
            : "generate a key so your agents and integrations can talk to nous."}
        </p>
      </div>

      {!apiKey ? (
        <>
          <div>
            <Label>key name</Label>
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
              <span className="tracking-widest">key created</span>
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
          <p className="text-[9px] text-muted-foreground/30 leading-relaxed">
            you can revoke or rotate this any time from settings.
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

type StepIdx = 1 | 2 | 3;

export default function Onboarding({ testMode = false }: OnboardingProps) {
  const navigate = useNavigate();
  const { session, userData, refreshUserData } = useAuth();

  const [step, setStep] = useState<StepIdx>(1);
  const [stepLoading, setStepLoading] = useState(false);

  // step 1
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [useCases, setUseCases] = useState<string[]>([]);

  // step 3
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
      if (p.step)         setStep(p.step);
      if (p.companyName)  setCompanyName(p.companyName);
      if (p.website)      setWebsite(p.website);
      if (p.useCases)     setUseCases(p.useCases);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ step, companyName, website, useCases }));
  }, [step, companyName, website, useCases]);

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
    setStep(2);
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
    if (testMode) {
      toast.success("test run complete — restarting");
      localStorage.removeItem(STORAGE_KEY);
      setStep(1); setApiKey(null);
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
      refreshUserData().catch(console.error);
    } catch { /* non-blocking */ }
    navigate("/", { replace: true });
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      style={MONO}
    >
      <div
        className="bg-background border border-border shadow-2xl w-full mx-4 flex flex-col"
        style={{ maxWidth: 460, ...MONO }}
      >
        {/* breadcrumb header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/40">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-muted-foreground/40 tracking-widest">
              NOUS / ONBOARDING / {step} OF {TOTAL_STEPS}
            </span>
            {testMode && (
              <span className="text-[9px] text-amber-500/70 tracking-widest border border-amber-500/30 px-1.5 py-0.5">
                TEST
              </span>
            )}
          </div>
          <StepBar current={step} total={TOTAL_STEPS} />
        </div>

        {/* body */}
        <div className="px-5 py-5">
          {step === 1 && (
            <StepWelcome
              companyName={companyName} setCompanyName={setCompanyName}
              website={website} setWebsite={setWebsite}
              useCases={useCases} setUseCases={setUseCases}
              onNext={submitStep1} isLoading={stepLoading}
            />
          )}
          {step === 2 && (
            <StepImport
              session={session}
              workspaceId={userData?.workspace?.id}
              testMode={testMode}
              onNext={() => setStep(3)}
              onSkip={() => setStep(3)}
              onBack={() => setStep(1)}
            />
          )}
          {step === 3 && (
            <StepCreateKey
              apiKey={apiKey}
              generateKey={generateApiKey}
              generating={generatingKey}
              onFinish={finish}
              onBack={() => setStep(2)}
            />
          )}
        </div>

        {/* footer */}
        <div className="border-t border-border/20 px-5 py-2.5 flex justify-between items-center text-[9px] text-muted-foreground/30">
          <span>step {step} of {TOTAL_STEPS}</span>
          <span className="flex items-center gap-1">
            <FileText className="h-2.5 w-2.5" />
            <span>docs.opennous.cloud</span>
          </span>
        </div>
      </div>
    </div>
  );
}

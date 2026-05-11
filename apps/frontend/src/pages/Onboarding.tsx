import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Check, Copy, Eye, EyeOff, Key, Loader2, Upload } from "lucide-react";

// ─── Use case options ───────────────────────────────────────────────────────
const USE_CASES = [
  { id: "openclaw",            label: "OpenClaw" },
  { id: "gtm_agent",           label: "GTM Agent" },
  { id: "ai_sdr",              label: "AI SDR" },
  { id: "outbound",            label: "Outbound Automation" },
  { id: "sales_assistant",     label: "Sales Assistant" },
  { id: "customer_success",    label: "Customer Success AI" },
  { id: "meeting_intelligence",label: "Meeting Intelligence" },
  { id: "custom",              label: "Custom" },
];

const TOTAL_STEPS = 3;
const STORAGE_KEY = "proply_onboarding_v4";
const API_URL = import.meta.env.VITE_API_URL ?? "";

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

  // Pass through all server-recognized field names directly
  const SERVER_FIELDS = [
    "email", "first_name", "last_name", "company", "domain", "phone",
    "job_title", "deal_stage", "linkedin_url", "notes", "seniority",
    "department", "pipeline_stage", "crm_record_id", "source",
  ];
  const row: Record<string, string> = {};
  SERVER_FIELDS.forEach(f => { if (raw[f]) row[f] = raw[f]; });

  // Resolve common column name aliases
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

// ─── Right branding panel ───────────────────────────────────────────────────
function BrandingPanel() {
  return (
    <div className="hidden lg:flex lg:w-[45%] bg-gray-950 flex-col justify-between p-12 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />
      <div className="relative z-10 flex items-center gap-2.5">
        <img src="/newlogoP.png" alt="Proply" className="h-8 w-auto" />
      </div>
      <div className="relative z-10 max-w-sm">
        <svg className="w-8 h-8 text-gray-600 mb-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M14.017 21v-7.391c0-5.704 3.748-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h3.983v10h-9.966z" />
        </svg>
        <p className="text-[19px] font-medium text-white leading-[1.55] mb-6">
          Proply gives our AI agents the sales context they need — contacts, company history, deal signals. It's the memory layer we were missing.
        </p>
        <div className="text-sm text-gray-400">
          Trusted by GTM teams and AI builders worldwide
        </div>
      </div>
    </div>
  );
}

// ─── Progress indicator ─────────────────────────────────────────────────────
function StepProgress({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "h-1.5 rounded-full transition-all duration-300",
            i < current ? "bg-gray-900 w-6" : "bg-gray-200 w-4"
          )}
        />
      ))}
    </div>
  );
}

// ─── Step 1: Welcome ─────────────────────────────────────────────────────────
interface Step1Props {
  companyName: string;
  setCompanyName: (v: string) => void;
  website: string;
  setWebsite: (v: string) => void;
  selectedUseCases: string[];
  setSelectedUseCases: (v: string[]) => void;
  onNext: () => void;
  isLoading: boolean;
}

function Step1Welcome({
  companyName, setCompanyName,
  website, setWebsite,
  selectedUseCases, setSelectedUseCases,
  onNext, isLoading,
}: Step1Props) {
  const toggle = (id: string) => {
    setSelectedUseCases(
      selectedUseCases.includes(id)
        ? selectedUseCases.filter(x => x !== id)
        : [...selectedUseCases, id]
    );
  };

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-[26px] font-semibold text-gray-900 leading-tight">
          Welcome to Proply,<br />let's get to know you
        </h1>
        <p className="text-sm text-gray-500 mt-1.5">
          This helps us set up your AI memory layer correctly.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">Company name</label>
        <Input
          value={companyName}
          onChange={e => setCompanyName(e.target.value)}
          placeholder="Acme Corp"
          className="h-11 rounded-lg border-gray-200 text-sm"
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">
          Website
          <span className="text-gray-400 font-normal ml-1.5">(optional)</span>
        </label>
        <Input
          value={website}
          onChange={e => setWebsite(e.target.value)}
          placeholder="https://yourcompany.com"
          className="h-11 rounded-lg border-gray-200 text-sm"
          type="url"
        />
      </div>

      <div className="space-y-2.5">
        <label className="text-sm font-medium text-gray-700">What are you building?</label>
        <div className="flex flex-wrap gap-2">
          {USE_CASES.map(({ id, label }) => {
            const selected = selectedUseCases.includes(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                className={cn(
                  "flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm border-2 transition-all duration-150 font-medium",
                  selected
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                )}
              >
                {selected && <Check className="w-3 h-3" />}
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <Button
        onClick={onNext}
        disabled={!companyName.trim() || isLoading}
        className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white rounded-lg font-medium"
      >
        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue"}
      </Button>
    </div>
  );
}

// ─── Step 2: Create API key ───────────────────────────────────────────────────
interface Step2ApiKeyProps {
  onNext: () => void;
  onSkip: () => void;
}

function Step2ApiKey({ onNext, onSkip }: Step2ApiKeyProps) {
  const { session } = useAuth();
  const [keyName, setKeyName] = useState("Default API Key");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const generateKey = async () => {
    if (!keyName.trim()) { toast.error("Please enter a name for your API key"); return; }
    setIsGenerating(true);
    try {
      const res = await fetch(`${API_URL}/api/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ name: keyName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.detail || "Failed to create API key");
      setGeneratedKey(data.key);
      toast.success("API key created!");
    } catch (e: any) {
      toast.error(e.message || "Failed to create API key");
    } finally {
      setIsGenerating(false);
    }
  };

  const copyKey = () => {
    if (!generatedKey) return;
    navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-7">
      <div>
        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center mb-4">
          <Key className="w-5 h-5 text-gray-600" />
        </div>
        <h1 className="text-[26px] font-semibold text-gray-900">Create your API key</h1>
        <p className="text-sm text-gray-500 mt-1.5">
          Your API key lets agents connect to Proply's memory. Create one now so you're ready to build.
        </p>
      </div>

      {!generatedKey ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Key name</label>
            <Input
              value={keyName}
              onChange={e => setKeyName(e.target.value)}
              placeholder="Default API Key"
              className="h-11 rounded-lg border-gray-200 text-sm"
              autoFocus
            />
          </div>
          <Button
            onClick={generateKey}
            disabled={isGenerating || !keyName.trim()}
            className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white rounded-lg font-medium"
          >
            {isGenerating ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" />Generating...</>
            ) : (
              <><Key className="w-4 h-4 mr-2" />Generate API Key</>
            )}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4 space-y-3">
            <div className="flex items-center gap-2 text-emerald-700">
              <Check className="w-4 h-4" />
              <p className="text-sm font-semibold">API key created — save it now</p>
            </div>
            <p className="text-xs text-emerald-600">This is the only time you'll see the full key.</p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  value={generatedKey}
                  readOnly
                  type={showKey ? "text" : "password"}
                  className="h-10 font-mono text-xs bg-white border-emerald-200 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={copyKey}
                className="h-10 w-10 border-emerald-200 hover:bg-emerald-50 flex-shrink-0"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          <Button
            onClick={onNext}
            className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white rounded-lg font-medium"
          >
            Continue
          </Button>
        </div>
      )}

      {!generatedKey && (
        <button
          onClick={onSkip}
          className="w-full text-center text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          I'll do this later
        </button>
      )}
    </div>
  );
}

// ─── Step 3: Import contacts ─────────────────────────────────────────────────
interface Step3ContactsProps {
  onNext: () => void;
  onSkip: () => void;
  session: any;
  workspaceId: string | undefined;
}

function Step3Contacts({ onNext, onSkip, session, workspaceId }: Step3ContactsProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) { toast.error("Please upload a CSV file"); return; }
    if (!workspaceId) { toast.error("No workspace found"); return; }
    setFileName(file.name);
    setIsUploading(true);
    try {
      const text = await file.text();
      const rows = parseCSV(text).map(normalizeRow).filter(r => r.email);
      if (!rows.length) { toast.error("No rows with a valid email column found"); return; }
      const res = await fetch(`${API_URL}/api/contacts/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ workspaceId, rows }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Import failed");
      const data = await res.json();
      setResult({ created: data.created ?? 0, updated: data.updated ?? 0 });
      toast.success(`${data.created ?? 0} contacts imported`);
    } catch (e: any) {
      toast.error(e.message || "Failed to import contacts");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-[26px] font-semibold text-gray-900">Import your contacts</h1>
        <p className="text-sm text-gray-500 mt-1.5">
          Seed Proply's memory with your existing pipeline. Upload a CSV from your CRM or spreadsheet.
        </p>
      </div>

      {result ? (
        <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
            <Check className="w-6 h-6 text-emerald-600" />
          </div>
          <p className="font-semibold text-gray-900 text-lg">{result.created} contacts imported</p>
          {result.updated > 0 && (
            <p className="text-sm text-gray-500 mt-1">{result.updated} existing contacts updated</p>
          )}
          <p className="text-xs text-gray-400 mt-2">{fileName}</p>
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
          className={cn(
            "border-2 border-dashed rounded-xl p-12 text-center transition-all",
            isUploading
              ? "border-gray-200 bg-gray-50 cursor-default"
              : isDragging
                ? "border-gray-400 bg-gray-50 cursor-copy"
                : "border-gray-200 hover:border-gray-300 hover:bg-gray-50/50 cursor-pointer"
          )}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          {isUploading ? (
            <div className="space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto" />
              <p className="text-sm text-gray-500">Importing contacts...</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto">
                <Upload className="w-5 h-5 text-gray-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">Upload CSV</p>
                <p className="text-xs text-gray-400 mt-1">Drag & drop or click to browse</p>
              </div>
              <p className="text-xs text-gray-300">email, first_name, last_name, company, job_title</p>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Button
          onClick={onNext}
          disabled={isUploading}
          className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white rounded-lg font-medium"
        >
          {result ? "Finish setup" : "Continue"}
        </Button>
        {!result && (
          <button
            onClick={onSkip}
            className="w-full text-center text-sm text-gray-400 hover:text-gray-600 transition-colors py-1"
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Loading screen ───────────────────────────────────────────────────────────
function LoadingScreen({ companyName }: { companyName: string }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const steps = 60;
    const interval = 3000 / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += 1;
      setProgress(Math.min(100, Math.round(100 * (1 - Math.pow(1 - current / steps, 2)))));
      if (current >= steps) clearInterval(timer);
    }, interval);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f5f5f5]">
      <div className="flex flex-col items-center gap-6 w-full max-w-[320px]">
        <img src="/newlogoP.png" alt="Proply" className="h-10 w-auto" />
        <div className="w-full">
          <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-gray-900 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-center text-sm text-gray-500 mt-3">
            Setting up <span className="font-medium text-gray-900">{companyName || "your"}</span> memory...
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Onboarding page ─────────────────────────────────────────────────────
interface OnboardingProps {
  testMode?: boolean;
}

export default function Onboarding({ testMode = false }: OnboardingProps) {
  const navigate = useNavigate();
  const { session, userData, refreshUserData } = useAuth();

  const [step, setStep] = useState<1 | 2 | 3 | "loading">(1);
  const [isLoading, setIsLoading] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [selectedUseCases, setSelectedUseCases] = useState<string[]>([]);

  useEffect(() => {
    if (!testMode && userData?.onboarding_completed) {
      navigate("/", { replace: true });
    }
  }, [testMode, userData?.onboarding_completed, navigate]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const p = JSON.parse(saved);
        if (p.companyName) setCompanyName(p.companyName);
        if (p.website) setWebsite(p.website);
        if (p.selectedUseCases) setSelectedUseCases(p.selectedUseCases);
        if (p.step && p.step !== "loading") setStep(p.step);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (step === "loading") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ step, companyName, website, selectedUseCases }));
  }, [step, companyName, website, selectedUseCases]);

  const handleStep1Next = async () => {
    if (!companyName.trim()) return;
    setIsLoading(true);
    try {
      await fetch(`${API_URL}/api/onboarding/step-1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          company_name: companyName.trim(),
          use_case: selectedUseCases.map(id => USE_CASES.find(u => u.id === id)?.label || id).join(", "),
        }),
      });
    } catch { /* non-blocking */ } finally {
      setIsLoading(false);
      setStep(2);
    }
  };

  const handleComplete = async () => {
    setStep("loading");
    try {
      await fetch(`${API_URL}/api/onboarding/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({}),
      });
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem("proply_just_onboarded", "true");
      localStorage.setItem("assetly_just_completed_onboarding", "true");
      localStorage.setItem("assetly_onboarding_company_name", companyName.trim());
      refreshUserData().catch(console.error);
    } catch { /* non-blocking */ }
    setTimeout(() => navigate("/", { replace: true }), 3200);
  };

  const workspaceId = userData?.workspace?.id;

  if (step === "loading") {
    return <LoadingScreen companyName={companyName} />;
  }

  return (
    <div className="min-h-screen flex bg-white">
      <div className="flex-1 flex flex-col">
        <header className="px-8 py-6 flex items-center justify-between">
          <img src="/newlogoP.png" alt="Proply" className="h-8 w-auto" />
          <StepProgress current={step} total={TOTAL_STEPS} />
        </header>

        <div className="flex-1 flex items-center justify-center px-8 lg:px-16 py-8">
          <div className="w-full max-w-[440px]">
            {step === 1 && (
              <Step1Welcome
                companyName={companyName}
                setCompanyName={setCompanyName}
                website={website}
                setWebsite={setWebsite}
                selectedUseCases={selectedUseCases}
                setSelectedUseCases={setSelectedUseCases}
                onNext={handleStep1Next}
                isLoading={isLoading}
              />
            )}
            {step === 2 && (
              <Step2ApiKey
                onNext={() => setStep(3)}
                onSkip={() => setStep(3)}
              />
            )}
            {step === 3 && (
              <Step3Contacts
                onNext={handleComplete}
                onSkip={handleComplete}
                session={session}
                workspaceId={workspaceId}
              />
            )}
          </div>
        </div>

        <footer className="px-8 py-4 text-center">
          <p className="text-xs text-gray-400">Step {step} of {TOTAL_STEPS}</p>
        </footer>
      </div>

      <BrandingPanel />
    </div>
  );
}

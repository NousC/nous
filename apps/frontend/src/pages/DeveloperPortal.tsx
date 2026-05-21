import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Key, Sparkles, Plus, Copy, Trash2,
  CheckCircle2, ExternalLink, HelpCircle, BookOpen,
  RotateCcw, CreditCard, Code2,
  Brain, Users, Building2, ArrowUpFromLine, ArrowDownToLine, Activity,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

const apiUrl = import.meta.env.VITE_API_URL ?? "";
type Section = "quickstart" | "keys" | "billing" | "usage";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApiKey {
  id: string; name: string; key: string;
  created_at: string; last_used?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PLAN_LABELS: Record<string, string> = {
  free: "Free", starter: "Starter", pro: "Pro", scale: "Scale",
};

function authH(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

const IS_CLOUD = !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

const NAV_MAIN: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "quickstart", label: "Quick Start",  icon: Sparkles  },
  { id: "keys",       label: "API Keys",     icon: Key       },
  { id: "usage",      label: "Usage",        icon: Activity  },
  ...(IS_CLOUD ? [{ id: "billing" as Section, label: "Billing", icon: CreditCard }] : []),
];

function UpgradeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const go = (path: string) => { navigate(path); onClose(); };
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-[17px]">Upgrade your plan</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          {[
            { id: "starter", label: "Starter", price: "$49/mo", desc: "150 prospects · 3K memory ops · 3 workspaces" },
            { id: "pro",     label: "Pro",     price: "$149/mo", desc: "1,000 prospects · 20K memory ops · 10 workspaces" },
            { id: "scale",   label: "Scale",   price: "$499/mo", desc: "8,000 prospects · 150K memory ops · unlimited workspaces" },
          ].map(p => (
            <div key={p.id} className="rounded-xl border border-gray-100 p-4 flex items-center justify-between gap-4 hover:border-gray-200 transition-colors">
              <div>
                <p className="text-[13px] font-semibold text-gray-900">{p.label} <span className="text-gray-400 font-normal">{p.price}</span></p>
                <p className="text-[11px] text-gray-400 mt-0.5">{p.desc}</p>
              </div>
              <button
                onClick={() => go("/settings/billing")}
                className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-[12px] font-medium hover:bg-gray-800 transition-colors"
              >
                Choose
              </button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Sidebar({
  active, setActive, plan, opsUsed, opsIncluded, opsRemaining, userName, avatarUrl,
}: {
  active: Section; setActive: (s: Section) => void;
  plan: string; opsUsed: number; opsIncluded: number; opsRemaining: number;
  userName: string; avatarUrl?: string;
}) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const pct = opsIncluded > 0 ? Math.min(100, Math.round((opsUsed / opsIncluded) * 100)) : 0;
  const planLabel = PLAN_LABELS[plan] ?? plan;
  const initials = (userName || "U").charAt(0).toUpperCase();

  return (
    <>
    <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    <aside className="w-[220px] flex-shrink-0 flex flex-col h-full border-r border-gray-100 bg-[#FAFAF9]">
      {/* Logo */}
      <div className="px-5 pt-5 pb-4">
        <img src="/nous-logo.svg" alt="Nous" className="h-7 w-auto object-contain" />
      </div>

      {/* API Management label */}
      <div className="px-5 mb-1.5">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">API Management</p>
      </div>

      {/* Main nav */}
      <nav className="px-2.5 space-y-0.5">
        {NAV_MAIN.map(item => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActive(item.id)}
              className={cn(
                "w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] transition-all text-left",
                isActive
                  ? "bg-gray-900 text-white font-medium"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-100/80"
              )}
            >
              <item.icon
                className="h-[15px] w-[15px] flex-shrink-0"
                strokeWidth={isActive ? 2 : 1.75}
              />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Help section */}
      <div className="px-5 mt-5 mb-1.5">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Help</p>
      </div>
      <nav className="px-2.5 space-y-0.5">
        <a
          href="mailto:support@opennous.cloud"
          className="w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 transition-all"
        >
          <HelpCircle className="h-[15px] w-[15px] flex-shrink-0" strokeWidth={1.75} />
          Support
        </a>
        <a
          href="/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[13px] text-gray-600 hover:text-gray-900 hover:bg-gray-100/80 transition-all"
        >
          <BookOpen className="h-[15px] w-[15px] flex-shrink-0" strokeWidth={1.75} />
          Documentation
          <ExternalLink className="h-3 w-3 ml-auto opacity-40" />
        </a>
      </nav>

      <div className="flex-1" />

      {/* Ops balance box */}
      <div className="px-3 pb-3">
        <div className="rounded-xl bg-white border border-gray-100 p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-gray-600">{planLabel}</span>
            <button onClick={() => setActive("billing")} className="text-[11px] text-gray-400 hover:text-gray-700 hover:underline">
              Billing →
            </button>
          </div>
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1.5">
              <span>{opsRemaining.toLocaleString()} ops left this month</span>
              <span className={cn("font-medium tabular-nums", opsRemaining < 500 ? "text-amber-500" : "text-gray-600")}>
                {opsUsed.toLocaleString()}/{opsIncluded.toLocaleString()}
              </span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-500",
                  pct > 80 ? "bg-amber-400" : "bg-gray-900")}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* User row */}
      <div className="px-3 pb-4 border-t border-gray-100 pt-3">
        <div className="flex items-center gap-2.5 px-1">
          <Avatar className="h-6 w-6 flex-shrink-0 border border-gray-200/60">
            <AvatarImage src={avatarUrl} alt={userName} />
            <AvatarFallback className="text-[10px] font-semibold bg-gray-900 text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="text-[12px] text-gray-700 truncate font-medium">{userName || "Account"}</span>
        </div>
      </div>
    </aside>
    </>
  );
}

// ── Quick Start ───────────────────────────────────────────────────────────────

type InstallMethod = "openclaw" | "sdk" | "plugin";
type SdkLang = "python" | "nodejs" | "curl";
type PluginClient = "claude-code" | "claude-desktop" | "cursor";

const INSTALL_METHODS: { id: InstallMethod; label: string; desc: string; logo: string | null }[] = [
  { id: "plugin",   label: "Claude Plugin",   desc: "Memory inside Claude & agents", logo: "/logos/claude.svg"   },
  { id: "sdk",      label: "SDK Integration", desc: "Drop into your existing agent", logo: null                  },
  { id: "openclaw", label: "OpenClaw",        desc: "Memory across every session",   logo: "/logos/openclaw.svg" },
];

const SDK_STEPS: Record<SdkLang, { label: string; desc: string; code: string }[]> = {
  python: [
    {
      label: "Install the SDK",
      desc: "Get started by installing the Nous Python package using pip.",
      code: "pip install nous",
    },
    {
      label: "Initialize the client",
      desc: "Initialize with your API key — no workspace ID needed, keys are workspace-scoped.",
      code: `from nous import NousClient

client = NousClient(api_key="YOUR_API_KEY")`,
    },
    {
      label: "Remember a fact",
      desc: "Store what was learned. Pass a sentence or full transcript — AI extracts facts either way.",
      code: `client.remember(
  email="sarah@acme.com",
  text="Concerned about Salesforce migration and Q3 budget constraints.",
  category="Product"
)`,
    },
    {
      label: "Get contact context",
      desc: "Full profile — summary, stage, scores, facts, activities. Call this before acting on any contact.",
      code: `contact = client.get_contact("sarah@acme.com")
print(contact["summary"])
# → "Sarah is evaluating for Q3; primary concern is Salesforce migration."`,
    },
    {
      label: "Get company profile",
      desc: "Full org profile — all contacts at that account plus company-level facts.",
      code: `company = client.get_company(contact["company_id"])
print(f"{company['name']} — {len(company['contacts'])} contacts")`,
    },
    {
      label: "Create a contact",
      desc: "Add a new contact. Returns a conflict error if the email already exists.",
      code: `contact = client.create_contact(
  email="sarah@acme.com",
  first_name="Sarah",
  last_name="Chen",
  company="Acme Corp",
  job_title="VP Sales"
)`,
    },
    {
      label: "List contacts",
      desc: "List contacts filtered by pipeline stage — useful for knowing who to prioritize.",
      code: `result = client.list_contacts(stage="evaluating", limit=20)
for c in result["contacts"]:
    print(c["name"], c["pipeline_stage"])`,
    },
    {
      label: "Get workspace memories",
      desc: "Load workspace-level facts (ICP, patterns, pricing). Filter by category.",
      code: `mems = client.get_memories(category="ICP")
for m in mems["memories"]:
    print(f"[{m['category']}] {m['content']} — id: {m['id']}")`,
    },
    {
      label: "Search memories",
      desc: "Semantic search across all stored facts. Returns IDs so you can delete specific entries.",
      code: `results = client.search("budget concerns", contact_id=contact["contact_id"])
for r in results["results"]:
    print(f"[{r['category']}] {r['content']} — id: {r['id']}")`,
    },
    {
      label: "Delete a memory",
      desc: "Remove a stale fact by ID. Get the ID from search or get_memories.",
      code: `client.delete_memory("MEMORY_UUID")`,
    },
    {
      label: "Delete a contact",
      desc: "Permanently remove a contact and all their activity history.",
      code: `client.delete_contact("sarah@acme.com")`,
    },
  ],
  nodejs: [
    {
      label: "Install the SDK",
      desc: "Get started by installing the Nous Node.js package using npm.",
      code: "npm install @opennous/sdk",
    },
    {
      label: "Initialize the client",
      desc: "Initialize with your API key — no workspace ID needed, keys are workspace-scoped.",
      code: `import { Nous } from '@opennous/sdk';

const nous = new Nous({ apiKey: 'YOUR_API_KEY' });`,
    },
    {
      label: "Remember a fact",
      desc: "Store what was learned. Pass a sentence or full transcript — AI extracts facts either way.",
      code: `await nous.remember({
  email: 'sarah@acme.com',
  text: 'Concerned about Salesforce migration and Q3 budget constraints.',
  category: 'Product',
});`,
    },
    {
      label: "Get contact context",
      desc: "Full profile — summary, stage, scores, facts, activities. Call this before acting on any contact.",
      code: `const contact = await nous.getContact('sarah@acme.com');
console.log(contact.summary);
// → "Sarah is evaluating for Q3; primary concern is Salesforce migration."`,
    },
    {
      label: "Get company profile",
      desc: "Full org profile — all contacts at that account plus company-level facts.",
      code: `const company = await nous.getCompany(contact.company_id);
console.log(\`\${company.name} — \${company.contacts.length} contacts\`);`,
    },
    {
      label: "Create a contact",
      desc: "Add a new contact. Returns a conflict error if the email already exists.",
      code: `await nous.createContact({
  email: 'sarah@acme.com',
  first_name: 'Sarah',
  last_name: 'Chen',
  company: 'Acme Corp',
  job_title: 'VP Sales',
});`,
    },
    {
      label: "List contacts",
      desc: "List contacts filtered by pipeline stage — useful for knowing who to prioritize.",
      code: `const { contacts } = await nous.listContacts({ stage: 'evaluating', limit: 20 });
contacts.forEach(c => console.log(c.name, c.pipeline_stage));`,
    },
    {
      label: "Get workspace memories",
      desc: "Load workspace-level facts (ICP, patterns, pricing). Filter by category.",
      code: `const { memories } = await nous.getMemories({ category: 'ICP' });
memories.forEach(m => console.log(\`[\${m.category}] \${m.content} — \${m.id}\`));`,
    },
    {
      label: "Search memories",
      desc: "Semantic search across all stored facts. Returns IDs for targeted deletion.",
      code: `const { results } = await nous.search({
  q: 'budget concerns',
  contact_id: contact.contact_id,
});
results.forEach(r => console.log(\`[\${r.category}] \${r.content} — \${r.id}\`));`,
    },
    {
      label: "Delete a memory",
      desc: "Remove a stale fact by ID. Get the ID from search or getMemories.",
      code: `await nous.deleteMemory('MEMORY_UUID');`,
    },
    {
      label: "Delete a contact",
      desc: "Permanently remove a contact and all their activity history.",
      code: `await nous.deleteContact('sarah@acme.com');`,
    },
  ],
  curl: [
    {
      label: "Create a contact",
      desc: "POST to add a new contact. Returns 409 if the email already exists.",
      code: `curl --request POST \\
  --url https://api.opennous.cloud/v1/contacts \\
  --header 'Authorization: Bearer YOUR_API_KEY' \\
  --header 'Content-Type: application/json' \\
  --data '{
    "email": "sarah@acme.com",
    "first_name": "Sarah",
    "last_name": "Chen",
    "company": "Acme Corp",
    "job_title": "VP Sales"
  }'`,
    },
    {
      label: "Remember a fact",
      desc: "POST to store what was learned. AI extracts durable facts automatically.",
      code: `curl --request POST \\
  --url https://api.opennous.cloud/v1/remember \\
  --header 'Authorization: Bearer YOUR_API_KEY' \\
  --header 'Content-Type: application/json' \\
  --data '{
    "email": "sarah@acme.com",
    "text": "Concerned about Salesforce migration and Q3 budget constraints."
  }'`,
    },
    {
      label: "Get contact context",
      desc: "GET the full contact profile — summary, stage, facts, activities.",
      code: `curl --request GET \\
  --url https://api.opennous.cloud/v1/contact/sarah@acme.com \\
  --header 'Authorization: Bearer YOUR_API_KEY'`,
    },
    {
      label: "Get company profile",
      desc: "GET the full company profile — all contacts + org-level facts.",
      code: `curl --request GET \\
  --url https://api.opennous.cloud/v1/company/COMPANY_UUID \\
  --header 'Authorization: Bearer YOUR_API_KEY'`,
    },
    {
      label: "List contacts",
      desc: "GET contacts filtered by pipeline stage.",
      code: `curl --request GET \\
  --url 'https://api.opennous.cloud/v1/contacts?stage=evaluating&limit=20' \\
  --header 'Authorization: Bearer YOUR_API_KEY'`,
    },
    {
      label: "Get workspace memories",
      desc: "GET workspace-level facts. Filter by category with ?category=ICP",
      code: `curl --request GET \\
  --url 'https://api.opennous.cloud/v1/memories?category=ICP' \\
  --header 'Authorization: Bearer YOUR_API_KEY'`,
    },
    {
      label: "Search memories",
      desc: "POST to search semantically. Returns IDs for deletion.",
      code: `curl --request POST \\
  --url https://api.opennous.cloud/v1/search \\
  --header 'Authorization: Bearer YOUR_API_KEY' \\
  --header 'Content-Type: application/json' \\
  --data '{
    "q": "budget concerns",
    "contact_id": "optional-uuid"
  }'`,
    },
    {
      label: "Delete a memory",
      desc: "DELETE a specific memory by UUID.",
      code: `curl --request DELETE \\
  --url https://api.opennous.cloud/v1/memory/MEMORY_UUID \\
  --header 'Authorization: Bearer YOUR_API_KEY'`,
    },
    {
      label: "Delete a contact",
      desc: "DELETE a contact and all their activity history. Accepts email or UUID.",
      code: `curl --request DELETE \\
  --url https://api.opennous.cloud/v1/contact/sarah@acme.com \\
  --header 'Authorization: Bearer YOUR_API_KEY'`,
    },
  ],
};

const MCP_TOOLS = [
  { name: "get_contact",    desc: "Full contact profile in one call — stage, warmth, scores, memory facts, recent activities with full message bodies." },
  { name: "track",          desc: "Log that something happened — call held, email sent, meeting completed, website visit. Auto-creates the contact if needed." },
  { name: "remember",       desc: "Store a durable fact — about a person, their company, or your workspace (ICP, pricing, competitive intel). Bulk text or one sentence." },
  { name: "get_company",    desc: "Full company profile — org details, deal health, all contacts at the account, and company-level facts." },
  { name: "search",         desc: "Semantic search across all stored facts — scope to one contact, one company, or the whole workspace." },
  { name: "list_contacts",  desc: "Find contacts by pipeline stage. Useful for identifying who to prioritize or reach out to next." },
  { name: "get_memories",   desc: "Load all workspace-level facts — ICP, product description, pricing, market positioning, competitive intel." },
  { name: "create_contact", desc: "Add a new contact with full profile fields — name, title, company, phone, LinkedIn." },
  { name: "update_contact", desc: "Update profile fields on an existing contact. Only provided fields are changed." },
  { name: "delete_contact", desc: "Permanently delete a contact and all their data. Cannot be undone." },
  { name: "delete_memory",  desc: "Remove a specific workspace memory by ID. Get the ID from get_memories or search first." },
];

function TabBar<T extends string>({
  tabs, active, onChange, size = "md",
}: {
  tabs: { id: T; label: string; icon?: React.ReactNode }[];
  active: T;
  onChange: (t: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex rounded-lg border border-gray-100 bg-gray-50 p-0.5 gap-0.5">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "flex items-center gap-1.5 rounded-md font-semibold transition-all",
            size === "sm" ? "px-3 py-1 text-[11px]" : "px-4 py-1.5 text-[12px]",
            active === t.id
              ? "bg-white text-gray-900 shadow-sm border border-gray-100"
              : "text-gray-400 hover:text-gray-600"
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

function OpenClawPanel({ onNavigate }: { onNavigate: (s: Section) => void }) {
  const prompt = `You have access to Nous contact memory. Use it before and after every contact interaction.

Before acting on any contact:
→ Call contact_get(email or contact_id) to load their full profile — pipeline stage, AI summary, recent activities, facts, and LinkedIn channel state. Never skip this step.

After every interaction:
→ Call track(email, type, description) to log what happened.
→ Call memory_save(email, text) to store what you learned as a durable fact.

Available tools: contact_get, contact_get_activity, contacts_search, company_get, track, memory_save, memory_search, memory_list, memory_delete

Your Nous API key is set as NOUS_API_KEY in the environment.`;

  return (
    <div className="space-y-4">
      <h3 className="text-[14px] font-semibold text-gray-800">Set up OpenClaw</h3>
      <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-4">
        <p className="text-[12px] text-gray-400">Copy this installation prompt into OpenClaw:</p>
        <CodeSnippet code={prompt} />
      </div>
      <p className="text-[12px] text-gray-400">
        Need an API key?{" "}
        <button onClick={() => onNavigate("keys")} className="text-gray-700 underline underline-offset-2 hover:text-gray-900">
          Create one here →
        </button>
      </p>
    </div>
  );
}

function SdkPanel({ onNavigate }: { onNavigate: (s: Section) => void }) {
  const [lang, setLang] = useState<SdkLang>("nodejs");
  const steps = SDK_STEPS[lang];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-gray-800">Set up SDK Integration</h3>
        <TabBar
          tabs={[
            { id: "python" as SdkLang, label: "Python",  icon: <img src="/logos/python.svg" alt="" className="w-3.5 h-3.5" /> },
            { id: "nodejs" as SdkLang, label: "Node.js", icon: <img src="/logos/nodejs.svg" alt="" className="w-3.5 h-3.5" /> },
            { id: "curl"   as SdkLang, label: "Curl API" },
          ]}
          active={lang}
          onChange={setLang}
          size="sm"
        />
      </div>

      <div className="space-y-4">
        {steps.map((step, i) => (
          <div key={i} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-900 text-white text-[11px] font-bold shrink-0">
                {i + 1}
              </span>
              {i < steps.length - 1 && <div className="w-px flex-1 bg-gray-100 mt-2" />}
            </div>
            <div className="flex-1 pb-4 space-y-2.5">
              <div>
                <p className="text-[13px] font-semibold text-gray-800">{step.label}</p>
                <p className="text-[12px] text-gray-400 mt-0.5">{step.desc}</p>
              </div>
              <CodeSnippet code={step.code} />
            </div>
          </div>
        ))}
      </div>

      <p className="text-[12px] text-gray-400">
        Need an API key?{" "}
        <button onClick={() => onNavigate("keys")} className="text-gray-700 underline underline-offset-2 hover:text-gray-900">
          Create one here →
        </button>
      </p>
    </div>
  );
}

function PluginPanel() {
  const [client, setClient] = useState<PluginClient>("claude-code");

  const claudeCodeMcp = `claude mcp add nous -e NOUS_API_KEY=YOUR_API_KEY -- npx -y @opennous/mcp`;

  const claudeDesktopMcp = `// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "nous": {
      "command": "npx",
      "args": ["-y", "@opennous/mcp"],
      "env": {
        "NOUS_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}`;

  const cursorMcp = `// .cursor/mcp.json
{
  "mcpServers": {
    "nous": {
      "command": "npx",
      "args": ["-y", "@opennous/mcp"],
      "env": {
        "NOUS_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}`;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-gray-800">Set up MCP Server</h3>
        <TabBar
          tabs={[
            { id: "claude-code"    as PluginClient, label: "CLAUDE CODE" },
            { id: "claude-desktop" as PluginClient, label: "CLAUDE DESKTOP" },
            { id: "cursor"         as PluginClient, label: "CURSOR" },
          ]}
          active={client}
          onChange={setClient}
          size="sm"
        />
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-4">
        {client === "claude-code" && (
          <>
            <p className="text-[12px] text-gray-400">Add the Nous MCP server with a single command in your terminal:</p>
            <CodeSnippet code={claudeCodeMcp} />
          </>
        )}

        {client === "claude-desktop" && (
          <>
            <p className="text-[12px] text-gray-400">
              Add to{" "}
              <code className="bg-gray-100 px-1 rounded text-[11px]">~/Library/Application Support/Claude/claude_desktop_config.json</code>
              , then restart Claude Desktop.
            </p>
            <CodeSnippet code={claudeDesktopMcp} />
          </>
        )}

        {client === "cursor" && (
          <>
            <p className="text-[12px] text-gray-400">
              Add to{" "}
              <code className="bg-gray-100 px-1 rounded text-[11px]">.cursor/mcp.json</code>
              {" "}in your project root, then restart Cursor.
            </p>
            <CodeSnippet code={cursorMcp} />
          </>
        )}
      </div>

      {/* MCP tools */}
      <div className="rounded-xl border border-gray-100 bg-white p-5">
        <p className="text-[13px] font-semibold text-gray-800 mb-3">Available tools</p>
        <div className="divide-y divide-gray-50">
          {MCP_TOOLS.map(t => (
            <div key={t.name} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <code className="text-[11px] bg-gray-50 border border-gray-100 text-gray-700 px-2 py-0.5 rounded-md font-mono shrink-0 mt-0.5">{t.name}</code>
              <span className="text-[12px] text-gray-500">{t.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuickStartSection({ onNavigate }: { onNavigate: (s: Section) => void }) {
  const [method, setMethod] = useState<InstallMethod>("plugin");

  return (
    <div className="p-8 max-w-3xl space-y-7">
      <div>
        <h2 className="text-[22px] font-bold text-gray-900 tracking-tight">Install Nous</h2>
        <p className="text-[13px] text-gray-500 mt-1">
          Choose how you want to integrate contact memory into your AI agents.
        </p>
      </div>

      {/* Method selector */}
      <div className="grid grid-cols-3 gap-3">
        {INSTALL_METHODS.map(m => (
          <button
            key={m.id}
            onClick={() => setMethod(m.id)}
            className={cn(
              "flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all",
              method === m.id
                ? "border-gray-900 bg-white shadow-sm"
                : "border-gray-100 bg-white hover:border-gray-200"
            )}
          >
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-gray-50 border border-gray-100 overflow-hidden">
              {m.logo ? (
                <img
                  src={m.logo}
                  alt={m.label}
                  className="w-5 h-5 object-contain"
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <Code2 className="h-4 w-4 text-gray-400" />
              )}
            </div>
            <div>
              <p className={cn("text-[13px] font-semibold", method === m.id ? "text-gray-900" : "text-gray-700")}>{m.label}</p>
              <p className="text-[11px] text-gray-400 mt-0.5">{m.desc}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Panel */}
      {method === "openclaw" && <OpenClawPanel onNavigate={onNavigate} />}
      {method === "sdk"      && <SdkPanel onNavigate={onNavigate} />}
      {method === "plugin"   && <PluginPanel />}
    </div>
  );
}

function CodeSnippet({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <div className="relative group rounded-lg bg-gray-50 border border-gray-100 overflow-hidden">
      <pre className="text-[12px] text-gray-700 px-4 py-3 overflow-x-auto font-mono whitespace-pre leading-relaxed">{code}</pre>
      <button onClick={copy}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded bg-white border border-gray-200 hover:bg-gray-100">
        {copied
          ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          : <Copy className="h-3.5 w-3.5 text-gray-400" />}
      </button>
    </div>
  );
}

// ── API Keys ──────────────────────────────────────────────────────────────────

function ApiKeysSection({ workspaceId }: { workspaceId: string }) {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/workspace/api-keys?workspace_id=${encodeURIComponent(workspaceId)}`, { headers: authH(token) });
      const data = await res.json();
      setKeys(data.api_keys ?? data.apiKeys ?? []);
    } finally { setLoading(false); }
  }, [token, workspaceId]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!newName.trim() || !workspaceId) return;
    const res = await fetch(`${apiUrl}/api/workspace/api-keys`, {
      method: "POST",
      headers: { ...authH(token), "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), workspace_id: workspaceId }),
    });
    const data = await res.json();
    if (data.key) {
      setRevealed(data.key);
      setNewName(""); setShowForm(false); load();
    }
  };

  const revoke = async (id: string) => {
    await fetch(`${apiUrl}/api/workspace/api-keys/${id}?workspace_id=${encodeURIComponent(workspaceId)}`, { method: "DELETE", headers: authH(token) });
    setKeys(k => k.filter(x => x.id !== id));
  };

  const copy = (val: string, id: string) => {
    navigator.clipboard.writeText(val);
    setCopiedId(id); setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-gray-900 tracking-tight mb-1">API Keys</h1>
        <p className="text-[13px] text-gray-500">Create and manage API keys for your workspace endpoints.</p>
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-3 mb-6">
        <Button
          onClick={() => setShowForm(true)}
          disabled={showForm || !!revealed}
          className="bg-gray-900 text-white hover:bg-gray-800 h-8 text-[13px] px-3 rounded-lg"
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Create new key
        </Button>
        <a
          href="/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" /> API Documentation
        </a>
      </div>

      {/* Revealed key banner */}
      {revealed && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Key created — copy it now
          </div>
          <p className="text-[12px] text-emerald-600">This is the only time the full key is shown.</p>
          <div className="flex gap-2">
            <input value={revealed} readOnly
              className="flex-1 font-mono text-[12px] bg-white border border-emerald-200 rounded-lg px-3 py-2 text-gray-800 outline-none" />
            <button onClick={() => copy(revealed, "revealed")}
              className="px-3 py-2 rounded-lg bg-white border border-emerald-200 hover:bg-emerald-50">
              {copiedId === "revealed"
                ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                : <Copy className="h-4 w-4 text-gray-400" />}
            </button>
          </div>
          <button onClick={() => setRevealed(null)} className="text-[12px] text-emerald-600 hover:underline">Done</button>
        </div>
      )}

      {/* Create form */}
      {showForm && !revealed && (
        <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-2.5">
          <p className="text-[13px] font-medium text-gray-800">Name your key</p>
          <div className="flex gap-2">
            <Input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && create()}
              placeholder="e.g. Production, n8n, CRM sync"
              className="flex-1 bg-white h-9 text-[13px]" />
            <Button onClick={create} disabled={!newName.trim()}
              className="bg-gray-900 text-white hover:bg-gray-800 h-9 text-[13px]">Create</Button>
            <Button variant="ghost" onClick={() => { setShowForm(false); setNewName(""); }}
              className="h-9 text-[13px]">Cancel</Button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="space-y-px rounded-xl overflow-hidden border border-gray-100">
          {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-gray-50 animate-pulse" />)}
        </div>
      ) : keys.length === 0 && !showForm ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-14 text-center">
          <Key className="h-7 w-7 text-gray-300 mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-[13px] font-medium text-gray-600 mb-1">No API keys yet</p>
          <p className="text-[12px] text-gray-400">Create your first key to start making requests.</p>
        </div>
      ) : keys.length > 0 ? (
        <div className="rounded-xl border border-gray-100 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_1.5fr_1.5fr_80px] gap-4 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
            {["Name", "API Key", "Last accessed", "Actions"].map(h => (
              <p key={h} className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{h}</p>
            ))}
          </div>
          {/* Rows */}
          {keys.map(k => (
            <div key={k.id}
              className="grid grid-cols-[2fr_1.5fr_1.5fr_80px] gap-4 items-center px-4 py-3.5 bg-white hover:bg-gray-50/60 border-b border-gray-50 last:border-0 transition-colors">
              <div>
                <p className="text-[13px] font-semibold text-gray-900">{k.name}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Created {format(new Date(k.created_at), "MMM d, yyyy")}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[12px] text-gray-500 truncate">{k.key}</span>
                <button onClick={() => copy(k.key, k.id)}
                  className="flex-shrink-0 p-1 rounded text-gray-300 hover:text-gray-600 transition-colors">
                  {copiedId === k.id
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="text-[12px] text-gray-400">
                {k.last_used ? format(new Date(k.last_used), "MMM d, yyyy") : "—"}
              </p>
              <div className="flex items-center gap-1.5">
                <button title="Revoke & regenerate" onClick={() => revoke(k.id)}
                  className="p-1.5 rounded text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button title="Delete" onClick={() => revoke(k.id)}
                  className="p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {keys.length > 0 && (
        <p className="mt-3 text-[11px] text-gray-400">
          {keys.length} – {keys.length} of {keys.length}
        </p>
      )}
    </div>
  );
}

// ── Usage Section ─────────────────────────────────────────────────────────────

type UsageDateRange = "1d" | "7d" | "30d" | "all";

interface UsageStats {
  totalFacts: number;
  totalContacts: number;
  totalCompanies: number;
  writeOps: number;
  retrieveOps: number;
  deleteOps: number;
  totalOps: number;
  breakdown: Record<string, number>;
  writeBreakdown: Record<string, number>;
  retrieveBreakdown: Record<string, number>;
  deleteBreakdown: Record<string, number>;
  timeSeries: { date: string; write: number; retrieve: number; delete: number }[];
}

// All known operations with display metadata
const ALL_OPS = [
  { key: "activity",        label: "Track",    type: "write",    color: "#7c3aed" },
  { key: "memory",          label: "Remember", type: "write",    color: "#7c3aed" },
  { key: "contact_create",  label: "Create",   type: "write",    color: "#7c3aed" },
  { key: "contact_update",  label: "Update",   type: "write",    color: "#7c3aed" },
  { key: "contact",      label: "Contact",   type: "retrieve", color: "#3b82f6" },
  { key: "contact_list", label: "List",      type: "retrieve", color: "#3b82f6" },
  { key: "company",      label: "Company",   type: "retrieve", color: "#3b82f6" },
  { key: "search",       label: "Search",    type: "retrieve", color: "#3b82f6" },
  { key: "memory",       label: "Memory",    type: "delete",   color: "#ef4444" },
  { key: "contact",      label: "Contact",   type: "delete",   color: "#ef4444" },
] as const;

type OpKey = typeof ALL_OPS[number]["key"];

function StatCard({ icon: Icon, label, value, sub }: {
  icon: React.ElementType; label: string; value: number | string; sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-7 w-7 rounded-lg bg-gray-100 flex items-center justify-center">
          <Icon className="h-3.5 w-3.5 text-gray-600" strokeWidth={1.75} />
        </div>
        <p className="text-[12px] text-gray-500">{label}</p>
      </div>
      <p className="text-[28px] font-bold text-gray-900 leading-none tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub && <p className="text-[11px] text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

const ChartTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg bg-gray-900 text-white text-[11px] px-2.5 py-1.5 shadow-lg">
      <p className="text-gray-400 mb-0.5">{d.label}</p>
      <p className="font-semibold">{d.value.toLocaleString()} requests</p>
    </div>
  );
};

const WRITE_OPS    = ALL_OPS.filter(o => o.type === "write");
const RETRIEVE_OPS = ALL_OPS.filter(o => o.type === "retrieve");
const DELETE_OPS   = ALL_OPS.filter(o => o.type === "delete");

type WriteKey    = typeof WRITE_OPS[number]["key"];
type RetrieveKey = typeof RETRIEVE_OPS[number]["key"];
type DeleteKey   = typeof DELETE_OPS[number]["key"];

function OpsChart({
  title, sub, ops, activeKeys, onToggle, breakdown, accentClass,
}: {
  title: string;
  sub: string;
  ops: typeof ALL_OPS[number][];
  activeKeys: Set<string>;
  onToggle: (key: string) => void;
  breakdown: Record<string, number>;
  accentClass: string; // e.g. "border-violet-200 text-violet-700"
}) {
  const chartData = ops
    .filter(op => activeKeys.has(op.key))
    .map(op => ({ key: op.key, label: op.label, value: breakdown[op.key] ?? 0, color: op.color }));

  const total = ops.reduce((s, op) => s + (breakdown[op.key] ?? 0), 0);

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 space-y-4 flex-1 min-w-0">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-gray-800">{title}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">{total.toLocaleString()} {sub}</p>
        </div>
        {/* Filter pills */}
        <div className="flex flex-wrap gap-1 justify-end">
          {ops.map(op => (
            <button
              key={op.key}
              onClick={() => onToggle(op.key)}
              className={cn(
                "px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all",
                activeKeys.has(op.key)
                  ? accentClass
                  : "border-gray-100 text-gray-300 bg-white"
              )}
              style={activeKeys.has(op.key) ? { backgroundColor: op.color + "18" } : {}}
            >
              {op.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      {total === 0 ? (
        <div className="h-40 flex flex-col items-center justify-center text-center">
          <p className="text-[12px] text-gray-300">No data in this range</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chartData} barCategoryGap="35%">
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={28} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f9fafb" }} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function ActivityChart({
  timeSeries, range,
}: {
  timeSeries: { date: string; write: number; retrieve: number; delete: number }[];
  range: UsageDateRange;
}) {
  const data = timeSeries.map(d => ({
    ...d,
    label: new Date(d.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  }));
  const total = data.reduce((s, d) => s + d.write + d.retrieve + (d.delete ?? 0), 0);

  const tickInterval = range === "30d" ? 4 : range === "all" ? 6 : 0;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[13px] font-semibold text-gray-800">Daily Activity</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {total === 0 ? "No requests in this period" : `${total.toLocaleString()} total requests`}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-violet-500 inline-block" />Write
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-blue-500 inline-block" />Retrieve
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-red-500 inline-block" />Delete
          </span>
        </div>
      </div>
      {total === 0 ? (
        <div className="h-40 flex items-center justify-center">
          <p className="text-[12px] text-gray-300">Make your first API call to see activity here</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data} barCategoryGap="30%" barGap={2}>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} interval={tickInterval} />
            <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
            <Tooltip
              content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="rounded-lg bg-gray-900 text-white text-[11px] px-2.5 py-1.5 shadow-lg space-y-0.5">
                    <p className="text-gray-400 font-medium mb-1">{label}</p>
                    {payload.map((p: any) => (
                      <p key={p.name} style={{ color: p.fill }}>
                        {p.name === "write" ? "Write" : p.name === "retrieve" ? "Retrieve" : "Delete"}: {p.value.toLocaleString()}
                      </p>
                    ))}
                  </div>
                );
              }}
              cursor={{ fill: "#f9fafb" }}
            />
            <Bar dataKey="write"    fill="#7c3aed" radius={[3, 3, 0, 0]} />
            <Bar dataKey="retrieve" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            <Bar dataKey="delete"   fill="#ef4444" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function UsageSection({ token }: { token: string }) {
  const [stats, setStats]         = useState<UsageStats | null>(null);
  const [loading, setLoading]     = useState(true);
  const [range, setRange]         = useState<UsageDateRange>("7d");
  const [activeWrite, setWrite]     = useState<Set<WriteKey>>(new Set(WRITE_OPS.map(o => o.key)));
  const [activeRetrieve, setRetrieve] = useState<Set<RetrieveKey>>(new Set(RETRIEVE_OPS.map(o => o.key)));
  const [activeDelete, setDelete]   = useState<Set<DeleteKey>>(new Set(DELETE_OPS.map(o => o.key)));

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    const params = new URLSearchParams({ days: range });
    const wsId = localStorage.getItem("selectedWorkspaceId");
    if (wsId) params.set("workspace_id", wsId);
    fetch(`${apiUrl}/api/requests/stats?${params}`, { headers: authH(token) })
      .then(r => r.ok ? r.json() : null)
      .then(d => setStats(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, range]);

  const DATE_TABS: { id: UsageDateRange; label: string }[] = [
    { id: "1d", label: "1d" }, { id: "7d", label: "7d" },
    { id: "30d", label: "30d" }, { id: "all", label: "All Time" },
  ];

  const writeBreakdown    = stats?.writeBreakdown    ?? {};
  const retrieveBreakdown = stats?.retrieveBreakdown ?? {};
  const deleteBreakdown   = stats?.deleteBreakdown   ?? {};
  const totalOps          = stats?.totalOps          ?? 0;

  function makeToggle<K extends string>(set: Set<K>, setter: React.Dispatch<React.SetStateAction<Set<K>>>) {
    return (key: string) => {
      setter(prev => {
        const next = new Set(prev);
        if (next.has(key as K)) {
          if (next.size === 1) return prev;
          next.delete(key as K);
        } else {
          next.add(key as K);
        }
        return next;
      });
    };
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-gray-900 tracking-tight mb-0.5">Usage</h1>
          <p className="text-[13px] text-gray-400">Memory layer activity across your workspace.</p>
        </div>
        <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 rounded-lg">
          {DATE_TABS.map(t => (
            <button key={t.id} onClick={() => setRange(t.id)}
              className={cn("px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
                range === t.id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700")}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <div key={i} className="h-28 rounded-2xl bg-gray-100 animate-pulse" />)}
          </div>
          <div className="h-52 rounded-2xl bg-gray-100 animate-pulse" />
          <div className="flex gap-4">
            <div className="flex-1 h-56 rounded-2xl bg-gray-100 animate-pulse" />
            <div className="flex-1 h-56 rounded-2xl bg-gray-100 animate-pulse" />
          </div>
        </div>
      ) : (
        <>
          {/* Stat cards — all-time workspace totals */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Brain}     label="Total Memories" value={stats?.totalFacts ?? 0}    sub="All-time facts stored" />
            <StatCard icon={Users}     label="Contacts"       value={stats?.totalContacts ?? 0}  sub="People tracked" />
            <StatCard icon={Building2} label="Companies"      value={stats?.totalCompanies ?? 0} sub="Orgs tracked" />
            <StatCard icon={Activity}  label="Total Requests" value={totalOps}                   sub={`Last ${range === "all" ? "30 days" : range}`} />
          </div>

          {/* Daily activity trend */}
          <ActivityChart timeSeries={stats?.timeSeries ?? []} range={range} />

          {/* Per-operation breakdown — three charts side by side */}
          <div className="flex gap-4">
            <OpsChart
              title="Write Requests"
              sub="total write ops"
              ops={WRITE_OPS as unknown as typeof ALL_OPS[number][]}
              activeKeys={activeWrite as Set<string>}
              onToggle={makeToggle(activeWrite, setWrite)}
              breakdown={writeBreakdown}
              accentClass="border-violet-200 text-violet-700"
            />
            <OpsChart
              title="Retrieve Requests"
              sub="total retrieve ops"
              ops={RETRIEVE_OPS as unknown as typeof ALL_OPS[number][]}
              activeKeys={activeRetrieve as Set<string>}
              onToggle={makeToggle(activeRetrieve, setRetrieve)}
              breakdown={retrieveBreakdown}
              accentClass="border-blue-200 text-blue-700"
            />
            <OpsChart
              title="Delete Requests"
              sub="total delete ops"
              ops={DELETE_OPS as unknown as typeof ALL_OPS[number][]}
              activeKeys={activeDelete as Set<string>}
              onToggle={makeToggle(activeDelete, setDelete)}
              breakdown={deleteBreakdown}
              accentClass="border-red-200 text-red-700"
            />
          </div>
        </>
      )}
    </div>
  );
}

// ── Billing ───────────────────────────────────────────────────────────────────

type BillingPlan = "free" | "starter" | "pro" | "scale";

interface BillingPlanInfo {
  id: BillingPlan;
  name: string;
  monthlyPriceUsd: number;
  includedOpsPerMonth: number;
  enrichmentsPerMonth: number;
  workspaceLimit: number;
}

interface BillingState {
  billing_disabled: boolean;
  self_hosted?: boolean;
  plan: BillingPlan;
  planName: string;
  subscription: {
    status: string;
    current_period_start: string;
    current_period_end: string;
    cancel_at_period_end: boolean;
    stripe_subscription_id: string;
    is_comp: boolean;
  } | null;
  ops: { used: number; included: number; remaining: number; periodStart: string };
  enrichments: { used: number; included: number; remaining: number };
  allPlans: BillingPlanInfo[];
}

function SelfHostedBillingNotice() {
  return (
    <div className="p-8 space-y-4">
      <div>
        <h1 className="text-[22px] font-bold text-gray-900 tracking-tight mb-0.5">Billing</h1>
        <p className="text-[13px] text-gray-400">Manage your subscription</p>
      </div>
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 max-w-lg space-y-2">
        <p className="text-[14px] font-semibold text-gray-900">You're running Nous self-hosted</p>
        <p className="text-[13px] text-gray-500">
          Billing is managed directly by you. There's no Stripe integration active in this deployment.
          To configure billing, set <code className="bg-gray-100 px-1 rounded text-[12px]">VITE_STRIPE_PUBLISHABLE_KEY</code> in your environment.
        </p>
      </div>
    </div>
  );
}

function UsageBar({ label, used, included }: { label: string; used: number; included: number }) {
  const pct = included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-[12px] mb-1.5">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="tabular-nums text-gray-500">
          {used.toLocaleString()} <span className="text-gray-300">/</span> {included.toLocaleString()}
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", pct > 90 ? "bg-amber-400" : "bg-gray-900")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function BillingSection({ token }: { token: string }) {
  if (!IS_CLOUD) return <SelfHostedBillingNotice />;
  const [data, setData] = useState<BillingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const success = searchParams.get("success") === "true";

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/billing/state`, { headers: authH(token) });
        if (res.ok && !cancelled) setData(await res.json() as BillingState);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const subscribe = async (plan: BillingPlan) => {
    setActing(plan);
    try {
      const res = await fetch(`${apiUrl}/api/billing/subscribe`, {
        method: "POST",
        headers: { ...authH(token), "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const d = await res.json();
      if (d.url) window.location.href = d.url;
    } finally { setActing(null); }
  };

  const openCustomerPortal = async () => {
    setActing("portal");
    try {
      const res = await fetch(`${apiUrl}/api/billing/customer-portal`, {
        method: "POST",
        headers: authH(token),
      });
      const d = await res.json();
      if (d.url) window.open(d.url, "_blank", "noopener,noreferrer");
    } finally { setActing(null); }
  };

  if (loading) {
    return (
      <div className="p-8 space-y-5">
        <div className="h-8 w-32 bg-gray-100 rounded animate-pulse" />
        <div className="h-44 rounded-2xl bg-gray-100 animate-pulse max-w-2xl" />
        <div className="h-64 rounded-2xl bg-gray-100 animate-pulse max-w-2xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 space-y-4">
        <h1 className="text-[22px] font-bold text-gray-900 tracking-tight">Billing</h1>
        <p className="text-[13px] text-gray-400">Couldn't load billing information. Please try again later.</p>
      </div>
    );
  }

  if (data.billing_disabled) {
    return (
      <div className="p-8 space-y-4">
        <div>
          <h1 className="text-[22px] font-bold text-gray-900 tracking-tight mb-0.5">Billing</h1>
          <p className="text-[13px] text-gray-400">Manage your subscription</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 max-w-lg space-y-1.5">
          <p className="text-[14px] font-semibold text-gray-900">Self-hosted — billing disabled</p>
          <p className="text-[13px] text-gray-500">
            This deployment runs without Stripe billing. Plan limits are not enforced.
          </p>
        </div>
      </div>
    );
  }

  const sub = data.subscription;
  const hasSubscription = !!sub?.stripe_subscription_id;

  return (
    <div className="p-8 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-[22px] font-bold text-gray-900 tracking-tight mb-0.5">Billing</h1>
        <p className="text-[13px] text-gray-400">Manage your subscription and monitor usage</p>
      </div>

      {success && (
        <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 flex items-center gap-2.5 max-w-2xl">
          <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
          <p className="text-[13px] text-green-800 font-medium">Subscription updated — your new plan is active.</p>
        </div>
      )}

      {/* Current plan + usage */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 max-w-2xl space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Current Plan</p>
            <p className="text-[20px] font-bold text-gray-900 tracking-tight">{data.planName}</p>
            {sub && (
              <p className="text-[12px] text-gray-400 mt-0.5">
                {sub.cancel_at_period_end ? "Cancels" : "Renews"} {format(new Date(sub.current_period_end), "MMM d, yyyy")}
                {sub.is_comp && <span className="ml-1.5 text-gray-300">· complimentary</span>}
              </p>
            )}
          </div>
          {sub && (
            <span className={cn(
              "px-2.5 py-1 rounded-full text-[11px] font-medium capitalize",
              sub.status === "active" || sub.status === "trialing"
                ? "bg-green-50 text-green-700"
                : "bg-amber-50 text-amber-700"
            )}>
              {sub.status}
            </span>
          )}
        </div>

        <div className="space-y-3.5 border-t border-gray-50 pt-4">
          <UsageBar label="Memory ops" used={data.ops.used} included={data.ops.included} />
          <UsageBar label="Enrichments" used={data.enrichments.used} included={data.enrichments.included} />
        </div>

        {hasSubscription && (
          <div className="border-t border-gray-50 pt-4">
            <Button
              onClick={openCustomerPortal}
              disabled={acting !== null}
              className="h-9 text-[13px] bg-gray-900 text-white hover:bg-gray-800 font-medium"
            >
              {acting === "portal" ? "Opening…" : "Manage subscription"}
            </Button>
          </div>
        )}
      </div>

      {/* Plans */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 max-w-2xl space-y-4">
        <p className="text-[13px] font-semibold text-gray-800">Plans</p>
        <div className="space-y-2">
          {data.allPlans.map(p => {
            const isCurrent = p.id === data.plan;
            const isPaid = p.id !== "free";
            return (
              <div
                key={p.id}
                className={cn(
                  "rounded-xl border p-4 flex items-center justify-between gap-4 transition-colors",
                  isCurrent ? "border-gray-900 bg-gray-50" : "border-gray-100"
                )}
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-gray-900">
                    {p.name}
                    <span className="text-gray-400 font-normal ml-1.5">
                      {p.monthlyPriceUsd > 0 ? `$${p.monthlyPriceUsd}/mo` : "Free"}
                    </span>
                    {isCurrent && (
                      <span className="ml-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Current</span>
                    )}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {p.includedOpsPerMonth.toLocaleString()} ops · {p.enrichmentsPerMonth.toLocaleString()} enrichments · {p.workspaceLimit.toLocaleString()} workspaces
                  </p>
                </div>
                {!isCurrent && isPaid && (
                  <button
                    onClick={() => subscribe(p.id)}
                    disabled={acting !== null}
                    className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-[12px] font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
                  >
                    {acting === p.id ? "Redirecting…" : "Switch"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DeveloperPortal() {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const location = useLocation();
  const navigate = useNavigate();

  const active: Section = (() => {
    if (location.pathname === "/developer") return "keys";
    if (location.pathname === "/billing")   return "billing";
    if (location.pathname === "/usage")     return "usage";
    return "quickstart";
  })();

  const navigateTo = (section: Section) => {
    const map: Record<Section, string> = {
      quickstart: "/",
      keys:       "/developer",
      billing:    "/billing",
      usage:      "/usage",
    };
    navigate(map[section]);
  };

  return (
    <div className="h-full overflow-y-auto bg-white">
      {active === "quickstart" && <QuickStartSection onNavigate={navigateTo} />}
      {active === "keys"       && <ApiKeysSection key={userData?.workspace?.id ?? ""} workspaceId={userData?.workspace?.id ?? ""} />}
      {active === "usage"      && <UsageSection token={token} />}
      {active === "billing"    && <BillingSection token={token} />}
    </div>
  );
}

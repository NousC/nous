import { useState } from "react";
import { Link } from "react-router-dom";
import { Copy, CheckCircle2, Code2, Puzzle, Bot, Feather } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";

// ── Types ───────────────────────────────────────────────────────────────────

type InstallMethod = "openclaw" | "sdk" | "plugin";
type SdkLang = "python" | "nodejs" | "curl";
type PluginClient = "claude-code" | "codex";
type Harness = "openclaw" | "hermes";
type HarnessMode = "prompt" | "cli";

// ── Data ────────────────────────────────────────────────────────────────────

const INSTALL_METHODS: { id: InstallMethod; label: string; desc: string; icon: React.ElementType }[] = [
  { id: "plugin",   label: "Plugin",          desc: "Claude Code & Codex",           icon: Puzzle },
  { id: "sdk",      label: "SDK Integration", desc: "Drop into your existing agent",  icon: Code2  },
  { id: "openclaw", label: "Agent Harness",   desc: "Context across every session",  icon: Bot    },
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

// ── Shared bits ─────────────────────────────────────────────────────────────

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

function ApiKeyHint() {
  return (
    <p className="text-[12px] text-gray-400">
      Need an API key?{" "}
      <Link to="/settings" className="text-gray-700 underline underline-offset-2 hover:text-gray-900">
        Create one here →
      </Link>
    </p>
  );
}

// ── Panels ──────────────────────────────────────────────────────────────────

function AgentHarnessPanel() {
  const [harness, setHarness] = useState<Harness>("openclaw");
  const [mode, setMode] = useState<HarnessMode>("prompt");

  const prompt = `You have access to Nous contact memory. Use it before and after every contact interaction.

Before acting on any contact:
→ Call contact_get(email or contact_id) to load their full profile — pipeline stage, AI summary, recent activities, facts, and LinkedIn channel state. Never skip this step.

After every interaction:
→ Call track(email, type, description) to log what happened.
→ Call memory_save(email, text) to store what you learned as a durable fact.

Available tools: contact_get, contact_get_activity, contacts_search, company_get, track, memory_save, memory_search, memory_list, memory_delete

Your Nous API key is set as NOUS_API_KEY in the environment.`;

  const openclawCli = `openclaw plugins install @opennous/openclaw-nous
openclaw nous init --api-key YOUR_API_KEY
openclaw nous status   # confirm "Connected to Nous"`;

  const hermesCli = `hermes plugins add @opennous/hermes-nous
hermes nous setup --api-key YOUR_API_KEY`;

  const harnessName = harness === "openclaw" ? "OpenClaw" : "Hermes Agent";

  return (
    <div className="space-y-4">
      {/* Harness selector */}
      <TabBar
        tabs={[
          { id: "openclaw" as Harness, label: "OpenClaw",     icon: <img src="/logos/openclaw.svg" alt="" className="w-3.5 h-3.5 object-contain" /> },
          { id: "hermes"   as Harness, label: "Hermes Agent", icon: <Feather className="w-3.5 h-3.5" /> },
        ]}
        active={harness}
        onChange={setHarness}
        size="sm"
      />

      <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-4">
        <TabBar
          tabs={[
            { id: "prompt" as HarnessMode, label: "Prompt" },
            { id: "cli"    as HarnessMode, label: "CLI" },
          ]}
          active={mode}
          onChange={setMode}
          size="sm"
        />

        {mode === "prompt" && (
          <>
            <p className="text-[12px] text-gray-400">Copy this installation prompt into {harnessName}:</p>
            <CodeSnippet code={prompt} />
          </>
        )}
        {mode === "cli" && (
          <>
            <p className="text-[12px] text-gray-400">Run in your terminal:</p>
            <CodeSnippet code={harness === "openclaw" ? openclawCli : hermesCli} />
          </>
        )}
      </div>
      <ApiKeyHint />
    </div>
  );
}

function SdkPanel() {
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

      <ApiKeyHint />
    </div>
  );
}

function PluginPanel() {
  const [client, setClient] = useState<PluginClient>("claude-code");

  const claudeCodePluginAdd = `/plugin marketplace add bennetglinder1/nous`;
  const claudeCodePluginInstall = `/plugin install nous@nous-plugins`;

  const codexMcp = `# ~/.codex/config.toml
[mcp_servers.nous]
command = "npx"
args = ["-y", "@opennous/mcp"]
env = { NOUS_API_KEY = "YOUR_API_KEY" }`;

  return (
    <div className="space-y-4">
      {/* Client selector */}
      <TabBar
        tabs={[
          { id: "claude-code" as PluginClient, label: "Claude Code", icon: <img src="/provider-logos/claude.svg" alt="" className="w-3.5 h-3.5 object-contain" /> },
          { id: "codex"       as PluginClient, label: "Codex",       icon: <img src="/provider-logos/openai.svg" alt="" className="w-3.5 h-3.5 object-contain" /> },
        ]}
        active={client}
        onChange={setClient}
        size="sm"
      />

      <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-gray-800">
            {client === "claude-code" ? "Install the Nous plugin for Claude Code" : "Connect Nous in Codex"}
          </h3>
          <a href="https://docs.opennous.cloud" target="_blank" rel="noopener noreferrer"
            className="text-[12px] text-gray-400 hover:text-gray-700 transition-colors">View docs ↗</a>
        </div>

        {client === "claude-code" && (
          <div className="space-y-3.5">
            <div>
              <p className="text-[12px] text-gray-500 mb-1.5">Step 1 — add the marketplace</p>
              <CodeSnippet code={claudeCodePluginAdd} />
            </div>
            <div>
              <p className="text-[12px] text-gray-500 mb-1.5">Step 2 — install the plugin</p>
              <CodeSnippet code={claudeCodePluginInstall} />
            </div>
          </div>
        )}

        {client === "codex" && (
          <>
            <p className="text-[12px] text-gray-400">
              Add to{" "}
              <code className="bg-gray-100 px-1 rounded text-[11px]">~/.codex/config.toml</code>
              , then restart Codex.
            </p>
            <CodeSnippet code={codexMcp} />
          </>
        )}
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function Install() {
  const [method, setMethod] = useState<InstallMethod>("plugin");

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="px-8 py-7">
        <PageHeader
          title="Install Nous"
          subtitle="Choose how you want to integrate the account record into your AI agents."
        />
        <div className="space-y-7">
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
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-gray-50 border border-gray-100">
                <m.icon className="h-4 w-4 text-gray-500" strokeWidth={1.75} />
              </div>
              <div>
                <p className={cn("text-[13px] font-semibold", method === m.id ? "text-gray-900" : "text-gray-700")}>{m.label}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{m.desc}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Panel */}
        {method === "openclaw" && <AgentHarnessPanel />}
        {method === "sdk"      && <SdkPanel />}
        {method === "plugin"   && <PluginPanel />}
        </div>
      </div>
    </div>
  );
}

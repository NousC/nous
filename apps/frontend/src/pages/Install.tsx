import { useState } from "react";
import { Link } from "react-router-dom";
import { Copy, CheckCircle2, Code2, Puzzle, Plug } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";

// ─── Types ───────────────────────────────────────────────────────────────────

type InstallMethod = "plugin" | "sdk" | "client";
type SdkLang = "python" | "nodejs" | "curl";
type PluginClient = "claude-code" | "codex";
type McpClient = "claude-desktop" | "cursor" | "generic";

// ─── Data ────────────────────────────────────────────────────────────────────

const INSTALL_METHODS: { id: InstallMethod; label: string; desc: string; icon: React.ElementType }[] = [
  { id: "plugin", label: "Plugin",            desc: "Claude Code & Codex",            icon: Puzzle },
  { id: "sdk",    label: "SDK Integration",   desc: "Drop into your own agent",       icon: Code2  },
  { id: "client", label: "Other MCP Clients", desc: "Claude Desktop, Cursor",         icon: Plug   },
];

// ── SDK steps (every snippet hits the real /v2/* surface) ───────────────────

const SDK_STEPS: Record<SdkLang, { label: string; desc: string; code: string }[]> = {
  python: [
    {
      label: "Install the SDK",
      desc: "PyPI package is opennous — the bare nous name is taken by an unrelated project.",
      code: "pip install opennous",
    },
    {
      label: "Initialize the client",
      desc: "API keys are workspace-scoped — no separate workspace ID needed. Create one at Settings → API Keys.",
      code: `from opennous import NousClient

client = NousClient(api_key="YOUR_API_KEY")`,
    },
    {
      label: "Get engineered context",
      desc: "Call BEFORE drafting or deciding — runs the retrieve → rank → connect → compress → tag → budget pipeline for one entity + intent.",
      code: `ctx = client.get_context(
    "sarah@acme.com",
    intent="follow_up",   # or: account_review, qualification, renewal, recover, expand
)
print(ctx["summary"])
# → "Sarah is evaluating for Q3; primary concern is Salesforce migration."`,
    },
    {
      label: "Get the full Account Record",
      desc: "Identity-resolved entity + every claim with its epistemics (source, freshness, confidence) + observation timeline. Focus accepts UUID, email, domain, LinkedIn URL, or name.",
      code: `account = client.get_account("acme.com")
print(account["entity"]["name"])
for claim in account["claims"]:
    print(f'{claim["property"]} = {claim["value"]}  '
          f'[{claim["freshness"]} · conf {claim["confidence"]:.2f}]')`,
    },
    {
      label: "Record what happened",
      desc: "Agents never overwrite — they observe. Nous derives the new claims automatically and tells you which were recomputed.",
      code: `result = client.record(
    "sarah@acme.com",
    observations=[
        {"kind": "event", "property": "interaction.email_sent",
         "value": {"description": "Sent the Q3 pricing draft."}},
        {"kind": "state", "property": "intent",
         "value": "evaluating", "source": "agent"},
    ],
)
print(result["claims_recomputed"])  # → ['intent']`,
    },
    {
      label: "Query across many entities",
      desc: "Retrieve + compact a corpus of observations. The substrate retrieves; your agent finds the pattern.",
      code: `result = client.query(
    scope={"kind": "event", "property": "interaction.email_replied",
           "since_days": 30, "limit": 200},
    question="Which segments replied positively this month?",
)
for item in result["items"]:
    print(item["entity_name"], "—", item["summary"])`,
    },
    {
      label: "What needs attention",
      desc: "Workspace-wide: accounts gone quiet, key facts decayed. Each item comes with a suggested action.",
      code: `for item in client.attention(limit=10)["items"]:
    print(item["headline"], "→", item["suggested_action"])`,
    },
    {
      label: "Verify before acting",
      desc: "Re-derives a claim from current observations and reports the before/after — the calibration check. Use before any high-stakes action.",
      code: `v = client.verify("sarah@acme.com", "title")
print(v["before"]["value"], "→", v["after"]["value"], v["note"])`,
    },
    {
      label: "Dedup a cold-outbound list",
      desc: "Cross-list pre-flight. Paste in LinkedIn URLs (free in Apollo preview) or emails — get back net_new / engaged / recent / bounced / unsubscribed / suppressed. Buy only the safe rows.",
      code: `out = client.classify(linkedin_urls=[
    "https://www.linkedin.com/in/sarah-chen-vp",
    "https://www.linkedin.com/in/jamie-doe",
])
print(out["summary"])  # → {'net_new': 1, 'engaged': 1, ...}`,
    },
  ],
  nodejs: [
    {
      label: "Install the SDK",
      desc: "Official TypeScript SDK — works in Node, Bun, Deno, and the browser.",
      code: "npm install @opennous/sdk",
    },
    {
      label: "Initialize the client",
      desc: "API keys are workspace-scoped — no separate workspace ID needed. Create one at Settings → API Keys.",
      code: `import { Nous } from '@opennous/sdk';

const nous = new Nous({ apiKey: process.env.NOUS_API_KEY! });`,
    },
    {
      label: "Get engineered context",
      desc: "Call BEFORE drafting or deciding — runs the retrieve → rank → connect → compress → tag → budget pipeline for one entity + intent.",
      code: `const ctx = await nous.getContext('sarah@acme.com', { intent: 'follow_up' });
console.log(ctx.summary);
// → "Sarah is evaluating for Q3; primary concern is Salesforce migration."`,
    },
    {
      label: "Get the full Account Record",
      desc: "Identity-resolved entity + every claim with its epistemics + observation timeline. Focus accepts UUID, email, domain, LinkedIn URL, or name.",
      code: `const account = await nous.getAccount('acme.com');
console.log(account.entity.name);
for (const claim of account.claims) {
  console.log(\`\${claim.property} = \${claim.value} [\${claim.freshness} · \${claim.confidence}]\`);
}`,
    },
    {
      label: "Record what happened",
      desc: "Agents never overwrite — they observe. Nous derives the new claims automatically.",
      code: `const result = await nous.record('sarah@acme.com', [
  { kind: 'event', property: 'interaction.email_sent',
    value: { description: 'Sent the Q3 pricing draft.' } },
  { kind: 'state', property: 'intent', value: 'evaluating' },
]);
console.log(result.claims_recomputed); // → ['intent']`,
    },
    {
      label: "Query across many entities",
      desc: "Retrieve + compact a corpus of observations. The substrate retrieves; your agent finds the pattern.",
      code: `const { items } = await nous.query(
  { kind: 'event', property: 'interaction.email_replied', since_days: 30, limit: 200 },
  { question: 'Which segments replied positively this month?' },
);
items.forEach(i => console.log(i.entity_name, '—', i.summary));`,
    },
    {
      label: "What needs attention",
      desc: "Workspace-wide: accounts gone quiet, key facts decayed. Each item comes with a suggested action.",
      code: `const { items } = await nous.attention({ limit: 10 });
items.forEach(i => console.log(i.headline, '→', i.suggested_action));`,
    },
    {
      label: "Verify before acting",
      desc: "Re-derives a claim from current observations and reports before/after — the calibration check.",
      code: `const v = await nous.verify('sarah@acme.com', 'title');
console.log(v.before.value, '→', v.after.value, v.note);`,
    },
    {
      label: "Dedup a cold-outbound list",
      desc: "Cross-list pre-flight. LinkedIn URLs are free in Apollo's preview — classify them against your workspace before paying for the email reveal.",
      code: `const out = await nous.classify({
  linkedin_urls: [
    'https://www.linkedin.com/in/sarah-chen-vp',
    'https://www.linkedin.com/in/jamie-doe',
  ],
});
console.log(out.summary); // → { net_new: 1, engaged: 1, ... }`,
    },
  ],
  curl: [
    {
      label: "Get engineered context",
      desc: "POST /v2/context — the pipeline that returns one budgeted block of context for an entity + intent.",
      code: `curl -X POST https://api.opennous.cloud/v2/context \\
  -H 'Authorization: Bearer YOUR_API_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "focus": "sarah@acme.com",
    "intent": "follow_up"
  }'`,
    },
    {
      label: "Get the full Account Record",
      desc: "GET /v2/accounts/:id — entity + claims-with-epistemics + observation timeline. :id is URL-encoded; accepts UUID, email, domain, LinkedIn URL, or name.",
      code: `curl https://api.opennous.cloud/v2/accounts/sarah%40acme.com \\
  -H 'Authorization: Bearer YOUR_API_KEY'`,
    },
    {
      label: "Record what happened",
      desc: "POST /v2/observations — append events/state. The substrate derives the new claims and tells you which were recomputed.",
      code: `curl -X POST https://api.opennous.cloud/v2/observations \\
  -H 'Authorization: Bearer YOUR_API_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "focus": "sarah@acme.com",
    "observations": [
      { "kind": "event", "property": "interaction.email_sent",
        "value": { "description": "Sent the Q3 pricing draft." } }
    ]
  }'`,
    },
    {
      label: "Query a corpus",
      desc: "POST /v2/query — retrieve + compact observations across many entities. The agent does the pattern-finding.",
      code: `curl -X POST https://api.opennous.cloud/v2/query \\
  -H 'Authorization: Bearer YOUR_API_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "scope": { "kind": "event", "property": "interaction.email_replied",
               "since_days": 30, "limit": 200 },
    "question": "Which segments replied positively this month?"
  }'`,
    },
    {
      label: "What needs attention",
      desc: "GET /v2/attention — workspace-wide ranked decisions (accounts gone quiet, facts decayed) with a suggested action on each.",
      code: `curl 'https://api.opennous.cloud/v2/attention?limit=10' \\
  -H 'Authorization: Bearer YOUR_API_KEY'`,
    },
    {
      label: "Verify a claim",
      desc: "POST /v2/verify — re-derive a single claim from current observations and return before/after. The calibration check.",
      code: `curl -X POST https://api.opennous.cloud/v2/verify \\
  -H 'Authorization: Bearer YOUR_API_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '{ "focus": "sarah@acme.com", "property": "title" }'`,
    },
    {
      label: "Dedup a cold-outbound list",
      desc: "POST /v2/dedup — classify up to 50k identifiers per call. Status semantics: net_new safe to send, engaged active conversation, recent contacted in last 30d, bounced/unsubscribed/suppressed skip.",
      code: `curl -X POST https://api.opennous.cloud/v2/dedup \\
  -H 'Authorization: Bearer YOUR_API_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "linkedin_urls": [
      "https://www.linkedin.com/in/sarah-chen-vp",
      "https://www.linkedin.com/in/jamie-doe"
    ]
  }'`,
    },
  ],
};

// ─── Shared bits ────────────────────────────────────────────────────────────

function CodeSnippet({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <div className="relative group rounded-lg bg-muted/50 border border-border/60 overflow-hidden">
      <pre className="text-[12px] text-foreground/80 px-4 py-3 overflow-x-auto font-mono whitespace-pre leading-relaxed">{code}</pre>
      <button onClick={copy}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded bg-background border border-border hover:bg-accent">
        {copied
          ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          : <Copy className="h-3.5 w-3.5 text-muted-foreground/70" />}
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
    <div className="inline-flex rounded-lg border border-border/60 bg-muted/50 p-0.5 gap-0.5">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "flex items-center gap-1.5 rounded-md font-semibold transition-all",
            size === "sm" ? "px-3 py-1 text-[11px]" : "px-4 py-1.5 text-[12px]",
            active === t.id
              ? "bg-background text-foreground shadow-sm border border-border/60"
              : "text-muted-foreground/70 hover:text-foreground/80"
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
    <p className="text-[12px] text-muted-foreground/70">
      Need an API key?{" "}
      <Link to="/settings" className="text-foreground/80 underline underline-offset-2 hover:text-foreground">
        Create one here →
      </Link>
    </p>
  );
}

// ─── Panels ─────────────────────────────────────────────────────────────────

function PluginPanel() {
  const [client, setClient] = useState<PluginClient>("claude-code");

  const claudeCodeMarketplace = `/plugin marketplace add bennetglinder1/nous`;
  const claudeCodeInstall     = `/plugin install nous@nous-plugins`;

  const codexMcp = `# ~/.codex/config.toml
[mcp_servers.nous]
command = "npx"
args = ["-y", "@opennous/mcp"]
env = { NOUS_API_KEY = "YOUR_API_KEY" }`;

  return (
    <div className="space-y-4">
      <TabBar
        tabs={[
          { id: "claude-code" as PluginClient, label: "Claude Code", icon: <img src="/provider-logos/claude.svg" alt="" className="w-3.5 h-3.5 object-contain" /> },
          { id: "codex"       as PluginClient, label: "Codex",       icon: <img src="/provider-logos/openai.svg" alt="" className="w-3.5 h-3.5 object-contain dark:invert" /> },
        ]}
        active={client}
        onChange={setClient}
        size="sm"
      />

      <div className="rounded-xl border border-border/60 bg-background p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-foreground">
            {client === "claude-code" ? "Install the Nous plugin for Claude Code" : "Connect Nous in Codex"}
          </h3>
          <a href="https://github.com/bennetglinder1/nous" target="_blank" rel="noopener noreferrer"
            className="text-[12px] text-muted-foreground/70 hover:text-foreground/80 transition-colors">View source ↗</a>
        </div>

        {client === "claude-code" && (
          <div className="space-y-3.5">
            <div>
              <p className="text-[12px] text-muted-foreground mb-1.5">Step 1 — add the marketplace</p>
              <CodeSnippet code={claudeCodeMarketplace} />
            </div>
            <div>
              <p className="text-[12px] text-muted-foreground mb-1.5">Step 2 — install the plugin</p>
              <CodeSnippet code={claudeCodeInstall} />
            </div>
            <p className="text-[12px] text-muted-foreground/70 leading-relaxed pt-1">
              Claude Code prompts for your Nous API key during install and stores it in your OS keychain — never in plaintext. Restart Claude Code once and the six Nous tools (<code className="bg-muted px-1 rounded text-[11px]">get_context</code>, <code className="bg-muted px-1 rounded text-[11px]">get_account</code>, <code className="bg-muted px-1 rounded text-[11px]">record</code>, <code className="bg-muted px-1 rounded text-[11px]">query</code>, <code className="bg-muted px-1 rounded text-[11px]">attention</code>, <code className="bg-muted px-1 rounded text-[11px]">verify</code>) are available in every session.
            </p>
          </div>
        )}

        {client === "codex" && (
          <>
            <p className="text-[12px] text-muted-foreground/70">
              Add to{" "}
              <code className="bg-muted px-1 rounded text-[11px]">~/.codex/config.toml</code>
              , then restart Codex.
            </p>
            <CodeSnippet code={codexMcp} />
            <p className="text-[12px] text-muted-foreground/70 leading-relaxed pt-1">
              The server downloads on first run via <code className="bg-muted px-1 rounded text-[11px]">npx</code> (no global install). Six Nous tools become callable in every Codex session.
            </p>
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
        <h3 className="text-[14px] font-semibold text-foreground">Set up SDK Integration</h3>
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
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-[11px] font-bold shrink-0">
                {i + 1}
              </span>
              {i < steps.length - 1 && <div className="w-px flex-1 bg-border/60 mt-2" />}
            </div>
            <div className="flex-1 pb-4 space-y-2.5">
              <div>
                <p className="text-[13px] font-semibold text-foreground">{step.label}</p>
                <p className="text-[12px] text-muted-foreground/70 mt-0.5">{step.desc}</p>
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

function McpClientPanel() {
  const [client, setClient] = useState<McpClient>("claude-desktop");

  // Every MCP-speaking client takes the same npx command — only the config path
  // and JSON wrapper change. We don't invent harnesses; we show the real ones.

  const claudeDesktop = `// ~/Library/Application Support/Claude/claude_desktop_config.json   (macOS)
// %APPDATA%\\Claude\\claude_desktop_config.json                       (Windows)
{
  "mcpServers": {
    "nous": {
      "command": "npx",
      "args": ["-y", "@opennous/mcp"],
      "env": { "NOUS_API_KEY": "YOUR_API_KEY" }
    }
  }
}`;

  const cursor = `// ~/.cursor/mcp.json   (or .cursor/mcp.json in a project for project-scoped)
{
  "mcpServers": {
    "nous": {
      "command": "npx",
      "args": ["-y", "@opennous/mcp"],
      "env": { "NOUS_API_KEY": "YOUR_API_KEY" }
    }
  }
}`;

  const generic = `# Any MCP-compatible client. The server is published on npm — no clone needed.
NOUS_API_KEY=YOUR_API_KEY npx -y @opennous/mcp

# Or pin a version:
NOUS_API_KEY=YOUR_API_KEY npx -y @opennous/mcp@0.8.9`;

  const META: Record<McpClient, { label: string; icon: React.ReactNode; copy: string; code: string }> = {
    "claude-desktop": {
      label: "Claude Desktop",
      icon: <img src="/provider-logos/claude.svg" alt="" className="w-3.5 h-3.5 object-contain" />,
      copy: "Add to your Claude Desktop config (path differs by OS), then restart Claude Desktop.",
      code: claudeDesktop,
    },
    "cursor": {
      label: "Cursor",
      icon: <img src="/provider-logos/cursor.svg" alt="" className="w-3.5 h-3.5 object-contain dark:invert" />,
      copy: "Add to Cursor's MCP config and reload — Cursor picks it up automatically.",
      code: cursor,
    },
    "generic": {
      label: "Any MCP client",
      icon: <Plug className="w-3.5 h-3.5" />,
      copy: "The MCP server is just a stdio process — point any compliant client at it.",
      code: generic,
    },
  };
  const active = META[client];

  return (
    <div className="space-y-4">
      <TabBar
        tabs={(Object.keys(META) as McpClient[]).map(id => ({ id, label: META[id].label, icon: META[id].icon }))}
        active={client}
        onChange={setClient}
        size="sm"
      />

      <div className="rounded-xl border border-border/60 bg-background p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-foreground">Connect Nous in {active.label}</h3>
          <a href="https://www.npmjs.com/package/@opennous/mcp" target="_blank" rel="noopener noreferrer"
            className="text-[12px] text-muted-foreground/70 hover:text-foreground/80 transition-colors">@opennous/mcp on npm ↗</a>
        </div>
        <p className="text-[12px] text-muted-foreground/70">{active.copy}</p>
        <CodeSnippet code={active.code} />
        <p className="text-[12px] text-muted-foreground/70 leading-relaxed pt-1">
          The server downloads on first run via <code className="bg-muted px-1 rounded text-[11px]">npx</code> (no global install). Six Nous tools — <code className="bg-muted px-1 rounded text-[11px]">get_context</code>, <code className="bg-muted px-1 rounded text-[11px]">get_account</code>, <code className="bg-muted px-1 rounded text-[11px]">record</code>, <code className="bg-muted px-1 rounded text-[11px]">query</code>, <code className="bg-muted px-1 rounded text-[11px]">attention</code>, <code className="bg-muted px-1 rounded text-[11px]">verify</code> — become callable in every session.
        </p>
      </div>
      <ApiKeyHint />
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Install() {
  const [method, setMethod] = useState<InstallMethod>("plugin");

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-8 py-7">
        <PageHeader
          title="Install Nous"
          subtitle="Three ways to give your agents the Account Record. All three sit on the same v2 Context API."
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
                    ? "border-foreground bg-background shadow-sm"
                    : "border-border/60 bg-background hover:border-border"
                )}
              >
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-muted/50 border border-border/60">
                  <m.icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
                </div>
                <div>
                  <p className={cn("text-[13px] font-semibold", method === m.id ? "text-foreground" : "text-foreground/80")}>{m.label}</p>
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">{m.desc}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Panel */}
          {method === "plugin" && <PluginPanel />}
          {method === "sdk"    && <SdkPanel />}
          {method === "client" && <McpClientPanel />}
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Copy, CheckCircle2, Plug, ArrowUpRight, Terminal, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { useAuth } from "@/contexts/AuthContext";

const SELF_HOST_API_URL = import.meta.env.VITE_API_URL ?? "";

// ── Brand logos used in the client rail. PNGs render crisp at small sizes;
// the mascot uses image-rendering: pixelated to keep its 8-bit edges sharp.
const LOGO_NOUS_MASCOT = "/provider-logos/nous-mascot.png"; // Claude Code → Nous pixel mascot
const LOGO_CODEX_CLOUD = "/provider-logos/codex.png";       // Codex — purple cloud-terminal
const LOGO_CLAUDE      = "/provider-logos/claude.svg";      // Claude Desktop
const LOGO_CURSOR      = "/provider-logos/cursor.png";      // Cursor
const LOGO_N8N         = "/provider-logos/n8n.svg";         // n8n

// The canonical org-preferences prompt also lives in the repo so the "view
// source" link below resolves to a real file. Keep the two in sync.
const ORG_PREFS_SOURCE =
  "https://github.com/NousC/nous/blob/main/docs/claude-org-preferences.md";

// ─── Types ───────────────────────────────────────────────────────────────────

type Client = "claude" | "codex" | "cursor" | "n8n" | "generic";
type ClaudeMethod = "plugin" | "cli" | "desktop";
type PrefLength = "short" | "long";

// Org preferences and the routing test are a claude.ai feature, so Steps 2 and 3
// only apply when the selected tool is Claude.
const CLAUDE_CLIENTS: Client[] = ["claude"];

// ─── Shared bits ──────────────────────────────────────────────────────────────

// Self-host: inject NOUS_API_URL into any MCP config so it's copy-paste ready
// (the MCP defaults to the hosted api.opennous.cloud otherwise). Only touches
// blocks that contain NOUS_API_KEY; handles JSON, TOML, and the CLI form.
function injectSelfHostUrl(code: string): string {
  const url = SELF_HOST_API_URL;
  if (!url || !code.includes("NOUS_API_KEY") || code.includes("NOUS_API_URL")) return code;
  if (code.includes('"NOUS_API_KEY"'))   // JSON
    return code.replace(/"NOUS_API_KEY": "YOUR_API_KEY"/g, `"NOUS_API_KEY": "YOUR_API_KEY", "NOUS_API_URL": "${url}"`);
  if (code.includes('NOUS_API_KEY = '))  // TOML
    return code.replace(/NOUS_API_KEY = "YOUR_API_KEY"/g, `NOUS_API_KEY = "YOUR_API_KEY", NOUS_API_URL = "${url}"`);
  if (code.includes('-e NOUS_API_KEY=')) // CLI
    return code.replace('-- npx', `-e NOUS_API_URL=${url} -- npx`);
  return code;
}

function CodeSnippet({ code, caption }: { code: string; caption?: string }) {
  const [copied, setCopied] = useState(false);
  const { userData } = useAuth();
  const selfHosted = (userData as { self_hosted?: boolean })?.self_hosted === true;
  const display = selfHosted ? injectSelfHostUrl(code) : code;
  const copy = () => { navigator.clipboard.writeText(display); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <div className="relative group rounded-lg bg-background border border-border/60 overflow-hidden">
      {caption && (
        <div className="px-4 pt-2.5 pb-2 text-[11px] font-medium text-muted-foreground/70 border-b border-border/40 pr-10">
          {caption}
        </div>
      )}
      <pre className="text-[12px] text-foreground/80 px-4 py-3 overflow-x-auto font-mono whitespace-pre leading-relaxed">{display}</pre>
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
    <div className="inline-flex flex-wrap rounded-lg border border-border/60 bg-muted/50 p-0.5 gap-0.5">
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

// A numbered step in the install spine. The content sits in its own muted
// sub-panel, so each step reads as a distinct block lifted off the white card.
function Step({ n, title, hint, children, action }: { n: number; title: string; hint?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline gap-3">
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-foreground text-background text-[12px] font-semibold flex items-center justify-center translate-y-[3px]">
          {n}
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-foreground leading-tight">{title}</h2>
          {hint && <p className="text-[12px] text-muted-foreground/70 mt-1 leading-relaxed">{hint}</p>}
        </div>
        {action && <div className="ml-auto self-start flex-shrink-0">{action}</div>}
      </div>
      <div className="rounded-xl border border-border/50 bg-muted/40 p-4 sm:p-5 space-y-4">{children}</div>
    </section>
  );
}

// A small muted footnote under a code box — one short clause, not a paragraph.
function FootNote({ children }: { children: React.ReactNode }) {
  return <p className="text-[11.5px] text-muted-foreground/60 leading-relaxed">{children}</p>;
}

function ApiKeyHint() {
  return (
    <p className="text-[12px] text-muted-foreground/70">
      Prefer to paste a key instead of /nous-login?{" "}
      <Link to="/settings" className="text-foreground/80 underline underline-offset-2 hover:text-foreground">
        Create one here →
      </Link>
    </p>
  );
}

// ─── Step 1 — per-client install ───────────────────────────────────────────────

const CLAUDE_CODE_MARKETPLACE = `/plugin marketplace add NousC/nous`;
const CLAUDE_CODE_INSTALL = `/plugin install nous@nous-plugins`;
const CLAUDE_CODE_LOGIN = `/nous-login`;

// Raw CLI alternative to the plugin — adds the stdio server directly.
// Add -s user to make it available in every project.
// The key lives on its own `export` line so the only hand-edit is far from the
// fragile ` -- ` separator. Pasting a real key inline next to `--` was eating
// the space, which made `claude mcp add` swallow `-y` as its own flag.
const CLAUDE_CODE_CLI = `export NOUS_API_KEY=YOUR_API_KEY
claude mcp add nous -e NOUS_API_KEY=$NOUS_API_KEY -- npx -y @opennous/mcp`;

// Config-file clients paste a JSON `mcpServers` block. We offer two variants so
// nobody clobbers an existing config: the full file (first MCP) or just the
// "nous" entry to merge into servers they already have.
const MCP_JSON_FULL = `{
  "mcpServers": {
    "nous": {
      "command": "npx",
      "args": ["-y", "@opennous/mcp"],
      "env": { "NOUS_API_KEY": "YOUR_API_KEY" }
    }
  }
}`;

const MCP_JSON_ENTRY = `"nous": {
  "command": "npx",
  "args": ["-y", "@opennous/mcp"],
  "env": { "NOUS_API_KEY": "YOUR_API_KEY" }
}`;

// Codex uses TOML. A [mcp_servers.nous] table is additive, so the snippet is the
// same whether or not other servers exist — only the instruction differs.
const CODEX_TOML = `[mcp_servers.nous]
command = "npx"
args = ["-y", "@opennous/mcp"]
env = { NOUS_API_KEY = "YOUR_API_KEY" }`;

// Per-client copy: first-time (full file) vs add-to-existing (merge the entry).
type ConfigVariant = { caption: string; code: string };
const CONFIG_SETUP: Record<"codex" | "cursor" | "generic", { first: ConfigVariant; existing: ConfigVariant }> = {
  codex: {
    first:    { caption: "Add this to ~/.codex/config.toml, then restart Codex", code: CODEX_TOML },
    existing: { caption: "Add this table alongside your other [mcp_servers.*], then restart Codex", code: CODEX_TOML },
  },
  cursor: {
    first:    { caption: "Create ~/.cursor/mcp.json with this, then reload Cursor", code: MCP_JSON_FULL },
    existing: { caption: 'Add the "nous" entry to mcpServers in ~/.cursor/mcp.json, then reload', code: MCP_JSON_ENTRY },
  },
  generic: {
    first:    { caption: "Add this to your MCP client's config", code: MCP_JSON_FULL },
    existing: { caption: 'Add the "nous" entry to your existing mcpServers', code: MCP_JSON_ENTRY },
  },
};

// Claude Desktop (used inside the Claude MCP card's "desktop" method).
const CLAUDE_DESKTOP_SETUP: { first: ConfigVariant; existing: ConfigVariant } = {
  first:    { caption: "Add this to your Claude Desktop config file, then restart the app", code: MCP_JSON_FULL },
  existing: { caption: 'Add the "nous" entry to mcpServers in your Claude Desktop config, then restart', code: MCP_JSON_ENTRY },
};

// Hosted MCP endpoint — lets cloud clients (n8n cloud, etc.) connect over HTTPS.
const HOSTED_MCP_URL = "https://mcp.opennous.cloud/mcp";

// n8n is a UI form, not a config file, so its setup is shown as labelled fields.
// Self-hosted n8n launches the stdio server via the community node.
const N8N_STDIO_FIELDS: { label: string; value: string }[] = [
  { label: "Command", value: "npx" },
  { label: "Arguments", value: "-y @opennous/mcp" },
  { label: "Environment", value: "NOUS_API_KEY=YOUR_API_KEY" },
];

const CLIENTS: Record<Client, {
  label: string;
  tab: string;
  icon: React.ReactNode;
  heading: string;
  intro?: string;
  steps: { label?: string; code: string }[];
  note: React.ReactNode;
  source: { href: string; label: string };
}> = {
  // "claude" is rendered by a custom panel (ClaudeInstall) that covers all three
  // ways. The fields below only feed the tool tab; steps/note are unused.
  "claude": {
    label: "Claude MCP",
    tab: "Claude MCP",
    icon: <img src={LOGO_CLAUDE} alt="" className="w-3.5 h-3.5 object-contain" />,
    heading: "",
    steps: [],
    note: null,
    source: { href: "https://github.com/NousC/nous", label: "View source ↗" },
  },
  "codex": {
    label: "Codex",
    tab: "Codex",
    icon: <img src={LOGO_CODEX_CLOUD} alt="" className="w-3.5 h-3.5 object-contain" />,
    heading: "Connect Nous in Codex",
    steps: [],
    note: null,
    source: { href: "https://www.npmjs.com/package/@opennous/mcp", label: "@opennous/mcp on npm ↗" },
  },
  "cursor": {
    label: "Cursor",
    tab: "Cursor",
    icon: <img src={LOGO_CURSOR} alt="" className="w-3.5 h-3.5 object-contain rounded-[3px]" />,
    heading: "Connect Nous in Cursor",
    steps: [],
    note: null,
    source: { href: "https://www.npmjs.com/package/@opennous/mcp", label: "@opennous/mcp on npm ↗" },
  },
  "n8n": {
    label: "n8n",
    tab: "n8n",
    icon: <img src={LOGO_N8N} alt="" className="w-3.5 h-3.5 object-contain" />,
    heading: "Connect Nous in n8n",
    steps: [],
    note: null,
    source: { href: "https://www.npmjs.com/package/n8n-nodes-mcp", label: "n8n-nodes-mcp on npm ↗" },
  },
  "generic": {
    label: "Generic MCP",
    tab: "Generic MCP",
    icon: <Plug className="w-3.5 h-3.5" strokeWidth={1.75} />,
    heading: "Connect Nous in any MCP client",
    steps: [],
    note: null,
    source: { href: "https://www.npmjs.com/package/@opennous/mcp", label: "@opennous/mcp on npm ↗" },
  },
};

const CLIENT_ORDER: Client[] = ["claude", "codex", "cursor", "n8n", "generic"];

// Horizontal logo tabs — the tool decider sits across the top, left to right.
// Selecting one swaps the install shown below.
function ClientTabs({ active, onChange }: { active: Client; onChange: (c: Client) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CLIENT_ORDER.map(id => {
        const c = CLIENTS[id];
        const selected = id === active;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-semibold transition-all border",
              selected
                ? "bg-background border-border/60 shadow-sm text-foreground"
                : "bg-transparent border-transparent text-muted-foreground/70 hover:text-foreground/80 hover:bg-background/60"
            )}
          >
            <span className="w-5 h-5 flex items-center justify-center flex-shrink-0">{c.icon}</span>
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

// The simple clients (Codex, Cursor, n8n, Generic) — one heading, one config.
// Codex, Cursor, Generic — a config file with a first-time / add-to-existing toggle.
function GenericClientSetup({ client }: { client: "codex" | "cursor" | "generic" }) {
  const c = CLIENTS[client];
  const setup = CONFIG_SETUP[client];
  return <SetupConfig heading={c.heading} first={setup.first} existing={setup.existing} />;
}

// Claude merges Claude Code and Claude Desktop. Three ways to add Nous: the
// plugin (recommended), the CLI, or the Claude Desktop config.
const CLAUDE_METHODS: { id: ClaudeMethod; label: string; icon: React.ReactNode }[] = [
  { id: "plugin",  label: "Plugin",         icon: <img src={LOGO_NOUS_MASCOT} alt="" className="w-3.5 h-3.5 object-contain" style={{ imageRendering: "pixelated" }} /> },
  { id: "cli",     label: "CLI",            icon: <Terminal className="w-3.5 h-3.5" strokeWidth={1.75} /> },
  { id: "desktop", label: "Claude Desktop", icon: <img src={LOGO_CLAUDE} alt="" className="w-3.5 h-3.5 object-contain" /> },
];

function ClaudeInstall() {
  const [method, setMethod] = useState<ClaudeMethod>("plugin");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-semibold text-foreground">Add Nous to Claude in one of three ways</p>
        <a href="https://github.com/NousC/nous" target="_blank" rel="noopener noreferrer"
          className="text-[12px] text-muted-foreground/70 hover:text-foreground/80 transition-colors whitespace-nowrap">
          View source ↗
        </a>
      </div>

      <TabBar tabs={CLAUDE_METHODS} active={method} onChange={setMethod} size="sm" />

      {method === "plugin" && (
        <div className="space-y-3">
          <CodeSnippet caption="1. In Claude Code, add the Nous plugin marketplace" code={CLAUDE_CODE_MARKETPLACE} />
          <CodeSnippet caption="2. Install the Nous plugin" code={CLAUDE_CODE_INSTALL} />
          <CodeSnippet caption="3. Sign in with your browser — no key to paste" code={CLAUDE_CODE_LOGIN} />
          <FootNote>/nous-login opens your browser, you approve, and your key is saved automatically. Nothing else to configure.</FootNote>
        </div>
      )}

      {method === "cli" && (
        <div className="space-y-3">
          <CodeSnippet caption="Replace YOUR_API_KEY on the first line, then run both lines in your terminal" code={CLAUDE_CODE_CLI} />
          <FootNote>Add <code className="bg-muted px-1 rounded text-[11px]">-s user</code> to install it for every project. Restart Claude Code.</FootNote>
        </div>
      )}

      {method === "desktop" && (
        <SetupConfig first={CLAUDE_DESKTOP_SETUP.first} existing={CLAUDE_DESKTOP_SETUP.existing} showApiKey={false} />
      )}

      <ApiKeyHint />
    </div>
  );
}

// Config-file install with a first-time / add-to-existing toggle (top right), so
// pasting never clobbers an existing config. Reused by the config-file clients
// and the Claude Desktop method.
type SetupMode = "first" | "existing";

function SetupConfig({ heading, first, existing, showApiKey = true }: {
  heading?: string;
  first: ConfigVariant;
  existing: ConfigVariant;
  showApiKey?: boolean;
}) {
  const [mode, setMode] = useState<SetupMode>("first");
  const active = mode === "first" ? first : existing;
  const toggle = (
    <TabBar
      tabs={[
        { id: "first" as SetupMode, label: "First MCP" },
        { id: "existing" as SetupMode, label: "Add to existing" },
      ]}
      active={mode}
      onChange={setMode}
      size="sm"
    />
  );
  return (
    <div className="space-y-4">
      {heading
        ? <div className="flex items-center justify-between gap-3"><h3 className="text-[13px] font-semibold text-foreground">{heading}</h3>{toggle}</div>
        : <div className="flex justify-end">{toggle}</div>}
      <CodeSnippet caption={active.caption} code={active.code} />
      {showApiKey && <ApiKeyHint />}
    </div>
  );
}

// A single labelled credential field with a copyable value — for UI-form clients
// like n8n where you fill in fields rather than paste a config file.
function FieldRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <div className="flex items-center gap-3 group">
      <span className="w-28 flex-shrink-0 text-[12px] font-medium text-muted-foreground">{label}</span>
      <div className="relative flex-1 min-w-0 rounded-md bg-background border border-border/60 px-3 py-1.5">
        <code className="text-[12px] text-foreground/80 font-mono break-all">{value}</code>
        <button onClick={copy}
          className="absolute top-1/2 -translate-y-1/2 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded bg-background border border-border hover:bg-accent">
          {copied
            ? <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            : <Copy className="h-3 w-3 text-muted-foreground/70" />}
        </button>
      </div>
    </div>
  );
}

type N8nMode = "http" | "stdio";

function N8nInstall() {
  const [mode, setMode] = useState<N8nMode>("http");
  const { userData } = useAuth();
  const selfHosted = (userData as { self_hosted?: boolean })?.self_hosted === true;
  // Self-host has its own HTTP MCP endpoint (mcp.<domain>/mcp) and needs
  // NOUS_API_URL in the stdio env.
  const mcpUrl = selfHosted && SELF_HOST_API_URL
    ? SELF_HOST_API_URL.replace("://api.", "://mcp.") + "/mcp"
    : HOSTED_MCP_URL;
  const stdioFields = selfHosted && SELF_HOST_API_URL
    ? N8N_STDIO_FIELDS.map(f => f.label === "Environment"
        ? { ...f, value: `NOUS_API_KEY=YOUR_API_KEY,NOUS_API_URL=${SELF_HOST_API_URL}` }
        : f)
    : N8N_STDIO_FIELDS;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-foreground">Connect Nous in n8n</h3>
        <TabBar
          tabs={[
            { id: "http" as N8nMode, label: "HTTP" },
            { id: "stdio" as N8nMode, label: "Community node" },
          ]}
          active={mode}
          onChange={setMode}
          size="sm"
        />
      </div>

      {mode === "http" && (
        <div className="space-y-3">
          <p className="text-[12px] text-muted-foreground">Cloud or self-hosted, any n8n with the native <span className="text-foreground/80 font-medium">MCP Client Tool</span> node (n8n 1.88+). No community node, no local process.</p>
          <div className="rounded-lg bg-background border border-border/60 p-4 space-y-3">
            <p className="text-[12px] text-muted-foreground">Set <span className="text-foreground/80 font-medium">Server Transport</span> to <code className="bg-muted px-1 rounded text-[11px]">HTTP Streamable</code></p>
            <FieldRow label="Endpoint URL" value={mcpUrl} />
            <p className="text-[12px] text-muted-foreground">Set <span className="text-foreground/80 font-medium">Authentication</span> to <code className="bg-muted px-1 rounded text-[11px]">Bearer Auth</code> and paste your Nous API key as the token.</p>
          </div>
          <ApiKeyHint />
        </div>
      )}

      {mode === "stdio" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] text-muted-foreground">Self-hosted n8n only. Launches the stdio server locally, for older n8n without the native node.</p>
            <a href="https://www.npmjs.com/package/n8n-nodes-mcp" target="_blank" rel="noopener noreferrer"
              className="text-[12px] text-muted-foreground/70 hover:text-foreground/80 transition-colors whitespace-nowrap">
              n8n-nodes-mcp on npm ↗
            </a>
          </div>
          <div>
            <p className="text-[12px] text-muted-foreground mb-1.5">1. Install the <code className="bg-muted px-1 rounded text-[11px]">n8n-nodes-mcp</code> community node</p>
            <p className="text-[12px] text-muted-foreground">2. Create an <span className="text-foreground/80 font-medium">MCP Client (STDIO)</span> credential with these fields</p>
          </div>
          <div className="rounded-lg bg-background border border-border/60 p-4 space-y-2.5">
            {stdioFields.map(f => <FieldRow key={f.label} label={f.label} value={f.value} />)}
          </div>
          <FootNote>3. Add the <span className="text-foreground/80 font-medium">MCP Client</span> node to any workflow and select the credential.</FootNote>
          <ApiKeyHint />
        </div>
      )}
    </div>
  );
}

function ClientPanel({ client, onChange }: { client: Client; onChange: (c: Client) => void }) {
  return (
    <div className="space-y-4">
      <ClientTabs active={client} onChange={onChange} />

      <div className="border-t border-border/50 pt-4">
        {client === "claude" ? <ClaudeInstall />
          : client === "n8n" ? <N8nInstall />
          : <GenericClientSetup client={client} />}
      </div>
    </div>
  );
}

// ─── Step 2 — org preferences (the routing layer) ──────────────────────────────

const PREF_SHORT = `# Nous is this workspace's GTM account record

Nous holds the identity-resolved account record for every person and company we
sell to. Known facts with their confidence and freshness, the full interaction
timeline, a 0-100 ICP fit score on every account, plus our own ICP, positioning,
and pricing. Agents read engineered context from Nous rather than raw CRM rows.

## Ground GTM work in Nous

Before any go-to-market task (drafting outreach, prepping a call or meeting,
reviewing an account, qualifying a prospect) call get_context with the person's
email and the matching intent (draft_email, follow_up, meeting_prep, call_prep,
account_review). Use what it returns. Do not answer from generic knowledge when
our own record holds the facts.

## Default to Nous, even unprompted

For any GTM question about a person, company, deal, or our own business, reach for
Nous first even when the user never says "Nous".
- Who is this, every known fact, full history  → get_account
- Context for a specific task                   → get_context
- Something happened or you learned a fact      → record
- Activity or a list across many accounts       → query
- What needs attention, what has gone quiet     → attention
- A fact looks stale before you act on it       → verify
- Our ICP, market, pricing, positioning         → get_gtm_profile
- Our own GTM shifted (repriced, motion, a note) → update_gtm_profile
- A brief / note / transcript to keep on a contact → save_note
- Find content in past meetings or notes         → search_notes

Read get_gtm_profile at the start of GTM work, and write back what changed at the
end — that is what keeps our context from going stale. When you learn something
durable about OUR OWN go-to-market, call update_gtm_profile with the section and
its current state: ICP, Market, Product, Pricing, Competitors, Positioning, GTM
Motion (how we sell), or Notes (anything else worth keeping). It evolves the
section and keeps the old version as history; use Notes for running observations.
After every interaction you help with, call record so the account record stays
current.`;

const PREF_LONG = `# Nous is this workspace's GTM context engine

Nous resolves every person and company we sell to into one account record. It holds
the known facts with their confidence and freshness, the full interaction timeline
across our tools, a 0-100 ICP fit score on every account, and our own ICP, positioning,
pricing, and competitors. When raw
CRM and call-intelligence tools (HubSpot, Salesforce, Gong, Granola, Apollo,
Smartlead) are also connected, Nous is the synthesis layer that sits on top of them.
Those tools hold rows. Nous holds the engineered, identity-resolved record agents
should act on.

## Ground every GTM answer in Nous

Before answering any go-to-market question (outreach, objections, competitors,
personas, value props, pricing narrative, account status, next steps) pull the
relevant context from Nous first with get_context or get_gtm_profile. Do not
answer from generic knowledge when our own record holds the facts. Name the account
or fact you used.

## Default to Nous, even unprompted

For any GTM task about a person, company, deal, buyer, or our own business, reach for
Nous first even when the user never says "Nous".
- Context for a specific task → get_context (pass the email and the intent:
  draft_email, follow_up, meeting_prep, call_prep, account_review)
- Who is this, every known fact, full history → get_account
- Something happened or you learned a fact → record (you observe, Nous derives the
  updated record, you never overwrite)
- Activity, patterns, or a list across many accounts → query
- What needs attention right now, accounts gone quiet → attention
- A fact looks stale before you act on it → verify
- Our ICP, target market, pricing, positioning, competitors → get_gtm_profile
- A durable change to our OWN GTM (repriced, moved upmarket, sharper positioning, a
  new segment we win, a shift in how we sell, a note worth keeping) → update_gtm_profile
- A meeting brief, prep doc, transcript, or note to keep on a contact → save_note
- Pull content from a contact's past meetings or notes → search_notes

## Prefer Nous over raw records

When HubSpot, Salesforce, Gong, or Granola could answer the same question, prefer
Nous. Reach for a raw tool only to pull a record Nous has not yet observed, then call
record so the account record absorbs what you found.

## Keep the record current

After every interaction you help with (an email sent, a call held, a reply received,
a fact learned) call record so the next agent starts from the truth. State changes
use kind:'state'. Interactions use kind:'event'.

Read get_gtm_profile at the start of GTM work and write back what changed at the
end — that is what keeps the context current instead of static. When our OWN
go-to-market durably changes, call update_gtm_profile with the SECTION and its
current state: ICP, Market, Product, Pricing, Competitors, Positioning, GTM Motion
(how we sell — motion, RevOps, process), or Notes (anything else durable that does
not fit a section). The default 'replace' mode evolves the section and keeps the
prior version as history, so never silently contradict it; use 'append' to log a
Notes entry.`;

const PREF_META: Record<PrefLength, { tab: string; chars: string; blurb: string }> = {
  short: {
    tab: "Short",
    chars: "~2.5k chars",
    blurb: "Covers core routing and the most common Nous intents.",
  },
  long: {
    tab: "Long",
    chars: "~3.8k chars",
    blurb: "Use when raw CRM and call tools are also connected. Adds explicit demotion of those tools plus write discipline, with room to layer your own ICPs and playbooks on top.",
  },
};

function OrgPrefsPanel() {
  const [len, setLen] = useState<PrefLength>("short");
  const meta = PREF_META[len];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <TabBar
            tabs={(["short", "long"] as PrefLength[]).map(id => ({ id, label: PREF_META[id].tab }))}
            active={len}
            onChange={setLen}
            size="sm"
          />
          <span className="text-[11px] text-muted-foreground/60">{meta.chars}</span>
        </div>
        <a href={ORG_PREFS_SOURCE} target="_blank" rel="noopener noreferrer"
          className="text-[12px] text-muted-foreground/70 hover:text-foreground/80 transition-colors whitespace-nowrap">
          View source ↗
        </a>
      </div>

      <p className="text-[12px] text-muted-foreground/70 leading-relaxed">{meta.blurb}</p>

      <CodeSnippet code={len === "short" ? PREF_SHORT : PREF_LONG} />

      <p className="text-[12px] text-muted-foreground/70 leading-relaxed pt-1">
        Organization preferences are admin only (Teams and Enterprise) and can take up to an hour to propagate across Claude products. On Pro, paste the same text into <span className="text-foreground/80 font-medium">Settings → Personal preferences</span> instead.
      </p>
    </div>
  );
}

// ─── Step 3 — verify routing ────────────────────────────────────────────────────

const TEST_PROMPT = `What should I do next with jane@acme.com?`;

function VerifyPanel() {
  return (
    <div className="space-y-3.5">
      <p className="text-[12px] text-muted-foreground/70 leading-relaxed">
        Open a fresh conversation and ask this without typing the word "Nous".
      </p>
      <CodeSnippet code={TEST_PROMPT} />
      <p className="text-[12px] text-muted-foreground/70 leading-relaxed pt-1">
        Claude should call <code className="bg-muted px-1 rounded text-[11px]">get_context</code> on its own before answering. If it reaches for a raw CRM tool first, the preferences have not propagated yet, or the prompt in Step 2 needs to be pasted again.
      </p>
    </div>
  );
}

// ─── SDK footer — the build-on-Nous path for the rare developer who needs it,
// without diluting the install page's main message. ───────────────────────────
function SdkFooter() {
  return (
    <div className="pt-2 text-center">
      <p className="text-[12px] text-muted-foreground/70 inline-flex items-center gap-1.5">
        Building your own agent or product on Nous?
        <a
          href="https://docs.opennous.cloud/public-api/introduction"
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground/80 underline underline-offset-2 hover:text-foreground inline-flex items-center gap-0.5"
        >
          See the SDK docs
          <ArrowUpRight className="h-3 w-3" />
        </a>
      </p>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Install() {
  const [client, setClient] = useState<Client>("claude");
  const isClaudeClient = CLAUDE_CLIENTS.includes(client);
  const { userData, session, onboardingCompleted, refreshUserData } = useAuth();
  const selfHosted = (userData as { self_hosted?: boolean })?.self_hosted === true;

  // Onboarding moved to the agent, so the old wizard's final step no longer
  // runs. Landing here once fires the same first-run activation it did (welcome
  // email, free-plan backstop, dogfood signup). The endpoint is idempotent —
  // it only does work on the first completion — so this safely fires once.
  useEffect(() => {
    if (onboardingCompleted || !session?.access_token) return;
    fetch(`${SELF_HOST_API_URL}/api/onboarding/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: "{}",
    })
      .then(() => refreshUserData())
      .catch(() => {});
  }, [onboardingCompleted, session?.access_token, refreshUserData]);

  return (
    <div className="h-full overflow-y-auto bg-muted/30">
      {/* Centered column keeps the three-step flow readable instead of
          stretched edge-to-edge. */}
      <div className="px-6 py-7 max-w-3xl mx-auto">
        <PageHeader
          title="Install Nous"
          subtitle="Add Nous to your tool, then tell Claude to route GTM work through it by default. Every path rides the same v2 Context API and the same MCP server."
        />

        {/* The whole guided flow sits in one elevated white card, lifted off
            the muted page behind it. */}
        <div className="rounded-2xl border border-border/60 bg-background shadow-sm p-6 sm:p-8 space-y-9">
          <Step
            n={1}
            title="Add Nous to your tool"
            hint="Pick where your agent runs. Claude Code installs as a plugin; everywhere else takes the MCP server config."
            action={selfHosted ? (
              <div className="group relative">
                <Info className="h-4 w-4 text-amber-500 cursor-help" strokeWidth={2} />
                <div className="hidden group-hover:block absolute top-full right-0 mt-1.5 w-[260px] rounded-lg border border-amber-300/60 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 px-3 py-2.5 text-[12px] leading-relaxed text-amber-900 dark:text-amber-200 shadow-lg z-20">
                  This is a <span className="font-medium">self-hosted</span> instance — the install differs from the cloud. The configs below are pre-filled with your server's API URL (<code className="font-mono text-[11px]">NOUS_API_URL</code>); just add your API key.
                </div>
              </div>
            ) : undefined}
          >
            <ClientPanel client={client} onChange={setClient} />
          </Step>

          {/* Org preferences and the routing test are a claude.ai feature, so
              they only appear when a Claude client is selected. */}
          {isClaudeClient && (
            <>
              <Step
                n={2}
                title="Set Claude org preferences"
                hint={
                  <>
                    Tell Claude to route GTM questions through Nous by default, otherwise it can reach for raw CRM or call tools (HubSpot, Salesforce, Gong, Granola) first when someone forgets to say "Nous". Copy one version and paste it into <span className="text-foreground/80 font-medium">claude.ai → Settings → Organization preferences</span>. Optional but recommended.
                  </>
                }
              >
                <OrgPrefsPanel />
              </Step>

              <Step
                n={3}
                title="Check it is working"
                hint="Confirm Claude reaches for Nous on its own."
              >
                <VerifyPanel />
              </Step>
            </>
          )}
        </div>

        <SdkFooter />
      </div>
    </div>
  );
}

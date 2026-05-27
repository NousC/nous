import { useState } from "react";
import { Link } from "react-router-dom";
import { Copy, CheckCircle2, Plug, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";

// ── Brand logos used in the method-selector cards. PNGs render crisp at
// small sizes; the mascot uses image-rendering: pixelated to keep its 8-bit
// edges sharp.
const LOGO_NOUS_MASCOT  = "/provider-logos/nous-mascot.png";   // Claude Code → the Nous pixel mascot
const LOGO_CODEX_CLOUD  = "/provider-logos/codex.png";         // Codex + "Other MCP Clients" — purple cloud-terminal

// ─── Types ───────────────────────────────────────────────────────────────────

type InstallMethod = "plugin" | "client";
type PluginClient = "claude-code" | "codex";
type McpClient = "claude-desktop" | "cursor" | "generic";

// ─── Data ────────────────────────────────────────────────────────────────────

// `icon` is a ReactNode (not an ElementType) so each card can ship its own
// rendering — the Nous mascot needs image-rendering:pixelated, the cloud
// glyph doesn't. Both render at 18×18 inside the 36×36 tinted frame.
const INSTALL_METHODS: { id: InstallMethod; label: string; desc: string; icon: React.ReactNode }[] = [
  {
    id: "plugin",
    label: "Plugin",
    desc: "Claude Code & Codex",
    icon: (
      <img
        src={LOGO_NOUS_MASCOT}
        alt=""
        className="h-[18px] w-[18px] object-contain"
        style={{ imageRendering: "pixelated" }}
      />
    ),
  },
  {
    id: "client",
    label: "Other MCP Clients",
    desc: "Claude Desktop, Cursor, etc.",
    // Generic Lucide icon (matches the original feel) — the sub-tabs inside
    // this panel carry the real per-client logos.
    icon: <Plug className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />,
  },
];

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
          { id: "claude-code" as PluginClient, label: "Claude Code", icon: <img src={LOGO_NOUS_MASCOT} alt="" className="w-3.5 h-3.5 object-contain" style={{ imageRendering: "pixelated" }} /> },
          { id: "codex"       as PluginClient, label: "Codex",       icon: <img src={LOGO_CODEX_CLOUD} alt="" className="w-3.5 h-3.5 object-contain" /> },
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
              Claude Code prompts for your Nous API key during install and stores it in your OS keychain — never in plaintext. Restart Claude Code once and the seven Nous tools (<code className="bg-muted px-1 rounded text-[11px]">get_context</code>, <code className="bg-muted px-1 rounded text-[11px]">get_account</code>, <code className="bg-muted px-1 rounded text-[11px]">record</code>, <code className="bg-muted px-1 rounded text-[11px]">query</code>, <code className="bg-muted px-1 rounded text-[11px]">attention</code>, <code className="bg-muted px-1 rounded text-[11px]">verify</code>, <code className="bg-muted px-1 rounded text-[11px]">get_workspace_facts</code>) are available in every session.
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
              The server downloads on first run via <code className="bg-muted px-1 rounded text-[11px]">npx</code> (no global install). Seven Nous tools become callable in every Codex session.
            </p>
          </>
        )}
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
NOUS_API_KEY=YOUR_API_KEY npx -y @opennous/mcp@0.10.1`;

  const META: Record<McpClient, { label: string; icon: React.ReactNode; copy: string; code: string }> = {
    "claude-desktop": {
      label: "Claude Desktop",
      icon: <img src="/provider-logos/claude.svg" alt="" className="w-3.5 h-3.5 object-contain" />,
      copy: "Add to your Claude Desktop config (path differs by OS), then restart Claude Desktop.",
      code: claudeDesktop,
    },
    "cursor": {
      label: "Cursor",
      icon: <img src="/provider-logos/cursor.png" alt="" className="w-3.5 h-3.5 object-contain rounded-[3px]" />,
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
          The server downloads on first run via <code className="bg-muted px-1 rounded text-[11px]">npx</code> (no global install). Seven Nous tools — <code className="bg-muted px-1 rounded text-[11px]">get_context</code>, <code className="bg-muted px-1 rounded text-[11px]">get_account</code>, <code className="bg-muted px-1 rounded text-[11px]">record</code>, <code className="bg-muted px-1 rounded text-[11px]">query</code>, <code className="bg-muted px-1 rounded text-[11px]">attention</code>, <code className="bg-muted px-1 rounded text-[11px]">verify</code>, <code className="bg-muted px-1 rounded text-[11px]">get_workspace_facts</code> — become callable in every session.
        </p>
      </div>
      <ApiKeyHint />
    </div>
  );
}

// ─── SDK footer — surfaces the build-on-Nous path for the rare developer
// who actually needs it, without diluting the install page's main message.
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
  const [method, setMethod] = useState<InstallMethod>("plugin");

  return (
    <div className="h-full overflow-y-auto bg-background">
      {/* Centered column — with only two install paths the page reads as
          focused instead of stretched edge-to-edge. */}
      <div className="px-6 py-7 max-w-2xl mx-auto">
        <PageHeader
          title="Install Nous"
          subtitle="Two ways to give your agents the Account Record. Both ride the same v2 Context API and the same MCP server."
        />
        <div className="space-y-7">
          {/* Method selector — 2 cards, centered by the parent column */}
          <div className="grid grid-cols-2 gap-3">
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
                  {m.icon}
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
          {method === "client" && <McpClientPanel />}

          {/* Build-your-own path — small footer link, not a third tab */}
          <SdkFooter />
        </div>
      </div>
    </div>
  );
}

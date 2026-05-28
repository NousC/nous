import { useState } from "react";
import { Check, Copy } from "lucide-react";

const CURL_SNIPPET = `curl -X POST https://api.opennous.cloud/v2/observations \\
  -H 'Authorization: Bearer YOUR_API_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "focus": "new-user@example.com",
    "observations": [
      { "kind": "event",
        "property": "interaction.signed_up",
        "value": { "plan": "free", "source": "yourapp.com" } },
      { "kind": "state", "property": "stage", "value": "Free User" }
    ]
  }'`;

export function TrackYourSignupsCard() {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(CURL_SNIPPET);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border border-border bg-background p-5 mb-6">
      <div className="flex items-start gap-4">
        <div className="h-10 w-10 rounded-lg bg-foreground flex items-center justify-center flex-shrink-0 p-1.5">
          <img src="/provider-logos/nous.svg" alt="Nous" className="h-full w-full object-contain" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold text-foreground">Track your own signups</h3>
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-semibold">
              Dogfood
            </span>
          </div>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Drop this into your signup handler. Every new user becomes a person in your Nous
            workspace and lands on their timeline as{" "}
            <code className="text-[12px] px-1 py-0.5 rounded bg-muted text-foreground/80">
              interaction.signed_up
            </code>
            .
          </p>

          <div className="mt-4 rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800">
              <span className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono">curl</span>
              <button
                onClick={copy}
                className={
                  "flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors " +
                  (copied ? "text-emerald-400" : "text-zinc-400 hover:text-white hover:bg-zinc-800")
                }
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="text-[12px] font-mono text-zinc-200 p-3 overflow-x-auto leading-relaxed">
              <code>{CURL_SNIPPET}</code>
            </pre>
          </div>

          <div className="mt-3 flex items-center gap-3 text-[12px] flex-wrap">
            <a
              href="/settings/api-keys"
              className="text-foreground/80 hover:text-foreground font-medium underline-offset-2 hover:underline"
            >
              Mint an API key
            </a>
            <span className="text-muted-foreground/40">·</span>
            <a
              href="https://docs.opennous.cloud/public-api/observations"
              target="_blank"
              rel="noreferrer"
              className="text-foreground/80 hover:text-foreground font-medium underline-offset-2 hover:underline"
            >
              Full reference
            </a>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground">
              Stripe lifecycle events auto-log to the same timeline.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

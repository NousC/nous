import { useState, useEffect, useCallback } from "react";
import { Webhook, Copy, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/ui/page-header";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

type WebhookStatus = "live" | "stale" | "pending";

interface WebhookUrl {
  source: string;
  url: string;
  auto_registered?: boolean;
  last_event_at?: string | null;
  status?: WebhookStatus;
}

function ProviderLogo({ source }: { source: string }) {
  // Try .svg first; if missing fall back to .png; if both 404 the lucide
  // Webhook icon underneath stays visible.
  const [src, setSrc] = useState(`/provider-logos/${source}.svg`);
  return (
    <div className="relative w-8 h-8 rounded-lg bg-muted/50 border border-border/60 flex items-center justify-center overflow-hidden flex-shrink-0">
      <Webhook className="h-4 w-4 text-muted-foreground/50" strokeWidth={1.75} />
      <img
        src={src}
        alt=""
        className="absolute inset-0 m-auto w-5 h-5 object-contain bg-muted/50"
        onError={e => {
          if (src.endsWith(".svg")) setSrc(`/provider-logos/${source}.png`);
          else (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    </div>
  );
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "no events yet";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "no events yet";
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 60)  return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60)  return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)   return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30)  return `${day}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function StatusPill({ status, lastEventAt }: { status?: WebhookStatus; lastEventAt?: string | null }) {
  const cfg = status === "live"
    ? { dot: "bg-emerald-500",       text: "text-emerald-700",       bg: "bg-emerald-50", border: "border-emerald-200", label: "Live"    }
    : status === "stale"
    ? { dot: "bg-amber-500",         text: "text-amber-700",         bg: "bg-amber-50",   border: "border-amber-200",   label: "Stale"   }
    : { dot: "bg-muted-foreground/40", text: "text-muted-foreground/80", bg: "bg-muted/40", border: "border-border",     label: "Pending" };
  const sub = formatRelative(lastEventAt);
  const tooltip = status === "live"
    ? `Last event received ${sub}. Webhook is wired up.`
    : status === "stale"
    ? `Last event was ${sub} — webhook may have been disabled on the provider side. Check the integration.`
    : "No events received yet. If you just set this up, send a test event from the provider to confirm.";
  return (
    <span title={tooltip}
      className={`flex-shrink-0 inline-flex items-center gap-1.5 h-7 px-2 rounded-md border ${cfg.bg} ${cfg.border} ${cfg.text} text-[11px] font-semibold`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label} · {sub}
    </span>
  );
}

export default function Webhooks() {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";

  const [urls, setUrls] = useState<WebhookUrl[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/webhooks/urls?workspaceId=${encodeURIComponent(workspaceId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = res.ok ? await res.json() : {};
      setUrls(data.urls ?? []);
    } catch {
      setUrls([]);
    } finally { setLoading(false); }
  }, [token, workspaceId]);

  useEffect(() => { load(); }, [load]);

  // Refresh every 30s so a fresh test ping flips Pending → Live without
  // the user having to reload the page.
  useEffect(() => {
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const copyUrl = (url: string, source: string) => {
    navigator.clipboard.writeText(url);
    setCopied(source);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-8 py-7">
        <PageHeader
          title="Webhooks"
          subtitle="Paste these URLs into your tools, or rely on the auto-registered providers. The status pill shows whether events are actually arriving — proof, not promises."
        />

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-5 text-[11px] text-muted-foreground/80">
          <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Live — events in the last 7 days</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Stale — no events for &gt;7 days</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" /> Pending — nothing received yet</span>
        </div>

        {loading ? (
          <div className="space-y-px rounded-xl overflow-hidden border border-border">
            {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted/50 animate-pulse" />)}
          </div>
        ) : urls.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-12 text-center">
            <Webhook className="h-7 w-7 text-muted-foreground/50 mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-[13px] font-medium text-foreground/80 mb-1">No webhook URLs configured</p>
            <p className="text-[12px] text-muted-foreground/70">Connect an integration to generate webhook endpoints.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            {urls.map(w => (
              <div key={w.source}
                className="flex items-center gap-4 px-4 py-3.5 bg-background hover:bg-accent border-b border-border/60 last:border-0 transition-colors">
                <ProviderLogo source={w.source} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-semibold text-foreground capitalize">{w.source.replace(/_/g, " ")}</p>
                    {w.auto_registered && (
                      <span
                        title="Nous registered this webhook for you via the provider's API. No paste step needed — but the status pill still shows whether events are flowing."
                        className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/40 text-muted-foreground/80 font-medium uppercase tracking-wide">
                        auto-registered
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-muted-foreground/70 font-mono truncate mt-0.5">{w.url}</p>
                </div>
                <StatusPill status={w.status} lastEventAt={w.last_event_at} />
                <button onClick={() => copyUrl(w.url, w.source)}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-accent transition-colors">
                  {copied === w.source
                    ? <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copied</>
                    : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

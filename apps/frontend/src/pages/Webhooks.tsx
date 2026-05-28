import { useState, useEffect, useCallback } from "react";
import { Webhook, Copy, Check, Info, ArrowRight, ExternalLink, ChevronDown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/ui/page-header";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

type WebhookStatus = "live" | "stale" | "pending";

interface WebhookUrl {
  source: string;
  url: string;
  auto_registered?: boolean;
  last_event_at?: string | null;
  status?: WebhookStatus;
}

// ─── Provider logo ──────────────────────────────────────────────────────────
// Listing PNG sources explicitly avoids a wasted .svg request that 404s on
// every page load.
const PNG_SOURCES = new Set(["emailbison", "heyreach", "smartlead", "rb2b", "linkedin"]);

function ProviderLogo({ source, size = 8 }: { source: string; size?: number }) {
  const initialExt = PNG_SOURCES.has(source) ? "png" : "svg";
  const [src, setSrc] = useState(`/provider-logos/${source}.${initialExt}`);
  const tile = size === 8 ? "w-8 h-8 rounded-lg" : "w-10 h-10 rounded-xl";
  const inner = size === 8 ? "w-5 h-5" : "w-6 h-6";
  const icon  = size === 8 ? "h-4 w-4" : "h-5 w-5";
  return (
    <div className={`relative ${tile} bg-muted/50 border border-border/60 flex items-center justify-center overflow-hidden flex-shrink-0`}>
      <Webhook className={`${icon} text-muted-foreground/50`} strokeWidth={1.75} />
      <img
        src={src}
        alt=""
        className={`absolute inset-0 m-auto ${inner} object-contain bg-muted/50`}
        onError={e => {
          if (src.endsWith(".svg"))      setSrc(`/provider-logos/${source}.png`);
          else if (src.endsWith(".png")) setSrc(`/provider-logos/${source}.svg`);
          else (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    </div>
  );
}

// ─── Time formatting ────────────────────────────────────────────────────────

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
    ? { dot: "bg-emerald-500",         text: "text-emerald-700",         bg: "bg-emerald-50", border: "border-emerald-200", label: "Live"    }
    : status === "stale"
    ? { dot: "bg-amber-500",           text: "text-amber-700",           bg: "bg-amber-50",   border: "border-amber-200",   label: "Stale"   }
    : { dot: "bg-muted-foreground/40", text: "text-muted-foreground/80", bg: "bg-muted/40",   border: "border-border",      label: "Pending" };
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

// ─── Per-source setup guide config ──────────────────────────────────────────
// Add new providers here as their integrations stabilise. Each guide tells the
// user (a) whether Nous wires the webhook automatically or expects a paste,
// (b) exactly which provider events we listen for and what they become inside
// Nous, (c) which events we deliberately skip and why, and (d) how to add more
// events manually if their setup is non-default.

type WebhookMode = "auto" | "paste";

interface EventMapping {
  source_event: string;
  nous_activity: string;
}

interface SkippedEvent {
  event: string;
  reason: string;
}

interface ManualConfig {
  intro: string;
  steps: string[];
}

interface WebhookGuide {
  mode: WebhookMode;
  modeNote: string;
  events: EventMapping[];
  skipped?: SkippedEvent[];
  skippedExplainer?: string;
  manualConfig?: ManualConfig;
  docsUrl?: string;
}

const WEBHOOK_GUIDES: Record<string, WebhookGuide> = {
  heyreach: {
    mode: "auto",
    modeNote: "Set up automatically when you connected. Nothing for you to do here.",
    events: [
      { source_event: "CONNECTION_REQUEST_SENT", nous_activity: "linkedin_connection_sent" },
      { source_event: "MESSAGE_SENT",            nous_activity: "linkedin_message_sent" },
      { source_event: "INMAIL_SENT",             nous_activity: "linkedin_message_sent" },
      { source_event: "FOLLOW_SENT",             nous_activity: "linkedin_follow_sent" },
      { source_event: "LIKED_POST",              nous_activity: "linkedin_like" },
      { source_event: "VIEWED_PROFILE",          nous_activity: "linkedin_profile_view" },
      { source_event: "CAMPAIGN_COMPLETED",      nous_activity: "campaign_completed" },
      { source_event: "LEAD_TAG_UPDATED",        nous_activity: "tag_updated" },
    ],
    skipped: [
      { event: "MESSAGE_REPLY_RECEIVED",        reason: "Native LinkedIn integration already logs this" },
      { event: "CONNECTION_REQUEST_ACCEPTED",   reason: "Native LinkedIn integration already logs this" },
      { event: "INMAIL_REPLY_RECEIVED",         reason: "Native LinkedIn integration already logs this" },
      { event: "EVERY_MESSAGE_REPLY_RECEIVED",  reason: "Native LinkedIn integration already logs this" },
    ],
    skippedExplainer: "These events fire when a reply or accept lands in your LinkedIn inbox. Our native LinkedIn integration (Unipile) is already the source of truth for them — if we subscribed via HeyReach too, every reply would be logged twice on the contact timeline.",
    manualConfig: {
      intro: "If you don't have native LinkedIn connected, or want HeyReach to send the inbound events too, you can register additional webhooks by hand:",
      steps: [
        "Open HeyReach → Settings → Integrations → Webhooks → New Webhook URL",
        "Paste the webhook URL shown on this row",
        "Pick the event type you want (e.g. MESSAGE_REPLY_RECEIVED)",
        "Webhook name must be 25 characters or fewer (HeyReach limit)",
      ],
    },
    docsUrl: "https://docs.opennous.cloud/providers/heyreach",
  },
};

// ─── Guide sheet ────────────────────────────────────────────────────────────

function WebhookGuideSheet({
  source,
  url,
  open,
  onOpenChange,
}: {
  source: string | null;
  url: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const guide = source ? WEBHOOK_GUIDES[source] : null;
  const niceSource = source ? source.replace(/_/g, " ") : "";
  // Auto-registered providers default to the slim "you're done" view;
  // expanding reveals URL + event mapping for the curious.
  const [showDetails, setShowDetails] = useState(false);
  useEffect(() => { setShowDetails(false); }, [source]);

  const eventsTable = guide && (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-2">
        Events Nous listens for <span className="text-muted-foreground/50 font-normal">({guide.events.length})</span>
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        {guide.events.map((e, i) => (
          <div key={e.source_event}
            className={`flex items-center gap-2 px-3 py-2 text-[12px] ${i > 0 ? "border-t border-border/60" : ""}`}>
            <Check className="h-3 w-3 text-emerald-600 flex-shrink-0" />
            <code className="font-mono text-foreground/80 flex-shrink-0">{e.source_event}</code>
            <ArrowRight className="h-3 w-3 text-muted-foreground/50 mx-1 flex-shrink-0" />
            <code className="font-mono text-muted-foreground/80 truncate">{e.nous_activity}</code>
          </div>
        ))}
      </div>
    </div>
  );

  const webhookUrlBlock = (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-1.5">Webhook URL</div>
      <code className="block text-[11px] font-mono break-all px-3 py-2 rounded-lg border border-border bg-muted/30">{url}</code>
    </div>
  );

  const docsLink = guide?.docsUrl && (
    <a href={guide.docsUrl} target="_blank" rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-[12px] font-medium text-foreground/70 hover:text-foreground transition-colors">
      Read full docs <ExternalLink className="h-3 w-3" />
    </a>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg w-full overflow-y-auto p-0">
        <div className="px-6 pt-6 pb-4 border-b border-border">
          <SheetHeader className="text-left space-y-3">
            <div className="flex items-center gap-3">
              {source && <ProviderLogo source={source} size={10} />}
              <div>
                <SheetTitle className="text-[16px] font-bold capitalize">{niceSource}</SheetTitle>
                <SheetDescription className="text-[12px] text-muted-foreground/80">
                  Webhook setup
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>
        </div>

        <div className="px-6 py-5 space-y-6">
          {!guide ? (
            <>
              <div className="rounded-lg border border-dashed border-border p-4">
                <p className="text-[13px] font-medium text-foreground/80 mb-1">Setup guide coming soon</p>
                <p className="text-[12px] text-muted-foreground/70">
                  Paste the URL below into the provider's webhook settings — Nous will route incoming events automatically.
                </p>
              </div>
              {webhookUrlBlock}
            </>
          ) : guide.mode === "auto" ? (
            /* AUTO-REGISTERED — slim view: just confirmation. Details on demand. */
            <>
              <div className="rounded-lg border bg-emerald-50 border-emerald-200 p-4">
                <div className="text-[13px] font-semibold mb-1 flex items-center gap-1.5 text-emerald-700">
                  <Check className="h-4 w-4" /> Set up — nothing to do here
                </div>
                <p className="text-[12px] leading-relaxed text-emerald-800/90">{guide.modeNote}</p>
              </div>

              <button onClick={() => setShowDetails(v => !v)}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors">
                <ChevronDown className={`h-3 w-3 transition-transform ${showDetails ? "rotate-180" : ""}`} />
                {showDetails ? "Hide details" : "Show details"}
              </button>

              {showDetails && (
                <div className="space-y-5 pt-1">
                  {webhookUrlBlock}
                  {eventsTable}
                </div>
              )}

              {docsLink}
            </>
          ) : (
            /* PASTE-REQUIRED — full guide: status, URL, events, skipped, manual steps. */
            <>
              <div className="rounded-lg border bg-amber-50 border-amber-200 p-4">
                <div className="text-[12px] font-semibold mb-1 flex items-center gap-1.5 text-amber-700">
                  <Info className="h-3.5 w-3.5" /> Paste required
                </div>
                <p className="text-[12px] leading-relaxed text-amber-800/90">{guide.modeNote}</p>
              </div>

              {webhookUrlBlock}
              {eventsTable}

              {guide.skipped && guide.skipped.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-2">
                    Events Nous skips <span className="text-muted-foreground/50 font-normal">({guide.skipped.length})</span>
                  </div>
                  <div className="rounded-lg border border-border overflow-hidden mb-2">
                    {guide.skipped.map((s, i) => (
                      <div key={s.event}
                        className={`flex items-start gap-2 px-3 py-2 text-[12px] ${i > 0 ? "border-t border-border/60" : ""}`}>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="w-3 inline-block text-center text-muted-foreground/40">·</span>
                          <code className="font-mono text-muted-foreground/80">{s.event}</code>
                        </div>
                        <span className="text-muted-foreground/60 text-[11px] ml-auto">{s.reason}</span>
                      </div>
                    ))}
                  </div>
                  {guide.skippedExplainer && (
                    <p className="text-[12px] text-muted-foreground/70 leading-relaxed">{guide.skippedExplainer}</p>
                  )}
                </div>
              )}

              {guide.manualConfig && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-2">
                    Add events manually
                  </div>
                  <p className="text-[12px] text-muted-foreground/70 mb-2.5 leading-relaxed">{guide.manualConfig.intro}</p>
                  <ol className="space-y-1.5 list-decimal list-inside text-[12px] text-foreground/80 marker:text-muted-foreground/60">
                    {guide.manualConfig.steps.map((step, i) => (
                      <li key={i} className="leading-relaxed">{step}</li>
                    ))}
                  </ol>
                </div>
              )}

              {docsLink}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Webhooks() {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";

  const [urls, setUrls] = useState<WebhookUrl[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [guideSource, setGuideSource] = useState<string | null>(null);

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

  // Refresh every 30s so a fresh test ping flips Pending → Live without reload.
  useEffect(() => {
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const copyUrl = (url: string, source: string) => {
    navigator.clipboard.writeText(url);
    setCopied(source);
    setTimeout(() => setCopied(null), 1500);
  };

  const guideUrl = urls.find(u => u.source === guideSource)?.url ?? "";

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
                className="flex items-center gap-3 px-4 py-3.5 bg-background hover:bg-accent border-b border-border/60 last:border-0 transition-colors">
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
                <button onClick={() => setGuideSource(w.source)}
                  title="Setup guide — which events to enable, where to paste, what's auto-registered"
                  className="flex-shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-lg bg-background border border-border text-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors">
                  <Info className="h-4 w-4" />
                </button>
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

      <WebhookGuideSheet
        source={guideSource}
        url={guideUrl}
        open={guideSource != null}
        onOpenChange={(v) => { if (!v) setGuideSource(null); }}
      />
    </div>
  );
}

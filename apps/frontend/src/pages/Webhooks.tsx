import { useState, useEffect, useCallback } from "react";
import { Webhook, Copy, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/ui/page-header";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

interface WebhookUrl {
  source: string;
  url: string;
  auto_registered?: boolean;
}

function ProviderLogo({ source }: { source: string }) {
  return (
    <div className="relative w-8 h-8 rounded-lg bg-muted/50 border border-border/60 flex items-center justify-center overflow-hidden flex-shrink-0">
      <Webhook className="h-4 w-4 text-muted-foreground/50" strokeWidth={1.75} />
      <img
        src={`/provider-logos/${source}.svg`}
        alt=""
        className="absolute inset-0 m-auto w-5 h-5 object-contain bg-muted/50"
        onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    </div>
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
          subtitle="Paste these URLs into your tools to push signals in. Providers marked auto-registered are wired up for you when you save the connection — no action needed."
        />

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
                  <p className="text-[13px] font-semibold text-foreground capitalize">{w.source.replace(/_/g, " ")}</p>
                  <p className="text-[12px] text-muted-foreground/70 font-mono truncate mt-0.5">{w.url}</p>
                </div>
                {w.auto_registered ? (
                  <span
                    title="Nous auto-registers this webhook when you connect the integration. URL shown for debugging only — no copy/paste needed."
                    className="flex-shrink-0 flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700"
                  >
                    <Check className="h-3 w-3" /> auto-registered
                  </span>
                ) : (
                  <button onClick={() => copyUrl(w.url, w.source)}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-accent transition-colors">
                    {copied === w.source
                      ? <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copied</>
                      : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

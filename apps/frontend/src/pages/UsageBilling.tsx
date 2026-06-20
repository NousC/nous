import { useState, useEffect, useCallback } from "react";
import { ExternalLink, Loader2, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

type PlanInfo = {
  id: string;
  name: string;
  monthlyPriceUsd: number;
  includedOpsPerMonth: number;
  recordsLimit: number | null; // null = unlimited
  enrichmentsPerMonth: number;
  workspaceLimit: number | null;
  perWorkspaceUsd?: number | null;
  baseWorkspaces?: number | null;
};

type BillingState = {
  billing_disabled: boolean;
  self_hosted?: boolean;
  plan: string;
  planName?: string;
  subscription?: {
    status: string;
    current_period_start?: string | null;
    current_period_end?: string | null;
    cancel_at_period_end?: boolean;
    stripe_subscription_id?: string | null;
    is_comp?: boolean;
  } | null;
  ops?: { used: number; included: number; remaining: number } | null;
  records?: { used: number; included: number; remaining: number } | null;
  enrichments?: { used: number; included: number; remaining: number } | null;
  allPlans?: PlanInfo[];
};

type RetrievalType = { eventType: string; label: string; count: number; billed: boolean };
type Breakdown = {
  periodStart: string;
  total: number;
  billed: number;
  free: number;
  retrieval: RetrievalType[];
};

// Order on the page.
const PLAN_ORDER = ["free", "starter", "pro", "growth", "scale"];

const PLAN_BLURB: Record<string, string> = {
  free: "For builders kicking the tires before committing volume.",
  starter: "For solo operators shipping campaigns from Claude Code.",
  pro: "For internal GTM teams scaling their operations.",
  growth: "For teams running higher volume across more workspaces.",
  scale: "For agencies running multiple clients in parallel.",
};

function num(n: number | undefined) {
  return Number(n || 0).toLocaleString();
}

function fmtDate(s?: string | null) {
  if (!s) return null;
  return new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Plan card bullets. Only the three things that scale with a plan: GTM
 * operations / month, records, and the bring-your-own-keys note. CRM sync,
 * lead lists, LinkedIn and the full intelligence brain are on every plan, so
 * they are not listed as per-tier differentiators.
 */
function planBullets(p: PlanInfo): string[] {
  const b = [
    `${num(p.includedOpsPerMonth)} retrievals / month`,
    p.recordsLimit == null
      ? "Unlimited records"
      : p.perWorkspaceUsd
        ? `${num(p.recordsLimit)} records per client`
        : `${num(p.recordsLimit)} records`,
    p.enrichmentsPerMonth > 0
      ? `${num(p.enrichmentsPerMonth)} enrichments / month`
      : "Enrichment: bring your own keys",
  ];
  // Partner is sold per client workspace — keep that one structural line.
  if (p.perWorkspaceUsd) {
    b.push(`${p.baseWorkspaces} client workspaces included, then $${p.perWorkspaceUsd}/mo each`);
  }
  return b;
}

function UsageMeter({ label, used, included }: { label: string; used: number; included: number }) {
  // included === 0 → bring-your-own-keys / unmetered. Show a note, not a 0/0 bar.
  if (included <= 0) {
    return (
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-[14px] font-medium text-foreground">{label}</span>
          <span className="text-[12px] text-muted-foreground/70">Bring your own keys · unmetered</span>
        </div>
        <p className="text-[12px] text-muted-foreground">
          Runs on your connected provider keys. {num(used)} this period.
        </p>
      </div>
    );
  }
  const pct = included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 0;
  const barColor = pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-foreground/80";
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[14px] font-medium text-foreground">{label}</span>
        <span className="text-[12px] text-muted-foreground tabular-nums">
          {num(used)} <span className="text-muted-foreground/40">/</span> {num(included)}
          <span className="text-muted-foreground/70"> · {pct}% used</span>
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function UsageBilling() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";

  const [state, setState] = useState<BillingState | null>(null);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [r, bdRes] = await Promise.all([
        fetch(`${apiUrl}/api/billing/state`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiUrl}/api/usage/ops-breakdown`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "load_failed");
      setState(await r.json());
      if (bdRes.ok) setBreakdown(await bdRes.json());
    } catch (e: any) {
      setError(e?.message || "Failed to load billing");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const subscribe = async (
    plan: string,
    opts?: { interval?: "month" | "year"; promotion_code?: string },
  ) => {
    setAction(`subscribe:${plan}`);
    try {
      const r = await fetch(`${apiUrl}/api/billing/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan, ...opts }),
      });
      const data = await r.json();
      if (!r.ok || !data.url) throw new Error(data.error || "checkout_failed");
      window.location.href = data.url;
    } catch (e: any) {
      toast.error(e?.message || "Could not start checkout");
      setAction(null);
    }
  };

  // Drip-email deep link: /settings?section=billing&plan=pro&interval=year&code=…
  // auto-starts the annual checkout with the per-user code pre-applied. Guarded so
  // it fires once, only after auth is ready.
  useEffect(() => {
    if (!token) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("interval") !== "year") return;
    const plan = q.get("plan") || "pro";
    const code = q.get("code") || undefined;
    // Strip the offer params so a refresh / back-nav doesn't re-trigger checkout.
    const cleaned = new URLSearchParams(window.location.search);
    ["interval", "code"].forEach((k) => cleaned.delete(k));
    window.history.replaceState({}, "", `${window.location.pathname}?${cleaned.toString()}`);
    subscribe(plan, { interval: "year", promotion_code: code });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const openPortal = async () => {
    setAction("portal");
    try {
      const r = await fetch(`${apiUrl}/api/billing/customer-portal`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok || !data.url) throw new Error(data.error || "portal_failed");
      window.open(data.url, "_blank");
    } catch (e: any) {
      toast.error(e?.message || "Could not open customer portal");
    } finally {
      setAction(null);
    }
  };

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="h-full overflow-y-auto bg-background">
      <div className="p-8 max-w-[1180px]">
        <h1 className="text-[26px] font-bold text-foreground tracking-tight mb-6">Billing &amp; usage</h1>
        {children}
      </div>
    </div>
  );

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground py-12">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      </Shell>
    );
  }

  if (error || !state) {
    return (
      <Shell>
        <div className="rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50/60 dark:bg-red-950/30 p-5 text-[13px] text-red-800 dark:text-red-300">
          {error || "Failed to load billing."}
          <button onClick={load} className="ml-3 underline">Retry</button>
        </div>
      </Shell>
    );
  }

  if (state.billing_disabled) {
    return (
      <Shell>
        <div className="rounded-2xl border border-border bg-muted/30 p-8 text-[14px] text-muted-foreground max-w-2xl">
          {state.self_hosted
            ? "You're running self-hosted Nous — every feature is unlocked, ops and enrichments are unmetered, and there's no billing. Billing only applies to Nous Cloud."
            : "Billing is disabled on this deployment."}
        </div>
      </Shell>
    );
  }

  const planId = state.plan;
  const sub = state.subscription;
  const ops = state.ops ?? { used: 0, included: 0, remaining: 0 };
  const records = state.records ?? { used: 0, included: 0, remaining: 0 };
  const enrich = state.enrichments ?? { used: 0, included: 0, remaining: 0 };
  const apiPlans = state.allPlans ?? [];

  // Ordered plans.
  const orderedPlans = PLAN_ORDER
    .map((id) => apiPlans.find((p) => p.id === id))
    .filter(Boolean) as PlanInfo[];

  const currentPlan = apiPlans.find((p) => p.id === planId);
  // Next paid tier up — drives the primary CTA on the summary card.
  const nextPlan = orderedPlans.find((p) => p.monthlyPriceUsd > (currentPlan?.monthlyPriceUsd ?? 0));

  const statusBadge = (() => {
    if (sub?.is_comp) return ["Comp", "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300"];
    if (sub?.status === "active") return ["Active", "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"];
    if (sub?.status === "trialing") return ["Trial", "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"];
    if (sub?.status === "past_due") return ["Past due", "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"];
    return null;
  })();

  const periodLabel =
    sub?.current_period_start && sub?.current_period_end
      ? `${fmtDate(sub.current_period_start)} – ${fmtDate(sub.current_period_end)}`
      : null;

  return (
    <Shell>
      {/* ── Summary card: current plan (left) + usage (right) ── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden mb-10">
        <div className="grid md:grid-cols-[1fr_1.15fr]">
          {/* Current plan */}
          <div className="p-6 md:p-7 flex flex-col">
            <div className="flex items-center gap-2.5 mb-2">
              <h2 className="text-[18px] font-semibold text-foreground">{state.planName} plan</h2>
              {statusBadge && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusBadge[1]}`}>
                  {statusBadge[0]}
                </span>
              )}
            </div>
            <p className="text-[13px] leading-[1.6] text-muted-foreground mb-6 max-w-sm">
              {PLAN_BLURB[planId] ?? ""}
            </p>
            <div className="mt-auto flex items-center gap-2">
              {nextPlan && (
                <button
                  onClick={() => subscribe(nextPlan.id)}
                  disabled={!!action}
                  className="h-9 px-4 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-40 bg-foreground text-background hover:bg-foreground/90 dark:bg-muted dark:text-foreground dark:hover:bg-muted/70 dark:border dark:border-border"
                >
                  {action === `subscribe:${nextPlan.id}` ? "Loading…" : `Upgrade to ${nextPlan.name}`}
                </button>
              )}
              {sub?.stripe_subscription_id && (
                <button
                  onClick={openPortal}
                  disabled={!!action}
                  className="h-9 px-3.5 rounded-lg border border-border text-muted-foreground text-[13px] font-medium hover:text-foreground transition-colors disabled:opacity-40 inline-flex items-center gap-1.5"
                >
                  Manage <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Usage */}
          <div className="p-6 md:p-7 bg-muted/30 border-t md:border-t-0 md:border-l border-border space-y-5">
            <div>
              <UsageMeter label="Retrieval · billed" used={ops.used} included={ops.included} />
              <p className="mt-2 text-[12px] text-muted-foreground">
                Agent context pulls are the only billed ops. Writes, scans and ingest are free.
              </p>
              {breakdown && breakdown.retrieval.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground">
                    TOP RETRIEVAL OPS · THIS PERIOD
                  </div>
                  <div className="space-y-1.5">
                    {breakdown.retrieval.map((r) => {
                      const max = breakdown.retrieval[0]?.count || 1;
                      return (
                        <div key={r.eventType} className="flex items-center gap-3">
                          <span className="w-28 flex-shrink-0 font-mono text-[12px] text-foreground">{r.label}</span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-foreground/70" style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
                          </div>
                          <span className="w-16 flex-shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{num(r.count)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 text-[11px] tabular-nums text-muted-foreground">
                    {num(breakdown.billed)} billed · {num(breakdown.free)} free · {num(breakdown.total)} ops total
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[14px] font-medium text-foreground">Records</span>
              <span className="text-[12px] text-muted-foreground tabular-nums">
                {num(records.used)} <span className="text-muted-foreground/70">· Unlimited</span>
              </span>
            </div>
            <UsageMeter label="Enrichments" used={enrich.used} included={enrich.included} />
            <p className="text-[12px] text-muted-foreground/70 pt-1">
              {periodLabel ? `Current billing period · ${periodLabel}` : "Resets at the start of each month."}
            </p>
          </div>
        </div>
      </div>

      {/* ── Plans ── */}
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold text-foreground">Nous plans</h2>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Pure-tier pricing. You're billed only on retrieval (agent context pulls); records and everything else are unlimited, and enrichment is bring-your-own-keys. No top-up packs or overage charges.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {orderedPlans.map((p) => {
          const isCurrent = p.id === planId;
          return (
            <div
              key={p.id}
              className={`rounded-2xl border p-5 flex flex-col ${
                isCurrent ? "border-foreground bg-muted/30" : "border-border bg-card"
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[13px] font-medium text-muted-foreground">{p.name}</span>
                {isCurrent && (
                  <span className="text-[9px] uppercase tracking-wide text-muted-foreground/70 font-semibold">Current</span>
                )}
              </div>
              <div className="text-[24px] font-bold text-foreground tabular-nums leading-tight mb-4">
                {p.monthlyPriceUsd === 0 ? "Free" : <>${p.monthlyPriceUsd}<span className="text-[13px] font-normal text-muted-foreground/70">/mo</span></>}
              </div>
              <ul className="space-y-2 mb-5">
                {planBullets(p).map((b) => (
                  <li key={b} className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
                    <Check className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0 mt-[2px]" strokeWidth={2.5} />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto">
                {isCurrent ? (
                  <div className="h-9 flex items-center justify-center rounded-lg bg-muted text-muted-foreground/70 text-[12.5px] font-medium">
                    Current plan
                  </div>
                ) : p.id === "free" ? (
                  <button
                    onClick={openPortal}
                    disabled={!!action}
                    className="w-full h-9 rounded-lg border border-border text-muted-foreground text-[12.5px] font-medium hover:text-foreground transition-colors disabled:opacity-40"
                  >
                    Downgrade
                  </button>
                ) : (
                  <button
                    onClick={() => subscribe(p.id)}
                    disabled={!!action}
                    className="w-full h-9 rounded-lg text-[12.5px] font-medium transition-colors disabled:opacity-40 bg-foreground text-background hover:bg-foreground/90 dark:bg-muted dark:text-foreground dark:hover:bg-muted/70 dark:border dark:border-border"
                  >
                    {action === `subscribe:${p.id}` ? "Loading…" : `Choose ${p.name}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

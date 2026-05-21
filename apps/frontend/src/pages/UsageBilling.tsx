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
  enrichmentsPerMonth: number;
  workspaceLimit: number | null;
  crmSync?: boolean;
  supportTier?: string;
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
  enrichments?: { used: number; included: number; remaining: number } | null;
  allPlans?: PlanInfo[];
};

// Order on the page; Enterprise is appended client-side (marketing CTA).
const PLAN_ORDER = ["free", "starter", "pro", "scale"];

const PLAN_BLURB: Record<string, string> = {
  free: "Test the core workflow — unify your stack and query it from an agent.",
  starter: "For individuals running their own outbound with an agent.",
  pro: "For operators turning signal into pipeline at volume.",
  scale: "For teams running multi-channel outbound with agents.",
  enterprise: "Embed Nous into your own product or agent stack.",
};

const SUPPORT_LABEL: Record<string, string> = {
  community: "Community support",
  email: "Email support",
  priority: "Priority support",
};

function num(n: number | undefined) {
  return Number(n || 0).toLocaleString();
}

function fmtDate(s?: string | null) {
  if (!s) return null;
  return new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Feature checklist for a plan card. */
function planBullets(p: PlanInfo): string[] {
  const b = [
    "Unlimited contacts",
    `${num(p.includedOpsPerMonth)} ops / month`,
    `${num(p.enrichmentsPerMonth)} enrichments / month`,
    p.workspaceLimit === null
      ? "Unlimited workspaces"
      : `${p.workspaceLimit} workspace${p.workspaceLimit === 1 ? "" : "s"}`,
  ];
  if (p.crmSync) b.push("CRM sync");
  b.push(SUPPORT_LABEL[p.supportTier ?? "community"] ?? "Community support");
  return b;
}

function UsageMeter({ label, used, included }: { label: string; used: number; included: number }) {
  const pct = included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 0;
  const barColor = pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-gray-900";
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[14px] font-medium text-gray-900">{label}</span>
        <span className="text-[12px] text-gray-500 tabular-nums">
          {num(used)} <span className="text-gray-300">/</span> {num(included)}
          <span className="text-gray-400"> · {pct}% used</span>
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function UsageBilling() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";

  const [state, setState] = useState<BillingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${apiUrl}/api/billing/state`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "load_failed");
      setState(await r.json());
    } catch (e: any) {
      setError(e?.message || "Failed to load billing");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const subscribe = async (plan: string) => {
    setAction(`subscribe:${plan}`);
    try {
      const r = await fetch(`${apiUrl}/api/billing/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan }),
      });
      const data = await r.json();
      if (!r.ok || !data.url) throw new Error(data.error || "checkout_failed");
      window.location.href = data.url;
    } catch (e: any) {
      toast.error(e?.message || "Could not start checkout");
      setAction(null);
    }
  };

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
    <div className="h-full overflow-y-auto bg-white">
      <div className="p-8 max-w-[1180px]">
        <h1 className="text-[26px] font-bold text-gray-900 tracking-tight mb-6">Billing &amp; usage</h1>
        {children}
      </div>
    </div>
  );

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-[13px] text-gray-500 py-12">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      </Shell>
    );
  }

  if (error || !state) {
    return (
      <Shell>
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-5 text-[13px] text-red-800">
          {error || "Failed to load billing."}
          <button onClick={load} className="ml-3 underline">Retry</button>
        </div>
      </Shell>
    );
  }

  if (state.billing_disabled) {
    return (
      <Shell>
        <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-8 text-[14px] text-gray-600 max-w-2xl">
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
  const enrich = state.enrichments ?? { used: 0, included: 0, remaining: 0 };
  const apiPlans = state.allPlans ?? [];

  // Ordered plans + a static Enterprise card.
  const orderedPlans = PLAN_ORDER
    .map((id) => apiPlans.find((p) => p.id === id))
    .filter(Boolean) as PlanInfo[];

  const currentPlan = apiPlans.find((p) => p.id === planId);
  // Next paid tier up — drives the primary CTA on the summary card.
  const nextPlan = orderedPlans.find((p) => p.monthlyPriceUsd > (currentPlan?.monthlyPriceUsd ?? 0));

  const statusBadge = (() => {
    if (sub?.is_comp) return ["Comp", "bg-purple-100 text-purple-700"];
    if (sub?.status === "active") return ["Active", "bg-emerald-100 text-emerald-700"];
    if (sub?.status === "trialing") return ["Trial", "bg-blue-100 text-blue-700"];
    if (sub?.status === "past_due") return ["Past due", "bg-amber-100 text-amber-700"];
    return null;
  })();

  const periodLabel =
    sub?.current_period_start && sub?.current_period_end
      ? `${fmtDate(sub.current_period_start)} – ${fmtDate(sub.current_period_end)}`
      : null;

  return (
    <Shell>
      {/* ── Summary card: current plan (left) + usage (right) ── */}
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden mb-10">
        <div className="grid md:grid-cols-[1fr_1.15fr]">
          {/* Current plan */}
          <div className="p-6 md:p-7 flex flex-col">
            <div className="flex items-center gap-2.5 mb-2">
              <h2 className="text-[18px] font-semibold text-gray-900">{state.planName} plan</h2>
              {statusBadge && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusBadge[1]}`}>
                  {statusBadge[0]}
                </span>
              )}
            </div>
            <p className="text-[13px] leading-[1.6] text-gray-500 mb-6 max-w-sm">
              {PLAN_BLURB[planId] ?? ""}
            </p>
            <div className="mt-auto flex items-center gap-2">
              {nextPlan && (
                <button
                  onClick={() => subscribe(nextPlan.id)}
                  disabled={!!action}
                  className="h-9 px-4 rounded-lg bg-gray-900 text-white text-[13px] font-medium hover:bg-gray-800 transition-colors disabled:opacity-40"
                >
                  {action === `subscribe:${nextPlan.id}` ? "Loading…" : `Upgrade to ${nextPlan.name}`}
                </button>
              )}
              {sub?.stripe_subscription_id && (
                <button
                  onClick={openPortal}
                  disabled={!!action}
                  className="h-9 px-3.5 rounded-lg border border-gray-200 text-gray-600 text-[13px] font-medium hover:text-gray-900 transition-colors disabled:opacity-40 inline-flex items-center gap-1.5"
                >
                  Manage <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Usage */}
          <div className="p-6 md:p-7 bg-gray-50/70 border-t md:border-t-0 md:border-l border-gray-200 space-y-5">
            <UsageMeter label="Ops" used={ops.used} included={ops.included} />
            <UsageMeter label="Enrichments" used={enrich.used} included={enrich.included} />
            <p className="text-[12px] text-gray-400 pt-1">
              {periodLabel ? `Current billing period · ${periodLabel}` : "Resets at the start of each month."}
            </p>
          </div>
        </div>
      </div>

      {/* ── Plans ── */}
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold text-gray-900">Nous plans</h2>
        <p className="text-[13px] text-gray-500 mt-0.5">
          Pure-tier pricing — ops and enrichments included per plan, no top-up packs or overage charges.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {orderedPlans.map((p) => {
          const isCurrent = p.id === planId;
          return (
            <div
              key={p.id}
              className={`rounded-2xl border p-5 flex flex-col ${
                isCurrent ? "border-gray-900 bg-gray-50/40" : "border-gray-200 bg-white"
              }`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[13px] font-medium text-gray-500">{p.name}</span>
                {isCurrent && (
                  <span className="text-[9px] uppercase tracking-wide text-gray-400 font-semibold">Current</span>
                )}
              </div>
              <div className="text-[24px] font-bold text-gray-900 tabular-nums leading-tight mb-4">
                {p.monthlyPriceUsd === 0 ? "Free" : <>${p.monthlyPriceUsd}<span className="text-[13px] font-normal text-gray-400">/mo</span></>}
              </div>
              <ul className="space-y-2 mb-5">
                {planBullets(p).map((b) => (
                  <li key={b} className="flex items-start gap-2 text-[12.5px] text-gray-600">
                    <Check className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0 mt-[2px]" strokeWidth={2.5} />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto">
                {isCurrent ? (
                  <div className="h-9 flex items-center justify-center rounded-lg bg-gray-100 text-gray-400 text-[12.5px] font-medium">
                    Current plan
                  </div>
                ) : p.id === "free" ? (
                  <button
                    onClick={openPortal}
                    disabled={!!action}
                    className="w-full h-9 rounded-lg border border-gray-200 text-gray-600 text-[12.5px] font-medium hover:text-gray-900 transition-colors disabled:opacity-40"
                  >
                    Downgrade
                  </button>
                ) : (
                  <button
                    onClick={() => subscribe(p.id)}
                    disabled={!!action}
                    className="w-full h-9 rounded-lg bg-gray-900 text-white text-[12.5px] font-medium hover:bg-gray-800 transition-colors disabled:opacity-40"
                  >
                    {action === `subscribe:${p.id}` ? "Loading…" : `Choose ${p.name}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Enterprise — marketing CTA, not a backend tier */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 flex flex-col">
          <span className="text-[13px] font-medium text-gray-500 mb-0.5">Enterprise</span>
          <div className="text-[24px] font-bold text-gray-900 leading-tight mb-4">Custom</div>
          <ul className="space-y-2 mb-5">
            {["Everything in Scale", "Unlimited ops & enrichments", "SaaS license to embed", "SLA + dedicated support", "Custom contracts"].map((b) => (
              <li key={b} className="flex items-start gap-2 text-[12.5px] text-gray-600">
                <Check className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0 mt-[2px]" strokeWidth={2.5} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
          <a
            href="mailto:bennet@opennous.cloud?subject=Nous%20Enterprise"
            className="mt-auto w-full h-9 rounded-lg border border-gray-200 text-gray-600 text-[12.5px] font-medium hover:text-gray-900 transition-colors flex items-center justify-center"
          >
            Talk to us
          </a>
        </div>
      </div>
    </Shell>
  );
}

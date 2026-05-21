import { useState, useEffect, useCallback } from "react";
import { CreditCard, ExternalLink, Loader2 } from "lucide-react";
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
};

type BillingState = {
  billing_disabled: boolean;
  self_hosted?: boolean;
  plan: string;
  planName?: string;
  subscription?: {
    status: string;
    current_period_end?: string | null;
    cancel_at_period_end?: boolean;
    stripe_subscription_id?: string | null;
    is_comp?: boolean;
  } | null;
  ops?: { used: number; included: number; remaining: number } | null;
  enrichments?: { used: number; included: number; remaining: number } | null;
  allPlans?: PlanInfo[];
};

function num(n: number | undefined) {
  return Number(n || 0).toLocaleString();
}

function UsageBar({ label, used, included }: { label: string; used: number; included: number }) {
  const pct = included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 0;
  const barColor = pct >= 90 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-gray-900";
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-gray-900">{label}</span>
        <span className="text-[12px] text-gray-500 tabular-nums">
          {num(used)} / {num(included)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
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
      const r = await fetch(`${apiUrl}/api/billing/state`, {
        headers: { Authorization: `Bearer ${token}` },
      });
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
      <div className="p-8 max-w-3xl">
        <div className="mb-6">
          <h2 className="text-[22px] font-bold text-gray-900 tracking-tight">Usage & Billing</h2>
          <p className="text-[13px] text-gray-500 mt-1">Your plan, ops usage, and enrichment allowance.</p>
        </div>
        {children}
      </div>
    </div>
  );

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-[13px] text-gray-500 py-10">
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
        <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-5 text-[13px] text-gray-600">
          {state.self_hosted
            ? "Self-hosted Nous — all features unlocked, ops and enrichments unmetered, no billing."
            : "Billing is disabled on this deployment."}
        </div>
      </Shell>
    );
  }

  const planId = state.plan;
  const sub = state.subscription;
  const ops = state.ops ?? { used: 0, included: 0, remaining: 0 };
  const enrich = state.enrichments ?? { used: 0, included: 0, remaining: 0 };
  const allPlans = state.allPlans ?? [];

  const statusBadge = (() => {
    if (sub?.is_comp) return ["Comp", "bg-purple-100 text-purple-700"];
    if (sub?.status === "active") return ["Active", "bg-emerald-100 text-emerald-700"];
    if (sub?.status === "trialing") return ["Trial", "bg-blue-100 text-blue-700"];
    if (sub?.status === "past_due") return ["Past due", "bg-amber-100 text-amber-700"];
    return null;
  })();

  return (
    <Shell>
      {/* Current plan */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 mb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-gray-100">
              <CreditCard className="h-4 w-4 text-gray-700" />
            </div>
            <h3 className="text-[16px] font-semibold text-gray-900">{state.planName} plan</h3>
            {statusBadge && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusBadge[1]}`}>
                {statusBadge[0]}
              </span>
            )}
          </div>
          {sub?.stripe_subscription_id && (
            <button
              onClick={openPortal}
              disabled={action === "portal"}
              className="flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-gray-900 border border-gray-200 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-40"
            >
              Manage subscription <ExternalLink className="h-3 w-3" />
            </button>
          )}
        </div>
        {sub?.current_period_end && (
          <p className="text-[12px] text-gray-500 mt-3 pt-3 border-t border-gray-100">
            {sub.cancel_at_period_end ? "Access ends" : "Renews"}{" "}
            {new Date(sub.current_period_end).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </p>
        )}
      </div>

      {/* Usage */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 mb-5 space-y-5">
        <UsageBar label="Ops this period" used={ops.used} included={ops.included} />
        <UsageBar label="Enrichments this period" used={enrich.used} included={enrich.included} />
        <p className="text-[12px] text-gray-400">
          Pure-tier pricing — no top-up packs or overage charges. Run out mid-month? Switch to a higher plan; it applies immediately.
        </p>
      </div>

      {/* Plans */}
      <div className="mb-2">
        <h3 className="text-[13px] font-semibold text-gray-900">Plans</h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {allPlans.map((p) => {
          const current = p.id === planId;
          return (
            <div
              key={p.id}
              className={`rounded-xl border p-4 flex flex-col gap-2.5 ${
                current ? "border-gray-900 bg-gray-50/50" : "border-gray-200 bg-white"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-gray-900">{p.name}</span>
                {current && (
                  <span className="text-[9px] uppercase tracking-wide text-gray-400 font-medium">Current</span>
                )}
              </div>
              <div className="text-[20px] font-bold text-gray-900 tabular-nums leading-none">
                ${p.monthlyPriceUsd}
                <span className="text-[12px] font-normal text-gray-400">/mo</span>
              </div>
              <ul className="text-[11px] text-gray-500 space-y-0.5">
                <li>{num(p.includedOpsPerMonth)} ops / mo</li>
                <li>{num(p.enrichmentsPerMonth)} enrichments / mo</li>
                <li>
                  {p.workspaceLimit === null
                    ? "Unlimited workspaces"
                    : `${p.workspaceLimit} workspace${p.workspaceLimit === 1 ? "" : "s"}`}
                </li>
              </ul>
              {!current && p.id !== "free" && (
                <button
                  onClick={() => subscribe(p.id)}
                  disabled={!!action}
                  className="mt-auto w-full h-8 rounded-lg bg-gray-900 text-white text-[12px] font-medium hover:bg-gray-800 transition-colors disabled:opacity-40"
                >
                  {action === `subscribe:${p.id}` ? "Loading…" : `Switch to ${p.name}`}
                </button>
              )}
              {!current && p.id === "free" && (
                <button
                  onClick={openPortal}
                  disabled={!!action}
                  className="mt-auto w-full h-8 rounded-lg border border-gray-200 text-gray-600 text-[12px] font-medium hover:text-gray-900 transition-colors disabled:opacity-40"
                >
                  Downgrade
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

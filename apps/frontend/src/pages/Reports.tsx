import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { FileBarChart } from "lucide-react";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

type ReportRow = {
  id: string;
  lead_list_id: string | null;
  provider: string | null;
  title: string;
  period_from: string | null;
  period_to: string | null;
  metrics_json: { totals?: Record<string, number> } | null;
  generated_at: string;
};

export default function Reports() {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [selected, setSelected] = useState<{ markdown: string; title: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !workspaceId) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${apiUrl}/api/reports?workspaceId=${workspaceId}`, { headers: { Authorization: `Bearer ${token}` } });
        const d = await res.json();
        setReports(d.reports || []);
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, [token, workspaceId]);

  const openReport = async (id: string) => {
    try {
      const res = await fetch(`${apiUrl}/api/reports/${id}?workspaceId=${workspaceId}`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json();
      if (d.report) setSelected({ markdown: d.report.markdown, title: d.report.title });
    } catch { /* ignore */ }
  };

  if (selected) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <button onClick={() => setSelected(null)} className="text-[13px] text-muted-foreground hover:text-foreground mb-4">← All reports</button>
        <h1 className="text-[20px] font-semibold mb-4">{selected.title}</h1>
        {/* Reports are markdown; rendered pre-wrapped for now (the agent reads the raw body). */}
        <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90" style={{ fontFamily: "inherit" }}>{selected.markdown}</pre>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-1">
        <FileBarChart className="h-5 w-5" />
        <h1 className="text-[22px] font-semibold">Reports</h1>
      </div>
      <p className="text-[13px] text-muted-foreground mb-6">
        Weekly campaign audits — the platform's totals married with Nous's resolved, signal-attributed intelligence.
      </p>
      {loading ? (
        <div className="text-[13px] text-muted-foreground">Loading…</div>
      ) : reports.length === 0 ? (
        <div className="text-[13px] text-muted-foreground/70">
          No reports yet. They generate automatically each week per active campaign (a lead list pushed to a sequencer).
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {reports.map(r => (
            <li key={r.id}>
              <button onClick={() => openReport(r.id)} className="w-full text-left rounded-lg border border-border/60 px-4 py-3 hover:bg-muted/40 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-medium">{r.title}</span>
                  <span className="text-[12px] text-muted-foreground">{new Date(r.generated_at).toLocaleDateString()}</span>
                </div>
                {r.metrics_json?.totals && (
                  <div className="text-[12px] text-muted-foreground mt-1">
                    reached {r.metrics_json.totals.reached ?? "—"} · replied {r.metrics_json.totals.replied ?? "—"} · meetings {r.metrics_json.totals.meetings ?? "—"}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

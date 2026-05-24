import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Upload, Download, FileText, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/ui/page-header";

// Clean a list — the cold-outbound dedup tool.
//
// Drop in any list of emails (CSV, paste, anything). We classify each one
// against the workspace's entire engagement history: net-new, already
// engaged, recently contacted, bounced, unsubscribed, or workspace-suppressed.
// Download a cleaned CSV containing only the safe-to-send addresses.
//
// This is what makes /v2/dedup visible in the product — same primitive,
// drag-and-drop UX.

const apiUrl = import.meta.env.VITE_API_URL ?? "";

type Status = "net_new" | "engaged" | "recent" | "bounced" | "unsubscribed" | "suppressed";
type Kind = "email" | "linkedin_url";

interface Classification {
  kind: Kind;
  value: string;
  /** @deprecated kept for back-compat with the v1 response shape */
  email?: string;
  status: Status;
  entity_id?: string;
  reason?: string | null;
}

interface Summary {
  net_new: number; engaged: number; recent: number;
  bounced: number; unsubscribed: number; suppressed: number;
  total: number;
}

const STATUS_META: Record<Status, { label: string; color: string; safe: boolean; help: string }> = {
  net_new:      { label: "Net new",       color: "#15803d", safe: true,  help: "no prior record — safe to send" },
  engaged:      { label: "Engaged",       color: "#1d4ed8", safe: false, help: "in an active conversation — don't cold-send" },
  recent:       { label: "Recently contacted", color: "#b45309", safe: false, help: "contacted in last 30 days — defer" },
  bounced:      { label: "Bounced",       color: "#b91c1c", safe: false, help: "last delivery bounced — skip" },
  unsubscribed: { label: "Unsubscribed",  color: "#b91c1c", safe: false, help: "opted out / do-not-contact" },
  suppressed:   { label: "Suppressed",    color: "#6b7280", safe: false, help: "workspace-level policy block" },
};

// Pull anything that looks like an email out of a blob (CSV cells, pasted text, headers, …).
function extractEmails(text: string): string[] {
  const re = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;
  const matches = text.match(re) ?? [];
  return Array.from(new Set(matches.map(e => e.toLowerCase())));
}

// Pull LinkedIn /in/<slug> URLs out of a blob. Apollo's preview shows these
// for free — pasting the preview straight in is the agency pre-flight unlock.
function extractLinkedInUrls(text: string): string[] {
  const re = /https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_\-%]+/gi;
  const matches = text.match(re) ?? [];
  return Array.from(new Set(matches.map(u =>
    u.toLowerCase()
      .replace(/^http:\/\//, "https://")
      .replace(/^https?:\/\/www\./, "https://")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, ""),
  )));
}

export default function CleanList() {
  const navigate = useNavigate();
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";

  const [emails, setEmails] = useState<string[]>([]);
  const [linkedinUrls, setLinkedinUrls] = useState<string[]>([]);
  const [paste, setPaste] = useState("");
  const [results, setResults] = useState<Classification[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const ingestText = useCallback((text: string, source?: string) => {
    setEmails(extractEmails(text));
    setLinkedinUrls(extractLinkedInUrls(text));
    setResults(null);
    setSummary(null);
    setError(null);
    if (source) setFileName(source);
  }, []);

  const onFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = e => ingestText(String(e.target?.result ?? ""), f.name);
    reader.readAsText(f);
  };

  const classify = async () => {
    if ((!emails.length && !linkedinUrls.length) || loading) return;
    setLoading(true);
    setError(null);
    try {
      // Batch the longer of the two lists in 10k chunks. The endpoint caps
      // each kind at 10k per call.
      const maxLen = Math.max(emails.length, linkedinUrls.length);
      const allResults: Classification[] = [];
      let agg: Summary = { net_new: 0, engaged: 0, recent: 0, bounced: 0, unsubscribed: 0, suppressed: 0, total: 0 };
      for (let i = 0; i < maxLen; i += 10_000) {
        const body = {
          workspaceId,
          emails:        emails.slice(i, i + 10_000),
          linkedin_urls: linkedinUrls.slice(i, i + 10_000),
        };
        const res = await fetch(`${apiUrl}/v2/dedup`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.message || errBody.error || `request failed (${res.status})`);
        }
        const { results: r, summary: s } = await res.json();
        allResults.push(...r);
        for (const k of Object.keys(agg) as (keyof Summary)[]) {
          agg[k] = (agg[k] || 0) + (s[k] || 0);
        }
      }
      setResults(allResults);
      setSummary(agg);
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const downloadCleaned = () => {
    if (!results) return;
    const safe = results.filter(r => STATUS_META[r.status].safe).map(r => r.value || r.email || "");
    const blob = new Blob([safe.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (fileName?.replace(/\.\w+$/, "") || "cleaned") + "-safe.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadFull = () => {
    if (!results) return;
    const lines = ["kind,value,status,reason", ...results.map(r =>
      `${r.kind},${r.value || r.email || ""},${r.status},"${(r.reason ?? "").replace(/"/g, '""')}"`,
    )];
    const blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (fileName?.replace(/\.\w+$/, "") || "cleaned") + "-full.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setEmails([]); setLinkedinUrls([]);
    setResults(null); setSummary(null); setError(null);
    setPaste(""); setFileName(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-8 py-7">
        <PageHeader
          title="Clean a list"
          subtitle="Cross-list dedup against your entire engagement history. Drop a list of emails — get back which are safe to cold-send and which are not."
          actions={
            <button
              onClick={() => navigate("/lists")}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Lists
            </button>
          }
        />

        {/* Upload / paste */}
        {!results && (
          <div className="space-y-4">
            <div
              className="rounded-xl border-2 border-dashed border-border bg-background px-8 py-12 text-center cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDrop={e => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
              onDragOver={e => e.preventDefault()}
            >
              <Upload className="h-6 w-6 mx-auto text-muted-foreground/60 mb-2" />
              <p className="text-[14px] text-foreground/80 font-medium">
                Drop a CSV here, or click to choose a file
              </p>
              <p className="text-[12px] text-muted-foreground mt-1">
                Any CSV with email addresses anywhere works. Up to 10,000 per batch.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,.tsv,text/*"
                onChange={e => onFile(e.target.files?.[0] ?? undefined)}
                className="hidden"
              />
            </div>

            <div className="text-center text-[12px] text-muted-foreground/70">— or paste a list —</div>

            <textarea
              value={paste}
              onChange={e => setPaste(e.target.value)}
              onBlur={() => paste.trim() && ingestText(paste, "pasted-list")}
              placeholder="alice@acme.com, https://linkedin.com/in/foo, bob@globex.io …"
              className="w-full h-32 rounded-xl border border-border bg-background px-4 py-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-foreground/40 font-mono resize-none"
            />

            {(emails.length > 0 || linkedinUrls.length > 0) && (
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[13px]">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-foreground">
                    {emails.length > 0 && `${emails.length.toLocaleString()} emails`}
                    {emails.length > 0 && linkedinUrls.length > 0 && " · "}
                    {linkedinUrls.length > 0 && `${linkedinUrls.length.toLocaleString()} LinkedIn URLs`}
                  </span>
                  {fileName && <span className="text-muted-foreground">from {fileName}</span>}
                </div>
                <button
                  onClick={classify}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40"
                >
                  {loading ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Classifying…</> : "Classify"}
                </button>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-[#b91c1c]/30 bg-[#b91c1c]/5 px-4 py-2.5 text-[13px] text-[#b91c1c]">
            {error}
          </div>
        )}

        {/* Results */}
        {results && summary && (
          <div className="space-y-4">

            {/* Summary tiles */}
            <div className="grid grid-cols-2 lg:grid-cols-7 gap-3">
              <div className="rounded-xl border border-border bg-background px-4 py-3.5 col-span-2 lg:col-span-1">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Total</div>
                <div className="text-[22px] font-semibold text-foreground tabular-nums mt-2 leading-none">{summary.total.toLocaleString()}</div>
              </div>
              {(Object.keys(STATUS_META) as Status[]).map(s => {
                const meta = STATUS_META[s];
                const n = summary[s];
                return (
                  <div key={s} className="rounded-xl border border-border bg-background px-4 py-3.5">
                    <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: meta.color }}>
                      {meta.label}
                    </div>
                    <div className="text-[22px] font-semibold tabular-nums mt-2 leading-none" style={{ color: meta.color }}>
                      {n.toLocaleString()}
                    </div>
                    <div className="text-[11px] text-muted-foreground/70 mt-1.5">{meta.help}</div>
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={downloadCleaned}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 transition-colors"
              >
                <Download className="h-3.5 w-3.5" /> Download safe list ({summary.net_new.toLocaleString()})
              </button>
              <button
                onClick={downloadFull}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors"
              >
                <Download className="h-3.5 w-3.5" /> Download full breakdown
              </button>
              <button
                onClick={reset}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-muted/50 transition-colors ml-auto"
              >
                <X className="h-3.5 w-3.5" /> Clean another list
              </button>
            </div>

            {/* Per-row breakdown */}
            <div className="rounded-xl border border-border bg-background overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/50 border-b border-border grid grid-cols-[80px_1fr_160px_1fr] gap-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                <span>Kind</span>
                <span>Identifier</span>
                <span>Status</span>
                <span>Reason / context</span>
              </div>
              <div className="divide-y divide-border/60 max-h-[600px] overflow-y-auto">
                {results.slice(0, 500).map((r, i) => {
                  const meta = STATUS_META[r.status];
                  const id = r.value || r.email || "";
                  return (
                    <div key={`${id}-${i}`} className="grid grid-cols-[80px_1fr_160px_1fr] gap-3 px-4 py-2 text-[12px]">
                      <span className="text-muted-foreground uppercase tracking-wide text-[11px]">
                        {r.kind === "linkedin_url" ? "linkedin" : "email"}
                      </span>
                      <span className="text-foreground/80 truncate font-mono">{id}</span>
                      <span className="font-semibold tabular-nums" style={{ color: meta.color }}>{meta.label}</span>
                      <span className="text-muted-foreground truncate">{r.reason || meta.help}</span>
                    </div>
                  );
                })}
                {results.length > 500 && (
                  <div className="px-4 py-3 text-[12px] text-muted-foreground/70 text-center">
                    Showing first 500 of {results.length.toLocaleString()} — download the full breakdown CSV above for everything.
                  </div>
                )}
              </div>
            </div>

            {/* How to integrate from outside */}
            <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70 mb-1.5">
                Use this from Apollo / Instantly / Lemlist / Zapier / curl
              </div>
              <pre className="text-[12px] text-foreground/80 font-mono bg-background border border-border rounded-md p-3 overflow-x-auto">{`# Apollo workflow: paste LinkedIn URLs from a free preview, BEFORE you pay
curl -X POST ${apiUrl || "https://api.opennous.cloud"}/v2/dedup \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "linkedin_urls": [
      "https://linkedin.com/in/alice",
      "https://linkedin.com/in/bob"
    ],
    "emails": [ "carol@initech.com" ]
  }'`}</pre>
              <p className="text-[12px] text-muted-foreground mt-2">
                Same answer, every channel. <button onClick={() => navigate("/keys")} className="underline hover:text-foreground">Get an API key →</button>
              </p>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

// Tiny X — local to avoid bringing a new lucide import for one icon.
function X({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

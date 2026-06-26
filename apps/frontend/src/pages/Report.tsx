import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { useAuth } from "@/contexts/AuthContext";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

// Standalone report page — opened in a new tab from the Reports list. Clean
// full-page markdown render of a campaign report (no app sidebar).
const MD = {
  h1: (p: any) => <h1 className="text-[26px] font-semibold tracking-tight mt-0 mb-4 text-foreground" {...p} />,
  h2: (p: any) => <h2 className="text-[18px] font-semibold mt-7 mb-2 text-foreground" {...p} />,
  h3: (p: any) => <h3 className="text-[15px] font-semibold mt-5 mb-1.5 text-foreground" {...p} />,
  h4: (p: any) => <h4 className="text-[13px] font-semibold mt-4 mb-1 text-foreground/90" {...p} />,
  p:  (p: any) => <p className="text-[14px] leading-relaxed text-foreground/85 my-2.5" {...p} />,
  ul: (p: any) => <ul className="list-disc pl-5 my-2.5 space-y-1 text-[14px] text-foreground/85" {...p} />,
  ol: (p: any) => <ol className="list-decimal pl-5 my-2.5 space-y-1 text-[14px] text-foreground/85" {...p} />,
  li: (p: any) => <li className="leading-relaxed" {...p} />,
  blockquote: (p: any) => <blockquote className="border-l-2 border-border pl-4 my-3 text-[14px] italic text-foreground/75" {...p} />,
  a:  (p: any) => <a className="text-[#0A66C2] hover:underline" target="_blank" rel="noopener noreferrer" {...p} />,
  code: (p: any) => <code className="rounded bg-muted px-1.5 py-0.5 text-[12.5px] font-mono text-foreground/90" {...p} />,
  strong: (p: any) => <strong className="font-semibold text-foreground" {...p} />,
  table: (p: any) => <table className="my-3 w-full text-[13px] border-collapse" {...p} />,
  th: (p: any) => <th className="border border-border/60 px-2.5 py-1.5 text-left font-semibold" {...p} />,
  td: (p: any) => <td className="border border-border/60 px-2.5 py-1.5" {...p} />,
  hr: () => <hr className="my-6 border-border/60" />,
};

export default function Report() {
  const { id } = useParams();
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !workspaceId || !id) return;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/reports/${id}?workspaceId=${workspaceId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const d = await res.json();
        setReport(d.report || null);
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, [id, token, workspaceId]);

  if (typeof document !== "undefined" && report) document.title = report.title || "Report";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-8 py-12">
        {loading ? (
          <div className="text-[13px] text-muted-foreground">Loading…</div>
        ) : !report ? (
          <div className="text-[13px] text-muted-foreground">Report not found.</div>
        ) : (
          <ReactMarkdown components={MD}>{report.markdown || ""}</ReactMarkdown>
        )}
      </div>
    </div>
  );
}

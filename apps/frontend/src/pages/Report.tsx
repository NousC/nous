import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

// No rendering, no styling, no design — just the raw file contents dumped into a
// bare <pre>, exactly as the agent wrote it. Reports are agent artifacts, not human
// documents. The only non-default applied is pre-wrap so long lines don't overflow.
// Clean raw-text view, styled to read like a served .txt file (llms.txt): a
// comfortable monospace, real padding, a readable measure — not a cramped <pre>.
const pre: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: "14px",
  lineHeight: 1.7,
  color: "#1a1a1a",
  maxWidth: "860px",
  margin: 0,
  padding: "40px 48px",
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

  if (loading) return <pre style={pre}>Loading…</pre>;
  if (!report) return <pre style={pre}>Report not found.</pre>;
  return <pre style={pre}>{report.markdown || ""}</pre>;
}

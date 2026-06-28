import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import MarkdownDoc from "@/components/MarkdownDoc";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

const msg: React.CSSProperties = { maxWidth: "880px", margin: "0 auto", padding: "48px 40px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: "14px", color: "#666" };

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

  if (loading) return <div style={msg}>Loading…</div>;
  if (!report) return <div style={msg}>Report not found.</div>;
  return <MarkdownDoc>{report.markdown || ""}</MarkdownDoc>;
}

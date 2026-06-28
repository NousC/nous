import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import MarkdownDoc from "@/components/MarkdownDoc";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

const msg: React.CSSProperties = { maxWidth: "880px", margin: "0 auto", padding: "48px 40px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: "14px", color: "#666" };

export default function Playbook() {
  const { id } = useParams();
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";
  const [pb, setPb] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !workspaceId || !id) return;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/playbooks/${id}?workspaceId=${workspaceId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const d = await res.json();
        setPb(d.playbook || null);
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, [id, token, workspaceId]);

  if (typeof document !== "undefined" && pb) document.title = pb.title || "Playbook";
  if (loading) return <div style={msg}>Loading…</div>;
  if (!pb) return <div style={msg}>Playbook not found.</div>;
  return <MarkdownDoc>{pb.body_md || ""}</MarkdownDoc>;
}

import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import MarkdownDoc from "@/components/MarkdownDoc";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

const msg: React.CSSProperties = { maxWidth: "880px", margin: "0 auto", padding: "48px 40px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: "14px", color: "#666" };

export default function Note() {
  const { id } = useParams();
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";
  const [note, setNote] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !workspaceId || !id) return;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/workspace/memories/${id}?workspaceId=${workspaceId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const d = await res.json();
        setNote(d.memory || null);
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, [id, token, workspaceId]);

  if (loading) return <div style={msg}>Loading…</div>;
  if (!note) return <div style={msg}>Note not found.</div>;
  return <MarkdownDoc>{note.content || ""}</MarkdownDoc>;
}

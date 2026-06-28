import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

// Exactly the browser's raw text/plain view (like opennous.cloud/llms.txt):
// default monospace at 13px, pure black, full width, 8px margin, literal markdown
// symbols. No rendering, no design — the content's structure is what reads clean.
const pre: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  overflowWrap: "break-word",
  fontFamily: "monospace",
  fontSize: "13px",
  color: "#000",
  margin: "8px",
  padding: 0,
};

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
  if (loading) return <pre style={pre}>Loading…</pre>;
  if (!pb) return <pre style={pre}>Playbook not found.</pre>;
  return <pre style={pre}>{pb.body_md || ""}</pre>;
}

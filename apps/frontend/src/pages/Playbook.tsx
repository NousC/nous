import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

// Raw source view of a playbook (the policy doc agents read). Styled to read like
// a served .txt file (llms.txt): a comfortable monospace, real padding, a readable
// measure — not a cramped <pre>. Same treatment as notes and reports.
const pre: React.CSSProperties = {
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: "14px",
  lineHeight: 1.7,
  color: "#1a1a1a",
  margin: 0,
  padding: "40px 48px",
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

import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { useAuth } from "@/contexts/AuthContext";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

// Standalone note page — opened in a new tab from a record's Notes tab. Renders the
// note's markdown as a clean full-page document (no app sidebar).
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

  const title = note?.metadata?.title || note?.category || "Note";
  if (typeof document !== "undefined" && note) document.title = title;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-8 py-12">
        {loading ? (
          <div className="text-[13px] text-muted-foreground">Loading…</div>
        ) : !note ? (
          <div className="text-[13px] text-muted-foreground">Note not found.</div>
        ) : (
          <ReactMarkdown
            components={{
              h1: (p) => <h1 className="text-[26px] font-semibold tracking-tight mt-0 mb-4 text-foreground" {...p} />,
              h2: (p) => <h2 className="text-[18px] font-semibold mt-7 mb-2 text-foreground" {...p} />,
              h3: (p) => <h3 className="text-[15px] font-semibold mt-5 mb-1.5 text-foreground" {...p} />,
              h4: (p) => <h4 className="text-[13px] font-semibold mt-4 mb-1 text-foreground/90" {...p} />,
              p:  (p) => <p className="text-[14px] leading-relaxed text-foreground/85 my-2.5" {...p} />,
              ul: (p) => <ul className="list-disc pl-5 my-2.5 space-y-1 text-[14px] text-foreground/85" {...p} />,
              ol: (p) => <ol className="list-decimal pl-5 my-2.5 space-y-1 text-[14px] text-foreground/85" {...p} />,
              li: (p) => <li className="leading-relaxed" {...p} />,
              blockquote: (p) => <blockquote className="border-l-2 border-border pl-4 my-3 text-[14px] italic text-foreground/75" {...p} />,
              a:  (p) => <a className="text-[#0A66C2] hover:underline" target="_blank" rel="noopener noreferrer" {...p} />,
              code: (p) => <code className="rounded bg-muted px-1.5 py-0.5 text-[12.5px] font-mono text-foreground/90" {...p} />,
              strong: (p) => <strong className="font-semibold text-foreground" {...p} />,
              hr: () => <hr className="my-6 border-border/60" />,
            }}
          >
            {note.content || ""}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}

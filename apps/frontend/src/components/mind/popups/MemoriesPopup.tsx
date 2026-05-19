import { useState, useRef } from "react";
import { format } from "date-fns";
import { X, FileText, Plus, RefreshCw } from "lucide-react";
import { PopupModal } from "../shared";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

interface MemoryFact {
  id: string;
  category: string;
  content: string;
  created_at: string;
}

interface Category { name: string; count: number; }

function MemoryUploadModal({ workspaceId, token, onClose, onDone }: {
  workspaceId: string; token: string; onClose: () => void; onDone: (count: number) => void;
}) {
  const [mode, setMode] = useState<"text" | "file">("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ added: number; updated: number; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const ingest = async () => {
    if (loading) return;
    setLoading(true); setResult(null);
    try {
      if (mode === "text") {
        if (!text.trim()) return;
        const res = await fetch(`${apiUrl}/api/workspace/memories/ingest`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ workspaceId, text: text.trim(), source: "manual" }),
        });
        if (!res.ok) throw new Error();
        const d = await res.json();
        setResult({ added: d.added || 0, updated: d.updated || 0, skipped: d.skipped || 0 });
        setText(""); onDone(d.added || 0);
      } else {
        if (!file) return;
        const form = new FormData();
        form.append("file", file); form.append("workspaceId", workspaceId);
        const res = await fetch(`${apiUrl}/api/workspace/memories/ingest-file`, {
          method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
        });
        if (!res.ok) throw new Error();
        const d = await res.json();
        setResult({ added: d.added || 0, updated: d.updated || 0, skipped: d.skipped || 0 });
        setFile(null); onDone(d.added || 0);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background border border-border shadow-2xl w-full mx-4" style={{ maxWidth: 460, fontFamily: "'JetBrains Mono',monospace" }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/40">
          <span className="text-[9px] text-muted-foreground/40 tracking-widest">NOUS / MIND / MEMORIES / UPLOAD</span>
          <button onClick={onClose} className="text-muted-foreground/40 hover:text-foreground/70 transition-colors"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="flex gap-2">
            {(["text", "file"] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`text-[10px] px-3 py-1 border transition-colors ${mode === m ? "border-violet-500/50 text-violet-400/80 bg-violet-500/8" : "border-border/40 text-muted-foreground/40 hover:border-border/70"}`}>
                {m === "text" ? "paste text" : "upload file"}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/35">Claude extracts facts and merges with existing memory.</p>

          {mode === "text" ? (
            <textarea value={text} onChange={e => setText(e.target.value)} rows={7}
              placeholder="Paste notes, emails, meeting transcripts…"
              className="w-full bg-muted/20 border border-border/40 text-[11px] text-foreground px-3 py-2 outline-none resize-none placeholder:text-muted-foreground/25 leading-relaxed focus:border-violet-500/40" />
          ) : (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
              onClick={() => fileRef.current?.click()}
              className={`flex flex-col items-center justify-center h-32 border border-dashed cursor-pointer transition-colors ${dragOver ? "border-violet-500/60 bg-violet-500/5" : "border-border/40 hover:border-border/70 hover:bg-muted/10"}`}>
              <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setFile(f); }} />
              {file ? (
                <div className="text-center">
                  <div className="text-[11px] text-foreground/70 truncate max-w-[200px]">{file.name}</div>
                  <div className="text-[9px] text-muted-foreground/35 mt-0.5">{(file.size / 1024).toFixed(0)} KB</div>
                  <button onClick={e => { e.stopPropagation(); setFile(null); }} className="text-[9px] text-muted-foreground/35 hover:text-muted-foreground/70 mt-1">remove</button>
                </div>
              ) : (
                <div className="text-center">
                  <FileText className="h-5 w-5 text-muted-foreground/25 mx-auto mb-2" />
                  <p className="text-[10px] text-muted-foreground/40">drop or <span className="text-violet-400/70">click to upload</span></p>
                  <p className="text-[9px] text-muted-foreground/25 mt-0.5">PDF, DOCX, TXT, MD</p>
                </div>
              )}
            </div>
          )}

          {result && (
            <div className="flex items-center gap-4 text-[10px]">
              <span className="text-emerald-500/70">{result.added} added</span>
              {result.updated > 0 && <span className="text-muted-foreground/50">{result.updated} updated</span>}
              {result.skipped > 0 && <span className="text-muted-foreground/30">{result.skipped} skipped</span>}
            </div>
          )}

          <button onClick={ingest} disabled={loading || (mode === "text" ? !text.trim() : !file)}
            className="w-full flex items-center justify-center gap-2 text-[11px] py-2 bg-violet-500/20 border border-violet-500/30 text-violet-400/80 hover:bg-violet-500/30 transition-colors disabled:opacity-30">
            {loading ? <><RefreshCw className="h-3 w-3 animate-spin" />extracting facts…</> : <><FileText className="h-3 w-3" />extract facts</>}
          </button>
        </div>
      </div>
    </div>
  );
}

interface Props {
  memories: MemoryFact[];
  categories: Category[];
  workspaceId: string;
  token: string;
  onClose: () => void;
}

export default function MemoriesPopup({ memories, categories, workspaceId, token, onClose }: Props) {
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const maxCount = categories[0]?.count ?? 1;
  const shown = memories.filter(m => {
    const matchCat = !activeCat || m.category === activeCat;
    const matchQ   = !q || m.content.toLowerCase().includes(q.toLowerCase());
    return matchCat && matchQ;
  });
  return (
    <>
      {showUpload && <MemoryUploadModal workspaceId={workspaceId} token={token} onClose={() => setShowUpload(false)} onDone={() => setShowUpload(false)} />}
      <PopupModal label="NOUS / MIND / MEMORIES" onClose={onClose}>
        <div className="border-b border-border/20 px-5 py-3 space-y-3">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="search facts..." autoFocus
            className="w-full bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/30 outline-none" />
          <div className="space-y-1.5">
            {categories.map(cat => (
              <button key={cat.name} onClick={() => setActiveCat(p => p === cat.name ? null : cat.name)}
                className={`w-full flex items-center gap-2 py-0.5 group transition-opacity ${activeCat && activeCat !== cat.name ? "opacity-25" : ""}`}>
                <span className={`text-[9px] w-20 text-left flex-shrink-0 capitalize transition-colors ${activeCat === cat.name ? "text-foreground/70" : "text-muted-foreground/50"}`}>{cat.name.toLowerCase()}</span>
                <div className="flex-1 h-0.5 bg-muted/30 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-500/50 rounded-full" style={{ width: `${(cat.count / maxCount) * 100}%` }} />
                </div>
                <span className="text-[9px] text-muted-foreground/40 w-8 text-right flex-shrink-0 tabular-nums">{cat.count}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="divide-y divide-border/10">
          {shown.slice(0, 50).map(m => (
            <div key={m.id} className="px-5 py-3">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-[8px] text-muted-foreground/30 tracking-widest capitalize">{m.category?.toLowerCase()}</span>
                <span className="text-[8px] text-muted-foreground/20">{format(new Date(m.created_at), "MMM d")}</span>
              </div>
              <div className="text-[10px] text-foreground/65 leading-relaxed">{m.content}</div>
            </div>
          ))}
          {shown.length === 0 && <div className="px-5 py-8 text-[11px] text-muted-foreground/30 text-center">no facts match</div>}
        </div>
        <div className="border-t border-border/20 px-5 py-2.5 flex-shrink-0 flex justify-between items-center text-[9px] text-muted-foreground/30">
          <span>{shown.length} of {memories.length} facts</span>
          <button onClick={() => setShowUpload(true)} className="flex items-center gap-1 hover:text-muted-foreground/60 transition-colors">
            upload memories <Plus className="h-2.5 w-2.5" />
          </button>
        </div>
      </PopupModal>
    </>
  );
}

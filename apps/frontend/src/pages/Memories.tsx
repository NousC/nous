import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  Brain, Bot, User, Globe, Search, Trash2, Pencil, Check, X,
  FileText, Upload, ChevronDown, ChevronRight, Zap, Plus,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Memory {
  id: string;
  category: string;
  content: string;
  source: "manual" | "agent" | "signal_extraction" | "api" | "mcp";
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  valid_from?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRESET_CATEGORIES = ["General", "Company", "Product", "Market", "ICP", "Team", "Pricing", "Competitors"];

function isAgentWritten(s: Memory["source"]) {
  return s === "agent" || s === "signal_extraction";
}

function sourceMeta(s: Memory["source"]) {
  if (s === "manual")              return { label: "You",    cls: "bg-gray-100 text-gray-500" };
  if (s === "signal_extraction")   return { label: "Signal", cls: "bg-blue-50 text-blue-500" };
  if (s === "agent")               return { label: "Agent",  cls: "bg-violet-50 text-violet-600" };
  return                                  { label: "API",    cls: "bg-emerald-50 text-emerald-600" };
}

function sourceIcon(s: Memory["source"]) {
  if (s === "manual")             return <User className="h-2.5 w-2.5" />;
  if (s === "signal_extraction")  return <Zap className="h-2.5 w-2.5" />;
  if (s === "agent")              return <Bot className="h-2.5 w-2.5" />;
  return                                 <Globe className="h-2.5 w-2.5" />;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7)  return `${diff}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type IngestResult = { added: number; updated: number; skipped: number };

// ─── SourceBadge ──────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: Memory["source"] }) {
  const { label, cls } = sourceMeta(source);
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium", cls)}>
      {sourceIcon(source)}{label}
    </span>
  );
}

// ─── Inline-editable fact row ─────────────────────────────────────────────────

function FactRow({ memory, token, apiUrl, onUpdated, onDeleted }: {
  memory: Memory; token: string; apiUrl: string;
  onUpdated: (m: Memory) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing]         = useState(false);
  const [editContent, setEditContent] = useState(memory.content);
  const [saving, setSaving]           = useState(false);
  const [confirmDelete, setConfirm]   = useState(false);

  const save = async () => {
    if (!editContent.trim() || saving || editContent.trim() === memory.content) {
      setEditing(false);
      setEditContent(memory.content);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/workspace/memories/${memory.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: editContent.trim() }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      onUpdated(data.memory);
      setEditing(false);
    } catch { setEditing(false); setEditContent(memory.content); }
    finally { setSaving(false); }
  };

  const del = async () => {
    try {
      await fetch(`${apiUrl}/api/workspace/memories/${memory.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      onDeleted(memory.id);
    } catch { /* silent */ }
  };

  if (confirmDelete) {
    return (
      <div className="flex items-center gap-2 px-3.5 py-2.5 bg-red-50/60 rounded-lg border border-red-100">
        <p className="flex-1 text-[12px] text-red-700">Remove this agent-learned fact?</p>
        <button onClick={del} className="px-2.5 py-1 bg-red-500 text-white text-[11px] font-medium rounded-md hover:bg-red-600 transition-colors">Remove</button>
        <button onClick={() => setConfirm(false)} className="px-2.5 py-1 bg-white border border-gray-200 text-gray-600 text-[11px] font-medium rounded-md hover:bg-gray-50 transition-colors">Cancel</button>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="flex items-start gap-2 px-3.5 py-2.5 bg-gray-50 rounded-lg border border-gray-200">
        <Input
          value={editContent}
          onChange={e => setEditContent(e.target.value)}
          className="flex-1 h-7 text-[13px] bg-white border-gray-200 rounded-md focus-visible:ring-1 focus-visible:ring-gray-300"
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); save(); }
            if (e.key === "Escape") { setEditContent(memory.content); setEditing(false); }
          }}
          autoFocus
        />
        <button onClick={save} disabled={saving} className="mt-0.5 p-1 rounded text-gray-400 hover:text-gray-900 transition-colors disabled:opacity-40">
          <Check className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => { setEditContent(memory.content); setEditing(false); }} className="mt-0.5 p-1 rounded text-gray-400 hover:text-gray-600 transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="group flex items-start gap-2 px-3.5 py-2.5 rounded-lg hover:bg-gray-50/80 transition-colors">
      <p
        className="flex-1 text-[13px] text-gray-800 leading-snug cursor-text"
        onClick={() => setEditing(true)}
        title="Click to edit"
      >
        {memory.content}
      </p>
      <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
        <SourceBadge source={memory.source} />
        <span className="text-[10px] text-gray-350 text-gray-400">{formatDate(memory.updated_at || memory.created_at)}</span>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
          <button
            onClick={() => setEditing(true)}
            className="p-1 rounded text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            onClick={() => isAgentWritten(memory.source) ? setConfirm(true) : del()}
            className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Quick-add input (bottom of each category file) ──────────────────────────

function QuickAdd({ category, token, apiUrl, workspaceId, onAdded }: {
  category: string; token: string; apiUrl: string; workspaceId: string;
  onAdded: (m: Memory) => void;
}) {
  const [value, setValue]   = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/workspace/memories`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, category, content: trimmed, source: "manual" }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      onAdded(data.memory);
      setValue("");
    } catch { /* silent */ }
    finally { setSaving(false); }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-100">
      <Plus className="h-3 w-3 text-gray-300 flex-shrink-0" />
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
        placeholder={`Write a fact about ${category}…`}
        className="flex-1 text-[12.5px] text-gray-700 placeholder:text-gray-300 bg-transparent outline-none"
        disabled={saving}
      />
      {value.trim() && (
        <button
          onClick={submit}
          disabled={saving}
          className="text-[11px] font-medium text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-40"
        >
          {saving ? "…" : "↵ Enter"}
        </button>
      )}
    </div>
  );
}

// ─── Category file section ────────────────────────────────────────────────────

function CategoryFile({ category, facts, token, apiUrl, workspaceId, onUpdated, onDeleted, onAdded }: {
  category: string;
  facts: Memory[];
  token: string;
  apiUrl: string;
  workspaceId: string;
  onUpdated: (m: Memory) => void;
  onDeleted: (id: string) => void;
  onAdded: (m: Memory) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      {/* File header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 bg-gray-50/70 hover:bg-gray-100/60 transition-colors text-left"
      >
        {open
          ? <ChevronDown className="h-3 w-3 text-gray-400 flex-shrink-0" />
          : <ChevronRight className="h-3 w-3 text-gray-400 flex-shrink-0" />
        }
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider flex-1">{category}</span>
        <span className="text-[11px] text-gray-400">{facts.length} {facts.length === 1 ? "fact" : "facts"}</span>
      </button>

      {open && (
        <>
          {/* Facts */}
          {facts.length > 0 && (
            <div className="divide-y divide-gray-50">
              {facts.map(m => (
                <FactRow
                  key={m.id}
                  memory={m}
                  token={token}
                  apiUrl={apiUrl}
                  onUpdated={onUpdated}
                  onDeleted={onDeleted}
                />
              ))}
            </div>
          )}

          {/* Quick-add input */}
          <QuickAdd
            category={category}
            token={token}
            apiUrl={apiUrl}
            workspaceId={workspaceId}
            onAdded={onAdded}
          />
        </>
      )}
    </div>
  );
}

// ─── Left panel ───────────────────────────────────────────────────────────────

function AddPanel({ token, apiUrl, workspaceId, onIngested }: {
  token: string; apiUrl: string; workspaceId: string;
  onIngested: (memories: Memory[]) => void;
}) {
  const [mode, setMode]                 = useState<"text" | "file">("text");
  const [text, setText]                 = useState("");
  const [selectedCategory, setCategory] = useState("General");
  const [loading, setLoading]           = useState(false);
  const [result, setResult]             = useState<IngestResult | null>(null);
  const [dragOver, setDragOver]         = useState(false);
  const [selectedFile, setFile]         = useState<File | null>(null);
  const fileInputRef                    = useRef<HTMLInputElement>(null);

  const reload = async () => {
    const res = await fetch(`${apiUrl}/api/workspace/memories?workspaceId=${workspaceId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const d = await res.json();
      onIngested(d.memories || []);
    }
  };

  const ingestText = async () => {
    if (!text.trim() || loading) return;
    setLoading(true); setResult(null);
    try {
      const res = await fetch(`${apiUrl}/api/workspace/memories/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, text: text.trim(), source: "manual", category: selectedCategory }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setResult({ added: d.added, updated: d.updated, skipped: d.skipped });
      setText(""); await reload();
    } catch { setResult(null); }
    finally { setLoading(false); }
  };

  const ingestFile = async (file: File) => {
    if (loading) return;
    setLoading(true); setResult(null);
    const form = new FormData();
    form.append("file", file);
    form.append("workspaceId", workspaceId);
    form.append("category", selectedCategory);
    try {
      const res = await fetch(`${apiUrl}/api/workspace/memories/ingest-file`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setResult({ added: d.added, updated: d.updated, skipped: d.skipped });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await reload();
    } catch { setResult(null); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="mb-5">
        <h2 className="text-[13px] font-semibold text-gray-900 mb-0.5">Add from text</h2>
        <p className="text-[12px] text-gray-400 leading-relaxed">
          Paste notes, emails, or docs — Claude extracts facts and merges with existing memory.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-1 p-0.5 bg-gray-100 rounded-lg mb-5 w-fit">
        {(["text", "file"] as const).map(m => (
          <button
            key={m}
            onClick={() => { setMode(m); setResult(null); }}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors",
              mode === m ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            {m === "text" ? <FileText className="h-3 w-3" /> : <Upload className="h-3 w-3" />}
            {m === "text" ? "Text" : "File"}
          </button>
        ))}
      </div>

      {/* Category */}
      <div className="mb-4">
        <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-2">Category hint</p>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors",
                selectedCategory === cat ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="flex-1 flex flex-col min-h-0 mb-4">
        {mode === "text" ? (
          <Textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Paste meeting notes, emails, research…"
            className="flex-1 resize-none text-[13px] bg-gray-50 border-gray-200 rounded-xl placeholder:text-gray-400 focus-visible:ring-1 focus-visible:ring-gray-300 min-h-[160px]"
          />
        ) : (
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex-1 flex flex-col items-center justify-center rounded-xl border-2 border-dashed cursor-pointer transition-colors min-h-[160px]",
              dragOver ? "border-gray-400 bg-gray-50" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50/60",
            )}
          >
            <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt,.md" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) setFile(f); }} />
            {selectedFile ? (
              <div className="text-center px-4">
                <div className="h-8 w-8 rounded-lg bg-gray-200 flex items-center justify-center mx-auto mb-2">
                  <FileText className="h-4 w-4 text-gray-600" />
                </div>
                <p className="text-[13px] font-medium text-gray-800 truncate max-w-[180px]">{selectedFile.name}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{(selectedFile.size / 1024).toFixed(0)} KB</p>
                <button onClick={e => { e.stopPropagation(); setFile(null); }} className="mt-2 text-[11px] text-gray-400 hover:text-gray-600 transition-colors">Remove</button>
              </div>
            ) : (
              <div className="text-center px-4">
                <div className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center mx-auto mb-2">
                  <Upload className="h-4 w-4 text-gray-400" />
                </div>
                <p className="text-[13px] text-gray-600 font-medium">Drop or click to upload</p>
                <p className="text-[11px] text-gray-400 mt-1">PDF, DOCX, TXT, MD</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="space-y-3">
        {result && (
          <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg">
            <span className="text-[12px] text-gray-900 font-medium">{result.added} added</span>
            {result.updated > 0 && <span className="text-[12px] text-gray-500">{result.updated} updated</span>}
            {result.skipped > 0 && <span className="text-[12px] text-gray-400">{result.skipped} skipped</span>}
          </div>
        )}
        <button
          onClick={() => mode === "text" ? ingestText() : selectedFile && ingestFile(selectedFile)}
          disabled={loading || (mode === "text" ? !text.trim() : !selectedFile)}
          className="w-full h-9 rounded-xl bg-gray-900 text-white text-[13px] font-medium hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <><span className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Extracting…</>
          ) : (
            <><FileText className="h-3.5 w-3.5" />Extract facts</>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Right panel ──────────────────────────────────────────────────────────────

function MemoryPanel({ memories, token, apiUrl, workspaceId, onUpdated, onDeleted, onAdded }: {
  memories: Memory[]; token: string; apiUrl: string; workspaceId: string;
  onUpdated: (m: Memory) => void;
  onDeleted: (id: string) => void;
  onAdded:   (m: Memory) => void;
}) {
  const [activeTab, setActiveTab] = useState("All");
  const [search, setSearch]       = useState("");

  const categories = [...new Set(memories.map(m => m.category))].sort();
  const tabs = ["All", ...categories];

  const filtered = memories.filter(m => {
    const matchTab = activeTab === "All" || m.category === activeTab;
    const matchSearch = !search.trim() || m.content.toLowerCase().includes(search.toLowerCase());
    return matchTab && matchSearch;
  });

  const grouped = filtered.reduce<Record<string, Memory[]>>((acc, m) => {
    (acc[m.category] ??= []).push(m);
    return acc;
  }, {});

  const catCounts = Object.entries(
    memories.reduce<Record<string, number>>((acc, m) => {
      acc[m.category] = (acc[m.category] || 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]);

  const maxCount = catCounts[0]?.[1] ?? 1;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Overview bar chart */}
      {memories.length > 0 && (
        <div className="flex-shrink-0 mb-5 p-4 bg-gray-50 rounded-xl border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Overview</p>
            <span className="text-[11px] text-gray-400">{memories.length} facts</span>
          </div>
          <div className="space-y-2">
            {catCounts.map(([cat, count]) => (
              <button
                key={cat}
                onClick={() => setActiveTab(cat)}
                className="w-full flex items-center gap-3 group/bar"
              >
                <span className="text-[11px] text-gray-500 w-20 flex-shrink-0 truncate text-left group-hover/bar:text-gray-800 transition-colors">{cat}</span>
                <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-gray-800 rounded-full transition-all duration-500" style={{ width: `${(count / maxCount) * 100}%` }} />
                </div>
                <span className="text-[11px] text-gray-400 w-5 text-right flex-shrink-0">{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="flex-shrink-0 mb-3 relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search facts…"
          className="pl-8 h-8 text-[13px] bg-white border-gray-200 rounded-lg focus-visible:ring-1 focus-visible:ring-gray-300 placeholder:text-gray-400"
        />
      </div>

      {/* Tabs */}
      <div className="flex-shrink-0 flex items-center gap-0 -mx-0.5 mb-4 overflow-x-auto scrollbar-none">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "flex-shrink-0 px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap mx-0.5",
              activeTab === tab ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-800 hover:bg-gray-100"
            )}
          >
            {tab}
            {tab !== "All" && (
              <span className={cn("ml-1", activeTab === tab ? "text-gray-400" : "text-gray-300")}>
                {memories.filter(m => m.category === tab).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Category files */}
      <div className="flex-1 overflow-auto min-h-0">
        {memories.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <Brain className="h-5 w-5 text-gray-400" />
            </div>
            <p className="text-[13px] font-medium text-gray-700 mb-1">No facts yet</p>
            <p className="text-[12px] text-gray-400">Paste text on the left, or write directly into a category below.</p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-[13px] text-gray-400 text-center py-8">No facts match your search.</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(grouped)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([category, facts]) => (
                <CategoryFile
                  key={category}
                  category={category}
                  facts={facts}
                  token={token}
                  apiUrl={apiUrl}
                  workspaceId={workspaceId}
                  onUpdated={onUpdated}
                  onDeleted={onDeleted}
                  onAdded={onAdded}
                />
              ))
            }
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Memories() {
  const { userData, session } = useAuth();
  const workspaceId = userData?.workspace?.id ?? "";
  const apiUrl      = import.meta.env.VITE_API_URL ?? "";
  const token       = session?.access_token ?? "";

  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading]   = useState(false);

  const fetchMemories = useCallback(async () => {
    if (!workspaceId || !token) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/workspace/memories?workspaceId=${workspaceId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setMemories(d.memories || []);
    } catch { setMemories([]); }
    finally { setLoading(false); }
  }, [workspaceId, token, apiUrl]);

  useEffect(() => { fetchMemories(); }, [fetchMemories]);

  const onUpdated = (m: Memory) => setMemories(prev => prev.map(p => p.id === m.id ? m : p));
  const onDeleted = (id: string) => setMemories(prev => prev.filter(m => m.id !== id));
  const onAdded   = (m: Memory) => setMemories(prev => [m, ...prev]);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex-shrink-0 px-8 pt-7 pb-5 border-b border-gray-100">
        <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight">Workspace Memory</h1>
        <p className="text-[12px] text-gray-400 mt-1">
          Patterns and intelligence that apply across your whole pipeline.
          Contact and company-specific facts live on their individual profiles.
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left — ingest panel */}
        <div className="w-[320px] flex-shrink-0 border-r border-gray-100 px-8 py-6 overflow-auto">
          <AddPanel token={token} apiUrl={apiUrl} workspaceId={workspaceId} onIngested={setMemories} />
        </div>

        {/* Right — memory files */}
        <div className="flex-1 min-w-0 px-8 py-6 overflow-auto flex flex-col">
          {loading ? (
            <div className="space-y-2 pt-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            <MemoryPanel
              memories={memories}
              token={token}
              apiUrl={apiUrl}
              workspaceId={workspaceId}
              onUpdated={onUpdated}
              onDeleted={onDeleted}
              onAdded={onAdded}
            />
          )}
        </div>
      </div>
    </div>
  );
}

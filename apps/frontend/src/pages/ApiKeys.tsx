import { useState, useEffect, useCallback } from "react";
import {
  Key, Plus, Copy, Trash2, CheckCircle2, ExternalLink, RotateCcw,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

interface ApiKey {
  id: string; name: string; key: string;
  created_at: string; last_used?: string;
}

function authH(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export default function ApiKeys() {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/workspace/api-keys?workspace_id=${encodeURIComponent(workspaceId)}`, { headers: authH(token) });
      const data = await res.json();
      setKeys(data.api_keys ?? data.apiKeys ?? []);
    } finally { setLoading(false); }
  }, [token, workspaceId]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!newName.trim() || !workspaceId) return;
    const res = await fetch(`${apiUrl}/api/workspace/api-keys`, {
      method: "POST",
      headers: { ...authH(token), "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), workspace_id: workspaceId }),
    });
    const data = await res.json();
    if (data.key) {
      setRevealed(data.key);
      setNewName(""); setShowForm(false); load();
    }
  };

  const revoke = async (id: string) => {
    await fetch(`${apiUrl}/api/workspace/api-keys/${id}?workspace_id=${encodeURIComponent(workspaceId)}`, { method: "DELETE", headers: authH(token) });
    setKeys(k => k.filter(x => x.id !== id));
  };

  const copy = (val: string, id: string) => {
    navigator.clipboard.writeText(val);
    setCopiedId(id); setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="p-8 max-w-3xl">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-[22px] font-bold text-gray-900 tracking-tight">API Keys</h2>
          <p className="text-[13px] text-gray-500 mt-1">Create and manage API keys for your workspace endpoints.</p>
        </div>

        {/* Actions row */}
        <div className="flex items-center gap-3 mb-6">
          <Button
            onClick={() => setShowForm(true)}
            disabled={showForm || !!revealed}
            className="bg-gray-900 text-white hover:bg-gray-800 h-8 text-[13px] px-3 rounded-lg"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Create new key
          </Button>
          <a
            href="/install"
            className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Installation guide
          </a>
        </div>

        {/* Revealed key banner */}
        {revealed && (
          <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> Key created — copy it now
            </div>
            <p className="text-[12px] text-emerald-600">This is the only time the full key is shown.</p>
            <div className="flex gap-2">
              <input value={revealed} readOnly
                className="flex-1 font-mono text-[12px] bg-white border border-emerald-200 rounded-lg px-3 py-2 text-gray-800 outline-none" />
              <button onClick={() => copy(revealed, "revealed")}
                className="px-3 py-2 rounded-lg bg-white border border-emerald-200 hover:bg-emerald-50">
                {copiedId === "revealed"
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  : <Copy className="h-4 w-4 text-gray-400" />}
              </button>
            </div>
            <button onClick={() => setRevealed(null)} className="text-[12px] text-emerald-600 hover:underline">Done</button>
          </div>
        )}

        {/* Create form */}
        {showForm && !revealed && (
          <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-2.5">
            <p className="text-[13px] font-medium text-gray-800">Name your key</p>
            <div className="flex gap-2">
              <Input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && create()}
                placeholder="e.g. Production, n8n, CRM sync"
                className="flex-1 bg-white h-9 text-[13px]" />
              <Button onClick={create} disabled={!newName.trim()}
                className="bg-gray-900 text-white hover:bg-gray-800 h-9 text-[13px]">Create</Button>
              <Button variant="ghost" onClick={() => { setShowForm(false); setNewName(""); }}
                className="h-9 text-[13px]">Cancel</Button>
            </div>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="space-y-px rounded-xl overflow-hidden border border-gray-100">
            {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-gray-50 animate-pulse" />)}
          </div>
        ) : keys.length === 0 && !showForm ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-14 text-center">
            <Key className="h-7 w-7 text-gray-300 mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-[13px] font-medium text-gray-600 mb-1">No API keys yet</p>
            <p className="text-[12px] text-gray-400">Create your first key to start making requests.</p>
          </div>
        ) : keys.length > 0 ? (
          <div className="rounded-xl border border-gray-100 overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[2fr_1.5fr_1.5fr_80px] gap-4 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
              {["Name", "API Key", "Last accessed", "Actions"].map(h => (
                <p key={h} className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{h}</p>
              ))}
            </div>
            {/* Rows */}
            {keys.map(k => (
              <div key={k.id}
                className="grid grid-cols-[2fr_1.5fr_1.5fr_80px] gap-4 items-center px-4 py-3.5 bg-white hover:bg-gray-50/60 border-b border-gray-50 last:border-0 transition-colors">
                <div>
                  <p className="text-[13px] font-semibold text-gray-900">{k.name}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Created {format(new Date(k.created_at), "MMM d, yyyy")}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[12px] text-gray-500 truncate">{k.key}</span>
                  <button onClick={() => copy(k.key, k.id)}
                    className="flex-shrink-0 p-1 rounded text-gray-300 hover:text-gray-600 transition-colors">
                    {copiedId === k.id
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <p className="text-[12px] text-gray-400">
                  {k.last_used ? format(new Date(k.last_used), "MMM d, yyyy") : "—"}
                </p>
                <div className="flex items-center gap-1.5">
                  <button title="Revoke & regenerate" onClick={() => revoke(k.id)}
                    className="p-1.5 rounded text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                  <button title="Delete" onClick={() => revoke(k.id)}
                    className="p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

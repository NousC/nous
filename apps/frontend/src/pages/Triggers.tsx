import { useState, useEffect, useCallback } from "react";
import {
  Zap, Plus, Copy, Trash2, CheckCircle2, RotateCcw, Power, ExternalLink,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";
import { PageHeader } from "@/components/ui/page-header";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

interface Trigger {
  id: string;
  workspace_id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

function authH(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function shortEvent(e: string) {
  return e.replace(/^interaction\./, "");
}

export default function Triggers() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";

  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [availableEvents, setAvailableEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // create form state
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/triggers`, { headers: authH(token) });
      const data = await res.json();
      setTriggers(data.triggers ?? []);
      setAvailableEvents(data.available_events ?? []);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const toggleEvent = (e: string) =>
    setNewEvents(curr => curr.includes(e) ? curr.filter(x => x !== e) : [...curr, e]);

  const resetForm = () => {
    setNewName(""); setNewUrl(""); setNewEvents([]); setCreateError(null); setShowForm(false);
  };

  const create = async () => {
    if (!newName.trim() || !newUrl.trim() || newEvents.length === 0) return;
    setCreateError(null);
    try {
      const res = await fetch(`${apiUrl}/api/triggers`, {
        method: "POST",
        headers: { ...authH(token), "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), url: newUrl.trim(), events: newEvents }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error ?? "create_failed");
        return;
      }
      if (data.signing_secret) setRevealedSecret(data.signing_secret);
      resetForm();
      load();
    } catch {
      setCreateError("network_error");
    }
  };

  const setActive = async (id: string, active: boolean) => {
    await fetch(`${apiUrl}/api/triggers/${id}`, {
      method: "PATCH",
      headers: { ...authH(token), "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    setTriggers(t => t.map(x => x.id === id ? { ...x, active } : x));
  };

  const rotateSecret = async (id: string) => {
    if (!confirm("Rotate the signing secret? The current secret will stop working immediately.")) return;
    const res = await fetch(`${apiUrl}/api/triggers/${id}`, {
      method: "PATCH",
      headers: { ...authH(token), "Content-Type": "application/json" },
      body: JSON.stringify({ rotate_secret: true }),
    });
    const data = await res.json();
    if (data.signing_secret) setRevealedSecret(data.signing_secret);
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this trigger? Outstanding undelivered events for it will be dropped.")) return;
    await fetch(`${apiUrl}/api/triggers/${id}`, { method: "DELETE", headers: authH(token) });
    setTriggers(t => t.filter(x => x.id !== id));
  };

  const copy = (val: string, id: string) => {
    navigator.clipboard.writeText(val);
    setCopiedId(id); setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="px-8 py-7">
        <PageHeader
          title="Triggers"
          subtitle="Outbound webhooks. Nous POSTs to your URL the moment a tracked interaction happens — no per-tool subscriptions, one unified stream."
        />

        {/* Actions row */}
        <div className="flex items-center gap-3 mb-6">
          <Button
            onClick={() => setShowForm(true)}
            disabled={showForm || !!revealedSecret}
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 text-[13px] px-3 rounded-lg"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" /> New trigger
          </Button>
          <a
            href="https://docs.opennous.cloud/public-api/triggers/introduction"
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Documentation
          </a>
        </div>

        {/* Revealed-secret banner */}
        {revealedSecret && (
          <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> Signing secret — copy it now
            </div>
            <p className="text-[12px] text-emerald-600">
              This is the only time the secret is shown. Use it to verify the <code className="font-mono">X-Nous-Signature</code> header on each incoming POST.
            </p>
            <div className="flex gap-2">
              <input value={revealedSecret} readOnly
                className="flex-1 font-mono text-[12px] bg-background border border-emerald-200 rounded-lg px-3 py-2 text-foreground outline-none" />
              <button onClick={() => copy(revealedSecret, "revealed")}
                className="px-3 py-2 rounded-lg bg-background border border-emerald-200 hover:bg-emerald-50">
                {copiedId === "revealed"
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  : <Copy className="h-4 w-4 text-muted-foreground/70" />}
              </button>
            </div>
            <button onClick={() => setRevealedSecret(null)} className="text-[12px] text-emerald-600 hover:underline">Done</button>
          </div>
        )}

        {/* Create form */}
        {showForm && !revealedSecret && (
          <div className="mb-5 rounded-xl border border-border bg-muted/50 p-4 space-y-3">
            <p className="text-[13px] font-medium text-foreground">New trigger</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Name (e.g. n8n — chase positive replies)"
                className="bg-background h-9 text-[13px]" />
              <Input value={newUrl} onChange={e => setNewUrl(e.target.value)}
                placeholder="https://your-receiver.example.com/hook"
                className="bg-background h-9 text-[13px]" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70 mb-2">Events</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {availableEvents.map(ev => (
                  <label key={ev} className="flex items-center gap-2 text-[13px] cursor-pointer">
                    <Checkbox checked={newEvents.includes(ev)} onCheckedChange={() => toggleEvent(ev)} />
                    <span className="font-mono text-[12px] text-muted-foreground">{ev}</span>
                  </label>
                ))}
              </div>
            </div>
            {createError && (
              <p className="text-[12px] text-red-500">{createError}</p>
            )}
            <div className="flex gap-2 pt-1">
              <Button onClick={create}
                disabled={!newName.trim() || !newUrl.trim() || newEvents.length === 0}
                className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 text-[13px]">
                Create
              </Button>
              <Button variant="ghost" onClick={resetForm} className="h-9 text-[13px]">Cancel</Button>
            </div>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="space-y-px rounded-xl overflow-hidden border border-border/60">
            {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted/50 animate-pulse" />)}
          </div>
        ) : triggers.length === 0 && !showForm ? (
          <div className="rounded-xl border border-dashed border-border py-14 text-center">
            <Zap className="h-7 w-7 text-muted-foreground/50 mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-[13px] font-medium text-foreground/80 mb-1">No triggers yet</p>
            <p className="text-[12px] text-muted-foreground/70">Create one to start receiving signed POSTs on interaction events.</p>
          </div>
        ) : triggers.length > 0 ? (
          <div className="rounded-xl border border-border/60 overflow-hidden">
            <div className="grid grid-cols-[1.5fr_2fr_1.5fr_140px] gap-4 px-4 py-2.5 bg-muted/50 border-b border-border/60">
              {["Name", "URL", "Events", "Actions"].map(h => (
                <p key={h} className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide">{h}</p>
              ))}
            </div>
            {triggers.map(t => (
              <div key={t.id}
                className="grid grid-cols-[1.5fr_2fr_1.5fr_140px] gap-4 items-center px-4 py-3.5 bg-background hover:bg-accent border-b border-border/60 last:border-0 transition-colors">
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[13px] font-semibold text-foreground">{t.name}</p>
                    {!t.active && (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded">paused</span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                    Created {format(new Date(t.created_at), "MMM d, yyyy")}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-mono text-[12px] text-muted-foreground truncate" title={t.url}>{t.url}</span>
                  <button onClick={() => copy(t.url, t.id)}
                    className="flex-shrink-0 p-1 rounded text-muted-foreground/50 hover:text-foreground/80 transition-colors">
                    {copiedId === t.id
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {t.events.map(ev => (
                    <span key={ev} title={ev}
                      className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {shortEvent(ev)}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <button title={t.active ? "Pause" : "Resume"} onClick={() => setActive(t.id, !t.active)}
                    className={`p-1.5 rounded transition-colors hover:bg-accent ${t.active ? "text-emerald-500" : "text-muted-foreground/50 hover:text-foreground/80"}`}>
                    <Power className="h-3.5 w-3.5" />
                  </button>
                  <button title="Rotate signing secret" onClick={() => rotateSecret(t.id)}
                    className="p-1.5 rounded text-muted-foreground/50 hover:text-foreground/80 hover:bg-accent transition-colors">
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                  <button title="Delete" onClick={() => remove(t.id)}
                    className="p-1.5 rounded text-muted-foreground/50 hover:text-red-500 hover:bg-red-50 transition-colors">
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

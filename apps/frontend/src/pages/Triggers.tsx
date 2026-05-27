import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Zap, Plus, Copy, Trash2, CheckCircle2, RotateCcw, Power, ExternalLink,
  Mail, Linkedin, Calendar, Link2, Check,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
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

interface EventDef {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
}

const EVENT_CATALOG: { group: string; items: EventDef[] }[] = [
  {
    group: "Email",
    items: [
      { id: "interaction.email_received", label: "Email received",
        description: "A reply landed in Instantly, Smartlead, EmailBison, Lemlist, or Gmail.",
        icon: Mail },
      { id: "interaction.email_bounced", label: "Email bounced",
        description: "A bounce or unsubscribe was reported by the sender.",
        icon: Mail },
    ],
  },
  {
    group: "LinkedIn",
    items: [
      { id: "interaction.linkedin_connection_accepted", label: "Connection accepted",
        description: "Someone accepted a connection request you sent.",
        icon: Linkedin },
      { id: "interaction.linkedin_message_received", label: "LinkedIn message received",
        description: "A reply or new message arrived through HeyReach or the direct LinkedIn integration.",
        icon: Linkedin },
    ],
  },
  {
    group: "Meetings",
    items: [
      { id: "interaction.meeting_scheduled", label: "Meeting scheduled",
        description: "A booking landed in Calendly or Cal.com.",
        icon: Calendar },
      { id: "interaction.meeting_held", label: "Meeting held",
        description: "Fireflies or Fathom recorded a meeting transcript.",
        icon: Calendar },
    ],
  },
];

function authH(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function eventDef(id: string): EventDef | undefined {
  for (const g of EVENT_CATALOG) for (const i of g.items) if (i.id === id) return i;
  return undefined;
}

// Pill mirroring the Webhooks page styling so the two pages feel like a set.
function StatusPill({ active }: { active: boolean }) {
  const cfg = active
    ? { dot: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", label: "Live" }
    : { dot: "bg-muted-foreground/40", text: "text-muted-foreground/80", bg: "bg-muted/40", border: "border-border", label: "Paused" };
  return (
    <span className={`flex-shrink-0 inline-flex items-center gap-1.5 h-7 px-2 rounded-md border ${cfg.bg} ${cfg.border} ${cfg.text} text-[11px] font-semibold`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

export default function Triggers() {
  const { session, userData } = useAuth();
  const token = session?.access_token ?? "";
  const workspaceId = userData?.workspace?.id ?? "";

  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [availableEvents, setAvailableEvents] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!token || !workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/triggers?workspace_id=${encodeURIComponent(workspaceId)}`,
        { headers: authH(token) },
      );
      const data = await res.json();
      setTriggers(data.triggers ?? []);
      setAvailableEvents(new Set(data.available_events ?? []));
    } finally {
      setLoading(false);
    }
  }, [token, workspaceId]);

  useEffect(() => { load(); }, [load]);

  const toggleEvent = (id: string) =>
    setNewEvents(curr => curr.includes(id) ? curr.filter(x => x !== id) : [...curr, id]);

  const resetForm = () => {
    setNewName(""); setNewUrl(""); setNewEvents([]); setCreateError(null); setSubmitting(false);
  };

  const openDialog = () => { resetForm(); setDialogOpen(true); };

  const validUrl = useMemo(() => {
    if (!newUrl.trim()) return false;
    try { const u = new URL(newUrl.trim()); return u.protocol === "https:" || u.protocol === "http:"; }
    catch { return false; }
  }, [newUrl]);

  const canCreate = newName.trim().length > 0 && validUrl && newEvents.length > 0 && !!workspaceId;

  const create = async () => {
    if (!canCreate) return;
    setCreateError(null); setSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/api/triggers?workspace_id=${encodeURIComponent(workspaceId)}`, {
        method: "POST",
        headers: { ...authH(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: newName.trim(),
          url: newUrl.trim(),
          events: newEvents,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data.error ?? "create_failed"); return; }
      if (data.signing_secret) setRevealedSecret(data.signing_secret);
      setDialogOpen(false);
      resetForm();
      load();
    } catch {
      setCreateError("network_error");
    } finally {
      setSubmitting(false);
    }
  };

  const setActive = async (id: string, active: boolean) => {
    await fetch(`${apiUrl}/api/triggers/${id}?workspace_id=${encodeURIComponent(workspaceId)}`, {
      method: "PATCH",
      headers: { ...authH(token), "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: workspaceId, active }),
    });
    setTriggers(t => t.map(x => x.id === id ? { ...x, active } : x));
  };

  const rotateSecret = async (id: string) => {
    if (!confirm("Rotate the signing secret? The current secret will stop working immediately.")) return;
    const res = await fetch(`${apiUrl}/api/triggers/${id}?workspace_id=${encodeURIComponent(workspaceId)}`, {
      method: "PATCH",
      headers: { ...authH(token), "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: workspaceId, rotate_secret: true }),
    });
    const data = await res.json();
    if (data.signing_secret) setRevealedSecret(data.signing_secret);
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this trigger? Outstanding undelivered events for it will be dropped.")) return;
    await fetch(`${apiUrl}/api/triggers/${id}?workspace_id=${encodeURIComponent(workspaceId)}`, {
      method: "DELETE", headers: authH(token),
    });
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
            onClick={openDialog}
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

        {/* Triggers list — Webhooks-style rows (full width, icon + content + status + actions) */}
        {loading ? (
          <div className="space-y-px rounded-xl overflow-hidden border border-border">
            {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted/50 animate-pulse" />)}
          </div>
        ) : triggers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-12 text-center">
            <Zap className="h-7 w-7 text-muted-foreground/50 mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-[13px] font-medium text-foreground/80 mb-1">No triggers yet</p>
            <p className="text-[12px] text-muted-foreground/70">Create one to start receiving signed POSTs on interaction events.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            {triggers.map(t => (
              <div key={t.id}
                className="flex items-center gap-3 px-4 py-3.5 bg-background hover:bg-accent border-b border-border/60 last:border-0 transition-colors">
                {/* Icon tile */}
                <div className="relative w-8 h-8 rounded-lg bg-muted/50 border border-border/60 flex items-center justify-center flex-shrink-0">
                  <Zap className="h-4 w-4 text-muted-foreground/70" strokeWidth={1.75} />
                </div>

                {/* Name + URL + events */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-semibold text-foreground truncate">{t.name}</p>
                    <span className="text-[11px] text-muted-foreground/60">
                      Created {format(new Date(t.created_at), "MMM d, yyyy")}
                    </span>
                  </div>
                  <p className="text-[12px] text-muted-foreground/70 font-mono truncate mt-0.5" title={t.url}>{t.url}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {t.events.map(ev => {
                      const def = eventDef(ev);
                      const Icon = def?.icon ?? Zap;
                      return (
                        <span key={ev} title={def?.description ?? ev}
                          className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-muted/60 border border-border/40 px-1.5 py-0.5 rounded">
                          <Icon className="h-3 w-3" strokeWidth={1.75} />
                          {def?.label ?? ev.replace(/^interaction\./, "")}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Status pill */}
                <StatusPill active={t.active} />

                {/* Actions */}
                <button onClick={() => copy(t.url, t.id)}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-background border border-border text-foreground/80 text-[13px] font-semibold hover:bg-accent transition-colors">
                  {copiedId === t.id
                    ? <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copied</>
                    : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                </button>
                <button title={t.active ? "Pause" : "Resume"} onClick={() => setActive(t.id, !t.active)}
                  className={`flex-shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-lg bg-background border border-border transition-colors hover:bg-muted/50 ${t.active ? "text-emerald-500" : "text-muted-foreground/60 hover:text-foreground"}`}>
                  <Power className="h-4 w-4" />
                </button>
                <button title="Rotate signing secret" onClick={() => rotateSecret(t.id)}
                  className="flex-shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-lg bg-background border border-border text-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors">
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button title="Delete" onClick={() => remove(t.id)}
                  className="flex-shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-lg bg-background border border-border text-muted-foreground/60 hover:text-red-500 hover:bg-red-50 hover:border-red-200 transition-colors">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New-trigger dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) resetForm(); setDialogOpen(o); }}>
        <DialogContent className="sm:max-w-[640px] p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b border-border/60 bg-muted/30 text-left">
            <DialogTitle className="text-[15px] font-semibold">New trigger</DialogTitle>
            <DialogDescription className="text-[12px] text-muted-foreground/80">
              Subscribe a URL to one or more interaction events. Nous signs each payload with HMAC-SHA256.
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
            {/* Name + URL */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground/80">Name</label>
                <Input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. n8n — chase positive replies"
                  className="bg-background h-10 text-[13px]" />
                <p className="text-[11px] text-muted-foreground/70">Shown in the table and in delivery logs.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground/80">Receiver URL</label>
                <div className="relative">
                  <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
                  <Input value={newUrl} onChange={e => setNewUrl(e.target.value)}
                    placeholder="https://your-receiver.example.com/hook"
                    className="bg-background h-10 text-[13px] pl-8 font-mono" />
                </div>
                <p className="text-[11px] text-muted-foreground/70">
                  {newUrl && !validUrl
                    ? <span className="text-amber-600">URL must include https:// (http accepted for local dev).</span>
                    : "Where Nous will POST signed payloads. HTTPS recommended."}
                </p>
              </div>
            </div>

            {/* Events */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <label className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground/80">Events</label>
                <p className="text-[11px] text-muted-foreground/70">
                  {newEvents.length > 0 ? `${newEvents.length} selected` : "Pick the events your workflow should react to"}
                </p>
              </div>

              <div className="rounded-lg border border-border/60 divide-y divide-border/60 bg-background">
                {EVENT_CATALOG.map(group => (
                  <div key={group.group}>
                    <div className="px-4 py-2 bg-muted/30">
                      <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/70">
                        {group.group}
                      </p>
                    </div>
                    {group.items.map(ev => {
                      const checked = newEvents.includes(ev.id);
                      const isAvailable = availableEvents.size === 0 || availableEvents.has(ev.id);
                      const Icon = ev.icon;
                      return (
                        <label key={ev.id}
                          className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-accent/40 ${checked ? "bg-primary/[0.03]" : ""} ${!isAvailable ? "opacity-40 cursor-not-allowed" : ""}`}>
                          <input type="checkbox" checked={checked} disabled={!isAvailable}
                            onChange={() => isAvailable && toggleEvent(ev.id)}
                            className="mt-0.5 h-4 w-4 rounded border-input text-primary focus:ring-primary focus:ring-offset-0" />
                          <Icon className="h-4 w-4 text-muted-foreground/70 mt-0.5 flex-shrink-0" strokeWidth={1.75} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2">
                              <p className="text-[13px] font-medium text-foreground">{ev.label}</p>
                              <code className="font-mono text-[10px] text-muted-foreground/60">{ev.id}</code>
                            </div>
                            <p className="text-[12px] text-muted-foreground/80 mt-0.5">{ev.description}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {createError && (
              <div className="text-[12px] text-red-500 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {createError}
              </div>
            )}
          </div>

          <DialogFooter className="px-6 py-3 border-t border-border/60 bg-muted/30 flex sm:justify-between items-center gap-2">
            <p className="text-[11px] text-muted-foreground/70 hidden sm:block">
              The signing secret will be shown once after you create.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setDialogOpen(false)} className="h-8 text-[13px]">Cancel</Button>
              <Button onClick={create} disabled={!canCreate || submitting}
                className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 text-[13px] px-3">
                {submitting ? "Creating…" : "Create trigger"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

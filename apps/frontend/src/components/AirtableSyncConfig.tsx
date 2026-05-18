import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, CheckCircle2, Plus, Trash2, ArrowRight, Download, Zap, RefreshCw } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const ACTIVITY_TRIGGERS = [
  { value: "linkedin_connected", label: "LinkedIn — connection accepted" },
  { value: "linkedin_message",   label: "LinkedIn — you sent a message" },
  { value: "linkedin_replied",   label: "LinkedIn — they replied" },
  { value: "proposal_sent",      label: "Proposal sent" },
  { value: "proposal_signed",    label: "Proposal signed" },
];

interface PushRule { trigger: string; column: string; value: string; }

function RuleValueInput({ field, value, onChange }: { field: any; value: string; onChange: (v: string) => void }) {
  if (field?.type === "checkbox") {
    return (
      <Select value={value || "true"} onValueChange={onChange}>
        <SelectTrigger className="h-7 text-xs w-28 border-dashed"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Checked ✓</SelectItem>
          <SelectItem value="false">Unchecked</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  return <Input className="h-7 text-xs w-28" placeholder="e.g. Connected" value={value} onChange={e => onChange(e.target.value)} />;
}

interface Props {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  connectionId: string;
  connectionName: string;
}

export default function AirtableSyncConfig({ open, onClose, workspaceId, connectionId, connectionName }: Props) {
  const { session } = useAuth();
  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";
  const h = { Authorization: `Bearer ${session?.access_token}` };

  const [step, setStep] = useState<"import" | "rules" | "done">("import");

  const [bases,  setBases]  = useState<any[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [selectedBase,  setSelectedBase]  = useState<any>(null);
  const [selectedTable, setSelectedTable] = useState<any>(null);
  const [emailCol,    setEmailCol]    = useState("");
  const [nameCol,     setNameCol]     = useState("");
  const [linkedinCol, setLinkedinCol] = useState("");
  const [sourceTag,   setSourceTag]   = useState("");

  const [pushRules, setPushRules] = useState<PushRule[]>([]);
  const [autoSync, setAutoSync] = useState(false);

  // Full field objects persisted across steps so type info is available in push rules
  const [tableCols, setTableCols] = useState<any[]>([]);
  const [loadingBases,  setLoadingBases]  = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [syncing,    setSyncing]    = useState(false);
  const [syncResult, setSyncResult] = useState<{ total: number; imported: number } | null>(null);
  const [existingConfig, setExistingConfig] = useState<any>(null);

  useEffect(() => {
    if (!open || !workspaceId || !session?.access_token) return;
    fetch(`${apiUrl}/api/airtable/sync-config?workspaceId=${workspaceId}`, { headers: h })
      .then(r => r.json())
      .then(d => {
        if (d.config) {
          const c = d.config;
          setExistingConfig(c);
          setSelectedBase({ id: c.base_id, name: c.base_name });
          setSelectedTable({ id: c.table_id, name: c.table_name, fields: [] });
          setEmailCol(c.field_mapping?.email || "");
          setNameCol(c.field_mapping?.full_name || c.field_mapping?.first_name || "");
          setLinkedinCol(c.field_mapping?.linkedin_url || "");
          setSourceTag(c.source_tag || "");
          setPushRules(c.push_rules || []);
          setAutoSync(c.auto_sync || false);
          setStep("done");
          // Eagerly fetch full table fields (with type + options) so push rules work immediately
          fetch(`${apiUrl}/api/workflow-providers/airtable/bases/${c.base_id}/tables?connection_id=${connectionId}`, { headers: h })
            .then(r => r.json())
            .then(td => {
              if (td.tables) {
                setTables(td.tables);
                const match = td.tables.find((t: any) => t.id === c.table_id);
                if (match) { setSelectedTable(match); setTableCols(match.fields || []); }
              }
            })
            .catch(() => {});
        } else {
          loadBases();
        }
      })
      .catch(() => loadBases());
  }, [open, workspaceId]);

  const loadBases = async () => {
    setLoadingBases(true);
    setSelectedBase(null); setSelectedTable(null); setTables([]); setTableCols([]);
    setEmailCol(""); setNameCol(""); setLinkedinCol("");
    try {
      const r = await fetch(`${apiUrl}/api/workflow-providers/airtable/bases?connection_id=${connectionId}`, { headers: h });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setBases(d.bases || []);
      setStep("import");
    } catch (e: any) { toast.error(e.message || "Could not load bases"); }
    finally { setLoadingBases(false); }
  };

  const loadTables = async (baseId: string) => {
    setLoadingTables(true);
    try {
      const r = await fetch(`${apiUrl}/api/workflow-providers/airtable/bases/${baseId}/tables?connection_id=${connectionId}`, { headers: h });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setTables(d.tables || []);
    } catch (e: any) { toast.error(e.message || "Could not load tables"); }
    finally { setLoadingTables(false); }
  };

  // Full field objects — uses live table fields if available, falls back to persisted
  const cols: any[] = selectedTable?.fields?.length ? selectedTable.fields : tableCols;

  const handleSave = async (andSync = false) => {
    if (!selectedBase || !selectedTable || !(emailCol || linkedinCol)) {
      toast.error("Select a table and map Email or LinkedIn URL");
      return;
    }
    setSaving(true);
    try {
      const fieldMapping: Record<string, string> = {};
      if (emailCol) fieldMapping.email = emailCol;
      if (nameCol) fieldMapping.full_name = nameCol;
      if (linkedinCol) fieldMapping.linkedin_url = linkedinCol;

      const r = await fetch(`${apiUrl}/api/airtable/sync-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...h },
        body: JSON.stringify({
          workspaceId, connectionId,
          baseId: selectedBase.id, baseName: selectedBase.name,
          tableId: selectedTable.id, tableName: selectedTable.name,
          fieldMapping, pushRules,
          sourceTag: sourceTag.trim() || null,
          autoSync,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to save");
      setExistingConfig(d.config);
      toast.success("Saved!");
      if (andSync) { setSaving(false); await handleSyncNow(); return; }
      setStep("done");
    } catch (e: any) { toast.error(e.message || "Failed"); }
    finally { setSaving(false); }
  };

  const handleSyncNow = async () => {
    setSyncing(true); setSyncResult(null);
    try {
      const r = await fetch(`${apiUrl}/api/airtable/sync-now`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...h },
        body: JSON.stringify({ workspaceId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Sync failed");
      setSyncResult({ total: d.total, imported: d.imported });
      setStep("done");
      toast.success(`Imported ${d.imported} contacts`);
    } catch (e: any) { toast.error(e.message || "Sync failed"); }
    finally { setSyncing(false); }
  };

  const addRule    = () => setPushRules(prev => [...prev, { trigger: "", column: "", value: "" }]);
  const updateRule = (i: number, f: keyof PushRule, val: string) =>
    setPushRules(prev => prev.map((r, idx) => idx === i ? { ...r, [f]: val } : r));
  const removeRule = (i: number) => setPushRules(prev => prev.filter((_, idx) => idx !== i));

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="max-w-md max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <img src="/provider-logos/airtable.svg" alt="Airtable" className="h-4 w-auto" />
            Airtable
          </DialogTitle>
        </DialogHeader>

        {/* ── DONE state ── */}
        {step === "done" && (
          <div className="space-y-3 mt-2">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-start gap-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-semibold text-emerald-800">
                  {selectedBase?.name || existingConfig?.base_name} → {selectedTable?.name || existingConfig?.table_name}
                </p>
                {(existingConfig?.source_tag || sourceTag) && (
                  <span className="inline-block mt-1 text-[11px] bg-emerald-200 text-emerald-800 rounded-full px-2 py-0.5">
                    {existingConfig?.source_tag || sourceTag}
                  </span>
                )}
                {existingConfig?.push_rules?.length > 0 && (
                  <p className="text-[11px] text-emerald-600 mt-1">
                    {existingConfig.push_rules.length} auto-push rule{existingConfig.push_rules.length !== 1 ? "s" : ""} active
                  </p>
                )}
                {syncResult && <p className="text-[11px] text-emerald-600 mt-1">{syncResult.imported} contacts imported</p>}
              </div>
            </div>
            {/* Auto-sync toggle */}
            <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
              <div>
                <p className="text-[12px] font-medium text-gray-700">Auto-sync daily</p>
                <p className="text-[11px] text-gray-400">Nous pulls updates from Airtable every 24 h</p>
              </div>
              <Switch
                checked={autoSync}
                onCheckedChange={async (val) => {
                  setAutoSync(val);
                  await fetch(`${apiUrl}/api/airtable/sync-config`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...h },
                    body: JSON.stringify({
                      workspaceId, connectionId,
                      baseId: existingConfig?.base_id, baseName: existingConfig?.base_name,
                      tableId: existingConfig?.table_id, tableName: existingConfig?.table_name,
                      fieldMapping: existingConfig?.field_mapping, pushRules: existingConfig?.push_rules || [],
                      sourceTag: existingConfig?.source_tag || null,
                      autoSync: val,
                    }),
                  });
                  toast.success(val ? "Auto-sync enabled" : "Auto-sync disabled");
                }}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="text-xs flex-1" disabled={syncing} onClick={handleSyncNow}>
                {syncing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
                {syncing ? "Importing…" : "Import contacts"}
              </Button>
              <Button variant="ghost" size="sm" className="text-xs text-gray-400"
                onClick={() => { setExistingConfig(null); setSyncResult(null); loadBases(); }}>
                Reconfigure
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 1: Import ── */}
        {step === "import" && (
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <p className="text-[12px] font-semibold text-gray-600 uppercase tracking-wide">1 — Pick your table</p>
              {loadingBases
                ? <div className="flex items-center gap-2 text-gray-400 text-xs py-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…</div>
                : <Select value={selectedBase?.id || ""} onValueChange={id => {
                    const b = bases.find(b => b.id === id);
                    setSelectedBase(b); setSelectedTable(null); setEmailCol(""); setNameCol(""); setLinkedinCol(""); setTableCols([]);
                    loadTables(id);
                  }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose a base…" /></SelectTrigger>
                    <SelectContent>{bases.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                  </Select>
              }
              {selectedBase && (
                loadingTables
                  ? <div className="flex items-center gap-2 text-gray-400 text-xs py-1"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading tables…</div>
                  : <Select value={selectedTable?.id || ""} onValueChange={id => {
                      const t = tables.find(t => t.id === id);
                      setSelectedTable(t); setEmailCol(""); setNameCol(""); setLinkedinCol("");
                      setTableCols(t?.fields || []);
                    }}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose a table…" /></SelectTrigger>
                      <SelectContent>{tables.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                    </Select>
              )}
            </div>

            {selectedTable && cols.length > 0 && (
              <div className="space-y-2">
                <p className="text-[12px] font-semibold text-gray-600 uppercase tracking-wide">2 — Map columns</p>
                <p className="text-[11px] text-gray-400">
                  Map Email <span className="font-medium text-gray-600">or</span> LinkedIn URL — at least one is required.
                </p>
                {[
                  { key: "email",    label: "Email",        state: emailCol,    set: setEmailCol },
                  { key: "name",     label: "Name",         state: nameCol,     set: setNameCol },
                  { key: "linkedin", label: "LinkedIn URL", state: linkedinCol, set: setLinkedinCol },
                ].map(({ key, label, state, set }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className={cn("w-24 shrink-0 text-[12px]",
                      (key === "email" || key === "linkedin") ? "font-semibold text-gray-800" : "text-gray-500"
                    )}>
                      {label}
                      {(key === "email" || key === "linkedin") && <span className="text-amber-400 ml-0.5">*</span>}
                    </span>
                    <ArrowRight className="h-3 w-3 text-gray-300 shrink-0" />
                    <Select value={state || "__none__"} onValueChange={v => set(v === "__none__" ? "" : v)}>
                      <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="— skip —" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— skip —</SelectItem>
                        {cols.map((c: any) => <SelectItem key={c.id || c.name} value={c.name}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                {!(emailCol || linkedinCol) && (
                  <p className="text-[11px] text-amber-600 pl-0.5">Map at least Email or LinkedIn URL to continue.</p>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <span className="w-24 shrink-0 text-[12px] text-gray-500">Segment label</span>
                  <ArrowRight className="h-3 w-3 text-gray-300 shrink-0" />
                  <Input className="h-7 text-xs flex-1" placeholder="e.g. LinkedIn Prospects"
                    value={sourceTag} onChange={e => setSourceTag(e.target.value)} />
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button size="sm" className="text-xs flex-1" variant="outline"
                disabled={!selectedTable || !(emailCol || linkedinCol) || saving}
                onClick={() => handleSave(false)}>
                Save only
              </Button>
              <Button size="sm" className="text-xs flex-1"
                disabled={!selectedTable || !(emailCol || linkedinCol) || saving || syncing}
                onClick={() => handleSave(true)}>
                {(saving || syncing) ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
                Save & import now
              </Button>
            </div>
            <button className="text-[12px] text-blue-500 hover:underline w-full text-center"
              onClick={() => setStep("rules")}>
              + Set up auto-push rules →
            </button>
          </div>
        )}

        {/* ── STEP 2: Push rules ── */}
        {step === "rules" && (
          <div className="space-y-4 mt-2">
            <p className="text-[11px] text-gray-400">
              When an activity happens → set a column in your Airtable to a value.
            </p>

            <div className="space-y-2">
              {pushRules.map((rule, i) => {
                const field = cols.find((c: any) => c.name === rule.column);
                return (
                  <div key={i} className="rounded-lg border border-gray-100 bg-gray-50/60 p-3 space-y-2">
                    {/* Trigger row */}
                    <div className="flex items-center gap-2">
                      <Zap className="h-3 w-3 text-amber-400 shrink-0" />
                      <Select value={rule.trigger || "__none__"} onValueChange={v => updateRule(i, "trigger", v === "__none__" ? "" : v)}>
                        <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="When this happens…" /></SelectTrigger>
                        <SelectContent>
                          {ACTIVITY_TRIGGERS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <button onClick={() => removeRule(i)} className="text-gray-300 hover:text-red-400 shrink-0 ml-auto">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {/* Action row */}
                    <div className="flex items-center gap-2 pl-5">
                      <span className="text-[11px] text-gray-400 shrink-0 w-6">set</span>
                      {cols.length > 0
                        ? <Select value={rule.column || "__none__"} onValueChange={v => {
                            updateRule(i, "column", v === "__none__" ? "" : v);
                            updateRule(i, "value", "");
                          }}>
                            <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Column…" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">— pick column —</SelectItem>
                              {cols.map((c: any) => <SelectItem key={c.id || c.name} value={c.name}>{c.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        : <Input className="h-7 text-xs flex-1" placeholder="Column name"
                            value={rule.column} onChange={e => updateRule(i, "column", e.target.value)} />
                      }
                      <span className="text-[11px] text-gray-400 shrink-0">→</span>
                      <RuleValueInput field={field} value={rule.value} onChange={v => updateRule(i, "value", v)} />
                    </div>
                  </div>
                );
              })}
              <button onClick={addRule} className="flex items-center gap-1.5 text-[12px] text-blue-500 hover:underline pt-0.5">
                <Plus className="h-3.5 w-3.5" /> Add rule
              </button>
            </div>

            <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
              <Button variant="ghost" size="sm" className="text-xs text-gray-400 px-0" onClick={() => setStep("import")}>← Back</Button>
              <div className="flex-1" />
              <Button size="sm" className="text-xs" disabled={saving} onClick={() => handleSave(false)}>
                {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Save rules
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

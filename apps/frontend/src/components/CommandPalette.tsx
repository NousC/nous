import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const apiUrl = import.meta.env.VITE_API_URL ?? "";

interface Item {
  id: string;
  label: string;
  sublabel?: string;
  group: string;
  action: () => void;
}

// Items with popup: undefined navigate; items with popup: string fire a custom event
// that Mind.tsx listens for to open the correct popover.
const NAV_ITEMS = [
  { id: "mind",         label: "Mind",         sublabel: "Knowledge graph",     path: "/",           popup: undefined },
  { id: "people",       label: "People",       sublabel: "Contacts & profiles", path: undefined,     popup: "people" },
  { id: "companies",    label: "Companies",    sublabel: "Company records",      path: undefined,     popup: "companies" },
  { id: "integrations", label: "Integrations", sublabel: "Connected services",   path: undefined,     popup: "integrations" },
  { id: "memories",     label: "Memories",     sublabel: "Agent memory store",   path: undefined,     popup: "memories" },
  { id: "settings",     label: "Settings",     sublabel: "Workspace & billing",  path: undefined,     popup: "settings" },
  { id: "operations",   label: "Operations",   sublabel: "Live op log",          path: "/operations", popup: undefined },
  { id: "developer",    label: "Developer",    sublabel: "API keys & docs",      path: "/developer",  popup: undefined },
];

export function CommandPalette() {
  const { session, userData } = useAuth();
  const navigate  = useNavigate();
  const [open,    setOpen]    = useState(false);
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState<Item[]>([]);
  const [idx,     setIdx]     = useState(0);
  const inputRef  = useRef<HTMLInputElement>(null);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Global ⌘K / Ctrl+K listener
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Build results whenever query changes
  const buildResults = useCallback((q: string, contacts: any[]) => {
    const lq = q.toLowerCase();

    const openPopup = (popup: string) => {
      window.dispatchEvent(new CustomEvent("nous:open-popup", { detail: popup }));
      setOpen(false);
    };

    const navItems: Item[] = NAV_ITEMS
      .filter(n => !q || n.label.toLowerCase().includes(lq) || (n.sublabel ?? "").toLowerCase().includes(lq))
      .map(n => ({
        id: n.id, label: n.label, sublabel: n.sublabel, group: "Navigate",
        action: () => {
          if (n.popup) { openPopup(n.popup); }
          else { navigate(n.path!); setOpen(false); }
        },
      }));

    const contactItems: Item[] = contacts.map((c: any) => ({
      id:       c.id,
      label:    [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "—",
      sublabel: c.job_title ?? c.email ?? undefined,
      group:    "People",
      action:   () => { openPopup("people"); },
    }));

    const all = [...navItems, ...contactItems];
    setResults(all);
    setIdx(0);
  }, [navigate]);

  useEffect(() => {
    if (!open) return;
    if (searchRef.current) clearTimeout(searchRef.current);

    if (!query.trim()) {
      buildResults("", []);
      return;
    }

    searchRef.current = setTimeout(async () => {
      let contacts: any[] = [];
      try {
        const workspaceId = userData?.workspace?.id;
        const token = session?.access_token;
        if (workspaceId && token) {
          const res = await fetch(
            `${apiUrl}/api/contacts?workspaceId=${workspaceId}&search=${encodeURIComponent(query)}&limit=8`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (res.ok) {
            const data = await res.json();
            contacts = data.contacts ?? [];
          }
        }
      } catch { /* silent */ }
      buildResults(query, contacts);
    }, 160);
  }, [query, open, buildResults, session, userData]);

  // Keyboard nav inside palette
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    if (e.key === "Enter")     { e.preventDefault(); results[idx]?.action(); }
    if (e.key === "Escape")    { setOpen(false); }
  };

  if (!open) return null;

  // Group results
  const groups: Record<string, Item[]> = {};
  for (const item of results) {
    if (!groups[item.group]) groups[item.group] = [];
    groups[item.group].push(item);
  }

  let flatIdx = 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] bg-black/50 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-[580px] mx-4 bg-background border border-border shadow-2xl overflow-hidden"
        style={{ fontFamily: "'JetBrains Mono','Consolas',monospace" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40">
          <span className="text-muted-foreground/40 text-[11px] tracking-widest flex-shrink-0">⌘K</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="jump to anything..."
            className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/40 outline-none"
          />
          <kbd className="text-[10px] text-muted-foreground/30 border border-border/30 px-1.5 py-0.5 rounded">esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[400px] overflow-y-auto">
          {results.length === 0 && (
            <div className="px-4 py-6 text-[11px] text-muted-foreground/40 text-center">
              {query ? "no results" : "type to search..."}
            </div>
          )}
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <div className="px-4 py-2 text-[9px] text-muted-foreground/40 tracking-widest border-b border-border/20 bg-muted/5">
                {group.toUpperCase()}
              </div>
              {items.map(item => {
                const isSelected = flatIdx++ === idx;
                return (
                  <button
                    key={item.id}
                    className={`w-full flex items-baseline gap-3 px-4 py-2.5 text-left transition-colors border-b border-border/10 ${
                      isSelected ? "bg-muted/40 text-foreground" : "text-foreground/80 hover:bg-muted/20"
                    }`}
                    onClick={item.action}
                    onMouseEnter={() => setIdx(results.indexOf(item))}
                  >
                    <span className="text-[12px] flex-shrink-0">{item.label}</span>
                    {item.sublabel && (
                      <span className="text-[10px] text-muted-foreground/50 truncate">{item.sublabel}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border/20 flex items-center gap-4 text-[9px] text-muted-foreground/30">
          <span><kbd className="border border-border/30 px-1 py-0.5 rounded">↑↓</kbd> navigate</span>
          <span><kbd className="border border-border/30 px-1 py-0.5 rounded">↵</kbd> select</span>
          <span><kbd className="border border-border/30 px-1 py-0.5 rounded">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

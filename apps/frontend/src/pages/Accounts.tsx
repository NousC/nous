// Unified "Accounts" page — one page for People + Companies, switched by a
// segmented toggle that sits next to the search bar. Each table (with its detail
// panel, stages, export/import) is the existing self-contained page rendered in
// `embedded` mode; this wrapper only owns the People/Companies switch.
import { useSearchParams } from "react-router-dom";
import People from "./People";
import Companies from "./Companies";

export default function Accounts() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "companies" ? "companies" : "people";
  const setTab = (t: "people" | "companies") =>
    setParams(t === "people" ? {} : { tab: t }, { replace: true });

  const toggle = (
    <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5 flex-shrink-0">
      {(["people", "companies"] as const).map(t => (
        <button key={t} onClick={() => setTab(t)}
          className={`text-[13px] font-medium px-3 py-1.5 rounded-md capitalize transition-colors ${
            tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}>
          {t}
        </button>
      ))}
    </div>
  );

  return tab === "companies"
    ? <Companies embedded leadingTab={toggle} />
    : <People embedded leadingTab={toggle} />;
}

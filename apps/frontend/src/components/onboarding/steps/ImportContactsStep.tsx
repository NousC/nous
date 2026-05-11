import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/sonner";

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));

  return lines
    .slice(1)
    .filter((line) => line.trim())
    .map((line) => {
      const values: string[] = [];
      let current = "";
      let inQuotes = false;

      for (const ch of line) {
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if (ch === "," && !inQuotes) {
          values.push(current.trim().replace(/^"|"$/g, ""));
          current = "";
        } else {
          current += ch;
        }
      }
      values.push(current.trim().replace(/^"|"$/g, ""));

      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = values[i] || "";
      });
      return row;
    });
}

function normalizeRow(raw: Record<string, string>): Record<string, string> {
  const get = (...keys: string[]) =>
    keys.map((k) => raw[k]).find((v) => v) || "";

  return {
    email: get("email", "email address", "e-mail"),
    first_name: get("first_name", "firstname", "first name", "given name"),
    last_name: get("last_name", "lastname", "last name", "surname"),
    company: get("company", "company name", "organization", "account"),
    job_title: get("job_title", "title", "position", "role"),
    phone: get("phone", "phone number", "mobile", "telephone"),
    linkedin_url: get("linkedin_url", "linkedin", "linkedin profile"),
    domain: get("domain", "website", "company domain"),
  };
}

interface ImportContactsStepProps {
  onNext: () => void;
  onSkip: () => void;
}

export function ImportContactsStep({ onNext, onSkip }: ImportContactsStepProps) {
  const { session, userData } = useAuth();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const apiUrl = import.meta.env.VITE_API_URL ?? "";

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please upload a CSV file");
      return;
    }

    const workspaceId = userData?.workspace?.id;
    if (!workspaceId) {
      toast.error("No workspace found");
      return;
    }

    setFileName(file.name);
    setIsUploading(true);

    try {
      const text = await file.text();
      const raw = parseCSV(text);
      const rows = raw.map(normalizeRow).filter((r) => r.email);

      if (!rows.length) {
        toast.error("No rows with a valid email column found");
        return;
      }

      const res = await fetch(`${apiUrl}/api/contacts/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ workspaceId, rows }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Import failed");
      }

      const data = await res.json();
      setResult({ created: data.created ?? 0, updated: data.updated ?? 0 });
      toast.success(`${data.created ?? 0} contacts imported`);
    } catch (e: any) {
      toast.error(e.message || "Failed to import contacts");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Import your contacts</h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload a CSV from your client's pipeline to seed Proply's memory.
        </p>
      </div>

      {result ? (
        <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-8 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
          <p className="font-semibold text-gray-900 text-lg">
            {result.created} contacts imported
          </p>
          {result.updated > 0 && (
            <p className="text-sm text-gray-500 mt-1">
              {result.updated} existing contacts updated
            </p>
          )}
          <p className="text-xs text-gray-400 mt-2">{fileName}</p>
        </div>
      ) : (
        <div
          onClick={() => !isUploading && fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={cn(
            "border-2 border-dashed rounded-xl p-12 text-center transition-all",
            isUploading
              ? "border-gray-200 bg-gray-50 cursor-default"
              : isDragging
                ? "border-gray-400 bg-gray-50 cursor-copy"
                : "border-gray-200 hover:border-gray-300 hover:bg-gray-50/50 cursor-pointer"
          )}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          {isUploading ? (
            <div className="space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto" />
              <p className="text-sm text-gray-500">Importing contacts...</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto">
                <Upload className="w-5 h-5 text-gray-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">Upload CSV</p>
                <p className="text-xs text-gray-400 mt-1">Drag & drop or click to browse</p>
              </div>
              <p className="text-xs text-gray-300">
                Columns: email, first_name, last_name, company, job_title
              </p>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Button
          onClick={onNext}
          disabled={isUploading}
          className="w-full bg-gray-900 hover:bg-gray-800 text-white h-11"
        >
          Continue
        </Button>
        {!result && (
          <button
            onClick={onSkip}
            className="w-full text-sm text-gray-400 hover:text-gray-600 py-2 transition-colors"
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}

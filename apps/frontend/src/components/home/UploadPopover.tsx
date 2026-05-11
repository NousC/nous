import { useState, useRef } from "react";
import { Upload, Link, StickyNote, X, Loader2, CheckCircle2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";

type Tab = "file" | "url" | "notes";

interface UploadPopoverProps {
  onUploadFile: (file: File) => Promise<void>;
  onAddUrl?: (url: string, title: string) => Promise<void>;
  onAddNote?: (title: string, content: string) => Promise<void>;
  onClose: () => void;
}

export function UploadPopover({
  onUploadFile,
  onAddUrl,
  onAddNote,
  onClose,
}: UploadPopoverProps) {
  const [activeTab, setActiveTab] = useState<Tab>("file");
  const [loading, setLoading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [urlValue, setUrlValue] = useState("");
  const [urlTitle, setUrlTitle] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tabs: { id: Tab; label: string; icon: typeof Upload }[] = [
    { id: "file", label: "File", icon: Upload },
    { id: "url", label: "URL", icon: Link },
    { id: "notes", label: "Notes", icon: StickyNote },
  ];

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
  };

  const handleFileUpload = async () => {
    if (!selectedFile) return;
    setLoading(true);
    try {
      await onUploadFile(selectedFile);
      setUploaded(true);
      toast.success(`"${selectedFile.name}" uploaded successfully`);
      setTimeout(() => onClose(), 1000);
    } catch (err) {
      toast.error("Upload failed. Please try again.");
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleUrlSubmit = async () => {
    if (!urlValue.trim() || !onAddUrl) return;
    setLoading(true);
    try {
      await onAddUrl(urlValue.trim(), urlTitle.trim() || urlValue.trim());
      toast.success("URL added successfully");
      onClose();
    } catch {
      toast.error("Failed to add URL");
    } finally {
      setLoading(false);
    }
  };

  const handleNoteSubmit = async () => {
    if (!noteContent.trim() || !onAddNote) return;
    setLoading(true);
    try {
      await onAddNote(noteTitle.trim() || "Note", noteContent.trim());
      toast.success("Note added successfully");
      onClose();
    } catch {
      toast.error("Failed to add note");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute bottom-full left-0 mb-2 w-80 bg-white rounded-xl border border-gray-200 shadow-lg z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <span className="text-xs font-medium text-gray-500">Add context</span>
        <button onClick={onClose} className="p-0.5 text-gray-400 hover:text-gray-600">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
              activeTab === tab.id
                ? "text-teal-700 border-b-2 border-teal-500 bg-teal-50/50"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-3">
        {activeTab === "file" && (
          <div className="space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt,.png,.jpg,.jpeg"
              onChange={handleFileSelect}
              className="hidden"
            />
            {!selectedFile ? (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="w-full flex flex-col items-center gap-2 py-6 border-2 border-dashed border-gray-200 rounded-lg hover:border-teal-300 hover:bg-teal-50/30 transition-colors disabled:opacity-50"
              >
                <Upload className="h-5 w-5 text-gray-400" />
                <span className="text-xs text-gray-500">
                  Click to select a PDF, DOCX, or TXT
                </span>
              </button>
            ) : (
              <div className="space-y-2">
                {/* Selected file preview */}
                <div className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-lg">
                  {uploaded ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                  ) : (
                    <FileText className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  )}
                  <span className="text-xs text-gray-700 truncate flex-1">{selectedFile.name}</span>
                  {!uploaded && !loading && (
                    <button
                      onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {/* Upload button */}
                {!uploaded && (
                  <button
                    onClick={handleFileUpload}
                    disabled={loading}
                    className="w-full py-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      "Upload"
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "url" && (
          <div className="space-y-2">
            <input
              type="url"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              placeholder="https://example.com/article"
              className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-500 placeholder:text-gray-400"
            />
            <input
              type="text"
              value={urlTitle}
              onChange={(e) => setUrlTitle(e.target.value)}
              placeholder="Title (optional)"
              className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-500 placeholder:text-gray-400"
            />
            <button
              onClick={handleUrlSubmit}
              disabled={!urlValue.trim() || loading}
              className="w-full py-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Adding..." : "Add URL"}
            </button>
          </div>
        )}

        {activeTab === "notes" && (
          <div className="space-y-2">
            <input
              type="text"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              placeholder="Title (optional)"
              className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-500 placeholder:text-gray-400"
            />
            <textarea
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="Paste notes, meeting transcript, client brief..."
              rows={4}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-500 placeholder:text-gray-400 resize-none"
            />
            <button
              onClick={handleNoteSubmit}
              disabled={!noteContent.trim() || loading}
              className="w-full py-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Adding..." : "Add Note"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useCallback } from "react";
import { Upload, FileText, X, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface PendingFile {
  file: File;
  title: string;
}

interface CompanyDocsPreviewProps {
  pendingFiles: PendingFile[];
  setPendingFiles: (files: PendingFile[]) => void;
}

export function CompanyDocsPreview({ pendingFiles, setPendingFiles }: CompanyDocsPreviewProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const validFiles = files.filter(file => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      return ['pdf', 'doc', 'docx', 'txt'].includes(ext || '');
    });

    if (validFiles.length > 0) {
      const newFiles = validFiles.map(file => ({
        file,
        title: file.name.replace(/\.[^/.]+$/, ""),
      }));
      setPendingFiles([...pendingFiles, ...newFiles]);
    }
  }, [pendingFiles, setPendingFiles]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      const newFiles = files.map(file => ({
        file,
        title: file.name.replace(/\.[^/.]+$/, ""),
      }));
      setPendingFiles([...pendingFiles, ...newFiles]);
    }
    e.target.value = '';
  };

  const removeFile = (index: number) => {
    setPendingFiles(pendingFiles.filter((_, i) => i !== index));
  };

  return (
    <div className="w-full max-w-[340px]">
      {/* Premium Card Container */}
      <div className="bg-white rounded-2xl shadow-2xl shadow-gray-200/50 border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <h3 className="text-[15px] font-medium text-gray-900">Company Documents</h3>
          <p className="text-[13px] text-gray-400 mt-0.5">Upload files Nous can reference when generating content</p>
        </div>

        {/* Drop Zone */}
        <div className="px-6 pb-6">
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => document.getElementById('preview-file-input')?.click()}
            className={cn(
              "relative rounded-xl border-2 border-dashed p-8 transition-all cursor-pointer",
              isDragging
                ? "border-emerald-400 bg-emerald-50/50"
                : "border-gray-200 hover:border-emerald-300 hover:bg-gray-50/50"
            )}
          >
            <input
              id="preview-file-input"
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />

            <div className="flex flex-col items-center text-center">
              <div className={cn(
                "w-12 h-12 rounded-full flex items-center justify-center mb-4 transition-all",
                isDragging
                  ? "bg-emerald-100"
                  : "bg-gradient-to-br from-gray-50 to-gray-100"
              )}>
                <Upload className={cn(
                  "w-5 h-5 transition-colors",
                  isDragging ? "text-emerald-600" : "text-gray-400"
                )} />
              </div>

              <p className="text-[14px] text-gray-600 mb-1">
                {isDragging ? "Drop to upload" : "Drag & drop files here"}
              </p>
              <p className="text-[12px] text-gray-400">
                or click to browse
              </p>
            </div>
          </div>
        </div>

        {/* File Types */}
        <div className="px-6 pb-4 flex items-center justify-center gap-2">
          {['PDF', 'DOC', 'DOCX', 'TXT'].map((type) => (
            <span
              key={type}
              className="px-2 py-0.5 rounded text-[10px] font-medium text-gray-400 bg-gray-50"
            >
              {type}
            </span>
          ))}
        </div>

        {/* Uploaded Files */}
        {pendingFiles.length > 0 && (
          <div className="border-t border-gray-100 px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] font-medium text-gray-500">
                Uploaded
              </span>
              <span className="text-[11px] text-emerald-600 font-medium">
                {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''}
              </span>
            </div>
            <div className="space-y-2">
              {pendingFiles.map((f, idx) => (
                <div
                  key={idx}
                  className="group flex items-center gap-3 p-2.5 rounded-lg bg-gray-50/80 hover:bg-gray-50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-white border border-gray-100 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4 text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-gray-700 truncate">
                      {f.title}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {(f.file.size / 1024).toFixed(0)} KB
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(idx);
                      }}
                      className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded-full hover:bg-gray-200 flex items-center justify-center transition-all"
                    >
                      <X className="w-3 h-3 text-gray-500" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Subtle helper text */}
      <p className="text-center text-[11px] text-gray-400 mt-4">
        Brand guidelines, case studies, company docs
      </p>
    </div>
  );
}

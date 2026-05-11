import { useState, useRef, useEffect, useMemo } from "react";
import { ArrowUp, Paperclip, Slash, FileText, LayoutTemplate, ListChecks, Mic, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { UploadPopover } from "@/components/home/UploadPopover";

const ROTATING_PLACEHOLDERS = [
  "Analyse my last 50 inbound leads from our website...",
  "Debrief me on what happened with Acme Corp this week...",
  "Which deals in my pipeline haven't moved in 14 days?",
  "Draft a follow-up for my top 3 open proposals...",
  "Summarise my pipeline by stage and flag any risks...",
];

const SLASH_COMMANDS = [
  { command: "/create proposal", description: "Generate an AI-powered proposal", icon: FileText },
  { command: "/create template", description: "Create a new document template", icon: LayoutTemplate },
  { command: "/create legal document", description: "Create a contract, NDA, or agreement", icon: Scale },
];

interface Attachment {
  asset_id: string;
  filename: string;
}

interface HomeChatInputProps {
  onSend: (message: string, attachments?: Attachment[]) => void;
  onUpload?: (file: File) => Promise<Attachment | null>;
  onAddUrl?: (url: string, title: string) => Promise<void>;
  onAddNote?: (title: string, content: string) => Promise<void>;
  isCreationMode?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export function HomeChatInput({
  onSend,
  onUpload,
  onAddUrl,
  onAddNote,
  isCreationMode = false,
  isLoading = false,
  placeholder = "Ask anything...",
  className,
  autoFocus = false,
}: HomeChatInputProps) {
  const [message, setMessage] = useState("");
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showUploadPopover, setShowUploadPopover] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isRotatingPlaceholder = placeholder === "Ask anything...";
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [placeholderVisible, setPlaceholderVisible] = useState(true);

  useEffect(() => {
    if (!isRotatingPlaceholder) return;
    const interval = setInterval(() => {
      setPlaceholderVisible(false);
      setTimeout(() => {
        setPlaceholderIndex(prev => (prev + 1) % ROTATING_PLACEHOLDERS.length);
        setPlaceholderVisible(true);
      }, 400);
    }, 3500);
    return () => clearInterval(interval);
  }, [isRotatingPlaceholder]);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (!message || message.trim() === '') {
      textarea.style.height = '60px';
      textarea.style.overflowY = 'hidden';
      return;
    }

    textarea.style.height = 'auto';
    const scrollHeight = textarea.scrollHeight;
    const minHeight = 60;
    const maxHeight = 200;
    const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${newHeight}px`;
    textarea.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [message]);

  // Slash command detection
  useEffect(() => {
    if (message.startsWith("/")) {
      setShowSlashMenu(true);
      setSlashFilter(message.toLowerCase());
      setSelectedSlashIndex(0);
    } else {
      setShowSlashMenu(false);
      setSlashFilter("");
    }
  }, [message]);

  const filteredCommands = useMemo(() => {
    if (!slashFilter) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(c =>
      c.command.toLowerCase().startsWith(slashFilter) ||
      c.command.toLowerCase().includes(slashFilter)
    );
  }, [slashFilter]);

  const selectSlashCommand = (command: string) => {
    setMessage(command + " ");
    setShowSlashMenu(false);
    textareaRef.current?.focus();
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    setMessage("");
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = '60px';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu && filteredCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSlashIndex(prev => Math.min(prev + 1, filteredCommands.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSlashIndex(prev => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        selectSlashCommand(filteredCommands[selectedSlashIndex].command);
        return;
      }
      if (e.key === "Escape") {
        setShowSlashMenu(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUpload) return;

    setUploading(true);
    try {
      const attachment = await onUpload(file);
      if (attachment) {
        setAttachments(prev => [...prev, attachment]);
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Voice dictation toggle
  const toggleVoiceDictation = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    if (isRecording && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsRecording(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = message || '';

    recognition.onresult = (event: any) => {
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += (finalTranscript ? ' ' : '') + transcript;
          setMessage(finalTranscript);
        } else {
          interimTranscript += transcript;
        }
      }

      if (interimTranscript) {
        setMessage(finalTranscript + (finalTranscript ? ' ' : '') + interimTranscript);
      }
    };

    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognition.onerror = (event: any) => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  // Cleanup speech recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
    };
  }, []);

  return (
    <form onSubmit={handleSubmit} className={cn("w-full", className)}>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/80 overflow-visible">
        {/* Attachment preview */}
        {attachments.length > 0 && (
          <div className="px-4 pt-3 flex gap-2 flex-wrap">
            {attachments.map((att, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2.5 py-1 bg-teal-50 rounded-lg text-xs text-teal-700">
                <Paperclip className="h-3 w-3" />
                <span className="truncate max-w-[150px]">{att.filename}</span>
                <button
                  type="button"
                  onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                  className="text-teal-400 hover:text-teal-600 ml-0.5"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Textarea */}
        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRotatingPlaceholder ? "" : placeholder}
            disabled={isLoading}
            className="min-h-[60px] max-h-[200px] border-0 focus-visible:ring-0 bg-transparent px-4 pt-4 pb-2 text-sm placeholder:text-gray-400 resize-none overflow-y-auto leading-relaxed w-full"
            rows={1}
          />
          {!message && isRotatingPlaceholder && (
            <div
              className="absolute top-0 left-0 px-4 pt-4 text-sm text-gray-400 pointer-events-none leading-relaxed select-none"
              style={{
                opacity: placeholderVisible ? 1 : 0,
                transition: 'opacity 400ms ease',
              }}
            >
              {ROTATING_PLACEHOLDERS[placeholderIndex]}
            </div>
          )}
        </div>

        {/* Slash command menu — appears between textarea and bottom bar */}
        {showSlashMenu && filteredCommands.length > 0 && (
          <div className="border-t border-gray-100 py-1">
            {filteredCommands.map((cmd, idx) => (
              <button
                key={cmd.command}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectSlashCommand(cmd.command);
                }}
                className={cn(
                  "flex items-center gap-3 w-full px-4 py-2 text-left transition-colors",
                  idx === selectedSlashIndex ? "bg-teal-50" : "hover:bg-gray-50"
                )}
              >
                <cmd.icon className="h-4 w-4 text-gray-400 flex-shrink-0" strokeWidth={1.75} />
                <div className="min-w-0">
                  <span className="text-sm font-medium text-gray-900">{cmd.command}</span>
                  <span className="text-xs text-gray-400 ml-2">{cmd.description}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Bottom bar */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 relative">
          {/* Upload popover (shown in creation mode) */}
          {showUploadPopover && onUpload && (
            <UploadPopover
              onUploadFile={async (file) => {
                await onUpload(file);
              }}
              onAddUrl={onAddUrl}
              onAddNote={onAddNote}
              onClose={() => setShowUploadPopover(false)}
            />
          )}

          {/* Left: Upload button */}
          <div className="flex items-center gap-1">
            {onUpload && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.doc,.txt,.png,.jpg,.jpeg"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isLoading || uploading}
                  onClick={() => setShowUploadPopover(!showUploadPopover)}
                  className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-40"
                >
                  {uploading ? (
                    <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                  ) : (
                    <Paperclip className="w-4 h-4" />
                  )}
                </button>
              </>
            )}
            <button
              type="button"
              disabled={isLoading}
              onClick={() => {
                setMessage("/");
                textareaRef.current?.focus();
              }}
              className="flex items-center gap-1 px-2 h-8 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-40 text-xs font-medium"
            >
              <Slash className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Commands</span>
            </button>
          </div>

          {/* Right: Voice + Send */}
          <div className="flex items-center gap-1">
            {typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  toggleVoiceDictation();
                }}
                disabled={isLoading}
                className={`p-1.5 rounded transition-colors disabled:opacity-40 ${
                  isRecording
                    ? 'text-red-500'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
                title={isRecording ? "Stop dictation" : "Start voice dictation"}
              >
                <Mic className={`h-4 w-4 ${isRecording ? 'animate-pulse' : ''}`} />
              </button>
            )}
          <button
            type="submit"
            disabled={!message.trim() || isLoading || isRecording}
            className={cn(
              "flex items-center justify-center flex-shrink-0",
              "w-8 h-8 rounded-lg",
              "bg-orange-500 text-white",
              "hover:bg-orange-600 active:bg-orange-700",
              "disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed",
              "transition-colors duration-150"
            )}
          >
            {isLoading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <ArrowUp className="w-4 h-4" />
            )}
          </button>
          </div>
        </div>
      </div>
    </form>
  );
}

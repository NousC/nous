import { MessageSquare, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatSession } from "@/hooks/useChatSessions";

interface SidebarChatHistoryProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

export function SidebarChatHistory({
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
}: SidebarChatHistoryProps) {
  return (
    <div className="flex flex-col min-h-0">
      {/* Section Header */}
      <div className="px-4 py-2">
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
          Recents
        </span>
      </div>

      {/* Chat List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin">
        {sessions.length === 0 ? (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-gray-400">No recents yet</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {sessions.map((session) => (
              <div
                key={session.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectSession(session.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectSession(session.id); }}
                className={cn(
                  "group w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-all duration-150 cursor-pointer",
                  activeSessionId === session.id
                    ? "bg-gray-200/60 text-gray-900"
                    : "text-gray-700 hover:bg-gray-50"
                )}
              >
                <MessageSquare
                  className={cn(
                    "h-3.5 w-3.5 flex-shrink-0",
                    activeSessionId === session.id
                      ? "text-gray-700"
                      : "text-gray-400"
                  )}
                  strokeWidth={1.75}
                />
                <p className="flex-1 min-w-0 text-xs truncate leading-tight">
                  {session.title}
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(session.id);
                  }}
                  className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

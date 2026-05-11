import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type SessionMode = 'general' | 'create_proposal' | 'create_template';

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  // Agent mode fields
  mode?: SessionMode;
  templateId?: string;
  templateType?: string;
  contextReady?: boolean;
}

const STORAGE_KEY = "assetly_chat_sessions";
const ACTIVE_SESSION_KEY = "assetly_active_session";

function generateId(): string {
  return crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function generateTitle(firstMessage: string): string {
  const cleaned = firstMessage.replace(/\n/g, " ").trim();
  if (cleaned.length <= 50) return cleaned;
  return cleaned.slice(0, 47) + "...";
}

function loadSessions(workspaceId: string): ChatSession[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}_${workspaceId}`);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveSessions(workspaceId: string, sessions: ChatSession[]) {
  localStorage.setItem(`${STORAGE_KEY}_${workspaceId}`, JSON.stringify(sessions));
}

export function useChatSessions() {
  const { userData } = useAuth();
  const workspaceId = userData?.workspace?.id || "";

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (workspaceId) {
      setSessions(loadSessions(workspaceId));
      // Restore active session if one was saved (e.g., user navigated away mid-chat)
      try {
        const savedActiveId = localStorage.getItem(`${ACTIVE_SESSION_KEY}_${workspaceId}`);
        setActiveSessionId(savedActiveId || null);
      } catch {
        setActiveSessionId(null);
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId && sessions.length > 0) {
      saveSessions(workspaceId, sessions);
    }
  }, [sessions, workspaceId]);

  // Persist active session ID so it survives navigation
  useEffect(() => {
    if (workspaceId) {
      if (activeSessionId) {
        localStorage.setItem(`${ACTIVE_SESSION_KEY}_${workspaceId}`, activeSessionId);
      } else {
        localStorage.removeItem(`${ACTIVE_SESSION_KEY}_${workspaceId}`);
      }
    }
  }, [activeSessionId, workspaceId]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  const createSession = useCallback((): string => {
    const now = new Date().toISOString();
    const id = generateId();
    const session: ChatSession = {
      id,
      title: "New chat",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(id);
    return id;
  }, []);

  const addMessage = useCallback(
    (sessionId: string, message: ChatMessage) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const updated = {
            ...s,
            messages: [...s.messages, message],
            updatedAt: new Date().toISOString(),
          };
          if (s.title === "New chat" && message.role === "user") {
            updated.title = generateTitle(message.content);
          }
          return updated;
        })
      );
    },
    []
  );

  const updateTitle = useCallback(
    (sessionId: string, title: string) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, title, updatedAt: new Date().toISOString() }
            : s
        )
      );
    },
    []
  );

  const setSessionMode = useCallback(
    (sessionId: string, mode: SessionMode, templateId: string, templateType: string) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, mode, templateId, templateType, updatedAt: new Date().toISOString() }
            : s
        )
      );
    },
    []
  );

  const setContextReady = useCallback(
    (sessionId: string) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, contextReady: true, updatedAt: new Date().toISOString() }
            : s
        )
      );
    },
    []
  );

  const selectSession = useCallback((sessionId: string | null) => {
    setActiveSessionId(sessionId);
  }, []);

  const deleteSession = useCallback(
    (sessionId: string) => {
      setSessions((prev) => {
        const filtered = prev.filter((s) => s.id !== sessionId);
        if (workspaceId) {
          saveSessions(workspaceId, filtered);
        }
        return filtered;
      });
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
      }
    },
    [activeSessionId, workspaceId]
  );

  const clearActiveSession = useCallback(() => {
    setActiveSessionId(null);
  }, []);

  // Reload sessions from localStorage (call after direct localStorage writes)
  const reloadFromStorage = useCallback(() => {
    if (workspaceId) {
      setSessions(loadSessions(workspaceId));
    }
  }, [workspaceId]);

  return {
    sessions,
    activeSession,
    activeSessionId,
    createSession,
    addMessage,
    updateTitle,
    setSessionMode,
    setContextReady,
    selectSession,
    deleteSession,
    clearActiveSession,
    reloadFromStorage,
  };
}

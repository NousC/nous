import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Users, Handshake, ListChecks, Zap, X, Inbox, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { HomeChatInput } from "@/components/home/HomeChatInput";
import { HomeMetricCard } from "@/components/home/HomeMetricCard";
import { HomeAssistantChat, ChatMessage, ChatMessageAction } from "@/components/home/HomeAssistantChat";
import type { EmailDraft } from "@/components/home/EmailDraftCard";
import { EmailComposerPanel } from "@/components/home/EmailComposerPanel";
import type { ThinkingStep } from "@/components/ai-writer/ThinkingIndicator";
import type { AgentWorkingState, AgentStep } from "@/components/home/AgentWorkingDropdown";
import { toast } from "@/components/ui/sonner";
import type { useChatSessions } from "@/hooks/useChatSessions";

interface IndexProps {
  chatSessions?: ReturnType<typeof useChatSessions>;
}

const Index = ({ chatSessions }: IndexProps) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { userData, session } = useAuth();
  const [stats, setStats] = useState({
    contacts: 0,
    clients: 0,
    tasks: 0,
    creditsRemaining: 0,
  });
  const [loading, setLoading] = useState(true);
  const [lastLoadTime, setLastLoadTime] = useState<number>(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const CACHE_DURATION = 30 * 1000;

  // Chat state
  const [isChatMode, setIsChatMode] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const isStreamingRef = useRef(false); // Tracks streaming state for cleanup
  const [isStreaming, _setIsStreaming] = useState(false);
  const setIsStreaming = (v: boolean) => { isStreamingRef.current = v; _setIsStreaming(v); };
  const [streamingContent, setStreamingContent] = useState("");
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [interactiveOptions, setInteractiveOptions] = useState<{ options: { id: string; label: string; action: 'generate' | 'continue' }[]; status: 'pending' | 'selected' | 'dismissed'; templateId?: string } | null>(null);
  const [generationSteps, setGenerationSteps] = useState<ThinkingStep[]>([]);
  const [agentWork, setAgentWork] = useState<AgentWorkingState | null>(null);
  const agentWorkRef = useRef<AgentWorkingState | null>(null);
  const [composerDraft, setComposerDraft] = useState<EmailDraft | null>(null);
  const emailDraftRef = useRef<EmailDraft | null>(null);
  const newMessagesRef = useRef<Array<{ role: string; content: any }> | null>(null);
  const contextReadyRef = useRef(false);
  const updateAgentWork = (updater: (prev: AgentWorkingState) => AgentWorkingState) => {
    setAgentWork(prev => {
      const base = prev || { isActive: true, steps: [] };
      const next = updater(base);
      agentWorkRef.current = next;
      return next;
    });
  };
  const abortControllerRef = useRef<AbortController | null>(null);

  // Persist in-progress streaming content directly to localStorage.
  // Saves immediately on first chunk, then debounces subsequent updates.
  const streamSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef<string>("");

  const saveToLocalStorage = useCallback((content: string, sid: string, workspaceId: string) => {
    lastSavedContentRef.current = content;
    try {
      const storageKey = `assetly_chat_sessions_${workspaceId}`;
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const sessions = JSON.parse(raw);
      const session = sessions.find((s: any) => s.id === sid);
      if (!session) return;
      const lastMsg = session.messages[session.messages.length - 1];
      if (lastMsg?.role === 'assistant' && lastMsg?._streaming) {
        lastMsg.content = content;
      } else {
        session.messages.push({ role: 'assistant', content, _streaming: true });
      }
      session.updatedAt = new Date().toISOString();
      localStorage.setItem(storageKey, JSON.stringify(sessions));
    } catch (e) {}
  }, []);

  const persistStreamingContent = useCallback((content: string, sid: string | null, workspaceId: string) => {
    if (!sid || !workspaceId || !content.trim()) return;
    // First chunk: save immediately so there's always something persisted
    if (!lastSavedContentRef.current) {
      saveToLocalStorage(content, sid, workspaceId);
      return;
    }
    // Subsequent chunks: debounce every 300ms
    if (streamSaveTimerRef.current) clearTimeout(streamSaveTimerRef.current);
    streamSaveTimerRef.current = setTimeout(() => {
      saveToLocalStorage(content, sid, workspaceId);
    }, 300);
  }, [saveToLocalStorage]);

  // Typing buffer — queues up received text and drips it out character by character
  const bufferRef = useRef("");
  const displayedRef = useRef("");
  const typingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTypingBuffer = () => {
    if (typingTimerRef.current) return;
    typingTimerRef.current = setInterval(() => {
      if (displayedRef.current.length < bufferRef.current.length) {
        // Consistent natural typing speed — always 1 char every 18ms (~55 chars/sec)
        // Never speeds up regardless of buffer size
        displayedRef.current = bufferRef.current.slice(0, displayedRef.current.length + 1);
        setStreamingContent(displayedRef.current);
      }
    }, 18);
  };

  const stopTypingBuffer = () => {
    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }
  };

  const flushTypingBuffer = () => {
    stopTypingBuffer();
    // Same consistent speed for flushing — never rush
    const flushTimer = setInterval(() => {
      if (displayedRef.current.length < bufferRef.current.length) {
        displayedRef.current = bufferRef.current.slice(0, displayedRef.current.length + 1);
        setStreamingContent(displayedRef.current);
      } else {
        clearInterval(flushTimer);
      }
    }, 18);
  };

  // Animation state - controls the staggered entrance
  const [mounted, setMounted] = useState(false);
  const [chatTransitioning, setChatTransitioning] = useState(false);

  // Trigger entrance animations after mount
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Get greeting based on time
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  useEffect(() => {
    if (userData?.workspace?.id && session?.access_token) {
      const now = Date.now();
      if (lastLoadTime === 0 || (now - lastLoadTime) > CACHE_DURATION) {
        loadDashboardData();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData?.workspace?.id, session?.access_token]);

  const loadDashboardData = async () => {
    if (!userData?.workspace?.id || !session?.access_token) return;

    setLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";

      const [contactsResponse, clientsResponse, tasksResponse, notificationsResponse, usageResponse] = await Promise.all([
        fetch(`${apiUrl}/api/contacts?workspaceId=${userData.workspace.id}&limit=1`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }).catch(() => ({ ok: false, status: 404 })),
        fetch(`${apiUrl}/api/contacts?workspaceId=${userData.workspace.id}&status=client&limit=1`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }).catch(() => ({ ok: false, status: 404 })),
        fetch(`${apiUrl}/api/workflows?workspaceId=${userData.workspace.id}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch(`${apiUrl}/api/notifications?workspaceId=${userData.workspace.id}&limit=1`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch(`${apiUrl}/api/usage`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ]);

      if (contactsResponse.ok) {
        const contactsData = await (contactsResponse as Response).json();
        setStats(prev => ({ ...prev, contacts: contactsData.total || contactsData.contacts?.length || 0 }));
      }

      if (clientsResponse.ok) {
        const clientsData = await (clientsResponse as Response).json();
        setStats(prev => ({ ...prev, clients: clientsData.total || clientsData.contacts?.length || 0 }));
      }

      if (tasksResponse.ok) {
        const tasksData = await tasksResponse.json();
        const tasks = tasksData.workflows || [];
        setStats(prev => ({ ...prev, tasks: tasks.length }));
      }

      if (notificationsResponse.ok) {
        const notificationsData = await notificationsResponse.json();
        setUnreadCount(notificationsData.unreadCount || 0);
      }

      if (usageResponse.ok) {
        const usageData = await usageResponse.json();
        const used = usageData?.usage?.credits_used ?? usageData?.credits_used ?? 0;
        const limit = usageData?.limits?.max_credits_per_month ?? usageData?.plan_limits?.max_credits_per_month ?? 100;
        setStats(prev => ({ ...prev, creditsRemaining: Math.max(0, limit - used) }));
      }

      setLastLoadTime(Date.now());
    } catch (error) {
      console.error("Error loading dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  // On mount, reload sessions from localStorage to pick up any streaming messages
  // that were persisted directly to localStorage while streaming
  useEffect(() => {
    chatSessions?.reloadFromStorage?.();
  }, []); // Only on mount

  // Load messages from active session when it changes
  useEffect(() => {
    if (chatSessions?.activeSession) {
      setChatMessages(chatSessions.activeSession.messages as ChatMessage[]);
      if (chatSessions.activeSession.messages.length > 0) {
        setIsChatMode(true);
      }
    }
  }, [chatSessions?.activeSessionId, chatSessions?.activeSession?.messages?.length]);

  // Handle follow-up reminder deep link from inbox notification
  const followUpHandledRef = useRef(false);
  useEffect(() => {
    if (followUpHandledRef.current) return;
    const isFollowUp = searchParams.get("followUp");
    const prompt = searchParams.get("prompt");
    if (isFollowUp && prompt && userData?.workspace?.id && session?.access_token) {
      followUpHandledRef.current = true;
      // Clear the URL params so refreshing doesn't re-trigger
      setSearchParams({}, { replace: true });
      // Auto-send the pre-filled prompt after a brief delay for UI to mount
      setTimeout(() => {
        handleSendMessage(prompt);
      }, 500);
    }
  }, [searchParams, userData?.workspace?.id, session?.access_token]);

  // File upload handler — routes to template asset library when in creation mode
  const handleUpload = async (file: File): Promise<{ asset_id: string; filename: string } | null> => {
    if (!userData?.workspace?.id || !session?.access_token) return null;

    const apiUrl = import.meta.env.VITE_API_URL ?? "";
    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", file.name);
    formData.append("type", "document");

    // Route to template asset library if in creation mode
    const activeMode = chatSessions?.activeSession?.mode;
    const activeTemplateId = chatSessions?.activeSession?.templateId;
    const uploadUrl = activeMode && activeTemplateId
      ? `${apiUrl}/api/templates/${activeTemplateId}/asset-library/upload`
      : `${apiUrl}/api/workspaces/${userData.workspace.id}/content/asset-library/upload`;

    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: formData,
    });

    if (!res.ok) throw new Error("Upload failed");
    const data = await res.json();
    return { asset_id: data.entry?.id, filename: file.name };
  };

  // Whether the active session is in a creation mode (proposal or template)
  const isCreationMode = !!(chatSessions?.activeSession?.mode && chatSessions.activeSession.mode !== 'general');

  // Add URL handler — saves URL content as a note in the template's knowledge base
  const handleAddUrl = async (url: string, title: string) => {
    if (!userData?.workspace?.id || !session?.access_token) return;
    const apiUrl = import.meta.env.VITE_API_URL ?? "";
    const activeTemplateId = chatSessions?.activeSession?.templateId;
    // Use the notes endpoint — save URL as a note with the URL in the content
    const endpoint = activeTemplateId
      ? `${apiUrl}/api/templates/${activeTemplateId}/asset-library/notes`
      : `${apiUrl}/api/workspaces/${userData.workspace.id}/content/asset-library/notes`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ title: title || url, content: `Source URL: ${url}` }),
    });
    if (!res.ok) throw new Error("Failed to add URL");
  };

  // Add note handler — saves a text note as context for the agent
  const handleAddNote = async (title: string, content: string) => {
    if (!userData?.workspace?.id || !session?.access_token) return;
    const apiUrl = import.meta.env.VITE_API_URL ?? "";
    const activeTemplateId = chatSessions?.activeSession?.templateId;
    const endpoint = activeTemplateId
      ? `${apiUrl}/api/templates/${activeTemplateId}/asset-library/notes`
      : `${apiUrl}/api/workspaces/${userData.workspace.id}/content/asset-library/notes`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ title, content }),
    });
    if (!res.ok) throw new Error("Failed to add note");
  };

  // Detect slash commands and extract context
  // Generate a short chat title from the first message exchange (runs in background)
  const generateChatTitle = async (userMsg: string, assistantMsg: string, sid: string) => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const res = await fetch(`${apiUrl}/api/workspaces/${userData?.workspace?.id}/assistant/title`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ userMessage: userMsg, assistantMessage: assistantMsg }),
      });
      if (res.ok) {
        const { title } = await res.json();
        if (title && chatSessions) {
          chatSessions.updateTitle(sid, title);
        }
      }
    } catch {
      // Silent fail — title stays as first message truncation
    }
  };

  const parseSlashCommand = (msg: string): { mode: 'create_proposal' | 'create_template' | 'create_task' | 'create_legal_document'; context: string } | null => {
    const lower = msg.trim().toLowerCase();
    if (lower.startsWith('/create proposal')) {
      const context = msg.trim().slice('/create proposal'.length).trim();
      return { mode: 'create_proposal', context: context || 'I want to create a new proposal.' };
    }
    if (lower.startsWith('/create task')) {
      const context = msg.trim().slice('/create task'.length).trim();
      return { mode: 'create_task', context: context || 'I want to create a new automated task.' };
    }
    if (lower.startsWith('/create legal document') || lower.startsWith('/create legal')) {
      const matchLength = lower.startsWith('/create legal document') ? '/create legal document'.length : '/create legal'.length;
      const context = msg.trim().slice(matchLength).trim();
      return { mode: 'create_legal_document', context: context || 'I want to create a legal document.' };
    }
    if (lower.startsWith('/create template')) {
      const context = msg.trim().slice('/create template'.length).trim();
      return { mode: 'create_template', context: context || 'I want to create a new template.' };
    }
    return null;
  };

  // Save user message to ai_writer_chat_history for template continuity
  const saveMessageToTemplate = async (templateId: string, role: string, content: string) => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      await fetch(`${apiUrl}/api/templates/${templateId}/ai/chat/save-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ role, content }),
      });
    } catch (err) {
      console.warn("Failed to save message to template:", err);
    }
  };

  // Chat handlers
  const handleSendMessage = async (message: string, attachments?: { asset_id: string; filename: string }[]) => {
    if (!userData?.workspace?.id || !session?.access_token) return;

    // Ensure we have an active session
    let sessionId = chatSessions?.activeSessionId || null;
    if (!sessionId && chatSessions) {
      sessionId = chatSessions.createSession();
    }

    if (!isChatMode) {
      setChatTransitioning(true);
      setTimeout(() => {
        setIsChatMode(true);
        setChatTransitioning(false);
      }, 300);
    }

    const newUserMessage: ChatMessage = { role: "user", content: message };
    setChatMessages(prev => [...prev, newUserMessage]);
    if (sessionId && chatSessions) {
      chatSessions.addMessage(sessionId, newUserMessage);
    }

    setIsStreaming(true);
    setStreamingContent("");
    bufferRef.current = "";
    displayedRef.current = "";
    lastSavedContentRef.current = ""; // Reset so first chunk saves immediately
    if (streamSaveTimerRef.current) clearTimeout(streamSaveTimerRef.current);
    contextReadyRef.current = false;
    setAgentWork(null);
    agentWorkRef.current = null;
    emailDraftRef.current = null;
    newMessagesRef.current = null;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const activeSession = chatSessions?.activeSession;
      let currentMode = activeSession?.mode;
      let currentTemplateId = activeSession?.templateId;

      // --- Detect slash command and create template/task in background ---
      const slashCmd = parseSlashCommand(message);
      if (slashCmd && !currentMode) {
        // Handle /create task — creates a workflow with display_mode='task'
        if (slashCmd.mode === 'create_task') {
          setToolStatus('Setting up task...');
          const taskRes = await fetch(`${apiUrl}/api/workflows`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              workspace_id: userData.workspace.id,
              name: "New Task",
              description: slashCmd.context,
              display_mode: "task",
              trigger_type: "manual",
              definition: { steps: [], variables: {} },
            }),
          });
          if (!taskRes.ok) throw new Error("Failed to create task");
          const { workflow } = await taskRes.json();
          setToolStatus(null);
          navigate(`/workflows/${workflow.id}/builder`);
          return;
        }

        const modeLabels: Record<string, string> = {
          create_proposal: 'Setting up proposal...',
          create_legal_document: 'Setting up legal document...',
        };
        setToolStatus(modeLabels[slashCmd.mode] || 'Setting up template...');

        // Create template in background
        const modeConfig: Record<string, { name: string; type: string; mode: string }> = {
          create_proposal: { name: 'New Proposal', type: 'proposal', mode: 'proposal' },
          create_legal_document: { name: 'New Legal Document', type: 'contract', mode: 'legal_document' },
        };
        const cfg = modeConfig[slashCmd.mode] || { name: 'New Template', type: 'document', mode: 'template' };

        const createRes = await fetch(
          `${apiUrl}/api/workspaces/${userData.workspace.id}/templates/quick-create`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              name: cfg.name,
              type: cfg.type,
              mode: cfg.mode,
            }),
          }
        );

        if (!createRes.ok) {
          throw new Error("Failed to create template");
        }

        const { template } = await createRes.json();
        currentTemplateId = template.id;
        currentMode = slashCmd.mode;

        // Store mode in session
        if (sessionId && chatSessions) {
          chatSessions.setSessionMode(sessionId, slashCmd.mode, template.id, template.type);
        }
        setToolStatus(null);
      }

      // --- Determine endpoint and build request ---
      const isCreationMode = currentMode && currentTemplateId;
      const messageToSend = slashCmd ? slashCmd.context : message;

      let fetchUrl: string;
      let fetchBody: string;

      if (isCreationMode) {
        // Route to template AI chat endpoint (context gathering agent)
        fetchUrl = `${apiUrl}/api/templates/${currentTemplateId}/ai/chat?stream=true`;
        fetchBody = JSON.stringify({
          message: messageToSend,
          history: chatMessages.map(m => ({ role: m.role, content: m.content })),
          workspaceId: userData.workspace.id,
          useCompanyKnowledge: true,
        });

        // Save user message to ai_writer_chat_history for template editor continuity
        saveMessageToTemplate(currentTemplateId!, "user", messageToSend);
      } else {
        // General workspace assistant
        fetchUrl = `${apiUrl}/api/workspaces/${userData.workspace.id}/assistant/chat`;
        // Expand structuredHistory so tool_use/tool_result blocks are preserved across turns.
        // For assistant messages that used tools: emit tool context blocks then the final text reply.
        // For all other messages: emit as-is.
        const expandedHistory = chatMessages.flatMap(m => {
          if (m.structuredHistory?.length) {
            return [
              ...m.structuredHistory,
              { role: 'assistant' as const, content: m.content },
            ];
          }
          return [{ role: m.role, content: m.content }];
        });
        fetchBody = JSON.stringify({
          message,
          history: expandedHistory,
          attachments: attachments || [],
        });
      }

      const response = await fetch(fetchUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: fetchBody,
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.error === 'insufficient_credits') {
          const creditMessage: ChatMessage = {
            role: "assistant",
            content: "You've reached your monthly credit limit. Please upgrade your plan or wait until your credits refresh to continue chatting with me. You can manage your subscription in Settings → Billing."
          };
          setChatMessages(prev => [...prev, creditMessage]);
          if (sessionId && chatSessions) {
            chatSessions.addMessage(sessionId, creditMessage);
          }
          setIsStreaming(false);
          return;
        }
        throw new Error(errorData.message || "Failed to send message");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              // Handle unified agent_step events (tool calls)
              if (data.type === 'agent_step') {
                const step = data.step;
                // Memory ops are silent — never surface in UI
                const silentTools = ['get_memories', 'search', 'list_contacts', 'get_contact'];
                if (silentTools.includes(step?.tool)) continue;
                if (data.status === 'running') {
                  updateAgentWork(prev => ({
                    isActive: true,
                    steps: [...prev.steps, {
                      id: step.id,
                      tool: step.tool,
                      provider: step.provider,
                      label: step.label,
                      input: step.input,
                      status: 'running',
                      startedAt: Date.now(),
                    }],
                  }));
                } else if (data.status === 'completed' || data.status === 'failed') {
                  updateAgentWork(prev => ({
                    ...prev,
                    steps: prev.steps.map(s =>
                      s.id === step.id
                        ? { ...s, status: data.status as 'completed' | 'failed', result: step.result, resultSummary: step.resultSummary, completedAt: Date.now() }
                        : s
                    ),
                  }));
                }
                continue;
              }

              // Handle email_draft event — store for persistence on message
              if (data.type === 'email_draft' && data.draft) {
                emailDraftRef.current = data.draft;
                continue;
              }

              // Handle context_ready event (from template AI chat)
              if (data.type === 'context_ready') {
                contextReadyRef.current = true;
                if (sessionId && chatSessions) {
                  chatSessions.setContextReady(sessionId);
                }
                continue;
              }

              // Handle text content — both SSE formats
              const textChunk = data.delta || (data.type === 'content' ? data.text : null);
              if (textChunk) {
                fullContent += textChunk;
                bufferRef.current = fullContent;
                startTypingBuffer();
                // Persist to localStorage so the message survives if user navigates away
                console.log('[STREAM_PERSIST] chunk received, fullContent length:', fullContent.length, 'sid:', sessionId, 'wid:', userData?.workspace?.id);
                persistStreamingContent(fullContent, sessionId, userData?.workspace?.id || "");
              }

              // Handle done — both SSE formats
              if (data.done || data.type === 'done') {
                if (data.fullResponse && !fullContent) {
                  fullContent = data.fullResponse;
                }
                // Preserve tool_use/tool_result blocks so next turn has full contact context
                if (data.newMessages?.length) {
                  newMessagesRef.current = data.newMessages;
                }
                setToolStatus(null);
                // Mark agent work as inactive (all steps done)
                const savedAgentWork = agentWorkRef.current;
                if (savedAgentWork) {
                  setAgentWork(prev => prev ? { ...prev, isActive: false } : null);
                }

                // Wait for typing animation to finish before showing final message
                stopTypingBuffer();
                const remainingChars = bufferRef.current.length - displayedRef.current.length;
                const finishDelay = Math.max(300, remainingChars * 18); // 18ms per char remaining

                const flushTimer = setInterval(() => {
                  if (displayedRef.current.length < bufferRef.current.length) {
                    displayedRef.current = bufferRef.current.slice(0, displayedRef.current.length + 1);
                    setStreamingContent(displayedRef.current);
                  } else {
                    clearInterval(flushTimer);
                  }
                }, 18);

                const finalSessionId = chatSessions?.activeSessionId || sessionId;
                const finalTemplateId = currentTemplateId;
                setTimeout(() => {
                  clearInterval(flushTimer);
                  setIsStreaming(false);
                  // Clear active agent work — it's now persisted on the message
                  setAgentWork(null);
                  agentWorkRef.current = null;
                  const savedEmailDraft = emailDraftRef.current;
                  emailDraftRef.current = null;
                  const savedNewMessages = newMessagesRef.current;
                  newMessagesRef.current = null;
                  const assistantMsg: ChatMessage = {
                    role: "assistant",
                    content: fullContent,
                    agentWork: savedAgentWork && savedAgentWork.steps.length > 0
                      ? { ...savedAgentWork, isActive: false }
                      : undefined,
                    emailDraft: savedEmailDraft || undefined,
                    structuredHistory: savedNewMessages || undefined,
                  };
                  setChatMessages(prev => [...prev, assistantMsg]);
                  // Clear streaming save timer and remove temporary _streaming message
                  if (streamSaveTimerRef.current) clearTimeout(streamSaveTimerRef.current);
                  lastSavedContentRef.current = "";
                  if (finalSessionId && chatSessions) {
                    // Remove the _streaming placeholder before adding the final message
                    try {
                      const wid = userData?.workspace?.id || "";
                      const storageKey = `assetly_chat_sessions_${wid}`;
                      const raw = localStorage.getItem(storageKey);
                      if (raw) {
                        const storedSessions = JSON.parse(raw);
                        const sess = storedSessions.find((s: any) => s.id === finalSessionId);
                        if (sess) {
                          sess.messages = sess.messages.filter((m: any) => !m._streaming);
                          localStorage.setItem(storageKey, JSON.stringify(storedSessions));
                        }
                      }
                    } catch (e) {}
                    chatSessions.addMessage(finalSessionId, assistantMsg);
                  }

                  // Save assistant message to template chat history (backup — backend also saves)
                  if (finalTemplateId && fullContent) {
                    saveMessageToTemplate(finalTemplateId, "assistant", fullContent);
                  }

                  // Auto-generate chat title on first assistant response
                  if (finalSessionId && chatSessions && chatMessages.length <= 1) {
                    generateChatTitle(message, fullContent, finalSessionId);
                  }

                  // If context is ready, show the interactive options popover
                  if (contextReadyRef.current && finalTemplateId) {
                    contextReadyRef.current = false;
                    const activeMode = chatSessions?.activeSession?.mode;
                    const isProposal = activeMode === 'create_proposal';
                    const isLegalDoc = activeMode === 'create_legal_document';
                    const generateLabel = isLegalDoc ? 'Generate Document' : isProposal ? 'Generate Proposal' : 'Generate Template';
                    setInteractiveOptions({
                      options: [
                        { id: 'generate', label: generateLabel, action: 'generate' as const },
                        { id: 'continue', label: 'Something else', action: 'continue' as const },
                      ],
                      status: 'pending',
                      templateId: finalTemplateId,
                    });
                  }

                  setStreamingContent("");
                  bufferRef.current = "";
                  displayedRef.current = "";
                }, finishDelay);
              }

              if (data.error) {
                throw new Error(data.message || "Stream error");
              }
            } catch (e: any) {
              // Re-throw actual errors, only ignore JSON parse failures
              if (e?.message && e.message !== "Unexpected end of JSON input" && !e.message.includes("JSON")) {
                throw e;
              }
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name === "AbortError") return;
      console.error("Chat error:", error);
      setIsStreaming(false);
      setStreamingContent("");
      setToolStatus(null);
      setAgentWork(null);
      agentWorkRef.current = null;
      stopTypingBuffer();
      bufferRef.current = "";
      displayedRef.current = "";

      // Show error as a chat message from the agent
      const errorMsg: ChatMessage = {
        role: "assistant",
        content: error.message?.includes("trouble") || error.message?.includes("Sorry")
          ? error.message
          : "I'm having a bit of trouble connecting right now. This is usually temporary — please try again in a moment.",
      };
      setChatMessages(prev => [...prev, errorMsg]);
      const sid = chatSessions?.activeSessionId;
      if (sid && chatSessions) chatSessions.addMessage(sid, errorMsg);
    }
  };

  // Handle interactive options selection (Generate Proposal / Something else)
  const handleInteractiveSelect = (optionId: string) => {
    if (!interactiveOptions) return;
    setInteractiveOptions(prev => prev ? { ...prev, status: 'selected' } : null);

    if (optionId === 'generate' && interactiveOptions.templateId) {
      const activeMode = chatSessions?.activeSession?.mode;
      const isProposal = activeMode === 'create_proposal';
      const isLegalDoc = activeMode === 'create_legal_document';
      const label = isLegalDoc ? 'Generate Document' : isProposal ? 'Generate Proposal' : 'Generate Template';
      const actionType = isLegalDoc ? 'generate_legal_document' : isProposal ? 'generate_proposal' : 'generate_template';

      // Add user's choice as a chat message
      const userChoice: ChatMessage = { role: "user", content: label };
      setChatMessages(prev => [...prev, userChoice]);
      const sid = chatSessions?.activeSessionId;
      if (sid && chatSessions) chatSessions.addMessage(sid, userChoice);

      handleGenerateAction({
        type: actionType as any,
        templateId: interactiveOptions.templateId,
        label,
      });
    }
  };

  const handleInteractiveDismiss = () => {
    setInteractiveOptions(prev => prev ? { ...prev, status: 'dismissed' } : null);
  };

  const handleInteractiveSendMessage = (msg: string) => {
    setInteractiveOptions(prev => prev ? { ...prev, status: 'dismissed' } : null);
    handleSendMessage(msg);
  };

  // Handle in-chat proposal/template generation
  const handleGenerateAction = async (action: ChatMessageAction) => {
    if (!userData?.workspace?.id || !session?.access_token) return;

    // Both proposals and templates generate in-chat with progress streaming
    const apiUrl = import.meta.env.VITE_API_URL ?? "";
    const isProposal = action.type === 'generate_proposal';
    const isLegalDoc = action.type === 'generate_legal_document';
    const genLabel = isLegalDoc ? 'Generating Legal Document' : isProposal ? 'Generating Proposal' : 'Generating Template';
    let progressBullets: string[] = [];
    setGenerationSteps([{
      id: 'generation',
      label: genLabel,
      status: 'active',
      progressBullets: [],
    }]);

    try {
      const response = await fetch(
        `${apiUrl}/api/workspaces/${userData.workspace.id}/assistant/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ templateId: action.templateId }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || "Generation failed");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'progress') {
                progressBullets = [...progressBullets, data.step];
                setGenerationSteps([{
                  id: 'generation',
                  label: genLabel,
                  status: 'active',
                  progressBullets: progressBullets,
                }]);
              }

              if (data.type === 'done') {
                setToolStatus(null);
                setGenerationSteps([]);

                const label = isLegalDoc ? 'document' : isProposal ? 'proposal' : 'template';
                const templateId = data.template_id;
                const documentId = data.document_id;
                const sessionId = chatSessions?.activeSessionId;

                // Reset session mode back to normal agent
                if (sessionId && chatSessions) {
                  chatSessions.setSessionMode(sessionId, 'general', '', '');
                }

                // Update interactive options in DB
                if (templateId) {
                  try {
                    const apiUrl2 = import.meta.env.VITE_API_URL ?? "";
                    fetch(`${apiUrl2}/api/templates/${templateId}/ai/chat/update-interactive-options`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
                      body: JSON.stringify({ status: 'selected', selectedOptionId: 'generate_document' }),
                    }).catch(() => {});
                  } catch {}
                }

                // Stream a real response from the agent about the completed generation
                setIsStreaming(true);
                bufferRef.current = "";
                displayedRef.current = "";
                try {
                  const completionRes = await fetch(
                    `${apiUrl}/api/workspaces/${userData?.workspace?.id}/assistant/chat`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
                      body: JSON.stringify({
                        message: `[SYSTEM: The user just generated a ${label}. It is now ready at ${isProposal && documentId ? `/documents/${documentId}/edit` : `/templates/${templateId}/edit`}. Tell the user their ${label} is ready and include the link [View ${isProposal ? 'Proposal' : 'Template'}](${isProposal && documentId ? `/documents/${documentId}/edit` : `/templates/${templateId}/edit`}). Let them know they can open it to review and edit, and that you can help with the editor's AI assistant for refinements. Keep it brief and natural — 2-3 sentences max.]`,
                        history: [],
                      }),
                    }
                  );
                  if (completionRes.ok) {
                    const reader2 = completionRes.body?.getReader();
                    if (reader2) {
                      const decoder2 = new TextDecoder();
                      let agentContent = "";
                      while (true) {
                        const { done: d2, value: v2 } = await reader2.read();
                        if (d2) break;
                        const chunk2 = decoder2.decode(v2, { stream: true });
                        for (const line2 of chunk2.split("\n")) {
                          if (line2.startsWith("data: ")) {
                            try {
                              const ev = JSON.parse(line2.slice(6));
                              if (ev.delta) {
                                agentContent += ev.delta;
                                bufferRef.current = agentContent;
                                startTypingBuffer();
                              }
                              if (ev.done) {
                                const remainChars = bufferRef.current.length - displayedRef.current.length;
                                const delay = Math.max(300, remainChars * 18);
                                stopTypingBuffer();
                                const ft = setInterval(() => {
                                  if (displayedRef.current.length < bufferRef.current.length) {
                                    displayedRef.current = bufferRef.current.slice(0, displayedRef.current.length + 1);
                                    setStreamingContent(displayedRef.current);
                                  } else { clearInterval(ft); }
                                }, 18);
                                setTimeout(() => {
                                  clearInterval(ft);
                                  setIsStreaming(false);
                                  const finalMsg: ChatMessage = {
                                    role: "assistant",
                                    content: agentContent,
                                    generationSteps: [...progressBullets, 'Done!'],
                                  };
                                  setChatMessages(prev => [...prev, finalMsg]);
                                  if (sessionId && chatSessions) chatSessions.addMessage(sessionId, finalMsg);
                                  setStreamingContent("");
                                  bufferRef.current = "";
                                  displayedRef.current = "";
                                }, delay);
                              }
                            } catch {}
                          }
                        }
                      }
                    }
                  } else {
                    throw new Error("Agent response failed");
                  }
                } catch {
                  // Fallback if agent call fails
                  setIsStreaming(false);
                  const fallbackMsg: ChatMessage = {
                    role: "assistant",
                    content: `Your ${label} is ready! [View ${isProposal ? 'Proposal' : 'Template'}](${isProposal && documentId ? `/documents/${documentId}/edit` : `/templates/${templateId}/edit`})`,
                    generationSteps: [...progressBullets, 'Done!'],
                  };
                  setChatMessages(prev => [...prev, fallbackMsg]);
                  if (sessionId && chatSessions) chatSessions.addMessage(sessionId, fallbackMsg);
                }
              }

              if (data.type === 'error') {
                throw new Error(data.message);
              }
            } catch (e) {
              // Ignore JSON parse errors
            }
          }
        }
      }
    } catch (error: any) {
      console.error("Generation error:", error);
      setToolStatus(null);
      // Show error as a failed message in chat
      setGenerationSteps([]);
      const errorMsg: ChatMessage = {
        role: "assistant",
        content: error.message || "Failed to generate. Please try again.",
      };
      setChatMessages(prev => [...prev, errorMsg]);
      const sid = chatSessions?.activeSessionId;
      if (sid && chatSessions) chatSessions.addMessage(sid, errorMsg);
    }
  };

  const handleExitChat = () => {
    setIsChatMode(false);
    setChatMessages([]);
    setStreamingContent("");
    setToolStatus(null);
    stopTypingBuffer();
    bufferRef.current = "";
    displayedRef.current = "";
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    chatSessions?.clearActiveSession();
  };

  const metricCards = [
    { label: "Contacts", value: stats.contacts, icon: Users, onClick: () => navigate("/contacts") },
    { label: "Clients", value: stats.clients, icon: Handshake, onClick: () => navigate("/contacts?status=client") },
    { label: "Tasks", value: stats.tasks, icon: ListChecks, onClick: () => navigate("/tasks") },
    { label: "Credits left", value: stats.creditsRemaining, icon: Zap, onClick: () => navigate("/settings?tab=billing") },
  ];

  const firstName = userData?.user?.name?.split(' ')[0] || '';

  // Track chat mode entrance for animation
  const [chatModeEntered, setChatModeEntered] = useState(false);

  useEffect(() => {
    if (isChatMode && !chatModeEntered) {
      // Small delay to trigger the entrance animation
      const timer = setTimeout(() => setChatModeEntered(true), 50);
      return () => clearTimeout(timer);
    } else if (!isChatMode) {
      setChatModeEntered(false);
    }
  }, [isChatMode, chatModeEntered]);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Main Content */}
      {isChatMode ? (
        /* Chat Mode - Full height flex layout */
        <div className="flex flex-col h-full min-h-0">
          {/* Exit button in chat mode */}
          <div
            className="px-6 pt-4 pb-2 flex-shrink-0"
            style={{
              opacity: chatModeEntered ? 1 : 0,
              transition: 'opacity 400ms ease-out',
            }}
          >
            <div className="max-w-2xl mx-auto flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleExitChat}
                className="text-gray-500 hover:text-gray-900 hover:bg-gray-100 h-8 px-3 text-xs gap-1"
              >
                <X className="h-3.5 w-3.5" />
                Exit Chat
              </Button>
            </div>
          </div>

          {/* Chat Messages - Scrollable area */}
          <div
            className="flex-1 overflow-y-auto min-h-0 px-6"
            style={{
              opacity: chatModeEntered ? 1 : 0,
              transition: 'opacity 400ms ease-out',
              transitionDelay: '100ms',
            }}
          >
            <div className="max-w-2xl mx-auto pb-4">
              <HomeAssistantChat
                messages={chatMessages}
                isStreaming={isStreaming}
                streamingContent={streamingContent}
                toolStatus={toolStatus}
                agentWork={agentWork}
                interactiveOptions={interactiveOptions}
                generationSteps={generationSteps}
                onAction={handleGenerateAction}
                onInteractiveSelect={handleInteractiveSelect}
                onInteractiveDismiss={handleInteractiveDismiss}
                onInteractiveSendMessage={handleInteractiveSendMessage}
                onOpenComposer={setComposerDraft}
              />
            </div>
          </div>

          {/* Email Composer Panel (slide-in from right) */}
          {composerDraft && (
            <EmailComposerPanel
              draft={composerDraft}
              onClose={() => setComposerDraft(null)}
              onSent={() => setComposerDraft(null)}
            />
          )}

          {/* Chat Input at Bottom - Hidden when interactive options popover is showing */}
          {!(interactiveOptions && interactiveOptions.status === 'pending') && (
          <div
            className="px-6 py-6 flex-shrink-0 bg-white border-t border-gray-200/50"
            style={{
              opacity: chatModeEntered ? 1 : 0,
              transform: chatModeEntered ? 'translateY(0)' : 'translateY(16px)',
              transition: 'opacity 400ms ease-out, transform 400ms ease-out',
              transitionDelay: '50ms',
            }}
          >
            <div className="max-w-2xl mx-auto">
              <HomeChatInput
                onSend={handleSendMessage}
                onUpload={handleUpload}
                onAddUrl={handleAddUrl}
                onAddNote={handleAddNote}
                isCreationMode={isCreationMode}
                isLoading={isStreaming}
                placeholder={isCreationMode ? "Describe your project or add context..." : "Message..."}
              />
            </div>
          </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto flex flex-col">
          {/* Centered content */}
          <div className="flex-1 flex flex-col items-center justify-center px-6 pb-20">
            <div
              className="w-full max-w-2xl space-y-5"
              style={{
                opacity: chatTransitioning ? 0 : 1,
                transform: chatTransitioning ? 'translateY(-8px)' : 'translateY(0)',
                transition: 'opacity 300ms ease-out, transform 300ms ease-out',
              }}
            >
              {/* Greeting row with inbox button */}
              <div
                className="flex items-center justify-between"
                style={{
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? 'translateY(0)' : 'translateY(8px)',
                  transition: 'opacity 500ms ease-out, transform 500ms ease-out',
                }}
              >
                <h1 className="text-xl font-semibold text-gray-900">
                  {getGreeting()}{firstName ? `, ${firstName}` : ''}
                </h1>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("/inbox")}
                  className="relative text-gray-500 hover:text-gray-900 hover:bg-gray-100 h-8 w-8 p-0"
                  title="Inbox"
                >
                  <Inbox className="h-4 w-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-semibold text-white">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </Button>
              </div>

              {/* Chat Input */}
              <div
                style={{
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? 'translateY(0)' : 'translateY(12px)',
                  transition: 'opacity 500ms ease-out, transform 500ms ease-out',
                  transitionDelay: '75ms',
                }}
              >
                <HomeChatInput
                  onSend={handleSendMessage}
                  onUpload={handleUpload}
                  onAddUrl={handleAddUrl}
                  onAddNote={handleAddNote}
                  isLoading={isStreaming}
                  placeholder="Ask anything..."
                  autoFocus
                />
              </div>

              {/* Prompt tags */}
              <div
                className="flex flex-wrap gap-2"
                style={{
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? 'translateY(0)' : 'translateY(8px)',
                  transition: 'opacity 500ms ease-out, transform 500ms ease-out',
                  transitionDelay: '150ms',
                }}
              >
                {[
                  { label: "Analyse inbound leads", prompt: "Analyse my last 50 inbound leads from our website" },
                  { label: "Stale deals check", prompt: "Which deals in my pipeline haven't moved in 14 days?" },
                  { label: "Draft follow-ups", prompt: "Draft follow-up emails for my top 3 open proposals" },
                  { label: "Pipeline summary", prompt: "Summarise my pipeline by stage and flag any risks" },
                  { label: "Debrief a contact", prompt: "Debrief me on the most recent activity for my top contact" },
                ].map((tag) => (
                  <button
                    key={tag.label}
                    type="button"
                    onClick={() => handleSendMessage(tag.prompt)}
                    className="px-3 py-1.5 rounded-full border border-gray-200 text-xs text-gray-500 hover:text-gray-900 hover:border-gray-400 hover:bg-gray-50 transition-colors duration-150"
                  >
                    {tag.label}
                  </button>
                ))}
              </div>

              {/* Metric Cards - 2x2 Grid */}
              {false && (
              <div className="grid grid-cols-2 gap-3">
                {metricCards.map((card, index) => (
                  <div
                    key={card.label}
                    style={{
                      opacity: mounted ? 1 : 0,
                      transform: mounted ? 'translateY(0)' : 'translateY(16px)',
                      transition: 'opacity 500ms ease-out, transform 500ms ease-out',
                      transitionDelay: `${150 + index * 50}ms`,
                    }}
                  >
                    <HomeMetricCard
                      label={card.label}
                      value={card.value}
                      icon={card.icon}
                      isLoading={false}
                      onClick={card.onClick}
                      className="w-full"
                    />
                  </div>
                ))}
              </div>
              )}

              {/* Recent chats */}
              {chatSessions && chatSessions.sessions.filter(s => s.messages.length > 0).length > 0 && (
                <div
                  style={{
                    opacity: mounted ? 1 : 0,
                    transform: mounted ? 'translateY(0)' : 'translateY(8px)',
                    transition: 'opacity 500ms ease-out, transform 500ms ease-out',
                    transitionDelay: '200ms',
                  }}
                >
                  <p className="text-xs text-gray-400 mb-2 px-1">Recent</p>
                  <div className="space-y-0.5">
                    {chatSessions.sessions
                      .filter(s => s.messages.length > 0)
                      .slice(0, 3)
                      .map((session) => (
                        <button
                          key={session.id}
                          type="button"
                          onClick={() => {
                            chatSessions.selectSession(session.id);
                            setIsChatMode(true);
                          }}
                          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left hover:bg-gray-50 transition-colors group"
                        >
                          <MessageSquare className="h-3 w-3 text-gray-300 flex-shrink-0 group-hover:text-gray-400 transition-colors" />
                          <span className="text-xs text-gray-400 truncate group-hover:text-gray-600 transition-colors">
                            {session.title}
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;

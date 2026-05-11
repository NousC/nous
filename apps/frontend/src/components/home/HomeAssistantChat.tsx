import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Sparkles, ChevronRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { InteractiveOptionsCard } from "@/components/ai-writer/InteractiveOptionsCard";
import type { InteractiveOption } from "@/components/ai-writer/InteractiveOptionsCard";
import type { ThinkingStep } from "@/components/ai-writer/ThinkingIndicator";
import { AgentWorkingDropdown } from "@/components/home/AgentWorkingDropdown";
import type { AgentWorkingState } from "@/components/home/AgentWorkingDropdown";
import { EmailDraftCard } from "@/components/home/EmailDraftCard";
import type { EmailDraft } from "@/components/home/EmailDraftCard";
import { DottedSpinner } from "@/components/ai-writer/ToolCallCard";

export type { EmailDraft };

export interface ChatMessageAction {
  type: "generate_proposal" | "generate_template";
  templateId: string;
  label: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  action?: ChatMessageAction;
  agentWork?: AgentWorkingState;
  generationSteps?: string[];
  emailDraft?: EmailDraft;
  // Preserves tool_use/tool_result blocks from the API so the next turn has full context
  structuredHistory?: Array<{ role: string; content: any }>;
}

interface HomeAssistantChatProps {
  messages: ChatMessage[];
  isStreaming?: boolean;
  streamingContent?: string;
  toolStatus?: string | null;
  agentWork?: AgentWorkingState | null;
  interactiveOptions?: { options: InteractiveOption[]; status: 'pending' | 'selected' | 'dismissed' } | null;
  generationSteps?: ThinkingStep[];
  onAction?: (action: ChatMessageAction) => void;
  onInteractiveSelect?: (optionId: string) => void;
  onInteractiveDismiss?: () => void;
  onInteractiveSendMessage?: (message: string) => void;
  onOpenComposer?: (draft: EmailDraft) => void;
  className?: string;
}

export function HomeAssistantChat({
  messages,
  isStreaming = false,
  streamingContent = "",
  toolStatus = null,
  agentWork = null,
  interactiveOptions = null,
  generationSteps = [],
  onAction,
  onInteractiveSelect,
  onInteractiveDismiss,
  onInteractiveSendMessage,
  onOpenComposer,
  className,
}: HomeAssistantChatProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollThrottleRef = useRef<number>(0);

  // Auto-scroll: instant for new messages, throttled during streaming
  useEffect(() => {
    if (!bottomRef.current) return;

    // For new messages and tool status changes — scroll immediately
    bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, toolStatus]);

  // Separate effect for streaming — throttled to avoid scroll fighting
  useEffect(() => {
    if (!streamingContent || !bottomRef.current) return;

    const now = Date.now();
    // Only scroll every 500ms during streaming to prevent jumpiness
    if (now - scrollThrottleRef.current < 500) return;
    scrollThrottleRef.current = now;

    bottomRef.current.scrollIntoView({ behavior: 'instant', block: 'end' });
  }, [streamingContent]);

  return (
    <div
      className={cn(
        "flex flex-col gap-6",
        className
      )}
    >
      {messages.map((message, index) => (
        <MessageBubble key={index} message={message} onAction={onAction} onOpenComposer={onOpenComposer} />
      ))}

      {/* Agent working dropdown (tool calls) */}
      {agentWork && agentWork.steps.length > 0 && (
        <div className="py-1">
          <AgentWorkingDropdown agentWork={agentWork} />
        </div>
      )}

      {/* Generation progress — matches tool call style */}
      {generationSteps.length > 0 && (
        <GenerationProgressDropdown step={generationSteps[0]} />
      )}

      {/* Simple tool status fallback (for non-agent tools) */}
      {toolStatus && !agentWork && generationSteps.length === 0 && (
        <div className="flex items-center gap-2 py-2 px-1">
          <Loader2 className="h-3.5 w-3.5 text-teal-500 animate-spin" />
          <span className="text-xs text-gray-500 font-medium">{toolStatus}</span>
        </div>
      )}

      {/* Thinking indicator — shows when streaming but no content yet */}
      {isStreaming && !streamingContent && !toolStatus && (
        <div className="flex gap-4 py-2">
          <div className="flex items-center gap-1.5 px-1">
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '600ms' }} />
          </div>
        </div>
      )}

      {/* Streaming message — appears once content starts flowing */}
      {isStreaming && streamingContent && (
        <MessageBubble
          message={{ role: "assistant", content: streamingContent }}
          isStreaming
        />
      )}

      {/* Interactive options popover (Generate Proposal / Something else) */}
      {interactiveOptions && interactiveOptions.status === 'pending' && (
        <div className="py-2">
          <InteractiveOptionsCard
            options={interactiveOptions.options}
            status={interactiveOptions.status}
            onSelect={(optionId) => onInteractiveSelect?.(optionId)}
            onSkip={() => onInteractiveDismiss?.()}
            onSendMessage={(msg) => onInteractiveSendMessage?.(msg)}
          />
        </div>
      )}

      {/* Scroll anchor */}
      <div ref={bottomRef} />
    </div>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  onAction?: (action: ChatMessageAction) => void;
  onOpenComposer?: (draft: EmailDraft) => void;
}

// Render markdown-like formatting (bold + links)
function renderMarkdown(text: string) {
  if (!text) return null;

  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let keyIndex = 0;

  // Match bold (**text**) and markdown links [text](url)
  const combinedRegex = /(\*\*|__)(.+?)\1|\[([^\]]+)\]\(([^)]+)\)/g;
  let match;

  while ((match = combinedRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }

    if (match[2]) {
      // Bold text
      parts.push(<strong key={`bold-${keyIndex++}`} className="font-semibold">{match[2]}</strong>);
    } else if (match[3] && match[4]) {
      // Markdown link [text](url)
      const linkText = match[3];
      const linkUrl = match[4];
      const isInternal = linkUrl.startsWith("/");
      parts.push(
        <a
          key={`link-${keyIndex++}`}
          href={linkUrl}
          className="text-teal-600 hover:text-teal-700 underline underline-offset-2 font-medium"
          {...(isInternal ? {} : { target: "_blank", rel: "noopener noreferrer" })}
        >
          {linkText}
        </a>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? <>{parts}</> : text;
}

// Format message with proper bullets, lists, and spacing
function formatMessageContent(text: string) {
  if (!text) return null;

  const lines = text.split('\n');
  const formatted: JSX.Element[] = [];
  let currentList: string[] = [];
  let listType: 'bullet' | 'number' | null = null;
  let paragraphLines: string[] = [];
  // Tracks how many numbered items have been rendered so far in the current
  // logical numbered sequence — lets us resume from the right number even
  // when bullet sub-lists temporarily interrupt the <ol>.
  let numberedItemsEmitted = 0;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    formatted.push(
      <p key={`paragraph-${formatted.length}`} className="text-sm text-foreground/90 leading-relaxed mb-1">
        {paragraphLines.map((line, idx) => (
          <span key={idx}>
            {renderMarkdown(line.trim())}
            {idx < paragraphLines.length - 1 && <br />}
          </span>
        ))}
      </p>
    );
    paragraphLines = [];
  };

  const flushList = (resetNumberedCounter = false) => {
    flushParagraph();
    if (currentList.length > 0) {
      if (listType === 'bullet') {
        formatted.push(
          <ul key={`list-${formatted.length}`} className="list-disc list-outside space-y-0.5 my-1 mb-2 ml-4 pl-4">
            {currentList.map((item, idx) => {
              const raw = item.replace(/^[-*•]\s+/, '');
              return (
                <li key={idx} className="text-sm text-foreground/90 leading-relaxed">
                  {renderMarkdown(raw.trim())}
                </li>
              );
            })}
          </ul>
        );
      } else if (listType === 'number') {
        const startAt = numberedItemsEmitted + 1;
        formatted.push(
          <ol key={`list-${formatted.length}`} start={startAt} className="list-decimal list-outside space-y-0.5 my-1 mb-2 ml-4 pl-4">
            {currentList.map((item, idx) => {
              const raw = item.replace(/^\d+\.\s*/, '');
              return (
                <li key={idx} className="text-sm text-foreground/90 leading-relaxed">
                  {renderMarkdown(raw.trim())}
                </li>
              );
            })}
          </ol>
        );
        numberedItemsEmitted += currentList.length;
      }
      currentList = [];
      listType = null;
    }
    if (resetNumberedCounter) numberedItemsEmitted = 0;
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // Handle markdown headers
    const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      if (listType !== null) flushList(true);
      flushParagraph();

      const level = headerMatch[1].length;
      const headerText = headerMatch[2];
      const headerClasses: Record<number, string> = {
        1: 'text-lg font-bold text-foreground mt-3 mb-2',
        2: 'text-base font-bold text-foreground mt-2 mb-1.5',
        3: 'text-sm font-semibold text-foreground mt-2 mb-1',
        4: 'text-sm font-medium text-foreground mt-1.5 mb-1',
        5: 'text-sm font-medium text-foreground mt-1.5 mb-1',
        6: 'text-xs font-medium text-foreground/90 mt-1 mb-0.5',
      };

      const HeaderTag = `h${level}` as keyof JSX.IntrinsicElements;
      formatted.push(
        <HeaderTag key={`header-${index}`} className={headerClasses[level] || headerClasses[4]}>
          {renderMarkdown(headerText)}
        </HeaderTag>
      );
      return;
    }

    // Bullet lists
    if (/^[-*•]\s+/.test(trimmed)) {
      if (listType !== 'bullet') {
        // Flush numbered items accumulated so far (keeps numberedItemsEmitted intact)
        flushList();
        listType = 'bullet';
      }
      currentList.push(trimmed);
      return;
    }

    // Numbered lists
    if (/^\d+\.\s+/.test(trimmed)) {
      if (listType !== 'number') {
        // Flush bullet items; don't reset the numbered counter so the next <ol> continues
        flushList();
        listType = 'number';
      }
      currentList.push(trimmed);
      return;
    }

    // Empty lines — skip (don't flush) if inside a list so spaced items stay together
    if (trimmed === '') {
      if (listType !== null) return;
      flushParagraph();
      if (index < lines.length - 1 && formatted.length > 0) {
        formatted.push(<div key={`spacer-${index}`} className="h-2" />);
      }
      return;
    }

    // Regular text — flush list (and reset numbered counter since we've left the sequence)
    if (listType !== null) {
      flushList(true);
    }

    paragraphLines.push(line);
  });

  flushList();

  return formatted.length > 0 ? formatted : null;
}

// --- Phase detection for generation progress bullets ---

interface ProgressPhase {
  label: string;
  icon: string;
  bullets: string[];
  status: 'active' | 'completed';
}

function groupBulletsIntoPhases(bullets: string[], isCompleted: boolean): ProgressPhase[] {
  const phases: ProgressPhase[] = [];
  let currentPhase: ProgressPhase | null = null;

  const detectPhase = (bullet: string): { label: string; icon: string } => {
    const b = bullet.toLowerCase();
    if (b.includes('analyz') || b.includes('structure') || b.includes('playbook') || b.includes('planning') || b.includes('detecting'))
      return { label: 'Planning', icon: '⚙️' };
    if (b.includes('layout') || b.includes('page') || b.includes('skeleton') || b.includes('creating page'))
      return { label: 'Building Layout', icon: '📐' };
    if (b.includes('writing') || b.includes('generating') || b.includes('content') || b.includes('proposal'))
      return { label: 'Writing Content', icon: '✍️' };
    if (b.includes('background') || b.includes('design') || b.includes('visual') || b.includes('color') || b.includes('theme') || b.includes('graphic'))
      return { label: 'Applying Design', icon: '🎨' };
    if (b.includes('review') || b.includes('improv') || b.includes('final') || b.includes('polish') || b.includes('quality'))
      return { label: 'Reviewing', icon: '✅' };
    return { label: 'Processing', icon: '🔄' };
  };

  for (const bullet of bullets) {
    const { label, icon } = detectPhase(bullet);
    if (!currentPhase || currentPhase.label !== label) {
      if (currentPhase) {
        currentPhase.status = 'completed';
      }
      currentPhase = { label, icon, bullets: [bullet], status: 'active' };
      phases.push(currentPhase);
    } else {
      currentPhase.bullets.push(bullet);
    }
  }

  if (isCompleted) {
    phases.forEach(p => p.status = 'completed');
  } else if (phases.length > 1) {
    // All phases except last are completed
    for (let i = 0; i < phases.length - 1; i++) {
      phases[i].status = 'completed';
    }
  }

  return phases;
}

// --- Live generation progress dropdown (matches tool call style) ---

function GenerationProgressDropdown({ step }: { step: ThinkingStep }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const isCompleted = step.status === 'completed';
  const bullets = step.progressBullets || [];
  const phases = groupBulletsIntoPhases(bullets, isCompleted);

  const summary = isCompleted
    ? `Template generated (${bullets.length} steps)`
    : step.label || 'Generating template...';

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="py-1"
    >
      {/* Header — collapsible like tool calls */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-left cursor-pointer group w-full"
      >
        <span
          className="text-sm transition-colors"
          style={{ color: isCompleted ? '#8b9179' : '#6b7264' }}
        >
          {summary}
        </span>
        <motion.span
          animate={{ rotate: isExpanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          style={{ color: '#8b9179' }}
          className="inline-flex"
        >
          <ChevronRight className="w-4 h-4" />
        </motion.span>
        {!isCompleted && (
          <span className="inline-flex ml-0.5">
            <DottedSpinner />
          </span>
        )}
      </button>

      {/* Expandable phases */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-1 space-y-0">
              {phases.map((phase, i) => (
                <div key={i} className="relative mt-3 first:mt-1">
                  {/* Phase header */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm flex-shrink-0">{phase.icon}</span>
                    <span className="text-sm text-gray-600">{phase.label}</span>
                    {phase.status === 'active' && !isCompleted && (
                      <DottedSpinner className="flex-shrink-0" />
                    )}
                  </div>
                  {/* Phase bullets with left border */}
                  <div className="ml-2.5 pl-4 border-l-2 border-gray-200 mt-1 pb-1">
                    {phase.status === 'completed' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-gray-500 bg-gray-100 rounded">
                        <Check className="w-3 h-3" />
                        Done
                      </span>
                    ) : (
                      <div className="space-y-0.5">
                        {phase.bullets.slice(-3).map((bullet, j) => (
                          <span key={j} className="block text-xs text-gray-400">{bullet}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Footer when all done */}
              {isCompleted && (
                <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-100">
                  <Check className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-500">Done</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function GenerationStepsCollapsed({ steps }: { steps: string[] }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const phases = groupBulletsIntoPhases(steps, true);

  return (
    <div className="mb-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-left cursor-pointer group w-full"
      >
        <span className="text-sm" style={{ color: '#8b9179' }}>
          Template generated ({steps.length} steps)
        </span>
        <motion.span
          animate={{ rotate: isExpanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          style={{ color: '#8b9179' }}
          className="inline-flex"
        >
          <ChevronRight className="w-4 h-4" />
        </motion.span>
      </button>
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-1 space-y-0">
              {phases.map((phase, i) => (
                <div key={i} className="relative mt-3 first:mt-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm flex-shrink-0">{phase.icon}</span>
                    <span className="text-sm text-gray-600">{phase.label}</span>
                  </div>
                  <div className="ml-2.5 pl-4 border-l-2 border-gray-200 mt-1 pb-1">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-gray-500 bg-gray-100 rounded">
                      <Check className="w-3 h-3" />
                      Done
                    </span>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-100">
                <Check className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-500">Done</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MessageBubble({ message, isStreaming = false, onAction, onOpenComposer }: MessageBubbleProps) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex gap-4 justify-end py-2">
        <div className="flex-1 space-y-1 flex flex-col items-end max-w-[75%]">
          <div className="rounded-2xl rounded-tr-sm px-4 py-2.5 bg-[#E8E8E8]">
            <div className="text-sm text-foreground leading-relaxed">
              {message.content}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 py-2">
      <div className="flex-1 space-y-2 max-w-[75%]">
        {/* Generation steps (persisted with message — collapsed) */}
        {message.generationSteps && message.generationSteps.length > 0 && (
          <GenerationStepsCollapsed steps={message.generationSteps} />
        )}
        {/* Agent working dropdown (persisted with message — collapsed) */}
        {message.agentWork && message.agentWork.steps.length > 0 && (
          <AgentWorkingDropdown agentWork={message.agentWork} defaultExpanded={false} />
        )}
        {/* Email draft card */}
        {message.emailDraft && (
          <div className="my-2">
            <EmailDraftCard
              draft={message.emailDraft}
              onOpen={() => onOpenComposer?.(message.emailDraft!)}
            />
          </div>
        )}
        <div className="text-sm text-foreground/90 leading-relaxed">
          {formatMessageContent(message.content)}
        </div>
        {message.action && onAction && (
          <button
            onClick={() => onAction(message.action!)}
            className="mt-2 inline-flex items-center gap-2 px-4 py-2.5 bg-orange-500 text-white text-sm font-medium rounded-xl hover:bg-orange-600 active:bg-orange-700 transition-colors shadow-sm"
          >
            <Sparkles className="h-4 w-4" />
            {message.action.label}
          </button>
        )}
      </div>
    </div>
  );
}

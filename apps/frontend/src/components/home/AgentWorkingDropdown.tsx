import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  Check,
  AlertCircle,
  Search,
  User,
  Building2,
  Briefcase,
  Mail,
  Video,
  Calendar,
  Users,
  FileText,
  ListChecks,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DottedSpinner } from '@/components/ai-writer/ToolCallCard';

// --- Types ---

export interface AgentStep {
  id: string;
  tool: string;
  provider?: string | null;
  label: string;
  input?: Record<string, any>;
  status: 'running' | 'completed' | 'failed';
  result?: any;
  resultSummary?: string;
  startedAt: number;
  completedAt?: number;
}

export interface AgentWorkingState {
  isActive: boolean;
  steps: AgentStep[];
}

// Internal tools that should never surface in the UI
const SILENT_TOOLS = new Set([
  'get_memories', 'search', 'list_contacts',
]);

// --- Provider display helpers ---

const providerIcons: Record<string, string> = {
  hubspot: '/provider-logos/hubspot.svg',
  pipedrive: '/provider-logos/pipedrive.svg',
  clickup: '/provider-logos/clickup.svg',
  attio: '/provider-logos/attio.svg',
  fireflies: '/provider-logos/fireflies.svg',
  granola: '/provider-logos/granola.svg',
  fathom: '/provider-logos/fathom.svg',
  proply: '/newlogoP.png',
  gmail: '/provider-logos/gmail.svg',
  gmail_oauth: '/provider-logos/gmail.svg',
  smtp: '/provider-logos/smtp.svg',
};

const providerNames: Record<string, string> = {
  hubspot: 'HubSpot',
  pipedrive: 'Pipedrive',
  clickup: 'ClickUp',
  attio: 'Attio',
  fireflies: 'Fireflies',
  granola: 'Granola',
  fathom: 'Fathom',
  proply: 'Proply',
  crm: 'CRM',
  gmail: 'Gmail',
  gmail_oauth: 'Gmail',
  smtp: 'Email',
};

function getStepIcon(step: AgentStep) {
  if (step.provider && providerIcons[step.provider]) {
    return (
      <img
        src={providerIcons[step.provider]}
        alt={providerNames[step.provider] || step.provider}
        className="w-4 h-4 object-contain"
      />
    );
  }
  // Fallback icons by tool type
  if (step.tool === 'list_contacts') return <Users className="w-4 h-4 text-gray-500" />;
  if (step.tool === 'list_documents') return <FileText className="w-4 h-4 text-gray-500" />;
  return <Search className="w-4 h-4 text-gray-500" />;
}

function buildSummary(steps: AgentStep[]): string {
  const providers = new Set<string>();
  steps.forEach(s => {
    if (s.provider && s.provider !== 'proply') {
      providers.add(providerNames[s.provider] || s.provider);
    }
  });

  const allDone = steps.every(s => s.status !== 'running');
  const prefix = allDone ? 'Used tools' : 'Loading tools';

  if (providers.size > 0) {
    const names = Array.from(providers);
    if (names.length === 1) {
      return `${prefix}, used ${names[0]} integration`;
    }
    return `${prefix}, used ${names.join(' & ')} integrations`;
  }
  return prefix;
}

// --- Tool label formatting (Provider-action style) ---

const toolActionLabels: Record<string, string> = {
  search_crm: 'search',
  list_crm_records: 'list-records',
  draft_email: 'draft-email',
  create_crm_contact: 'create-contact',
  create_crm_deal: 'create-deal',
  update_crm_deal: 'update-deal',
  add_crm_note: 'add-note',
  query_meeting_notes: 'search-meetings',
  search_fireflies_meetings: 'search-meetings',
  search_fathom_meetings: 'search-recordings',
  list_contacts: 'list-contacts',
  list_documents: 'list-documents',
  create_proposal: 'create-proposal',
  create_template: 'create-template',
};

function getToolLabel(step: AgentStep): string {
  const provider = step.provider && providerNames[step.provider]
    ? providerNames[step.provider]
    : null;
  const action = toolActionLabels[step.tool] || step.tool.replace(/_/g, '-');

  if (provider) {
    return `${provider}-${action}`;
  }
  return action;
}

// --- AgentStepRow ---

function AgentStepRow({ step }: { step: AgentStep }) {
  const [expanded, setExpanded] = useState(false);
  const isDone = step.status === 'completed' || step.status === 'failed';
  const hasExpandableResult = isDone && step.result && !step.result.error && (
    step.result.results?.length > 0 ||
    step.result.documents?.length > 0 ||
    step.result.meetings?.length > 0 ||
    step.result.transcripts?.length > 0 ||
    step.result.success
  );

  return (
    <div className="relative mt-5 first:mt-2">
      {/* Tool label row: icon + Provider-action */}
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-5 h-5 flex-shrink-0">
          {getStepIcon(step)}
        </div>
        <span className="text-sm text-gray-600">
          {getToolLabel(step)}
        </span>
        {step.status === 'running' && (
          <DottedSpinner className="flex-shrink-0" />
        )}
      </div>

      {/* Result badge below, with left border line — like Claude */}
      <div className="ml-2.5 pl-4 border-l-2 border-gray-200 mt-1 pb-3">
        {step.status === 'running' && (
          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium text-gray-400 bg-gray-50 rounded">
            Running...
          </span>
        )}
        {isDone && (
          <button
            onClick={() => hasExpandableResult && setExpanded(!expanded)}
            className={cn(
              "inline-flex items-center px-2 py-0.5 text-xs font-medium rounded transition-colors",
              hasExpandableResult
                ? "text-gray-500 bg-gray-100 hover:bg-gray-200 cursor-pointer"
                : step.status === 'failed'
                  ? "text-red-500 bg-red-50"
                  : "text-gray-500 bg-gray-100"
            )}
          >
            {step.status === 'failed' ? 'Error' : 'Result'}
          </button>
        )}

        {/* Expandable result content */}
        <AnimatePresence>
          {expanded && hasExpandableResult && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="pt-2">
                <StepResultContent step={step} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// --- Result renderers ---

function StepResultContent({ step }: { step: AgentStep }) {
  const result = step.result;
  if (!result) return null;

  // CRM search results (contacts/deals)
  if (result.results && Array.isArray(result.results)) {
    return (
      <div className="space-y-1.5">
        {result.results.slice(0, 3).map((record: any, i: number) => (
          <div key={i} className="flex items-start gap-2.5 p-2 rounded-lg bg-gray-50 border border-gray-100">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-white border border-gray-100 flex-shrink-0">
              {record.type === 'deal' ? (
                <Briefcase className="h-3.5 w-3.5 text-gray-500" />
              ) : record.type === 'company' ? (
                <Building2 className="h-3.5 w-3.5 text-gray-500" />
              ) : (
                <User className="h-3.5 w-3.5 text-gray-500" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{record.name || record.title}</p>
              {record.company && <p className="text-xs text-gray-500 truncate">{record.company}</p>}
              <div className="flex items-center gap-3 mt-0.5">
                {record.email && (
                  <span className="flex items-center gap-1 text-xs text-gray-400">
                    <Mail className="h-3 w-3" />
                    <span className="truncate max-w-[140px]">{record.email}</span>
                  </span>
                )}
                {(record.dealValue || record.value) && (
                  <span className="text-xs font-medium text-green-600">
                    {record.dealCurrency || '$'}{(record.dealValue || record.value).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
        {result.results.length > 3 && (
          <p className="text-xs text-gray-400 pl-1">+{result.results.length - 3} more</p>
        )}
      </div>
    );
  }

  // Document list results
  if (result.documents && Array.isArray(result.documents)) {
    return (
      <div className="space-y-1.5">
        {result.documents.slice(0, 3).map((doc: any, i: number) => (
          <div key={i} className="flex items-center gap-2.5 p-2 rounded-lg bg-gray-50 border border-gray-100">
            <FileText className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{doc.name}</p>
              <p className="text-xs text-gray-500">{doc.template_type || 'document'} &middot; {doc.status || 'draft'}</p>
            </div>
          </div>
        ))}
        {result.documents.length > 3 && (
          <p className="text-xs text-gray-400 pl-1">+{result.documents.length - 3} more</p>
        )}
      </div>
    );
  }

  // Meeting results (Granola / Fathom)
  if (result.meetings && Array.isArray(result.meetings)) {
    return <MeetingsList meetings={result.meetings} />;
  }

  // Transcript results (Fireflies)
  if (result.transcripts && Array.isArray(result.transcripts)) {
    return <MeetingsList meetings={result.transcripts} />;
  }

  // Success message (create/update actions)
  if (result.success && result.message) {
    return (
      <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50 border border-green-100">
        <Check className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
        <p className="text-sm text-green-800">{result.message}</p>
      </div>
    );
  }

  // Fallback: show summary
  if (step.resultSummary) {
    return <p className="text-xs text-gray-500">{step.resultSummary}</p>;
  }

  return null;
}

function MeetingsList({ meetings }: { meetings: any[] }) {
  return (
    <div className="space-y-1.5">
      {meetings.slice(0, 3).map((m: any, i: number) => (
        <div key={i} className="flex items-start gap-2.5 p-2 rounded-lg bg-gray-50 border border-gray-100">
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-white border border-gray-100 flex-shrink-0">
            <Video className="h-3.5 w-3.5 text-gray-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{m.title}</p>
            <div className="flex items-center gap-3 mt-0.5">
              {m.date && (
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <Calendar className="h-3 w-3" />
                  <span>{new Date(m.date).toLocaleDateString()}</span>
                </span>
              )}
              {m.participants?.length > 0 && (
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <Users className="h-3 w-3" />
                  <span>{m.participants.length}</span>
                </span>
              )}
            </div>
            {m.summary && (
              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{m.summary}</p>
            )}
          </div>
        </div>
      ))}
      {meetings.length > 3 && (
        <p className="text-xs text-gray-400 pl-1">+{meetings.length - 3} more</p>
      )}
    </div>
  );
}

// --- Main Dropdown ---

interface AgentWorkingDropdownProps {
  agentWork: AgentWorkingState;
  defaultExpanded?: boolean;
}

export function AgentWorkingDropdown({ agentWork, defaultExpanded }: AgentWorkingDropdownProps) {
  const visibleSteps = agentWork.steps.filter(s => !SILENT_TOOLS.has(s.tool));
  const hasSteps = visibleSteps.length > 0;
  const allDone = visibleSteps.every(s => s.status !== 'running');
  const [isExpanded, setIsExpanded] = useState(defaultExpanded ?? !allDone);

  if (!hasSteps) return null;

  const summary = buildSummary(visibleSteps);

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mb-2"
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-left cursor-pointer group w-full"
      >
        <span
          className="text-sm transition-colors"
          style={{ color: allDone ? '#8b9179' : '#6b7264' }}
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

        {/* Show spinner in header when any step is running */}
        {!allDone && (
          <span className="inline-flex ml-0.5">
            <DottedSpinner />
          </span>
        )}
      </button>

      {/* Expandable body with all steps */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-1 ml-0 space-y-0">
              {visibleSteps.map((step) => (
                <AgentStepRow key={step.id} step={step} />
              ))}

              {/* Footer: Done when all complete */}
              {allDone && (
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

export default AgentWorkingDropdown;

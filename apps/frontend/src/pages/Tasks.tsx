import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Play, Trash2, Eye, MoreHorizontal, Search, AlertTriangle, Globe, MailOpen, RotateCcw, PhoneCall, Users, Zap, Clock, ArrowRight, ChevronRight, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { toast } from "@/components/ui/sonner";
import { formatDistanceToNow } from "date-fns";

interface Task {
  id: string;
  name: string;
  description: string | null;
  task_summary: string | null;
  display_mode: string;
  is_active: boolean;
  trigger_type: string;
  total_runs: number;
  successful_runs: number;
  failed_runs: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
  definition?: {
    steps?: {
      type?: string;
      category?: string;
      provider_id?: string;
      provider_logo?: string;
      config?: {
        action?: string;
        settings?: { provider?: string };
      };
    }[];
  };
}

// Extract unique provider logos from workflow steps
function getTaskLogos(task: Task): string[] {
  const steps = task.definition?.steps || [];
  const logos: string[] = [];
  const seen = new Set<string>();

  for (const step of steps) {
    let logo: string | null = null;

    // Direct provider_logo
    if (step.provider_logo) {
      logo = step.provider_logo;
    }
    // Trigger-specific logos (Fathom, Fireflies)
    else if (step.type === "trigger" && step.config?.action) {
      const action = step.config.action;
      if (action === "fathom_meeting") logo = "/provider-logos/fathom.svg";
      else if (action === "discover_call") logo = "/provider-logos/fireflies.svg";
    }
    // Action-based detection
    else if (step.config?.action) {
      const action = step.config.action;
      if (action === "send_email") logo = "/provider-logos/gmail.svg";
      else if (action === "http_request") logo = "/provider-logos/http.svg";
      else if (action?.startsWith("stripe_")) logo = "/provider-logos/stripe.svg";
      else if (action === "create_document" || action === "generate_proposal" || action === "export_pdf") logo = "/newlogoP.png";
      else if (action === "slack_message") logo = "/provider-logos/slack.svg";
      else if (action === "ai_call") {
        const provider = step.config.settings?.provider;
        if (provider === "anthropic") logo = "/provider-logos/anthropic.svg";
        else if (provider === "openai") logo = "/provider-logos/openai.svg";
        else if (provider === "gemini" || provider === "google") logo = "/provider-logos/gemini.svg";
      }
    }
    // Category fallback
    if (!logo && step.category === "assetly") logo = "/newlogoP.png";
    if (!logo && step.category === "provider" && step.provider_id) {
      logo = `/provider-logos/${step.provider_id}.svg`;
    }

    // Skip duplicates (triggers with logos like Fathom/Fireflies are included)
    if (logo && !seen.has(logo)) {
      seen.add(logo);
      logos.push(logo);
    }
  }

  return logos;
}

const TRIGGER_LABELS: Record<string, string> = {
  webhook: "Webhook",
  schedule: "Scheduled",
  document_signed: "Document signed",
  form_submitted: "Form submitted",
  manual: "Manual",
  discover_call: "Fireflies",
  fathom_meeting: "Fathom",
};

const Tasks = () => {
  const navigate = useNavigate();
  const { userData, session } = useAuth();
  const { loading: accessLoading, hasWorkflowsAccess } = useFeatureAccess();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [contentMounted, setContentMounted] = useState(false);
  const [showTaskModal, setShowTaskModal]   = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [creatingTask, setCreatingTask]     = useState(false);

  const TASK_TEMPLATES = [
    {
      id: 'website_inbound_email', Icon: Globe,
      name: 'Website Inbound Follow-up',
      description: 'Visitor identified on your site → assistant creates contact & sends personalized outreach',
      triggerType: 'rb2b_webhook',
      steps: [
        { logo: '/provider-logos/rb2b.svg', label: 'Visitor identified' },
        { wait: '10 minutes' },
        { logo: '/newlogoP.png', label: 'Assistant' },
      ],
    },
    {
      id: 'cold_outreach_followup', Icon: MailOpen,
      name: 'Cold Outreach Follow-up',
      description: 'Positive reply in Instantly → assistant sends warm follow-up email',
      triggerType: 'instantly_webhook',
      steps: [
        { logo: '/provider-logos/instantly.svg', label: 'Positive reply' },
        { wait: '7 minutes' },
        { logo: '/newlogoP.png', label: 'Assistant' },
      ],
    },
    {
      id: 'blank', Icon: Plus,
      name: 'Start from Scratch',
      description: 'Build a fully custom task in the task builder',
      triggerType: 'manual',
      steps: [] as Array<{ logo: string; label: string } | { wait: string }>,
    },
  ] as const;

  const buildTemplateSteps = (id: string): { steps: any[]; triggerType: string } => {
    const t = Date.now();
    const base = (order: number, extra: object) => ({
      field_mappings: {}, expressions: {},
      ...extra,
      id: `step-${t + order}`,
      order,
    });

    if (id === 'website_inbound_email') {
      return {
        triggerType: 'rb2b_webhook',
        steps: [
          base(0, {
            type: 'trigger', category: 'trigger',
            name: 'Visitor Identified (RB2B)',
            config: { action: 'rb2b_webhook', settings: {} },
            outputs: { schema: {} },
          }),
          base(1, {
            type: 'utility', category: 'utility',
            name: 'Wait 10 minutes',
            config: { action: 'wait', settings: { duration_ms: 600_000 } },
          }),
          base(2, {
            type: 'action', category: 'ai',
            name: 'Assistant',
            provider_logo: '/newlogoP.png',
            config: {
              action: 'assistant_call',
              settings: {
                model: 'claude-haiku-4-5-20251001',
                instructions: `A website visitor was just identified via RB2B. The trigger data contains their email, name, company, LinkedIn URL, and the page(s) they visited.

Step 1 — Look them up: Call get_contact with their email to check if they already exist in the CRM.

Step 2 — Save them: Call upsert_contact to create or update the contact with their name, company, and any other details from the trigger data.

Step 3 — Update their stage: Call update_pipeline_stage to move them to "aware" (they visited the site — first real signal).

Step 4 — Save a memory: Call save_contact_memory with a fact like "Visited [page name] via RB2B on [date]" so the agent has context next time.

Step 5 — Send the email: Call send_email via Gmail. Write a short, genuinely curious message — 2–3 sentences max. No pitch, no "just checking in", no formal opener. Reference the specific page they visited to show it's not a blast email. Examples by page:
- Pricing page: "Saw you were checking out our pricing — happy to walk you through what makes sense for your setup if helpful."
- Features/product page: "Noticed you were looking around [page name] — curious if you had any questions or if there's something specific you were trying to figure out."
- Blog/docs: "Saw you came across our [article/docs] — let me know if anything sparked questions."

Sign off with your name only. No subject line fluff like "Quick question" or "Following up". Keep the subject simple: "Hey [first name]" or just use their company context.`,
                tool_calls: [
                  { id: `tc-${t}`, platform: 'gmail', platform_label: 'Gmail', action: 'send_email', action_label: 'Send Email', logo: '/provider-logos/gmail.svg' },
                ],
              },
            },
            outputs: { schema: { response: { type: 'string' } } },
          }),
        ],
      };
    }

    if (id === 'cold_outreach_followup') {
      return {
        triggerType: 'instantly_webhook',
        steps: [
          base(0, {
            type: 'trigger', category: 'trigger',
            name: 'Positive Reply (Instantly)',
            config: { action: 'instantly_webhook', settings: {} },
            outputs: { schema: {} },
          }),
          base(1, { type: 'utility', category: 'utility', name: 'Wait 7 minutes', config: { action: 'wait', settings: { duration_ms: 420_000 } } }),
          base(2, {
            type: 'action', category: 'ai',
            name: 'Assistant',
            provider_logo: '/newlogoP.png',
            config: {
              action: 'assistant_call',
              settings: {
                model: 'claude-haiku-4-5-20251001',
                instructions: `A lead just replied positively to a cold outreach email sent via Instantly. The trigger data contains their email (lead_email), name (lead_name), company, the campaign name, and their reply text.

Step 1 — Look them up: Call get_contact with lead_email to check if they already exist.

Step 2 — Save them: Call upsert_contact to create or update them with their name, company, and source "instantly".

Step 3 — Update their stage: Call update_pipeline_stage to move them to "interested" — they replied positively, this is a real buying signal.

Step 4 — Save a memory: Call save_contact_memory with a fact like "Replied positively to [campaign_name] outreach — [brief summary of their reply]" so the context is preserved.

Step 5 — Send the follow-up: Call send_email via Gmail. Your one goal is to get a call booked. Rules:
- Acknowledge their reply warmly but briefly — one sentence max.
- Ask for a 15–20 min call to figure out if there's a fit.
- Either suggest 2–3 concrete time slots OR ask them to share their calendar link.
- Do NOT re-pitch the product. Do NOT attach anything. Do NOT use phrases like "circling back", "as per my last email", "hope this finds you well".
- Keep it to 3–4 sentences total. Conversational, direct.

Example tone: "Great to hear from you! Would love to connect for a quick 15 min call to see if we can help — are you free Thursday or Friday afternoon? Happy to work around your schedule."`,
                tool_calls: [
                  { id: `tc-${t}`, platform: 'gmail', platform_label: 'Gmail', action: 'send_email', action_label: 'Send Email', logo: '/provider-logos/gmail.svg' },
                ],
              },
            },
            outputs: { schema: { response: { type: 'string' } } },
          }),
        ],
      };
    }

    if (id === 'discovery_call_proposal') {
      return {
        triggerType: 'discover_call',
        steps: [
          base(0, {
            type: 'trigger', category: 'trigger',
            name: 'Call Transcribed (Fireflies)',
            config: { action: 'discover_call', settings: {} },
            outputs: { schema: {} },
          }),
          base(1, {
            type: 'action', category: 'ai',
            name: 'Assistant',
            provider_logo: '/newlogoP.png',
            config: {
              action: 'assistant_call',
              settings: {
                model: 'claude-haiku-4-5-20251001',
                instructions: `A discovery call was just transcribed. The meeting data is in the trigger (participants, transcript summary).

Log a "meeting" activity for the contact, move them to "evaluating" stage, then send a follow-up email: thank them for the call, recap the key pain points, explain how we can help, and suggest a next step. Professional but warm.`,
                tool_calls: [
                  { id: `tc-${t}`, platform: 'gmail', platform_label: 'Gmail', action: 'send_email', action_label: 'Send Email', logo: '/provider-logos/gmail.svg' },
                ],
              },
            },
            outputs: { schema: { response: { type: 'string' } } },
          }),
        ],
      };
    }

    if (id === 'linkedin_social_followup') {
      return {
        triggerType: 'webhook',
        steps: [
          base(0, {
            type: 'trigger', category: 'trigger',
            name: 'New Connection (LinkedIn)',
            config: { action: 'webhook', settings: {} },
            outputs: { schema: {} },
          }),
          base(1, {
            type: 'action', category: 'ai',
            name: 'Assistant',
            provider_logo: '/newlogoP.png',
            config: {
              action: 'assistant_call',
              settings: {
                model: 'claude-haiku-4-5-20251001',
                instructions: `A new LinkedIn connection just came in. Their details are in the trigger data.

Create or update them as a contact, log "Connected on LinkedIn", then send a short intro email. Don't pitch — just introduce yourself, mention you saw their profile, and open a conversation. 3–4 sentences max.`,
                tool_calls: [
                  { id: `tc-${t}`, platform: 'gmail', platform_label: 'Gmail', action: 'send_email', action_label: 'Send Email', logo: '/provider-logos/gmail.svg' },
                ],
              },
            },
            outputs: { schema: { response: { type: 'string' } } },
          }),
        ],
      };
    }

    // blank
    return { triggerType: 'manual', steps: [] };
  };

  const handlePickTemplate = async (tpl: typeof TASK_TEMPLATES[number]) => {
    if (!session?.access_token || !userData?.workspace?.id || creatingTask) return;
    setCreatingTask(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const { steps, triggerType } = buildTemplateSteps(tpl.id);

      const res = await fetch(`${apiUrl}/api/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          workspace_id: userData.workspace.id,
          name: tpl.id === 'blank' ? 'New task' : tpl.name,
          display_mode: 'task',
          trigger_type: triggerType,
          definition: { steps, variables: {} },
        }),
      });
      if (!res.ok) throw new Error('Failed to create task');
      const data = await res.json();
      setShowTaskModal(false);
      setSelectedTaskId(null);
      navigate(`/workflows/${data.workflow.id}/builder`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to create task');
    } finally {
      setCreatingTask(false);
    }
  };

  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => setContentMounted(true), 50);
      return () => clearTimeout(timer);
    } else {
      setContentMounted(false);
    }
  }, [loading]);

  useEffect(() => {
    if (userData?.workspace?.id && hasWorkflowsAccess) {
      loadTasks();
    }
  }, [userData?.workspace?.id, hasWorkflowsAccess]);

  useEffect(() => {
    if (!accessLoading && !hasWorkflowsAccess) {
      navigate('/');
    }
  }, [accessLoading, hasWorkflowsAccess, navigate]);

  if (!accessLoading && !hasWorkflowsAccess) return null;

  const loadTasks = async () => {
    if (!session?.access_token || !userData?.workspace?.id) return;

    setLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(
        `${apiUrl}/api/workflows?workspaceId=${userData.workspace.id}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      if (!response.ok) throw new Error("Failed to load tasks");
      const data = await response.json();
      setTasks(data.workflows || []);
    } catch (error: any) {
      console.error("Error loading tasks:", error);
      toast.error("Failed to load tasks");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (task: Task) => {
    if (!session?.access_token || !userData?.workspace?.id) return;

    setTogglingId(task.id);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/workflows/${task.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          workspace_id: userData.workspace.id,
          is_active: !task.is_active,
        }),
      });
      if (!response.ok) throw new Error("Failed to update task");
      setTasks(prev =>
        prev.map(t => (t.id === task.id ? { ...t, is_active: !t.is_active } : t))
      );
      toast.success(`Task ${task.is_active ? "paused" : "activated"}`);
    } catch (error: any) {
      toast.error(error.message || "Failed to update task");
    } finally {
      setTogglingId(null);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget || !session?.access_token || !userData?.workspace?.id) return;

    setDeleting(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(
        `${apiUrl}/api/workflows/${deleteTarget.id}?workspace_id=${userData.workspace.id}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      if (!response.ok) throw new Error("Failed to delete task");
      setTasks(prev => prev.filter(t => t.id !== deleteTarget.id));
      toast.success("Task deleted");
    } catch (error: any) {
      toast.error(error.message || "Failed to delete task");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleRunNow = async (task: Task) => {
    if (!session?.access_token || !userData?.workspace?.id) return;

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/workflows/${task.id}/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ workspace_id: userData.workspace.id, trigger_data: {} }),
      });
      if (!response.ok) throw new Error("Failed to run task");
      toast.success("Task executed successfully");
      await loadTasks();
    } catch (error: any) {
      toast.error(error.message || "Failed to run task");
    }
  };

  const handleCreateTask = async () => {
    if (!session?.access_token || !userData?.workspace?.id) return;

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/workflows`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          workspace_id: userData.workspace.id,
          name: `Task ${tasks.length + 1}`,
          description: "",
          display_mode: "task",
          trigger_type: "manual",
          definition: { steps: [], variables: {} },
        }),
      });
      if (!response.ok) throw new Error("Failed to create task");
      const data = await response.json();
      navigate(`/workflows/${data.workflow.id}/builder`);
    } catch (error: any) {
      toast.error(error.message || "Failed to create task");
    }
  };

  const filteredTasks = tasks.filter(t =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.task_summary?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="container mx-auto px-6 py-4 flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-white border-gray-200/60 hover:border-gray-300 rounded-xl transition-colors"
            />
          </div>

          <div className="flex-1" />

          <Button
            onClick={() => setShowTaskModal(true)}
            className="bg-gray-900 hover:bg-gray-800 rounded-xl"
          >
            <Plus className="w-4 h-4 mr-2" />
            New task
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="container mx-auto px-6">
          {loading ? (
            <div className="py-6 space-y-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-[72px] bg-gray-50/80 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : filteredTasks.length === 0 && tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[400px] rounded-2xl border border-dashed border-gray-200/80 bg-gray-50/50 mt-6">
              <div className="w-14 h-14 rounded-2xl bg-white border border-gray-200/60 shadow-sm flex items-center justify-center mb-4">
                <Plus className="h-6 w-6 text-gray-400" strokeWidth={1.5} />
              </div>
              <h3 className="text-[15px] font-medium text-gray-900 mb-1">No tasks yet</h3>
              <p className="text-sm text-gray-400 mb-5">
                Create your first automated task to get started
              </p>
              <Button
                onClick={() => setShowTaskModal(true)}
                className="bg-gray-900 hover:bg-gray-800 rounded-xl"
              >
                <Plus className="w-4 h-4 mr-2" />
                New task
              </Button>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <p className="text-sm text-gray-400">No tasks match your search</p>
            </div>
          ) : (
            <div className="py-6 space-y-2">
              {filteredTasks.map((task, index) => {
                const lastRun = task.last_run_at
                  ? formatDistanceToNow(new Date(task.last_run_at), { addSuffix: true })
                  : null;
                const logos = getTaskLogos(task);

                return (
                  <div
                    key={task.id}
                    className="group flex items-center gap-5 px-5 py-4 rounded-xl border border-gray-200/60 bg-white hover:border-gray-300 transition-all cursor-pointer"
                    onClick={() => navigate(`/workflows/${task.id}/builder`)}
                    style={{
                      opacity: contentMounted ? 1 : 0,
                      transform: contentMounted ? 'translateY(0)' : 'translateY(10px)',
                      transition: 'opacity 1s cubic-bezier(0.16, 1, 0.3, 1), transform 1s cubic-bezier(0.16, 1, 0.3, 1)',
                      transitionDelay: `${index * 60}ms`,
                    }}
                  >
                    {/* Toggle */}
                    <div onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={task.is_active}
                        onCheckedChange={() => handleToggleActive(task)}
                        disabled={togglingId === task.id}
                        className="data-[state=checked]:bg-emerald-500"
                      />
                    </div>

                    {/* Provider logos - overlapping stack */}
                    {logos.length > 0 ? (
                      <div className="flex items-center flex-shrink-0" style={{ width: `${24 + (logos.length - 1) * 18}px` }}>
                        {logos.slice(0, 5).map((logo, i) => (
                          <div
                            key={logo}
                            className="w-7 h-7 rounded-lg bg-white border border-gray-200/80 flex items-center justify-center shadow-sm"
                            style={{
                              marginLeft: i === 0 ? 0 : -6,
                              zIndex: logos.length - i,
                              position: 'relative',
                            }}
                          >
                            <img
                              src={logo}
                              alt=""
                              className="w-4 h-4 object-contain"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="w-7 h-7 rounded-lg bg-gray-50 border border-gray-200/60 flex items-center justify-center flex-shrink-0">
                        <div className="w-3 h-3 rounded-full bg-gray-200" />
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="text-[14px] font-medium text-gray-900 truncate">
                          {task.name}
                        </span>
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                          task.is_active
                            ? "bg-emerald-50 text-emerald-600"
                            : "bg-gray-100 text-gray-400"
                        }`}>
                          {task.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                      {(task.task_summary || task.description) && (
                        <p className="text-[13px] text-gray-400 truncate mt-0.5">
                          {task.task_summary || task.description}
                        </p>
                      )}
                    </div>

                    {/* Meta */}
                    <div className="hidden md:flex items-center gap-6 text-[12px] text-gray-400 flex-shrink-0">
                      <span className="w-24 text-right">{TRIGGER_LABELS[task.trigger_type] || "Manual"}</span>
                      <span className="w-16 text-right tabular-nums">
                        {task.total_runs > 0 ? `${task.total_runs} runs` : "No runs"}
                      </span>
                      <span className="w-24 text-right">
                        {lastRun || "Never run"}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-gray-400 hover:text-gray-600"
                        onClick={() => handleRunNow(task)}
                      >
                        <Play className="w-3.5 h-3.5" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-gray-400 hover:text-gray-600">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl border-gray-200/60">
                          <DropdownMenuItem
                            onClick={() => navigate(`/workflows/${task.id}/builder`)}
                            className="rounded-lg"
                          >
                            <Eye className="w-4 h-4 mr-2" />
                            View task
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleRunNow(task)}
                            className="rounded-lg"
                          >
                            <Play className="w-4 h-4 mr-2" />
                            Run now
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setDeleteTarget(task)}
                            className="text-red-600 focus:text-red-600 rounded-lg"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Delete Dialog */}
      {/* ── Task Template Modal ─────────────────── */}
      {showTaskModal && (() => {
        const selected = TASK_TEMPLATES.find(t => t.id === selectedTaskId) ?? null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]" onClick={() => { setShowTaskModal(false); setSelectedTaskId(null); }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
                <div>
                  <h2 className="text-[15px] font-semibold text-gray-900">Set up a task</h2>
                  <p className="text-[11px] text-gray-400 mt-0.5">Pick a template or start from scratch</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => selected && handlePickTemplate(selected)}
                    disabled={!selected || creatingTask}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all",
                      selected && !creatingTask ? "bg-gray-900 text-white hover:bg-gray-800" : "bg-gray-100 text-gray-400 cursor-not-allowed"
                    )}
                  >
                    {creatingTask ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    Create Task
                  </button>
                  <button onClick={() => { setShowTaskModal(false); setSelectedTaskId(null); }} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
                    <X className="h-4 w-4 text-gray-400" />
                  </button>
                </div>
              </div>
              <div className="overflow-y-auto max-h-[440px] divide-y divide-gray-50 pb-6">
                {TASK_TEMPLATES.map(tpl => {
                  const isOpen = selectedTaskId === tpl.id;
                  const TplIcon = tpl.Icon;
                  return (
                    <div key={tpl.id}>
                      <button
                        onClick={() => setSelectedTaskId(isOpen ? null : tpl.id)}
                        className={cn("w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors", isOpen ? "bg-gray-50" : "hover:bg-gray-50/70")}
                      >
                        <div className={cn("flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 transition-colors", isOpen ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500")}>
                          <TplIcon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-gray-900 leading-snug">{tpl.name}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{tpl.description}</p>
                        </div>
                        <ChevronRight className={cn("h-4 w-4 text-gray-300 flex-shrink-0 transition-transform", isOpen && "rotate-90")} />
                      </button>
                      {isOpen && (
                        <div className="px-5 pb-4 bg-gray-50">
                          {tpl.steps.length === 0 ? (
                            <p className="text-[12px] text-gray-400 py-2">Opens the task builder with a blank canvas.</p>
                          ) : (
                            <div className="flex flex-col gap-0 pt-1">
                              {tpl.steps.map((step, i) => (
                                <div key={i} className="flex items-center gap-3 relative">
                                  {i < tpl.steps.length - 1 && (
                                    <div className="absolute left-[14px] top-[28px] w-px h-[calc(100%-4px)]" style={{ background: '#e5e7eb' }} />
                                  )}
                                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white border border-gray-200 flex items-center justify-center z-10">
                                    <span className="text-[10px] font-semibold text-gray-400">{i + 1}</span>
                                  </div>
                                  <div className={cn("flex items-center gap-2 py-3", i < tpl.steps.length - 1 && "pb-3")}>
                                    {'wait' in step ? (
                                      <>
                                        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-gray-100">
                                          <Clock className="h-3.5 w-3.5 text-gray-400" />
                                        </div>
                                        <span className="text-[12px] text-gray-500">Wait <span className="font-medium text-gray-700">{step.wait}</span></span>
                                      </>
                                    ) : (
                                      <>
                                        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-white border border-gray-100 shadow-sm">
                                          <img src={step.logo} alt="" className="h-3.5 w-3.5 object-contain" />
                                        </div>
                                        <span className="text-[12px] font-medium text-gray-800">{step.label}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-[400px] rounded-2xl">
          <AlertDialogHeader>
            <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center mb-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
            <AlertDialogTitle>Delete task</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-500">
              This will permanently delete <span className="font-medium text-gray-700">"{deleteTarget?.name}"</span> and all its execution history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel disabled={deleting} className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white rounded-xl"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Tasks;

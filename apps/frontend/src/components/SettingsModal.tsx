import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { PLANS, getPlanDisplayName, getPlanById, getPlanFeaturesForDisplay } from "@/config/plans";
import {
  Settings,
  Users,
  CreditCard,
  Key,
  Copy,
  Trash2,
  Plus,
  Globe,
  Calendar,
  Monitor,
  CheckCircle2,
  X,
  MoreVertical,
  Info,
  User,
  Upload,
  Camera,
  ArrowUpRight,
  ExternalLink,
  FolderKanban,
  UserMinus,
  Loader2,
  Play,
  MessageCircle,
  Linkedin,
  FileText,
  Files,
  Coins,
  FolderOpen,
  Check,
  Download,
  AlertTriangle,
  Link2,
  Eye,
  EyeOff,
  RefreshCw,
  Sparkles,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Palette,
  Building2,
  Image,
  Mic,
  MicOff,
  Search,
  StickyNote,
  Mail,
  Shield,
  ArrowRight,
  MonitorPlay,
  Zap,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { BlueprintSettingsSection } from "@/components/settings/BlueprintSettingsSection";
import { ProposalFlowSettingsSection } from "@/components/settings/ProposalFlowSettingsSection";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/lib/supabase";
import { watchOAuthPopup } from "@/lib/oauthPopup";
import { getWorkspaceIcon } from "@/utils/workspaceIcons";
import {
  CommunityPostCard,
  CommunityPostDetail,
  CommunityPostForm,
  CommunityStatusBadge,
  type CommunityPost,
  type CommunityPostType,
  type CommunityPostStatus,
  type CommunityComment,
} from "@/components/community";
import {
  useCommunityPosts,
  useCommunityPost,
  useCreateCommunityPost,
  useDeleteCommunityPost,
  useToggleCommunityUpvote,
  useAddCommunityComment,
  useDeleteCommunityComment,
  useUpdateCommunityPostStatus,
} from "@/hooks/useCommunityPosts";

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ApiKey {
  id: string;
  name: string;
  key: string; // Partial key for display (e.g., "ak_12345678...")
  created_at: string;
  last_used?: string;
  workspace?: {
    id: string;
    name: string;
  };
  created_by?: {
    name: string;
    email: string;
  };
}

interface Tutorial {
  id: string;
  title: string;
  slug: string;
  description: string;
  duration: string | null;
  video_url: string | null;
  video_file_url: string | null;
}

type SettingsSection = "profile" | "preferences" | "team" | "company" | "proposal-flow" | "report-templates" | "billing" | "api-keys" | "integrations" | "tutorials" | "community";

const settingsSections = [
  {
    id: "profile" as SettingsSection,
    label: "Profile",
    icon: User,
    category: "Account",
  },
  {
    id: "preferences" as SettingsSection,
    label: "Preferences",
    icon: Settings,
    category: "Account",
  },
  {
    id: "team" as SettingsSection,
    label: "Team",
    icon: Users,
    category: "Workspace",
  },
  // Hidden - not relevant for current positioning
  // { id: "company" as SettingsSection, label: "Company", icon: Building2, category: "Workspace" },
  // { id: "proposal-flow" as SettingsSection, label: "Digital Sales Room", icon: MonitorPlay, category: "Workspace" },
  // { id: "billing" as SettingsSection, label: "Billing", icon: CreditCard, category: "Workspace" },
  // { id: "tutorials" as SettingsSection, label: "Tutorials", icon: Play, category: "Community" },
];

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { userData, session, refreshUserData } = useAuth();
  const [activeSection, setActiveSection] = useState<SettingsSection>("profile");
  
  // Preferences state
  const [appearance, setAppearance] = useState("light");
  const [language, setLanguage] = useState("en-US");
  
  // Team state
  const [teamName, setTeamName] = useState(userData?.team?.name || "");
  const [teamNameLoading, setTeamNameLoading] = useState(false);
  
  // API Keys state
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [showNewKeyForm, setShowNewKeyForm] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);

  // Help/Tutorials state
  const [tutorials, setTutorials] = useState<Tutorial[]>([]);
  const [tutorialsLoading, setTutorialsLoading] = useState(false);

  // Group sections by category
  const groupedSections = settingsSections.reduce((acc, section) => {
    if (!acc[section.category]) {
      acc[section.category] = [];
    }
    acc[section.category].push(section);
    return acc;
  }, {} as Record<string, typeof settingsSections>);

  // Load API keys
  const loadApiKeys = async () => {
    if (!session?.access_token) return;
    
    setApiKeysLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/api-keys`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setApiKeys(data.apiKeys || []);
      } else if (response.status === 404) {
        // Endpoint doesn't exist yet, use empty array
        setApiKeys([]);
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error("Failed to load API keys:", errorData);
        setApiKeys([]);
      }
    } catch (error) {
      console.error("Failed to load API keys:", error);
      setApiKeys([]);
    } finally {
      setApiKeysLoading(false);
    }
  };

  // Create new API key
  const createApiKey = async () => {
    if (!newKeyName.trim() || !session?.access_token) return;

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/api-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });

      if (response.ok) {
        const data = await response.json();
        setNewKeyValue(data.key); // Show the key value (only shown once)
        // Reload API keys to get the updated list
        await loadApiKeys();
        setNewKeyName("");
        setShowNewKeyForm(false);
        toast.success("API key created successfully");
      } else {
        let errorMessage = "Failed to create API key";
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.detail || errorMessage;
        } catch (e) {
          // If response is not JSON, use default message
        }
        toast.error(errorMessage);
      }
    } catch (error: any) {
      console.error("Create API key error:", error);
      toast.error(error.message || "Failed to create API key");
    }
  };

  // Delete API key
  const deleteApiKey = async (keyId: string) => {
    if (!session?.access_token) return;

    if (!confirm("Are you sure you want to delete this API key? This action cannot be undone.")) {
      return;
    }

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/api-keys/${keyId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        // Reload API keys to get the updated list
        await loadApiKeys();
        toast.success("API key deleted successfully");
      } else {
        let errorMessage = "Failed to delete API key";
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.detail || errorMessage;
        } catch (e) {
          // If response is not JSON, use default message
        }
        toast.error(errorMessage);
      }
    } catch (error: any) {
      console.error("Delete API key error:", error);
      toast.error(error.message || "Failed to delete API key");
    }
  };

  // Copy API key to clipboard
  const copyApiKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast.success("API key copied to clipboard");
  };

  // Load tutorials
  const loadTutorials = async () => {
    setTutorialsLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/resources/tutorials`);

      if (response.ok) {
        const data = await response.json();
        setTutorials(data.tutorials || []);
      } else {
        console.error("Failed to load tutorials");
        setTutorials([]);
      }
    } catch (error) {
      console.error("Failed to load tutorials:", error);
      setTutorials([]);
    } finally {
      setTutorialsLoading(false);
    }
  };

  // Update team name
  const updateTeamName = async () => {
    if (!userData?.team?.id || !session?.access_token) return;

    setTeamNameLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/teams/${userData.team.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ name: teamName.trim() }),
      });

      if (response.ok) {
        toast.success("Team name updated successfully");
        refreshUserData(); // Refresh to get updated team data
      } else {
        const error = await response.json();
        toast.error(error.message || "Failed to update team name");
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to update team name");
    } finally {
      setTeamNameLoading(false);
    }
  };

  // Update team name state when userData changes
  useEffect(() => {
    if (userData?.team?.name) {
      setTeamName(userData.team.name);
    }
  }, [userData]);

  // Load API keys when modal opens and API Keys section is active
  useEffect(() => {
    if (open && activeSection === "api-keys") {
      loadApiKeys();
    }
  }, [open, activeSection]);

  // Load tutorials when modal opens and Tutorials section is active
  useEffect(() => {
    if (open && activeSection === "tutorials") {
      loadTutorials();
    }
  }, [open, activeSection]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[85vh] p-0 flex flex-col overflow-hidden sm:rounded-lg [&>button]:hidden">
        <div className="flex h-full">
          {/* Left Sidebar */}
          <aside className="w-64 border-r border-border bg-muted/30 flex-shrink-0 overflow-y-auto">
            <div className="p-6">
              <div className="mb-8 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Settings</h2>
                  <p className="text-sm text-muted-foreground mt-1">Manage your account</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onOpenChange(false)}
                  className="h-8 w-8"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <nav className="space-y-8">
                {Object.entries(groupedSections).map(([category, sections]) => (
                  <div key={category}>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                      {category}
                    </h3>
                    <ul className="space-y-1">
                      {sections.map((section) => {
                        const Icon = section.icon;
                        const isActive = activeSection === section.id;
                        return (
                          <li key={section.id}>
                            <button
                              onClick={() => {
                                setActiveSection(section.id);
                                if (section.id === "api-keys") {
                                  loadApiKeys();
                                } else if (section.id === "tutorials") {
                                  loadTutorials();
                                }
                                // Support section doesn't need data loading
                              }}
                              className={cn(
                                "w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors",
                                isActive
                                  ? "bg-primary/10 text-primary font-medium"
                                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                              )}
                            >
                              <Icon className="h-4 w-4" />
                              <span>{section.label}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex-1 overflow-y-auto bg-background">
            <div className="max-w-3xl mx-auto p-8">
              {activeSection === "profile" && (
                <ProfileSection
                  userData={userData}
                  onUpdate={refreshUserData}
                />
              )}

              {activeSection === "preferences" && (
                <PreferencesSection
                  appearance={appearance}
                  setAppearance={setAppearance}
                  language={language}
                  setLanguage={setLanguage}
                />
              )}

              {activeSection === "team" && (
                <TeamSection
                  teamName={teamName}
                  setTeamName={setTeamName}
                  onUpdate={updateTeamName}
                  loading={teamNameLoading}
                />
              )}

              {activeSection === "company" && (
                <CompanySettingsSection />
              )}

              {activeSection === "proposal-flow" && (
                <ProposalFlowSettingsSection />
              )}

              {activeSection === "report-templates" && (
                <ReportTemplatesSection />
              )}

              {activeSection === "billing" && (
                <SubscriptionSection session={session} />
              )}

              {activeSection === "api-keys" && (
                <ApiKeysSection
                  apiKeys={apiKeys}
                  loading={apiKeysLoading}
                  onDelete={deleteApiKey}
                  onCopy={copyApiKey}
                  newKeyName={newKeyName}
                  setNewKeyName={setNewKeyName}
                  showNewKeyForm={showNewKeyForm}
                  setShowNewKeyForm={setShowNewKeyForm}
                  onCreate={createApiKey}
                  newKeyValue={newKeyValue}
                  setNewKeyValue={setNewKeyValue}
                />
              )}

              {activeSection === "integrations" && (
                <IntegrationsSection session={session} />
              )}

              {activeSection === "tutorials" && (
                <TutorialsSection
                  tutorials={tutorials}
                  loading={tutorialsLoading}
                />
              )}

            </div>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Preferences Section
function PreferencesSection({
  appearance,
  setAppearance,
  language,
  setLanguage,
}: {
  appearance: string;
  setAppearance: (value: string) => void;
  language: string;
  setLanguage: (value: string) => void;
}) {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold">Preferences</h1>
        <p className="text-muted-foreground">Customize how Proply looks and behaves</p>
      </div>

      {/* Appearance */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Monitor className="h-4 w-4 text-muted-foreground" />
              <Label className="text-base font-medium">Appearance</Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Customize how Proply looks on your device.
            </p>
          </div>
          <Select value={appearance} onValueChange={setAppearance}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* Language */}
      <section className="space-y-6 pt-6 border-t border-border">
        <h2 className="text-sm font-medium">Language</h2>

        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <Label className="text-base font-medium">Language</Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Change the language used in the user interface.
            </p>
          </div>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en-US">English (US)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>
    </div>
  );
}

// Workspace Section
function WorkspaceSection({
  session,
  userData,
}: {
  session: any;
  userData: any;
}) {
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddMemberDialog, setShowAddMemberDialog] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const teamId = userData?.team?.id;
  const isFounder = userData?.is_founder;

  const loadWorkspaces = async () => {
    if (!teamId || !session?.access_token) {
      setLoading(false);
      setError("Missing team ID or session");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/teams/${teamId}/workspaces`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setWorkspaces(data.workspaces || []);
        if (!data.workspaces || data.workspaces.length === 0) {
          setError(null); // Clear error, just show empty state
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.detail || errorData.error || `Failed to load workspaces (${response.status})`;
        console.error('[WorkspaceSection] API Error:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        });
        setError(errorMessage);
        toast.error(errorMessage);
      }
    } catch (error: any) {
      console.error("Failed to load workspaces:", error);
      const errorMessage = error.message || "Failed to load workspaces";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const loadTeamMembers = async () => {
    if (!teamId || !session?.access_token) return;

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/teams/${teamId}/members`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setTeamMembers(data.members || []);
      }
    } catch (error) {
      console.error("Failed to load team members:", error);
    }
  };

  useEffect(() => {
    if (teamId && session?.access_token) {
      loadWorkspaces();
      loadTeamMembers();
    } else {
      setLoading(false);
    }
  }, [teamId, session]);

  const handleGrantAccess = async (workspaceId: string, userId: string, role: string = 'member') => {
    if (!session?.access_token) return;

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          user_id: userId,
          role: role,
        }),
      });

      if (response.ok) {
        toast.success("Workspace access granted");
        // Reload both workspaces and team members to get updated data
        await Promise.all([loadWorkspaces(), loadTeamMembers()]);
      } else {
        const error = await response.json();
        toast.error(error.detail || error.error || "Failed to grant access");
      }
    } catch (error: any) {
      console.error("Failed to grant access:", error);
      toast.error(error.message || "Failed to grant access");
    }
  };

  const handleRevokeAccess = async (workspaceId: string, userId: string) => {
    if (!session?.access_token) return;

    if (!confirm("Are you sure you want to revoke this user's access to this workspace?")) {
      return;
    }

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/members/${userId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        toast.success("Workspace access revoked");
        // Reload both workspaces and team members to get updated data
        await Promise.all([loadWorkspaces(), loadTeamMembers()]);
      } else {
        const error = await response.json();
        toast.error(error.detail || error.error || "Failed to revoke access");
      }
    } catch (error: any) {
      console.error("Failed to revoke access:", error);
      toast.error(error.message || "Failed to revoke access");
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold">Workspaces</h1>
        <p className="text-muted-foreground">
          {isFounder 
            ? "Manage workspace access for your team members" 
            : "View workspace access for your team (only founders can manage access)"}
        </p>
      </div>

      {!teamId ? (
        <div className="text-center py-12 text-muted-foreground">
          No team found. Please contact support if this issue persists.
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-muted-foreground">Loading workspaces...</div>
        </div>
      ) : error ? (
        <div className="text-center py-12 space-y-4">
          <div className="text-destructive">{error}</div>
          <Button onClick={loadWorkspaces} variant="outline">
            Retry
          </Button>
        </div>
      ) : workspaces.length === 0 ? (
        <div className="text-center py-12 space-y-4">
          <div className="text-muted-foreground">No workspaces found for this team</div>
          <p className="text-sm text-muted-foreground">
            Workspaces will appear here once they are created
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {workspaces.map((workspace) => (
            <div key={workspace.id} className="border border-border rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {(() => {
                    const WorkspaceIcon = getWorkspaceIcon(workspace.icon);
                    if (WorkspaceIcon) {
                      return <WorkspaceIcon className="h-4 w-4 text-muted-foreground" />;
                    }
                    return <FolderKanban className="h-4 w-4 text-muted-foreground" />;
                  })()}
                  <div>
                    <h3 className="text-sm font-medium">{workspace.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {workspace.members?.filter((m: any) => m.has_workspace_access).length || 0} members with access
                    </p>
                  </div>
                </div>
                {isFounder && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddMemberDialog(workspace.id)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Member
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground mb-3">Team Members</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Team Role</TableHead>
                      <TableHead>Workspace Access</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workspace.members?.map((member: any) => (
                      <TableRow key={member.user_id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={member.users?.profile_picture_url} />
                              <AvatarFallback>
                                {member.users?.name?.[0] || member.users?.email?.[0] || "U"}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="font-medium">{member.users?.name || "Unknown"}</div>
                              <div className="text-sm text-muted-foreground">{member.users?.email}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{member.role || "member"}</Badge>
                        </TableCell>
                        <TableCell>
                          {member.has_workspace_access ? (
                            <Badge variant="default" className="bg-green-500">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              {member.workspace_role || "member"}
                            </Badge>
                          ) : (
                            <Badge variant="outline">No access</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {isFounder ? (
                            member.has_workspace_access ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRevokeAccess(workspace.id, member.user_id)}
                                disabled={member.workspace_role === 'owner'}
                              >
                                {member.workspace_role === 'owner' ? (
                                  "Owner"
                                ) : (
                                  <>
                                    <X className="h-4 w-4 mr-1" />
                                    Revoke
                                  </>
                                )}
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleGrantAccess(workspace.id, member.user_id)}
                              >
                                <Plus className="h-4 w-4 mr-1" />
                                Grant Access
                              </Button>
                            )
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Member Dialog */}
      <Dialog open={!!showAddMemberDialog} onOpenChange={(open) => !open && setShowAddMemberDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Team Member to Workspace</DialogTitle>
            <DialogDescription>
              Select a team member to grant access to this workspace
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">

            {showAddMemberDialog && (() => {
              const workspace = workspaces.find((w: any) => w.id === showAddMemberDialog);
              const membersWithoutAccess = teamMembers.filter((member: any) => {
                const hasAccess = workspace?.members?.find(
                  (m: any) => m.user_id === member.user_id
                )?.has_workspace_access;
                return !hasAccess;
              });

              return (
                <div className="space-y-3 max-h-[400px] overflow-y-auto">
                  {membersWithoutAccess.map((member: any) => (
                    <div
                      key={member.user_id}
                      className="flex items-center justify-between p-3 border border-border rounded-lg hover:bg-muted/50 cursor-pointer"
                      onClick={() => {
                        if (showAddMemberDialog) {
                          handleGrantAccess(showAddMemberDialog, member.user_id, 'member');
                          setShowAddMemberDialog(null);
                        }
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={member.users?.profile_picture_url} />
                          <AvatarFallback>
                            {member.users?.name?.[0] || member.users?.email?.[0] || "U"}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">{member.users?.name || "Unknown"}</div>
                          <div className="text-sm text-muted-foreground">{member.users?.email}</div>
                        </div>
                      </div>
                      <Button variant="outline" size="sm">
                        <Plus className="h-4 w-4 mr-1" />
                        Add
                      </Button>
                    </div>
                  ))}

                  {membersWithoutAccess.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      All team members already have access to this workspace
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Team Section
function TeamSection({
  teamName,
  setTeamName,
  onUpdate,
  loading,
}: {
  teamName: string;
  setTeamName: (value: string) => void;
  onUpdate: () => void;
  loading: boolean;
}) {
  const { userData, session } = useAuth();
  const [members, setMembers] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  const teamId = userData?.team?.id;

  // Load team members and invitations
  const loadTeamData = async () => {
    if (!teamId || !session?.access_token) return;

    setMembersLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";

      // Load members
      const membersResponse = await fetch(`${apiUrl}/api/teams/${teamId}/members`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (membersResponse.ok) {
        const membersData = await membersResponse.json();
        setMembers(membersData.members || []);
      }

      // Load invitations
      const invitationsResponse = await fetch(`${apiUrl}/api/teams/${teamId}/invitations`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (invitationsResponse.ok) {
        const invitationsData = await invitationsResponse.json();
        setInvitations(invitationsData.invitations || []);
      }
    } catch (error) {
      console.error("Failed to load team data:", error);
    } finally {
      setMembersLoading(false);
    }
  };

  useEffect(() => {
    if (teamId) {
      loadTeamData();
    }
  }, [teamId, session]);

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !teamId || !session?.access_token) return;

    setInviting(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/teams/${teamId}/invitations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        toast.success(`Invitation sent to ${inviteEmail}`);
        setInviteEmail("");
        setInviteRole("member");
        setShowInviteForm(false);
        await loadTeamData(); // Reload to show new invitation
      } else {
        const error = await response.json();
        toast.error(error.detail || error.error || "Failed to send invitation");
      }
    } catch (error: any) {
      console.error("Failed to send invitation:", error);
      toast.error(error.message || "Failed to send invitation");
    } finally {
      setInviting(false);
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    if (!teamId || !session?.access_token) return;

    if (!confirm("Are you sure you want to cancel this invitation?")) {
      return;
    }

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/teams/${teamId}/invitations/${invitationId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        toast.success("Invitation cancelled");
        await loadTeamData();
      } else {
        const error = await response.json();
        toast.error(error.detail || error.error || "Failed to cancel invitation");
      }
    } catch (error: any) {
      console.error("Failed to cancel invitation:", error);
      toast.error(error.message || "Failed to cancel invitation");
    }
  };

  const handleRemoveFromTeam = async (memberUserId: string) => {
    if (!teamId || !session?.access_token) {
      console.error("Missing teamId or session:", { teamId, hasSession: !!session });
      return;
    }

    if (!memberUserId) {
      console.error("Missing memberUserId");
      toast.error("Invalid member ID");
      return;
    }

    if (!confirm("Are you sure you want to remove this member from the team? They will lose access to all team workspaces.")) {
      return;
    }

    setRemovingMemberId(memberUserId);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const url = `${apiUrl}/api/teams/${teamId}/members/${memberUserId}`;
      console.log("Removing team member:", { url, teamId, memberUserId });
      
      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        toast.success("Team member removed");
        await loadTeamData();
      } else {
        // Check if response is JSON or HTML
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const error = await response.json();
          toast.error(error.detail || error.error || "Failed to remove team member");
        } else {
          const text = await response.text();
          console.error("Non-JSON error response:", text);
          toast.error(`Failed to remove team member (${response.status}): ${response.statusText}`);
        }
      }
    } catch (error: any) {
      console.error("Failed to remove team member:", error);
      toast.error(error.message || "Failed to remove team member");
    } finally {
      setRemovingMemberId(null);
    }
  };

  const getInitials = (name?: string, email?: string) => {
    if (name) {
      const parts = name.trim().split(" ");
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return name.substring(0, 2).toUpperCase();
    }
    if (email) {
      return email[0].toUpperCase();
    }
    return "U";
  };

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), "MMM d, yyyy");
    } catch {
      return dateString;
    }
  };

  const pendingInvitations = invitations.filter((inv) => inv.status === "pending");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold">Team</h1>
        <p className="text-muted-foreground">Manage your team settings and members</p>
      </div>

      {/* Team Name */}
      <section className="space-y-4">
        <div>
          <Label htmlFor="team-name" className="text-base font-medium mb-2 block">
            Team Name
          </Label>
          <p className="text-sm text-muted-foreground mb-4">
            This name will be visible to all team members.
          </p>
          <div className="flex gap-3">
            <Input
              id="team-name"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Enter team name"
              className="max-w-md"
              disabled={loading}
            />
            <Button onClick={onUpdate} disabled={loading || !teamName.trim()}>
              {loading ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </section>

      {/* Team Members */}
      <section className="space-y-4 pt-6 border-t border-border">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium mb-1">Team Members</h2>
            <p className="text-sm text-muted-foreground">
              {members.length} {members.length === 1 ? "member" : "members"}
            </p>
          </div>
          <Button
            onClick={() => setShowInviteForm(true)}
            className="bg-black text-white hover:bg-black/90"
            disabled={showInviteForm}
          >
            <Plus className="h-4 w-4 mr-2" />
            Invite Team Member
          </Button>
        </div>

        {/* Invite Form */}
        {showInviteForm && (
          <div className="border border-border rounded-lg p-4 space-y-4 bg-muted/30">
            <div>
              <Label htmlFor="invite-email" className="text-base font-medium mb-2 block">
                Email Address
              </Label>
              <p className="text-sm text-muted-foreground mb-3">
                Enter the email address of the person you want to invite.
              </p>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
                className="max-w-md"
                disabled={inviting}
              />
            </div>
            <div>
              <Label htmlFor="invite-role" className="text-base font-medium mb-2 block">
                Role
              </Label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="w-full max-w-md px-3 py-2 border border-border rounded-md bg-background text-sm"
                disabled={inviting}
              >
                <option value="member">Member</option>
                <option value="founder">Founder (full control)</option>
              </select>
              {inviteRole === "founder" && (
                <p className="text-sm text-amber-600 mt-2">
                  This will transfer ownership to the invited user. Your role will be downgraded to member.
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
                {inviting ? "Sending..." : "Send Invitation"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowInviteForm(false);
                  setInviteEmail("");
                }}
                disabled={inviting}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Members List */}
        {membersLoading ? (
          <div className="text-sm text-muted-foreground py-8">Loading team members...</div>
        ) : members.length === 0 ? (
          <div className="border border-border rounded-lg p-8 text-center">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-sm font-medium mb-2">No team members</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Invite team members to collaborate on workspaces.
            </p>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>MEMBER</TableHead>
                  <TableHead>ROLE</TableHead>
                  <TableHead>JOINED</TableHead>
                  <TableHead className="w-[100px]">ACTIONS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const user = member.users || member;
                  const memberUserId = member.user_id || user.id;
                  const isCurrentUser = memberUserId === userData?.id;
                  const isFounder = member.role === 'founder';
                  const canRemove = !isCurrentUser && !isFounder && memberUserId;
                  
                  return (
                    <TableRow key={member.id || memberUserId}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={user.profile_picture_url || undefined} />
                            <AvatarFallback>
                              {getInitials(user.name, user.email)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">{user.name || "Unknown"}</div>
                            <div className="text-sm text-muted-foreground">{user.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{member.role || "owner"}</Badge>
                      </TableCell>
                      <TableCell>
                        {member.joined_at ? (
                          <span className="text-sm">{formatDate(member.joined_at)}</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {canRemove ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveFromTeam(memberUserId)}
                            disabled={removingMemberId === memberUserId}
                            title="Remove from team"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          >
                            {removingMemberId === memberUserId ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <UserMinus className="h-4 w-4" />
                            )}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {isCurrentUser ? "You" : isFounder ? "Founder" : "—"}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Pending Invitations */}
      {pendingInvitations.length > 0 && (
        <section className="space-y-4 pt-6 border-t border-border">
          <div>
            <h2 className="text-sm font-medium mb-1">Pending Invitations</h2>
            <p className="text-sm text-muted-foreground">
              {pendingInvitations.length} {pendingInvitations.length === 1 ? "invitation" : "invitations"} pending
            </p>
          </div>
          <div className="border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>EMAIL</TableHead>
                  <TableHead>ROLE</TableHead>
                  <TableHead>INVITED</TableHead>
                  <TableHead>EXPIRES</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvitations.map((invitation) => (
                  <TableRow key={invitation.id}>
                    <TableCell>
                      <div className="font-medium">{invitation.email}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{invitation.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{formatDate(invitation.created_at)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {formatDate(invitation.expires_at)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCancelInvitation(invitation.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </div>
  );
}

// Branding Section (legacy - kept for reference but no longer rendered in Team section)
function BrandingSection({ teamId }: { teamId?: string }) {
  const { userData, session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [companyWebsite, setCompanyWebsite] = useState('');
  const [companyContext, setCompanyContext] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#000000');
  const [secondaryColor, setSecondaryColor] = useState('#FFFFFF');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoPosition, setLogoPosition] = useState<'top-left' | 'top-right' | 'top-center' | 'hidden'>('top-left');
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const workspaceId = userData?.workspace?.id || localStorage.getItem('selectedWorkspaceId');

  useEffect(() => {
    if (workspaceId && session?.access_token) {
      fetchBranding();
    }
  }, [workspaceId, session]);

  const fetchBranding = async () => {
    if (!workspaceId || !session?.access_token) return;
    setLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/settings`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (response.ok) {
        const data = await response.json();
        if (data.brand_theme) {
          setPrimaryColor(data.brand_theme.primary_color || '#000000');
          setSecondaryColor(data.brand_theme.secondary_color || '#FFFFFF');
          setLogoUrl(data.brand_theme.logo_url || null);
          setLogoPosition(data.brand_theme.logo_position || 'top-left');
        }
        if (data.target_audience) {
          setCompanyName(data.target_audience.company_name || '');
          setCompanyWebsite(data.target_audience.company_website || '');
          setCompanyContext(data.target_audience.company_context || '');
        }
      }
    } catch (error) {
      console.error('Error fetching branding:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!workspaceId || !session?.access_token) return;
    setLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? '';

      // Update brand theme
      await fetch(`${apiUrl}/api/workspaces/${workspaceId}/settings/brand-theme`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          brand_theme: {
            primary_color: primaryColor,
            secondary_color: secondaryColor,
            logo_url: logoUrl,
            logo_position: logoPosition,
          },
        }),
      });

      // Update target audience (company info)
      await fetch(`${apiUrl}/api/workspaces/${workspaceId}/settings/target-audience`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          target_audience: {
            company_name: companyName,
            company_website: companyWebsite,
            company_context: companyContext,
          },
        }),
      });

      toast.success('Branding saved successfully');
      fetchBranding();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save branding');
    } finally {
      setLoading(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session?.access_token) return;

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/logo`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        setLogoUrl(data.logo_url);
        toast.success('Logo uploaded successfully');
      } else {
        throw new Error('Failed to upload logo');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to upload logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  return (
    <section className="space-y-4 pt-6 border-t border-border">
      <div>
        <h2 className="text-sm font-medium mb-1">Branding</h2>
        <p className="text-sm text-muted-foreground">
          Configure your company branding for content generation
        </p>
      </div>

      <div className="space-y-4 border border-border rounded-lg p-6 bg-muted/20">
        {/* Company Name */}
        <div>
          <Label htmlFor="company-name" className="text-base font-medium mb-2 block">
            Company Name
          </Label>
          <Input
            id="company-name"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Your company name"
            className="max-w-md"
            disabled={loading}
          />
        </div>

        {/* Company Website */}
        <div>
          <Label htmlFor="company-website" className="text-base font-medium mb-2 block">
            Company Website
          </Label>
          <Input
            id="company-website"
            value={companyWebsite}
            onChange={(e) => setCompanyWebsite(e.target.value)}
            placeholder="https://example.com"
            className="max-w-md"
            disabled={loading}
          />
        </div>

        {/* Company Context */}
        <div>
          <Label htmlFor="company-context" className="text-base font-medium mb-2 block">
            Company Context
          </Label>
          <p className="text-sm text-muted-foreground mb-3">
            Describe your company, brand voice, and key messaging
          </p>
          <Textarea
            id="company-context"
            value={companyContext}
            onChange={(e) => setCompanyContext(e.target.value)}
            placeholder="Describe your company, brand voice, and key messaging..."
            rows={4}
            className="max-w-2xl"
            disabled={loading}
          />
        </div>

        {/* Background Color */}
        <div>
          <Label htmlFor="primary-color" className="text-base font-medium mb-2 block">
            Background Color
          </Label>
          <div className="flex items-center gap-3">
            <Input
              type="color"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="w-20 h-10 cursor-pointer"
              disabled={loading}
            />
            <Input
              id="primary-color"
              type="text"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              placeholder="#000000"
              className="max-w-xs"
              disabled={loading}
            />
          </div>
        </div>

        {/* Secondary Color */}
        <div>
          <Label htmlFor="secondary-color" className="text-base font-medium mb-2 block">
            Secondary Color
          </Label>
          <div className="flex items-center gap-3">
            <Input
              type="color"
              value={secondaryColor}
              onChange={(e) => setSecondaryColor(e.target.value)}
              className="w-20 h-10 cursor-pointer"
              disabled={loading}
            />
            <Input
              id="secondary-color"
              type="text"
              value={secondaryColor}
              onChange={(e) => setSecondaryColor(e.target.value)}
              placeholder="#FFFFFF"
              className="max-w-xs"
              disabled={loading}
            />
          </div>
        </div>

        {/* Logo */}
        <div>
          <Label className="text-base font-medium mb-2 block">Logo</Label>
          <div className="flex items-center gap-4">
            {logoUrl && (
              <div className="border border-border rounded-lg p-3 bg-white">
                <img src={logoUrl} alt="Company Logo" className="h-16 w-auto object-contain" />
              </div>
            )}
            <div>
              <input
                type="file"
                id="logo-upload-settings"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
                disabled={loading || uploadingLogo}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => document.getElementById('logo-upload-settings')?.click()}
                disabled={loading || uploadingLogo}
              >
                <Upload className="h-4 w-4 mr-2" />
                {uploadingLogo ? 'Uploading...' : logoUrl ? 'Change Logo' : 'Upload Logo'}
              </Button>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="pt-4">
          <Button onClick={handleSave} disabled={loading}>
            {loading ? 'Saving...' : 'Save Branding'}
          </Button>
        </div>
      </div>
    </section>
  );
}

// Company Settings Section - Foundation for document generation
interface CompanyAsset {
  id: string;
  type: string;
  title: string;
  description?: string;
  status: string;
  file_type?: string;
  created_at: string;
  content_text?: string;
  url?: string;
}

interface ReferenceImage {
  url: string;
  path: string;
  description: string;
  uploaded_at: string;
}

const DESIGN_STYLES = [
  { value: 'corporate', label: 'Corporate', description: 'Professional, clean, business-focused' },
  { value: 'creative', label: 'Creative', description: 'Bold, artistic, innovative' },
  { value: 'minimalist', label: 'Minimalist', description: 'Simple, clean, lots of whitespace' },
  { value: 'elegant', label: 'Elegant', description: 'Sophisticated, refined, premium' },
  { value: 'modern', label: 'Modern', description: 'Contemporary, fresh, trendy' },
];

const INDUSTRY_TYPES = [
  { value: 'agency', label: 'Agency', description: 'Creative, marketing, or design agencies' },
  { value: 'startup', label: 'Startup', description: 'Fast-moving startups, lean proposals' },
  { value: 'software', label: 'Software / SaaS', description: 'Software products and implementations' },
  { value: 'consultancy', label: 'Consultancy', description: 'Consulting firms, detailed methodology' },
];

const ASSET_TYPES = [
  { value: 'brand_guideline', label: 'Brand Guideline' },
  { value: 'company_doc', label: 'Company Document' },
  { value: 'process', label: 'Process / Workflow' },
  { value: 'product', label: 'Product Info' },
  { value: 'case_study', label: 'Case Study' },
];

const BACKGROUND_THEMES = [
  { value: 'photographic', label: 'Photographic', description: 'Real photography backgrounds' },
  { value: 'visual', label: 'Visual', description: 'AI-generated illustrated graphics' },
  { value: 'pattern', label: 'Pattern', description: 'Geometric patterns' },
  { value: 'bubbles', label: 'Bubbles', description: 'Organic blob shapes' },
];

// Which background themes work best with each design style
const DESIGN_STYLE_TO_THEMES: Record<string, string[]> = {
  creative: ['visual', 'bubbles', 'photographic', 'pattern'],
  modern: ['visual', 'pattern', 'bubbles', 'photographic'],
  elegant: ['visual', 'pattern', 'bubbles', 'photographic'],
  corporate: ['pattern', 'photographic', 'visual', 'bubbles'],
  minimalistic: ['pattern', 'bubbles', 'visual', 'photographic'],
};

function CompanySettingsSection() {
  const { userData, session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Company Info
  const [companyName, setCompanyName] = useState('');
  const [companyWebsite, setCompanyWebsite] = useState('');

  // Language
  const [defaultLanguage, setDefaultLanguage] = useState('en');

  // Design Preferences
  const [designStyle, setDesignStyle] = useState('corporate');
  const [industry, setIndustry] = useState('agency');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [backgroundTheme, setBackgroundTheme] = useState<'photographic' | 'visual' | 'pattern' | 'bubbles'>('visual');
  const [secondaryColor, setSecondaryColor] = useState('#8b5cf6');
  // Color mode is always 'accent' now (simplified - removed 'consistent' option)
  const [darkCoverStyle, setDarkCoverStyle] = useState<'secondary' | 'accents'>('secondary');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoPosition, setLogoPosition] = useState<'top-left' | 'top-right' | 'top-center' | 'hidden'>('top-left');

  // Company Assets
  const [assets, setAssets] = useState<CompanyAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Add Source Dialog
  const [isAddSourceOpen, setIsAddSourceOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'upload' | 'research' | 'notes' | 'url'>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentTitle, setDocumentTitle] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Research report form state
  const [topic, setTopic] = useState('');
  const [sourceRecommendations, setSourceRecommendations] = useState('');
  const [searchDepth, setSearchDepth] = useState('');
  const [depth, setDepth] = useState<'quick' | 'comprehensive'>('comprehensive');
  const [creatingResearch, setCreatingResearch] = useState(false);

  // Speech recognition for notes
  const [isRecordingNote, setIsRecordingNote] = useState(false);
  const noteRecognitionRef = useRef<any>(null);

  // URL scraping state
  const [urlToScrape, setUrlToScrape] = useState('');
  const [urlTitle, setUrlTitle] = useState('');
  const [scrapingUrl, setScrapingUrl] = useState(false);

  // View asset content state
  const [viewingAsset, setViewingAsset] = useState<CompanyAsset | null>(null);

  // Notification settings state
  const [notificationSettings, setNotificationSettings] = useState<{
    email_enabled: boolean;
    email_notifications: { signature_required: boolean; document_signed: boolean; document_viewed: boolean };
    slack_enabled: boolean;
    slack_connection_id: string | null;
    slack_channel_id: string | null;
    slack_notifications: { signature_required: boolean; document_signed: boolean; document_viewed: boolean; document_created: boolean };
  }>({
    email_enabled: true,
    email_notifications: { signature_required: true, document_signed: true, document_viewed: false },
    slack_enabled: false,
    slack_connection_id: null,
    slack_channel_id: null,
    slack_notifications: { signature_required: true, document_signed: true, document_viewed: false, document_created: true },
  });
  const [slackConnections, setSlackConnections] = useState<any[]>([]);
  const [slackChannels, setSlackChannels] = useState<{ id: string; name: string }[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);

  const workspaceId = userData?.workspace?.id || localStorage.getItem('selectedWorkspaceId');
  const apiUrl = import.meta.env.VITE_API_URL ?? '';

  // Fetch all data on mount
  useEffect(() => {
    if (workspaceId && session?.access_token) {
      fetchCompanyData();
      fetchAssets();
      fetchSlackConnections();
    }
  }, [workspaceId, session]);

  // Fetch Slack channels when connection is selected
  useEffect(() => {
    if (notificationSettings.slack_connection_id && session?.access_token) {
      fetchSlackChannels(notificationSettings.slack_connection_id);
    } else {
      setSlackChannels([]);
    }
  }, [notificationSettings.slack_connection_id, session]);

  const fetchCompanyData = async () => {
    if (!workspaceId || !session?.access_token) return;
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/settings`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (response.ok) {
        const data = await response.json();
        if (data.brand_theme) {
          // Migration: detect if old 3-color system and auto-determine theme
          const hasOldSystem = data.brand_theme.primary_color && !data.brand_theme.theme;
          let detectedTheme: 'light' | 'dark' = data.brand_theme.theme || 'light';
          if (hasOldSystem) {
            // Detect theme from primary color luminance
            const hex = (data.brand_theme.primary_color || '#FFFFFF').replace('#', '');
            const r = parseInt(hex.substr(0, 2), 16);
            const g = parseInt(hex.substr(2, 2), 16);
            const b = parseInt(hex.substr(4, 2), 16);
            const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            detectedTheme = luminance < 0.5 ? 'dark' : 'light';
          }
          setTheme(detectedTheme);
          setSecondaryColor(data.brand_theme.secondary_color || '#8b5cf6');
          // colorMode is always 'accent' now (simplified)
          setDarkCoverStyle(data.brand_theme.dark_cover_style || 'secondary');
          setLogoUrl(data.brand_theme.logo_url || null);
          setLogoPosition(data.brand_theme.logo_position || 'top-left');
          setBackgroundTheme(data.brand_theme.background_theme || 'visual');
        }
        if (data.target_audience) {
          setCompanyName(data.target_audience.company_name || '');
          setCompanyWebsite(data.target_audience.company_website || '');
        }
        setDesignStyle(data.design_style || 'corporate');
        setIndustry(data.industry || 'agency');
        setDefaultLanguage(data.default_language || 'en');
        // Load notification settings
        if (data.notification_settings) {
          setNotificationSettings(prev => ({
            ...prev,
            email_enabled: data.notification_settings.email_enabled ?? true,
            email_notifications: {
              signature_required: data.notification_settings.email_notifications?.signature_required ?? true,
              document_signed: data.notification_settings.email_notifications?.document_signed ?? true,
              document_viewed: data.notification_settings.email_notifications?.document_viewed ?? false,
            },
            slack_enabled: data.notification_settings.slack_enabled ?? false,
            slack_connection_id: data.notification_settings.slack_connection_id ?? null,
            slack_channel_id: data.notification_settings.slack_channel_id ?? null,
            slack_notifications: {
              signature_required: data.notification_settings.slack_notifications?.signature_required ?? true,
              document_signed: data.notification_settings.slack_notifications?.document_signed ?? true,
              document_viewed: data.notification_settings.slack_notifications?.document_viewed ?? false,
            },
          }));
        }
      }
    } catch (error) {
      console.error('Error fetching company data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSlackConnections = async () => {
    if (!workspaceId || !session?.access_token) return;
    try {
      const response = await fetch(`${apiUrl}/api/workflow-providers/connections?workspace_id=${workspaceId}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (response.ok) {
        const data = await response.json();
        // Filter to only Slack connections
        const slackConns = (data.connections || []).filter((c: any) =>
          c.provider?.name === 'slack' || c.provider_name === 'slack'
        );
        setSlackConnections(slackConns);
      }
    } catch (error) {
      console.error('Error fetching Slack connections:', error);
    }
  };

  const fetchSlackChannels = async (connectionId: string) => {
    if (!session?.access_token) return;
    setLoadingChannels(true);
    try {
      const response = await fetch(`${apiUrl}/api/workflow-providers/slack/channels?connection_id=${connectionId}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setSlackChannels(data.channels || []);
      }
    } catch (error) {
      console.error('Error fetching Slack channels:', error);
      setSlackChannels([]);
    } finally {
      setLoadingChannels(false);
    }
  };

  const handleSaveNotifications = async () => {
    if (!workspaceId || !session?.access_token) return;
    setSavingNotifications(true);
    try {
      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/settings/notifications`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ notification_settings: notificationSettings }),
      });
      if (response.ok) {
        toast.success('Notification settings saved');
      } else {
        throw new Error('Failed to save notification settings');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to save notification settings');
    } finally {
      setSavingNotifications(false);
    }
  };

  const fetchAssets = async () => {
    if (!workspaceId || !session?.access_token) return;
    setAssetsLoading(true);
    try {
      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/company-assets`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setAssets(data.assets || []);
      }
    } catch (error) {
      console.error('Error fetching assets:', error);
    } finally {
      setAssetsLoading(false);
    }
  };

  const handleSaveInfo = async () => {
    if (!workspaceId || !session?.access_token) {
      console.error('[SAVE] Missing workspaceId or token', { workspaceId, hasToken: !!session?.access_token });
      toast.error('Missing workspace or session');
      return;
    }
    setSaving(true);
    try {
      console.log('[SAVE] Saving company settings...', { workspaceId, apiUrl });
      const errors: string[] = [];

      // Save brand theme
      const brandRes = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/settings/brand-theme`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          brand_theme: {
            theme: theme,
            secondary_color: secondaryColor,
            color_mode: 'accent', // Always accent mode (simplified)
            dark_cover_style: darkCoverStyle,
            logo_url: logoUrl,
            logo_position: logoPosition,
            background_theme: backgroundTheme,
          },
        }),
      });
      console.log('[SAVE] Brand theme response:', brandRes.status);
      if (!brandRes.ok) {
        const err = await brandRes.json().catch(() => ({}));
        console.error('[SAVE] Brand theme error:', err);
        errors.push('brand theme');
      }

      // Save company info
      const audienceRes = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/settings/target-audience`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          target_audience: {
            company_name: companyName,
            company_website: companyWebsite,
          },
        }),
      });
      console.log('[SAVE] Target audience response:', audienceRes.status);
      if (!audienceRes.ok) {
        const err = await audienceRes.json().catch(() => ({}));
        console.error('[SAVE] Target audience error:', err);
        errors.push('company info');
      }

      // Save design preferences, language, and industry via the general settings endpoint
      const designRes = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ design_style: designStyle, industry: industry, default_language: defaultLanguage }),
      });
      console.log('[SAVE] Settings response:', designRes.status);
      if (!designRes.ok) {
        const err = await designRes.json().catch(() => ({}));
        console.error('[SAVE] Settings error:', err);
        errors.push('design preferences');
      }

      // Save notification settings
      const notifRes = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/settings/notifications`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ notification_settings: notificationSettings }),
      });
      console.log('[SAVE] Notifications response:', notifRes.status);
      if (!notifRes.ok) {
        const err = await notifRes.json().catch(() => ({}));
        console.error('[SAVE] Notifications error:', err);
        errors.push('notifications');
      }

      if (errors.length > 0) {
        toast.error(`Failed to save: ${errors.join(', ')}`);
      } else {
        toast.success('Company settings saved');
      }

      // Re-fetch to confirm what's actually in the database
      await fetchCompanyData();
    } catch (error: any) {
      console.error('[SAVE] Exception:', error);
      toast.error(error.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session?.access_token) return;

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/logo`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        setLogoUrl(data.logo_url);
        toast.success('Logo uploaded');
      } else {
        throw new Error('Failed to upload logo');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to upload logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  // Drag and drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files);
    }
  };

  const handleFileSelect = (files: FileList | null) => {
    if (files && files[0]) {
      const file = files[0];
      setSelectedFile(file);
      if (!documentTitle) {
        setDocumentTitle(file.name.replace(/\.[^/.]+$/, ''));
      }
    }
  };

  const handleUploadFile = async () => {
    if (!selectedFile || !session?.access_token) return;

    setUploadingAsset(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('title', documentTitle || selectedFile.name);
      formData.append('type', 'company_doc');

      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/company-assets/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
        body: formData,
      });

      if (response.ok) {
        toast.success('File uploaded and processing');
        fetchAssets();
        setIsAddSourceOpen(false);
        setSelectedFile(null);
        setDocumentTitle('');
      } else {
        throw new Error('Failed to upload file');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to upload');
    } finally {
      setUploadingAsset(false);
    }
  };

  const handleSaveNote = async () => {
    if (!noteTitle || !noteContent || !session?.access_token) return;

    setSavingNote(true);
    try {
      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/company-assets/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          title: noteTitle,
          content: noteContent,
          type: 'note',
        }),
      });

      if (response.ok) {
        toast.success('Note added');
        fetchAssets();
        setIsAddSourceOpen(false);
        setNoteTitle('');
        setNoteContent('');
      } else {
        throw new Error('Failed to save note');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to save note');
    } finally {
      setSavingNote(false);
    }
  };

  const handleCreateResearchReport = async () => {
    if (!topic.trim() || !workspaceId || !session?.access_token) {
      toast.error('Please enter a research topic');
      return;
    }
    setCreatingResearch(true);
    try {
      const sources = sourceRecommendations.split('\n').map(line => line.trim()).filter(line => line.length > 0).map(line => {
        if (line.startsWith('http://') || line.startsWith('https://')) {
          return { type: 'url', value: line };
        }
        return { type: 'search_term', value: line };
      });

      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/content/research/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ topic: topic.trim(), userSources: sources, searchDepth: searchDepth.trim() || null, depth }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || errorData.error || 'Failed to create research report');
      }

      toast.success('Research started. Your report is being generated.');
      setIsAddSourceOpen(false);
      setTopic('');
      setSourceRecommendations('');
      setSearchDepth('');
      setDepth('comprehensive');
      fetchAssets();
    } catch (error: any) {
      console.error('Error creating research report:', error);
      toast.error(error.message || 'Failed to create research report');
    } finally {
      setCreatingResearch(false);
    }
  };

  const handleScrapeUrl = async () => {
    if (!urlToScrape || !session?.access_token) return;

    // Basic URL validation
    try {
      new URL(urlToScrape);
    } catch {
      toast.error('Please enter a valid URL');
      return;
    }

    setScrapingUrl(true);
    try {
      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/company-assets/url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          url: urlToScrape,
          title: urlTitle || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || errorData.error || 'Failed to scrape website');
      }

      toast.success('Website scraped and added to Company Knowledge');
      fetchAssets();
      setIsAddSourceOpen(false);
      setUrlToScrape('');
      setUrlTitle('');
    } catch (error: any) {
      console.error('Error scraping URL:', error);
      toast.error(error.message || 'Failed to scrape website');
    } finally {
      setScrapingUrl(false);
    }
  };

  // Track the confirmed/final text separately from interim text
  const confirmedNoteTextRef = useRef('');

  const toggleNoteRecording = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast.error('Speech recognition is not supported in this browser');
      return;
    }

    if (isRecordingNote) {
      noteRecognitionRef.current?.stop();
      setIsRecordingNote(false);
    } else {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      // Store the current content as the confirmed base text
      confirmedNoteTextRef.current = noteContent;

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let newFinalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            newFinalTranscript += transcript + ' ';
          } else {
            interimTranscript += transcript;
          }
        }

        // If we have new final text, add it to the confirmed base
        if (newFinalTranscript) {
          confirmedNoteTextRef.current = confirmedNoteTextRef.current + (confirmedNoteTextRef.current ? ' ' : '') + newFinalTranscript.trim();
          setNoteContent(confirmedNoteTextRef.current);
        } else if (interimTranscript) {
          // Show interim text in real-time (will be replaced when finalized)
          const baseText = confirmedNoteTextRef.current;
          setNoteContent(baseText + (baseText ? ' ' : '') + interimTranscript);
        }
      };

      recognition.onerror = () => {
        setIsRecordingNote(false);
        // Restore to confirmed text on error
        setNoteContent(confirmedNoteTextRef.current);
        toast.error('Speech recognition error');
      };

      recognition.onend = () => {
        setIsRecordingNote(false);
        // Make sure we end with the confirmed text
        setNoteContent(confirmedNoteTextRef.current);
      };

      noteRecognitionRef.current = recognition;
      recognition.start();
      setIsRecordingNote(true);
    }
  };

  const handleDeleteAsset = async (assetId: string) => {
    if (!session?.access_token) return;
    try {
      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/company-assets/${assetId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (response.ok) {
        setAssets(prev => prev.filter(a => a.id !== assetId));
        toast.success('Asset deleted');
      }
    } catch (error) {
      toast.error('Failed to delete asset');
    }
  };

  const getAssetTypeLabel = (type: string) => {
    return ASSET_TYPES.find(t => t.value === type)?.label || type;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-green-100 text-green-800">Ready</Badge>;
      case 'processing':
        return <Badge variant="secondary">Processing</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">Pending</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Company</h1>
        <p className="text-sm text-muted-foreground">Your brand identity and knowledge base for personalized content</p>
      </div>

      {/* ========== SECTION 1: Company Profile ========== */}
      <Card className="p-5">
        <h2 className="font-medium mb-4">Company Profile</h2>

        <div className="space-y-5">
          {/* Logo + Name + Website row */}
          <div className="flex items-start gap-5">
            {/* Logo */}
            <div className="flex-shrink-0">
              {logoUrl ? (
                <div className="relative group">
                  <div className="border border-border rounded-lg p-2 bg-white h-16 w-16 flex items-center justify-center">
                    <img src={logoUrl} alt="Logo" className="max-h-12 max-w-12 object-contain" />
                  </div>
                  <input type="file" id="company-logo-upload" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                  <button
                    onClick={() => document.getElementById('company-logo-upload')?.click()}
                    className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center"
                    disabled={uploadingLogo}
                  >
                    <Upload className="h-4 w-4 text-white" />
                  </button>
                </div>
              ) : (
                <label className="cursor-pointer">
                  <div className="h-16 w-16 border-2 border-dashed rounded-lg flex items-center justify-center hover:border-primary/50 transition-colors bg-muted/30">
                    {uploadingLogo ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <Upload className="h-5 w-5 text-muted-foreground" />}
                  </div>
                  <input type="file" id="company-logo-upload" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                </label>
              )}
            </div>

            {/* Name + Website */}
            <div className="flex-1 grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="company-name" className="text-xs text-muted-foreground mb-1 block">Company Name</Label>
                <Input id="company-name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Inc." disabled={loading} className="h-9" />
              </div>
              <div>
                <Label htmlFor="company-website" className="text-xs text-muted-foreground mb-1 block">Website</Label>
                <Input id="company-website" value={companyWebsite} onChange={(e) => setCompanyWebsite(e.target.value)} placeholder="https://acme.com" disabled={loading} className="h-9" />
              </div>
            </div>
          </div>

          {/* Language + Industry row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Default Language</Label>
              <Select value={defaultLanguage} onValueChange={setDefaultLanguage} disabled={loading}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="de">German</SelectItem>
                  <SelectItem value="fr">French</SelectItem>
                  <SelectItem value="es">Spanish</SelectItem>
                  <SelectItem value="it">Italian</SelectItem>
                  <SelectItem value="pt">Portuguese</SelectItem>
                  <SelectItem value="nl">Dutch</SelectItem>
                  <SelectItem value="pl">Polish</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Industry</Label>
              <Select value={industry} onValueChange={setIndustry} disabled={loading}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INDUSTRY_TYPES.map((ind) => (
                    <SelectItem key={ind.value} value={ind.value}>{ind.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Company Knowledge */}
          <div className="pt-3 border-t">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-medium">Company Knowledge</p>
                <p className="text-xs text-muted-foreground">Resources Proply references when generating proposals</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setIsAddSourceOpen(true)} className="h-8">
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </div>
            {assetsLoading ? (
              <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : assets.length === 0 ? (
              <div className="border border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setIsAddSourceOpen(true)}>
                <FileText className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
                <p className="text-xs text-muted-foreground">No documents yet</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                {assets.map((asset) => (
                  <div key={asset.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors group">
                    <div className="flex items-center gap-2 min-w-0">
                      {asset.url ? <Globe className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" /> : <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                      <span className="text-sm truncate">{asset.title}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {getStatusBadge(asset.status)}
                      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={() => handleDeleteAsset(asset.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Theme & Design — auto-extracted from website during onboarding, no manual config needed */}
      {false && <Card className="p-5">
        <h2 className="font-medium mb-4">Theme & Design</h2>

        <div className="space-y-5">
          {/* Design Style */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Design Style</Label>
            <Select value={designStyle} onValueChange={(value) => setDesignStyle(value)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DESIGN_STYLES.map((style) => (
                  <SelectItem key={style.value} value={style.value}>{style.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Theme Toggle */}
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Theme</Label>
            <div className="flex gap-2">
              <Button type="button" variant={theme === 'light' ? 'default' : 'outline'} size="sm" onClick={() => setTheme('light')} className="flex-1">
                <span className="mr-1">☀</span> Light
              </Button>
              <Button type="button" variant={theme === 'dark' ? 'default' : 'outline'} size="sm" onClick={() => setTheme('dark')} className="flex-1">
                <span className="mr-1">☾</span> Dark
              </Button>
            </div>
          </div>

          {/* Brand Color */}
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Brand Color</Label>
            <div className="flex items-center gap-2">
              <Input type="color" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} className="w-10 h-9 p-1 cursor-pointer" />
              <Input type="text" value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} className="w-24 h-9" />
            </div>
          </div>

        </div>
      </Card>}

      {/* ========== SECTION 3: Proposal Blueprints ========== */}
      <BlueprintSettingsSection />

      {/* ========== SECTION 4: Notifications ========== */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-medium">Notifications</h2>
            <p className="text-xs text-muted-foreground">Get notified when documents need signatures or are signed</p>
          </div>
        </div>

        <div className="space-y-5">
          {/* Email Notifications */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Email Notifications</span>
              </div>
              <Switch
                checked={notificationSettings.email_enabled}
                onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, email_enabled: checked }))}
              />
            </div>
            {notificationSettings.email_enabled && (
              <div className="ml-6 space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={notificationSettings.email_notifications.signature_required}
                    onChange={(e) => setNotificationSettings(prev => ({
                      ...prev,
                      email_notifications: { ...prev.email_notifications, signature_required: e.target.checked }
                    }))}
                    className="rounded border-gray-300"
                  />
                  When signature is required
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={notificationSettings.email_notifications.document_signed}
                    onChange={(e) => setNotificationSettings(prev => ({
                      ...prev,
                      email_notifications: { ...prev.email_notifications, document_signed: e.target.checked }
                    }))}
                    className="rounded border-gray-300"
                  />
                  When document is signed
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={notificationSettings.email_notifications.document_viewed}
                    onChange={(e) => setNotificationSettings(prev => ({
                      ...prev,
                      email_notifications: { ...prev.email_notifications, document_viewed: e.target.checked }
                    }))}
                    className="rounded border-gray-300"
                  />
                  When document is viewed
                </label>
              </div>
            )}
          </div>

          <Separator />

          {/* Slack Notifications */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <img src="/provider-logos/slack.svg" alt="Slack" className="h-4 w-4" />
                <span className="text-sm font-medium">Slack Notifications</span>
              </div>
              <Switch
                checked={notificationSettings.slack_enabled}
                onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, slack_enabled: checked }))}
                disabled={slackConnections.length === 0}
              />
            </div>

            {slackConnections.length === 0 ? (
              <div className="ml-6 space-y-2 p-3 bg-muted/50 rounded-lg">
                <p className="text-sm font-medium">Setup required:</p>
                <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Go to the <span className="font-medium">Integrations</span> tab</li>
                  <li>Click <span className="font-medium">Add Connection</span> and select Slack</li>
                  <li>Authorize Proply to access your Slack workspace</li>
                  <li>Come back here to select your notification channel</li>
                </ol>
              </div>
            ) : notificationSettings.slack_enabled && (
              <div className="ml-6 space-y-3">
                {/* Slack Connection Selector */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Slack Workspace</Label>
                  <Select
                    value={notificationSettings.slack_connection_id || ''}
                    onValueChange={(value) => setNotificationSettings(prev => ({
                      ...prev,
                      slack_connection_id: value,
                      slack_channel_id: null, // Reset channel when connection changes
                    }))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select Slack connection" />
                    </SelectTrigger>
                    <SelectContent>
                      {slackConnections.map((conn) => (
                        <SelectItem key={conn.id} value={conn.id}>
                          {conn.name || conn.credentials?.team_name || 'Slack Workspace'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Slack Channel Selector */}
                {notificationSettings.slack_connection_id && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Channel</Label>
                    <Select
                      value={notificationSettings.slack_channel_id || ''}
                      onValueChange={(value) => setNotificationSettings(prev => ({ ...prev, slack_channel_id: value }))}
                      disabled={loadingChannels}
                    >
                      <SelectTrigger className="h-9">
                        {loadingChannels ? (
                          <span className="flex items-center gap-2">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Loading channels...
                          </span>
                        ) : (
                          <SelectValue placeholder="Select channel" />
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        {slackChannels.map((channel) => (
                          <SelectItem key={channel.id} value={channel.id}>
                            #{channel.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      For private channels, invite the bot first: <code className="bg-muted px-1 py-0.5 rounded text-[10px]">/invite @Proply</code>
                    </p>
                  </div>
                )}

                {/* Notification Types */}
                {notificationSettings.slack_connection_id && notificationSettings.slack_channel_id && (
                  <div className="space-y-2 pt-2">
                    <Label className="text-xs text-muted-foreground">Notify on:</Label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={notificationSettings.slack_notifications.signature_required}
                        onChange={(e) => setNotificationSettings(prev => ({
                          ...prev,
                          slack_notifications: { ...prev.slack_notifications, signature_required: e.target.checked }
                        }))}
                        className="rounded border-gray-300"
                      />
                      When signature is required
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={notificationSettings.slack_notifications.document_signed}
                        onChange={(e) => setNotificationSettings(prev => ({
                          ...prev,
                          slack_notifications: { ...prev.slack_notifications, document_signed: e.target.checked }
                        }))}
                        className="rounded border-gray-300"
                      />
                      When document is signed
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={notificationSettings.slack_notifications.document_viewed}
                        onChange={(e) => setNotificationSettings(prev => ({
                          ...prev,
                          slack_notifications: { ...prev.slack_notifications, document_viewed: e.target.checked }
                        }))}
                        className="rounded border-gray-300"
                      />
                      When document is viewed
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={notificationSettings.slack_notifications.document_created}
                        onChange={(e) => setNotificationSettings(prev => ({
                          ...prev,
                          slack_notifications: { ...prev.slack_notifications, document_created: e.target.checked }
                        }))}
                        className="rounded border-gray-300"
                      />
                      When document is created
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end pt-2">
        <Button onClick={handleSaveInfo} disabled={saving || loading}>
          {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : 'Save Changes'}
        </Button>
      </div>

      {/* Add Source Dialog */}
      <Dialog open={isAddSourceOpen} onOpenChange={(open) => {
        setIsAddSourceOpen(open);
        if (!open) {
          setSelectedFile(null);
          setDocumentTitle('');
          setNoteTitle('');
          setNoteContent('');
          setTopic('');
          setSourceRecommendations('');
          setSearchDepth('');
          setDepth('comprehensive');
          setDragActive(false);
          setUrlToScrape('');
          setUrlTitle('');
        }
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Source</DialogTitle>
            <DialogDescription>Upload a file, scrape a website, or add notes to your Company Knowledge</DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'upload' | 'notes' | 'url')}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="upload">Upload File</TabsTrigger>
              <TabsTrigger value="url">Website URL</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-4 mt-4">
              <div>
                <Label htmlFor="file">Select File</Label>
                <Card
                  className={cn(
                    "border-2 border-dashed mt-2 p-8 text-center cursor-pointer transition-all duration-200",
                    dragActive
                      ? "border-primary bg-primary/5 scale-[1.01]"
                      : "border-border hover:border-primary/50 hover:bg-muted/30"
                  )}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    id="file"
                    accept=".pdf,.doc,.docx,.txt"
                    onChange={(e) => handleFileSelect(e.target.files)}
                    className="hidden"
                  />
                  <div className="flex flex-col items-center">
                    <Upload className={cn(
                      "h-8 w-8 mb-3 transition-all duration-200",
                      dragActive ? "text-primary scale-110" : "text-muted-foreground"
                    )} />
                    <p className="text-sm font-medium mb-1">
                      {dragActive ? 'Drop file here' : 'Drag and drop a file here, or click to browse'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      PDF, DOC, DOCX, TXT files (Max 10MB)
                    </p>
                  </div>
                </Card>
                {selectedFile && (
                  <div className="mt-2 p-2 bg-muted rounded flex items-center justify-between">
                    <span className="text-sm">{selectedFile.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>

              <div>
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={documentTitle}
                  onChange={(e) => setDocumentTitle(e.target.value)}
                  placeholder="Enter title"
                  className="mt-2"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setIsAddSourceOpen(false)} disabled={uploadingAsset}>
                  Cancel
                </Button>
                <Button onClick={handleUploadFile} disabled={!selectedFile || uploadingAsset}>
                  {uploadingAsset ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    'Upload'
                  )}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="url" className="space-y-4 mt-4">
              <div>
                <Label htmlFor="url-input">Website URL *</Label>
                <Input
                  id="url-input"
                  type="url"
                  value={urlToScrape}
                  onChange={(e) => setUrlToScrape(e.target.value)}
                  placeholder="https://example.com"
                  disabled={scrapingUrl}
                  className="mt-2"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Enter the URL of a website to scrape and add its content to your knowledge base
                </p>
              </div>

              <div>
                <Label htmlFor="url-title">Title (Optional)</Label>
                <Input
                  id="url-title"
                  value={urlTitle}
                  onChange={(e) => setUrlTitle(e.target.value)}
                  placeholder="Leave empty to use page title"
                  disabled={scrapingUrl}
                  className="mt-2"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setIsAddSourceOpen(false)} disabled={scrapingUrl}>
                  Cancel
                </Button>
                <Button onClick={handleScrapeUrl} disabled={!urlToScrape || scrapingUrl}>
                  {scrapingUrl ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Scraping...
                    </>
                  ) : (
                    'Add Website'
                  )}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="notes" className="space-y-4 py-4">
              <div>
                <Label htmlFor="note-title">Title *</Label>
                <Input
                  id="note-title"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="e.g., Key Product Features, Meeting Notes"
                  disabled={savingNote}
                  className="mt-1"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label htmlFor="note-content">Content *</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={toggleNoteRecording}
                    className={cn(
                      "h-8 px-2",
                      isRecordingNote && "text-red-600 animate-pulse"
                    )}
                  >
                    {isRecordingNote ? (
                      <>
                        <MicOff className="h-4 w-4 mr-1" />
                        Stop
                      </>
                    ) : (
                      <>
                        <Mic className="h-4 w-4 mr-1" />
                        Dictate
                      </>
                    )}
                  </Button>
                </div>
                <Textarea
                  id="note-content"
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Type or dictate your notes here. This content will be processed and used as context for AI generation."
                  disabled={savingNote}
                  className="mt-1 min-h-[180px]"
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  Your notes will be processed and used as AI context
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setIsAddSourceOpen(false)} disabled={savingNote}>
                  Cancel
                </Button>
                <Button onClick={handleSaveNote} disabled={!noteTitle.trim() || !noteContent.trim() || savingNote}>
                  {savingNote ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Notes'
                  )}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* View Asset Content Dialog */}
      <Dialog open={!!viewingAsset} onOpenChange={(open) => !open && setViewingAsset(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {viewingAsset?.url ? <Globe className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
              {viewingAsset?.title}
            </DialogTitle>
            {viewingAsset?.url && (
              <DialogDescription className="flex items-center gap-2">
                <a
                  href={viewingAsset.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline flex items-center gap-1"
                >
                  {viewingAsset.url}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="flex-1 overflow-y-auto mt-4">
            <div className="bg-muted/30 rounded-lg p-4 text-sm whitespace-pre-wrap font-mono leading-relaxed">
              {viewingAsset?.content_text || 'No content available'}
            </div>
          </div>
          <div className="flex justify-between items-center pt-4 border-t">
            <p className="text-xs text-muted-foreground">
              {viewingAsset?.content_text?.length.toLocaleString()} characters
            </p>
            <Button variant="outline" onClick={() => setViewingAsset(null)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Report Templates Section - Design Settings
const REPORT_SUBTYPES = [
  { key: 'monthly', label: 'Monthly Performance Report', description: 'Recurring monthly update on account performance', pages: '4-7' },
  { key: 'ad_campaign', label: 'Ad Campaign Report', description: 'Performance report for paid advertising', pages: '4-8' },
  { key: 'seo', label: 'SEO Report', description: 'Organic search and rankings report', pages: '5-10' },
  { key: 'cold_email_leadgen', label: 'Lead Generation Report', description: 'Cold email and outbound performance', pages: '3-6' },
  { key: 'consulting', label: 'Consulting Report', description: 'Strategy and consulting deliverable', pages: '8-20' },
  { key: 'audit', label: 'Audit Report', description: 'Audit and assessment findings', pages: '8-15' },
  { key: 'industry_analysis', label: 'Industry Analysis', description: 'Market and industry research', pages: '12-20' },
];

interface DesignConfig {
  theme: 'light' | 'dark';
  secondaryColor: string;
  colorApplication: 'accent_only' | 'consistent_theme';
  logo: string | null;
  backgrounds: {
    cover: string | null;      // User-selected inspiration for cover
    inner: string | null;      // User-selected inspiration for inner pages
  };
  generatedBackgrounds?: {     // AI-generated variants (populated on save)
    cover: string | null;      // Generated cover background
    inner1: string | null;     // Generated inner variant 1
    inner2: string | null;     // Generated inner variant 2
  };
  // Legacy fields for backwards compatibility
  colors?: {
    primary: string;
    secondary: string;
    accent: string;
  };
  fonts?: {
    heading: string;
    body: string;
  };
}

const DEFAULT_DESIGN: DesignConfig = {
  theme: 'dark',
  secondaryColor: '#8b5cf6',
  colorApplication: 'accent_only',
  logo: null,
  backgrounds: { cover: null, inner: null }
};

function ReportTemplatesSection() {
  const { userData, session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [designSettings, setDesignSettings] = useState<Record<string, DesignConfig>>({});
  const [editingSubtype, setEditingSubtype] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<DesignConfig>(DEFAULT_DESIGN);
  const [saving, setSaving] = useState(false);
  const [generatingBackgrounds, setGeneratingBackgrounds] = useState<Record<string, boolean>>({}); // Track per subtype
  const [inspirations, setInspirations] = useState<any>({ photographic: [], visual: [], conceptual: [], textural: [], uncategorized: [] });
  const [loadingInspirations, setLoadingInspirations] = useState(false);
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBackground, setUploadingBackground] = useState(false);
  const [backgroundTab, setBackgroundTab] = useState<'cover' | 'inner'>('cover');
  const logoInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);

  const workspaceId = userData?.workspace?.id || localStorage.getItem('selectedWorkspaceId');
  const apiUrl = import.meta.env.VITE_API_URL ?? '';

  // Get configured and unconfigured report types
  const configuredTypes = REPORT_SUBTYPES.filter(s => designSettings[s.key]);
  const unconfiguredTypes = REPORT_SUBTYPES.filter(s => !designSettings[s.key]);

  useEffect(() => {
    if (workspaceId && session?.access_token) {
      fetchDesignSettings();
    }
  }, [workspaceId, session]);

  const fetchDesignSettings = async () => {
    if (!workspaceId || !session?.access_token) return;
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/report-design-settings`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (response.ok) {
        const data = await response.json();
        const settingsMap: Record<string, DesignConfig> = {};
        (data.settings || []).forEach((s: any) => {
          settingsMap[s.reportSubtype] = s.designConfig;
        });
        setDesignSettings(settingsMap);
      }
    } catch (error) {
      console.error('Error fetching design settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchInspirations = async () => {
    if (!session?.access_token) return;
    setLoadingInspirations(true);
    try {
      // Use the same endpoint as the Background Inspirations modal
      const response = await fetch(`${apiUrl}/api/background-inspirations/for-picker`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (response.ok) {
        const data = await response.json();
        console.log('[REPORT_TEMPLATES] Fetched inspirations:', data.inspirations);
        // Count by page_type for debugging
        const allItems = [
          ...(data.inspirations?.photographic || []),
          ...(data.inspirations?.visual || []),
          ...(data.inspirations?.conceptual || []),
          ...(data.inspirations?.textural || []),
          ...(data.inspirations?.uncategorized || []),
        ];
        const coverCount = allItems.filter((i: any) => i.page_type === 'cover').length;
        const innerCount = allItems.filter((i: any) => i.page_type === 'inner').length;
        console.log('[REPORT_TEMPLATES] Cover inspirations:', coverCount, 'Inner inspirations:', innerCount);
        console.log('[REPORT_TEMPLATES] Sample item:', allItems[0]);
        setInspirations(data.inspirations || {});
      } else {
        console.error('[REPORT_TEMPLATES] Failed to fetch inspirations:', response.status);
      }
    } catch (error) {
      console.error('Error fetching inspirations:', error);
    } finally {
      setLoadingInspirations(false);
    }
  };

  const startEditing = (subtype: string) => {
    const existing = designSettings[subtype];
    // Normalize legacy config to new format
    if (existing) {
      const normalized: DesignConfig = {
        theme: existing.theme || 'dark',
        secondaryColor: existing.secondaryColor || existing.colors?.secondary || '#8b5cf6',
        colorApplication: existing.colorApplication || 'accent_only',
        logo: existing.logo || null,
        backgrounds: existing.backgrounds || { cover: null, inner: null }
      };
      setEditingConfig(normalized);
    } else {
      setEditingConfig(JSON.parse(JSON.stringify(DEFAULT_DESIGN)));
    }
    setEditingSubtype(subtype);
    setShowAddDropdown(false);
    fetchInspirations();
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !workspaceId || !session?.access_token) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size must be less than 5MB');
      return;
    }

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('workspaceId', workspaceId);

      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/upload-logo`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        setEditingConfig(prev => ({ ...prev, logo: data.url }));
        toast.success('Logo uploaded');
      } else {
        toast.error('Failed to upload logo');
      }
    } catch (error) {
      console.error('Error uploading logo:', error);
      toast.error('Failed to upload logo');
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) {
        logoInputRef.current.value = '';
      }
    }
  };

  const handleBackgroundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !workspaceId || !session?.access_token) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    // Validate file size (max 10MB for backgrounds)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size must be less than 10MB');
      return;
    }

    setUploadingBackground(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('workspaceId', workspaceId);
      formData.append('type', backgroundTab); // 'cover' or 'inner'

      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/upload-background`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        setEditingConfig(prev => ({
          ...prev,
          backgrounds: { ...prev.backgrounds, [backgroundTab]: data.url }
        }));
        toast.success(`${backgroundTab === 'cover' ? 'Cover' : 'Inner page'} background uploaded`);
      } else {
        toast.error('Failed to upload background');
      }
    } catch (error) {
      console.error('Error uploading background:', error);
      toast.error('Failed to upload background');
    } finally {
      setUploadingBackground(false);
      if (backgroundInputRef.current) {
        backgroundInputRef.current.value = '';
      }
    }
  };

  const saveDesign = async () => {
    if (!workspaceId || !session?.access_token || !editingSubtype) return;
    setSaving(true);

    const subtypeToSave = editingSubtype;
    const configToSave = { ...editingConfig };

    try {
      // Save immediately - don't wait for background generation
      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/report-design-settings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reportSubtype: subtypeToSave, designConfig: configToSave }),
      });

      if (response.ok) {
        toast.success('Design settings saved');
        setDesignSettings(prev => ({ ...prev, [subtypeToSave]: configToSave }));
        setEditingSubtype(null); // Close editor immediately
        setSaving(false);

        // Check if we need to generate backgrounds (async, in background)
        const needsBackgroundGeneration =
          (configToSave.backgrounds?.cover || configToSave.backgrounds?.inner) &&
          !configToSave.generatedBackgrounds; // Only if not already generated

        if (needsBackgroundGeneration) {
          // Start background generation (don't await)
          generateBackgroundsAsync(subtypeToSave, configToSave);
        }
      } else {
        toast.error('Failed to save design');
        setSaving(false);
      }
    } catch (error) {
      console.error('Error saving design:', error);
      toast.error('Failed to save design');
      setSaving(false);
    }
  };

  // Background generation - runs async after save
  const generateBackgroundsAsync = async (subtype: string, config: DesignConfig) => {
    if (!workspaceId || !session?.access_token) return;

    // Mark as generating
    setGeneratingBackgrounds(prev => ({ ...prev, [subtype]: true }));

    try {
      const genResponse = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/report-design-settings/generate-backgrounds`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reportSubtype: subtype,
          designConfig: config,
          coverInspiration: config.backgrounds?.cover,
          innerInspiration: config.backgrounds?.inner
        }),
      });

      if (genResponse.ok) {
        const genData = await genResponse.json();

        // Update config with generated backgrounds
        const updatedConfig: DesignConfig = {
          ...config,
          generatedBackgrounds: genData.generatedBackgrounds
        };

        // Save the updated config with generated backgrounds
        await fetch(`${apiUrl}/api/workspaces/${workspaceId}/report-design-settings`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reportSubtype: subtype, designConfig: updatedConfig }),
        });

        // Update local state
        setDesignSettings(prev => ({ ...prev, [subtype]: updatedConfig }));
        toast.success('Background variants generated');
      } else {
        console.warn('Background generation failed');
        toast.error('Failed to generate background variants');
      }
    } catch (error) {
      console.error('Error generating backgrounds:', error);
      toast.error('Failed to generate background variants');
    } finally {
      setGeneratingBackgrounds(prev => ({ ...prev, [subtype]: false }));
    }
  };

  const removeDesign = async (subtype: string) => {
    if (!workspaceId || !session?.access_token) return;
    try {
      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceId}/report-design-settings/${subtype}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (response.ok) {
        toast.success('Design removed');
        const newSettings = { ...designSettings };
        delete newSettings[subtype];
        setDesignSettings(newSettings);
        if (editingSubtype === subtype) {
          setEditingSubtype(null);
        }
      }
    } catch (error) {
      console.error('Error removing design:', error);
    }
  };

  const allInspirations = [
    ...(inspirations.photographic || []),
    ...(inspirations.visual || []),
    ...(inspirations.conceptual || []),
    ...(inspirations.textural || []),
    ...(inspirations.uncategorized || []),
  ];

  // Filter inspirations by page type for background selection
  // Only show images that match the selected tab - no fallback to all images
  const coverImages = allInspirations.filter((insp: any) => insp.page_type === 'cover');
  const innerImages = allInspirations.filter((insp: any) => insp.page_type === 'inner');

  const getSubtypeInfo = (key: string) => REPORT_SUBTYPES.find(s => s.key === key);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-medium">Report Templates</h3>
          <p className="text-sm text-muted-foreground">
            Configure design settings for report types. These will be applied automatically when generating client reports.
          </p>
        </div>

        {/* Add Report Type Button - only show in header when there are already configured types */}
        {unconfiguredTypes.length > 0 && configuredTypes.length > 0 && (
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setShowAddDropdown(!showAddDropdown)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Report Type
            </Button>

            {showAddDropdown && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowAddDropdown(false)} />
                <div className="absolute right-0 mt-1 w-64 bg-white border rounded-lg shadow-lg z-50 py-1">
                  {unconfiguredTypes.map((subtype) => (
                    <button
                      key={subtype.key}
                      className="w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                      onClick={() => startEditing(subtype.key)}
                    >
                      <div className="font-medium text-sm">{subtype.label}</div>
                      <div className="text-xs text-muted-foreground">{subtype.description}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Configured Report Types */}
      {configuredTypes.length > 0 ? (
        <div className="space-y-3">
          {configuredTypes.map((subtype) => {
            const config = designSettings[subtype.key];
            const isEditing = editingSubtype === subtype.key;
            const isGenerating = generatingBackgrounds[subtype.key];
            const hasGeneratedBackgrounds = !!(config.generatedBackgrounds?.cover || config.generatedBackgrounds?.inner1);

            return (
              <div key={subtype.key} className={`border rounded-lg p-4 bg-white ${isGenerating ? 'border-primary/50' : ''}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-sm">{subtype.label}</h4>
                      <span className="text-xs text-muted-foreground">({subtype.pages} pages)</span>
                      {isGenerating && (
                        <span className="flex items-center gap-1 text-xs text-primary">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Generating variants...
                        </span>
                      )}
                      {hasGeneratedBackgrounds && !isGenerating && (
                        <span className="text-xs text-green-600 flex items-center gap-1">
                          <Check className="h-3 w-3" />
                          Ready
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{subtype.description}</p>

                    <div className="mt-3 flex items-center gap-3">
                      {/* Theme badge */}
                      <span className={`text-xs px-2 py-0.5 rounded ${config.theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-800'}`}>
                        {config.theme === 'dark' ? 'Dark' : 'Light'}
                      </span>
                      {/* Color preview */}
                      <div className="w-4 h-4 rounded border" style={{ backgroundColor: config.secondaryColor || config.colors?.secondary || '#8b5cf6' }} />
                      {/* Logo preview */}
                      {config.logo && (
                        <img src={config.logo} alt="" className="h-6 object-contain" />
                      )}
                      {/* Generated background previews */}
                      {hasGeneratedBackgrounds ? (
                        <div className="flex items-center gap-1">
                          {config.generatedBackgrounds?.cover && (
                            <img src={config.generatedBackgrounds.cover} alt="Cover" className="w-6 h-8 object-cover rounded border" title="Cover" />
                          )}
                          {config.generatedBackgrounds?.inner1 && (
                            <img src={config.generatedBackgrounds.inner1} alt="Inner 1" className="w-6 h-8 object-cover rounded border" title="Inner 1" />
                          )}
                          {config.generatedBackgrounds?.inner2 && (
                            <img src={config.generatedBackgrounds.inner2} alt="Inner 2" className="w-6 h-8 object-cover rounded border" title="Inner 2" />
                          )}
                        </div>
                      ) : config.backgrounds?.cover ? (
                        <img src={config.backgrounds.cover} alt="" className="w-8 h-10 object-cover rounded border opacity-50" title="Pending generation" />
                      ) : null}
                      <div className="flex items-center gap-1 ml-auto">
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => startEditing(subtype.key)} disabled={isGenerating}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => removeDesign(subtype.key)} disabled={isGenerating}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Design Editor */}
                {isEditing && (
                  <div className="mt-4 pt-4 border-t space-y-5">
                    {/* Theme Toggle */}
                    <div>
                      <Label className="text-xs font-medium">Theme</Label>
                      <div className="flex gap-2 mt-1.5">
                        <Button
                          type="button"
                          variant={editingConfig.theme === 'dark' ? 'default' : 'outline'}
                          size="sm"
                          className="h-8"
                          onClick={() => setEditingConfig(prev => ({ ...prev, theme: 'dark' }))}
                        >
                          Dark
                        </Button>
                        <Button
                          type="button"
                          variant={editingConfig.theme === 'light' ? 'default' : 'outline'}
                          size="sm"
                          className="h-8"
                          onClick={() => setEditingConfig(prev => ({ ...prev, theme: 'light' }))}
                        >
                          Light
                        </Button>
                      </div>
                    </div>

                    {/* Secondary Color */}
                    <div>
                      <Label className="text-xs font-medium">Secondary Color</Label>
                      <div className="flex gap-2 mt-1.5">
                        <input
                          type="color"
                          value={editingConfig.secondaryColor}
                          onChange={(e) => setEditingConfig(prev => ({ ...prev, secondaryColor: e.target.value }))}
                          className="w-10 h-10 rounded border cursor-pointer"
                        />
                        <Input
                          value={editingConfig.secondaryColor}
                          onChange={(e) => setEditingConfig(prev => ({ ...prev, secondaryColor: e.target.value }))}
                          className="h-10 text-sm w-32"
                          placeholder="#8b5cf6"
                        />
                      </div>
                    </div>

                    {/* Color Application */}
                    <div>
                      <Label className="text-xs font-medium">Color Application</Label>
                      <div className="mt-1.5 space-y-2">
                        <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${editingConfig.colorApplication === 'accent_only' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}>
                          <input
                            type="radio"
                            name="colorApplication"
                            checked={editingConfig.colorApplication === 'accent_only'}
                            onChange={() => setEditingConfig(prev => ({ ...prev, colorApplication: 'accent_only' }))}
                            className="mt-0.5"
                          />
                          <div>
                            <div className="font-medium text-sm">Accent only</div>
                            <div className="text-xs text-muted-foreground">Cover + headers only. Inner pages stay white.</div>
                          </div>
                        </label>
                        <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${editingConfig.colorApplication === 'consistent_theme' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}>
                          <input
                            type="radio"
                            name="colorApplication"
                            checked={editingConfig.colorApplication === 'consistent_theme'}
                            onChange={() => setEditingConfig(prev => ({ ...prev, colorApplication: 'consistent_theme' }))}
                            className="mt-0.5"
                          />
                          <div>
                            <div className="font-medium text-sm">Consistent theme</div>
                            <div className="text-xs text-muted-foreground">Light tints on inner page backgrounds.</div>
                          </div>
                        </label>
                      </div>
                    </div>

                    {/* Logo */}
                    <div>
                      <Label className="text-xs font-medium">Logo</Label>
                      <p className="text-xs text-muted-foreground mt-0.5 mb-2">Upload your logo or select from inspiration images</p>

                      {/* Current logo */}
                      {editingConfig.logo && (
                        <div className="flex items-center gap-3 mb-3 p-3 bg-green-50 rounded-lg">
                          <img src={editingConfig.logo} alt="Logo" className="h-10 object-contain" />
                          <span className="text-xs text-green-700 flex-1">Selected</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setEditingConfig(prev => ({ ...prev, logo: null }))}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      )}

                      {/* Upload button */}
                      <div className="flex gap-2 mb-3">
                        <input
                          ref={logoInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleLogoUpload}
                          className="hidden"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => logoInputRef.current?.click()}
                          disabled={uploadingLogo}
                        >
                          {uploadingLogo ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}
                          Upload Logo
                        </Button>
                      </div>

                      {/* Inspiration gallery for logos */}
                      {loadingInspirations ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      ) : allInspirations.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-2">No inspiration images available.</p>
                      ) : (
                        <div className="grid grid-cols-6 gap-1.5 max-h-[100px] overflow-y-auto">
                          {allInspirations.slice(0, 12).map((insp: any) => (
                            <button
                              key={insp.id}
                              type="button"
                              className={`aspect-square rounded border-2 overflow-hidden transition-all ${
                                editingConfig.logo === insp.image_url
                                  ? 'border-primary ring-2 ring-primary/20'
                                  : 'border-border hover:border-primary/50'
                              }`}
                              onClick={() => setEditingConfig(prev => ({ ...prev, logo: insp.image_url }))}
                            >
                              <img src={insp.image_url} alt="" className="w-full h-full object-cover" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Background Images */}
                    <div>
                      <Label className="text-xs font-medium">Background Images</Label>

                      {/* LOCKED STATE: Show generated backgrounds as read-only */}
                      {editingConfig.generatedBackgrounds?.cover || editingConfig.generatedBackgrounds?.inner1 ? (
                        <div className="mt-2 p-3 bg-gray-50 rounded-lg border">
                          <div className="flex items-center gap-2 mb-3">
                            <Check className="h-4 w-4 text-green-600" />
                            <span className="text-xs font-medium text-green-700">Backgrounds Generated</span>
                          </div>
                          <div className="flex gap-3">
                            {editingConfig.generatedBackgrounds?.cover && (
                              <div className="text-center">
                                <img src={editingConfig.generatedBackgrounds.cover} alt="Cover" className="w-16 h-20 object-cover rounded border mb-1" />
                                <span className="text-[10px] text-muted-foreground">Cover</span>
                              </div>
                            )}
                            {editingConfig.generatedBackgrounds?.inner1 && (
                              <div className="text-center">
                                <img src={editingConfig.generatedBackgrounds.inner1} alt="Inner 1" className="w-16 h-20 object-cover rounded border mb-1" />
                                <span className="text-[10px] text-muted-foreground">Inner 1</span>
                              </div>
                            )}
                            {editingConfig.generatedBackgrounds?.inner2 && (
                              <div className="text-center">
                                <img src={editingConfig.generatedBackgrounds.inner2} alt="Inner 2" className="w-16 h-20 object-cover rounded border mb-1" />
                                <span className="text-[10px] text-muted-foreground">Inner 2</span>
                              </div>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-2">To change backgrounds, delete this template and create a new one.</p>
                        </div>
                      ) : (
                        <>
                          {/* EDITABLE STATE: Show selection UI */}
                          <div className="flex items-center justify-end mt-2 mb-2">
                            <div className="flex border rounded overflow-hidden">
                              <button
                                type="button"
                                className={`px-3 py-1 text-xs font-medium transition-colors ${backgroundTab === 'cover' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                                onClick={() => setBackgroundTab('cover')}
                              >
                                Cover
                              </button>
                              <button
                                type="button"
                                className={`px-3 py-1 text-xs font-medium transition-colors ${backgroundTab === 'inner' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                                onClick={() => setBackgroundTab('inner')}
                              >
                                Inner Pages
                              </button>
                            </div>
                          </div>

                          <p className="text-xs text-muted-foreground mb-3">
                            {backgroundTab === 'cover'
                              ? 'Upload or select an image for the cover page'
                              : 'Upload or select an image for inner pages (2 variants will be generated)'}
                          </p>

                          {/* Current selection */}
                          {editingConfig.backgrounds?.[backgroundTab] && (
                            <div className="flex items-center gap-3 mb-3 p-2 bg-green-50 rounded-lg">
                              <img src={editingConfig.backgrounds[backgroundTab]!} alt="" className="w-16 h-20 object-cover rounded border" />
                              <span className="text-xs text-green-700 flex-1">Selected</span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setEditingConfig(prev => ({
                                  ...prev,
                                  backgrounds: { ...prev.backgrounds, [backgroundTab]: null }
                                }))}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          )}

                          {/* Upload button */}
                          <div className="mb-3">
                            <input
                              ref={backgroundInputRef}
                              type="file"
                              accept="image/*"
                              onChange={handleBackgroundUpload}
                              className="hidden"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => backgroundInputRef.current?.click()}
                              disabled={uploadingBackground}
                            >
                              {uploadingBackground ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}
                              Upload {backgroundTab === 'cover' ? 'Cover' : 'Inner Page'} Background
                            </Button>
                          </div>

                          {/* Inspiration gallery - filtered by page type */}
                          {loadingInspirations ? (
                            <div className="flex items-center justify-center py-4">
                              <Loader2 className="h-4 w-4 animate-spin" />
                            </div>
                          ) : (backgroundTab === 'cover' ? coverImages : innerImages).length > 0 ? (
                            <>
                              <p className="text-xs text-muted-foreground mb-2">Or select from gallery:</p>
                              <div className="grid grid-cols-6 gap-1.5 max-h-[150px] overflow-y-auto">
                                {(backgroundTab === 'cover' ? coverImages : innerImages).map((insp: any) => (
                                  <button
                                    key={insp.id}
                                    type="button"
                                    className={`aspect-[8.5/11] rounded border-2 overflow-hidden transition-all ${
                                      editingConfig.backgrounds?.[backgroundTab] === insp.image_url
                                        ? 'border-primary ring-2 ring-primary/20'
                                        : 'border-border hover:border-primary/50'
                                    }`}
                                    onClick={() => setEditingConfig(prev => ({
                                      ...prev,
                                      backgrounds: { ...prev.backgrounds, [backgroundTab]: insp.image_url }
                                    }))}
                                  >
                                    <img src={insp.image_url} alt="" className="w-full h-full object-cover" />
                                  </button>
                                ))}
                              </div>
                            </>
                          ) : (
                            <div className="text-center py-4 px-2 bg-muted/30 rounded-lg">
                              <p className="text-xs text-muted-foreground">No {backgroundTab === 'cover' ? 'cover' : 'inner page'} backgrounds available.</p>
                              <p className="text-[10px] text-muted-foreground/70 mt-1">Upload {backgroundTab} backgrounds in the CMS Background Inspirations panel, or upload your own above.</p>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-2">
                      <Button size="sm" onClick={saveDesign} disabled={saving} className="h-8">
                        {saving ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Check className="h-3 w-3 mr-1" />
                            Save Design
                          </>
                        )}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8" onClick={() => setEditingSubtype(null)} disabled={saving}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Empty state when no report types are configured */
        <div className="border-2 border-dashed rounded-lg p-8 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
            <FileText className="h-6 w-6 text-muted-foreground" />
          </div>
          <h4 className="font-medium text-sm mb-1">No report templates configured</h4>
          <p className="text-xs text-muted-foreground mb-4">
            Add a report type to configure its design settings (theme, color, logo, background).
          </p>
          {unconfiguredTypes.length > 0 && (
            <div className="relative inline-block">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddDropdown(!showAddDropdown)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Report Type
              </Button>

              {showAddDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowAddDropdown(false)} />
                  <div className="absolute left-1/2 -translate-x-1/2 mt-1 w-64 bg-white border rounded-lg shadow-lg z-50 py-1">
                    {unconfiguredTypes.map((subtype) => (
                      <button
                        key={subtype.key}
                        className="w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                        onClick={() => startEditing(subtype.key)}
                      >
                        <div className="font-medium text-sm">{subtype.label}</div>
                        <div className="text-xs text-muted-foreground">{subtype.description}</div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Editor for new (unconfigured) types */}
      {editingSubtype && !designSettings[editingSubtype] && (
        <div className="border rounded-lg p-4 bg-white">
          <div className="flex items-center gap-2 mb-4">
            <h4 className="font-medium text-sm">{getSubtypeInfo(editingSubtype)?.label}</h4>
            <span className="text-xs text-muted-foreground">({getSubtypeInfo(editingSubtype)?.pages} pages)</span>
          </div>

          <div className="space-y-5">
            {/* Theme Toggle */}
            <div>
              <Label className="text-xs font-medium">Theme</Label>
              <div className="flex gap-2 mt-1.5">
                <Button
                  type="button"
                  variant={editingConfig.theme === 'dark' ? 'default' : 'outline'}
                  size="sm"
                  className="h-8"
                  onClick={() => setEditingConfig(prev => ({ ...prev, theme: 'dark' }))}
                >
                  Dark
                </Button>
                <Button
                  type="button"
                  variant={editingConfig.theme === 'light' ? 'default' : 'outline'}
                  size="sm"
                  className="h-8"
                  onClick={() => setEditingConfig(prev => ({ ...prev, theme: 'light' }))}
                >
                  Light
                </Button>
              </div>
            </div>

            {/* Secondary Color */}
            <div>
              <Label className="text-xs font-medium">Secondary Color</Label>
              <div className="flex gap-2 mt-1.5">
                <input
                  type="color"
                  value={editingConfig.secondaryColor}
                  onChange={(e) => setEditingConfig(prev => ({ ...prev, secondaryColor: e.target.value }))}
                  className="w-10 h-10 rounded border cursor-pointer"
                />
                <Input
                  value={editingConfig.secondaryColor}
                  onChange={(e) => setEditingConfig(prev => ({ ...prev, secondaryColor: e.target.value }))}
                  className="h-10 text-sm w-32"
                  placeholder="#8b5cf6"
                />
              </div>
            </div>

            {/* Color Application */}
            <div>
              <Label className="text-xs font-medium">Color Application</Label>
              <div className="mt-1.5 space-y-2">
                <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${editingConfig.colorApplication === 'accent_only' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}>
                  <input
                    type="radio"
                    name="colorApplicationNew"
                    checked={editingConfig.colorApplication === 'accent_only'}
                    onChange={() => setEditingConfig(prev => ({ ...prev, colorApplication: 'accent_only' }))}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-medium text-sm">Accent only</div>
                    <div className="text-xs text-muted-foreground">Cover + headers only. Inner pages stay white.</div>
                  </div>
                </label>
                <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${editingConfig.colorApplication === 'consistent_theme' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}>
                  <input
                    type="radio"
                    name="colorApplicationNew"
                    checked={editingConfig.colorApplication === 'consistent_theme'}
                    onChange={() => setEditingConfig(prev => ({ ...prev, colorApplication: 'consistent_theme' }))}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-medium text-sm">Consistent theme</div>
                    <div className="text-xs text-muted-foreground">Light tints on inner page backgrounds.</div>
                  </div>
                </label>
              </div>
            </div>

            {/* Logo */}
            <div>
              <Label className="text-xs font-medium">Logo</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-2">Upload your logo or select from inspiration images</p>

              {/* Current logo */}
              {editingConfig.logo && (
                <div className="flex items-center gap-3 mb-3 p-3 bg-green-50 rounded-lg">
                  <img src={editingConfig.logo} alt="Logo" className="h-10 object-contain" />
                  <span className="text-xs text-green-700 flex-1">Selected</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setEditingConfig(prev => ({ ...prev, logo: null }))}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}

              {/* Upload button */}
              <div className="flex gap-2 mb-3">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={uploadingLogo}
                >
                  {uploadingLogo ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}
                  Upload Logo
                </Button>
              </div>

              {/* Inspiration gallery for logos */}
              {loadingInspirations ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : allInspirations.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No inspiration images available.</p>
              ) : (
                <div className="grid grid-cols-6 gap-1.5 max-h-[100px] overflow-y-auto">
                  {allInspirations.slice(0, 12).map((insp: any) => (
                    <button
                      key={insp.id}
                      type="button"
                      className={`aspect-square rounded border-2 overflow-hidden transition-all ${
                        editingConfig.logo === insp.image_url
                          ? 'border-primary ring-2 ring-primary/20'
                          : 'border-border hover:border-primary/50'
                      }`}
                      onClick={() => setEditingConfig(prev => ({ ...prev, logo: insp.image_url }))}
                    >
                      <img src={insp.image_url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Background Images */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs font-medium">Background Images</Label>
                <div className="flex border rounded overflow-hidden">
                  <button
                    type="button"
                    className={`px-3 py-1 text-xs font-medium transition-colors ${backgroundTab === 'cover' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                    onClick={() => setBackgroundTab('cover')}
                  >
                    Cover
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1 text-xs font-medium transition-colors ${backgroundTab === 'inner' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                    onClick={() => setBackgroundTab('inner')}
                  >
                    Inner Pages
                  </button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground mb-3">
                {backgroundTab === 'cover'
                  ? 'Upload or select an image for the cover page'
                  : 'Upload or select an image for inner pages (2 variants will be generated)'}
              </p>

              {/* Current selection */}
              {editingConfig.backgrounds?.[backgroundTab] && (
                <div className="flex items-center gap-3 mb-3 p-2 bg-green-50 rounded-lg">
                  <img src={editingConfig.backgrounds[backgroundTab]!} alt="" className="w-16 h-20 object-cover rounded border" />
                  <span className="text-xs text-green-700 flex-1">Selected</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setEditingConfig(prev => ({
                      ...prev,
                      backgrounds: { ...prev.backgrounds, [backgroundTab]: null }
                    }))}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}

              {/* Upload button */}
              <div className="mb-3">
                <input
                  ref={backgroundInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleBackgroundUpload}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => backgroundInputRef.current?.click()}
                  disabled={uploadingBackground}
                >
                  {uploadingBackground ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}
                  Upload {backgroundTab === 'cover' ? 'Cover' : 'Inner Page'} Background
                </Button>
              </div>

              {/* Inspiration gallery - filtered by page type */}
              {loadingInspirations ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : (backgroundTab === 'cover' ? coverImages : innerImages).length > 0 ? (
                <>
                  <p className="text-xs text-muted-foreground mb-2">Or select from gallery:</p>
                  <div className="grid grid-cols-6 gap-1.5 max-h-[150px] overflow-y-auto">
                    {(backgroundTab === 'cover' ? coverImages : innerImages).map((insp: any) => (
                      <button
                        key={insp.id}
                        type="button"
                        className={`aspect-[8.5/11] rounded border-2 overflow-hidden transition-all ${
                          editingConfig.backgrounds?.[backgroundTab] === insp.image_url
                            ? 'border-primary ring-2 ring-primary/20'
                            : 'border-border hover:border-primary/50'
                        }`}
                        onClick={() => setEditingConfig(prev => ({
                          ...prev,
                          backgrounds: { ...prev.backgrounds, [backgroundTab]: insp.image_url }
                        }))}
                      >
                        <img src={insp.image_url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground py-2">No {backgroundTab === 'cover' ? 'cover' : 'inner page'} inspirations available.</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={saveDesign} disabled={saving} className="h-8">
                {saving ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="h-3 w-3 mr-1" />
                    Save Design
                  </>
                )}
              </Button>
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setEditingSubtype(null)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
        <div className="flex gap-3">
          <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-700">
            <p className="font-medium">How it works</p>
            <p className="text-blue-600 mt-1">
              When you save, we generate background variants from your selected inspirations:
              1 cover + 2 inner page variants. These are applied automatically to your reports.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Subscription Section
function SubscriptionSection({ session }: { session: any }) {
  const { userData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [usageData, setUsageData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<"month" | "year">("month");
  const [upgradeLoading, setUpgradeLoading] = useState<string | null>(null);

  useEffect(() => {
    if (session?.access_token) {
      loadUsageData();
    }
  }, [session]);

  // Refresh usage data when component becomes visible (e.g., when modal opens)
  useEffect(() => {
    if (session?.access_token) {
      // Small delay to ensure modal is fully mounted
      const timer = setTimeout(() => {
        loadUsageData();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, []);

  const loadUsageData = async () => {
    if (!session?.access_token) return;

    setLoading(true);
    setError(null);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      // Pass the current workspace ID for workspace-specific metrics
      const workspaceId = userData?.workspace?.id || localStorage.getItem('selectedWorkspaceId');
      const url = workspaceId
        ? `${apiUrl}/api/usage?workspaceId=${workspaceId}`
        : `${apiUrl}/api/usage`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setUsageData(data);
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(errorData.message || "Failed to load subscription data");
      }
    } catch (err: any) {
      console.error("Error loading usage data:", err);
      setError(err.message || "Failed to load subscription data");
    } finally {
      setLoading(false);
    }
  };

  const handleUpgrade = async (planName: string, priceId: string) => {
    if (!session?.access_token) {
      toast.error("Please sign in to upgrade");
      return;
    }

    if (!priceId) {
      toast.error(`Price ID not configured for ${planName} plan. Please contact support.`);
      return;
    }

    setUpgradeLoading(planName);

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/billing/create-checkout-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ priceId, planName }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.url) {
          window.location.href = data.url; // Redirect to Stripe Checkout
        } else {
          toast.error("Failed to create checkout session");
          setUpgradeLoading(null);
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        toast.error(errorData.message || "Failed to create checkout session");
        setUpgradeLoading(null);
      }
    } catch (err: any) {
      console.error("Upgrade error:", err);
      toast.error(err.message || "Failed to upgrade");
      setUpgradeLoading(null);
    }
  };

  const handleManageSubscription = async () => {
    if (!session?.access_token) {
      toast.error("Please sign in to manage subscription");
      return;
    }

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/billing/customer-portal`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.url) {
          window.open(data.url, "_blank"); // Open Stripe Customer Portal in new tab
        } else {
          toast.error("Failed to create portal session");
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        if (errorData.code === "no_stripe_customer") {
          toast.error("No active subscription found");
        } else {
          toast.error(errorData.message || "Failed to open customer portal");
        }
      }
    } catch (err: any) {
      console.error("Manage subscription error:", err);
      toast.error(err.message || "Failed to open customer portal");
    }
  };

  const getPlanName = (planId: string) => getPlanDisplayName(planId);
  const getPlanPrice = (planId: string) => {
    const plan = getPlanById(planId);
    return plan?.monthlyPrice || "";
  };

  if (loading) {
    return (
      <div className="space-y-10">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Subscription</h1>
          <p className="text-sm text-muted-foreground">Manage your plan and monitor usage</p>
        </div>
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading subscription data...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error || !usageData) {
    return (
      <div className="space-y-10">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Subscription</h1>
          <p className="text-sm text-muted-foreground">Manage your plan and monitor usage</p>
        </div>
        <div className="border border-red-200/50 rounded-xl p-6 bg-red-50/50">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1 space-y-3">
              <p className="text-sm font-medium text-red-900">{error || "Failed to load subscription data"}</p>
              <Button onClick={loadUsageData} variant="outline" size="sm" className="text-xs">
                Retry
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { plan, limits, usage, trial, subscription, period, isVIP } = usageData;
  
  // Debug: Log credits data
  console.log('[SETTINGS_MODAL] Credits data:', {
    limitsCredits: limits?.credits,
    usageCredits: usage?.credits,
    fullUsage: usage,
    fullLimits: limits
  });
  
  // Safely extract trial data with fallbacks
  // If status is 'trial' and trial_ends_at is null, use current_period_end as trial end date
  const trialEndsAt = trial?.ends_at || subscription?.trial_ends_at || 
    (subscription?.status === 'trial' && subscription?.current_period_end ? subscription.current_period_end : null);
  const now = new Date();
  const trialEndsAtDate = trialEndsAt ? new Date(trialEndsAt) : null;
  
  // Trial is active if subscription status is 'trial' OR if we have a future trial_ends_at date
  const isTrial = subscription?.status === 'trial' || (trialEndsAtDate && trialEndsAtDate > now);
  
  console.log('[TRIAL_DEBUG] Trial data:', {
    trialEndsAt,
    trialEndsAtDate: trialEndsAtDate?.toISOString(),
    subscriptionStatus: subscription?.status,
    isTrial,
    isTrialFromStatus: subscription?.status === 'trial',
    isTrialFromDate: trialEndsAtDate && trialEndsAtDate > now,
    subscription: subscription,
    trial: trial
  });
  
  // Calculate days remaining - use API value if available, otherwise calculate from trial_ends_at
  const trialDaysRemaining = trial?.days_remaining !== undefined && trial?.days_remaining !== null 
    ? trial.days_remaining 
    : (trialEndsAtDate 
      ? Math.max(0, Math.ceil((trialEndsAtDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : null);
  
  // Show trial days if status is 'trial' and we have trial_ends_at (even if days_remaining is 0)
  const shouldShowTrialDays = isTrial && trialEndsAt !== null && trialDaysRemaining !== null;
  
  console.log('[TRIAL_DEBUG] Days calculation:', {
    trialDaysRemaining,
    shouldShowTrialDays,
    now: now.toISOString()
  });
  
  // Calculate trial progress percentage
  const trialStartDate = (() => {
    if (subscription?.current_period_start) {
      // Use current_period_start (when trial began)
      return new Date(subscription.current_period_start);
    } else if (trialEndsAtDate) {
      // Default to 7 days before trial end if no start date
      const start = new Date(trialEndsAtDate);
      start.setTime(start.getTime() - (7 * 24 * 60 * 60 * 1000));
      return start;
    }
    return null;
  })();
  
  console.log('[TRIAL_DEBUG] Start date calculation:', {
    current_period_start: subscription?.current_period_start,
    trialStartDate: trialStartDate?.toISOString(),
    calculatedFrom: subscription?.current_period_start ? 'current_period_start' : (trialEndsAtDate ? 'trial_ends_at - 7 days' : 'null')
  });
  
  // Calculate trial progress - show if we have trial end date and are on trial
  const trialProgress = (() => {
    console.log('[TRIAL_DEBUG] Progress calculation start:', {
      trialEndsAtDate: trialEndsAtDate?.toISOString(),
      trialEndsAtDateExists: !!trialEndsAtDate,
      isTrial,
      trialStartDate: trialStartDate?.toISOString(),
      trialDaysRemaining,
      subscriptionStatus: subscription?.status
    });
    
    // Show progress bar if we have trial end date and are on trial, even if some calculations fail
    if (!trialEndsAtDate || !isTrial) {
      console.log('[TRIAL_DEBUG] Progress: early return - missing data', {
        trialEndsAtDate: !!trialEndsAtDate,
        isTrial,
        subscriptionStatus: subscription?.status
      });
      return null;
    }
    
    // If we have start date, calculate from that
    if (trialStartDate) {
      const totalDays = Math.ceil((trialEndsAtDate.getTime() - trialStartDate.getTime()) / (1000 * 60 * 60 * 24));
      console.log('[TRIAL_DEBUG] Progress: calculated from start date', {
        totalDays,
        daysElapsed: totalDays - (trialDaysRemaining || 0)
      });
      if (totalDays > 0) {
        const daysElapsed = totalDays - (trialDaysRemaining || 0);
        const progress = Math.max(0, Math.min(100, (daysElapsed / totalDays) * 100));
        console.log('[TRIAL_DEBUG] Progress: result from start date', { progress });
        return progress;
      }
    }
    
    // Fallback: calculate from days remaining (assume 7-day trial)
    if (trialDaysRemaining !== null && trialDaysRemaining !== undefined) {
      const totalDays = 7; // Default to 7-day trial
      const daysElapsed = totalDays - trialDaysRemaining;
      const progress = Math.max(0, Math.min(100, (daysElapsed / totalDays) * 100));
      console.log('[TRIAL_DEBUG] Progress: result from fallback', { 
        totalDays, 
        daysElapsed, 
        progress 
      });
      return progress;
    }
    
    console.log('[TRIAL_DEBUG] Progress: final return null');
    return null;
  })();
  
  // Show progress bar if we have trial end date and are on trial
  const shouldShowTrialProgress = isTrial && trialEndsAt !== null;
  
  console.log('[TRIAL_DEBUG] Final values:', {
    shouldShowTrialProgress,
    trialProgress,
    shouldShowTrialDays,
    willShowProgressBar: shouldShowTrialDays && shouldShowTrialProgress
  });
  
  const currentPlanName = getPlanName(plan);
  const currentPlanPrice = getPlanPrice(plan);

  // Format billing period date (e.g., "19th of each month")
  const getBillingDay = (dateString: string) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    const day = date.getDate();
    const suffix = day === 1 ? "st" : day === 2 ? "nd" : day === 3 ? "rd" : "th";
    return `${day}${suffix}`;
  };

  const billingDay = subscription?.current_period_end 
    ? getBillingDay(subscription.current_period_end)
    : period?.end 
    ? getBillingDay(period.end)
    : null;

  const periodEndDate = subscription?.current_period_end 
    ? new Date(subscription.current_period_end)
    : period?.end 
    ? new Date(period.end)
    : null;

  const isCancelled = subscription?.cancel_at_period_end === true;
  const isExpired = subscription?.status === "past_due" || subscription?.status === "canceled" || 
                   (periodEndDate && periodEndDate <= new Date() && isCancelled);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Billing & Plans</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your subscription and track usage</p>
      </div>

      {/* Current Plan Card - Minimal Design */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">
              {isVIP ? "VIP Access" : currentPlanName}
            </h2>
            {isVIP ? (
              <Badge className="bg-purple-600 hover:bg-purple-700 text-white text-[10px] px-2 py-0.5">
                VIP
              </Badge>
            ) : isTrial ? (
              <Badge variant="secondary" className="bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5">
                Trial
              </Badge>
            ) : subscription?.status === "active" ? (
              <Badge className="bg-green-100 text-green-700 text-[10px] px-2 py-0.5">
                Active
              </Badge>
            ) : null}
          </div>
          {!isVIP && currentPlanPrice && !isTrial && (
            <div className="text-right">
              <span className="text-xl font-bold">{currentPlanPrice}</span>
              <span className="text-sm text-muted-foreground">/mo</span>
            </div>
          )}
        </div>

        {/* Trial Progress - Compact */}
        {shouldShowTrialDays && (
          <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-100">
            <div className="flex items-center justify-between text-sm">
              <span className="text-blue-700">Trial ends {format(new Date(trialEndsAt), "MMM d")}</span>
              <span className="font-medium text-blue-900">
                {trialDaysRemaining} {trialDaysRemaining === 1 ? 'day' : 'days'} left
              </span>
            </div>
            {shouldShowTrialProgress && trialProgress !== null && (
              <Progress value={trialProgress} className="h-1.5 mt-2 bg-blue-100" />
            )}
          </div>
        )}

        {/* Plan Stats */}
        <div className="flex flex-wrap gap-6 mt-4 pt-4 border-t text-sm">
          <div>
            <span className="text-muted-foreground">Documents: </span>
            <span className="font-medium">{limits.documents === null ? "Unlimited" : `${limits.documents.toLocaleString()}/mo`}</span>
          </div>
          <div>
            <span className="text-muted-foreground">AI Credits: </span>
            <span className="font-medium">
              {usage?.credits?.limit !== undefined && usage?.credits?.limit !== null ? `${usage.credits.limit.toLocaleString()}/mo` : "∞"}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Memory Ops: </span>
            <span className="font-medium">
              {usage?.memoryOps?.limit !== undefined && usage?.memoryOps?.limit !== null ? `${usage.memoryOps.limit.toLocaleString()}/mo` : "∞"}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Workspaces: </span>
            <span className="font-medium">{limits.workspaces === null ? "Unlimited" : limits.workspaces}</span>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between mt-4 pt-4 border-t">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {!isTrial && subscription?.status === "active" && !isCancelled && periodEndDate && (
              <span>Renews {format(periodEndDate, "MMM d, yyyy")}</span>
            )}
          </div>
          {subscription?.stripe_subscription_id && (
            <Button onClick={handleManageSubscription} variant="outline" size="sm" className="text-xs h-8 gap-1.5">
              Manage Subscription
              <ExternalLink className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Cancelled Banner */}
      {isCancelled && !isExpired && periodEndDate && (
        <div className="p-4 bg-amber-50/50 border border-amber-200 rounded-xl text-sm">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-700" />
            <p className="text-amber-900">
              Subscription cancelled. Access continues until <strong>{format(periodEndDate, "MMMM d, yyyy")}</strong>.
            </p>
          </div>
        </div>
      )}

      {/* Expired Banner */}
      {(subscription?.status === "past_due" || isExpired) && (
        <div className="p-4 bg-red-50/50 border border-red-200 rounded-xl text-sm">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-red-700" />
            <p className="text-red-900">
              Your subscription has expired. Please select a plan to continue.
            </p>
          </div>
        </div>
      )}

      {/* Monthly Usage Section */}
      <div className="space-y-6">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Monthly Usage</h3>
          <p className="text-sm text-muted-foreground">
            {isVIP ? "VIP access: Unlimited usage" : "Track your prospects, memory ops, and AI credit usage"}
          </p>
        </div>

        <div className="grid gap-4 grid-cols-1">
          {/* AI Credits Usage — Primary display */}
          {(() => {
            // Get credit limits based on plan
            const getPlanCreditLimit = (planName: string) => {
              switch (planName?.toLowerCase()) {
                case 'professional':
                case 'unlimited':
                case 'consultancies':
                case 'agencies':
                case 'enterprise':
                  return 500;
                case 'trial':
                  return 100;
                default:
                  return 200; // Starter
              }
            };

            const creditLimit = usage?.credits?.limit ?? limits?.credits ?? getPlanCreditLimit(plan);
            const creditCurrent = usage?.credits?.current ?? 0;
            const creditRemaining = usage?.credits?.remaining ?? (creditLimit - creditCurrent);
            const creditPercentage = usage?.credits?.percentage ?? Math.round((creditCurrent / creditLimit) * 100);

            return (
              <div className="border rounded-xl p-5 space-y-3 bg-card shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-md bg-muted/50 flex-shrink-0">
                        <Coins className="h-4 w-4 text-foreground" />
                      </div>
                      <p className="text-sm font-semibold">AI Credits</p>
                    </div>
                    <p className="text-xs text-muted-foreground pl-8">
                      {creditCurrent} of {creditLimit}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className={cn(
                      "text-lg font-semibold",
                      creditRemaining < 20 ? "text-red-500" : "text-foreground"
                    )}>
                      {creditRemaining}
                    </span>
                    <p className="text-xs text-muted-foreground">left</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500 ease-out",
                        creditPercentage >= 90
                          ? "bg-red-500"
                          : creditPercentage >= 75
                          ? "bg-amber-500"
                          : "bg-foreground"
                      )}
                      style={{ width: `${Math.min(creditPercentage, 100)}%` }}
                    />
                  </div>
                  <span className="font-medium w-10 text-right">{creditPercentage}%</span>
                </div>
              </div>
            );
          })()}

          {/* Prospects Usage */}
          {(() => {
            const prospectLimit = usage?.prospects?.limit ?? null;
            const prospectCurrent = usage?.prospects?.current ?? 0;
            const prospectRemaining = prospectLimit !== null ? Math.max(0, prospectLimit - prospectCurrent) : null;
            const prospectPercentage = prospectLimit ? Math.min(100, Math.round((prospectCurrent / prospectLimit) * 100)) : 0;

            return (
              <div className="border rounded-xl p-5 space-y-3 bg-card shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-md bg-muted/50 flex-shrink-0">
                        <Users className="h-4 w-4 text-foreground" />
                      </div>
                      <p className="text-sm font-semibold">Prospects</p>
                    </div>
                    <p className="text-xs text-muted-foreground pl-8">
                      {prospectCurrent.toLocaleString()} of {prospectLimit !== null ? prospectLimit.toLocaleString() : "∞"} stored
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className={cn(
                      "text-lg font-semibold",
                      prospectLimit && prospectCurrent / prospectLimit >= 1 ? "text-red-500" : prospectLimit && prospectCurrent / prospectLimit >= 0.8 ? "text-amber-500" : "text-foreground"
                    )}>
                      {prospectRemaining !== null ? prospectRemaining.toLocaleString() : "∞"}
                    </span>
                    <p className="text-xs text-muted-foreground">left</p>
                  </div>
                </div>
                {prospectLimit !== null && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500 ease-out",
                          prospectPercentage >= 100 ? "bg-red-500" : prospectPercentage >= 80 ? "bg-amber-500" : "bg-foreground"
                        )}
                        style={{ width: `${Math.min(prospectPercentage, 100)}%` }}
                      />
                    </div>
                    <span className="font-medium w-10 text-right">{prospectPercentage}%</span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Memory Ops Usage */}
          {(() => {
            const opsLimit = usage?.memoryOps?.limit ?? null;
            const opsCurrent = usage?.memoryOps?.current ?? 0;
            const opsRemaining = opsLimit !== null ? Math.max(0, opsLimit - opsCurrent) : null;
            const opsPercentage = opsLimit ? Math.min(100, Math.round((opsCurrent / opsLimit) * 100)) : 0;

            return (
              <div className="border rounded-xl p-5 space-y-3 bg-card shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-md bg-muted/50 flex-shrink-0">
                        <Zap className="h-4 w-4 text-foreground" />
                      </div>
                      <p className="text-sm font-semibold">Memory Ops</p>
                    </div>
                    <p className="text-xs text-muted-foreground pl-8">
                      {opsCurrent.toLocaleString()} of {opsLimit !== null ? opsLimit.toLocaleString() : "∞"} this month
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className={cn(
                      "text-lg font-semibold",
                      opsLimit && opsCurrent / opsLimit >= 1 ? "text-red-500" : opsLimit && opsCurrent / opsLimit >= 0.8 ? "text-amber-500" : "text-foreground"
                    )}>
                      {opsRemaining !== null ? opsRemaining.toLocaleString() : "∞"}
                    </span>
                    <p className="text-xs text-muted-foreground">left</p>
                  </div>
                </div>
                {opsLimit !== null && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500 ease-out",
                          opsPercentage >= 100 ? "bg-red-500" : opsPercentage >= 80 ? "bg-amber-500" : "bg-foreground"
                        )}
                        style={{ width: `${Math.min(opsPercentage, 100)}%` }}
                      />
                    </div>
                    <span className="font-medium w-10 text-right">{opsPercentage}%</span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Proposals Usage */}
          {(() => {
            const docLimit = usage?.documents?.limit ?? limits?.documents ?? null;
            // Only show if there's a cap (Starter = 15, null = unlimited)
            if (docLimit === null) return null;
            const docCurrent = usage?.documents?.current ?? 0;
            const docRemaining = usage?.documents?.remaining ?? Math.max(0, docLimit - docCurrent);
            const docPercentage = usage?.documents?.percentage ?? Math.round((docCurrent / docLimit) * 100);

            return (
              <div className="border rounded-xl p-5 space-y-3 bg-card shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-md bg-muted/50 flex-shrink-0">
                        <FileText className="h-4 w-4 text-foreground" />
                      </div>
                      <p className="text-sm font-semibold">Proposals</p>
                    </div>
                    <p className="text-xs text-muted-foreground pl-8">
                      {docCurrent} of {docLimit} this month
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className={cn(
                      "text-lg font-semibold",
                      docRemaining <= 2 ? "text-red-500" : "text-foreground"
                    )}>
                      {docRemaining}
                    </span>
                    <p className="text-xs text-muted-foreground">left</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500 ease-out",
                        docPercentage >= 90
                          ? "bg-red-500"
                          : docPercentage >= 75
                          ? "bg-amber-500"
                          : "bg-foreground"
                      )}
                      style={{ width: `${Math.min(docPercentage, 100)}%` }}
                    />
                  </div>
                  <span className="font-medium w-10 text-right">{docPercentage}%</span>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Upgrade Plan Section */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Upgrade Your Plan</h3>
            <p className="text-sm text-muted-foreground">Unlock more features and scale your business</p>
          </div>

          {/* Billing Toggle */}
          <div className="flex items-center gap-3 p-1 bg-muted/50 rounded-full">
            <button
              onClick={() => setBillingInterval("month")}
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-full transition-all",
                billingInterval === "month"
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingInterval("year")}
              className={cn(
                "px-4 py-1.5 text-sm font-medium rounded-full transition-all flex items-center gap-2",
                billingInterval === "year"
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Yearly
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">
                -35%
              </span>
            </button>
          </div>
        </div>

        {/* Plans Grid */}
        <div className="grid md:grid-cols-2 gap-4">
          {PLANS
            .filter((p) => p.name !== plan) // Filter out current plan
            .map((planOption) => {
              const currentPrice = billingInterval === "month" ? planOption.monthlyPrice : planOption.yearlyPrice;
              const currentPriceId = billingInterval === "month" ? planOption.monthlyPriceId : planOption.yearlyPriceId;
              const savings = billingInterval === "year"
                ? Math.round(((parseInt(planOption.monthlyPrice.replace("$", "")) - parseInt(planOption.yearlyPrice.replace("$", ""))) / parseInt(planOption.monthlyPrice.replace("$", ""))) * 100)
                : 0;
              const planOrder = ["starter", "professional"];
              const currentPlanIndex = planOrder.indexOf(plan?.toLowerCase() || "");
              const optionPlanIndex = planOrder.indexOf(planOption.name);
              const isDowngrade = currentPlanIndex > optionPlanIndex;

              const displayFeatures = getPlanFeaturesForDisplay(planOption);
              const isProfessional = planOption.name === "professional";

              return (
                <div
                  key={planOption.id}
                  className={cn(
                    "relative flex flex-col rounded-xl border bg-card overflow-hidden",
                    isProfessional && "border-primary ring-1 ring-primary/20"
                  )}
                >
                  {/* Best Value Badge - Only for Unlimited */}
                  {isProfessional && (
                    <div className="bg-primary text-primary-foreground text-center py-1 text-[10px] font-semibold tracking-wider uppercase">
                      Best Value
                    </div>
                  )}

                  <div className="p-5">
                    {/* Plan Name & Price */}
                    <div className="mb-4">
                      <h4 className="font-semibold text-base">{planOption.displayName}</h4>
                      <p className="text-xs text-muted-foreground mb-2">
                        {planOption.description}
                      </p>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-bold">{currentPrice}</span>
                        <span className="text-muted-foreground text-sm">/mo</span>
                      </div>
                      {billingInterval === "year" && savings > 0 && (
                        <p className="text-xs text-green-600 font-medium mt-1">
                          Save {savings}%
                        </p>
                      )}
                    </div>

                    {/* CTA Button */}
                    {planOption.contactUs ? (
                      <Button
                        className="w-full mb-4"
                        variant="outline"
                        size="sm"
                        onClick={() => window.open("mailto:hello@goproply.com?subject=Enterprise Plan Inquiry", "_blank")}
                      >
                        Contact Us
                      </Button>
                    ) : (
                      <Button
                        className={cn(
                          "w-full mb-4",
                          isDowngrade
                            ? "bg-gray-100 hover:bg-gray-200 text-gray-700"
                            : "bg-black hover:bg-black/90 text-white"
                        )}
                        size="sm"
                        onClick={() => handleUpgrade(planOption.name, currentPriceId)}
                        disabled={upgradeLoading !== null}
                      >
                        {upgradeLoading === planOption.name ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Processing...
                          </>
                        ) : isDowngrade ? (
                          "Switch Plan"
                        ) : (
                          "Upgrade"
                        )}
                      </Button>
                    )}

                    {/* Features List */}
                    <ul className="space-y-2">
                      {displayFeatures.map((feature, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <Check className="h-4 w-4 flex-shrink-0 mt-0.5 text-muted-foreground" />
                          <span className={cn(
                            "text-sm",
                            feature.startsWith("Everything in")
                              ? "font-medium text-foreground"
                              : "text-muted-foreground"
                          )}>
                            {feature}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
        </div>

        {/* Trust Indicators */}
        <div className="flex flex-wrap items-center justify-center gap-6 pt-6 border-t text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span>Cancel anytime</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span>Secure payment via Stripe</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span>Instant activation</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// API Keys Section
function ApiKeysSection({
  apiKeys,
  loading,
  onDelete,
  onCopy,
  newKeyName,
  setNewKeyName,
  showNewKeyForm,
  setShowNewKeyForm,
  onCreate,
  newKeyValue,
  setNewKeyValue,
}: {
  apiKeys: ApiKey[];
  loading: boolean;
  onDelete: (keyId: string) => void;
  onCopy: (key: string) => void;
  newKeyName: string;
  setNewKeyName: (value: string) => void;
  showNewKeyForm: boolean;
  setShowNewKeyForm: (value: boolean) => void;
  onCreate: () => void;
  newKeyValue: string | null;
  setNewKeyValue: (value: string | null) => void;
}) {
  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), "MMM d, yyyy");
    } catch {
      return dateString;
    }
  };


  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">API Keys</h1>
            <Badge variant="secondary" className="rounded-full px-2.5 py-0.5">
              {apiKeys.length}
            </Badge>
          </div>
          <Button 
            onClick={() => setShowNewKeyForm(true)}
            className="bg-black text-white hover:bg-black/90"
            disabled={showNewKeyForm || !!newKeyValue}
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Key
          </Button>
        </div>
        <p className="text-muted-foreground">
          API keys are owned by workspaces and remain active even after the creator is removed.
        </p>
      </div>

      {/* New Key Success Message */}
      {newKeyValue && (
        <div className="border border-primary/50 bg-primary/5 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 text-primary">
            <CheckCircle2 className="h-5 w-5" />
            <p className="font-medium">API Key Created</p>
          </div>
          <p className="text-sm text-muted-foreground">
            Make sure to copy your API key now. You won't be able to see it again!
          </p>
          <div className="flex gap-2">
            <Input
              value={newKeyValue}
              readOnly
              className="font-mono text-sm"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                onCopy(newKeyValue);
                setNewKeyValue(null);
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Create New Key Form */}
      {showNewKeyForm && !newKeyValue && (
        <div className="border border-border rounded-lg p-4 space-y-4">
          <div>
            <Label htmlFor="key-name" className="text-base font-medium mb-2 block">
              Key Name
            </Label>
            <p className="text-sm text-muted-foreground mb-3">
              Give your API key a descriptive name to help you identify it later.
            </p>
            <div className="flex gap-3">
              <Input
                id="key-name"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g., Production API Key"
                className="max-w-md"
              />
              <Button onClick={onCreate} disabled={!newKeyName.trim()}>
                Create Key
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowNewKeyForm(false);
                  setNewKeyName("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* API Keys Table */}
      <section>
        {loading ? (
          <div className="text-sm text-muted-foreground py-8">Loading API keys...</div>
        ) : apiKeys.length === 0 ? (
          <div className="border border-border rounded-lg p-8 text-center">
            <Key className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-sm font-medium mb-2">No API keys</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first API key to start using the Proply API programmatically.
            </p>
            <Button onClick={() => setShowNewKeyForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create API Key
            </Button>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[250px]">KEY</TableHead>
                  <TableHead>WORKSPACE</TableHead>
                  <TableHead className="w-[200px]">CREATED BY</TableHead>
                  <TableHead className="w-[150px] cursor-pointer hover:text-foreground">
                    CREATED AT
                  </TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((apiKey) => (
                  <TableRow key={apiKey.id} className="hover:bg-muted/50">
                    <TableCell>
                      <div className="space-y-1 min-w-0">
                        <div className="font-medium truncate">{apiKey.name}</div>
                        <code className="text-xs text-muted-foreground font-mono truncate block">
                          {apiKey.key}
                        </code>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-primary"></div>
                        <span className="text-sm font-medium">{apiKey.workspace?.name || "Default"}</span>
                        <Info className="h-3 w-3 text-muted-foreground" />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        <div className="text-sm font-medium">
                          {apiKey.created_by?.name || "Unknown"}
                        </div>
                        {apiKey.created_by?.email && (
                          <div className="text-xs text-muted-foreground">
                            {apiKey.created_by.email}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{formatDate(apiKey.created_at)}</span>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              toast.info("Full API key is only shown once when created");
                            }}
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Copy Key
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onDelete(apiKey.id)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* API Documentation */}
      <section className="pt-6 border-t border-border">
        <Button
          variant="outline"
          onClick={() => window.open("/api", "_blank")}
        >
          API Documentation
          <ExternalLink className="h-4 w-4 ml-2" />
        </Button>
      </section>
    </div>
  );
}

// Tutorials Section
function getThumbnailUrl(videoUrl: string | null): string | null {
  if (!videoUrl) return null;
  const ytMatch = videoUrl.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  if (ytMatch) return `https://img.youtube.com/vi/${ytMatch[1]}/mqdefault.jpg`;
  const loomMatch = videoUrl.match(/loom\.com\/share\/([A-Za-z0-9]+)/);
  if (loomMatch) return `https://cdn.loom.com/sessions/thumbnails/${loomMatch[1]}-with-play.gif`;
  return null;
}

// Shows a seeked video frame as a static preview thumbnail
function VideoPreviewThumb({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    // Seek to 10% of duration (min 2s) to get a meaningful frame
    video.currentTime = Math.max(2, video.duration * 0.1);
  };

  const handleSeeked = () => setReady(true);

  return (
    <>
      <video
        ref={videoRef}
        src={src}
        className={`w-full h-full object-cover transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0'}`}
        preload="metadata"
        muted
        playsInline
        onLoadedMetadata={handleLoadedMetadata}
        onSeeked={handleSeeked}
      />
      {!ready && (
        <div className="absolute inset-0 bg-gradient-to-br from-[#1c1c1e] to-[#0a0a0a]" />
      )}
    </>
  );
}

function TutorialsSection({
  tutorials = [],
  loading = false,
}: {
  tutorials?: Tutorial[];
  loading?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold">Tutorials</h1>
        <p className="text-muted-foreground text-sm">Step-by-step video guides to get the most out of Proply</p>
      </div>

      {/* Tutorial Videos */}
      <section>
        {loading ? (
          <div className="grid md:grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-xl overflow-hidden border border-border animate-pulse">
                <div className="aspect-video bg-muted" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-muted rounded w-3/4" />
                  <div className="h-3 bg-muted rounded w-full" />
                  <div className="h-3 bg-muted rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : tutorials.length === 0 ? (
          <div className="border border-border rounded-xl p-12 text-center">
            <Play className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium mb-1">No tutorials yet</p>
            <p className="text-sm text-muted-foreground">Video tutorials will appear here once published.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {tutorials.map((tutorial) => {
              const thumb = getThumbnailUrl(tutorial.video_url);
              return (
                <div
                  key={tutorial.id}
                  className="group rounded-xl overflow-hidden border border-border bg-card hover:border-border/80 hover:shadow-md transition-all duration-200 cursor-pointer"
                  onClick={() => navigate(`/tutorials/${tutorial.slug}`)}
                >
                  {/* Thumbnail */}
                  <div className="relative aspect-video bg-[#0f0f0f] overflow-hidden">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={tutorial.title}
                        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                      />
                    ) : tutorial.video_file_url ? (
                      <VideoPreviewThumb src={tutorial.video_file_url} />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-[#1a1a1a] to-[#0a0a0a]" />
                    )}
                    {/* Dark overlay on hover */}
                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                    {/* Play button */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-11 h-11 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:bg-white transition-all duration-200">
                        <Play className="h-4 w-4 text-[#0f0f0f] fill-[#0f0f0f] ml-0.5" />
                      </div>
                    </div>
                    {/* Duration badge */}
                    {tutorial.duration && (
                      <span className="absolute bottom-2.5 right-2.5 text-[11px] font-semibold text-white bg-black/70 backdrop-blur-sm px-1.5 py-0.5 rounded">
                        {tutorial.duration}
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-4">
                    <h3 className="text-[13.5px] font-semibold leading-snug mb-1.5 group-hover:text-primary transition-colors line-clamp-2">
                      {tutorial.title}
                    </h3>
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                      {tutorial.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Founder Card */}
      <section className="pt-6 border-t border-border">
        <div className="border-2 border-[#0a66c2]/30 bg-[#0a66c2]/[0.03] rounded-xl p-5 flex flex-col sm:flex-row gap-5">
          <div className="flex-shrink-0 flex flex-col items-center sm:items-start">
            <img
              src="/bennet-glinder.jpg"
              alt="Bennet Glinder"
              className="w-16 h-16 rounded-full object-cover border-2 border-white shadow-sm"
            />
            <p className="text-sm font-semibold mt-2.5">Bennet Glinder</p>
            <p className="text-xs text-muted-foreground">Founder, Proply</p>
          </div>
          <div className="flex-1 flex flex-col justify-between">
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              Got questions, feedback, or just want to chat about proposals and AI? I'd love to connect and hear how you're using Proply.
            </p>
            <div>
              <Button
                variant="outline"
                size="sm"
                className="border-[#0a66c2]/40 text-[#0a66c2] hover:bg-[#0a66c2]/10 hover:text-[#0a66c2]"
                onClick={() => window.open("https://www.linkedin.com/in/documentbennet/", "_blank")}
              >
                <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
                Connect on LinkedIn
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// Helper to mask API keys/secrets (shows first and last 4 chars)
const maskCredential = (value: string): string => {
  if (!value || value.length < 12) return '••••••••';
  const prefix = value.slice(0, 8);
  const suffix = value.slice(-4);
  return `${prefix}••••••${suffix}`;
};

// Get category display name
const getCategoryLabel = (category: string): string => {
  const labels: Record<string, string> = {
    ai: 'AI & Language Models',
    payment: 'Payments',
    crm: 'CRM & Sales',
    communication: 'Communication',
    productivity: 'Productivity',
  };
  return labels[category] || category.charAt(0).toUpperCase() + category.slice(1);
};

// Get category icon
const getCategoryIcon = (category: string) => {
  switch (category) {
    case 'ai':
      return <Sparkles className="h-4 w-4" />;
    case 'payment':
      return <CreditCard className="h-4 w-4" />;
    case 'crm':
      return <Users className="h-4 w-4" />;
    case 'communication':
      return <MessageSquare className="h-4 w-4" />;
    default:
      return <Link2 className="h-4 w-4" />;
  }
};

// Integrations Section
function IntegrationsSection({ session }: { session: any }) {
  const { userData } = useAuth();
  const [connections, setConnections] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddConnection, setShowAddConnection] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<any>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [connectionName, setConnectionName] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ verified: boolean; message: string; mode?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [expandedConnections, setExpandedConnections] = useState<Record<string, boolean>>({});
  const [editingConnection, setEditingConnection] = useState<any>(null);
  const [editCredentials, setEditCredentials] = useState<Record<string, string>>({});
  const [updatingCredentials, setUpdatingCredentials] = useState(false);
  const [connectionToDelete, setConnectionToDelete] = useState<{ id: string; name: string } | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [retestingConnection, setRetestingConnection] = useState<string | null>(null);
  const [linkedinStatus, setLinkedinStatus] = useState<{ connected: boolean; connection: any } | null>(null);
  const [linkedinConnecting, setLinkedinConnecting] = useState(false);
  const [linkedinSyncing, setLinkedinSyncing] = useState(false);
  const [linkedinDisconnecting, setLinkedinDisconnecting] = useState(false);
  const [airtableConnecting, setAirtableConnecting] = useState(false);

  const workspaceId = userData?.workspace?.id || localStorage.getItem('selectedWorkspaceId');
  const apiUrl = import.meta.env.VITE_API_URL ?? '';

  useEffect(() => {
    if (session?.access_token && workspaceId) {
      fetchData();
      fetchLinkedInStatus();
    }
  }, [session, workspaceId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch providers - show all available providers
      const providersRes = await fetch(`${apiUrl}/api/workflow-providers`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (providersRes.ok) {
        const providersData = await providersRes.json();
        // Show all providers that require authentication (excluding internal and deprecated providers)
        const providersList = providersData.providers || providersData || [];
        const excludedProviders = ['assetly', 'gmail', 'mailchimp', 'google_analytics', 'granola', 'notion', 'clickup', 'openai', 'gemini', 'google'];
        setProviders(providersList.filter((p: any) => p.auth_type !== 'none' && !excludedProviders.includes(p.name)));
      }

      // Fetch existing connections - show all connections
      const connectionsRes = await fetch(`${apiUrl}/api/workflow-providers/connections?workspace_id=${workspaceId}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (connectionsRes.ok) {
        const connectionsData = await connectionsRes.json();
        setConnections(connectionsData.connections || []);
      }
    } catch (error) {
      console.error('Error fetching integrations:', error);
      toast.error('Failed to load integrations');
    } finally {
      setLoading(false);
    }
  };

  const fetchLinkedInStatus = async () => {
    if (!session?.access_token || !workspaceId) return;
    try {
      const res = await fetch(`${apiUrl}/api/linkedin/status?workspaceId=${workspaceId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) setLinkedinStatus(await res.json());
    } catch {}
  };

  const handleLinkedInConnect = async () => {
    if (!session?.access_token || !workspaceId) return;
    setLinkedinConnecting(true);
    try {
      const res = await fetch(`${apiUrl}/api/linkedin/connect?workspaceId=${workspaceId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to start LinkedIn connection');
      }
      const { url } = await res.json();
      const width = 600, height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      window.open(url, 'LinkedInUnipile', `width=${width},height=${height},left=${left},top=${top}`);

      let cleanupWatcher: (() => void) | null = null;
      const onMessage = (e: MessageEvent) => {
        if (e.data?.type !== 'linkedin_auth') return;
        window.removeEventListener('message', onMessage);
        cleanupWatcher?.();
        setLinkedinConnecting(false);
        if (e.data.success) {
          toast.success('LinkedIn connected!');
          fetchLinkedInStatus();
        } else {
          toast.error('LinkedIn connection failed. Please try again.');
        }
      };
      window.addEventListener('message', onMessage);
      cleanupWatcher = watchOAuthPopup({ onClose: () => { window.removeEventListener('message', onMessage); setLinkedinConnecting(false); fetchLinkedInStatus(); } });
    } catch (err: any) {
      toast.error(err.message || 'Failed to connect LinkedIn');
      setLinkedinConnecting(false);
    }
  };

  const handleLinkedInSync = async () => {
    if (!session?.access_token || !workspaceId) return;
    setLinkedinSyncing(true);
    try {
      const res = await fetch(`${apiUrl}/api/linkedin/sync?workspaceId=${workspaceId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      const { connections: c, conversations: cv } = data;
      toast.success(`Synced — ${c?.matched ?? 0} connections, ${cv?.matched ?? 0} conversations matched`);
      fetchLinkedInStatus();
    } catch (err: any) {
      toast.error(err.message || 'Sync failed');
    } finally {
      setLinkedinSyncing(false);
    }
  };

  const handleLinkedInDisconnect = async () => {
    if (!session?.access_token || !workspaceId) return;
    setLinkedinDisconnecting(true);
    try {
      const res = await fetch(`${apiUrl}/api/linkedin/disconnect?workspaceId=${workspaceId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to disconnect');
      toast.success('LinkedIn disconnected');
      setLinkedinStatus({ connected: false, connection: null });
    } catch (err: any) {
      toast.error(err.message || 'Failed to disconnect');
    } finally {
      setLinkedinDisconnecting(false);
    }
  };

  const handleAirtableConnect = async () => {
    if (!session?.access_token || !workspaceId) return;
    setAirtableConnecting(true);
    try {
      const res = await fetch(
        `${apiUrl}/api/workflow-providers/airtable/oauth/authorize?workspace_id=${workspaceId}&connectionName=Airtable`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      if (!res.ok) throw new Error((await res.json()).message || 'Failed to start Airtable OAuth');
      const { authorization_url } = await res.json();
      const width = 600, height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      window.open(authorization_url, 'AirtableOAuth', `width=${width},height=${height},left=${left},top=${top}`);
      let cleanupWatcher: (() => void) | null = null;
      const onMsg = (e: MessageEvent) => {
        if (e.data?.type !== 'airtable_auth') return;
        window.removeEventListener('message', onMsg);
        cleanupWatcher?.();
        setAirtableConnecting(false);
        if (e.data.success) { toast.success('Airtable connected!'); fetchData(); }
        else toast.error(`Airtable connection failed: ${e.data.error || 'unknown error'}`);
      };
      window.addEventListener('message', onMsg);
      cleanupWatcher = watchOAuthPopup({ onClose: () => { window.removeEventListener('message', onMsg); setAirtableConnecting(false); fetchData(); } });
    } catch (err: any) {
      toast.error(err.message || 'Failed to connect Airtable');
      setAirtableConnecting(false);
    }
  };

  const handleAirtableDisconnect = async (connectionId: string) => {
    try {
      const res = await fetch(
        `${apiUrl}/api/workflow-providers/connections/${connectionId}?workspace_id=${workspaceId}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      if (!res.ok) throw new Error('Failed to disconnect');
      toast.success('Airtable disconnected');
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to disconnect Airtable');
    }
  };

  const handleTestConnection = async () => {
    if (!selectedProvider) return;

    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${apiUrl}/api/workflow-providers/connections/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          provider_id: selectedProvider.id,
          credentials,
        }),
      });

      const data = await res.json();
      setTestResult(data);
    } catch (error) {
      setTestResult({ verified: false, message: 'Failed to test connection' });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveConnection = async () => {
    if (!selectedProvider || !connectionName.trim()) {
      toast.error('Please provide a connection name');
      return;
    }

    if (!testResult?.verified) {
      toast.error('Please test and verify the connection first');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/workflow-providers/connections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          provider_id: selectedProvider.id,
          name: connectionName.trim(),
          credentials,
          is_verified: true,
        }),
      });

      if (res.ok) {
        toast.success('Connection saved successfully');
        setShowAddConnection(false);
        setSelectedProvider(null);
        setCredentials({});
        setConnectionName('');
        setTestResult(null);
        fetchData();
      } else {
        const error = await res.json();
        throw new Error(error.message || 'Failed to save connection');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to save connection');
    } finally {
      setSaving(false);
    }
  };

  const handleOAuthConnect = async () => {
    console.log('[OAuth] handleOAuthConnect called');
    console.log('[OAuth] selectedProvider:', selectedProvider?.name);
    console.log('[OAuth] workspaceId:', workspaceId);
    console.log('[OAuth] session:', !!session?.access_token);
    console.log('[OAuth] connectionName:', connectionName);

    if (!selectedProvider || !workspaceId || !session?.access_token) {
      console.log('[OAuth] Missing required data');
      toast.error("Please log in to connect your account");
      return;
    }

    if (!connectionName.trim()) {
      console.log('[OAuth] Connection name is empty');
      toast.error("Connection name is required");
      return;
    }

    setOauthLoading(true);
    console.log('[OAuth] Starting OAuth flow...');
    try {
      // Determine OAuth endpoint based on provider
      let oauthEndpoint: string;
      let popupName: string;
      let successMessage: string;

      if (selectedProvider.name === 'airtable') {
        oauthEndpoint = `${apiUrl}/api/workflow-providers/airtable/oauth/authorize?workspace_id=${workspaceId}&connectionName=${encodeURIComponent(connectionName.trim())}`;
        popupName = "AirtableOAuth";
        successMessage = "Airtable connected successfully!";
      } else if (selectedProvider.name === 'notion') {
        oauthEndpoint = `${apiUrl}/api/workflow-providers/notion/oauth/authorize?workspace_id=${workspaceId}&connectionName=${encodeURIComponent(connectionName.trim())}`;
        popupName = "NotionOAuth";
        successMessage = "Notion connected successfully!";
      } else if (selectedProvider.name === 'gmail' || selectedProvider.name === 'gmail_oauth') {
        oauthEndpoint = `${apiUrl}/api/oauth/google/gmail/authorize?workspaceId=${workspaceId}&connectionName=${encodeURIComponent(connectionName.trim())}`;
        popupName = "GmailOAuth";
        successMessage = "Gmail connected successfully!";
      } else if (selectedProvider.name === 'google_analytics') {
        oauthEndpoint = `${apiUrl}/api/workflow-providers/google-analytics/oauth/authorize?workspace_id=${workspaceId}&connectionName=${encodeURIComponent(connectionName.trim())}`;
        popupName = "GoogleAnalyticsOAuth";
        successMessage = "Google Analytics connected successfully!";
      } else {
        // Generic OAuth endpoint
        oauthEndpoint = `${apiUrl}/api/workflow-providers/${selectedProvider.name}/oauth/authorize?workspace_id=${workspaceId}&connectionName=${encodeURIComponent(connectionName.trim())}`;
        popupName = `${selectedProvider.name}OAuth`;
        successMessage = `${selectedProvider.display_name} connected successfully!`;
      }

      console.log('[OAuth] Fetching:', oauthEndpoint);
      const response = await fetch(oauthEndpoint, {
        method: "GET",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      console.log('[OAuth] Response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.log('[OAuth] Error response:', errorData);
        throw new Error(errorData.message || "Failed to initiate OAuth");
      }

      const data = await response.json();
      console.log('[OAuth] Response data:', data);
      const authUrl = data.authUrl || data.authorization_url;

      if (!authUrl) {
        console.log('[OAuth] No authUrl in response');
        throw new Error("No authorization URL returned");
      }

      console.log('[OAuth] Opening popup with URL:', authUrl);

      // Open OAuth popup
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      window.open(authUrl, popupName, `width=${width},height=${height},left=${left},top=${top}`);

      watchOAuthPopup({
        onClose: () => {
          setOauthLoading(false);
          fetchData();
        },
      });

    } catch (error: any) {
      console.error("OAuth initiation error:", error);
      toast.error(error.message || "Failed to initiate OAuth");
      setOauthLoading(false);
    }
  };

  const handleDeleteConnection = async () => {
    if (!connectionToDelete) return;

    try {
      const wsId = userData?.workspace?.id || localStorage.getItem('selectedWorkspaceId');
      const res = await fetch(`${apiUrl}/api/workflow-providers/connections/${connectionToDelete.id}?workspace_id=${wsId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });

      if (res.ok) {
        toast.success('Connection deleted');
        setConnectionToDelete(null);
        fetchData();
      } else {
        throw new Error('Failed to delete connection');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete connection');
    }
  };

  const handleRetestConnection = async (connectionId: string) => {
    setRetestingConnection(connectionId);
    try {
      const res = await fetch(`${apiUrl}/api/workflow-providers/connections/${connectionId}/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ workspace_id: workspaceId }),
      });

      const data = await res.json();
      if (data.verified) {
        toast.success(data.message || 'Connection verified');
        // Optimistically update badge without waiting for full refetch
        setConnections(prev => prev.map(c => c.id === connectionId ? { ...c, is_verified: true } : c));
      } else {
        toast.error(data.message || 'Connection verification failed');
      }
      fetchData();
    } catch (error) {
      toast.error('Failed to test connection');
    } finally {
      setRetestingConnection(null);
    }
  };

  const toggleSecretVisibility = (field: string) => {
    setShowSecrets(prev => ({ ...prev, [field]: !prev[field] }));
  };

  const handleStartEditCredentials = (connection: any) => {
    setEditingConnection(connection);
    setEditCredentials({});
    setExpandedConnections(prev => ({ ...prev, [connection.id]: true }));
  };

  const handleUpdateCredentials = async () => {
    if (!editingConnection) return;

    // Check if any credentials were entered
    const hasCredentials = Object.values(editCredentials).some(v => v && v.trim());
    if (!hasCredentials) {
      toast.error('Please enter at least one credential to update');
      return;
    }

    setUpdatingCredentials(true);
    try {
      const res = await fetch(`${apiUrl}/api/workflow-providers/connections/${editingConnection.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          credentials: editCredentials,
        }),
      });

      if (res.ok) {
        toast.success('Credentials updated successfully');
        setEditingConnection(null);
        setEditCredentials({});
        fetchData();
      } else {
        const error = await res.json();
        throw new Error(error.message || 'Failed to update credentials');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to update credentials');
    } finally {
      setUpdatingCredentials(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingConnection(null);
    setEditCredentials({});
  };

  // Helper to get provider logo with fallback to local assets
  const getProviderLogo = (provider: any): string | null => {
    const localLogos: Record<string, string> = {
      stripe: '/provider-logos/stripe.svg',
      openai: '/provider-logos/openai.svg',
      anthropic: '/provider-logos/anthropic.svg',
      slack: '/provider-logos/slack.svg',
      hubspot: '/provider-logos/hubspot.svg',
      pipedrive: '/provider-logos/pipedrive.svg',
      clickup: '/provider-logos/clickup.svg',
      airtable: '/provider-logos/airtable.svg',
      gmail_oauth: '/provider-logos/gmail.svg',
      google: '/provider-logos/google.svg',
      granola: '/provider-logos/granola.svg',
      attio: '/provider-logos/attio.svg',
      fathom: '/provider-logos/fathom.svg',
    };

    const providerName = (provider?.name || '').toLowerCase();
    if (localLogos[providerName]) {
      return localLogos[providerName];
    }
    return provider?.logo_url || null;
  };

  if (loading) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-lg font-semibold">Integrations</h1>
          <p className="text-muted-foreground">Connect your external services</p>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage connected services and API keys</p>
      </div>

      {/* Airtable */}
      {!showAddConnection && (() => {
        const airtableConn = connections.find((c: any) => c.provider?.name === 'airtable');
        return (
          <div className="space-y-2">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Databases & CRM</div>
            <div className="border border-border/60 rounded-xl overflow-hidden bg-background transition-all hover:border-border">
              <div className="flex items-center gap-3.5 px-4 py-3.5">
                <div className="h-9 w-9 rounded-lg bg-[#FCB400]/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  <img src="/provider-logos/airtable.svg" alt="Airtable" className="h-5 w-5 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Airtable</span>
                    {airtableConn ? (
                      <span className="inline-flex items-center h-5 px-1.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-600">Connected</span>
                    ) : (
                      <span className="inline-flex items-center h-5 px-1.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">Not connected</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {airtableConn
                      ? `Connected ${format(new Date(airtableConn.created_at), 'MMM d, yyyy')} · auto-syncs contacts bidirectionally`
                      : 'Use Airtable as your frontend — Proply stays in sync automatically'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {airtableConn ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-red-500 hover:text-red-600 hover:bg-red-50"
                      onClick={() => handleAirtableDisconnect(airtableConn.id)}
                    >
                      <X className="h-3.5 w-3.5 mr-1" />Disconnect
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="h-8 text-xs"
                      onClick={handleAirtableConnect}
                      disabled={airtableConnecting}
                    >
                      {airtableConnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
                      {airtableConnecting ? 'Connecting…' : 'Connect Airtable'}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* LinkedIn */}
      {!showAddConnection && (
        <div className="space-y-2">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Social & Outreach</div>
          <div className="border border-border/60 rounded-xl overflow-hidden bg-background transition-all hover:border-border">
            <div className="flex items-center gap-3.5 px-4 py-3.5">
              <div className="h-9 w-9 rounded-lg bg-[#0077B5]/10 flex items-center justify-center flex-shrink-0">
                <Linkedin className="h-4 w-4 text-[#0077B5]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">LinkedIn</span>
                  {linkedinStatus?.connected ? (
                    <span className="inline-flex items-center h-5 px-1.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-600">
                      Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center h-5 px-1.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">
                      Not connected
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {linkedinStatus?.connected
                    ? `${linkedinStatus.connection?.linkedin_name ?? ''}${linkedinStatus.connection?.linkedin_headline ? ` · ${linkedinStatus.connection.linkedin_headline}` : ''}`
                    : 'Sync connections and conversations to Proply contacts'}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {linkedinStatus?.connected ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-muted-foreground hover:text-foreground"
                      onClick={handleLinkedInSync}
                      disabled={linkedinSyncing}
                    >
                      {linkedinSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      <span className="ml-1.5">{linkedinSyncing ? 'Syncing…' : 'Sync'}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-red-500 hover:text-red-600 hover:bg-red-50"
                      onClick={handleLinkedInDisconnect}
                      disabled={linkedinDisconnecting}
                    >
                      {linkedinDisconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                      <span className="ml-1">{linkedinDisconnecting ? 'Disconnecting…' : 'Disconnect'}</span>
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    className="h-8 text-xs bg-[#0077B5] hover:bg-[#006097] text-white"
                    onClick={handleLinkedInConnect}
                    disabled={linkedinConnecting}
                  >
                    {linkedinConnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Linkedin className="h-3.5 w-3.5 mr-1.5" />}
                    {linkedinConnecting ? 'Connecting…' : 'Connect LinkedIn'}
                  </Button>
                )}
              </div>
            </div>
            {linkedinStatus?.connected && linkedinStatus.connection?.last_synced_at && (
              <div className="border-t border-border/40 bg-muted/30 px-4 py-2.5">
                <p className="text-[11px] text-muted-foreground">
                  Last synced {format(new Date(linkedinStatus.connection.last_synced_at), 'MMM d, yyyy · h:mm a')}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Connected Services */}
      {connections.length > 0 && !showAddConnection && (
        <div className="space-y-2">
          {connections.map((connection: any) => {
            const isExpanded = expandedConnections[connection.id];
            const authFields = connection.provider?.auth_fields || [];
            const credentialFields = Array.isArray(authFields)
              ? authFields.filter((f: any) => typeof f === 'object' && f.name)
              : [];
            const logoUrl = getProviderLogo(connection.provider);
            const category = connection.provider?.category || 'other';

            return (
              <div
                key={connection.id}
                className="group border border-border/60 rounded-xl overflow-hidden bg-background transition-all hover:border-border"
              >
                <div className="flex items-center gap-3.5 px-4 py-3.5">
                  <div className="h-9 w-9 rounded-lg bg-muted/60 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {logoUrl ? (
                      <img src={logoUrl} alt={connection.provider?.display_name} className="h-5 w-5 object-contain" />
                    ) : (
                      getCategoryIcon(category)
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{connection.provider?.display_name}</span>
                      <span className={cn(
                        "inline-flex items-center h-5 px-1.5 rounded-full text-[10px] font-medium",
                        retestingConnection === connection.id
                          ? "bg-blue-500/10 text-blue-600"
                          : connection.is_verified
                            ? "bg-emerald-500/10 text-emerald-600"
                            : "bg-amber-500/10 text-amber-600"
                      )}>
                        {retestingConnection === connection.id ? 'Testing...' : connection.is_verified ? 'Connected' : 'Unverified'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {connection.name} &middot; {format(new Date(connection.created_at), 'MMM d, yyyy')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => setExpandedConnections(prev => ({
                        ...prev,
                        [connection.id]: !prev[connection.id]
                      }))}
                    >
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => handleRetestConnection(connection.id)} disabled={retestingConnection === connection.id}>
                          <RefreshCw className={cn("h-3.5 w-3.5 mr-2", retestingConnection === connection.id && "animate-spin")} />
                          {retestingConnection === connection.id ? 'Testing...' : 'Test connection'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleStartEditCredentials(connection)}>
                          <Key className="h-3.5 w-3.5 mr-2" />
                          Update credentials
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setConnectionToDelete({ id: connection.id, name: connection.name })}
                          className="text-red-600 focus:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" />
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t border-border/40 bg-muted/30 px-4 py-3 space-y-3">
                    {editingConnection?.id === connection.id ? (
                      <>
                        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Update Credentials</div>
                        <div className="grid gap-3">
                          {credentialFields.length > 0 ? (
                            credentialFields.map((field: any) => (
                              <div key={field.name} className="space-y-1.5">
                                <Label htmlFor={`edit-${field.name}`} className="text-xs">
                                  {field.label || field.name}
                                </Label>
                                <div className="relative">
                                  <Input
                                    id={`edit-${field.name}`}
                                    type={field.type === 'password' && !showSecrets[`edit-${field.name}`] ? 'password' : 'text'}
                                    placeholder={`Enter new ${field.label || field.name}`}
                                    value={editCredentials[field.name] || ''}
                                    onChange={(e) => setEditCredentials(prev => ({ ...prev, [field.name]: e.target.value }))}
                                    className="pr-10 h-9 text-sm"
                                  />
                                  {field.type === 'password' && (
                                    <button
                                      type="button"
                                      onClick={() => toggleSecretVisibility(`edit-${field.name}`)}
                                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    >
                                      {showSecrets[`edit-${field.name}`] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="space-y-1.5">
                              <Label htmlFor="edit-api_key" className="text-xs">API Key</Label>
                              <Input
                                id="edit-api_key"
                                type="password"
                                placeholder="Enter new API key"
                                value={editCredentials['api_key'] || ''}
                                onChange={(e) => setEditCredentials(prev => ({ ...prev, api_key: e.target.value }))}
                                className="h-9 text-sm"
                              />
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" className="h-8 text-xs" onClick={handleUpdateCredentials} disabled={updatingCredentials}>
                            {updatingCredentials ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Saving...</> : 'Save'}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={handleCancelEdit} disabled={updatingCredentials}>
                            Cancel
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Stored Credentials</div>
                        <div className="space-y-1.5">
                          {(credentialFields.length > 0 ? credentialFields : [{ name: 'api_key', label: 'API Key' }]).map((field: any) => (
                            <div key={field.name} className="flex items-center justify-between py-1.5 px-3 bg-background/80 rounded-lg">
                              <span className="text-xs text-muted-foreground">{field.label || field.name}</span>
                              <code className="text-xs font-mono text-muted-foreground">
                                {connection.credentials_hint?.[field.name]
                                  ? maskCredential(connection.credentials_hint[field.name])
                                  : '••••••••••••'}
                              </code>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Connection */}
      {showAddConnection ? (
        <div className="space-y-4">
          {!selectedProvider ? (
            <>
              {/* Provider Grid */}
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Choose an app</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => setShowAddConnection(false)}
                >
                  Cancel
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {providers.map((provider) => {
                  const logoUrl = getProviderLogo(provider);
                  return (
                    <button
                      key={provider.id}
                      onClick={() => {
                        setSelectedProvider(provider);
                        setConnectionName(provider.display_name);
                      }}
                      className="flex items-center gap-3 p-3 rounded-xl border border-border/60 hover:border-border hover:bg-muted/40 transition-all text-left group"
                    >
                      <div className="h-9 w-9 rounded-lg bg-muted/60 flex items-center justify-center flex-shrink-0 overflow-hidden group-hover:bg-muted">
                        {logoUrl ? (
                          <img src={logoUrl} alt={provider.display_name} className="h-5 w-5 object-contain" />
                        ) : (
                          <Link2 className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{provider.display_name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{getCategoryLabel(provider.category || 'other')}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              {/* Provider Config Form */}
              <button
                onClick={() => {
                  setSelectedProvider(null);
                  setCredentials({});
                  setConnectionName('');
                  setTestResult(null);
                }}
                className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown className="h-3 w-3 mr-1 rotate-90" />
                Back
              </button>

              <div className="border border-border/60 rounded-xl overflow-hidden">
                {/* Provider Header */}
                <div className="px-5 py-4 flex items-center gap-3.5 border-b border-border/40">
                  <div className="h-10 w-10 rounded-lg bg-muted/60 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {(() => {
                      const logoUrl = getProviderLogo(selectedProvider);
                      return logoUrl ? (
                        <img src={logoUrl} alt={selectedProvider.display_name} className="h-6 w-6 object-contain" />
                      ) : (
                        <Link2 className="h-5 w-5 text-muted-foreground" />
                      );
                    })()}
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{selectedProvider.display_name}</div>
                    <div className="text-xs text-muted-foreground">{selectedProvider.description}</div>
                  </div>
                </div>

                <div className="px-5 py-4 space-y-4">
                  {/* Connection Name */}
                  <div className="space-y-1.5">
                    <Label htmlFor="connection-name" className="text-xs font-medium">Connection name</Label>
                    <Input
                      id="connection-name"
                      placeholder={selectedProvider.display_name}
                      value={connectionName}
                      onChange={(e) => setConnectionName(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>

                  {/* OAuth or Credentials */}
                  {(selectedProvider.auth_type === 'oauth2' || ['airtable', 'notion', 'google_analytics', 'slack', 'gmail', 'granola'].includes(selectedProvider.name)) ? (
                    <div className="space-y-3">
                      <Button
                        onClick={handleOAuthConnect}
                        disabled={oauthLoading || !connectionName.trim()}
                        className="w-full h-9 text-sm"
                      >
                        {oauthLoading ? (
                          <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> Connecting...</>
                        ) : (
                          `Connect ${selectedProvider.display_name}`
                        )}
                      </Button>
                      <p className="text-[11px] text-muted-foreground text-center">
                        You'll be redirected to authorize securely
                      </p>
                    </div>
                  ) : (
                    <>
                      {selectedProvider.auth_fields?.map((field: any) => (
                        <div key={field.name} className="space-y-1.5">
                          <Label htmlFor={field.name} className="text-xs font-medium">
                            {field.label}
                          </Label>
                          <div className="relative">
                            <Input
                              id={field.name}
                              type={field.type === 'password' && !showSecrets[field.name] ? 'password' : 'text'}
                              placeholder={field.placeholder}
                              value={credentials[field.name] || ''}
                              onChange={(e) => setCredentials(prev => ({ ...prev, [field.name]: e.target.value }))}
                              className="pr-10 h-9 text-sm"
                            />
                            {field.type === 'password' && (
                              <button
                                type="button"
                                onClick={() => toggleSecretVisibility(field.name)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              >
                                {showSecrets[field.name] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              </button>
                            )}
                          </div>
                          {field.description && (
                            <p className="text-[11px] text-muted-foreground">{field.description}</p>
                          )}
                        </div>
                      ))}
                    </>
                  )}

                  {/* Stripe webhook info */}
                  {selectedProvider.name === 'stripe' && (
                    <div className="rounded-lg bg-muted/40 px-3 py-2.5 space-y-1">
                      <p className="text-[11px] font-medium text-muted-foreground">Webhook endpoint</p>
                      <code className="text-[11px] bg-background px-2 py-1 rounded block">*.assetly.ai</code>
                    </div>
                  )}

                  {/* Test Result */}
                  {testResult && (
                    <div className={cn(
                      "flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm",
                      testResult.verified
                        ? "bg-emerald-500/10 text-emerald-700"
                        : "bg-red-500/10 text-red-700"
                    )}>
                      {testResult.verified ? (
                        <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                      ) : (
                        <X className="h-4 w-4 flex-shrink-0" />
                      )}
                      <span className="text-xs">{testResult.message}</span>
                      {testResult.mode && (
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-background">{testResult.mode === 'live' ? 'Live' : 'Test'}</span>
                      )}
                    </div>
                  )}

                  {/* Action Buttons (non-OAuth) */}
                  {!(selectedProvider.auth_type === 'oauth2' || ['airtable', 'notion', 'google_analytics', 'slack', 'gmail'].includes(selectedProvider.name)) && (
                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={handleTestConnection}
                        disabled={testing || Object.values(credentials).every(v => !v)}
                      >
                        {testing ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Testing...</> : 'Test connection'}
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 text-xs"
                        onClick={handleSaveConnection}
                        disabled={saving || !testResult?.verified || !connectionName.trim()}
                      >
                        {saving ? <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Saving...</> : 'Save'}
                      </Button>
                    </div>
                  )}

                  {/* Cancel for OAuth */}
                  {(selectedProvider.auth_type === 'oauth2' || ['airtable', 'notion', 'google_analytics', 'slack', 'gmail'].includes(selectedProvider.name)) && (
                    <div className="flex justify-center pt-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground"
                        onClick={() => {
                          setShowAddConnection(false);
                          setSelectedProvider(null);
                          setConnectionName('');
                          setOauthLoading(false);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        /* Add button / empty state */
        connections.length === 0 ? (
          <button
            onClick={() => setShowAddConnection(true)}
            className="w-full border border-dashed border-border/60 rounded-xl p-8 flex flex-col items-center gap-3 text-center hover:border-border hover:bg-muted/20 transition-all"
          >
            <div className="h-10 w-10 rounded-full bg-muted/60 flex items-center justify-center">
              <Plus className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Connect your first app</p>
              <p className="text-xs text-muted-foreground mt-0.5">CRMs, meeting tools, and more</p>
            </div>
          </button>
        ) : providers.length > 0 && (
          <button
            onClick={() => setShowAddConnection(true)}
            className="w-full border border-dashed border-border/60 rounded-xl px-4 py-3 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/20 transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            Add connection
          </button>
        )
      )}

      {/* Security footer */}
      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-2">
        <Shield className="h-3 w-3" />
        All credentials encrypted with AES-256-GCM
      </p>

      {/* Delete Confirmation */}
      <AlertDialog open={!!connectionToDelete} onOpenChange={(open) => !open && setConnectionToDelete(null)}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove connection</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove "{connectionToDelete?.name}" and revoke access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConnection}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Feature options for dropdown
const FEATURE_OPTIONS = [
  'AI Writer',
  'Workflow Builder',
  'Proposal Writer',
  'Ask Proply',
  'Forms',
  'E-Signatures',
  'Asset Library',
  'Templates',
  'Analytics',
  'Integrations',
  'General'
];

// Inline Feedback Form Component
function InlineFeedbackForm({
  type,
  onSubmit,
  isSubmitting,
  onCancel,
}: {
  type: "feature_request" | "improvement";
  onSubmit: (data: { type: CommunityPostType; title: string; description: string; tags: string[] }) => Promise<void>;
  isSubmitting: boolean;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFeature, setSelectedFeature] = useState("");
  const [feedbackType, setFeedbackType] = useState<"improvement" | "bug_report">("improvement");

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) return;

    await onSubmit({
      type: type === "feature_request" ? "feature_request" : feedbackType,
      title: title.trim(),
      description: description.trim(),
      tags: selectedFeature ? [selectedFeature] : [],
    });

    // Reset form
    setTitle("");
    setDescription("");
    setSelectedFeature("");
    onCancel();
  };

  const handleCancel = () => {
    setTitle("");
    setDescription("");
    setSelectedFeature("");
    onCancel();
  };

  const isFeatureRequest = type === "feature_request";

  return (
    <Card className="border border-border">
      <CardContent className="p-5">
        <div className="space-y-4">
          <Input
            placeholder={isFeatureRequest
              ? "Feature title — e.g. 'Attio integration'"
              : "What's on your mind?"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-10"
          />

          <Textarea
            placeholder="Describe what you need and why it matters to your workflow..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="resize-none"
          />

          {/* Tag chips */}
          <div className="flex flex-wrap gap-2">
            {FEATURE_OPTIONS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedFeature(selectedFeature === tag ? "" : tag)}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-full border transition-colors",
                  selectedFeature === tag
                    ? "bg-black text-white border-black"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                )}
              >
                {tag}
              </button>
            ))}
          </div>

          {/* Feedback type for non-feature requests */}
          {!isFeatureRequest && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFeedbackType("improvement")}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md border transition-colors",
                  feedbackType === "improvement"
                    ? "bg-blue-50 text-blue-600 border-blue-200"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                )}
              >
                Improvement
              </button>
              <button
                type="button"
                onClick={() => setFeedbackType("bug_report")}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md border transition-colors",
                  feedbackType === "bug_report"
                    ? "bg-red-50 text-red-600 border-red-200"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                )}
              >
                Bug Report
              </button>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={isSubmitting}
              className="text-muted-foreground"
            >
              Cancel
            </Button>

            <Button
              onClick={handleSubmit}
              disabled={!title.trim() || !description.trim() || isSubmitting}
              size="sm"
              className="bg-black text-white hover:bg-black/90"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Submit"
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Community Section - Community Voice
function CommunitySection() {
  const { session, userData } = useAuth();
  const [activeTab, setActiveTab] = useState<"feature_requests" | "feedback" | "book_call">("feature_requests");
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"upvotes" | "recent" | "comments">("upvotes");
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "under_review" | "planned" | "in_progress" | "shipped">("all");

  // Get current user info
  const currentUserId = userData?.user?.supabase_user_id;
  const isAdmin = userData?.user?.is_admin || false;

  // Determine post type filter based on active tab
  const typeFilter = activeTab === "feature_requests" ? "feature_request" :
                     activeTab === "feedback" ? undefined : undefined;

  // Fetch posts
  const { data: postsData, isLoading: postsLoading } = useCommunityPosts({
    type: typeFilter,
    status: statusFilter === "all" ? undefined : statusFilter,
    sort: sortBy,
    limit: 50,
  });

  // Fetch selected post details
  const { data: postDetail, isLoading: postDetailLoading } = useCommunityPost(selectedPostId);

  // Mutations
  const createPost = useCreateCommunityPost();
  const deletePost = useDeleteCommunityPost();
  const toggleUpvote = useToggleCommunityUpvote();
  const addComment = useAddCommunityComment();
  const deleteComment = useDeleteCommunityComment();
  const updateStatus = useUpdateCommunityPostStatus();

  const posts = postsData?.posts || [];
  const availableTags = postsData?.tags || [];

  // Filter posts based on tab for feedback (improvement + bug_report)
  const filteredPosts = activeTab === "feedback"
    ? posts.filter(p => p.type === "improvement" || p.type === "bug_report")
    : posts;

  const handleCreatePost = async (data: {
    type: CommunityPostType;
    title: string;
    description: string;
    tags: string[];
  }) => {
    await createPost.mutateAsync(data);
    setShowForm(false);
  };

  const handleUpvote = async (postId: string) => {
    await toggleUpvote.mutateAsync(postId);
  };

  const handleAddComment = async (content: string) => {
    if (!selectedPostId) return;
    await addComment.mutateAsync({ postId: selectedPostId, content });
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!selectedPostId) return;
    await deleteComment.mutateAsync({ commentId, postId: selectedPostId });
  };

  const handleDeletePost = async () => {
    if (!selectedPostId) return;
    await deletePost.mutateAsync(selectedPostId);
    setSelectedPostId(null);
  };

  const handleUpdateStatus = async (status: CommunityPostStatus) => {
    if (!selectedPostId) return;
    await updateStatus.mutateAsync({ postId: selectedPostId, status });
  };

  // If viewing a specific post
  if (selectedPostId && postDetail) {
    return (
      <CommunityPostDetail
        post={postDetail.post}
        comments={postDetail.comments}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        onBack={() => setSelectedPostId(null)}
        onUpvote={handleUpvote}
        onAddComment={handleAddComment}
        onDeleteComment={handleDeleteComment}
        onDeletePost={handleDeletePost}
        onUpdateStatus={isAdmin ? handleUpdateStatus : undefined}
        isLoadingComments={postDetailLoading}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">Community Voice</h1>
          <p className="text-muted-foreground">Share ideas, vote on features, and track what we're building</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex gap-6">
          <button
            onClick={() => { setActiveTab("feature_requests"); setShowForm(false); setStatusFilter("all"); }}
            className={cn(
              "pb-3 text-sm font-medium border-b-2 transition-colors -mb-px",
              activeTab === "feature_requests"
                ? "border-black text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Feature Requests
          </button>
          <button
            onClick={() => { setActiveTab("feedback"); setShowForm(false); setStatusFilter("all"); }}
            className={cn(
              "pb-3 text-sm font-medium border-b-2 transition-colors -mb-px",
              activeTab === "feedback"
                ? "border-black text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Give Feedback
          </button>
          <button
            onClick={() => { setActiveTab("book_call"); setShowForm(false); }}
            className={cn(
              "pb-3 text-sm font-medium border-b-2 transition-colors -mb-px",
              activeTab === "book_call"
                ? "border-black text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Book a Call
          </button>
        </div>
      </div>

      {/* Content based on active tab */}
      {activeTab === "book_call" ? (
        <BookCallSection />
      ) : (
        <>
          {/* Show Form Button or Inline Form */}
          {!showForm ? (
            <Button
              onClick={() => setShowForm(true)}
              className="bg-black text-white hover:bg-black/90"
            >
              <Plus className="h-4 w-4 mr-2" />
              {activeTab === "feature_requests" ? "Request Feature" : "Submit Feedback"}
            </Button>
          ) : (
            <InlineFeedbackForm
              type={activeTab === "feature_requests" ? "feature_request" : "improvement"}
              onSubmit={handleCreatePost}
              isSubmitting={createPost.isPending}
              onCancel={() => setShowForm(false)}
            />
          )}

          {/* Sort Bar */}
          <div className="flex items-center justify-between">
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="w-[160px] h-9 text-sm">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="upvotes">Most Upvoted</SelectItem>
                <SelectItem value="recent">Most Recent</SelectItem>
                <SelectItem value="comments">Most Comments</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Status Filter Tabs (Kanban-style) - below sort, above posts */}
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { value: "all", label: "All" },
              { value: "under_review", label: "Under Review" },
              { value: "planned", label: "Planned" },
              { value: "in_progress", label: "In Progress" },
              { value: "shipped", label: "Shipped" },
            ].map((status) => (
              <button
                key={status.value}
                onClick={() => setStatusFilter(status.value as typeof statusFilter)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-full border transition-colors",
                  statusFilter === status.value
                    ? "bg-black text-white border-black"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                )}
              >
                {status.label}
              </button>
            ))}
          </div>

          {/* Posts List */}
          {postsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredPosts.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No posts yet. Be the first to share!
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPosts.map((post) => (
                <CommunityPostCard
                  key={post.id}
                  post={post}
                  onClick={() => setSelectedPostId(post.id)}
                  onUpvote={handleUpvote}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Book a Call sub-section
function BookCallSection() {
  const linkedinUrl = "https://www.linkedin.com/in/bennet-glinder99/";
  const founderImageUrl = "/Design ohne Titel (27).png";
  const { userData } = useAuth();
  const firstName = userData?.user?.user_metadata?.full_name?.split(' ')[0] || userData?.user?.name?.split(' ')[0] || "there";

  return (
    <div className="space-y-6">
      {/* Founder Card */}
      <Card className="border border-border/60 bg-gradient-to-b from-white to-neutral-50/50 shadow-sm overflow-hidden">
        <CardContent className="p-6">
          <div className="flex flex-col gap-6">
            {/* Header: Image & Name */}
            <div className="flex items-center gap-4">
              <Avatar className="h-14 w-14 border border-border shadow-sm flex-shrink-0">
                <AvatarImage src={founderImageUrl} alt="Bennet" className="object-cover" />
                <AvatarFallback className="text-lg bg-neutral-100 text-neutral-700 font-medium">
                  B
                </AvatarFallback>
              </Avatar>
              <div className="space-y-0.5">
                <h3 className="text-sm font-medium text-foreground">Bennet Glinder</h3>
                <p className="text-sm text-muted-foreground">Founder, Proply</p>
              </div>
            </div>

            {/* Message Content */}
            <div className="space-y-3 text-sm leading-relaxed text-gray-600">
              <p className="text-foreground font-medium">
                Hey {firstName},
              </p>
              <p>
                I'd love to learn more about your use case and how we can help. Book a quick call and let's chat!
              </p>
              <div className="pt-2 flex items-center gap-3">
                <Button
                  onClick={() => window.open("https://cal.com/bennet-glinder/15min", "_blank")}
                  className="bg-black text-white hover:bg-black/90"
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  Book a Call
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => window.open(linkedinUrl, "_blank")}
                  className="h-9 w-9 hover:bg-neutral-100 rounded-full transition-all"
                  title="Connect on LinkedIn"
                >
                  <Linkedin className="h-4 w-4 text-[#0077b5]" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Contact Options */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="border border-border/60 p-4 hover:border-border hover:shadow-sm transition-all cursor-pointer"
              onClick={() => window.open("mailto:bennetglinder@gmail.com", "_blank")}>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <MessageSquare className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h4 className="text-sm font-medium">Email Us</h4>
              <p className="text-xs text-muted-foreground">bennetglinder@gmail.com</p>
            </div>
          </div>
        </Card>
        <Card className="border border-border/60 p-4 hover:border-border hover:shadow-sm transition-all cursor-pointer"
              onClick={() => window.open(linkedinUrl, "_blank")}>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-[#0077b5]/10 flex items-center justify-center">
              <Linkedin className="h-5 w-5 text-[#0077b5]" />
            </div>
            <div>
              <h4 className="text-sm font-medium">LinkedIn</h4>
              <p className="text-xs text-muted-foreground">Connect with Bennet</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}



// Profile Section
function ProfileSection({
  userData,
  onUpdate,
}: {
  userData: any;
  onUpdate: () => void;
}) {
  const { session } = useAuth();
  const [name, setName] = useState(userData?.user?.name || "");
  const [profilePictureUrl, setProfilePictureUrl] = useState(userData?.user?.profile_picture_url || "");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (userData?.user) {
      setName(userData.user.name || "");
      setProfilePictureUrl(userData.user.profile_picture_url || "");
    }
  }, [userData]);

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(`Image is too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Please use an image smaller than 5MB.`);
      return;
    }

    setUploading(true);

    try {
      const fileExt = file.name.split('.').pop() || 'jpg';
      const userId = userData?.user?.id || session?.user?.id;
      if (!userId) {
        toast.error('User ID not found');
        setUploading(false);
        return;
      }
      // Path must start with userId/ to match storage policy
      const filePath = `${userId}/profile-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('user-profiles')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        if (uploadError.message?.includes('Bucket not found')) {
          toast.error('Storage bucket "user-profiles" not found. Please create it in Supabase Storage.');
        } else {
          toast.error(`Failed to upload image: ${uploadError.message}`);
        }
        setUploading(false);
        return;
      }

      const { data: urlData } = supabase.storage
        .from('user-profiles')
        .getPublicUrl(filePath);

      const publicUrl = urlData.publicUrl;

      if (!publicUrl) {
        toast.error('Failed to get image URL');
        setUploading(false);
        return;
      }

      await updateProfilePicture(publicUrl);
      setProfilePictureUrl(publicUrl);
      toast.success('Profile picture uploaded successfully');
    } catch (error: any) {
      console.error('Error uploading image:', error);
      toast.error(`Failed to upload image: ${error.message || 'Unknown error'}`);
    } finally {
      setUploading(false);
    }
  };

  const updateProfilePicture = async (url: string) => {
    if (!session?.access_token) return;

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/users/me`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ profile_picture_url: url }),
      });

      if (response.ok) {
        onUpdate();
      } else {
        const error = await response.json();
        throw new Error(error.detail || error.error || "Failed to update profile picture");
      }
    } catch (error: any) {
      console.error("Error updating profile picture:", error);
      throw error;
    }
  };

  const updateName = async () => {
    if (!session?.access_token) return;

    setLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/users/me`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ name: name.trim() }),
      });

      if (response.ok) {
        toast.success("Name updated successfully");
        onUpdate();
      } else {
        const error = await response.json();
        toast.error(error.detail || error.error || "Failed to update name");
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to update name");
    } finally {
      setLoading(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
    e.target.value = "";
  };

  const getInitials = (name: string) => {
    if (!name) return "U";
    const parts = name.trim().split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold">Profile</h1>
        <p className="text-muted-foreground">Manage your profile information and picture</p>
      </div>

      <section className="space-y-4">
        <div>
          <Label className="text-base font-medium mb-4 block">Profile Picture</Label>
          <div className="flex items-center gap-6">
            <Avatar className="h-24 w-24 border-2 border-border">
              <AvatarImage src={profilePictureUrl || undefined} alt={name || "User"} />
              <AvatarFallback className="text-2xl">
                {getInitials(name || userData?.user?.email || "U")}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-2">
              <div>
                <input
                  type="file"
                  id="profile-picture-upload"
                  accept="image/*"
                  onChange={handleFileInputChange}
                  className="hidden"
                  disabled={uploading}
                />
                <Button
                  variant="outline"
                  disabled={uploading}
                  className="cursor-pointer"
                  onClick={() => document.getElementById('profile-picture-upload')?.click()}
                >
                  {uploading ? (
                    <>
                      <Upload className="h-4 w-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Camera className="h-4 w-4 mr-2" />
                      Upload Picture
                    </>
                  )}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                JPG, PNG or GIF. Max size 5MB.
              </p>
              {profilePictureUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    try {
                      await updateProfilePicture("");
                      setProfilePictureUrl("");
                      toast.success("Profile picture removed");
                    } catch (error: any) {
                      toast.error(error.message || "Failed to remove picture");
                    }
                  }}
                  className="text-destructive hover:text-destructive"
                >
                  Remove Picture
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4 pt-6 border-t border-border">
        <div>
          <Label htmlFor="profile-name" className="text-base font-medium mb-2 block">
            Name
          </Label>
          <p className="text-sm text-muted-foreground mb-4">
            Your name will be visible to your team members.
          </p>
          <div className="flex gap-3">
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              className="max-w-md"
              disabled={loading}
            />
            <Button onClick={updateName} disabled={loading || !name.trim() || name.trim() === userData?.user?.name}>
              {loading ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-4 pt-6 border-t border-border">
        <div>
          <Label className="text-base font-medium mb-2 block">Email</Label>
          <p className="text-sm text-muted-foreground mb-4">
            Your email address. Contact support to change it.
          </p>
          <Input
            value={userData?.user?.email || ""}
            disabled
            className="max-w-md bg-muted"
          />
        </div>
      </section>

      {/* Data & Privacy Section */}
      <section className="space-y-4 pt-6 border-t border-border">
        <div>
          <Label className="text-base font-medium mb-2 block">Data & Privacy</Label>
          <p className="text-sm text-muted-foreground mb-4">
            Export your data or manage your account.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const apiUrl = import.meta.env.VITE_API_URL ?? "";
                  const response = await fetch(`${apiUrl}/api/users/me/export`, {
                    method: "GET",
                    headers: {
                      Authorization: `Bearer ${session?.access_token}`,
                    },
                  });

                  if (response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `assetly-data-export-${Date.now()}.json`;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    a.remove();
                    toast.success("Your data export has been downloaded");
                  } else {
                    const error = await response.json();
                    toast.error(error.detail || error.error || "Failed to export data");
                  }
                } catch (error: any) {
                  toast.error(error.message || "Failed to export data");
                }
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              Export My Data
            </Button>
            <DeleteAccountButton session={session} />
          </div>
        </div>
      </section>
    </div>
  );
}

function DeleteAccountButton({ session }: { session: any }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (confirmText !== "DELETE") return;

    setDeleting(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/users/me`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ confirmation: "DELETE_MY_ACCOUNT" }),
      });

      if (response.ok) {
        toast.success("Your account has been deleted. You will be logged out.");
        // Sign out and redirect
        setTimeout(async () => {
          await supabase.auth.signOut();
          window.location.href = "/";
        }, 2000);
      } else {
        const error = await response.json();
        toast.error(error.detail || error.error || "Failed to delete account");
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to delete account");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" className="w-fit">
          <Trash2 className="h-4 w-4 mr-2" />
          Delete Account
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Delete Account Permanently
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p>
              This will permanently delete your account and all associated data including:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
              <li>All documents and templates you created</li>
              <li>All forms and form submissions</li>
              <li>All content pieces and asset library files</li>
              <li>Your profile and account settings</li>
              <li>Workspaces where you are the only member</li>
            </ul>
            <p className="font-medium text-foreground pt-2">
              This action cannot be undone. Type <span className="font-mono bg-muted px-1 rounded">DELETE</span> to confirm.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="Type DELETE to confirm"
          className="mt-2"
          disabled={deleting}
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={confirmText !== "DELETE" || deleting}
          >
            {deleting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete My Account"
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

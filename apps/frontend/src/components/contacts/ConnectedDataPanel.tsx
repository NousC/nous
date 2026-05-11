import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw,
  Plus,
  Settings,
  CheckCircle2,
  XCircle,
  Circle,
  Loader2,
  ExternalLink
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ConnectedDataConfigModal } from "./ConnectedDataConfigModal";
import { toast } from "@/components/ui/sonner";

interface Integration {
  id: string;
  contact_id: string;
  provider_connection_id: string;
  config: Record<string, any>;
  status: "pending" | "connected" | "error";
  status_message?: string;
  cached_preview?: Record<string, any>;
  last_synced_at?: string;
  provider_connection: {
    id: string;
    name: string;
    is_verified: boolean;
    provider: {
      id: string;
      name: string;
      display_name: string;
      logo_url?: string;
      category: string;
    };
  };
}

interface WorkspaceConnection {
  id: string;
  name: string;
  provider_id: string;
  is_verified: boolean;
  provider: {
    id: string;
    name: string;
    display_name: string;
    logo_url?: string;
    category: string;
  };
}

interface ConnectedDataPanelProps {
  contactId: string;
  workspaceId: string;
}

export function ConnectedDataPanel({ contactId, workspaceId }: ConnectedDataPanelProps) {
  const { session } = useAuth();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [workspaceConnections, setWorkspaceConnections] = useState<WorkspaceConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [editingIntegration, setEditingIntegration] = useState<Integration | null>(null);

  useEffect(() => {
    if (contactId && workspaceId) {
      loadIntegrations();
      loadWorkspaceConnections();
    }
  }, [contactId, workspaceId]);

  const loadIntegrations = async () => {
    if (!session?.access_token) return;

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/contacts/${contactId}/integrations`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setIntegrations(data.integrations || []);
      }
    } catch (error) {
      console.error("Error loading integrations:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadWorkspaceConnections = async () => {
    if (!session?.access_token) return;

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/workflow-providers/connections?workspace_id=${workspaceId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setWorkspaceConnections(data.connections || []);
      }
    } catch (error) {
      console.error("Error loading workspace connections:", error);
    }
  };

  const handleSync = async (integration: Integration) => {
    if (!session?.access_token) return;

    setSyncingIds(prev => new Set(prev).add(integration.id));

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/contacts/${contactId}/integrations/${integration.id}/sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setIntegrations(prev =>
          prev.map(i =>
            i.id === integration.id
              ? {
                  ...i,
                  status: data.success ? "connected" : "error",
                  cached_preview: data.preview || i.cached_preview,
                  last_synced_at: data.success ? new Date().toISOString() : i.last_synced_at
                }
              : i
          )
        );
        if (data.success) {
          toast.success("Data synced successfully");
        } else {
          toast.error(data.error || "Sync failed");
        }
      }
    } catch (error) {
      console.error("Error syncing integration:", error);
      toast.error("Failed to sync");
    } finally {
      setSyncingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(integration.id);
        return newSet;
      });
    }
  };

  const handleDelete = async (integrationId: string) => {
    if (!session?.access_token) return;

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/contacts/${contactId}/integrations/${integrationId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` }
      });

      if (response.ok) {
        setIntegrations(prev => prev.filter(i => i.id !== integrationId));
        toast.success("Integration removed");
      }
    } catch (error) {
      console.error("Error deleting integration:", error);
      toast.error("Failed to remove integration");
    }
  };

  const handleConfigSave = (newIntegration: Integration) => {
    if (editingIntegration) {
      // Update existing
      setIntegrations(prev =>
        prev.map(i => (i.id === newIntegration.id ? newIntegration : i))
      );
    } else {
      // Add new
      setIntegrations(prev => [...prev, newIntegration]);
    }
    setEditingIntegration(null);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "connected":
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Circle className="h-4 w-4 text-gray-300" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "connected":
        return "ON";
      case "error":
        return "ERROR";
      default:
        return "PENDING";
    }
  };

  // Get available connections (not yet configured for this contact, excluding AI providers)
  const availableConnections = workspaceConnections.filter(
    wc => !integrations.some(i => i.provider_connection_id === wc.id) &&
          wc.provider?.category !== 'ai'
  );

  if (loading) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl p-3 h-full">
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3 h-full flex flex-col">
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Connected Data</h3>
        </div>
        {availableConnections.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1 text-xs h-7 px-2"
            onClick={() => {
              setEditingIntegration(null);
              setConfigModalOpen(true);
            }}
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-auto space-y-2 min-h-0 scrollbar-hide">
        {integrations.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <div className="text-sm mb-2">No integrations</div>
            {availableConnections.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-xs h-8"
                onClick={() => {
                  setEditingIntegration(null);
                  setConfigModalOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Add integration
              </Button>
            ) : (
              <p className="text-xs text-gray-400">
                Connect integrations in Settings first
              </p>
            )}
          </div>
        ) : (
          integrations.map(integration => {
            const provider = integration.provider_connection?.provider;
            const isSyncing = syncingIds.has(integration.id);

            return (
              <div
                key={integration.id}
                className="border border-gray-100 rounded-lg p-2.5 hover:border-gray-200 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  {/* Provider Logo */}
                  <div className="w-8 h-8 rounded-md bg-gray-50 flex items-center justify-center flex-shrink-0">
                    {provider?.logo_url ? (
                      <img
                        src={provider.logo_url}
                        alt={provider.display_name}
                        className="w-5 h-5 object-contain"
                      />
                    ) : (
                      <span className="text-xs font-medium text-gray-400">
                        {provider?.display_name?.[0] || "?"}
                      </span>
                    )}
                  </div>

                  {/* Provider Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-gray-900 truncate">
                        {provider?.display_name || "Unknown"}
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-[9px] px-1.5 py-0 h-4 ${
                          integration.status === "connected"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : integration.status === "error"
                            ? "bg-red-50 text-red-700 border-red-200"
                            : "bg-gray-50 text-gray-500 border-gray-200"
                        }`}
                      >
                        {getStatusLabel(integration.status)}
                      </Badge>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => handleSync(integration)}
                      disabled={isSyncing}
                      title="Refresh"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => {
                        setEditingIntegration(integration);
                        setConfigModalOpen(true);
                      }}
                      title="Configure"
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Config Modal */}
      <ConnectedDataConfigModal
        open={configModalOpen}
        onOpenChange={setConfigModalOpen}
        contactId={contactId}
        workspaceId={workspaceId}
        availableConnections={availableConnections}
        existingIntegration={editingIntegration}
        onSave={handleConfigSave}
        onDelete={handleDelete}
      />
    </div>
  );
}

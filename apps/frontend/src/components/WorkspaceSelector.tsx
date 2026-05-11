import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ChevronDown, Plus, Check, Trash2, Folder } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { workspaceIcons, getWorkspaceIcon } from '@/utils/workspaceIcons';

export function WorkspaceSelector() {
  const { userData, session, refreshUserData } = useAuth();
  const { toast } = useToast();
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceIcon, setNewWorkspaceIcon] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [workspaceToDelete, setWorkspaceToDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [hoveredWorkspaceId, setHoveredWorkspaceId] = useState<string | null>(null);
  const [usageData, setUsageData] = useState<any>(null);

  const currentWorkspace = userData?.workspace;

  // Check if workspace limit is reached
  const isWorkspaceLimitReached = usageData?.usage?.workspaces 
    ? (usageData.usage.workspaces.current >= usageData.usage.workspaces.limit)
    : false;

  // Use refs to prevent duplicate requests
  const fetchingRef = useRef(false);
  const lastFetchRef = useRef<number>(0);
  const CACHE_DURATION = 30 * 1000; // 30 seconds cache

  useEffect(() => {
    if (session?.access_token) {
      const now = Date.now();
      // Only fetch if not already fetching and cache is expired
      if (!fetchingRef.current && (now - lastFetchRef.current) > CACHE_DURATION) {
        fetchingRef.current = true;
        lastFetchRef.current = now;
        Promise.all([fetchWorkspaces(), fetchUsageData()]).finally(() => {
          fetchingRef.current = false;
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

  const fetchUsageData = async () => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const response = await fetch(`${apiUrl}/api/usage`, {
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
        },
      });

      if (!response.ok) {
        // Handle 429 and other errors properly
        if (response.status === 429) {
          console.warn('Rate limit hit for usage endpoint, will retry later');
          return; // Silently fail for rate limits, will retry on next mount
        }
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json();
          console.error('Error fetching usage data:', errorData);
        }
        return;
      }

      const data = await response.json();
      setUsageData(data);
    } catch (error) {
      console.error('Error fetching usage data:', error);
    }
  };

  const fetchWorkspaces = async () => {
    try {
      setLoading(true);
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const response = await fetch(`${apiUrl}/api/workspaces`, {
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
        },
      });

      if (!response.ok) {
        // Handle 429 and other errors properly
        if (response.status === 429) {
          console.warn('Rate limit hit for workspaces endpoint, will retry later');
          return; // Silently fail for rate limits, will retry on next mount
        }
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json();
          console.error('Error fetching workspaces:', errorData);
        }
        return;
      }

      const data = await response.json();
      setWorkspaces(data.workspaces || []);
    } catch (error) {
      console.error('Error fetching workspaces:', error);
    } finally {
      setLoading(false);
    }
  };

  const switchWorkspace = async (workspaceId: string) => {
    try {
      setLoading(true);
      // Store selected workspace in localStorage
      localStorage.setItem('selectedWorkspaceId', workspaceId);
      
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const response = await fetch(`${apiUrl}/me?workspace_id=${workspaceId}`, {
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        // Update userData with selected workspace
        refreshUserData();
        
        const selectedWorkspace = workspaces.find(w => w.id === workspaceId);
        toast({
          title: 'Workspace switched',
          description: `Switched to ${selectedWorkspace?.name || 'workspace'}`,
        });
      }
    } catch (error) {
      console.error('Error switching workspace:', error);
      toast({
        title: 'Error',
        description: 'Failed to switch workspace',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const createWorkspace = async () => {
    if (!newWorkspaceName.trim()) {
      toast({
        title: 'Error',
        description: 'Workspace name is required',
        variant: 'destructive',
      });
      return;
    }

    // Check limit before attempting creation
    if (isWorkspaceLimitReached) {
      toast({
        title: 'Workspace limit reached',
        description: `You've reached your workspace limit (${usageData?.usage?.workspaces?.limit || 0}). Please upgrade your plan to create more workspaces.`,
        variant: 'destructive',
      });
      return;
    }

    try {
      setCreating(true);
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const response = await fetch(`${apiUrl}/api/workspaces`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newWorkspaceName.trim(),
          icon: newWorkspaceIcon || null,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const newWorkspace = data.workspace;
        setWorkspaces([...workspaces, newWorkspace]);
        // Automatically select the newly created workspace
        localStorage.setItem('selectedWorkspaceId', newWorkspace.id);
        setCreateDialogOpen(false);
        setNewWorkspaceName('');
        setNewWorkspaceIcon(null);
        // Refresh user data and usage data
        refreshUserData();
        fetchUsageData();
        toast({
          title: 'Workspace created',
          description: `${newWorkspace.name} has been created and selected`,
        });
      } else {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || 'Failed to create workspace');
      }
    } catch (error: any) {
      console.error('Error creating workspace:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create workspace',
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, workspaceId: string) => {
    e.stopPropagation();
    setWorkspaceToDelete(workspaceId);
    setDeleteDialogOpen(true);
  };

  const deleteWorkspace = async () => {
    if (!workspaceToDelete) return;

    try {
      setDeleting(true);
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const response = await fetch(`${apiUrl}/api/workspaces/${workspaceToDelete}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
        },
      });

      if (response.ok) {
        const deletedWorkspace = workspaces.find(w => w.id === workspaceToDelete);
        setWorkspaces(workspaces.filter(w => w.id !== workspaceToDelete));
        setDeleteDialogOpen(false);
        setWorkspaceToDelete(null);
        refreshUserData();
        fetchUsageData(); // Refresh usage data after deletion
        toast({
          title: 'Workspace deleted',
          description: `${deletedWorkspace?.name || 'Workspace'} has been deleted`,
        });
      } else {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.detail || errorData.error || `Failed to delete workspace (${response.status})`;
        console.error('[DELETE_WORKSPACE] Error response:', errorData);
        throw new Error(errorMessage);
      }
    } catch (error: any) {
      console.error('Error deleting workspace:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete workspace',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  if (!userData) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-9 gap-2 px-3"
            disabled={loading}
          >
            <span className="font-medium">
              {currentWorkspace?.name || 'Select Workspace'}
            </span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {workspaces.map((workspace) => {
            const WorkspaceIcon = getWorkspaceIcon(workspace.icon);
            return (
            <DropdownMenuItem
              key={workspace.id}
              onClick={() => switchWorkspace(workspace.id)}
                onMouseEnter={() => setHoveredWorkspaceId(workspace.id)}
                onMouseLeave={() => setHoveredWorkspaceId(null)}
                className="flex items-center justify-between group relative"
            >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {WorkspaceIcon ? (
                    <WorkspaceIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <Folder className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}
                  <span className="truncate">{workspace.name}</span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {hoveredWorkspaceId === workspace.id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => handleDeleteClick(e, workspace.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
              {currentWorkspace?.id === workspace.id && (
                    <Check className="h-4 w-4 ml-2 flex-shrink-0" />
              )}
                </div>
            </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem 
            onClick={() => !isWorkspaceLimitReached && setCreateDialogOpen(true)}
            disabled={isWorkspaceLimitReached}
            className={isWorkspaceLimitReached ? "opacity-50 cursor-not-allowed" : ""}
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Workspace
            {isWorkspaceLimitReached && (
              <span className="ml-auto text-xs text-muted-foreground">
                Limit reached
              </span>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Workspace</DialogTitle>
            <DialogDescription>
              Create a new workspace to organize your documents and templates.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Workspace Name</Label>
              <Input
                id="workspace-name"
                placeholder="My Workspace"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !creating) {
                    createWorkspace();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Workspace Icon (Optional)</Label>
              <div className="grid grid-cols-6 gap-2">
                {workspaceIcons.map((iconItem) => {
                  const IconComponent = iconItem.icon;
                  const iconValue = iconItem.name;
                  return (
                    <Card
                      key={iconValue}
                      className={`aspect-square flex items-center justify-center cursor-pointer transition-all hover:scale-110 ${
                        newWorkspaceIcon === iconValue
                          ? "border-2 border-[#2D2D2D] bg-gray-50"
                          : "border border-gray-200 hover:border-gray-300 bg-white"
                      }`}
                      onClick={() => setNewWorkspaceIcon(newWorkspaceIcon === iconValue ? null : iconValue)}
                    >
                      <IconComponent className="h-5 w-5 text-gray-500" />
                    </Card>
                  );
                })}
              </div>
            </div>
            {isWorkspaceLimitReached && usageData && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900">
                <p>
                  You've reached your workspace limit ({usageData.usage.workspaces.current} of {usageData.usage.workspaces.limit}). 
                  Please upgrade your plan to create more workspaces.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button 
              onClick={createWorkspace} 
              disabled={creating || isWorkspaceLimitReached}
            >
              {creating ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workspace</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this workspace? This action cannot be undone and will delete all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteWorkspace}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}


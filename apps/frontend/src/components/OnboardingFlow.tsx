import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

// Import step content components (we'll create simplified versions inline)
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import {
  ArrowRight,
  Loader2,
  Upload,
  FileText,
  X,
  Sun,
  Moon,
  Globe,
  Paintbrush,
  Building2,
  FolderOpen,
  Sparkles,
  Workflow,
  PenTool,
  FileSignature,
  Linkedin,
  LayoutTemplate,
  Search,
  Link,
  Mic,
  MicOff,
} from "lucide-react";

type OnboardingStep = "welcome" | "founder_letter" | "account_setup" | "create_template";

interface OnboardingFlowProps {
  open: boolean;
  onComplete: (templateId: string) => void;
  trialEndsAt: string | null;
  daysRemaining: number | null;
  workspaceId: string;
  defaultWorkspaceName: string;
  claimedTemplateId?: string | null;
}

const DESIGN_STYLES = [
  { value: 'corporate', label: 'Corporate', description: 'Professional, clean, business-focused' },
  { value: 'creative', label: 'Creative', description: 'Bold, artistic, innovative' },
  { value: 'minimalist', label: 'Minimalist', description: 'Simple, clean, lots of whitespace' },
  { value: 'elegant', label: 'Elegant', description: 'Sophisticated, refined, premium' },
  { value: 'modern', label: 'Modern', description: 'Contemporary, fresh, trendy' },
];

const WELCOME_FEATURES = [
  { label: "100 AI Credits", icon: Sparkles },
  { label: "1 Workflow", icon: Workflow },
  { label: "5 Templates", icon: FileText },
  { label: "Proposal Writer", icon: PenTool },
  { label: "E-Signatures", icon: FileSignature },
  { label: "Asset Library", icon: FolderOpen },
];

type AssetTab = "upload" | "research" | "notes";

interface PendingAsset {
  id: string;
  type: 'file' | 'research' | 'note';
  name: string;
  file?: File;
  researchTopic?: string;
  researchContext?: string;
  researchSources?: string;
  researchDepth?: 'quick' | 'comprehensive';
  noteContent?: string;
}

export function OnboardingFlow({
  open,
  onComplete,
  trialEndsAt,
  daysRemaining,
  workspaceId: initialWorkspaceId,
  defaultWorkspaceName,
  claimedTemplateId,
}: OnboardingFlowProps) {
  const { session, refreshUserData, userData } = useAuth();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("welcome");
  const [slideDirection, setSlideDirection] = useState<"left" | "right">("right");
  const [isAnimating, setIsAnimating] = useState(false);

  // Account setup state
  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [workspaceName, setWorkspaceName] = useState(defaultWorkspaceName || "");
  const [saving, setSaving] = useState(false);
  const [createdWorkspaceId, setCreatedWorkspaceId] = useState<string | null>(null);
  const [faviconLoaded, setFaviconLoaded] = useState(false);

  // Extract domain from websiteUrl for favicon
  const extractDomain = (url: string): string | null => {
    try {
      let normalized = url.trim();
      if (!normalized) return null;
      if (!/^https?:\/\//i.test(normalized)) normalized = "https://" + normalized;
      const hostname = new URL(normalized).hostname;
      return hostname && hostname.includes(".") ? hostname : null;
    } catch {
      return null;
    }
  };

  const faviconDomain = extractDomain(websiteUrl);
  const faviconUrl = faviconDomain
    ? `https://www.google.com/s2/favicons?domain=${faviconDomain}&sz=32`
    : null;

  // Design preferences
  const [defaultLanguage, setDefaultLanguage] = useState('en');
  const [designStyle, setDesignStyle] = useState('corporate');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [secondaryColor, setSecondaryColor] = useState('#8b5cf6');
  const [colorUsage, setColorUsage] = useState<'accent' | 'consistent'>('accent');

  // Template creation state
  const [creating, setCreating] = useState(false);
  const [includeCompanyKnowledge, setIncludeCompanyKnowledge] = useState(true);

  // File upload state for account setup
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentTitle, setDocumentTitle] = useState("");
  const [pendingFiles, setPendingFiles] = useState<Array<{ file: File; title: string }>>([]);

  // Asset library state for create template step
  const [pendingAssets, setPendingAssets] = useState<PendingAsset[]>([]);
  const [assetTab, setAssetTab] = useState<AssetTab>("upload");
  const [uploadName, setUploadName] = useState("");
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [researchTopic, setResearchTopic] = useState("");
  const [researchContext, setResearchContext] = useState("");
  const [researchSources, setResearchSources] = useState("");
  const [researchDepth, setResearchDepth] = useState<'quick' | 'comprehensive'>('comprehensive');
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);

  const workspaceId = createdWorkspaceId || initialWorkspaceId;

  const goToStep = (step: OnboardingStep) => {
    setSlideDirection("right");
    setIsAnimating(true);
    setTimeout(() => {
      setCurrentStep(step);
      setIsAnimating(false);
    }, 150);
  };

  const handleFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size must be less than 10MB");
      return;
    }
    setSelectedFile(file);
    setDocumentTitle(file.name.replace(/\.[^/.]+$/, ''));
  };

  const addPendingFile = () => {
    if (!selectedFile) return;
    setPendingFiles(prev => [...prev, { file: selectedFile, title: documentTitle || selectedFile.name }]);
    setSelectedFile(null);
    setDocumentTitle("");
  };

  // Asset library helpers for create template step
  const handleAssetFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAssetFile(files[0]);
    if (!uploadName) {
      setUploadName(files[0].name.replace(/\.[^/.]+$/, ''));
    }
  };

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
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleAssetFileSelect(files);
    }
  };

  const addFileAsset = () => {
    if (!assetFile) return;
    setPendingAssets(prev => [...prev, {
      id: crypto.randomUUID(),
      type: 'file',
      name: uploadName || assetFile.name.replace(/\.[^/.]+$/, ''),
      file: assetFile,
    }]);
    setAssetFile(null);
    setUploadName("");
  };

  const addResearchAsset = () => {
    if (!researchTopic.trim()) return;
    setPendingAssets(prev => [...prev, {
      id: crypto.randomUUID(),
      type: 'research',
      name: researchTopic.trim(),
      researchTopic: researchTopic.trim(),
      researchContext: researchContext.trim(),
      researchSources: researchSources.trim(),
      researchDepth,
    }]);
    setResearchTopic("");
    setResearchContext("");
    setResearchSources("");
    setResearchDepth('comprehensive');
  };

  const addNoteAsset = () => {
    if (!noteContent.trim()) return;
    setPendingAssets(prev => [...prev, {
      id: crypto.randomUUID(),
      type: 'note',
      name: noteTitle.trim() || 'Untitled Note',
      noteContent: noteContent.trim(),
    }]);
    setNoteTitle("");
    setNoteContent("");
  };

  const removeAsset = (id: string) => {
    setPendingAssets(prev => prev.filter(a => a.id !== id));
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        stream.getTracks().forEach(track => track.stop());

        try {
          const apiUrl = import.meta.env.VITE_API_URL ?? '';
          const formData = new FormData();
          formData.append('audio', blob, 'recording.webm');

          const response = await fetch(`${apiUrl}/api/transcribe`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session?.access_token}`,
            },
            body: formData,
          });

          if (response.ok) {
            const data = await response.json();
            if (data.text) {
              setNoteContent(prev => prev ? prev + ' ' + data.text : data.text);
            }
          }
        } catch (error) {
          console.error('Transcription error:', error);
          toast.error('Could not transcribe audio');
        }
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch (error) {
      console.error('Recording error:', error);
      toast.error('Please allow microphone access');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      setIsRecording(false);
      setMediaRecorder(null);
    }
  };

  const handleAccountSetup = async () => {
    if (!companyName.trim() || !websiteUrl.trim() || !workspaceName.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }

    setSaving(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      let normalizedUrl = websiteUrl.trim();
      if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
        normalizedUrl = 'https://' + normalizedUrl;
      }

      const response = await fetch(`${apiUrl}/api/account-setup/complete`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          company_name: companyName.trim(),
          website_url: normalizedUrl,
          workspace_id: workspaceId || undefined,
          workspace_name: workspaceName.trim(),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const newWorkspaceId = data.workspace_id || workspaceId;
        setCreatedWorkspaceId(newWorkspaceId);

        // Scrape website in background
        if (newWorkspaceId) {
          fetch(`${apiUrl}/api/workspaces/${newWorkspaceId}/company-assets/url`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({ url: normalizedUrl, title: `${companyName.trim()} Website` }),
          }).catch(console.error);

          // Upload pending files to Company Knowledge (fire and forget)
          for (const { file, title } of pendingFiles) {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('title', title);
            formData.append('type', 'company_doc');
            fetch(`${apiUrl}/api/workspaces/${newWorkspaceId}/company-assets/upload`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${session?.access_token}` },
              body: formData,
            }).catch(console.error);
          }

          // Save design preferences including color usage
          fetch(`${apiUrl}/api/workspaces/${newWorkspaceId}/settings/brand-theme`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${session?.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ brand_theme: { theme, secondary_color: secondaryColor, color_usage: colorUsage } }),
          }).catch(console.error);

          fetch(`${apiUrl}/api/workspaces/${newWorkspaceId}/design-preferences`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${session?.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ design_style: designStyle, default_language: defaultLanguage }),
          }).catch(console.error);
        }

        refreshUserData();

        // Check if user has a claimed template from free tool
        if (claimedTemplateId) {
          // Skip create_template step - user already has a template
          localStorage.removeItem('assetly_claimed_template_id');
          localStorage.removeItem('assetly_claimed_workspace_id');
          onComplete(claimedTemplateId);
          navigate(`/templates/${claimedTemplateId}/edit`);
        } else {
          goToStep("create_template");
        }
      } else {
        throw new Error("Failed to save account setup");
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to save account setup");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateTemplate = async () => {
    const wsId = createdWorkspaceId || workspaceId || userData?.workspace?.id;
    if (!wsId || !session?.access_token) return;

    setCreating(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";

      const response = await fetch(`${apiUrl}/api/workspaces/${wsId}/templates`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "My First Template",
          source: "ai_writer",
        }),
      });

      if (!response.ok) throw new Error("Failed to create template");

      const data = await response.json();
      const templateId = data.template.id;

      // Save useCompanyKnowledge setting (fire and forget)
      if (includeCompanyKnowledge) {
        fetch(`${apiUrl}/api/templates/${templateId}/settings`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ ai_writer_context: { useCompanyKnowledge: true } }),
        }).catch(console.error);
      }

      // Upload assets to the template (fire and forget - don't block navigation)
      for (const asset of pendingAssets) {
        if (asset.type === 'file' && asset.file) {
          const formData = new FormData();
          formData.append('file', asset.file);
          formData.append('title', asset.name);
          formData.append('type', 'document');

          fetch(`${apiUrl}/api/templates/${templateId}/asset-library/upload`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: formData,
          }).catch(console.error);
        } else if (asset.type === 'research') {
          fetch(`${apiUrl}/api/templates/${templateId}/research/create`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              topic: asset.researchTopic,
              depth: asset.researchDepth,
              userSources: asset.researchSources || undefined,
              context: asset.researchContext || undefined,
            }),
          }).catch(console.error);
        } else if (asset.type === 'note') {
          fetch(`${apiUrl}/api/templates/${templateId}/asset-library/notes`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              title: asset.name,
              content: asset.noteContent,
            }),
          }).catch(console.error);
        }
      }

      // Complete onboarding (fire and forget)
      fetch(`${apiUrl}/api/onboarding/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ template_id: templateId }),
      }).catch(console.error);

      toast.success("Template created! Start chatting with your AI assistant.");
      onComplete(templateId);
      navigate(`/templates/${templateId}/edit`);
    } catch (error: any) {
      toast.error(error.message || "Failed to create template");
    } finally {
      setCreating(false);
    }
  };

  const stepIndicator = (
    <div className="flex items-center justify-center mb-6">
      <div className="flex items-center gap-1.5">
        {["welcome", "founder_letter", "account_setup", "create_template"].map((step, i) => (
          <div
            key={step}
            className={cn(
              "w-1.5 h-1.5 rounded-full transition-colors",
              currentStep === step ? "bg-gray-900" : "bg-gray-300"
            )}
          />
        ))}
      </div>
    </div>
  );

  const renderStep = () => {
    switch (currentStep) {
      case "welcome":
        return (
          <div className="text-center space-y-6">
            {stepIndicator}
            <div className="mb-6">
              <img src="/newlogoP.png" alt="Assetly" className="h-12 w-auto mx-auto" />
            </div>
            <h2 className="text-[26px] font-semibold text-gray-900 tracking-[-0.02em]">
              Welcome to Assetly
            </h2>
            <p className="text-[15px] text-gray-500 leading-relaxed max-w-[380px] mx-auto">
              Start your 7-day free trial. No credit card required.
            </p>

            {/* Features Grid */}
            <div className="w-full grid grid-cols-2 gap-2.5">
              {WELCOME_FEATURES.map(({ label, icon: Icon }) => (
                <div
                  key={label}
                  className="flex items-center gap-2.5 p-3 rounded-[10px] border border-gray-100 bg-gray-50/50 text-left"
                >
                  <div className="w-7 h-7 rounded-[8px] bg-white border border-gray-100 flex items-center justify-center flex-shrink-0 shadow-sm">
                    <Icon className="w-3.5 h-3.5 text-gray-500" />
                  </div>
                  <span className="text-[13px] text-gray-700 font-medium">{label}</span>
                </div>
              ))}
            </div>

            <Button
              onClick={() => goToStep("founder_letter")}
              className="w-full h-12 bg-gray-900 hover:bg-gray-800 text-white rounded-[12px] text-[15px]"
            >
              Get Started
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        );

      case "founder_letter":
        const firstName = userData?.user?.name?.split(' ')[0] || 'there';
        return (
          <div className="space-y-6">
            {stepIndicator}

            {/* Founder Profile */}
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full overflow-hidden ring-1 ring-gray-100">
                <img src="/Design ohne Titel (27).png" alt="Bennet" className="w-full h-full object-cover" />
              </div>
              <div>
                <p className="text-[15px] font-semibold text-gray-900">Bennet Glinder</p>
                <p className="text-[13px] text-gray-500">Founder</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => window.open("https://www.linkedin.com/in/bennet-glinder99/", "_blank")}
                className="ml-auto h-9 w-9 rounded-full hover:bg-gray-50 transition-colors"
                title="Connect on LinkedIn"
              >
                <Linkedin className="h-4 w-4 text-[#0077b5]" />
              </Button>
            </div>

            {/* Letter Content */}
            <div className="space-y-5 text-[15px] leading-[1.6] text-gray-600">
              <p className="text-gray-900 font-medium text-[17px]">
                Hey {firstName},
              </p>

              <p>
                Welcome — we built Assetly to automate document creation so you can produce professional, personalized documents without a designer.
              </p>

              <p>
                In the next few steps, we'll help you:
              </p>

              <div className="space-y-2.5">
                <div className="flex items-start gap-3 p-3 rounded-[10px] border border-gray-100 bg-gray-50/50">
                  <div className="w-7 h-7 rounded-[8px] bg-white border border-gray-100 flex items-center justify-center flex-shrink-0 shadow-sm mt-0.5">
                    <Building2 className="w-3.5 h-3.5 text-gray-500" />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-gray-900">Set up your company knowledge</p>
                    <p className="text-[12px] text-gray-500 leading-relaxed">Your brand, design preferences, and key info that Assetly uses to generate content tailored to your business.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-[10px] border border-gray-100 bg-gray-50/50">
                  <div className="w-7 h-7 rounded-[8px] bg-white border border-gray-100 flex items-center justify-center flex-shrink-0 shadow-sm mt-0.5">
                    <LayoutTemplate className="w-3.5 h-3.5 text-gray-500" />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-gray-900">Create your first template</p>
                    <p className="text-[12px] text-gray-500 leading-relaxed">A reusable document layout you can customize and plug into automated workflows.</p>
                  </div>
                </div>
              </div>

              <p>
                Once set up, you can use templates inside document creation workflows — pick from your template gallery, connect data sources, and generate documents at scale.
              </p>

              <p>
                You have a 7-day free trial. If you need help, feel free to message me anytime.
              </p>

              <p className="pt-1 text-gray-900 font-medium">
                Best,<br />
                Bennet
              </p>
            </div>

            <Button
              onClick={() => goToStep("account_setup")}
              className="w-full h-12 bg-gray-900 hover:bg-gray-800 text-white rounded-[12px] text-[15px]"
            >
              Continue
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        );

      case "account_setup":
        return (
          <div className="space-y-4">
            {stepIndicator}
            <div className="text-center mb-2">
              <h2 className="text-[22px] font-semibold text-gray-900 tracking-[-0.02em] mb-1">
                Set up your account
              </h2>
              <p className="text-[13px] text-gray-500">Tell us about your company</p>
            </div>

            <div className="space-y-3">
              {/* Company Name, Website URL, and Workspace Name in a row */}
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium text-gray-600">Company Name *</Label>
                  <Input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Acme Inc."
                    className="h-9 rounded-[8px] text-[13px]"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium text-gray-600">Website URL *</Label>
                  <div className="relative">
                    <div className="absolute left-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-4 h-4">
                      {faviconUrl && faviconLoaded ? (
                        <img
                          src={faviconUrl}
                          alt=""
                          className="w-4 h-4 rounded-sm object-contain"
                        />
                      ) : (
                        <Globe className="w-3.5 h-3.5 text-gray-400" />
                      )}
                      {faviconUrl && (
                        <img
                          src={faviconUrl}
                          alt=""
                          className="hidden"
                          onLoad={() => setFaviconLoaded(true)}
                          onError={() => setFaviconLoaded(false)}
                        />
                      )}
                    </div>
                    <Input
                      value={websiteUrl}
                      onChange={(e) => {
                        setWebsiteUrl(e.target.value);
                        setFaviconLoaded(false);
                      }}
                      placeholder="www.acme.com"
                      className="h-9 rounded-[8px] text-[13px] pl-8"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium text-gray-600">Workspace *</Label>
                  <Input
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    placeholder="Marketing Team"
                    className="h-9 rounded-[8px] text-[13px]"
                  />
                </div>
              </div>

              {/* Language, Document Style, Theme, and Brand Color in a row */}
              <div className="grid grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium text-gray-600">Language</Label>
                  <Select value={defaultLanguage} onValueChange={setDefaultLanguage}>
                    <SelectTrigger className="h-9 rounded-[8px] text-[12px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="de">German</SelectItem>
                      <SelectItem value="fr">French</SelectItem>
                      <SelectItem value="es">Spanish</SelectItem>
                      <SelectItem value="it">Italian</SelectItem>
                      <SelectItem value="pt">Portuguese</SelectItem>
                      <SelectItem value="nl">Dutch</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium text-gray-600">Style</Label>
                  <Select value={designStyle} onValueChange={setDesignStyle}>
                    <SelectTrigger className="h-9 rounded-[8px] text-[12px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DESIGN_STYLES.map((style) => (
                        <SelectItem key={style.value} value={style.value}>
                          {style.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium text-gray-600">Theme</Label>
                  <Select value={theme} onValueChange={(v) => setTheme(v as 'light' | 'dark')}>
                    <SelectTrigger className="h-9 rounded-[8px] text-[12px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium text-gray-600">Brand Color</Label>
                  <div className="flex items-center gap-1.5">
                    <div className="relative">
                      <input
                        type="color"
                        value={secondaryColor}
                        onChange={(e) => setSecondaryColor(e.target.value)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div
                        className="w-9 h-9 rounded-[8px] border border-gray-200 cursor-pointer"
                        style={{ backgroundColor: secondaryColor }}
                      />
                    </div>
                    <Input
                      value={secondaryColor}
                      onChange={(e) => setSecondaryColor(e.target.value)}
                      className="h-9 rounded-[8px] text-[11px] font-mono flex-1"
                    />
                  </div>
                </div>
              </div>

              {/* Color Usage */}
              <div className="flex items-center gap-2 pt-1">
                <Label className="text-[11px] font-medium text-gray-600 whitespace-nowrap">Color usage:</Label>
                <div className="flex gap-1.5 flex-1">
                  <button
                    onClick={() => setColorUsage('accent')}
                    className={cn(
                      "flex-1 py-2 px-3 rounded-[8px] border text-[12px] transition-all",
                      colorUsage === 'accent'
                        ? "border-gray-900 bg-gray-50 font-medium"
                        : "border-gray-200 hover:border-gray-300"
                    )}
                  >
                    Accent only
                  </button>
                  <button
                    onClick={() => setColorUsage('consistent')}
                    className={cn(
                      "flex-1 py-2 px-3 rounded-[8px] border text-[12px] transition-all",
                      colorUsage === 'consistent'
                        ? "border-gray-900 bg-gray-50 font-medium"
                        : "border-gray-200 hover:border-gray-300"
                    )}
                  >
                    Consistent theme
                  </button>
                </div>
              </div>

              {/* Company Knowledge File Upload */}
              <div className="pt-3 border-t border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Upload className="h-3.5 w-3.5 text-gray-400" />
                    <span className="text-[11px] font-medium text-gray-600">Company Knowledge</span>
                  </div>
                  <span className="text-[10px] text-gray-400">Optional</span>
                </div>
                <div className="flex gap-2">
                  <div
                    className="flex-1 border border-dashed border-gray-200 rounded-[8px] p-2 text-center cursor-pointer hover:border-gray-300 transition-all"
                    onClick={() => document.getElementById('setup-file-input')?.click()}
                  >
                    <input
                      id="setup-file-input"
                      type="file"
                      accept=".pdf,.doc,.docx,.txt"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setSelectedFile(file);
                          setDocumentTitle(file.name.replace(/\.[^/.]+$/, ''));
                        }
                      }}
                      className="hidden"
                    />
                    <p className="text-[11px] text-gray-500">Click to upload</p>
                  </div>
                  {selectedFile && (
                    <>
                      <Input
                        value={documentTitle}
                        onChange={(e) => setDocumentTitle(e.target.value)}
                        placeholder="Title"
                        className="w-32 h-9 rounded-[8px] text-[12px]"
                      />
                      <Button
                        onClick={() => {
                          if (selectedFile) {
                            setPendingFiles(prev => [...prev, { file: selectedFile, title: documentTitle || selectedFile.name }]);
                            setSelectedFile(null);
                            setDocumentTitle("");
                          }
                        }}
                        size="sm"
                        className="h-9 px-3 bg-gray-900 hover:bg-gray-800 text-white rounded-[8px] text-[11px]"
                      >
                        Add
                      </Button>
                    </>
                  )}
                </div>
                {pendingFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {pendingFiles.map((f, idx) => (
                      <div key={idx} className="flex items-center gap-1 px-2 py-1 rounded-[6px] border border-gray-200 bg-gray-50 text-[11px]">
                        <FileText className="h-3 w-3 text-gray-400" />
                        <span className="text-gray-700 truncate max-w-[100px]">{f.title}</span>
                        <button
                          onClick={() => setPendingFiles(prev => prev.filter((_, i) => i !== idx))}
                          className="text-gray-400 hover:text-red-500"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <Button
              onClick={handleAccountSetup}
              disabled={saving || !companyName.trim() || !websiteUrl.trim() || !workspaceName.trim()}
              className="w-full h-12 bg-gray-900 hover:bg-gray-800 text-white rounded-[12px] text-[15px]"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Continue
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        );

      case "create_template":
        return (
          <div className="space-y-5">
            {stepIndicator}
            <div className="text-center">
              <h2 className="text-[24px] font-semibold text-gray-900 tracking-[-0.02em] mb-2">
                Let's create your first template
              </h2>
              <p className="text-[14px] text-gray-500 max-w-[360px] mx-auto">
                Add resources to your Asset Library to give the AI context. You can skip this if you already uploaded to Company Knowledge.
              </p>
            </div>

            {/* Knowledge Types Explanation */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-[10px] border border-gray-200 bg-gray-50/50">
                <div className="flex items-center gap-2 mb-1.5">
                  <Building2 className="h-4 w-4 text-blue-600" />
                  <span className="text-[12px] font-semibold text-gray-900">Company Knowledge</span>
                </div>
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  Shared across all templates in your workspace. Add brand guidelines, company info, etc.
                </p>
              </div>
              <div className="p-3 rounded-[10px] border border-gray-200 bg-gray-50/50">
                <div className="flex items-center gap-2 mb-1.5">
                  <FolderOpen className="h-4 w-4 text-purple-600" />
                  <span className="text-[12px] font-semibold text-gray-900">Asset Library</span>
                </div>
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  Specific to this template. Add project docs, client info, research for this document.
                </p>
              </div>
            </div>

            {/* Include Company Knowledge checkbox */}
            <label className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-100 rounded-[10px] cursor-pointer hover:bg-blue-100/70 transition-colors">
              <input
                type="checkbox"
                checked={includeCompanyKnowledge}
                onChange={(e) => setIncludeCompanyKnowledge(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <p className="text-[13px] font-medium text-gray-900">Include Company Knowledge</p>
                <p className="text-[11px] text-gray-500">Use your workspace's shared knowledge base as context</p>
              </div>
            </label>

            {/* Asset Library Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-medium text-gray-700">Asset Library</p>
                <p className="text-[11px] text-gray-400">Optional</p>
              </div>

              {/* Tab Selector */}
              <div className="flex gap-1 p-1 bg-gray-100 rounded-[10px]">
                <button
                  onClick={() => setAssetTab('upload')}
                  className={cn(
                    "flex-1 py-2 px-3 text-[13px] font-medium rounded-[8px] transition-all flex items-center justify-center gap-1.5",
                    assetTab === 'upload'
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload
                </button>
                <button
                  onClick={() => setAssetTab('research')}
                  className={cn(
                    "flex-1 py-2 px-3 text-[13px] font-medium rounded-[8px] transition-all flex items-center justify-center gap-1.5",
                    assetTab === 'research'
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  <Search className="h-3.5 w-3.5" />
                  Research
                </button>
                <button
                  onClick={() => setAssetTab('notes')}
                  className={cn(
                    "flex-1 py-2 px-3 text-[13px] font-medium rounded-[8px] transition-all flex items-center justify-center gap-1.5",
                    assetTab === 'notes'
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  <FileText className="h-3.5 w-3.5" />
                  Notes
                </button>
              </div>

              {/* Upload Tab */}
              {assetTab === 'upload' && (
                <div className="space-y-3">
                  <Input
                    value={uploadName}
                    onChange={(e) => setUploadName(e.target.value)}
                    placeholder="Name"
                    className="h-10 border-gray-200 focus:border-gray-900 focus:ring-gray-900 rounded-[8px] text-[14px]"
                  />
                  <div
                    className={cn(
                      "border-2 border-dashed rounded-[12px] p-5 text-center cursor-pointer transition-all",
                      dragActive
                        ? "border-gray-400 bg-gray-50"
                        : "border-gray-200 hover:border-gray-300"
                    )}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => document.getElementById('modal-file-input')?.click()}
                  >
                    <input
                      id="modal-file-input"
                      type="file"
                      accept=".pdf,.doc,.docx,.txt"
                      onChange={(e) => handleAssetFileSelect(e.target.files)}
                      className="hidden"
                    />
                    <Upload className="h-7 w-7 mx-auto mb-2 text-gray-400" />
                    <p className="text-[13px] text-gray-500">
                      {assetFile ? assetFile.name : "Drop files or click to upload"}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-1">PDF, DOC, DOCX, TXT</p>
                  </div>
                  {assetFile && (
                    <Button
                      onClick={addFileAsset}
                      className="w-full h-9 bg-gray-900 hover:bg-gray-800 text-white rounded-[8px] text-[13px]"
                    >
                      Add File
                    </Button>
                  )}
                </div>
              )}

              {/* Research Tab */}
              {assetTab === 'research' && (
                <div className="space-y-3">
                  <Input
                    value={researchTopic}
                    onChange={(e) => setResearchTopic(e.target.value)}
                    placeholder="Research topic..."
                    className="h-10 border-gray-200 focus:border-gray-900 focus:ring-gray-900 rounded-[8px] text-[14px]"
                  />
                  <textarea
                    value={researchContext}
                    onChange={(e) => setResearchContext(e.target.value)}
                    placeholder="Additional context or details..."
                    rows={2}
                    className="w-full px-3 py-2 text-[14px] bg-white border border-gray-200 rounded-[8px] focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 resize-none"
                  />
                  <div className="relative">
                    <Link className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      value={researchSources}
                      onChange={(e) => setResearchSources(e.target.value)}
                      placeholder="Sources (URLs, comma separated)"
                      className="h-10 pl-9 border-gray-200 focus:border-gray-900 focus:ring-gray-900 rounded-[8px] text-[14px]"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setResearchDepth('quick')}
                      className={cn(
                        "flex-1 py-2 text-[13px] rounded-[8px] border transition-all",
                        researchDepth === 'quick'
                          ? "bg-gray-900 border-gray-900 text-white"
                          : "border-gray-200 text-gray-600 hover:border-gray-300"
                      )}
                    >
                      Quick
                    </button>
                    <button
                      onClick={() => setResearchDepth('comprehensive')}
                      className={cn(
                        "flex-1 py-2 text-[13px] rounded-[8px] border transition-all",
                        researchDepth === 'comprehensive'
                          ? "bg-gray-900 border-gray-900 text-white"
                          : "border-gray-200 text-gray-600 hover:border-gray-300"
                      )}
                    >
                      Detailed
                    </button>
                  </div>
                  <Button
                    onClick={addResearchAsset}
                    disabled={!researchTopic.trim()}
                    className="w-full h-9 bg-gray-900 hover:bg-gray-800 text-white rounded-[8px] text-[13px] disabled:opacity-50"
                  >
                    Add Research
                  </Button>
                </div>
              )}

              {/* Notes Tab */}
              {assetTab === 'notes' && (
                <div className="space-y-3">
                  <Input
                    value={noteTitle}
                    onChange={(e) => setNoteTitle(e.target.value)}
                    placeholder="Title (optional)"
                    className="h-10 border-gray-200 focus:border-gray-900 focus:ring-gray-900 rounded-[8px] text-[14px]"
                  />
                  <div className="relative">
                    <textarea
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      placeholder="Write your note or dictate..."
                      rows={3}
                      className="w-full px-3 py-2 pr-10 text-[14px] bg-white border border-gray-200 rounded-[8px] focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900 resize-none"
                    />
                    <button
                      onClick={() => isRecording ? stopRecording() : startRecording()}
                      className={cn(
                        "absolute right-2 top-2 p-1.5 rounded-[6px] transition-all",
                        isRecording
                          ? "bg-red-100 text-red-600 animate-pulse"
                          : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                      )}
                    >
                      {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    </button>
                  </div>
                  {isRecording && (
                    <div className="flex items-center gap-1.5 text-[12px] text-red-600">
                      <span className="h-2 w-2 bg-red-500 rounded-full animate-pulse" />
                      Recording... Click mic to stop
                    </div>
                  )}
                  <Button
                    onClick={addNoteAsset}
                    disabled={!noteContent.trim() || isRecording}
                    className="w-full h-9 bg-gray-900 hover:bg-gray-800 text-white rounded-[8px] text-[13px] disabled:opacity-50"
                  >
                    Add Note
                  </Button>
                </div>
              )}

              {/* Pending Assets List */}
              {pendingAssets.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide">Added ({pendingAssets.length})</p>
                  <div className="space-y-1.5 max-h-[100px] overflow-y-auto">
                    {pendingAssets.map((asset) => (
                      <div
                        key={asset.id}
                        className="flex items-center gap-2 p-2 rounded-[8px] border border-gray-200 bg-gray-50"
                      >
                        {asset.type === 'file' && <FileText className="h-4 w-4 text-gray-400" />}
                        {asset.type === 'research' && <Search className="h-4 w-4 text-purple-500" />}
                        {asset.type === 'note' && <FileText className="h-4 w-4 text-amber-500" />}
                        <span className="text-[13px] text-gray-700 truncate flex-1">{asset.name}</span>
                        <button
                          onClick={() => removeAsset(asset.id)}
                          className="p-0.5 text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Button
              onClick={handleCreateTemplate}
              disabled={creating}
              className="w-full h-12 bg-gray-900 hover:bg-gray-800 text-white rounded-[12px] text-[15px]"
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {pendingAssets.length > 0 ? "Create Template" : "Skip & Create Template"}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-[480px] p-0 border-none shadow-[0_0_60px_-15px_rgba(0,0,0,0.15)] bg-white rounded-[24px] overflow-hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        hideCloseButton={true}
      >
        <div
          className={cn(
            "px-8 py-8 transition-all duration-150 ease-out",
            isAnimating && slideDirection === "right" && "opacity-0 translate-x-4",
            !isAnimating && "opacity-100 translate-x-0"
          )}
        >
          {renderStep()}
        </div>
      </DialogContent>
    </Dialog>
  );
}

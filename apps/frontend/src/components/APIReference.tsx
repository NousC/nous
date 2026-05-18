import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Search, ExternalLink, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";

interface Endpoint {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  title: string;
  description: string;
  category: string;
  sectionId: string;
}

const endpoints: Endpoint[] = [
  // Agent
  {
    method: "POST",
    path: "/api/agent",
    title: "Agent",
    description: "Send a message to the Nous agent. It creates proposals, sends for signing, manages contacts — all from one endpoint.",
    category: "Agent",
    sectionId: "agent",
  },
  // Documents
  {
    method: "GET",
    path: "/api/documents",
    title: "List Documents",
    description: "Retrieve documents from your workspace with filtering and pagination.",
    category: "Documents",
    sectionId: "documents",
  },
  {
    method: "GET",
    path: "/api/documents/:id",
    title: "Get Document",
    description: "Retrieve a single document with full details.",
    category: "Documents",
    sectionId: "documents",
  },
  {
    method: "POST",
    path: "/api/documents/:id/export/pdf",
    title: "Export PDF",
    description: "Generate a PDF for a document and get a download URL.",
    category: "Documents",
    sectionId: "documents",
  },
  {
    method: "POST",
    path: "/api/documents/:id/share-link",
    title: "Create Share Link",
    description: "Create a public share link for a document.",
    category: "Documents",
    sectionId: "documents",
  },
  {
    method: "PATCH",
    path: "/api/documents/:id",
    title: "Update Document",
    description: "Update variable values or metadata for an existing document.",
    category: "Documents",
    sectionId: "documents",
  },
  {
    method: "DELETE",
    path: "/api/documents/:id",
    title: "Delete Document",
    description: "Delete a document and its associated PDF.",
    category: "Documents",
    sectionId: "documents",
  },
  // Templates
  {
    method: "GET",
    path: "/api/templates",
    title: "List Templates",
    description: "Retrieve all templates available in your workspace.",
    category: "Templates",
    sectionId: "templates",
  },
  {
    method: "GET",
    path: "/api/templates/:id",
    title: "Get Template",
    description: "Retrieve a specific template with its blocks and variables.",
    category: "Templates",
    sectionId: "templates",
  },
  {
    method: "GET",
    path: "/api/templates/:id/variables",
    title: "Template Variables",
    description: "Get the variable schema for a template.",
    category: "Templates",
    sectionId: "templates",
  },
  // Contacts
  {
    method: "GET",
    path: "/api/contacts",
    title: "List Contacts",
    description: "Retrieve all contacts from your workspace.",
    category: "Contacts",
    sectionId: "contacts",
  },
  {
    method: "GET",
    path: "/api/contacts/:id",
    title: "Get Contact",
    description: "Retrieve a specific contact by ID.",
    category: "Contacts",
    sectionId: "contacts",
  },
  {
    method: "POST",
    path: "/api/contacts",
    title: "Create Contact",
    description: "Add a new contact to your workspace.",
    category: "Contacts",
    sectionId: "contacts",
  },
  {
    method: "PATCH",
    path: "/api/contacts/:id",
    title: "Update Contact",
    description: "Update contact information.",
    category: "Contacts",
    sectionId: "contacts",
  },
  {
    method: "DELETE",
    path: "/api/contacts/:id",
    title: "Delete Contact",
    description: "Delete a contact from your workspace.",
    category: "Contacts",
    sectionId: "contacts",
  },
  // Signing
  {
    method: "GET",
    path: "/api/documents/:id/signing/status",
    title: "Get Signing Status",
    description: "Get the current signing status and signer details for a document.",
    category: "Signing",
    sectionId: "signing",
  },
];

const getMethodBadgeVariant = (method: string) => {
  switch (method) {
    case "GET":
      return "outline";
    case "POST":
      return "default";
    case "PATCH":
      return "outline";
    case "DELETE":
      return "destructive";
    default:
      return "outline";
  }
};

const getMethodColor = (method: string) => {
  switch (method) {
    case "POST":
      return "bg-green-600";
    case "DELETE":
      return "bg-red-600";
    default:
      return "";
  }
};

interface APIReferenceProps {
  onNavigateToSection?: (sectionId: string) => void;
}

export function APIReference({ onNavigateToSection }: APIReferenceProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedMethod, setSelectedMethod] = useState<string>("all");

  const categories = Array.from(new Set(endpoints.map((e) => e.category)));
  const methods = Array.from(new Set(endpoints.map((e) => e.method)));

  const filteredEndpoints = endpoints.filter((endpoint) => {
    const matchesSearch =
      endpoint.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      endpoint.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
      endpoint.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "all" || endpoint.category === selectedCategory;
    const matchesMethod = selectedMethod === "all" || endpoint.method === selectedMethod;
    return matchesSearch && matchesCategory && matchesMethod;
  });

  const scrollToSection = (sectionId: string) => {
    if (onNavigateToSection) {
      onNavigateToSection(sectionId);
    } else {
      // Fallback: try to scroll directly
      const element = document.getElementById(sectionId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
        window.history.pushState(null, "", `#${sectionId}`);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search endpoints..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category} value={category}>
                {category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={selectedMethod} onValueChange={setSelectedMethod}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="All Methods" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Methods</SelectItem>
            {methods.map((method) => (
              <SelectItem key={method} value={method}>
                {method}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Results Count */}
      <div className="text-sm text-muted-foreground">
        Showing {filteredEndpoints.length} of {endpoints.length} endpoints
      </div>

      {/* Endpoints Table */}
      <div className="space-y-2">
        {filteredEndpoints.map((endpoint) => {
          const apiUrl = import.meta.env.VITE_API_URL ?? "";
          const fullEndpoint = `${apiUrl}${endpoint.path}`;
          
          const copyEndpoint = (e: React.MouseEvent) => {
            e.stopPropagation();
            navigator.clipboard.writeText(fullEndpoint);
            toast.success("Endpoint copied to clipboard");
          };

          return (
            <Card
              key={`${endpoint.method}-${endpoint.path}`}
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => scrollToSection(endpoint.sectionId)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <Badge
                        variant={getMethodBadgeVariant(endpoint.method)}
                        className={`font-mono ${getMethodColor(endpoint.method)}`}
                      >
                        {endpoint.method}
                      </Badge>
                      <code className="text-sm font-mono text-foreground break-all">
                        {endpoint.path}
                      </code>
                    </div>
                    <h3 className="font-semibold text-base mb-1">{endpoint.title}</h3>
                    <p className="text-sm text-muted-foreground">{endpoint.description}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant="secondary" className="text-xs">
                      {endpoint.category}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={copyEndpoint}
                      title="Copy endpoint"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        scrollToSection(endpoint.sectionId);
                      }}
                      title="View documentation"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredEndpoints.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>No endpoints found matching your search criteria.</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => {
              setSearchQuery("");
              setSelectedCategory("all");
              setSelectedMethod("all");
            }}
          >
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}


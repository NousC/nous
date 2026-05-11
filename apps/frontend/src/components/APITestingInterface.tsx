import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/ui/sonner";
import { Copy, Send } from "lucide-react";

const endpoints = [
  { value: "GET /api/templates", method: "GET", path: "/api/templates", needsId: false },
  { value: "GET /api/templates/:id", method: "GET", path: "/api/templates", needsId: true },
  { value: "GET /api/templates/:id/variables", method: "GET", path: "/api/templates", needsId: true, suffix: "/variables" },
  { value: "POST /api/documents", method: "POST", path: "/api/documents", needsId: false },
  { value: "PATCH /api/documents/:id", method: "PATCH", path: "/api/documents", needsId: true },
  { value: "GET /api/documents", method: "GET", path: "/api/documents", needsId: false },
  { value: "GET /api/documents/:id", method: "GET", path: "/api/documents", needsId: true },
  { value: "DELETE /api/documents/:id", method: "DELETE", path: "/api/documents", needsId: true },
  { value: "POST /api/documents/:id/export/pdf", method: "POST", path: "/api/documents", needsId: true, suffix: "/export/pdf" },
  { value: "POST /api/documents/:id/share-link", method: "POST", path: "/api/documents", needsId: true, suffix: "/share-link" },
];

export function APITestingInterface() {
  const [selectedEndpoint, setSelectedEndpoint] = useState(endpoints[0].value);
  const [resourceId, setResourceId] = useState("");
  const [queryParams, setQueryParams] = useState("");
  const [requestBody, setRequestBody] = useState("{}");
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { session } = useAuth();

  const currentEndpoint = endpoints.find(e => e.value === selectedEndpoint);

  const handleSendRequest = async () => {
    if (!session?.access_token) {
      toast.error("Please log in to use the API testing interface");
      return;
    }

    if (currentEndpoint?.needsId && !resourceId) {
      toast.error("Resource ID is required for this endpoint");
      return;
    }

    setLoading(true);
    setResponse(null);

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      let url = `${apiUrl}${currentEndpoint?.path}`;
      
      if (currentEndpoint?.needsId && resourceId) {
        url += `/${resourceId}`;
      }
      
      if (currentEndpoint?.suffix) {
        url += currentEndpoint.suffix;
      }

      if (queryParams && currentEndpoint?.method === "GET") {
        url += `?${queryParams}`;
      }

      const options: RequestInit = {
        method: currentEndpoint?.method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
      };

      if (currentEndpoint?.method !== "GET" && requestBody) {
        try {
          JSON.parse(requestBody);
          options.body = requestBody;
        } catch (e) {
          toast.error("Invalid JSON in request body");
          setLoading(false);
          return;
        }
      }

      const res = await fetch(url, options);
      const data = await res.json();

      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers: Object.fromEntries(res.headers.entries()),
        data,
      });
    } catch (error: any) {
      setResponse({
        error: error.message || "Request failed",
      });
      toast.error("Request failed");
    } finally {
      setLoading(false);
    }
  };

  const copyAsCurl = () => {
    if (!currentEndpoint || !session?.access_token) return;

    const apiUrl = import.meta.env.VITE_API_URL ?? "";
    let url = `${apiUrl}${currentEndpoint.path}`;
    
    if (currentEndpoint.needsId && resourceId) {
      url += `/${resourceId}`;
    }
    
    if (currentEndpoint.suffix) {
      url += currentEndpoint.suffix;
    }

    if (queryParams && currentEndpoint.method === "GET") {
      url += `?${queryParams}`;
    }

    let curl = `curl -X ${currentEndpoint.method} "${url}" \\\n`;
    curl += `  -H "Authorization: Bearer ${session.access_token}" \\\n`;
    curl += `  -H "Content-Type: application/json"`;

    if (currentEndpoint.method !== "GET" && requestBody) {
      curl += ` \\\n  -d '${requestBody}'`;
    }

    navigator.clipboard.writeText(curl);
    toast.success("cURL command copied to clipboard");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Test API Endpoints</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="endpoint">Endpoint</Label>
            <Select value={selectedEndpoint} onValueChange={setSelectedEndpoint}>
              <SelectTrigger id="endpoint">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {endpoints.map((endpoint) => (
                  <SelectItem key={endpoint.value} value={endpoint.value}>
                    {endpoint.value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {currentEndpoint?.needsId && (
            <div>
              <Label htmlFor="resourceId">Resource ID</Label>
              <Input
                id="resourceId"
                value={resourceId}
                onChange={(e) => setResourceId(e.target.value)}
                placeholder="Enter resource ID (UUID)"
              />
            </div>
          )}

          {currentEndpoint?.method === "GET" && (
            <div>
              <Label htmlFor="queryParams">Query Parameters</Label>
              <Input
                id="queryParams"
                value={queryParams}
                onChange={(e) => setQueryParams(e.target.value)}
                placeholder="limit=20&offset=0&type=proposal"
              />
            </div>
          )}

          {currentEndpoint?.method !== "GET" && (
            <div>
              <Label htmlFor="requestBody">Request Body (JSON)</Label>
              <Textarea
                id="requestBody"
                value={requestBody}
                onChange={(e) => setRequestBody(e.target.value)}
                rows={10}
                className="font-mono text-sm"
                placeholder='{"templateId": "uuid", "variables": {...}}'
              />
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={handleSendRequest} disabled={loading}>
              <Send className="h-4 w-4 mr-2" />
              {loading ? "Sending..." : "Send Request"}
            </Button>
            <Button variant="outline" onClick={copyAsCurl}>
              <Copy className="h-4 w-4 mr-2" />
              Copy as cURL
            </Button>
          </div>
        </CardContent>
      </Card>

      {response && (
        <Card>
          <CardHeader>
            <CardTitle>Response</CardTitle>
          </CardHeader>
          <CardContent>
            {response.error ? (
              <div className="bg-destructive/10 border border-destructive rounded-md p-4">
                <p className="text-destructive font-semibold">Error</p>
                <p className="text-sm text-destructive/80">{response.error}</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-semibold mb-1">Status:</p>
                  <Badge variant={response.status >= 400 ? "destructive" : "default"}>
            {response.status} {response.statusText}
          </Badge>
                </div>
                <div>
                  <p className="text-sm font-semibold mb-1">Response Data:</p>
                  <pre className="bg-muted p-4 rounded-md text-xs overflow-x-auto">
                    {JSON.stringify(response.data, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}


import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";

export function APICodeExamples() {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  // Helper to escape n8n template syntax in JSX
  const n8nTemplate = (expr: string) => `{{ ${expr} }}`;

  return (
    <Tabs defaultValue="curl" className="w-full">
      <TabsList className="mb-6">
        <TabsTrigger value="curl">cURL</TabsTrigger>
        <TabsTrigger value="javascript">JavaScript</TabsTrigger>
        <TabsTrigger value="python">Python</TabsTrigger>
        <TabsTrigger value="n8n">n8n</TabsTrigger>
      </TabsList>

      <TabsContent value="curl" className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Create Document</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => copyToClipboard(`curl -X POST "${import.meta.env.VITE_API_URL ?? ""}/api/documents" \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "templateId": "uuid",
    "variables": {
      "client_name": "Acme Corp",
      "project_title": "Website Redesign"
    }
  }'`)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-4 rounded-md text-xs overflow-x-auto">
{`curl -X POST "${import.meta.env.VITE_API_URL ?? ""}/api/documents" \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "templateId": "uuid",
    "variables": {
      "client_name": "Acme Corp",
      "project_title": "Website Redesign"
    }
  }'`}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">List Documents</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => copyToClipboard(`curl -X GET "${import.meta.env.VITE_API_URL ?? ""}/api/documents?limit=20&offset=0" \\
  -H "Authorization: Bearer YOUR_TOKEN"`)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-4 rounded-md text-xs overflow-x-auto">
{`curl -X GET "${import.meta.env.VITE_API_URL ?? ""}/api/documents?limit=20&offset=0" \\
  -H "Authorization: Bearer YOUR_TOKEN"`}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Get Template Variables</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => copyToClipboard(`curl -X GET "${import.meta.env.VITE_API_URL ?? ""}/api/templates/UUID/variables" \\
  -H "Authorization: Bearer YOUR_TOKEN"`)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-4 rounded-md text-xs overflow-x-auto">
{`curl -X GET "${import.meta.env.VITE_API_URL ?? ""}/api/templates/UUID/variables" \\
  -H "Authorization: Bearer YOUR_TOKEN"`}
            </pre>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="javascript" className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Create Document</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => copyToClipboard(`const response = await fetch('${import.meta.env.VITE_API_URL ?? ""}/api/documents', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    templateId: 'uuid',
    variables: {
      client_name: 'Acme Corp',
      project_title: 'Website Redesign'
    }
  })
});

const data = await response.json();`)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-4 rounded-md text-xs overflow-x-auto">
{`const response = await fetch('${import.meta.env.VITE_API_URL ?? ""}/api/documents', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    templateId: 'uuid',
    variables: {
      client_name: 'Acme Corp',
      project_title: 'Website Redesign'
    }
  })
});

const data = await response.json();`}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">List Documents with Pagination</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => copyToClipboard(`const response = await fetch('${import.meta.env.VITE_API_URL ?? ""}/api/documents?limit=20&offset=0', {
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN'
  }
});

const { documents, total, limit, offset } = await response.json();`)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-4 rounded-md text-xs overflow-x-auto">
{`const response = await fetch('${import.meta.env.VITE_API_URL ?? ""}/api/documents?limit=20&offset=0', {
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN'
  }
});

const { documents, total, limit, offset } = await response.json();`}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Error Handling</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => copyToClipboard(`try {
  const response = await fetch('${import.meta.env.VITE_API_URL ?? ""}/api/documents', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ templateId: 'uuid', variables: {} })
  });

  if (!response.ok) {
    const error = await response.json();
    if (error.error === 'VARIABLE_VALIDATION_FAILED') {
      console.error('Missing variables:', error.missingVariables);
      console.error('Invalid variables:', error.invalidVariables);
    }
    throw new Error(error.message || 'Request failed');
  }

  const data = await response.json();
} catch (error) {
  console.error('Error:', error);
}`)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-4 rounded-md text-xs overflow-x-auto">
{`try {
  const response = await fetch('${import.meta.env.VITE_API_URL ?? ""}/api/documents', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ templateId: 'uuid', variables: {} })
  });

  if (!response.ok) {
    const error = await response.json();
    if (error.error === 'VARIABLE_VALIDATION_FAILED') {
      console.error('Missing variables:', error.missingVariables);
      console.error('Invalid variables:', error.invalidVariables);
    }
    throw new Error(error.message || 'Request failed');
  }

  const data = await response.json();
} catch (error) {
  console.error('Error:', error);
}`}
            </pre>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="python" className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Create Document</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => copyToClipboard(`import requests

url = '${import.meta.env.VITE_API_URL ?? ""}/api/documents'
headers = {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
}
data = {
    'templateId': 'uuid',
    'variables': {
        'client_name': 'Acme Corp',
        'project_title': 'Website Redesign'
    }
}

response = requests.post(url, headers=headers, json=data)
result = response.json()`)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-4 rounded-md text-xs overflow-x-auto">
{`import requests

url = '${import.meta.env.VITE_API_URL ?? ""}/api/documents'
headers = {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
}
data = {
    'templateId': 'uuid',
    'variables': {
        'client_name': 'Acme Corp',
        'project_title': 'Website Redesign'
    }
}

response = requests.post(url, headers=headers, json=data)
result = response.json()`}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">List Documents</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => copyToClipboard(`import requests

url = '${import.meta.env.VITE_API_URL ?? ""}/api/documents'
params = {'limit': 20, 'offset': 0}
headers = {'Authorization': 'Bearer YOUR_TOKEN'}

response = requests.get(url, headers=headers, params=params)
data = response.json()

documents = data['documents']
total = data['total']`)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-4 rounded-md text-xs overflow-x-auto">
{`import requests

url = '${import.meta.env.VITE_API_URL ?? ""}/api/documents'
params = {'limit': 20, 'offset': 0}
headers = {'Authorization': 'Bearer YOUR_TOKEN'}

response = requests.get(url, headers=headers, params=params)
data = response.json()

documents = data['documents']
total = data['total']`}
            </pre>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="n8n" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">n8n HTTP Request Node Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Create Document Node</h3>
              <div className="bg-muted p-4 rounded-md space-y-2 text-sm">
                <p><strong>Method:</strong> POST</p>
                <p><strong>URL:</strong> <code>{import.meta.env.VITE_API_URL ?? ""}/api/documents</code></p>
                <p><strong>Authentication:</strong> Generic Credential Type</p>
                <p><strong>Header Name:</strong> Authorization</p>
                <p><strong>Header Value:</strong> Bearer YOUR_TOKEN</p>
                <p><strong>Body Content Type:</strong> JSON</p>
                <p><strong>Body:</strong></p>
                <pre className="bg-background p-2 rounded text-xs mt-2">
{`{
  "templateId": "${n8nTemplate('$json.templateId')}",
  "variables": {
    "client_name": "${n8nTemplate('$json.clientName')}",
    "project_title": "${n8nTemplate('$json.projectTitle')}"
  }
}`}
                </pre>
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Error Handling</h3>
              <p className="text-sm text-muted-foreground">
                In n8n, add an "IF" node after the HTTP Request node to check for error responses:
              </p>
              <div className="bg-muted p-4 rounded-md text-sm mt-2">
                <p><strong>Condition:</strong> <code>{'{{ $json.error }}'} = "VARIABLE_VALIDATION_FAILED"</code></p>
                <p className="mt-2">Access missing variables: <code>{'{{ $json.missingVariables }}'}</code></p>
                <p>Access invalid variables: <code>{'{{ $json.invalidVariables }}'}</code></p>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}


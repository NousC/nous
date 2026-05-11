import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeBlock } from "@/components/CodeBlock";
import { EndpointDoc } from "@/components/EndpointDoc";
import { cn } from "@/lib/utils";

export function APIDocumentation() {
  const apiUrl = import.meta.env.VITE_API_URL ?? "";

  return (
    <div className="space-y-16">
      {/* Overview */}
      <section id="intro" className="scroll-mt-20">
        <div className="mb-4">
          <span className="text-sm text-gray-400 uppercase tracking-wider">Getting Started</span>
        </div>
        <h1 className="text-4xl font-bold tracking-tight mb-4">Proply API</h1>
        <p className="text-lg text-gray-500 mb-6 leading-relaxed">
          Proply is an AI agent that creates professionally designed proposals, sends them for signing, and manages your contacts. One endpoint. Tell the agent what you need, it handles the rest &mdash; including the design.
        </p>

        <div className="bg-gray-50 rounded-lg p-6 mb-8">
          <h3 className="text-lg font-semibold mb-3">How it works</h3>
          <div className="space-y-3 text-sm text-gray-600">
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-landing-green/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-landing-green font-semibold text-xs">1</span>
              </span>
              <p><strong>Send a message to the agent</strong> &mdash; "Create a proposal for Acme Corp, $5k/month retainer for social media management"</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-landing-green/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-landing-green font-semibold text-xs">2</span>
              </span>
              <p><strong>The agent picks a template, writes the content, and designs the layout</strong> &mdash; no manual setup needed</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-landing-green/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-landing-green font-semibold text-xs">3</span>
              </span>
              <p><strong>You get back a link to the finished proposal</strong> &mdash; ready to share, export as PDF, or send for e-signature</p>
            </div>
          </div>
        </div>

        {/* Use anywhere cards */}
        <div className="mb-8">
          <h3 className="text-2xl font-semibold mb-6">Use Proply from anywhere</h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="border border-gray-200 rounded-lg p-6 bg-white hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-landing-green/10 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-landing-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h4 className="text-lg font-semibold mb-2">REST API</h4>
              <p className="text-sm text-gray-500">
                Call <code className="bg-gray-100 px-1 rounded">POST /agent</code> from any app, script, or automation tool. One endpoint does everything.
              </p>
            </div>

            <div className="border border-gray-200 rounded-lg p-6 bg-white hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-landing-green/10 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-landing-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h4 className="text-lg font-semibold mb-2">MCP Server</h4>
              <p className="text-sm text-gray-500">
                Add Proply to Claude Desktop, Cursor, or any MCP-compatible client. The agent shows up as a tool automatically.
              </p>
            </div>

            <div className="border border-gray-200 rounded-lg p-6 bg-white hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-landing-green/10 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-landing-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                </svg>
              </div>
              <h4 className="text-lg font-semibold mb-2">Integrations</h4>
              <p className="text-sm text-gray-500">
                Slack, n8n, Make, Zapier &mdash; anywhere you can send an HTTP request or connect an MCP server, Proply works.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Authentication */}
      <section id="authentication" className="scroll-mt-20 pt-16 border-t border-gray-200">
        <div className="mb-4">
          <span className="text-sm text-gray-400 uppercase tracking-wider">Getting Started</span>
        </div>
        <h2 className="text-3xl font-bold tracking-tight mb-4">Authentication</h2>
        <p className="text-lg text-gray-500 mb-6">
          All API requests require a Bearer token in the Authorization header.
        </p>

        <div className="space-y-8">
          <div>
            <h3 className="text-xl font-semibold mb-3">Bearer Token</h3>
            <p className="text-gray-500 mb-3">
              Include your API key in every request:
            </p>
            <CodeBlock code={`Authorization: Bearer YOUR_API_KEY`} />
          </div>

          <div>
            <h3 className="text-xl font-semibold mb-3">Getting Your API Key</h3>
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                <li>Log in to your Proply account</li>
                <li>Go to <a href="/settings" className="text-landing-green hover:underline">Settings &rarr; API Keys</a></li>
                <li>Click "Create API Key" and give it a name</li>
                <li>Copy the key immediately (it's only shown once)</li>
                <li>The response includes your <code className="bg-gray-100 px-1 rounded">workspace_id</code> &mdash; save it</li>
              </ol>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-800">
                <strong>Note:</strong> API keys are workspace-scoped. Include <code className="bg-yellow-100 px-1 rounded">workspaceId</code> in your requests (query param for GET, body for POST).
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* MCP Server */}
      <section id="mcp-server" className="scroll-mt-20 pt-16 border-t border-gray-200">
        <div className="mb-4">
          <span className="text-sm text-gray-400 uppercase tracking-wider">Getting Started</span>
        </div>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-3xl font-bold tracking-tight">MCP Server</h2>
          <Badge className="bg-yellow-500/10 text-yellow-700 border border-yellow-300 font-medium text-xs px-2 py-0.5">Beta</Badge>
        </div>
        <p className="text-lg text-gray-500 mb-6">
          Connect Proply as a tool in Claude Desktop, Cursor, Windsurf, or any MCP-compatible client. Once connected, the AI assistant can create proposals, send documents for signing, and manage contacts on your behalf.
        </p>

        <div className="space-y-8">
          <div>
            <h3 className="text-xl font-semibold mb-3">Quick Setup</h3>
            <p className="text-gray-500 mb-4">
              Add this to your MCP client configuration (e.g. <code className="bg-gray-100 px-1 rounded">claude_desktop_config.json</code>):
            </p>
            <CodeBlock code={`{
  "mcpServers": {
    "proply": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@goproply/mcp"],
      "env": {
        "PROPLY_API_KEY": "your-api-key",
        "PROPLY_WORKSPACE_ID": "your-workspace-id"
      }
    }
  }
}`} language="json" />
          </div>

          <div>
            <h3 className="text-xl font-semibold mb-3">Available Tools</h3>
            <p className="text-gray-500 mb-4">
              Once connected, the following tools are exposed to your AI assistant:
            </p>
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-gray-400 uppercase tracking-wider mt-2 mb-1">Proposals &amp; Templates</h4>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Badge className="bg-green-600 font-mono text-xs mt-0.5">tool</Badge>
                <div>
                  <code className="font-semibold">create_proposal</code>
                  <p className="text-sm text-gray-500 mt-1">Create a professionally designed proposal from a description, transcript, or brief. Picks the template, writes content, handles layout.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Badge className="bg-green-600 font-mono text-xs mt-0.5">tool</Badge>
                <div>
                  <code className="font-semibold">create_template</code>
                  <p className="text-sm text-gray-500 mt-1">Build a new reusable template from a description with page layouts and variable placeholders.</p>
                </div>
              </div>

              <h4 className="text-sm font-medium text-gray-400 uppercase tracking-wider mt-4 mb-1">Documents</h4>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Badge className="bg-green-600 font-mono text-xs mt-0.5">tool</Badge>
                <div>
                  <code className="font-semibold">list_documents</code>
                  <p className="text-sm text-gray-500 mt-1">List documents in your workspace with status and links.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Badge className="bg-green-600 font-mono text-xs mt-0.5">tool</Badge>
                <div>
                  <code className="font-semibold">get_document</code>
                  <p className="text-sm text-gray-500 mt-1">Get details of a specific document including content, variables, and status.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Badge className="bg-green-600 font-mono text-xs mt-0.5">tool</Badge>
                <div>
                  <code className="font-semibold">export_pdf</code>
                  <p className="text-sm text-gray-500 mt-1">Export a document as a downloadable PDF.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Badge className="bg-green-600 font-mono text-xs mt-0.5">tool</Badge>
                <div>
                  <code className="font-semibold">create_share_link</code>
                  <p className="text-sm text-gray-500 mt-1">Create a public shareable link for a document.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Badge className="bg-green-600 font-mono text-xs mt-0.5">tool</Badge>
                <div>
                  <code className="font-semibold">update_document</code>
                  <p className="text-sm text-gray-500 mt-1">Update a document's name or variable values.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Badge className="bg-green-600 font-mono text-xs mt-0.5">tool</Badge>
                <div>
                  <code className="font-semibold">delete_document</code>
                  <p className="text-sm text-gray-500 mt-1">Permanently delete a document.</p>
                </div>
              </div>

              <h4 className="text-sm font-medium text-gray-400 uppercase tracking-wider mt-4 mb-1">Templates</h4>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Badge className="bg-green-600 font-mono text-xs mt-0.5">tool</Badge>
                <div>
                  <code className="font-semibold">list_templates</code>
                  <p className="text-sm text-gray-500 mt-1">List available templates in your workspace.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Badge className="bg-green-600 font-mono text-xs mt-0.5">tool</Badge>
                <div>
                  <code className="font-semibold">get_template</code>
                  <p className="text-sm text-gray-500 mt-1">Get template details and variable schema.</p>
                </div>
              </div>

              <h4 className="text-sm font-medium text-gray-400 uppercase tracking-wider mt-4 mb-1">Signing</h4>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Badge className="bg-green-600 font-mono text-xs mt-0.5">tool</Badge>
                <div>
                  <code className="font-semibold">send_for_signing</code>
                  <p className="text-sm text-gray-500 mt-1">Configure signers and send signing request emails in one step.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Badge className="bg-green-600 font-mono text-xs mt-0.5">tool</Badge>
                <div>
                  <code className="font-semibold">get_signing_status</code>
                  <p className="text-sm text-gray-500 mt-1">Check who has signed and who hasn't.</p>
                </div>
              </div>

              <h4 className="text-sm font-medium text-gray-400 uppercase tracking-wider mt-4 mb-1">Contacts</h4>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Badge className="bg-green-600 font-mono text-xs mt-0.5">tool</Badge>
                <div>
                  <code className="font-semibold">search_contacts</code>
                  <p className="text-sm text-gray-500 mt-1">Search contacts by name, email, or company.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Badge className="bg-green-600 font-mono text-xs mt-0.5">tool</Badge>
                <div>
                  <code className="font-semibold">create_contact</code>
                  <p className="text-sm text-gray-500 mt-1">Add a new contact to your workspace.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Badge className="bg-green-600 font-mono text-xs mt-0.5">tool</Badge>
                <div>
                  <code className="font-semibold">get_contact</code>
                  <p className="text-sm text-gray-500 mt-1">Get details of a specific contact.</p>
                </div>
              </div>

              <h4 className="text-sm font-medium text-gray-400 uppercase tracking-wider mt-4 mb-1">Integrations (when connected)</h4>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Badge className="bg-green-600 font-mono text-xs mt-0.5">tool</Badge>
                <div>
                  <code className="font-semibold">search_crm</code>
                  <p className="text-sm text-gray-500 mt-1">Search your Pipedrive or HubSpot CRM for contacts, deals, and companies.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Badge className="bg-green-600 font-mono text-xs mt-0.5">tool</Badge>
                <div>
                  <code className="font-semibold">create_crm_deal</code>
                  <p className="text-sm text-gray-500 mt-1">Create a new deal in your connected CRM.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <Badge className="bg-green-600 font-mono text-xs mt-0.5">tool</Badge>
                <div>
                  <code className="font-semibold">search_meeting_notes</code>
                  <p className="text-sm text-gray-500 mt-1">Search transcripts from Granola, Fireflies, or Fathom to pull context into proposals.</p>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xl font-semibold mb-3">Example Usage</h3>
            <p className="text-gray-500 mb-4">
              Once connected to Claude Desktop, just ask naturally:
            </p>
            <div className="space-y-3">
              <div className="bg-[#1e1e1e] text-[#d4d4d4] p-4 rounded-lg text-sm font-mono">
                <p className="text-gray-400 mb-2"># In Claude Desktop, Cursor, or any MCP client:</p>
                <p className="text-white">"Create a proposal for Acme Corp — they need a full brand redesign, budget is $15k"</p>
                <p className="text-gray-400 mt-3"># Claude calls Proply's create_proposal tool automatically.</p>
                <p className="text-gray-400"># Proply picks a template, writes the content, designs it, and returns a link.</p>
              </div>
              <div className="bg-[#1e1e1e] text-[#d4d4d4] p-4 rounded-lg text-sm font-mono">
                <p className="text-white">"Send that proposal to john@acmecorp.com for signing"</p>
                <p className="text-gray-400 mt-3"># Claude calls send_for_signing. John gets an email with a signing link.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Agent Endpoint */}
      <section id="agent" className="scroll-mt-20 pt-16 border-t border-gray-200">
        <div className="mb-4">
          <span className="text-sm text-gray-400 uppercase tracking-wider">Agent</span>
        </div>
        <h2 className="text-3xl font-bold tracking-tight mb-4">POST /agent</h2>
        <p className="text-lg text-gray-500 mb-8 leading-relaxed">
          The primary interface to Proply. Send a message, the agent decides what actions to take. It has access to all your templates, contacts, documents, and CRM data.
        </p>

        <EndpointDoc
          method="POST"
          endpoint="/api/agent"
          title="Agent"
          description="Send a message to the Proply agent. The agent interprets your request and takes the appropriate actions — creating proposals, sending for signing, looking up contacts, etc."
          bodyParams={[
            {
              name: "message",
              type: "string",
              required: true,
              description: "Your request in natural language. E.g. \"Create a proposal for Acme Corp based on their marketing needs, $5k/month retainer\"",
            },
            {
              name: "workspaceId",
              type: "string (UUID)",
              required: true,
              description: "Your workspace ID.",
            },
            {
              name: "context",
              type: "object",
              required: false,
              description: "Optional context to include — transcript text, meeting notes, CRM data, or any background the agent should use.",
            },
            {
              name: "template_id",
              type: "string (UUID)",
              required: false,
              description: "Pin a specific template. If omitted, the agent picks the best match.",
            },
            {
              name: "conversation_id",
              type: "string (UUID)",
              required: false,
              description: "Continue a previous conversation. Enables multi-turn interactions with the agent.",
            },
          ]}
          requestExample={{
            curl: `curl -X POST "${apiUrl}/api/agent" \\
  -H "Authorization: Bearer $PROPLY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "message": "Create a proposal for Acme Corp — social media management, $5k/month retainer",
    "workspaceId": "your-workspace-id"
  }'`,
            javascript: `const response = await fetch('${apiUrl}/api/agent', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${process.env.PROPLY_API_KEY}\`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    message: 'Create a proposal for Acme Corp — social media management, $5k/month retainer',
    workspaceId: 'your-workspace-id'
  })
});

const result = await response.json();
console.log(result.response);
console.log(result.links);`,
            python: `import requests
import os

response = requests.post(
    '${apiUrl}/api/agent',
    headers={'Authorization': f'Bearer {os.environ["PROPLY_API_KEY"]}'},
    json={
        'message': 'Create a proposal for Acme Corp — social media management, $5k/month retainer',
        'workspaceId': 'your-workspace-id'
    }
)

result = response.json()
print(result['response'])
print(result['links'])`,
          }}
          responseExample={`{
  "response": "Done! I created a proposal for Acme Corp using your Social Media Management template. Here's the link:",
  "conversation_id": "conv-abc-123",
  "actions_taken": [
    {
      "type": "create_proposal",
      "document_id": "doc-550e8400-e29b-41d4",
      "template_used": "Social Media Management"
    }
  ],
  "links": {
    "view": "https://goproply.com/share/xyz-token",
    "pdf": "https://api.goproply.com/api/documents/doc-550e8400-e29b-41d4/export/pdf",
    "edit": "https://goproply.com/documents/doc-550e8400-e29b-41d4"
  }
}`}
        />
      </section>

      {/* Agent Actions */}
      <section id="agent-actions" className="scroll-mt-20 pt-16 border-t border-gray-200">
        <div className="mb-4">
          <span className="text-sm text-gray-400 uppercase tracking-wider">Agent</span>
        </div>
        <h2 className="text-3xl font-bold tracking-tight mb-4">Agent Actions</h2>
        <p className="text-lg text-gray-500 mb-8">
          You don't call these separately. The agent decides which actions to take based on your message. Here's what it can do:
        </p>

        <div className="space-y-4">
          <div className="border border-gray-200 rounded-lg p-5">
            <div className="flex items-center gap-3 mb-2">
              <Badge className="bg-landing-green font-mono text-xs">create_proposal</Badge>
            </div>
            <p className="text-gray-600 mb-2">Creates a professionally designed proposal. The agent picks the best template, writes all content based on your input, and handles the visual layout. You can optionally pin a specific template.</p>
            <p className="text-sm text-gray-400">Examples: "Create a proposal for Acme Corp...", "Draft a proposal based on this transcript...", "Use the Enterprise template for..."</p>
          </div>

          <div className="border border-gray-200 rounded-lg p-5">
            <div className="flex items-center gap-3 mb-2">
              <Badge className="bg-landing-green font-mono text-xs">create_template</Badge>
            </div>
            <p className="text-gray-600 mb-2">Builds a new reusable template from a description. Includes page layouts, design, and variable placeholders.</p>
            <p className="text-sm text-gray-400">Examples: "Create a template for web development proposals", "Build me a consulting template..."</p>
          </div>

          <div className="border border-gray-200 rounded-lg p-5">
            <div className="flex items-center gap-3 mb-2">
              <Badge className="bg-landing-green font-mono text-xs">send_for_signing</Badge>
            </div>
            <p className="text-gray-600 mb-2">Configures signers and sends signing request emails in one step. Handles signer setup, email customization, and tracking automatically.</p>
            <p className="text-sm text-gray-400">Examples: "Send that proposal to john@acme.com for signing", "Get signatures from both parties..."</p>
          </div>

          <div className="border border-gray-200 rounded-lg p-5">
            <div className="flex items-center gap-3 mb-2">
              <Badge className="bg-landing-green font-mono text-xs">get_signing_status</Badge>
            </div>
            <p className="text-gray-600 mb-2">Checks who has signed a document and who hasn't yet.</p>
            <p className="text-sm text-gray-400">Examples: "Has John signed the Acme proposal?", "Check signing status..."</p>
          </div>

          <div className="border border-gray-200 rounded-lg p-5">
            <div className="flex items-center gap-3 mb-2">
              <Badge className="bg-landing-green font-mono text-xs">export_pdf</Badge>
            </div>
            <p className="text-gray-600 mb-2">Exports a document as a downloadable PDF.</p>
            <p className="text-sm text-gray-400">Examples: "Export that as a PDF", "Give me a PDF of the Acme proposal"</p>
          </div>

          <div className="border border-gray-200 rounded-lg p-5">
            <div className="flex items-center gap-3 mb-2">
              <Badge className="bg-landing-green font-mono text-xs">create_share_link</Badge>
            </div>
            <p className="text-gray-600 mb-2">Creates a public shareable link for a document.</p>
            <p className="text-sm text-gray-400">Examples: "Share the Acme proposal", "Get me a link I can send to the client"</p>
          </div>

          <div className="border border-gray-200 rounded-lg p-5">
            <div className="flex items-center gap-3 mb-2">
              <Badge className="bg-landing-green font-mono text-xs">search_contacts</Badge>
            </div>
            <p className="text-gray-600 mb-2">Searches contacts in your workspace by name, email, or company to personalize proposals and signing.</p>
            <p className="text-sm text-gray-400">Examples: "Find the Acme contact", "Who's john@acme.com?"</p>
          </div>

          <div className="border border-gray-200 rounded-lg p-5">
            <div className="flex items-center gap-3 mb-2">
              <Badge className="bg-landing-green font-mono text-xs">create_contact</Badge>
            </div>
            <p className="text-gray-600 mb-2">Adds a new contact to your workspace for use in proposals and signing.</p>
            <p className="text-sm text-gray-400">Examples: "Add John Smith from Acme Corp as a contact"</p>
          </div>

          <div className="border border-gray-200 rounded-lg p-5">
            <div className="flex items-center gap-3 mb-2">
              <Badge className="bg-landing-green font-mono text-xs">list_documents</Badge>
              <Badge className="bg-landing-green font-mono text-xs">list_templates</Badge>
              <Badge className="bg-landing-green font-mono text-xs">get_document</Badge>
              <Badge className="bg-landing-green font-mono text-xs">get_template</Badge>
            </div>
            <p className="text-gray-600 mb-2">Browse and retrieve your documents and templates.</p>
            <p className="text-sm text-gray-400">Examples: "Show me my recent proposals", "What templates do I have?", "Get the Acme proposal details"</p>
          </div>

          <div className="border border-gray-200 rounded-lg p-5">
            <div className="flex items-center gap-3 mb-2">
              <Badge className="bg-landing-green font-mono text-xs">update_document</Badge>
              <Badge className="bg-landing-green font-mono text-xs">delete_document</Badge>
            </div>
            <p className="text-gray-600 mb-2">Update a document's name or variables, or permanently delete it.</p>
            <p className="text-sm text-gray-400">Examples: "Rename that proposal to...", "Delete the old draft"</p>
          </div>

          <div className="border border-gray-200 rounded-lg p-5 bg-gray-50/50">
            <div className="flex items-center gap-3 mb-2">
              <Badge className="bg-gray-500 font-mono text-xs">search_crm</Badge>
              <Badge className="bg-gray-500 font-mono text-xs">create_crm_deal</Badge>
              <Badge className="bg-gray-500 font-mono text-xs">search_meeting_notes</Badge>
              <span className="text-xs text-gray-400">requires integration</span>
            </div>
            <p className="text-gray-600 mb-2">Search your CRM (Pipedrive, HubSpot), create deals, and search meeting transcripts (Granola, Fireflies, Fathom). These tools appear when the integration is connected in Proply settings.</p>
            <p className="text-sm text-gray-400">Examples: "Search my CRM for Acme", "Create a deal for the website redesign", "Find notes from yesterday's call with Acme"</p>
          </div>
        </div>
      </section>

      {/* Webhooks */}
      <section id="agent-webhooks" className="scroll-mt-20 pt-16 border-t border-gray-200">
        <div className="mb-4">
          <span className="text-sm text-gray-400 uppercase tracking-wider">Agent</span>
        </div>
        <h2 className="text-3xl font-bold tracking-tight mb-4">Webhooks</h2>
        <p className="text-lg text-gray-500 mb-8">
          Get notified when things happen. Configure webhook URLs in Settings &rarr; Webhooks.
        </p>

        <div className="space-y-4">
          <div className="border border-gray-200 rounded-lg p-5">
            <div className="flex items-center gap-3 mb-2">
              <code className="font-mono font-semibold">proposal.completed</code>
            </div>
            <p className="text-gray-600">Fired when the agent finishes generating a proposal. Includes the document ID, share link, and PDF export URL.</p>
          </div>

          <div className="border border-gray-200 rounded-lg p-5">
            <div className="flex items-center gap-3 mb-2">
              <code className="font-mono font-semibold">document.signed</code>
            </div>
            <p className="text-gray-600">Fired when all signers have completed signing a document.</p>
          </div>

          <div className="border border-gray-200 rounded-lg p-5">
            <div className="flex items-center gap-3 mb-2">
              <code className="font-mono font-semibold">document.viewed</code>
            </div>
            <p className="text-gray-600">Fired when a recipient opens a shared document link.</p>
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-xl font-semibold mb-3">Webhook Payload</h3>
          <CodeBlock code={`{
  "event": "proposal.completed",
  "timestamp": "2026-03-26T14:30:00Z",
  "data": {
    "document_id": "doc-550e8400-e29b-41d4",
    "workspace_id": "ws-123",
    "links": {
      "view": "https://goproply.com/share/xyz-token",
      "pdf": "https://api.goproply.com/api/documents/doc-550e8400/export/pdf"
    }
  }
}`} language="json" />
        </div>
      </section>

      {/* Resources - Documents */}
      <section id="documents" className="scroll-mt-20 pt-16 border-t border-gray-200">
        <div className="mb-4">
          <span className="text-sm text-gray-400 uppercase tracking-wider">Resources</span>
        </div>
        <h2 className="text-3xl font-bold tracking-tight mb-4">Documents</h2>
        <p className="text-lg text-gray-500 mb-8 leading-relaxed">
          Read and manage documents in your workspace. The agent creates documents for you &mdash; these endpoints are for when you want to access them directly.
        </p>

        <div className="space-y-8">
          <EndpointDoc
            method="GET"
            endpoint="/api/documents"
            title="List Documents"
            description="Retrieve documents from your workspace with filtering and pagination."
            queryParams={[
              { name: "workspaceId", type: "string (UUID)", required: true, description: "Your workspace ID." },
              { name: "type", type: "string", required: false, description: "Filter by type: 'proposal', 'whitepaper', 'asset'" },
              { name: "limit", type: "number", required: false, description: "Max results to return.", default: "20" },
              { name: "offset", type: "number", required: false, description: "Pagination offset.", default: "0" },
            ]}
            requestExample={{
              curl: `curl -X GET "${apiUrl}/api/documents?workspaceId=your-workspace-id&type=proposal" \\
  -H "Authorization: Bearer $PROPLY_API_KEY"`,
              javascript: `const response = await fetch('${apiUrl}/api/documents?workspaceId=your-workspace-id&type=proposal', {
  headers: {
    'Authorization': \`Bearer \${process.env.PROPLY_API_KEY}\`
  }
});

const { documents } = await response.json();`,
              python: `import requests, os

response = requests.get(
    '${apiUrl}/api/documents',
    headers={'Authorization': f'Bearer {os.environ["PROPLY_API_KEY"]}'},
    params={'workspaceId': 'your-workspace-id', 'type': 'proposal'}
)

documents = response.json()['documents']`,
            }}
            responseExample={`{
  "documents": [
    {
      "id": "doc-550e8400-e29b-41d4",
      "name": "Acme Corp — Social Media Proposal",
      "type": "proposal",
      "status": "completed",
      "created_at": "2026-03-26T14:30:00Z",
      "share_url": "https://goproply.com/share/xyz-token"
    }
  ],
  "total": 1
}`}
          />

          <div className="border-t border-gray-100 pt-8">
            <EndpointDoc
              method="GET"
              endpoint="/api/documents/:id"
              title="Get Document"
              description="Retrieve a single document with full details."
              pathParams={[
                { name: "id", type: "string (UUID)", required: true, description: "Document ID" },
              ]}
              requestExample={{
                curl: `curl -X GET "${apiUrl}/api/documents/doc-550e8400-e29b-41d4" \\
  -H "Authorization: Bearer $PROPLY_API_KEY"`,
                javascript: `const response = await fetch('${apiUrl}/api/documents/doc-550e8400-e29b-41d4', {
  headers: { 'Authorization': \`Bearer \${process.env.PROPLY_API_KEY}\` }
});

const document = await response.json();`,
                python: `response = requests.get(
    '${apiUrl}/api/documents/doc-550e8400-e29b-41d4',
    headers={'Authorization': f'Bearer {os.environ["PROPLY_API_KEY"]}'}
)`,
              }}
              responseExample={`{
  "id": "doc-550e8400-e29b-41d4",
  "name": "Acme Corp — Social Media Proposal",
  "type": "proposal",
  "status": "completed",
  "content": { "pages": [...] },
  "variables": { "client_name": "Acme Corp" },
  "created_at": "2026-03-26T14:30:00Z"
}`}
            />
          </div>

          <div className="border-t border-gray-100 pt-8">
            <EndpointDoc
              method="POST"
              endpoint="/api/documents/:id/export/pdf"
              title="Export PDF"
              description="Generate a PDF for a document and get a download URL."
              pathParams={[
                { name: "id", type: "string (UUID)", required: true, description: "Document ID" },
              ]}
              requestExample={{
                curl: `curl -X POST "${apiUrl}/api/documents/doc-550e8400-e29b-41d4/export/pdf" \\
  -H "Authorization: Bearer $PROPLY_API_KEY"`,
                javascript: `const response = await fetch('${apiUrl}/api/documents/doc-550e8400-e29b-41d4/export/pdf', {
  method: 'POST',
  headers: { 'Authorization': \`Bearer \${process.env.PROPLY_API_KEY}\` }
});

const { pdf_url } = await response.json();`,
                python: `response = requests.post(
    '${apiUrl}/api/documents/doc-550e8400-e29b-41d4/export/pdf',
    headers={'Authorization': f'Bearer {os.environ["PROPLY_API_KEY"]}'}
)

pdf_url = response.json()['pdf_url']`,
              }}
              responseExample={`{
  "pdf_url": "https://storage.goproply.com/pdfs/doc-550e8400.pdf",
  "expires_at": "2026-03-27T14:30:00Z"
}`}
            />
          </div>

          <div className="border-t border-gray-100 pt-8">
            <EndpointDoc
              method="POST"
              endpoint="/api/documents/:id/share-link"
              title="Create Share Link"
              description="Create a public share link for a document."
              pathParams={[
                { name: "id", type: "string (UUID)", required: true, description: "Document ID" },
              ]}
              requestExample={{
                curl: `curl -X POST "${apiUrl}/api/documents/doc-550e8400-e29b-41d4/share-link" \\
  -H "Authorization: Bearer $PROPLY_API_KEY"`,
                javascript: `const response = await fetch('${apiUrl}/api/documents/doc-550e8400-e29b-41d4/share-link', {
  method: 'POST',
  headers: { 'Authorization': \`Bearer \${process.env.PROPLY_API_KEY}\` }
});

const { share_url } = await response.json();`,
                python: `response = requests.post(
    '${apiUrl}/api/documents/doc-550e8400-e29b-41d4/share-link',
    headers={'Authorization': f'Bearer {os.environ["PROPLY_API_KEY"]}'}
)

share_url = response.json()['share_url']`,
              }}
              responseExample={`{
  "share_url": "https://goproply.com/share/xyz-token",
  "token": "xyz-token"
}`}
            />
          </div>

          <div className="border-t border-gray-100 pt-8">
            <EndpointDoc
              method="PATCH"
              endpoint="/api/documents/:id"
              title="Update Document"
              description="Update variable values or metadata for an existing document."
              pathParams={[
                { name: "id", type: "string (UUID)", required: true, description: "Document ID" },
              ]}
              bodyParams={[
                { name: "name", type: "string", required: false, description: "New document name" },
                { name: "variables", type: "object", required: false, description: "Updated variable values" },
              ]}
              requestExample={{
                curl: `curl -X PATCH "${apiUrl}/api/documents/doc-550e8400-e29b-41d4" \\
  -H "Authorization: Bearer $PROPLY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"variables": {"client_name": "Acme Corporation"}}'`,
                javascript: `const response = await fetch('${apiUrl}/api/documents/doc-550e8400-e29b-41d4', {
  method: 'PATCH',
  headers: {
    'Authorization': \`Bearer \${process.env.PROPLY_API_KEY}\`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ variables: { client_name: 'Acme Corporation' } })
});`,
                python: `response = requests.patch(
    '${apiUrl}/api/documents/doc-550e8400-e29b-41d4',
    headers={'Authorization': f'Bearer {os.environ["PROPLY_API_KEY"]}'},
    json={'variables': {'client_name': 'Acme Corporation'}}
)`,
              }}
              responseExample={`{
  "id": "doc-550e8400-e29b-41d4",
  "name": "Acme Corp — Social Media Proposal",
  "updated_at": "2026-03-26T15:00:00Z"
}`}
            />
          </div>

          <div className="border-t border-gray-100 pt-8">
            <EndpointDoc
              method="DELETE"
              endpoint="/api/documents/:id"
              title="Delete Document"
              description="Delete a document and its associated PDF."
              pathParams={[
                { name: "id", type: "string (UUID)", required: true, description: "Document ID" },
              ]}
              requestExample={{
                curl: `curl -X DELETE "${apiUrl}/api/documents/doc-550e8400-e29b-41d4" \\
  -H "Authorization: Bearer $PROPLY_API_KEY"`,
                javascript: `await fetch('${apiUrl}/api/documents/doc-550e8400-e29b-41d4', {
  method: 'DELETE',
  headers: { 'Authorization': \`Bearer \${process.env.PROPLY_API_KEY}\` }
});`,
                python: `requests.delete(
    '${apiUrl}/api/documents/doc-550e8400-e29b-41d4',
    headers={'Authorization': f'Bearer {os.environ["PROPLY_API_KEY"]}'}
)`,
              }}
              responseExample={`{
  "success": true
}`}
            />
          </div>
        </div>
      </section>

      {/* Resources - Templates */}
      <section id="templates" className="scroll-mt-20 pt-16 border-t border-gray-200">
        <div className="mb-4">
          <span className="text-sm text-gray-400 uppercase tracking-wider">Resources</span>
        </div>
        <h2 className="text-3xl font-bold tracking-tight mb-4">Templates</h2>
        <p className="text-lg text-gray-500 mb-8 leading-relaxed">
          Browse templates in your workspace. The agent uses these to create proposals &mdash; you can also pin a specific template via the <code className="bg-gray-100 px-1 rounded">template_id</code> parameter in the agent endpoint.
        </p>

        <div className="space-y-8">
          <EndpointDoc
            method="GET"
            endpoint="/api/templates"
            title="List Templates"
            description="Retrieve all templates available in your workspace."
            queryParams={[
              { name: "workspaceId", type: "string (UUID)", required: true, description: "Your workspace ID." },
              { name: "type", type: "string", required: false, description: "Filter by type: 'proposal', 'whitepaper', 'asset'" },
            ]}
            requestExample={{
              curl: `curl -X GET "${apiUrl}/api/templates?workspaceId=your-workspace-id&type=proposal" \\
  -H "Authorization: Bearer $PROPLY_API_KEY"`,
              javascript: `const response = await fetch('${apiUrl}/api/templates?workspaceId=your-workspace-id&type=proposal', {
  headers: { 'Authorization': \`Bearer \${process.env.PROPLY_API_KEY}\` }
});

const { templates } = await response.json();`,
              python: `response = requests.get(
    '${apiUrl}/api/templates',
    headers={'Authorization': f'Bearer {os.environ["PROPLY_API_KEY"]}'},
    params={'workspaceId': 'your-workspace-id', 'type': 'proposal'}
)

templates = response.json()['templates']`,
            }}
            responseExample={`{
  "templates": [
    {
      "id": "tmpl-550e8400-e29b-41d4",
      "name": "Social Media Management",
      "type": "proposal",
      "status": "published",
      "created_at": "2026-01-15T12:00:00Z"
    }
  ]
}`}
          />

          <div className="border-t border-gray-100 pt-8">
            <EndpointDoc
              method="GET"
              endpoint="/api/templates/:id"
              title="Get Template"
              description="Retrieve a specific template with its blocks and variables."
              pathParams={[
                { name: "id", type: "string (UUID)", required: true, description: "Template ID" },
              ]}
              requestExample={{
                curl: `curl -X GET "${apiUrl}/api/templates/tmpl-550e8400-e29b-41d4" \\
  -H "Authorization: Bearer $PROPLY_API_KEY"`,
                javascript: `const response = await fetch('${apiUrl}/api/templates/tmpl-550e8400-e29b-41d4', {
  headers: { 'Authorization': \`Bearer \${process.env.PROPLY_API_KEY}\` }
});

const template = await response.json();`,
                python: `response = requests.get(
    '${apiUrl}/api/templates/tmpl-550e8400-e29b-41d4',
    headers={'Authorization': f'Bearer {os.environ["PROPLY_API_KEY"]}'}
)`,
              }}
              responseExample={`{
  "id": "tmpl-550e8400-e29b-41d4",
  "name": "Social Media Management",
  "type": "proposal",
  "variables": [
    { "key": "client_name", "name": "Client Name", "type": "string", "required": true },
    { "key": "project_scope", "name": "Project Scope", "type": "rich_text", "required": false }
  ]
}`}
            />
          </div>

          <div className="border-t border-gray-100 pt-8">
            <EndpointDoc
              method="GET"
              endpoint="/api/templates/:id/variables"
              title="Template Variables"
              description="Get the variable schema for a template. Useful for understanding what the agent fills in."
              pathParams={[
                { name: "id", type: "string (UUID)", required: true, description: "Template ID" },
              ]}
              requestExample={{
                curl: `curl -X GET "${apiUrl}/api/templates/tmpl-550e8400-e29b-41d4/variables" \\
  -H "Authorization: Bearer $PROPLY_API_KEY"`,
                javascript: `const response = await fetch('${apiUrl}/api/templates/tmpl-550e8400-e29b-41d4/variables', {
  headers: { 'Authorization': \`Bearer \${process.env.PROPLY_API_KEY}\` }
});

const { variables } = await response.json();`,
                python: `response = requests.get(
    '${apiUrl}/api/templates/tmpl-550e8400-e29b-41d4/variables',
    headers={'Authorization': f'Bearer {os.environ["PROPLY_API_KEY"]}'}
)`,
              }}
              responseExample={`{
  "variables": [
    { "key": "client_name", "name": "Client Name", "type": "string", "required": true },
    { "key": "project_scope", "name": "Project Scope", "type": "rich_text", "required": false },
    { "key": "budget", "name": "Budget", "type": "string", "required": false }
  ]
}`}
            />
          </div>
        </div>
      </section>

      {/* Resources - Contacts */}
      <section id="contacts" className="scroll-mt-20 pt-16 border-t border-gray-200">
        <div className="mb-4">
          <span className="text-sm text-gray-400 uppercase tracking-wider">Resources</span>
        </div>
        <h2 className="text-3xl font-bold tracking-tight mb-4">Contacts</h2>
        <p className="text-lg text-gray-500 mb-8 leading-relaxed">
          Your CRM context. The agent uses contacts automatically to personalize proposals and fill in signing details.
        </p>

        <div className="space-y-8">
          <EndpointDoc
            method="GET"
            endpoint="/api/contacts"
            title="List Contacts"
            description="Retrieve all contacts from your workspace."
            queryParams={[
              { name: "workspaceId", type: "string (UUID)", required: true, description: "Your workspace ID." },
            ]}
            requestExample={{
              curl: `curl -X GET "${apiUrl}/api/contacts?workspaceId=your-workspace-id" \\
  -H "Authorization: Bearer $PROPLY_API_KEY"`,
              javascript: `const response = await fetch('${apiUrl}/api/contacts?workspaceId=your-workspace-id', {
  headers: { 'Authorization': \`Bearer \${process.env.PROPLY_API_KEY}\` }
});

const { contacts } = await response.json();`,
              python: `response = requests.get(
    '${apiUrl}/api/contacts',
    headers={'Authorization': f'Bearer {os.environ["PROPLY_API_KEY"]}'},
    params={'workspaceId': 'your-workspace-id'}
)`,
            }}
            responseExample={`{
  "contacts": [
    {
      "id": "contact-123",
      "name": "John Smith",
      "email": "john@acmecorp.com",
      "company": "Acme Corp",
      "created_at": "2026-03-01T10:00:00Z"
    }
  ]
}`}
          />

          <div className="border-t border-gray-100 pt-8">
            <EndpointDoc
              method="GET"
              endpoint="/api/contacts/:id"
              title="Get Contact"
              description="Retrieve a specific contact."
              pathParams={[
                { name: "id", type: "string (UUID)", required: true, description: "Contact ID" },
              ]}
              requestExample={{
                curl: `curl -X GET "${apiUrl}/api/contacts/contact-123" \\
  -H "Authorization: Bearer $PROPLY_API_KEY"`,
                javascript: `const response = await fetch('${apiUrl}/api/contacts/contact-123', {
  headers: { 'Authorization': \`Bearer \${process.env.PROPLY_API_KEY}\` }
});`,
                python: `response = requests.get(
    '${apiUrl}/api/contacts/contact-123',
    headers={'Authorization': f'Bearer {os.environ["PROPLY_API_KEY"]}'}
)`,
              }}
              responseExample={`{
  "id": "contact-123",
  "name": "John Smith",
  "email": "john@acmecorp.com",
  "company": "Acme Corp",
  "phone": "+1 555-0123",
  "metadata": {}
}`}
            />
          </div>

          <div className="border-t border-gray-100 pt-8">
            <EndpointDoc
              method="POST"
              endpoint="/api/contacts"
              title="Create Contact"
              description="Add a new contact to your workspace."
              bodyParams={[
                { name: "workspaceId", type: "string (UUID)", required: true, description: "Your workspace ID." },
                { name: "name", type: "string", required: true, description: "Contact's full name" },
                { name: "email", type: "string", required: true, description: "Contact's email address" },
                { name: "company", type: "string", required: false, description: "Company name" },
                { name: "phone", type: "string", required: false, description: "Phone number" },
              ]}
              requestExample={{
                curl: `curl -X POST "${apiUrl}/api/contacts" \\
  -H "Authorization: Bearer $PROPLY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"workspaceId": "your-workspace-id", "name": "John Smith", "email": "john@acmecorp.com", "company": "Acme Corp"}'`,
                javascript: `const response = await fetch('${apiUrl}/api/contacts', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${process.env.PROPLY_API_KEY}\`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    workspaceId: 'your-workspace-id',
    name: 'John Smith',
    email: 'john@acmecorp.com',
    company: 'Acme Corp'
  })
});`,
                python: `response = requests.post(
    '${apiUrl}/api/contacts',
    headers={'Authorization': f'Bearer {os.environ["PROPLY_API_KEY"]}'},
    json={
        'workspaceId': 'your-workspace-id',
        'name': 'John Smith',
        'email': 'john@acmecorp.com',
        'company': 'Acme Corp'
    }
)`,
              }}
              responseExample={`{
  "id": "contact-456",
  "name": "John Smith",
  "email": "john@acmecorp.com",
  "company": "Acme Corp",
  "created_at": "2026-03-26T14:30:00Z"
}`}
            />
          </div>

          <div className="border-t border-gray-100 pt-8">
            <EndpointDoc
              method="PATCH"
              endpoint="/api/contacts/:id"
              title="Update Contact"
              description="Update contact information."
              pathParams={[
                { name: "id", type: "string (UUID)", required: true, description: "Contact ID" },
              ]}
              bodyParams={[
                { name: "name", type: "string", required: false, description: "Updated name" },
                { name: "email", type: "string", required: false, description: "Updated email" },
                { name: "company", type: "string", required: false, description: "Updated company" },
              ]}
              requestExample={{
                curl: `curl -X PATCH "${apiUrl}/api/contacts/contact-123" \\
  -H "Authorization: Bearer $PROPLY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"company": "Acme Corporation"}'`,
                javascript: `await fetch('${apiUrl}/api/contacts/contact-123', {
  method: 'PATCH',
  headers: {
    'Authorization': \`Bearer \${process.env.PROPLY_API_KEY}\`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ company: 'Acme Corporation' })
});`,
                python: `requests.patch(
    '${apiUrl}/api/contacts/contact-123',
    headers={'Authorization': f'Bearer {os.environ["PROPLY_API_KEY"]}'},
    json={'company': 'Acme Corporation'}
)`,
              }}
              responseExample={`{
  "id": "contact-123",
  "name": "John Smith",
  "email": "john@acmecorp.com",
  "company": "Acme Corporation",
  "updated_at": "2026-03-26T15:00:00Z"
}`}
            />
          </div>

          <div className="border-t border-gray-100 pt-8">
            <EndpointDoc
              method="DELETE"
              endpoint="/api/contacts/:id"
              title="Delete Contact"
              description="Delete a contact from your workspace."
              pathParams={[
                { name: "id", type: "string (UUID)", required: true, description: "Contact ID" },
              ]}
              requestExample={{
                curl: `curl -X DELETE "${apiUrl}/api/contacts/contact-123" \\
  -H "Authorization: Bearer $PROPLY_API_KEY"`,
                javascript: `await fetch('${apiUrl}/api/contacts/contact-123', {
  method: 'DELETE',
  headers: { 'Authorization': \`Bearer \${process.env.PROPLY_API_KEY}\` }
});`,
                python: `requests.delete(
    '${apiUrl}/api/contacts/contact-123',
    headers={'Authorization': f'Bearer {os.environ["PROPLY_API_KEY"]}'}
)`,
              }}
              responseExample={`{
  "success": true
}`}
            />
          </div>
        </div>
      </section>

      {/* Resources - Signing */}
      <section id="signing" className="scroll-mt-20 pt-16 border-t border-gray-200">
        <div className="mb-4">
          <span className="text-sm text-gray-400 uppercase tracking-wider">Resources</span>
        </div>
        <h2 className="text-3xl font-bold tracking-tight mb-4">Signing</h2>
        <p className="text-lg text-gray-500 mb-8 leading-relaxed">
          Check signing status for documents. The agent handles sending and configuring signatures &mdash; use this endpoint to check on progress.
        </p>

        <EndpointDoc
          method="GET"
          endpoint="/api/documents/:id/signing/status"
          title="Get Signing Status"
          description="Get the current signing status and signer details for a document."
          pathParams={[
            { name: "id", type: "string (UUID)", required: true, description: "Document ID" },
          ]}
          requestExample={{
            curl: `curl -X GET "${apiUrl}/api/documents/doc-550e8400-e29b-41d4/signing/status" \\
  -H "Authorization: Bearer $PROPLY_API_KEY"`,
            javascript: `const response = await fetch('${apiUrl}/api/documents/doc-550e8400-e29b-41d4/signing/status', {
  headers: { 'Authorization': \`Bearer \${process.env.PROPLY_API_KEY}\` }
});

const status = await response.json();`,
            python: `response = requests.get(
    '${apiUrl}/api/documents/doc-550e8400-e29b-41d4/signing/status',
    headers={'Authorization': f'Bearer {os.environ["PROPLY_API_KEY"]}'}
)`,
          }}
          responseExample={`{
  "document_id": "doc-550e8400-e29b-41d4",
  "status": "pending",
  "signers": [
    {
      "email": "john@acmecorp.com",
      "name": "John Smith",
      "role": "client",
      "status": "pending",
      "signed_at": null
    }
  ],
  "created_at": "2026-03-26T14:30:00Z"
}`}
        />
      </section>
    </div>
  );
}

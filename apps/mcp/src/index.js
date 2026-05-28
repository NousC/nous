#!/usr/bin/env node

/**
 * Nous MCP Server — stdio entrypoint (published as @opennous/mcp).
 *
 * Runs locally and is launched by the client via `npx -y @opennous/mcp`. The
 * workspace API key comes from the env. For the hosted, multi-tenant HTTP
 * variant see http.js; the tools themselves live in server.js.
 *
 * Required env:
 *   NOUS_API_KEY   — workspace API key (Settings -> API Keys)
 * Optional:
 *   NOUS_API_URL   — API base URL (default: https://api.opennous.cloud)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { validateConfig } from "./client.js";
import { createServer } from "./server.js";

validateConfig();

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);

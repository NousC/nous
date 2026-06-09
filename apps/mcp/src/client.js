/**
 * Nous API Client
 * Thin HTTP wrapper that handles auth, workspace context, and error handling.
 *
 * The API key is resolved per request: in the hosted HTTP server each request
 * carries its own Bearer key (scoped via AsyncLocalStorage); in the stdio bin
 * there is one key from the env. currentApiKey() checks the ALS store first,
 * then falls back to NOUS_API_KEY, so tool handlers stay key-agnostic.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Resolve an env var defensively — Claude Code plugins use ${user_config.X}
// substitution; when an optional userConfig field is left blank, the literal
// "${user_config.field}" string can leak through. Treat any value that looks
// like an unresolved substitution as missing.
function resolvedEnv(name) {
  const v = process.env[name];
  if (!v) return undefined;
  if (v.includes("${")) return undefined;   // unresolved substitution marker
  return v;
}

const API_URL = resolvedEnv("NOUS_API_URL") || "https://api.opennous.cloud";

// Per-request key context for the hosted HTTP server. Empty in stdio mode.
export const apiKeyStore = new AsyncLocalStorage();

// Run `fn` with `apiKey` bound for the duration of its async execution, so any
// request() call inside it uses that key.
export function runWithApiKey(apiKey, fn) {
  return apiKeyStore.run({ apiKey }, fn);
}

// Credential written by `nous login` (the browser device-auth flow). The CLI and
// the MCP server share ~/.nous/config.json, so a user who runs the login command
// gets a key the MCP picks up on the next call — no paste, no env var.
function fileApiKey() {
  try {
    const dir = resolvedEnv("NOUS_CONFIG_DIR") || path.join(os.homedir(), ".nous");
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
    const k = cfg?.apiKey;
    return k && !String(k).includes("${") ? k : undefined;
  } catch {
    return undefined;
  }
}

function currentApiKey() {
  return apiKeyStore.getStore()?.apiKey ?? resolvedEnv("NOUS_API_KEY") ?? fileApiKey();
}

// stdio-only preflight. A key may come from the env OR from `nous login`'s
// credential file. This is advisory — the server still starts without one so
// the user can run the login command after installing the plugin, and the key
// is resolved per-call.
export function validateConfig() {
  if (!resolvedEnv("NOUS_API_KEY") && !fileApiKey()) {
    throw new Error(
      "No Nous API key found. Run the /nous-login command (or `npx @opennous/cli login`) to sign in, " +
      "or set NOUS_API_KEY."
    );
  }
}

async function request(method, path, { body, query } = {}) {
  const apiKey = currentApiKey();
  if (!apiKey) {
    throw new Error("Missing Nous API key. Pass it as an Authorization: Bearer header.");
  }

  const url = new URL(path, API_URL);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-Nous-Client": "mcp",
  };

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let errorMessage;
    try {
      const err = await res.json();
      errorMessage = err.error || err.message || res.statusText;
    } catch {
      errorMessage = res.statusText;
    }
    throw new Error(`Nous API error (${res.status}): ${errorMessage}`);
  }

  // Some endpoints return empty 204
  if (res.status === 204) return { success: true };

  return res.json();
}

export function get(path, query) {
  return request("GET", path, { query });
}

export function post(path, body) {
  return request("POST", path, { body });
}

export function patch(path, body) {
  return request("PATCH", path, { body });
}

export function del(path) {
  return request("DELETE", path);
}

export { API_URL };

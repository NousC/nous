/**
 * Nous API Client
 * Thin HTTP wrapper that handles auth, workspace context, and error handling.
 */

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
const API_KEY = resolvedEnv("NOUS_API_KEY");

export function validateConfig() {
  if (!API_KEY) {
    throw new Error(
      "NOUS_API_KEY is required. Get yours at opennous.cloud → Settings → API Keys"
    );
  }
}

async function request(method, path, { body, query } = {}) {
  const url = new URL(path, API_URL);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers = {
    Authorization: `Bearer ${API_KEY}`,
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

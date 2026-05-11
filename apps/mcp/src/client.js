/**
 * Proply API Client
 * Thin HTTP wrapper that handles auth, workspace context, and error handling.
 */

const API_URL = process.env.PROPLY_API_URL || "https://api.goproply.com";
const API_KEY = process.env.PROPLY_API_KEY;

export function validateConfig() {
  if (!API_KEY) {
    throw new Error(
      "PROPLY_API_KEY is required. Get yours at goproply.com → Settings → API Keys"
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
    throw new Error(`Proply API error (${res.status}): ${errorMessage}`);
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

// Shared connect handlers for Gmail (Google OAuth) and LinkedIn (Unipile hosted
// auth), extracted from Integrations.tsx so the onboarding wizard and the
// Integrations page drive the exact same flows. Each opens a centered popup and
// reports a definitive connected/not-connected result by re-checking the API on
// close (rather than optimistically assuming success).
import { watchOAuthPopup } from "./oauthPopup";

const API_URL = import.meta.env.VITE_API_URL ?? "";

function openCentered(url: string, name: string) {
  const w = 600, h = 700;
  window.open(
    url,
    name,
    `width=${w},height=${h},left=${window.screenX + (window.outerWidth - w) / 2},top=${window.screenY + (window.outerHeight - h) / 2}`,
  );
}

type ConnArgs = { workspaceId: string; token: string };

/** True if a verified Gmail/Google connection exists for the workspace. */
export async function hasGmailConnection({ workspaceId, token }: ConnArgs): Promise<boolean> {
  try {
    const r = await fetch(`${API_URL}/api/workflow-providers/connections?workspace_id=${workspaceId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return false;
    const d = await r.json();
    return (d.connections ?? []).some(
      (c: { is_verified?: boolean; name?: string; provider?: { name?: string } }) =>
        c.is_verified && /gmail|google/i.test(c.provider?.name || c.name || ""),
    );
  } catch {
    return false;
  }
}

/** True if LinkedIn (Unipile) is connected for the workspace. */
export async function hasLinkedInConnection({ workspaceId, token }: ConnArgs): Promise<boolean> {
  try {
    const r = await fetch(`${API_URL}/api/linkedin/status?workspaceId=${workspaceId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return false;
    const d = await r.json();
    return !!d?.connected;
  } catch {
    return false;
  }
}

/**
 * Kick off Gmail OAuth in a popup. `onResult` fires once with the definitive
 * connected state (re-checked against the API when the popup closes).
 * Throws if the flow can't even be started (e.g. not configured on self-host).
 */
export async function connectGmail({
  workspaceId,
  token,
  connectionName = "Gmail",
  onResult,
}: ConnArgs & { connectionName?: string; onResult: (connected: boolean) => void }): Promise<void> {
  const url = `${API_URL}/api/oauth/google/gmail/authorize?workspaceId=${workspaceId}&connectionName=${encodeURIComponent(connectionName)}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.message || body.error || "Failed to start Gmail connection");
  }
  const data = await resp.json();
  const authUrl = data.authUrl || data.authorization_url;
  if (!authUrl) throw new Error("No authorization URL returned");

  openCentered(authUrl, "gmailOAuth");
  watchOAuthPopup({
    onClose: async () => {
      onResult(await hasGmailConnection({ workspaceId, token }));
    },
  });
}

/**
 * Kick off LinkedIn (Unipile) hosted auth in a popup. `onResult` fires once with
 * the definitive connected state. Throws if the flow can't be started.
 */
export async function connectLinkedIn({
  workspaceId,
  token,
  onResult,
}: ConnArgs & { onResult: (connected: boolean) => void }): Promise<void> {
  const res = await fetch(`${API_URL}/api/linkedin/connect?workspaceId=${workspaceId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || "Couldn't start LinkedIn connection");
  }
  const { url } = await res.json();
  openCentered(url, "LinkedInUnipile");

  let settled = false;
  let cleanup: (() => void) | null = null;
  const finish = async (successHint?: boolean) => {
    if (settled) return;
    settled = true;
    window.removeEventListener("message", onMessage);
    cleanup?.();
    if (successHint) {
      onResult(true);
      return;
    }
    onResult(await hasLinkedInConnection({ workspaceId, token }));
  };
  const onMessage = (e: MessageEvent) => {
    if (e.data?.type !== "linkedin_auth") return;
    void finish(!!e.data.success);
  };
  window.addEventListener("message", onMessage);
  cleanup = watchOAuthPopup({ onClose: () => void finish() });
}

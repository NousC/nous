export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const VALID_PIPELINE_STAGES = ['identified', 'aware', 'interested', 'evaluating', 'client'] as const;

export function isUUID(value: string): boolean {
  return UUID_RE.test(value);
}

export function isEmail(value: string): boolean {
  return value.includes('@');
}

// Returns 'uuid' | 'email' | null
export function identifierType(value: string): 'uuid' | 'email' | null {
  if (isUUID(value)) return 'uuid';
  if (isEmail(value)) return 'email';
  return null;
}

export function normaliseLinkedInUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const m = u.pathname.match(/\/in\/([^/]+)/);
    if (!m) return null;
    return `https://www.linkedin.com/in/${m[1].toLowerCase()}`;
  } catch {
    return null;
  }
}

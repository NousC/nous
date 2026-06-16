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

// A LinkedIn "member URN" URL (/in/ACoAA…) wraps LinkedIn's internal, opaque
// member id. It resolves in a logged-in browser but is NOT a stable public
// vanity handle and is NOT scrapeable by post-search actors. Never treat it as
// a usable linkedin_url identifier.
export function isMemberUrnLinkedInUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const slug = String(raw).match(/\/in\/([^/?#]+)/i)?.[1];
  return !!slug && /^acoaa/i.test(slug);
}

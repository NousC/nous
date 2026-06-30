import type { SupabaseClient } from '@supabase/supabase-js';
import { getClaim, assertClaims } from './claims.js';

// Which team member an account's relationship belongs to. Not a single owner —
// multiple reps can be in touch with the same contact, and seeing that is the
// point (it's the agency anti-collision signal: "you and Akash are both on
// Acme"). So we track everyone in touch in `members`, and derive a `primary`.
//
// Stored as one asserted `relationship_owner` claim on the account entity, value:
//   { primary: <user_id>, members: [{ user_id, label, last_touch, touches }] }
//
// `primary` = whoever engaged most recently (the rep actively on it). Updated at
// ingestion: each attributed touch refreshes that member's row and recomputes
// the primary. Internal accounts (teammates themselves) are never attributed.

export const RELATIONSHIP_OWNER = 'relationship_owner';

export interface RelationshipMember {
  user_id: string;
  label: string | null;
  last_touch: string;   // ISO
  touches: number;
}

export interface RelationshipOwner {
  primary: string;
  members: RelationshipMember[];
}

/**
 * Record that a team member touched an account, and refresh the account's
 * relationship_owner claim. Adds the member to `members` (or bumps their touch
 * count + last_touch), then sets `primary` to whoever touched most recently.
 * Idempotent in shape — call it on every attributable interaction.
 */
export async function attributeRelationship(
  supabase: SupabaseClient,
  workspaceId: string,
  accountEntityId: string,
  ownerUserId: string,
  opts: { at?: string; label?: string | null } = {},
): Promise<void> {
  if (!ownerUserId) return;
  const at = opts.at ?? new Date().toISOString();

  const existing = await getClaim(supabase, workspaceId, accountEntityId, RELATIONSHIP_OWNER);
  const current = (existing?.value as RelationshipOwner | undefined) ?? { primary: ownerUserId, members: [] };
  const members = Array.isArray(current.members) ? [...current.members] : [];

  const idx = members.findIndex(m => m.user_id === ownerUserId);
  if (idx === -1) {
    members.push({ user_id: ownerUserId, label: opts.label ?? null, last_touch: at, touches: 1 });
  } else {
    const m = members[idx];
    members[idx] = {
      user_id: ownerUserId,
      label: opts.label ?? m.label ?? null,
      last_touch: at > m.last_touch ? at : m.last_touch,
      touches: m.touches + 1,
    };
  }

  // Primary = most recent toucher (the rep actively on the relationship).
  const primary = members.reduce((a, b) => (b.last_touch > a.last_touch ? b : a)).user_id;

  await assertClaims(supabase, workspaceId, accountEntityId, {
    values: { [RELATIONSHIP_OWNER]: { primary, members } },
    source: 'attribution',
  });
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { getOrCreateEntity } from './entities.js';
import { assertClaims } from './claims.js';

// Team members are the humans seated on the workspace — the operators, not the
// market. A person who is on your team must never be treated as a prospect: no
// ICP score, no lead list, no outreach. But they still get a fully resolved
// record (their meeting notes, their activity) like any other account.
//
// The signal of truth is the workspace itself. Anyone whose login email is a
// workspace member is internal. We recognise this automatically — flip a matching
// account to internal — rather than asking anyone to tag people by hand.
//
// "internal" is stored as an asserted claim (`is_internal = true`) on the person
// entity. Asserted claims are sticky: the derivation engine never overwrites them
// (see recomputeClaim), so the flag survives every re-derivation. This mirrors the
// buying_role precedent — a declared fact that wins over inference.

export const IS_INTERNAL = 'is_internal';

/** Every seated member's login email on this workspace, normalised to lowercase. */
export async function getWorkspaceMemberEmails(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('workspace_members')
    .select('users:user_id(email)')
    .eq('workspace_id', workspaceId);
  if (error) throw new Error(`failed to load workspace members: ${error.message}`);

  const emails = new Set<string>();
  for (const row of (data as { users?: { email?: string | null } | { email?: string | null }[] } []) ?? []) {
    // PostgREST returns the joined row as an object (to-one) but can type it as
    // an array — normalise both shapes.
    const users = Array.isArray(row.users) ? row.users : row.users ? [row.users] : [];
    for (const u of users) {
      const email = u?.email?.trim().toLowerCase();
      if (email) emails.add(email);
    }
  }
  return [...emails];
}

/** True if this email belongs to a seated workspace member. */
export async function isEmailInternal(
  supabase: SupabaseClient,
  workspaceId: string,
  email: string | null | undefined,
): Promise<boolean> {
  const target = email?.trim().toLowerCase();
  if (!target) return false;
  const emails = await getWorkspaceMemberEmails(supabase, workspaceId);
  return emails.includes(target);
}

/** Mark a person entity as internal (an asserted is_internal=true claim). Idempotent. */
export async function markEntityInternal(
  supabase: SupabaseClient,
  workspaceId: string,
  entityId: string,
): Promise<void> {
  await assertClaims(supabase, workspaceId, entityId, {
    values: { [IS_INTERNAL]: true },
    source: 'team_recognition',
  });
}

/** The entity ids on this workspace currently flagged internal. Used to exclude
 *  team members from scoring, lead lists, and outreach. */
export async function getInternalEntityIds(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('claims')
    .select('entity_id, value')
    .eq('workspace_id', workspaceId)
    .eq('property', IS_INTERNAL)
    .is('invalid_at', null);
  if (error) throw new Error(`failed to load internal entities: ${error.message}`);
  const ids = new Set<string>();
  for (const row of (data as { entity_id: string; value: unknown }[]) ?? []) {
    if (row.value === true) ids.add(row.entity_id);
  }
  return ids;
}

/** True if this single entity is flagged internal. */
export async function isEntityInternal(
  supabase: SupabaseClient,
  workspaceId: string,
  entityId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('claims')
    .select('value')
    .eq('workspace_id', workspaceId)
    .eq('entity_id', entityId)
    .eq('property', IS_INTERNAL)
    .is('invalid_at', null)
    .maybeSingle();
  return (data as { value?: unknown } | null)?.value === true;
}

/**
 * Recognise every team member on this workspace and flag their account as
 * internal. For each member login email we get-or-create the person entity and
 * assert is_internal on it.
 *
 * We CREATE the entity (rather than only flagging pre-existing ones) so a
 * teammate always has a resolved record the moment they are on the workspace.
 * That record is what an internal meeting attaches to (meeting ingestion only
 * resolves contacts that already exist) and what the desktop AIOS pulls internal
 * notes from. The entity is flagged internal, so it is excluded from every GTM
 * surface (scoring, lead lists, outreach) regardless.
 *
 * Idempotent and cheap (workspaces have few members), so it is safe to call at
 * the front of any GTM action and on member-invite as a guard. It also serves as
 * the backfill: the first run flags everyone already in the graph. Returns the
 * number of members recognised this run.
 */
export async function recogniseTeamMembers(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  const emails = await getWorkspaceMemberEmails(supabase, workspaceId);
  let marked = 0;
  for (const email of emails) {
    const entityId = await getOrCreateEntity(supabase, workspaceId, 'person', [
      { kind: 'email', value: email },
    ]);
    await markEntityInternal(supabase, workspaceId, entityId);
    marked++;
  }
  return marked;
}

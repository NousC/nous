import { getSupabaseClient } from '@nous/core';
import { setUser } from 'useleak';

// Short-TTL in-memory cache for the full middleware result. Every authed
// request used to do up to 3 round-trips: supabase.auth.getUser() over the
// network, the public.users lookup, and the workspace_members membership
// check. Caching the resolved (user, internalUserId, hasMembership) tuple
// for 60s drops most requests to zero DB calls.
//
// Memory ceiling: bounded by (active tokens × active workspaces) over 60s,
// which is small even at hundreds of users. A periodic sweep clears
// expired entries so the Map doesn't grow indefinitely.
const AUTH_CACHE_TTL_MS = 60_000;
const authCache = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of authCache) {
    if (v.expiresAt < now) authCache.delete(k);
  }
}, 5 * 60_000).unref?.();

export async function verifySupabaseAuth(req, res, next) {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;

  if (!token) return res.status(401).json({ error: 'auth_required' });

  const workspaceId = req.query.workspaceId || req.query.workspace_id || req.body?.workspaceId || req.body?.workspace_id;
  const cacheKey = `${token}:${workspaceId || ''}`;
  const cached = authCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.invalid) return res.status(401).json({ error: 'invalid_token' });
    if (cached.notMember) return res.status(403).json({ error: 'not_a_member' });
    req.user = cached.user;
    req.supabaseUser = cached.user;
    req.internalUserId = cached.internalUserId;
    if (workspaceId) req.workspaceId = workspaceId;
    setUser({ id: String(cached.user.id), email: cached.user.email });
    return next();
  }

  const supabase = getSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    // Cache the rejection too, briefly — stops a flood of bad-token retries
    // from hammering Supabase auth.
    authCache.set(cacheKey, { expiresAt: Date.now() + 10_000, invalid: true });
    return res.status(401).json({ error: 'invalid_token' });
  }

  req.user = user;
  req.supabaseUser = user;
  setUser({ id: String(user.id), email: user.email });

  // workspace_members stores the internal users.id, not the auth UUID.
  // Resolve the internal user record so membership checks use the right ID.
  const { data: internalUser } = await supabase
    .from('users')
    .select('id, supabase_user_id')
    .eq('supabase_user_id', user.id)
    .maybeSingle();

  let internalUserId = internalUser?.id;

  // Email fallback for migrated users whose supabase_user_id may not be set yet.
  if (!internalUserId && user.email) {
    const { data: byEmail } = await supabase
      .from('users')
      .select('id, supabase_user_id')
      .ilike('email', user.email)
      .maybeSingle();
    if (byEmail) {
      internalUserId = byEmail.id;
      if (!byEmail.supabase_user_id) {
        await supabase.from('users')
          .update({ supabase_user_id: user.id })
          .eq('id', byEmail.id)
          .catch(() => {});
      }
    }
  }

  if (!internalUserId) internalUserId = user.id;
  req.internalUserId = internalUserId;

  // Resolve workspace membership when a workspace is specified
  if (workspaceId) {
    const { data: member } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', internalUserId)
      .maybeSingle();

    if (!member) {
      authCache.set(cacheKey, { expiresAt: Date.now() + AUTH_CACHE_TTL_MS, notMember: true });
      return res.status(403).json({ error: 'not_a_member' });
    }
    req.workspaceId = workspaceId;
  }

  // Cache the success path
  authCache.set(cacheKey, {
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
    user,
    internalUserId,
  });

  next();
}

import { getSupabaseClient } from '@proply/core';

export async function verifySupabaseAuth(req, res, next) {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;

  if (!token) return res.status(401).json({ error: 'auth_required' });

  const supabase = getSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) return res.status(401).json({ error: 'invalid_token' });

  req.user = user;
  req.supabaseUser = user;

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

  // Resolve workspace from query param or body (accept both camelCase and snake_case)
  const workspaceId = req.query.workspaceId || req.query.workspace_id || req.body?.workspaceId || req.body?.workspace_id;
  if (workspaceId) {
    const { data: member } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', internalUserId)
      .maybeSingle();

    if (!member) return res.status(403).json({ error: 'not_a_member' });
    req.workspaceId = workspaceId;
  }

  next();
}

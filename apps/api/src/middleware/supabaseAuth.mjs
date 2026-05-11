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

  // Resolve workspace from query param or body
  const workspaceId = req.query.workspaceId || req.body?.workspaceId;
  if (workspaceId) {
    // Verify membership
    const { data: member } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!member) return res.status(403).json({ error: 'not_a_member' });
    req.workspaceId = workspaceId;
  }

  next();
}

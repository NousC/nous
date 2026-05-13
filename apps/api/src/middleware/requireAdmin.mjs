import { getSupabaseClient } from '@proply/core';

/**
 * Middleware to verify admin access.
 * Requires verifySupabaseAuth to run first (attaches req.user).
 */
export async function requireAdmin(req, res, next) {
  try {
    const supabase = getSupabaseClient();
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: 'auth_required' });
    }

    // Check users.is_admin field
    const { data: userData, error } = await supabase
      .from('users')
      .select('is_admin, id, email, name, team_id')
      .eq('id', user.id)
      .single();

    if (error || !userData || !userData.is_admin) {
      return res.status(403).json({ error: 'forbidden', message: 'Admin access required' });
    }

    req.adminUser = userData;
    next();
  } catch (err) {
    console.error('[REQUIRE_ADMIN]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}

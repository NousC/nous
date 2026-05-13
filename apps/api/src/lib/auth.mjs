import { getSupabaseClient } from '@proply/core';

// Shared in-memory auth cache (5 min TTL)
const authCache = new Map();
const AUTH_CACHE_TTL_MS = 5 * 60 * 1000;

export async function ensureUserAndTeam(supabaseUser, skipTeamCreation = false) {
  const supabase = getSupabaseClient();
  const { id: supabaseUserId, email, user_metadata } = supabaseUser;
  const name = user_metadata?.name || user_metadata?.full_name || email?.split('@')[0] || 'User';
  const avatarUrl = user_metadata?.avatar_url || user_metadata?.picture || null;

  let { data: existingUser, error: userSelectError } = await supabase
    .from('users')
    .select('*, team:team_id(*)')
    .eq('supabase_user_id', supabaseUserId)
    .maybeSingle();

  if (userSelectError) throw new Error(`Error loading user: ${userSelectError.message}`);

  // Email fallback: migrated users may have supabase_user_id unset on their existing record.
  // Find them by email and backfill supabase_user_id so future lookups work without this fallback.
  if (!existingUser && email) {
    const { data: byEmail } = await supabase
      .from('users')
      .select('*, team:team_id(*)')
      .ilike('email', email)
      .maybeSingle();

    if (byEmail) {
      existingUser = byEmail;
      if (!byEmail.supabase_user_id) {
        await supabase.from('users')
          .update({ supabase_user_id: supabaseUserId })
          .eq('id', byEmail.id)
          .catch(() => {});
        existingUser = { ...byEmail, supabase_user_id: supabaseUserId };
      }
    }
  }

  let user = existingUser;
  let team = existingUser?.team;

  if (existingUser && !existingUser.profile_picture_url && avatarUrl) {
    supabase.from('users').update({ profile_picture_url: avatarUrl }).eq('id', existingUser.id)
      .then(() => { existingUser.profile_picture_url = avatarUrl; })
      .catch(() => {});
  }

  if (!user && !skipTeamCreation) {
    const { data: pendingInvitation } = await supabase
      .from('team_invitations')
      .select('team_id, email')
      .eq('email', email.toLowerCase())
      .eq('status', 'pending')
      .maybeSingle();

    if (pendingInvitation) {
      const { data: newUser, error: createUserError } = await supabase
        .from('users')
        .insert({
          supabase_user_id: supabaseUserId,
          email,
          name,
          team_id: pendingInvitation.team_id,
          ...(avatarUrl && { profile_picture_url: avatarUrl }),
        })
        .select()
        .single();

      if (createUserError) {
        if (createUserError.code === '23505') {
          const { data: eu } = await supabase.from('users').select('*, team:team_id(*)').eq('supabase_user_id', supabaseUserId).single();
          if (!eu) throw new Error('Error loading user after race condition');
          return { user: eu, team: eu.team };
        }
        throw new Error(`Error creating user: ${createUserError.message}`);
      }

      const { data: invitedTeam } = await supabase.from('teams').select('*').eq('id', pendingInvitation.team_id).single();
      return { user: newUser, team: invitedTeam };
    }

    // No pending invitation — create team + user (founder)
    const teamName = name ? `${name}'s Team` : 'My Team';
    const { data: newTeam, error: teamError } = await supabase.from('teams').insert({ name: teamName }).select().single();
    if (teamError) throw new Error(`Error creating team: ${teamError.message}`);
    team = newTeam;

    const { data: newUser, error: createUserError } = await supabase
      .from('users')
      .insert({
        supabase_user_id: supabaseUserId,
        email,
        name,
        team_id: team.id,
        ...(avatarUrl && { profile_picture_url: avatarUrl }),
      })
      .select()
      .single();

    if (createUserError) {
      if (createUserError.code === '23505') {
        await supabase.from('teams').delete().eq('id', newTeam.id).catch(() => {});
        const { data: eu } = await supabase.from('users').select('*, team:team_id(*)').eq('supabase_user_id', supabaseUserId).single();
        if (!eu) throw new Error('Error loading user after race condition');
        return { user: eu, team: eu.team };
      }
      throw new Error(`Error creating user: ${createUserError.message}`);
    }

    user = newUser;

    await supabase.from('team_members').insert({ team_id: team.id, user_id: user.id, role: 'founder' }).catch(e =>
      console.warn('[ensureUserAndTeam] Error adding founder to team_members:', e)
    );

    const { data: newWorkspace } = await supabase
      .from('workspaces')
      .insert({ team_id: team.id, name: name || 'My Workspace', icon: null })
      .select()
      .single();

    if (newWorkspace) {
      await supabase.from('workspace_members').insert({ workspace_id: newWorkspace.id, user_id: user.id, role: 'owner' }).catch(() => {});
    }

    // Create dev plan subscription
    await supabase.from('subscriptions').insert({
      team_id: team.id,
      plan_name: 'dev',
      status: 'active',
      current_period_start: new Date().toISOString(),
    }).catch(e => console.warn('[ensureUserAndTeam] Error creating subscription:', e));
  }

  return { user, team };
}

export async function getAuthContext(req, requiredWorkspaceId = null) {
  const supabase = getSupabaseClient();
  if (req.isApiKeyAuth) {
    const workspaceId = requiredWorkspaceId || req.apiKeyWorkspaceId;
    if (!workspaceId) throw new Error('workspaceId is required when using API key authentication');

    const { data: workspace } = await supabase.from('workspaces').select('id, team_id, name').eq('id', workspaceId).single();
    if (!workspace) throw new Error('workspace_not_found');

    const { data: team } = await supabase.from('teams').select('*').eq('id', workspace.team_id).single();
    if (!team) throw new Error('team_not_found');

    if (req.apiKeyWorkspaceId !== workspaceId) throw new Error('unauthorized: API key does not have access to this workspace');

    return { user: null, team, workspaceId, teamId: team.id, isApiKeyAuth: true };
  } else {
    const { user, team } = await ensureUserAndTeam(req.user);
    const workspaceId = requiredWorkspaceId || req.workspaceId;
    return { user, team, workspaceId, teamId: team?.id, isApiKeyAuth: false };
  }
}

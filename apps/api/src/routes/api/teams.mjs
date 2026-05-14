import { Router } from 'express';
import crypto from 'crypto';
import { getSupabaseClient } from '@proply/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';
import { ensureUserAndTeam } from '../../lib/auth.mjs';

async function sendInviteEmail({ to, inviterName, teamName, token }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const appDomain = process.env.APP_DOMAIN || 'app.goproply.com';
  const link = `https://${appDomain}/accept-invitation?token=${token}`;
  const from = process.env.RESEND_FROM_EMAIL || 'Proply <noreply@goproply.com>';
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `You've been invited to join ${teamName} on Proply`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111">
            <p style="margin:0 0 16px">Hi,</p>
            <p style="margin:0 0 24px"><strong>${inviterName}</strong> has invited you to join <strong>${teamName}</strong> on Proply — the AI-powered CRM.</p>
            <a href="${link}" style="display:inline-block;background:#0d9488;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Accept Invitation</a>
            <p style="margin:24px 0 0;color:#666;font-size:13px">This link expires in 7 days. If you weren't expecting this email, you can safely ignore it.</p>
          </div>
        `,
      }),
    });
  } catch (err) {
    console.error('[INVITE_EMAIL] Failed to send:', err.message);
  }
}

export const teamsRouter = Router();

async function checkTeamMembership(userId, teamId, requiredRoles = ['founder', 'owner', 'admin', 'member', 'viewer']) {
  const supabase = getSupabaseClient();
  const { data: membership } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).maybeSingle();
  if (!membership) {
    const { data: u } = await supabase.from('users').select('team_id').eq('id', userId).single();
    if (!u || u.team_id !== teamId) return null;
    const { data: fc } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).eq('role', 'founder').maybeSingle();
    return fc || { role: 'owner' };
  }
  return requiredRoles.includes(membership.role) ? membership : null;
}

// PATCH /api/teams/:teamId
teamsRouter.patch('/:teamId', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { teamId } = req.params;
    const { name } = req.body;
    const { user, team } = await ensureUserAndTeam(req.user);
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    if (team.id !== teamId) return res.status(403).json({ error: 'team_not_found_or_unauthorized' });
    const { data: updatedTeam, error } = await supabase.from('teams').update({ name: name.trim() }).eq('id', teamId).select().single();
    if (error) throw error;
    return res.json({ team: updatedTeam });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

// GET /api/teams/:teamId/members
teamsRouter.get('/:teamId/members', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { teamId } = req.params;
    const { user } = await ensureUserAndTeam(req.user);
    const membership = await checkTeamMembership(user.id, teamId);
    if (!membership) return res.status(403).json({ error: 'team_not_found_or_unauthorized' });

    const { data: members } = await supabase.from('team_members')
      .select('*, users:user_id(id, name, email, profile_picture_url)')
      .eq('team_id', teamId)
      .order('joined_at', { ascending: true });

    return res.json({ members: members || [] });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

// DELETE /api/teams/:teamId/members/:userId
teamsRouter.delete('/:teamId/members/:userId', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { teamId, userId } = req.params;
    const { user } = await ensureUserAndTeam(req.user);

    const membership = await checkTeamMembership(user.id, teamId, ['founder', 'owner', 'admin']);
    if (!membership) return res.status(403).json({ error: 'insufficient_permissions' });

    const { data: target } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).maybeSingle();
    if (target?.role === 'founder') return res.status(400).json({ error: 'cannot_remove_founder' });
    if (userId === user.id) return res.status(400).json({ error: 'cannot_remove_self' });

    await supabase.from('team_members').delete().eq('team_id', teamId).eq('user_id', userId);

    const { data: workspaces } = await supabase.from('workspaces').select('id').eq('team_id', teamId);
    if (workspaces?.length) {
      await supabase.from('workspace_members').delete().in('workspace_id', workspaces.map(w => w.id)).eq('user_id', userId);
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

// GET /api/teams/:teamId/workspaces
teamsRouter.get('/:teamId/workspaces', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { teamId } = req.params;
    const { user } = await ensureUserAndTeam(req.user);
    const membership = await checkTeamMembership(user.id, teamId, ['founder', 'owner', 'admin']);
    if (!membership) return res.status(403).json({ error: 'insufficient_permissions' });

    const { data: workspaces } = await supabase.from('workspaces').select('*').eq('team_id', teamId).order('created_at', { ascending: false });
    const { data: teamMembers } = await supabase.from('team_members').select('*, users:user_id(id, name, email, profile_picture_url)').eq('team_id', teamId);
    const workspaceIds = (workspaces || []).map(w => w.id);
    let wsMembers = [];
    if (workspaceIds.length) {
      const { data } = await supabase.from('workspace_members').select('workspace_id, user_id, role').in('workspace_id', workspaceIds);
      wsMembers = data || [];
    }

    const workspacesWithAccess = (workspaces || []).map(ws => ({
      ...ws,
      members: (teamMembers || []).map(m => ({
        ...m,
        has_workspace_access: wsMembers.some(wm => wm.workspace_id === ws.id && wm.user_id === m.user_id),
        workspace_role: wsMembers.find(wm => wm.workspace_id === ws.id && wm.user_id === m.user_id)?.role || null,
      })),
    }));

    return res.json({ workspaces: workspacesWithAccess });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

// POST /api/teams/:teamId/invitations
teamsRouter.post('/:teamId/invitations', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { teamId } = req.params;
    const { email, role = 'member' } = req.body;
    const { user } = await ensureUserAndTeam(req.user);

    if (!email?.trim()) return res.status(400).json({ error: 'email is required' });
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return res.status(400).json({ error: 'invalid_email_format' });
    if (!['founder', 'owner', 'admin', 'member', 'viewer'].includes(role)) return res.status(400).json({ error: 'invalid_role' });

    const membership = await checkTeamMembership(user.id, teamId, ['founder', 'owner', 'admin']);
    if (!membership) return res.status(403).json({ error: 'insufficient_permissions' });

    const { data: existing } = await supabase.from('team_invitations').select('id').eq('team_id', teamId).eq('email', normalizedEmail).eq('status', 'pending').maybeSingle();
    if (existing) return res.status(400).json({ error: 'invitation_already_exists' });

    const token = crypto.randomBytes(32).toString('hex');
    const { data: invitation, error } = await supabase.from('team_invitations')
      .insert({ team_id: teamId, email: normalizedEmail, token, invited_by_user_id: user.id, role, status: 'pending', expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() })
      .select().single();
    if (error) throw error;

    const { data: teamData } = await supabase.from('teams').select('name').eq('id', teamId).single();
    const emailSent = await sendInviteEmail({
      to: normalizedEmail,
      inviterName: user.name || user.email,
      teamName: teamData?.name || 'Your Team',
      token,
    }).then(() => true).catch(() => false);

    return res.json({ invitation: { id: invitation.id, email: invitation.email, role: invitation.role, status: invitation.status, expires_at: invitation.expires_at, created_at: invitation.created_at }, emailSent });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

// GET /api/teams/:teamId/invitations
teamsRouter.get('/:teamId/invitations', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { teamId } = req.params;
    const { user } = await ensureUserAndTeam(req.user);
    const membership = await checkTeamMembership(user.id, teamId, ['founder', 'owner', 'admin']);
    if (!membership) return res.status(403).json({ error: 'insufficient_permissions' });

    const { data: invitations } = await supabase.from('team_invitations')
      .select('*, invited_by:invited_by_user_id(id, name, email)')
      .eq('team_id', teamId).order('created_at', { ascending: false });
    return res.json({ invitations: invitations || [] });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

// DELETE /api/teams/:teamId/invitations/:invitationId
teamsRouter.delete('/:teamId/invitations/:invitationId', verifySupabaseAuth, async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { teamId, invitationId } = req.params;
    const { user } = await ensureUserAndTeam(req.user);
    const membership = await checkTeamMembership(user.id, teamId, ['founder', 'owner', 'admin']);
    if (!membership) return res.status(403).json({ error: 'insufficient_permissions' });

    const { data: invitation } = await supabase.from('team_invitations').select('id, status').eq('id', invitationId).eq('team_id', teamId).maybeSingle();
    if (!invitation) return res.status(404).json({ error: 'invitation_not_found' });
    if (invitation.status !== 'pending') return res.status(400).json({ error: 'invitation_already_processed' });

    await supabase.from('team_invitations').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', invitationId);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', ...(process.env.NODE_ENV !== 'production' && { detail: String(err.message) }) });
  }
});

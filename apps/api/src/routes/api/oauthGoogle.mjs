import { Router } from 'express';
import crypto from 'crypto';
import { google } from 'googleapis';
import { getSupabaseClient } from '@proply/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';
import { encrypt } from '../../utils/crypto.mjs';

export const oauthGoogleRouter = Router();

// In-memory CSRF state store (10-min TTL)
const oauthStates = new Map();
setInterval(() => {
  const cutoff = Date.now() - 600_000;
  for (const [k, v] of oauthStates) if (v.timestamp < cutoff) oauthStates.delete(k);
}, 60_000);

function makeOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URI,
  );
}

// GET /api/oauth/google/gmail/authorize  — authenticated, returns authUrl
oauthGoogleRouter.get('/gmail/authorize', verifySupabaseAuth, async (req, res) => {
  const { workspaceId, connectionName } = req.query;
  if (!workspaceId || !connectionName) return res.status(400).json({ error: 'workspace_id_and_name_required' });
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'google_oauth_not_configured' });

  const state = crypto.randomBytes(32).toString('hex');
  oauthStates.set(state, { workspaceId, connectionName, userId: req.supabaseUser.id, timestamp: Date.now() });

  const authUrl = makeOAuth2Client().generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/calendar.readonly',
    ],
    state,
    prompt: 'consent',
  });

  return res.json({ authUrl });
});

// GET /api/oauth/google/callback  — no auth, redirect from Google
oauthGoogleRouter.get('/callback', async (req, res) => {
  const frontendUrl = process.env.APP_URL || `https://${process.env.APP_DOMAIN}` || 'https://app.goproply.com';
  const { code, state, error: oauthError } = req.query;

  if (oauthError) return res.redirect(`${frontendUrl}/oauth-callback.html?oauth_error=${oauthError}`);
  if (!code || !state) return res.redirect(`${frontendUrl}/oauth-callback.html?oauth_error=missing_code_or_state`);

  const stateData = oauthStates.get(state);
  if (!stateData) return res.redirect(`${frontendUrl}/oauth-callback.html?oauth_error=invalid_state`);
  oauthStates.delete(state);

  try {
    const client = makeOAuth2Client();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const { data: userInfo } = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();

    const supabase = getSupabaseClient();
    const { data: provider } = await supabase.from('workflow_providers').select('id').eq('name', 'gmail_oauth').single();
    if (!provider) throw new Error('Gmail OAuth provider not found in database');

    const { data: connection, error: insertErr } = await supabase
      .from('workflow_provider_connections')
      .insert({
        workspace_id: stateData.workspaceId,
        provider_id: provider.id,
        name: stateData.connectionName,
        encrypted_credentials: {
          access_token:  encrypt(tokens.access_token),
          refresh_token: encrypt(tokens.refresh_token),
          token_expiry:  new Date(tokens.expiry_date).toISOString(),
          email:         userInfo.email,
          scope:         tokens.scope,
        },
        created_by: stateData.userId,
        is_verified: true,
        last_test_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertErr) throw insertErr;

    console.log('[GOOGLE_OAUTH] Connected:', userInfo.email, 'connection:', connection.id);
    return res.redirect(`${frontendUrl}/oauth-callback.html?oauth_success=true&connection_id=${connection.id}`);
  } catch (err) {
    console.error('[GOOGLE_OAUTH_CALLBACK_ERROR]', err.message);
    return res.redirect(`${frontendUrl}/oauth-callback.html?oauth_error=callback_failed&error_message=${encodeURIComponent(err.message)}`);
  }
});

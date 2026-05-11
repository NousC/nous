// Google OAuth token refresh utility.
// Decrypts stored credentials and refreshes the access token if within 5 minutes of expiry.

import { google } from 'googleapis';
import { decrypt } from './encryption.mjs';

export async function refreshGoogleToken(encryptedCredentials) {
  const creds = {};
  for (const [key, value] of Object.entries(encryptedCredentials)) {
    creds[key] = typeof value === 'string' ? decrypt(value) : value;
  }

  const expiresAt = creds.expiry_date ? parseInt(creds.expiry_date) : 0;
  const needsRefresh = !creds.access_token || (expiresAt && expiresAt - Date.now() < 5 * 60 * 1000);

  if (!needsRefresh) {
    return { credentials: creds, needsUpdate: false, updatedCredentials: null };
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URI,
  );
  oauth2Client.setCredentials({ refresh_token: creds.refresh_token });

  const { credentials: refreshed } = await oauth2Client.refreshAccessToken();
  const merged = { ...creds, ...refreshed };

  // Re-encrypt updated credentials for storage
  const { encrypt } = await import('./encryption.mjs');
  const updatedCredentials = {};
  for (const [key, value] of Object.entries(merged)) {
    updatedCredentials[key] = typeof value === 'string' ? encrypt(value) : value;
  }

  return { credentials: merged, needsUpdate: true, updatedCredentials };
}

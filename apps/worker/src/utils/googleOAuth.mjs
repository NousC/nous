// Google OAuth token refresh utility.
// Decrypts stored credentials and refreshes the access token if within 5 minutes of expiry.

import { google } from 'googleapis';
import { decrypt } from './encryption.mjs';

export async function refreshGoogleToken(encryptedCredentials) {
  if (!encryptedCredentials || typeof encryptedCredentials !== 'object') {
    throw new Error('invalid_credentials: encrypted_credentials is missing or not an object');
  }
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY not set — add it to nous.env');
  }
  const creds = {};
  for (const [key, value] of Object.entries(encryptedCredentials)) {
    creds[key] = typeof value === 'string' ? decrypt(value) : value;
  }

  // Resolve expiry from either field name + format we might find:
  //   - expiry_date: unix-ms number (canonical, what googleapis returns)
  //   - token_expiry: legacy ISO-string from older callback handler
  let expiresAt = 0;
  if (creds.expiry_date) {
    expiresAt = parseInt(creds.expiry_date);
  } else if (creds.token_expiry) {
    expiresAt = new Date(creds.token_expiry).getTime() || 0;
  }

  // Refresh if: no access token, OR within 5 min of expiry, OR expiry is unknown
  // (the last case is critical — older rows have neither field and would otherwise
  // never refresh, causing tokens to silently expire after Google's 1hr default.)
  const needsRefresh =
    !creds.access_token ||
    (expiresAt > 0 && expiresAt - Date.now() < 5 * 60 * 1000) ||
    expiresAt === 0;

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

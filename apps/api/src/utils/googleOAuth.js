import { google } from 'googleapis';
import { encrypt, decrypt } from './encryption.js';

/**
 * Refresh Google OAuth access token if expired
 * @param {Object} encryptedCredentials - Connection credentials from database
 * @returns {Promise<Object>} { credentials, needsUpdate, updatedCredentials }
 */
export async function refreshGoogleTokenIfNeeded(encryptedCredentials) {
  try {
    const accessToken = decrypt(encryptedCredentials.access_token);
    const refreshToken = decrypt(encryptedCredentials.refresh_token);
    const tokenExpiry = new Date(encryptedCredentials.token_expiry);

    // Check if token expires in next 5 minutes
    const now = new Date();
    const bufferTime = 5 * 60 * 1000; // 5 minutes

    if (now.getTime() < tokenExpiry.getTime() - bufferTime) {
      // Token still valid
      console.log('[GMAIL_TOKEN_REFRESH] Token still valid, expires:', tokenExpiry.toISOString());
      return {
        credentials: {
          access_token: accessToken,
          refresh_token: refreshToken,
          email: encryptedCredentials.email
        },
        needsUpdate: false
      };
    }

    console.log('[GMAIL_TOKEN_REFRESH] Token expired or expiring soon, refreshing...');

    // Refresh token
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_OAUTH_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      refresh_token: refreshToken
    });

    const { credentials } = await oauth2Client.refreshAccessToken();
    const newExpiry = new Date(credentials.expiry_date);

    console.log('[GMAIL_TOKEN_REFRESH] Success, new expiry:', newExpiry.toISOString());

    // Return new encrypted credentials for database update
    const updatedCredentials = {
      access_token: encrypt(credentials.access_token),
      refresh_token: encrypt(refreshToken), // Refresh token doesn't change
      token_expiry: newExpiry.toISOString(),
      email: encryptedCredentials.email,
      scope: credentials.scope || encryptedCredentials.scope
    };

    return {
      credentials: {
        access_token: credentials.access_token,
        refresh_token: refreshToken,
        email: encryptedCredentials.email
      },
      needsUpdate: true,
      updatedCredentials
    };

  } catch (error) {
    console.error('[GMAIL_TOKEN_REFRESH_ERROR]', error.message);

    // If refresh fails, token may be revoked
    if (error.message?.includes('invalid_grant')) {
      throw new Error('Gmail OAuth token revoked. Please reconnect your account.');
    }

    throw error;
  }
}

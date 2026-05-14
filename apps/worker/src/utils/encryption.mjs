// AES-256-GCM encryption for storing OAuth credentials at rest.
// ENCRYPTION_KEY must be a 32-byte hex string (64 hex chars).

import crypto from 'crypto';

const KEY = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');

export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(encryptedText) {
  if (!encryptedText || typeof encryptedText !== 'string') return encryptedText;
  const parts = encryptedText.split(':');

  if (parts.length === 3) {
    // AES-256-GCM format (this module's encrypt): iv:tag:data
    if (!KEY.length) throw new Error('ENCRYPTION_KEY not set — cannot decrypt credentials');
    const [ivHex, tagHex, dataHex] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(Buffer.from(dataHex, 'hex')) + decipher.final('utf8');
  }

  if (parts.length === 2 && /^[0-9a-f]{32}$/i.test(parts[0])) {
    // AES-256-CBC format (API's crypto.mjs encrypt): iv:data
    // Used for credentials stored by the API (Google OAuth, Slack OAuth, etc.)
    if (!KEY.length) throw new Error('ENCRYPTION_KEY not set — cannot decrypt credentials');
    const CBC_KEY = Buffer.from((process.env.ENCRYPTION_KEY || '').slice(0, 64).padEnd(64, '0'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', CBC_KEY, Buffer.from(parts[0], 'hex'));
    return decipher.update(parts[1], 'hex', 'utf8') + decipher.final('utf8');
  }

  // Not an encrypted value — return as-is (scope strings, URLs, plain text fields)
  return encryptedText;
}

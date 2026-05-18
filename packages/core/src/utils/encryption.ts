// Decrypts credentials encrypted by either the API (AES-256-CBC) or the worker (AES-256-GCM).
// Plain strings (instance_url, scope, ISO dates) pass through unchanged so callers can iterate
// the whole encrypted_credentials JSON without special-casing each field.

import crypto from 'crypto';

const RAW = process.env.ENCRYPTION_KEY || '';
const CBC_KEY = RAW ? Buffer.from(RAW.slice(0, 64).padEnd(64, '0'), 'hex') : null;
const GCM_KEY = RAW ? Buffer.from(RAW, 'hex') : null;

export function decrypt(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return value ?? null;
  const parts = value.split(':');

  // CBC: iv(16B=32hex):data
  if (parts.length === 2 && /^[0-9a-f]{32}$/i.test(parts[0]) && CBC_KEY) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-cbc', CBC_KEY, Buffer.from(parts[0], 'hex'));
      return decipher.update(parts[1], 'hex', 'utf8') + decipher.final('utf8');
    } catch { return value; }
  }

  // GCM (new worker format): iv(12B=24hex):tag(16B=32hex):data
  if (parts.length === 3 && parts[0].length === 24 && GCM_KEY?.length) {
    try {
      const [ivHex, tagHex, dataHex] = parts;
      const decipher = crypto.createDecipheriv('aes-256-gcm', GCM_KEY, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      return decipher.update(Buffer.from(dataHex, 'hex')) + decipher.final('utf8');
    } catch { return value; }
  }

  // Old GCM (legacy api/utils/encryption.js): iv(16B=32hex):data:tag(16B=32hex)
  if (parts.length === 3 && /^[0-9a-f]{32}$/i.test(parts[0]) && /^[0-9a-f]{32}$/i.test(parts[2]) && GCM_KEY?.length) {
    try {
      const [ivHex, dataHex, tagHex] = parts;
      const decipher = crypto.createDecipheriv('aes-256-gcm', GCM_KEY, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      return decipher.update(Buffer.from(dataHex, 'hex')) + decipher.final('utf8');
    } catch { return value; }
  }

  return value;  // not encrypted (plain instance_url, scope, etc.)
}

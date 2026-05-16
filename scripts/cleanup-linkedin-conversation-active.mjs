// One-time cleanup: delete all "LinkedIn conversation active" activity log entries.
// Run with: node scripts/cleanup-linkedin-conversation-active.mjs

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env manually
const env = Object.fromEntries(
  readFileSync(resolve(process.cwd(), '.env'), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const URL  = env.SUPABASE_URL;
const KEY  = env.SUPABASE_SERVICE_ROLE_KEY;
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'count=exact' };

// Count first
const countRes = await fetch(
  `${URL}/rest/v1/contact_activity_log?source=eq.linkedin&description=like.LinkedIn+conversation+active%25&select=id`,
  { headers: { ...HEADERS, Prefer: 'count=exact' }, method: 'HEAD' }
);
const total = parseInt(countRes.headers.get('content-range')?.split('/')[1] ?? '0', 10);
console.log(`Found ${total} "LinkedIn conversation active" entries.`);
if (!total) { console.log('Nothing to delete.'); process.exit(0); }

// Delete
const delRes = await fetch(
  `${URL}/rest/v1/contact_activity_log?source=eq.linkedin&description=like.LinkedIn+conversation+active%25`,
  { method: 'DELETE', headers: { ...HEADERS, Prefer: 'return=minimal' } }
);

if (!delRes.ok) {
  console.error('Delete failed:', delRes.status, await delRes.text());
  process.exit(1);
}

console.log(`Done — deleted ${total} entries.`);

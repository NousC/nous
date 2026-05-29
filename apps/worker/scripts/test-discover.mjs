// TEST: name-based email discovery against the workspace's real Gmail + IMAP.
// Runs discoverEmailForContact on emailless LinkedIn contacts. Usage:
//   node apps/worker/scripts/test-discover.mjs [N]
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new URL('../../../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { getSupabaseClient } = await import('@nous/core');
const { discoverEmailForContact } = await import('../src/utils/discoverEmail.mjs');

const WS = '9caa9db9-000c-43d3-895b-14f4aedffb5f';
const LIMIT = Number(process.argv[2] || 15);
const supabase = getSupabaseClient();

// Which mailboxes are connected?
const { data: conns } = await supabase
  .from('workflow_provider_connections')
  .select('is_verified, workflow_providers!inner(name)')
  .eq('workspace_id', WS).eq('is_verified', true);
const names = (conns || []).map(c => c.workflow_providers?.name);
console.log('Connected & verified providers:', names.join(', ') || '(none)');
console.log(`  gmail_oauth: ${names.includes('gmail_oauth') ? 'YES' : 'no'}   smtp/IMAP: ${names.includes('smtp') ? 'YES' : 'no'}\n`);

const { data: contacts } = await supabase.from('contacts')
  .select('id, first_name, last_name, email, linkedin_url, company')
  .eq('workspace_id', WS)
  .not('linkedin_member_id', 'is', null)
  .is('email', null)
  .limit(LIMIT);

console.log(`Scanning ${contacts?.length || 0} emailless LinkedIn contact(s) by name...\n`);

let found = 0;
for (const c of contacts || []) {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || '(no name)';
  const r = await discoverEmailForContact(supabase, WS, c);
  if (r.found) {
    found++;
    console.log(`✓ ${name.padEnd(26)} → ${r.email}  [${r.source}, ${r.hits} hit/s]  matched "${r.evidence?.name}" · "${(r.evidence?.subject || '').slice(0, 45)}"`);
  } else {
    console.log(`· ${name.padEnd(26)} → no match (${r.reason}${r.scanned != null ? `, ${r.scanned} candidate rows` : ''})`);
  }
}
console.log(`\nDone. emails discovered: ${found}/${contacts?.length || 0}`);
process.exit(0);

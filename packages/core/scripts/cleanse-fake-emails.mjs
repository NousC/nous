// Cleanse placeholder emails (e.g. saiiful-...@linkedin.import) from a workspace.
// DB-only, no LinkedIn calls. Nulls contacts.email and removes the matching fake
// rows from entity_identifiers so identity resolution never keys on garbage. The
// record keeps its linkedin_url / linkedin_member_id as its real anchor.
// Usage: node packages/core/scripts/cleanse-fake-emails.mjs [--apply]
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
for (const line of readFileSync(new URL('../../../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const WS = '9caa9db9-000c-43d3-895b-14f4aedffb5f'; // Nous (was "Proply WS")
const APPLY = process.argv.includes('--apply');
const FAKE_DOMAINS = ['import', 'csv', 'fake', 'test', 'example', 'placeholder', 'noemail'];

// contacts with a fake email
const { data: contacts } = await supabase
  .from('contacts')
  .select('id, email')
  .eq('workspace_id', WS);
const fakeContacts = (contacts || []).filter(c => c.email && FAKE_DOMAINS.some(d => c.email.toLowerCase().endsWith('.' + d)));

// fake email identifiers
const { data: idents } = await supabase
  .from('entity_identifiers')
  .select('id, value')
  .eq('workspace_id', WS)
  .eq('kind', 'email');
const fakeIdents = (idents || []).filter(i => i.value && FAKE_DOMAINS.some(d => i.value.toLowerCase().endsWith('.' + d)));

console.log(`Workspace ${WS}`);
console.log(`  contacts with fake email     : ${fakeContacts.length}`);
console.log(`  fake email entity_identifiers: ${fakeIdents.length}`);
console.log(fakeContacts.slice(0, 50).map(c => `    - ${c.email}`).join('\n'));

if (!APPLY) {
  console.log('\nDRY RUN — re-run with --apply to null these emails and delete the fake identifiers.');
  process.exit(0);
}

let nulled = 0;
for (const c of fakeContacts) {
  const { error } = await supabase.from('contacts').update({ email: null }).eq('id', c.id);
  if (!error) nulled++;
  else console.error('  update failed', c.id, error.message);
}
let deleted = 0;
if (fakeIdents.length) {
  const { error } = await supabase.from('entity_identifiers').delete().in('id', fakeIdents.map(i => i.id));
  if (!error) deleted = fakeIdents.length;
  else console.error('  identifier delete failed:', error.message);
}
console.log(`\nAPPLIED — nulled ${nulled} email(s), deleted ${deleted} fake identifier(s).`);
process.exit(0);

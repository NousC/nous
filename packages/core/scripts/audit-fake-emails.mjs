// READ-ONLY audit: find contacts with placeholder/fake emails in a workspace and
// report how many are enrichable (have a LinkedIn member_id or URL).
// Usage: node scripts/audit-fake-emails.mjs ["Workspace Name"]
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// Load .env (simple parse — no deps)
for (const line of readFileSync(new URL('../../../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const wsQuery = process.argv[2] || 'Proply';

const { data: workspaces } = await supabase.from('workspaces').select('id, name').ilike('name', `%${wsQuery}%`);
if (!workspaces?.length) {
  const { data: all } = await supabase.from('workspaces').select('id, name').limit(50);
  console.log(`No workspace matched "${wsQuery}". Available:`);
  for (const w of all || []) console.log(`  ${w.id}  ${w.name}`);
  process.exit(0);
}
console.log(`Matched workspaces:`);
for (const w of workspaces) console.log(`  ${w.id}  ${w.name}`);

const FAKE = /@.*\.(import|csv|fake|test|example|placeholder|noemail)$/i;

for (const ws of workspaces) {
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, email, linkedin_url, linkedin_member_id, job_title, company, icp_score, photo_url')
    .eq('workspace_id', ws.id)
    .limit(5000);

  const total = contacts?.length || 0;
  const fake = (contacts || []).filter(c => c.email && FAKE.test(c.email));
  const noEmail = (contacts || []).filter(c => !c.email);
  const enrichable = fake.filter(c => c.linkedin_member_id || c.linkedin_url);
  const hasTitle = fake.filter(c => c.job_title);
  const scored = fake.filter(c => c.icp_score != null);

  console.log(`\n=== ${ws.name} (${ws.id}) ===`);
  console.log(`Total contacts: ${total}`);
  console.log(`Fake-email contacts: ${fake.length}  (no email at all: ${noEmail.length})`);
  console.log(`  ↳ have linkedin_url or member_id (enrichable): ${enrichable.length}`);
  console.log(`  ↳ already have job_title: ${hasTitle.length}`);
  console.log(`  ↳ already ICP-scored: ${scored.length}`);

  console.log(`\nFirst ${Math.min(25, fake.length)} fake-email contacts:`);
  for (const c of fake.slice(0, 25)) {
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || '(no name)';
    const li = c.linkedin_member_id ? 'member_id' : (c.linkedin_url ? 'url' : 'NONE');
    console.log(`  ${name.padEnd(28)} | ${c.email.padEnd(38)} | li:${li.padEnd(9)} | title:${c.job_title || '—'} | icp:${c.icp_score ?? '—'}`);
  }
}
process.exit(0);

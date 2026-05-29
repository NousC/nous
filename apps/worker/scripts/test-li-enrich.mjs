// TEST: enrich up to N fake-email LinkedIn contacts using the REAL production
// functions (fetchLinkedInProfile + applyLinkedInProfile), throttled to stay gentle
// on LinkedIn. Read .env, then run. Usage: node apps/worker/scripts/test-li-enrich.mjs [N]
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new URL('../../../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

// Import AFTER env is set (enrichContact builds an Anthropic client at module load).
const { getSupabaseClient } = await import('@nous/core');
const { applyLinkedInProfile } = await import('../src/utils/enrichContact.mjs');
const { fetchLinkedInProfile }  = await import('../src/utils/linkedinProfile.mjs');
const { processClaimJobs }      = await import('../src/workers/claimEngine.mjs');

const WS = '9caa9db9-000c-43d3-895b-14f4aedffb5f'; // Nous (was "Proply WS")
const LIMIT = Math.min(Number(process.argv[2] || 10), 10); // hard cap at 10
const DELAY_MS = 2500;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const supabase = getSupabaseClient();

const { data: conn } = await supabase.from('workspace_linkedin_connections')
  .select('unipile_account_id').eq('workspace_id', WS).single();
const accountId = conn?.unipile_account_id;
if (!accountId) { console.error('No Unipile account for workspace'); process.exit(1); }

const { data: contacts } = await supabase.from('contacts')
  .select('id, workspace_id, first_name, last_name, email, linkedin_member_id, linkedin_url, job_title, company, photo_url, icp_score')
  .eq('workspace_id', WS)
  .not('linkedin_member_id', 'is', null)
  .is('job_title', null)
  .limit(LIMIT);

console.log(`Enriching ${contacts?.length || 0} contact(s), ${DELAY_MS}ms apart (account ${accountId})\n`);

let ok = 0, scored = 0;
for (const c of contacts || []) {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || '(no name)';
  const profile = await fetchLinkedInProfile(accountId, c.linkedin_member_id);
  if (!profile) { console.log(`✗ ${name}: profile fetch failed`); await sleep(DELAY_MS); continue; }

  console.log(`• ${name}`);
  console.log(`    headline : ${profile.headline || '—'}`);
  console.log(`    parsed   : title="${profile.jobTitle || '—'}"  company="${profile.company || '—'}"  domain=${profile.companyDomain || '—'}`);

  await applyLinkedInProfile(supabase, c, {
    jobTitle: profile.jobTitle, company: profile.company,
    companyDomain: profile.companyDomain, photoUrl: profile.photoUrl,
    headline: profile.headline,
  });
  console.log();
  await sleep(DELAY_MS);
}

// Materialize observations → claims → contacts columns (the scheduled worker's job).
console.log('Draining claim queue (materializing into contact records)...\n');
for (let i = 0; i < 3; i++) await processClaimJobs();

for (const c of contacts || []) {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || '(no name)';
  const { data: after } = await supabase.from('contacts')
    .select('job_title, company, seniority, icp_score, icp_fit').eq('id', c.id).single();
  console.log(`  ${name.padEnd(26)} title=${(after?.job_title || '—').padEnd(34)} company=${(after?.company || '—').padEnd(20)} sen=${(after?.seniority || '—').padEnd(8)} ICP=${after?.icp_score ?? '—'} ${after?.icp_fit ? '(FIT)' : ''}`);
  if (after?.job_title) ok++;
  if (after?.icp_score != null) scored++;
}
console.log(`\nDone. title materialized: ${ok}/${contacts?.length || 0} | ICP scored: ${scored}/${contacts?.length || 0}`);
process.exit(0);

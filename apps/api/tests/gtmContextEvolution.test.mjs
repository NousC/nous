import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { hasSupabase } from './helpers.mjs';
import {
  getSupabaseClient,
  saveNote,
  supersedeNote,
  listNotes,
  getNote,
} from '@nous/core';

// End-to-end check of the GTM-context evolution keystone (Phase 1): facts carry
// a subject slot + confidence, and a rebuild SUPERSEDES the slot's prior fact
// (kept as history) instead of deleting it. Runs against the real DB, fully
// isolated in a throwaway workspace that cascade-deletes on cleanup.

const run = hasSupabase ? test : (n, _f) => test(n, { skip: 'no SUPABASE env' }, () => {});

let workspaceId = null;
let teamId = null;

after(async () => {
  const supabase = getSupabaseClient();
  // Deleting the workspace cascades to its entity + claims (ON DELETE CASCADE);
  // then drop the parent team so the fixture leaves nothing behind.
  if (workspaceId) await supabase.from('workspaces').delete().eq('id', workspaceId);
  if (teamId) await supabase.from('teams').delete().eq('id', teamId);
});

run('a fact evolves by subject: supersede keeps history, active reads the latest', async () => {
  const supabase = getSupabaseClient();

  // ── isolated fixture: a temp team → workspace → workspace entity ──
  const { data: team, error: tErr } = await supabase
    .from('teams')
    .insert({ name: `zz-gtm-evolution-test-${Date.now()}` })
    .select('id')
    .single();
  assert.equal(tErr, null, `team insert: ${tErr?.message}`);
  teamId = team.id;

  const { data: ws, error: wErr } = await supabase
    .from('workspaces')
    .insert({ name: `zz-gtm-evolution-test-${Date.now()}`, team_id: teamId })
    .select('id')
    .single();
  assert.equal(wErr, null, `workspace insert: ${wErr?.message}`);
  workspaceId = ws.id;

  const { data: ent, error: eErr } = await supabase
    .from('entities')
    .insert({ workspace_id: workspaceId, type: 'workspace' })
    .select('id')
    .single();
  assert.equal(eErr, null, `entity insert: ${eErr?.message}`);
  const entityId = ent.id;

  const slot = { entityId, category: 'Pricing', source: 'playbook', subject: 'playbook.pricing' };

  // 1. First fact in the slot — AI-drafted, confidence < 1, with a subject.
  const v1 = await saveNote(supabase, workspaceId, { ...slot, content: 'Flat $99/mo', confidence: 0.8 });
  assert.ok(v1, 'v1 saved');
  assert.equal(v1.confidence, 0.8, 'v1 confidence persisted');
  assert.equal(v1.subject, 'playbook.pricing', 'v1 subject persisted');
  assert.equal(v1.is_active, true, 'v1 active');

  // 2. Rebuild changes the slot → supersede, not overwrite.
  const v2 = await supersedeNote(supabase, workspaceId, v1.id, { ...slot, content: 'Usage-based, $0.01/call', confidence: 0.8 });
  assert.ok(v2, 'v2 saved');
  assert.equal(v2.content, 'Usage-based, $0.01/call', 'v2 content');
  assert.equal(v2.metadata.supersedes, v1.id, 'v2 links back to v1');

  // 3. Active read returns ONLY the latest — old version is gone from the profile.
  const active = await listNotes(supabase, workspaceId, { entityId });
  const activePricing = active.filter(n => n.subject === 'playbook.pricing');
  assert.equal(activePricing.length, 1, 'exactly one active fact in the slot');
  assert.equal(activePricing[0].content, 'Usage-based, $0.01/call', 'active is v2');
  assert.equal(active.some(n => n.content === 'Flat $99/mo'), false, 'v1 not in active set');

  // 4. The old fact is preserved as history, with a forward link.
  const oldNote = await getNote(supabase, workspaceId, v1.id);
  assert.ok(oldNote, 'v1 still exists (not hard-deleted)');
  assert.equal(oldNote.is_active, false, 'v1 invalidated');
  assert.equal(oldNote.superseded_by, v2.id, 'v1 links forward to v2');

  // 5. The timeline read (includeInactive + subject) returns both versions.
  const history = await listNotes(supabase, workspaceId, { entityId, subject: 'playbook.pricing', includeInactive: true, limit: 50 });
  assert.equal(history.length, 2, 'history has both versions');
  assert.equal(history.filter(n => n.is_active).length, 1, 'one current in history');
  assert.equal(history.filter(n => !n.is_active).length, 1, 'one superseded in history');
});

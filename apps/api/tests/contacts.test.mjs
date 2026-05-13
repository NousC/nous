/**
 * Contact CRUD integration tests — require real Supabase + a valid API key.
 * Set TEST_API_KEY and TEST_WORKSPACE_ID env vars (or put them in .env).
 * Tests are skipped automatically if credentials are absent.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { get, post, patch, del, stopServer, hasSupabase } from './helpers.mjs';

after(stopServer);

const apiKey = process.env.TEST_API_KEY;
const workspaceId = process.env.TEST_WORKSPACE_ID;
const canRun = hasSupabase && !!apiKey && !!workspaceId;

function skip(name, fn) {
  if (canRun) return test(name, fn);
  test(name, { skip: 'TEST_API_KEY / TEST_WORKSPACE_ID not set' }, fn);
}

const headers = () => ({ 'x-api-key': apiKey });

let createdId = null;
const testEmail = `test-integration-${Date.now()}@proply-test.invalid`;

skip('POST /v1/contacts — create contact', async () => {
  const res = await post('/v1/contacts', {
    email: testEmail,
    first_name: 'Integration',
    last_name: 'Test',
    company: 'Proply Tests Inc',
    job_title: 'QA Bot',
  }, headers());
  assert.equal(res.status, 201, await res.text());
  const body = await res.json();
  assert.ok(body.contact?.id, 'should return contact with id');
  assert.equal(body.contact.email, testEmail);
  assert.equal(body.contact.pipeline_stage, 'identified');
  createdId = body.contact.id;
});

skip('GET /v1/contacts — list includes created contact', async () => {
  assert.ok(createdId, 'depends on create test');
  const res = await get(`/v1/contacts?search=proply-test`, headers());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.contacts));
  const found = body.contacts.find(c => c.id === createdId);
  assert.ok(found, 'created contact should appear in list');
});

skip('GET /v1/contacts/:id — fetch by id', async () => {
  assert.ok(createdId, 'depends on create test');
  const res = await get(`/v1/contacts/${createdId}`, headers());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.contact.id, createdId);
  assert.equal(body.contact.email, testEmail);
  assert.ok(Array.isArray(body.contact.activities));
  assert.ok(Array.isArray(body.contact.facts));
});

skip('GET /v1/contacts/:email — fetch by email', async () => {
  const res = await get(`/v1/contacts/${encodeURIComponent(testEmail)}`, headers());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.contact.email, testEmail);
});

skip('PATCH /v1/contacts/:id — update job title', async () => {
  assert.ok(createdId, 'depends on create test');
  const res = await patch(`/v1/contacts/${createdId}`, { job_title: 'Updated Role' }, headers());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.contact.title, 'Updated Role');
});

skip('POST /v1/contacts duplicate email → 409', async () => {
  const res = await post('/v1/contacts', { email: testEmail }, headers());
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, 'email_already_exists');
});

skip('POST /v1/memories — save workspace memory', async () => {
  const res = await post('/v1/memories', {
    content: 'Integration test memory — safe to delete',
    category: 'General',
    source: 'test',
  }, headers());
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.ok(body.memory?.id);
  assert.equal(body.memory.category, 'General');
});

skip('DELETE /v1/contacts/:id — cleanup created contact', async () => {
  assert.ok(createdId, 'depends on create test');
  const res = await del(`/v1/contacts/${createdId}`, headers());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.deleted);
});

skip('GET /v1/contacts/:id after delete → 404', async () => {
  assert.ok(createdId, 'depends on delete test');
  const res = await get(`/v1/contacts/${createdId}`, headers());
  assert.equal(res.status, 404);
});

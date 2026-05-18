// Push Proply activity into connected CRMs as native engagement objects.
// Called fire-and-forget from logActivity (db/activities.ts).
//
// Per-provider mapping:
//   HubSpot   → POST /crm/v3/objects/{type}        (notes / meetings / emails)
//   Pipedrive → POST /v1/activities                (type-coded: meeting / call / email / task)
//   Attio     → POST /v2/notes                     (Attio has no Activities API — Notes is idiomatic)
//
// Identity resolution: cached on contacts.{provider}_id. On miss → look up by email → on miss → create.

import { getSupabaseClient } from '../db/client.js';
import { decrypt } from '../utils/encryption.js';

export interface CrmPushEvent {
  workspaceId: string;
  contactId: string;
  activityType: string;
  occurredAt?: string;
  summary?: string | null;
  description?: string | null;
  rawData?: Record<string, unknown> | null;
}

// High-signal only. Easy to widen later via per-workspace config in crm_sync_configs.
const PUSHABLE_TYPES = new Set([
  'email_reply',
  'linkedin_message',
  'linkedin_connected',
  'meeting_held',
  'meeting_scheduled',
  'proposal_sent',
  'proposal_viewed',
  'proposal_signed',
  'deal_won',
  'deal_created',
  'trial_started',
]);

const ID_COLUMN: Record<string, string> = {
  hubspot:   'hubspot_id',
  pipedrive: 'pipedrive_id',
  attio:     'attio_id',
  // salesforce intentionally omitted — still 'coming soon' in UI
};

interface ContactRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  hubspot_id: string | null;
  pipedrive_id: string | null;
  attio_id: string | null;
  [k: string]: any;
}

export async function pushActivityToAllCrms(evt: CrmPushEvent): Promise<void> {
  if (!PUSHABLE_TYPES.has(evt.activityType)) return;
  const supabase = getSupabaseClient();

  const { data: configs } = await supabase
    .from('crm_sync_configs')
    .select('provider, connection_id, push_activities')
    .eq('workspace_id', evt.workspaceId);

  const enabled = (configs || []).filter((c: any) =>
    c.push_activities && ID_COLUMN[c.provider] && c.connection_id
  );
  if (!enabled.length) return;

  const { data: contact } = await supabase
    .from('contacts')
    .select('id, email, first_name, last_name, company, hubspot_id, pipedrive_id, attio_id, salesforce_id')
    .eq('id', evt.contactId)
    .single();
  if (!contact?.email) return;

  await Promise.allSettled(enabled.map((cfg: any) =>
    pushOne(cfg, contact as ContactRow, evt).catch(err =>
      console.error(`[CRM_PUSH ${cfg.provider}]`, err?.message || err)
    )
  ));
}

async function pushOne(cfg: { provider: string; connection_id: string }, contact: ContactRow, evt: CrmPushEvent): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: conn } = await supabase
    .from('workflow_provider_connections')
    .select('encrypted_credentials')
    .eq('id', cfg.connection_id)
    .single();
  if (!conn) return;

  const creds: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(conn.encrypted_credentials || {})) {
    creds[k] = decrypt(v as string);
  }

  const provider = cfg.provider;
  const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
  const cachedId = contact[ID_COLUMN[provider]] as string | null;
  let crmId: string | null;
  try {
    crmId = cachedId || await resolveCrmContact(provider, creds, contact);
  } catch (err: any) {
    await logCrmOp(supabase, evt, provider, 'identity_failed',
      `${providerLabel}: identity lookup failed for ${contact.email} — ${err?.message || err}`);
    return;
  }
  if (!crmId) {
    await logCrmOp(supabase, evt, provider, 'identity_failed',
      `${providerLabel}: no contact match for ${contact.email}`);
    return;
  }

  if (!cachedId) {
    await supabase.from('contacts').update({ [ID_COLUMN[provider]]: crmId }).eq('id', contact.id);
    await logCrmOp(supabase, evt, provider, 'contact_resolved',
      `${providerLabel}: linked ${contact.email} → ${crmId}`, { crm_id: crmId });
  }

  try {
    if (provider === 'hubspot')   await pushHubSpotEngagement(creds, crmId, evt);
    if (provider === 'pipedrive') await pushPipedriveActivity(creds, crmId, evt);
    if (provider === 'attio')     await pushAttioNote(creds, crmId, evt);
    await logCrmOp(supabase, evt, provider, 'activity_pushed',
      `Pushed ${activityTitle(evt)} → ${providerLabel} (${contact.email})`,
      { crm_id: crmId });
  } catch (err: any) {
    await logCrmOp(supabase, evt, provider, 'activity_push_failed',
      `${providerLabel} push failed for ${activityTitle(evt)} → ${contact.email} · ${err?.message || err}`,
      { crm_id: crmId, error: String(err?.message || err) });
    throw err;
  }
}

// Best-effort write to workspace_system_log. Failures here never bubble up — the activity
// already succeeded; missing telemetry shouldn't break the user-facing flow.
async function logCrmOp(
  supabase: any, evt: CrmPushEvent, provider: string, eventType: string,
  summary: string, metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabase.from('workspace_system_log').insert({
      workspace_id: evt.workspaceId,
      source: provider,
      event_type: eventType,
      summary,
      contact_id: evt.contactId,
      metadata: { activity_type: evt.activityType, ...metadata },
    });
  } catch (err: any) {
    console.warn('[CRM_PUSH] system_log write failed:', err?.message || err);
  }
}

// ─── Identity resolution ──────────────────────────────────────────────────────

async function resolveCrmContact(provider: string, creds: Record<string, string | null>, contact: ContactRow): Promise<string | null> {
  if (provider === 'hubspot')   return resolveHubSpot(creds, contact);
  if (provider === 'pipedrive') return resolvePipedrive(creds, contact);
  if (provider === 'attio')     return resolveAttio(creds, contact);
  return null;
}

async function resolveHubSpot(creds: Record<string, string | null>, contact: ContactRow): Promise<string | null> {
  const token = creds.access_token || creds.api_key;
  if (!token) return null;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const sr = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
    method: 'POST', headers,
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: contact.email }] }],
      properties: ['email'], limit: 1,
    }),
  });
  if (sr.ok) {
    const d: any = await sr.json();
    if (d.results?.[0]?.id) return d.results[0].id;
  }

  const cr = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
    method: 'POST', headers,
    body: JSON.stringify({ properties: {
      email:     contact.email,
      firstname: contact.first_name || '',
      lastname:  contact.last_name  || '',
      company:   contact.company    || '',
    }}),
  });
  if (cr.ok) { const d: any = await cr.json(); return d.id || null; }
  return null;
}

async function resolvePipedrive(creds: Record<string, string | null>, contact: ContactRow): Promise<string | null> {
  const token = creds.api_token || creds.api_key;
  if (!token) return null;

  const sr = await fetch(`https://api.pipedrive.com/v1/persons/search?term=${encodeURIComponent(contact.email)}&fields=email&exact_match=true&api_token=${encodeURIComponent(token)}`);
  if (sr.ok) {
    const d: any = await sr.json();
    const hit = d.data?.items?.[0]?.item;
    if (hit?.id) return String(hit.id);
  }

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email;
  const cr = await fetch(`https://api.pipedrive.com/v1/persons?api_token=${encodeURIComponent(token)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email: [contact.email] }),
  });
  if (cr.ok) { const d: any = await cr.json(); return d.data?.id ? String(d.data.id) : null; }
  return null;
}

async function resolveAttio(creds: Record<string, string | null>, contact: ContactRow): Promise<string | null> {
  const token = creds.api_key || creds.access_token;
  if (!token) return null;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const sr = await fetch('https://api.attio.com/v2/objects/people/records/query', {
    method: 'POST', headers,
    body: JSON.stringify({ filter: { email_addresses: contact.email }, limit: 1 }),
  });
  if (sr.ok) {
    const d: any = await sr.json();
    const id = d.data?.[0]?.id?.record_id;
    if (id) return id;
  }

  const cr = await fetch('https://api.attio.com/v2/objects/people/records?matching_attribute=email_addresses', {
    method: 'PUT', headers,
    body: JSON.stringify({ data: { values: {
      email_addresses: [contact.email],
      name: [{ first_name: contact.first_name || '', last_name: contact.last_name || '' }],
    }}}),
  });
  if (cr.ok) { const d: any = await cr.json(); return d.data?.id?.record_id || null; }
  return null;
}

// ─── Push adapters ────────────────────────────────────────────────────────────

const HUBSPOT_ASSOC: Record<string, number> = { notes: 202, meetings: 200, emails: 198, calls: 194, tasks: 204 };

function hubspotObjectType(t: string): string {
  if (t === 'meeting_held' || t === 'meeting_scheduled') return 'meetings';
  if (t === 'email_reply') return 'emails';
  return 'notes';
}

function hubspotProperties(evt: CrmPushEvent): Record<string, any> {
  const ts = new Date(evt.occurredAt || Date.now()).getTime();
  const ob = hubspotObjectType(evt.activityType);
  const body = activityTitle(evt) + (evt.summary ? `\n\n${evt.summary}` : '');
  if (ob === 'meetings') return { hs_meeting_title: activityTitle(evt), hs_meeting_body: evt.summary || '', hs_timestamp: ts, hs_meeting_outcome: 'COMPLETED' };
  if (ob === 'emails')   return { hs_email_subject: activityTitle(evt), hs_email_text: evt.summary || '', hs_email_direction: 'INCOMING_EMAIL', hs_timestamp: ts };
  return { hs_note_body: body, hs_timestamp: ts };
}

async function pushHubSpotEngagement(creds: Record<string, string | null>, crmId: string, evt: CrmPushEvent): Promise<void> {
  const token = creds.access_token || creds.api_key;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const ob = hubspotObjectType(evt.activityType);
  const cr = await fetch(`https://api.hubapi.com/crm/v3/objects/${ob}`, {
    method: 'POST', headers,
    body: JSON.stringify({
      properties: hubspotProperties(evt),
      associations: [{ to: { id: crmId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: HUBSPOT_ASSOC[ob] }] }],
    }),
  });
  if (!cr.ok) {
    const t = await cr.text().catch(() => '');
    throw new Error(`HubSpot ${cr.status}: ${t.slice(0, 200)}`);
  }
}

function pipedriveType(t: string): string {
  if (t.startsWith('meeting')) return 'meeting';
  if (t === 'email_reply')     return 'email';
  return 'task';
}

async function pushPipedriveActivity(creds: Record<string, string | null>, crmId: string, evt: CrmPushEvent): Promise<void> {
  const token = creds.api_token || creds.api_key;
  const cr = await fetch(`https://api.pipedrive.com/v1/activities?api_token=${encodeURIComponent(token!)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject:   activityTitle(evt),
      type:      pipedriveType(evt.activityType),
      done:      1,
      note:      evt.summary || evt.description || '',
      person_id: Number(crmId),
      due_date:  (evt.occurredAt || new Date().toISOString()).slice(0, 10),
    }),
  });
  if (!cr.ok) {
    const t = await cr.text().catch(() => '');
    throw new Error(`Pipedrive ${cr.status}: ${t.slice(0, 200)}`);
  }
}

async function pushAttioNote(creds: Record<string, string | null>, crmId: string, evt: CrmPushEvent): Promise<void> {
  const token = creds.api_key || creds.access_token;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const lines: string[] = [];
  if (evt.summary)     lines.push(evt.summary);
  if (evt.description) lines.push(`_${evt.description}_`);
  lines.push('');
  lines.push(`— Logged by Proply on ${new Date(evt.occurredAt || Date.now()).toLocaleString()}`);

  const cr = await fetch('https://api.attio.com/v2/notes', {
    method: 'POST', headers,
    body: JSON.stringify({ data: {
      parent_object:    'people',
      parent_record_id: crmId,
      title:            `[Proply] ${activityTitle(evt)}`,
      format:           'markdown',
      content:          lines.join('\n'),
      created_at:       evt.occurredAt || new Date().toISOString(),
    }}),
  });
  if (!cr.ok) {
    const t = await cr.text().catch(() => '');
    throw new Error(`Attio ${cr.status}: ${t.slice(0, 200)}`);
  }
}

function activityTitle(evt: CrmPushEvent): string {
  const map: Record<string, string> = {
    email_reply:        'Email reply',
    linkedin_message:   'LinkedIn message',
    linkedin_connected: 'LinkedIn connection accepted',
    meeting_held:       'Meeting held',
    meeting_scheduled:  'Meeting scheduled',
    proposal_sent:      'Proposal sent',
    proposal_viewed:    'Proposal viewed',
    proposal_signed:    'Proposal signed',
    deal_won:           'Deal won',
    deal_created:       'Deal created',
    trial_started:      'Trial started',
  };
  return map[evt.activityType] || evt.activityType;
}

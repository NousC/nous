// Google Calendar poller — scans a rolling time window around now.
// Fetches events ±7d/+30d across all connected workspaces,
// resolves attendees to contacts via a 3-step waterfall, and logs activities.
// Dedup is handled by externalId (gcal_{event.id}).

import { google } from 'googleapis';
import Anthropic from 'useleak';
import { getSupabaseClient, listActivities } from '@nous/core';
import { logActivity } from '../utils/activity.mjs';
import { refreshGoogleToken } from '../utils/googleOAuth.mjs';
import { isTokenRevoked, markGoogleConnectionRevoked } from '../utils/connectionHealth.mjs';

const LOOKBACK_DAYS  = 7;
const LOOKAHEAD_DAYS = 30;
const MEETING_RE     = /\b(book|booked|schedul|call|meeting|appointment|calendly|slot|zoom|meet|catch up|sync)\b/i;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Scheduler / no-reply senders (Zoom Scheduler, Calendly, Cal.com, …) book a 1:1
// on your calendar with YOU as the only guest and the counterparty's name only in
// the event title. Their address must never be treated as a person or saved as a
// contact email.
const NOREPLY_RE = /(no-?reply|do-?not-?reply|scheduler|notification|invite|mailer-daemon|calendar-server)/i;
const SCHEDULER_DOMAIN_RE = /(^|\.)(zoom\.us|calendly\.com|cal\.com|savvycal\.com|acuityscheduling\.com|chilipiper\.com|hubspot\.com|youcanbook\.me)$/i;
export function isNonHumanEmail(email) {
  const e = (email || '').toLowerCase();
  const at = e.indexOf('@');
  if (at < 1) return true;
  return NOREPLY_RE.test(e.slice(0, at)) || SCHEDULER_DOMAIN_RE.test(e.slice(at + 1));
}

// Only treat a guest-less event as a possible 1:1 booking when there's real
// evidence — booked by a scheduler, a conferencing link in the body, or a
// meeting-shaped title. Keeps personal blocks ("gym", "Morning Routine") from
// ever triggering name extraction.
export function looksLikeExternalBooking(event) {
  const org = (event.organizer?.email || event.creator?.email || '').toLowerCase();
  if (org && isNonHumanEmail(org)) return true;   // created by a scheduler service
  const blob = `${event.location || ''} ${event.description || ''}`.toLowerCase();
  if (/(zoom\.us|calendly\.com|cal\.com|savvycal|meet\.google\.com|teams\.microsoft|whereby\.com|hangouts)/.test(blob)) return true;
  const title = event.summary || '';
  if (/\b(intro|call|meeting|sync|catch[- ]?up|1:1|demo|coffee|interview|discovery|chat|onboarding|kickoff)\b/i.test(title)) return true;
  if (/\s(x|×|<>|<->|\/|&|vs\.?|with)\s/i.test(title) || /\bbetween\b.*\band\b/i.test(title)) return true;
  return false;
}

// Cheap, deterministic name extraction from a meeting title — handles the common
// scheduler patterns without an LLM. Returns the OTHER person's name (never the
// owner), or null when nothing clear is found (then the LLM fallback runs).
function heuristicCounterparty(title, ownerName) {
  const t = (title || '').trim();
  if (!t) return null;
  const ownerToks = new Set((ownerName || '').toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const isOwner = (s) => s.toLowerCase().split(/\s+/).some(tok => ownerToks.has(tok));
  const ok = (s) => s && /^\p{Lu}/u.test(s) && s.split(/\s+/).length >= 2 && s.split(/\s+/).length <= 4 && !isOwner(s);

  // "… between Georgi Furnadzhiev and Bennet Glinder" → the non-owner side.
  let m = t.match(/\bbetween\s+([\p{L}'’.\- ]+?)\s+and\s+([\p{L}'’.\- ]+)/iu);
  if (m) {
    const a = m[1].trim(), b = m[2].trim();
    if (ok(a) && isOwner(b)) return a;
    if (ok(b) && isOwner(a)) return b;
  }
  // "… with Mansoor Ali" (up to 3 capitalised words).
  m = t.match(/\bwith\s+(\p{Lu}[\p{L}'’.\-]+(?:\s+\p{Lu}[\p{L}'’.\-]+){0,2})/u);
  if (m && ok(m[1])) return m[1].trim();
  // "A x B" / "A & B" / "A and B" / "A / B" / "A <> B" — keep the non-owner side.
  const parts = t.split(/\s+(?:x|×|<>|<->|\/|&|vs\.?|and|und)\s+/i)
    .map(s => s.replace(/\s*[-–—:|(].*$/, '').trim())   // drop trailing "- Intro", "| Zoom", "(30m)"
    .filter(Boolean);
  if (parts.length >= 2) {
    const others = parts.filter(ok);
    if (others.length === 1) return others[0];
  }
  return null;
}

// Pull the OTHER person's name out of a 1:1 booking's title/description when the
// event carries no human guest (the Zoom-Scheduler pattern: "… with Mansoor Ali").
// Heuristic first (free, deterministic); Haiku fallback for ambiguous titles.
export async function extractCounterpartyName({ title, description, ownerName }) {
  const heuristic = heuristicCounterparty(title, ownerName);
  if (heuristic) return heuristic;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const t = `${title || ''}\n${(description || '').slice(0, 500)}`.trim();
  if (!t) return null;
  const me = ownerName || 'the calendar owner';
  try {
    const msg = await anthropic.messages.create({
      feature: 'meeting-attendee-extract',
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 24,
      messages: [{ role: 'user', content:
`A 1:1 meeting on ${me}'s calendar. From the title and details, give the OTHER person's full name — never ${me}. If no specific other person is named, answer NONE.

TITLE: ${title || ''}
DETAILS: ${(description || '').slice(0, 400)}

Reply with ONLY the other person's full name, or NONE.` }],
    });
    const out = (msg.content?.[0]?.text || '').trim();
    if (!out || /^none$/i.test(out)) return null;
    // Sanity: a plausible 2-part name, letters/spaces/.'- only.
    if (!/^[\p{L}][\p{L}.'\- ]{1,58}[\p{L}.]$/u.test(out)) return null;
    return out;
  } catch (e) {
    console.warn('[CAL_POLL] name extract failed:', e.message);
    return null;
  }
}

// Resolve a full name to a contact — unique existing match, else CREATE a new
// person (a booked meeting is a strong enough signal to earn a record). Returns
// null when the name is partial or ambiguous (>1 match) so we never guess.
async function resolveOrCreateByName(supabase, workspaceId, fullName) {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0];
  const last  = parts.slice(1).join(' ');
  if (!first || !last) return null;
  // Last-name PREFIX match so an existing record with a suffix/emoji ("Ali 🥾")
  // still resolves instead of forking a duplicate. % is escaped to a literal.
  const lastPrefix = `${last.replace(/[%_]/g, '\\$&')}%`;
  const { data: matches } = await supabase.from('contacts')
    .select('id, email, first_name, last_name, company_id')
    .eq('workspace_id', workspaceId)
    .ilike('first_name', first)
    .ilike('last_name', lastPrefix);
  if (matches && matches.length === 1) return { contact: matches[0], created: false };
  if (matches && matches.length > 1)  return null;   // ambiguous — don't guess
  const { data: created, error } = await supabase.from('contacts')
    .insert({ workspace_id: workspaceId, first_name: first, last_name: last, source: 'calendar', pipeline_stage: 'identified' })
    .select('id, email, first_name, last_name, company_id')
    .single();
  if (error) { console.warn('[CAL_POLL] create-by-name failed:', error.message); return null; }
  return { contact: created, created: true };
}

// Log one meeting observation for a contact, with the reschedule handling the
// attendee path already used (a Google event keeps its id when moved, so a moved
// start drops a "Rescheduled:" marker on the old slot and logs the new time).
async function recordMeeting(supabase, workspaceId, event, contact, { rsvp } = {}) {
  const startTime = event.start?.dateTime || event.start?.date;
  if (!startTime) return 0;
  const occurredAt = new Date(startTime).toISOString();
  const isPast = new Date(startTime) < new Date();
  const title  = event.summary || 'Calendar meeting';
  const type   = (isPast && rsvp === 'accepted') ? 'meeting_held' : 'meeting_scheduled';
  const label  = rsvp === 'declined' ? '(Declined)' : isPast ? '(Held)' : '(Scheduled)';

  const stableExtId = `gcal_${event.id}_${contact.id}`;
  const startKey = occurredAt.slice(0, 16);
  let externalId = stableExtId;
  if (type === 'meeting_scheduled') {
    const { data: existing } = await supabase.from('observations')
      .select('observed_at')
      .eq('workspace_id', workspaceId)
      .eq('source', 'google_calendar')
      .eq('external_id', stableExtId)
      .maybeSingle();
    const existingKey = existing ? new Date(existing.observed_at).toISOString().slice(0, 16) : null;
    if (existingKey && existingKey !== startKey) {
      await logActivity(supabase, {
        workspaceId, contactId: contact.id, companyId: contact.company_id || null,
        type: 'meeting_cancelled', source: 'google_calendar',
        externalId: `gcal_resched_${event.id}_${contact.id}_${existingKey}`,
        occurredAt: existing.observed_at, description: `Rescheduled: ${title}`,
      });
      externalId = `${stableExtId}_${startKey}`;
    }
  }

  const result = await logActivity(supabase, {
    workspaceId, contactId: contact.id, companyId: contact.company_id || null,
    type, source: 'google_calendar', externalId, occurredAt,
    description: `${title} ${label}`,
  });
  return result ? 1 : 0;
}

async function getCalendarConnections(supabase) {
  const { data: conns } = await supabase
    .from('workflow_provider_connections')
    .select('id, workspace_id, encrypted_credentials, workflow_providers!inner(name)')
    .eq('is_verified', true)
    .eq('workflow_providers.name', 'gmail_oauth');

  return (conns || []).filter(c =>
    (c.encrypted_credentials?.scope || '').includes('calendar')
  );
}

async function pollWorkspace(supabase, conn) {
  const { credentials, needsUpdate, updatedCredentials } =
    await refreshGoogleToken(conn.encrypted_credentials);

  if (needsUpdate) {
    await supabase.from('workflow_provider_connections')
      .update({ encrypted_credentials: updatedCredentials })
      .eq('id', conn.id);
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URI,
  );
  oauth2Client.setCredentials({ access_token: credentials.access_token });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const timeMin = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
  const timeMax = new Date(Date.now() + LOOKAHEAD_DAYS * 86400000).toISOString();

  const eventsRes = await calendar.events.list({
    calendarId: 'primary', timeMin, timeMax,
    singleEvents: true, maxResults: 500,
  });

  const events = (eventsRes.data.items || []).filter(e => e.status !== 'cancelled');
  if (!events.length) return 0;

  const ownerEmail = credentials.email?.toLowerCase();

  // Collect all unique external attendee emails
  const externalAttendees = new Map(); // email → displayName
  for (const event of events) {
    const all = [...(event.attendees || [])];
    if (event.organizer?.email && !all.find(a => a.email === event.organizer.email)) {
      all.push({ email: event.organizer.email, displayName: event.organizer.displayName });
    }
    for (const a of all) {
      const email = a.email?.toLowerCase();
      // Skip the owner and scheduler/no-reply addresses — the latter are transport,
      // not people, and would otherwise never match (or pollute) a contact.
      if (!email || email === ownerEmail || isNonHumanEmail(email)) continue;
      if (!externalAttendees.has(email)) externalAttendees.set(email, a.displayName || null);
    }
  }

  // Owner display name — used to exclude "me" when extracting a counterparty from
  // a title-only booking ("Mansoor x Bennet" → Mansoor, not Bennet).
  let ownerName = null;
  for (const event of events) {
    const o = (event.attendees || []).find(a => a.email?.toLowerCase() === ownerEmail)
      || (event.organizer?.email?.toLowerCase() === ownerEmail ? event.organizer : null);
    if (o?.displayName) { ownerName = o.displayName; break; }
  }

  // ── Pass 1: exact email match ────────────────────────────────────────────────
  const contactByEmail = new Map();
  if (externalAttendees.size) {
    const { data: emailContacts } = await supabase
      .from('contacts')
      .select('id, email, first_name, last_name, company_id')
      .eq('workspace_id', conn.workspace_id)
      .in('email', [...externalAttendees.keys()]);
    for (const c of emailContacts || []) contactByEmail.set(c.email.toLowerCase(), c);
  }

  // ── Pass 2: name / email-prefix fallback for unmatched attendees ─────────────
  const stillUnmatched = [...externalAttendees.entries()]
    .filter(([email]) => !contactByEmail.has(email));

  if (stillUnmatched.length) {
    const { data: noEmailContacts } = await supabase
      .from('contacts')
      .select('id, email, first_name, last_name, company_id')
      .eq('workspace_id', conn.workspace_id)
      .is('email', null);

    const byFullName = new Map();
    const byFirstName = new Map();
    for (const c of noEmailContacts || []) {
      const fn = c.first_name?.toLowerCase();
      const ln = c.last_name?.toLowerCase();
      if (fn && ln) {
        const key = `${fn} ${ln}`;
        if (!byFullName.has(key)) byFullName.set(key, []);
        byFullName.get(key).push(c);
      }
      if (fn) {
        if (!byFirstName.has(fn)) byFirstName.set(fn, []);
        byFirstName.get(fn).push(c);
      }
    }

    for (const [email, displayName] of stillUnmatched) {
      let candidates = [];
      if (displayName) candidates = byFullName.get(displayName.trim().toLowerCase()) || [];
      if (!candidates.length) {
        const parts = email.split('@')[0].toLowerCase().split(/[._+\-]/);
        if (parts.length >= 2) candidates = byFullName.get(`${parts[0]} ${parts[1]}`) || [];
        if (!candidates.length && parts[0]) candidates = byFirstName.get(parts[0]) || [];
      }
      if (!candidates.length) continue;

      let contact = null;
      if (candidates.length === 1) {
        contact = candidates[0];
      } else {
        // Tiebreak: contact with recent meeting-intent activity wins
        const recentActs = await listActivities(supabase, {
          contactIds: candidates.map(c => c.id),
          since: new Date(Date.now() - 14 * 86400000).toISOString(),
          limit: 500,
        });

        const scores = new Map(candidates.map(c => [c.id, 0]));
        for (const act of recentActs) {
          if (MEETING_RE.test(act.description || '')) {
            scores.set(act.contact_id, (scores.get(act.contact_id) || 0) + 1);
          }
        }
        const maxScore = Math.max(...scores.values());
        const top = maxScore > 0 ? candidates.filter(c => scores.get(c.id) === maxScore) : [];
        if (top.length === 1) contact = top[0];
      }

      if (!contact) continue;

      // Self-heal: write discovered email back to the contact record
      await supabase.from('contacts').update({ email }).eq('id', contact.id);
      contact.email = email;
      contactByEmail.set(email.toLowerCase(), contact);
      console.log(`[CAL_POLL] Identity resolved: ${email} → ${contact.first_name} ${contact.last_name}`);
    }
  }

  // ── Log one activity per event ───────────────────────────────────────────────
  let logged = 0;
  for (const event of events) {
    if (!(event.start?.dateTime || event.start?.date)) continue;

    const all = [...(event.attendees || [])];
    if (event.organizer?.email && !all.find(a => a.email === event.organizer.email)) {
      all.push({ email: event.organizer.email, responseStatus: 'accepted', displayName: event.organizer.displayName });
    }

    // Normal path — log for every attendee we resolved to a contact by email.
    let matchedAny = false;
    for (const attendee of all) {
      const email = attendee.email?.toLowerCase();
      if (!email || email === ownerEmail || isNonHumanEmail(email)) continue;
      const contact = contactByEmail.get(email);
      if (!contact) continue;
      matchedAny = true;
      logged += await recordMeeting(supabase, conn.workspace_id, event, contact, { rsvp: attendee.responseStatus });
    }
    if (matchedAny) continue;

    // Title fallback — a 1:1 scheduler booking (Zoom Scheduler / Calendly) lands on
    // your calendar with YOU as the only guest and the counterparty only in the
    // title ("… with Mansoor Ali"). When no human guest resolved, extract the name
    // and match-or-create the person so the meeting still gets logged + surfaced.
    const hasHumanGuest = all.some(a => {
      const e = a.email?.toLowerCase();
      return e && e !== ownerEmail && !isNonHumanEmail(e);
    });
    if (hasHumanGuest) continue;   // real attendees we just don't have — don't trust the title
    if (!looksLikeExternalBooking(event)) continue;   // personal block — not a booking

    // Cost guard: skip the LLM when we've already logged this event at its current
    // start. A moved start (reschedule) falls through and re-runs. Hard dedup in
    // recordMeeting still protects against any double-log if this lets one through.
    const startKey = new Date(event.start.dateTime || event.start.date).toISOString().slice(0, 16);
    const { data: prior } = await supabase.from('observations')
      .select('observed_at')
      .eq('workspace_id', conn.workspace_id)
      .eq('source', 'google_calendar')
      .like('external_id', `gcal_${event.id}_%`)
      .order('observed_at', { ascending: false })
      .limit(1);
    if (prior?.length && new Date(prior[0].observed_at).toISOString().slice(0, 16) === startKey) continue;

    const name = await extractCounterpartyName({ title: event.summary, description: event.description, ownerName });
    if (!name) continue;
    const res = await resolveOrCreateByName(supabase, conn.workspace_id, name);
    if (!res?.contact) {
      console.log(`[CAL_POLL] Title name "${name}" ambiguous/partial — skipped event "${event.summary}"`);
      continue;
    }
    if (res.created) console.log(`[CAL_POLL] Title-booking created contact "${name}" for "${event.summary}"`);
    logged += await recordMeeting(supabase, conn.workspace_id, event, res.contact, { rsvp: 'accepted' });
  }

  console.log(`[CAL_POLL] workspace=${conn.workspace_id}: ${events.length} events, ${logged} logged`);

  // Only surface scans that actually logged something — empty scans are noise
  // in the user-facing Live Op Log (the console.log above keeps the full audit trail).
  if (logged > 0) {
    try {
      await supabase.from('workspace_system_log').insert({
        workspace_id: conn.workspace_id,
        source:       'calendar',
        event_type:   'scan_complete',
        summary:      `Calendar scan: ${logged} event${logged === 1 ? '' : 's'} logged (${events.length} fetched)`,
        metadata:     { fetched: events.length, logged, lookback_days: LOOKBACK_DAYS, lookahead_days: LOOKAHEAD_DAYS },
        billable_ops: logged,
        occurred_at:  new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[CAL_POLL] system_log insert failed:', e.message);
    }
  }

  return logged;
}

export async function pollAllWorkspaces() {
  const supabase = getSupabaseClient();
  const connections = await getCalendarConnections(supabase);
  console.log(`[CAL_POLL] Starting — ${connections.length} workspace(s) with calendar scope`);

  let total = 0;
  for (const conn of connections) {
    try { total += await pollWorkspace(supabase, conn); }
    catch (e) {
      if (isTokenRevoked(e)) await markGoogleConnectionRevoked(supabase, conn, 'gmail');
      console.error(`[CAL_POLL] workspace=${conn.workspace_id}:`, e.message);
    }
  }

  console.log(`[CAL_POLL] Done — ${total} total activities logged`);
  return total;
}

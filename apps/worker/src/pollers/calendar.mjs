// Google Calendar poller — scans a rolling time window around now.
// Fetches events ±7d/+30d across all connected workspaces,
// resolves attendees to contacts via a 3-step waterfall, and logs activities.
// Dedup is handled by externalId (gcal_{event.id}).

import { google } from 'googleapis';
import { getSupabaseClient, listActivities } from '@nous/core';
import { logActivity } from '../utils/activity.mjs';
import { refreshGoogleToken } from '../utils/googleOAuth.mjs';
import { isTokenRevoked, markGoogleConnectionRevoked } from '../utils/connectionHealth.mjs';

const LOOKBACK_DAYS  = 7;
const LOOKAHEAD_DAYS = 30;
const MEETING_RE     = /\b(book|booked|schedul|call|meeting|appointment|calendly|slot|zoom|meet|catch up|sync)\b/i;

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
      if (!email || email === ownerEmail) continue;
      if (!externalAttendees.has(email)) externalAttendees.set(email, a.displayName || null);
    }
  }

  if (!externalAttendees.size) return 0;

  // ── Pass 1: exact email match ────────────────────────────────────────────────
  const { data: emailContacts } = await supabase
    .from('contacts')
    .select('id, email, first_name, last_name, company_id')
    .eq('workspace_id', conn.workspace_id)
    .in('email', [...externalAttendees.keys()]);

  const contactByEmail = new Map(
    (emailContacts || []).map(c => [c.email.toLowerCase(), c])
  );

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

  if (!contactByEmail.size) return 0;

  // ── Log one activity per event per matched attendee ──────────────────────────
  let logged = 0;
  for (const event of events) {
    const startTime = event.start?.dateTime || event.start?.date;
    if (!startTime) continue;
    const occurredAt = new Date(startTime).toISOString();
    const isPast = new Date(startTime) < new Date();
    const title = event.summary || 'Calendar meeting';

    const all = [...(event.attendees || [])];
    if (event.organizer?.email && !all.find(a => a.email === event.organizer.email)) {
      all.push({ email: event.organizer.email, responseStatus: 'accepted' });
    }

    for (const attendee of all) {
      const email = attendee.email?.toLowerCase();
      if (!email || email === ownerEmail) continue;
      const contact = contactByEmail.get(email);
      if (!contact) continue;

      const rsvp = attendee.responseStatus;
      const type = (isPast && rsvp === 'accepted') ? 'meeting_held' : 'meeting_scheduled';
      const label = rsvp === 'declined' ? '(Declined)' : isPast ? '(Held)' : '(Scheduled)';

      const result = await logActivity(supabase, {
        workspaceId: conn.workspace_id,
        contactId:   contact.id,
        companyId:   contact.company_id || null,
        type,
        source:      'google_calendar',
        externalId:  `gcal_${event.id}_${contact.id}`,
        occurredAt,
        description: `${title} ${label}`,
      });
      if (result) logged++;
    }
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

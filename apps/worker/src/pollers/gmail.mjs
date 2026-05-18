// Gmail poller — syncs sent and received emails for all connected workspaces.
// Runs every 30 minutes. Resolves external participants to existing contacts only
// (createIfMissing: false — Gmail never bootstraps new contacts).
// Dedup via externalId (gmail_MSGID).

import { google } from 'googleapis';
import { getSupabaseClient } from '@nous/core';
import { logActivity } from '../utils/activity.mjs';
import { refreshGoogleToken } from '../utils/googleOAuth.mjs';

const LOOKBACK_MS = 35 * 60 * 1000; // 35 min (slightly past cron interval to avoid gaps)

async function getGmailConnections(supabase) {
  const { data: conns } = await supabase
    .from('workflow_provider_connections')
    .select('id, workspace_id, encrypted_credentials, workflow_providers!inner(name)')
    .eq('is_verified', true)
    .eq('workflow_providers.name', 'gmail_oauth');
  return (conns || []).filter(c =>
    (c.encrypted_credentials?.scope || '').includes('gmail')
  );
}

function makeOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URI,
  );
}

function extractHeader(headers, name) {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || null;
}

function parseAddresses(raw) {
  if (!raw) return [];
  return raw.split(',').map(part => {
    const m = part.match(/<([^>]+)>/) || part.match(/([^\s,]+@[^\s,]+)/);
    return m ? m[1].toLowerCase().trim() : null;
  }).filter(Boolean);
}

async function pollWorkspace(supabase, conn) {
  const { credentials, needsUpdate, updatedCredentials } =
    await refreshGoogleToken(conn.encrypted_credentials);

  if (needsUpdate) {
    await supabase.from('workflow_provider_connections')
      .update({ encrypted_credentials: updatedCredentials }).eq('id', conn.id);
  }

  const auth = makeOAuth2Client();
  auth.setCredentials({ access_token: credentials.access_token });
  const gmail = google.gmail({ version: 'v1', auth });

  const ownerEmail = credentials.email?.toLowerCase();
  const afterEpoch = Math.floor((Date.now() - LOOKBACK_MS) / 1000);

  // Fetch recent sent + received messages
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: `after:${afterEpoch}`,
    maxResults: 100,
  });

  const messages = listRes.data.messages || [];
  if (!messages.length) return 0;

  // Collect all external email addresses across all messages
  const msgDetails = [];
  for (const { id } of messages) {
    try {
      const { data: msg } = await gmail.users.messages.get({
        userId: 'me', id, format: 'metadata',
        metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'],
      });
      msgDetails.push(msg);
    } catch { /* skip inaccessible messages */ }
  }

  if (!msgDetails.length) return 0;

  // Collect unique external emails
  const externalEmails = new Set();
  for (const msg of msgDetails) {
    const headers = msg.payload?.headers || [];
    const from = parseAddresses(extractHeader(headers, 'From'));
    const to   = parseAddresses(extractHeader(headers, 'To'));
    const cc   = parseAddresses(extractHeader(headers, 'Cc'));
    for (const email of [...from, ...to, ...cc]) {
      if (email && email !== ownerEmail) externalEmails.add(email);
    }
  }

  if (!externalEmails.size) return 0;

  // Match existing contacts only
  const { data: contacts } = await supabase.from('contacts').select('id, email, company_id')
    .eq('workspace_id', conn.workspace_id).in('email', [...externalEmails]);
  const contactByEmail = new Map((contacts || []).map(c => [c.email.toLowerCase(), c]));
  if (!contactByEmail.size) return 0;

  let logged = 0;
  for (const msg of msgDetails) {
    const headers  = msg.payload?.headers || [];
    const fromAddr = parseAddresses(extractHeader(headers, 'From'))[0] || null;
    const toAddrs  = parseAddresses(extractHeader(headers, 'To'));
    const subject  = extractHeader(headers, 'Subject') || '(no subject)';
    const dateStr  = extractHeader(headers, 'Date');
    const occurredAt = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();
    const snippet  = msg.snippet?.slice(0, 300) || null;

    const isOutbound = fromAddr === ownerEmail;
    const counterparts = isOutbound ? toAddrs : [fromAddr].filter(Boolean);

    for (const email of counterparts) {
      const contact = contactByEmail.get(email);
      if (!contact) continue;

      const result = await logActivity(supabase, {
        workspaceId: conn.workspace_id,
        contactId:   contact.id,
        companyId:   contact.company_id || null,
        type:        isOutbound ? 'email_sent' : 'email_received',
        source:      'gmail',
        externalId:  `gmail_${msg.id}_${contact.id}`,
        occurredAt,
        description: snippet || (isOutbound ? `Email sent: ${subject}` : `Email received: ${subject}`),
        summary:     snippet,
        rawData:     { message_id: msg.id, subject, from: fromAddr, to: toAddrs },
      });
      if (result) logged++;
    }
  }

  if (logged) console.log(`[GMAIL_POLL] workspace=${conn.workspace_id}: ${logged} emails logged`);
  return logged;
}

export async function pollAllGmailWorkspaces() {
  const supabase = getSupabaseClient();
  const connections = await getGmailConnections(supabase);
  if (!connections.length) return 0;

  console.log(`[GMAIL_POLL] Starting — ${connections.length} workspace(s)`);
  let total = 0;
  for (const conn of connections) {
    try { total += await pollWorkspace(supabase, conn); }
    catch (e) { console.error(`[GMAIL_POLL] workspace=${conn.workspace_id}:`, e.message); }
  }
  console.log(`[GMAIL_POLL] Done — ${total} total activities logged`);
  return total;
}

// Retroactive contact history enricher.
// After CSV import, fans out to every connected integration (Gmail, IMAP/SMTP,
// LinkedIn/Unipile, Instantly, Slack) to find prior interactions and logs them
// as contact_activity_log entries so pipeline stages are correct from day 1.

import { google } from 'googleapis';
import { decrypt } from '../utils/crypto.mjs';
import { refreshGoogleTokenIfNeeded } from '../utils/googleOAuth.js';

// ── Unipile helpers ───────────────────────────────────────────────────────────

const UNIPILE_BASE = () => {
  const dsn = process.env.UNIPILE_DSN;
  if (!dsn) throw new Error('UNIPILE_DSN not configured');
  return `https://${dsn}/api/v1`;
};

const unipileHeaders = () => ({
  'X-API-KEY': process.env.UNIPILE_API_KEY || '',
  'Content-Type': 'application/json',
  accept: 'application/json',
});

function normaliseLinkedInUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const m = u.pathname.match(/\/in\/([^/]+)/);
    if (!m) return null;
    return `https://www.linkedin.com/in/${m[1].toLowerCase()}`;
  } catch { return null; }
}

async function unipilePages(url, accountId) {
  const items = [];
  let cursor = null;
  do {
    const u = new URL(url);
    u.searchParams.set('account_id', accountId);
    u.searchParams.set('limit', '100');
    if (cursor) u.searchParams.set('cursor', cursor);
    const res = await fetch(u.toString(), { headers: unipileHeaders() });
    if (!res.ok) break;
    const body = await res.json();
    if (Array.isArray(body.items)) items.push(...body.items);
    cursor = body.cursor || null;
  } while (cursor);
  return items;
}

// ── Progress store ────────────────────────────────────────────────────────────
// In-memory job state for real-time progress polling (auto-cleaned after 10 min)

export const enrichmentJobs = new Map();

// ── logActivity — dedup by external_id ───────────────────────────────────────

async function logActivity(supabase, { workspaceId, contactId, companyId, type, source, externalId, occurredAt, description, summary }) {
  if (externalId) {
    const { data: existing } = await supabase
      .from('contact_activity_log')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('external_id', externalId)
      .maybeSingle();
    if (existing) return false;
  }
  const { error } = await supabase.from('contact_activity_log').insert({
    workspace_id:  workspaceId,
    contact_id:    contactId,
    company_id:    companyId || null,
    activity_type: type,
    source,
    external_id:   externalId || null,
    occurred_at:   occurredAt,
    description,
    summary:       summary || null,
  });
  return !error;
}

// ── Connection loader ─────────────────────────────────────────────────────────

async function getWorkspaceConnections(supabase, workspaceId) {
  const { data: conns } = await supabase
    .from('workflow_provider_connections')
    .select('id, encrypted_credentials, workflow_providers!inner(name)')
    .eq('workspace_id', workspaceId)
    .eq('is_verified', true);

  const map = {};
  for (const conn of conns || []) {
    const name = conn.workflow_providers?.name;
    if (name) map[name] = conn;
  }

  const { data: liConn } = await supabase
    .from('workspace_linkedin_connections')
    .select('unipile_account_id')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (liConn?.unipile_account_id) map.linkedin = { account_id: liConn.unipile_account_id };

  return map;
}

// ── LinkedIn attendee map (fetched once per run) ──────────────────────────────

async function buildAttendeeMap(accountId) {
  const byUrl                 = new Map();
  const byMemberId            = new Map();
  const connectedAt           = new Map();
  const connectedAtByMemberId = new Map();
  try {
    const [attendees, relations] = await Promise.all([
      unipilePages(`${UNIPILE_BASE()}/chat_attendees`, accountId),
      unipilePages(`${UNIPILE_BASE()}/users/relations`, accountId),
    ]);
    for (const a of attendees) {
      const norm = normaliseLinkedInUrl(a.profile_url);
      if (norm) byUrl.set(norm, a.id);
      if (a.provider_id) byMemberId.set(a.provider_id, a.id);
    }
    for (const r of relations) {
      const norm = normaliseLinkedInUrl(r.public_profile_url || (r.public_identifier ? `https://www.linkedin.com/in/${r.public_identifier}` : null));
      if (norm && r.created_at) connectedAt.set(norm, new Date(r.created_at).toISOString());
      if (r.provider_id && r.created_at) connectedAtByMemberId.set(r.provider_id, new Date(r.created_at).toISOString());
    }
  } catch (e) {
    console.error('[ENRICH_LI] Attendee map failed:', e.message);
  }
  return { byUrl, byMemberId, connectedAt, connectedAtByMemberId };
}

// ── Gmail ─────────────────────────────────────────────────────────────────────

async function scanGmail(supabase, workspaceId, contact, gmailConn) {
  if (!contact.email) return 0;
  try {
    const { credentials, needsUpdate, updatedCredentials } =
      await refreshGoogleTokenIfNeeded(gmailConn.encrypted_credentials);

    if (needsUpdate) {
      await supabase.from('workflow_provider_connections')
        .update({ encrypted_credentials: updatedCredentials })
        .eq('id', gmailConn.id);
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_OAUTH_REDIRECT_URI,
    );
    oauth2Client.setCredentials({ access_token: credentials.access_token });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    let nextPageToken = null;
    let fetched = 0;
    let logged = 0;

    do {
      const listRes = await gmail.users.threads.list({
        userId: 'me',
        q: `{from:${contact.email} to:${contact.email}}`,
        maxResults: 100,
        ...(nextPageToken && { pageToken: nextPageToken }),
      });

      const threads = listRes.data.threads || [];
      nextPageToken = listRes.data.nextPageToken || null;
      fetched += threads.length;

      for (const thread of threads) {
        const t = await gmail.users.threads.get({ userId: 'me', id: thread.id, format: 'full' });
        const msgs = t.data.messages || [];
        if (!msgs.length) continue;

        const first   = msgs[0];
        const hdrs    = first?.payload?.headers || [];
        const dateHdr = hdrs.find(h => h.name === 'Date')?.value;
        const subject = hdrs.find(h => h.name === 'Subject')?.value || '(no subject)';
        const snippet = first?.snippet || '';
        const occurredAt = dateHdr ? new Date(dateHdr).toISOString() : new Date().toISOString();

        const hasSent  = msgs.some(m => m.labelIds?.includes('SENT'));
        const hasInbox = msgs.some(m => m.labelIds?.includes('INBOX'));
        const isReply  = msgs.length > 1 || (hasSent && hasInbox);

        const r = await logActivity(supabase, {
          workspaceId,
          contactId:   contact.id,
          companyId:   contact.company_id || null,
          type:        isReply ? 'email_reply' : 'email_opened',
          source:      'gmail',
          externalId:  `gmail_thread_${thread.id}`,
          occurredAt,
          description: subject,
          summary:     snippet ? snippet.slice(0, 200) : null,
        });
        if (r) logged++;
      }
    } while (nextPageToken && fetched < 500);

    console.log(`[ENRICH_GMAIL] ${contact.email}: ${logged} logged`);
    return logged;
  } catch (e) {
    console.error(`[ENRICH_GMAIL] ${contact.email}:`, e.message);
    return 0;
  }
}

// ── IMAP (custom SMTP connection) ─────────────────────────────────────────────

async function scanImap(supabase, workspaceId, contact, smtpConn) {
  if (!contact.email) return 0;
  try {
    const { ImapFlow }    = await import('imapflow');
    const { simpleParser } = await import('mailparser');

    const creds = smtpConn.encrypted_credentials;
    let host, username, password;
    try { host     = decrypt(creds.host     || creds.smtp_host); }    catch { host     = creds.host     || creds.smtp_host; }
    try { username = decrypt(creds.username || creds.smtp_username || creds.email); } catch { username = creds.username || creds.smtp_username || creds.email; }
    try { password = decrypt(creds.password || creds.smtp_password); } catch { password = creds.password || creds.smtp_password; }

    if (!host || !username || !password) return 0;

    let imapHost;
    try { imapHost = creds.imap_host ? decrypt(creds.imap_host) : null; } catch { imapHost = creds.imap_host || null; }
    let imapPort;
    try { imapPort = creds.imap_port ? parseInt(decrypt(creds.imap_port)) : null; } catch { imapPort = parseInt(creds.imap_port || '993'); }

    if (!imapHost) {
      if (/office365\.com|smtp-mail\.outlook\.com/i.test(host)) imapHost = 'outlook.office365.com';
      else imapHost = host.replace(/^smtp\./i, 'imap.');
    }
    imapPort = imapPort || 993;

    const client = new ImapFlow({
      host: imapHost, port: imapPort, secure: imapPort === 993,
      auth: { user: username, pass: password },
      logger: false,
    });

    await client.connect();

    let logged = 0;
    const connectedEmail = username.toLowerCase();
    const contactEmail   = contact.email.toLowerCase();
    const allFolders = await client.list();
    const inboxPath = allFolders.find(m => m.flags?.has('\\Inbox') || m.path === 'INBOX')?.path || 'INBOX';
    const sentPath  = allFolders.find(m => m.flags?.has('\\Sent'))?.path || null;

    const processFolder = async (folderPath) => {
      const lock = await client.getMailboxLock(folderPath);
      try {
        const uids = await client.search(
          { or: [{ from: contactEmail }, { to: contactEmail }] },
          { uid: true }
        );
        for (const uid of uids.slice(0, 200)) {
          try {
            const { content } = await client.download(String(uid), undefined, { uid: true });
            const chunks = [];
            for await (const chunk of content) chunks.push(chunk);
            const parsed = await simpleParser(Buffer.concat(chunks));

            const fromEmail  = (parsed.from?.value?.[0]?.address || '').toLowerCase();
            const toEmails   = (parsed.to?.value || []).map(a => (a.address || '').toLowerCase());
            const subject    = parsed.subject || '(no subject)';
            const occurredAt = parsed.date ? parsed.date.toISOString() : new Date().toISOString();
            const messageId  = parsed.messageId || `uid_${uid}_${folderPath}`;

            const isOutbound     = fromEmail === connectedEmail;
            const involvesContact = isOutbound ? toEmails.some(e => e === contactEmail) : fromEmail === contactEmail;
            if (!involvesContact) continue;

            const r = await logActivity(supabase, {
              workspaceId, contactId: contact.id, companyId: contact.company_id || null,
              type:       isOutbound ? 'email_sent' : 'email_received',
              source:     'smtp',
              externalId: `imap_${messageId.replace(/[<>\s]/g, '')}_${occurredAt.slice(0, 10)}`,
              occurredAt,
              description: subject,
              summary:    (parsed.text || '').slice(0, 200) || null,
            });
            if (r) logged++;
          } catch { /* per-message errors are non-fatal */ }
        }
      } finally {
        lock.release();
      }
    };

    for (const folder of [inboxPath, ...(sentPath ? [sentPath] : [])]) {
      try { await processFolder(folder); } catch (e) { console.warn(`[ENRICH_IMAP] folder ${folder}:`, e.message); }
    }

    await client.logout();
    console.log(`[ENRICH_IMAP] ${contact.email}: ${logged} logged`);
    return logged;
  } catch (e) {
    console.error(`[ENRICH_IMAP] ${contact.email}:`, e.message);
    return 0;
  }
}

// ── LinkedIn / Unipile ────────────────────────────────────────────────────────

async function scanLinkedIn(supabase, workspaceId, contact, accountId, attendeeMap) {
  if (!contact.linkedin_url && !contact.linkedin_member_id) return 0;
  let logged = 0;

  try {
    const norm       = normaliseLinkedInUrl(contact.linkedin_url);
    // Extract identifier from the ORIGINAL url (not norm) to preserve case — ACoAA member IDs are case-sensitive
    const identifier = contact.linkedin_url?.match(/\/in\/([^/?]+)/i)?.[1] || null;
    const storedMemberId = contact.linkedin_member_id || null;

    const knownConnectedAt = (storedMemberId && attendeeMap.connectedAtByMemberId.get(storedMemberId))
      || (norm && attendeeMap.connectedAt.get(norm));

    if (knownConnectedAt) {
      const r = await logActivity(supabase, {
        workspaceId, contactId: contact.id, companyId: contact.company_id || null,
        type: 'linkedin_connected', source: 'linkedin',
        externalId:  `li_conn_${storedMemberId || identifier}`,
        occurredAt:  knownConnectedAt,
        description: 'Connected on LinkedIn',
        summary:     '1st degree connection',
      });
      if (r) logged++;
    }

    // Message history
    // Check attendee map by storedMemberId, by URL, or by identifier (handles ACoAA-format provider IDs in the URL)
    const attendeeId = (storedMemberId && attendeeMap.byMemberId.get(storedMemberId))
      || (norm && attendeeMap.byUrl.get(norm))
      || (identifier && attendeeMap.byMemberId.get(identifier));

    let messages = [];
    if (attendeeId) {
      console.log(`[ENRICH_LI] found attendeeId=${attendeeId} for ${norm || identifier}`);
      // Fetch via attendee endpoint first to get the chat_id, then re-fetch from the chat endpoint for full history
      const sample = await unipilePages(`${UNIPILE_BASE()}/chat_attendees/${attendeeId}/messages`, accountId);
      const chatId = sample[0]?.chat_id;
      if (chatId) {
        console.log(`[ENRICH_LI] fetching full chat history from chat_id=${chatId}`);
        messages = await unipilePages(`${UNIPILE_BASE()}/chats/${chatId}/messages`, accountId);
      } else {
        messages = sample;
      }
    } else if (storedMemberId || identifier) {
      try {
        const candidateIds = [...new Set([storedMemberId, identifier].filter(Boolean))];

        for (const candidateId of candidateIds) {
          // Step 1: resolve the actual LinkedIn provider_id (ACoAA format) via /users/
          // This is critical — searching chats by a URL slug returns unrelated chats
          let realProviderId = null;
          console.log(`[ENRICH_LI PATH B] resolving ${candidateId} via /users/`);
          const profileRes = await fetch(`${UNIPILE_BASE()}/users/${candidateId}?account_id=${accountId}`, { headers: unipileHeaders() });
          if (profileRes.ok) {
            const profile = await profileRes.json();
            realProviderId = profile.provider_id || null;
            console.log(`[ENRICH_LI PATH B] resolved -> provider_id=${realProviderId}`);
            if (realProviderId && !storedMemberId) {
              try { await supabase.from('contacts').update({ linkedin_member_id: realProviderId }).eq('id', contact.id); } catch {}
            }
          } else {
            console.log(`[ENRICH_LI PATH B] /users/${candidateId} -> ${profileRes.status}`);
          }

          // Step 2: check if the resolved provider_id is already in our attendee map
          // If so, use the reliable Path A approach (attendee → chat_id → full messages)
          if (realProviderId) {
            const attendeeIdFromMap = attendeeMap.byMemberId.get(realProviderId);
            console.log(`[ENRICH_LI PATH B] attendee map lookup for ${realProviderId}: ${attendeeIdFromMap || 'not found'}`);
            if (attendeeIdFromMap) {
              const sample = await unipilePages(`${UNIPILE_BASE()}/chat_attendees/${attendeeIdFromMap}/messages`, accountId);
              const chatId = sample[0]?.chat_id;
              console.log(`[ENRICH_LI PATH B] Path A fallback: attendeeId=${attendeeIdFromMap} chatId=${chatId}`);
              if (chatId) {
                messages = await unipilePages(`${UNIPILE_BASE()}/chats/${chatId}/messages`, accountId);
              } else {
                messages = sample;
              }
              break;
            }
          }

          // Step 3: fall back to chat search by provider_id — less reliable, but last resort
          const searchId = realProviderId || (candidateId.startsWith('ACoAA') ? candidateId : null);
          if (!searchId) continue;

          console.log(`[ENRICH_LI PATH B] fallback chat search by provider_id=${searchId}`);
          const chatRes = await fetch(`${UNIPILE_BASE()}/chats?account_id=${accountId}&attendee_provider_id=${searchId}&limit=5`, { headers: unipileHeaders() });
          if (!chatRes.ok) { console.log(`[ENRICH_LI PATH B] /chats -> ${chatRes.status}`); continue; }

          const chats = (await chatRes.json()).items || [];
          console.log(`[ENRICH_LI PATH B] ${chats.length} chats found`);

          for (const chat of chats) {
            const chatMsgs = await unipilePages(`${UNIPILE_BASE()}/chats/${chat.id}/messages`, accountId);
            // Only DMs: group chats have multiple distinct inbound senders
            const inboundSenders = new Set(chatMsgs.filter(m => !m.is_sender && m.sender_id).map(m => m.sender_id));
            if (inboundSenders.size > 1) { console.log(`[ENRICH_LI PATH B] skip group chat ${chat.id} (${inboundSenders.size} senders)`); continue; }
            // Only include if all inbound messages come from one sender (the contact)
            if (inboundSenders.size === 1) messages.push(...chatMsgs);
          }

          if (messages.length > 0) break;
        }
      } catch (e) { console.error(`[ENRICH_LI PATH B] ${norm || storedMemberId}:`, e.message); }
    }

    const withText = messages.filter(m => m.text?.trim());
    console.log(`[ENRICH_LI] ${messages.length} msgs fetched, ${withText.length} have text, keys: ${JSON.stringify([...new Set(messages.slice(0,1).flatMap(m => Object.keys(m)))])}`);
    for (const msg of messages) {
      if (!msg.text?.trim()) continue;
      const r = await logActivity(supabase, {
        workspaceId, contactId: contact.id, companyId: contact.company_id || null,
        type: 'linkedin_message', source: 'linkedin',
        externalId:  `li_msg_${msg.id || msg.provider_id}`,
        occurredAt:  msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString(),
        description: 'LinkedIn message',
        summary:     msg.is_sender ? `You: ${msg.text.slice(0, 200)}` : msg.text.slice(0, 200),
      });
      if (r) logged++;
    }

    console.log(`[ENRICH_LI] ${contact.linkedin_url || storedMemberId}: ${logged} logged`);
    return logged;
  } catch (e) {
    console.error(`[ENRICH_LI] ${contact.linkedin_url}:`, e.message);
    return 0;
  }
}

// ── Instantly ─────────────────────────────────────────────────────────────────

async function scanInstantly(supabase, workspaceId, contact, apiKey) {
  if (!contact.email) return 0;
  try {
    const res = await fetch('https://api.instantly.ai/api/v2/leads/list', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts: [contact.email], limit: 1 }),
    });
    if (!res.ok) return 0;

    const data = await res.json();
    const lead = data.items?.[0];
    if (!lead) return 0;

    let logged = 0;
    if (lead.timestamp_last_reply) {
      const r = await logActivity(supabase, {
        workspaceId, contactId: contact.id, companyId: contact.company_id || null,
        type: 'email_reply', source: 'instantly',
        externalId:  `instantly_reply_${contact.email}`,
        occurredAt:  new Date(lead.timestamp_last_reply).toISOString(),
        description: 'Replied to cold email sequence',
        summary:     lead.campaign_name || null,
      });
      if (r) logged++;
    }
    if (lead.timestamp_last_open) {
      const r = await logActivity(supabase, {
        workspaceId, contactId: contact.id, companyId: contact.company_id || null,
        type: 'email_opened', source: 'instantly',
        externalId:  `instantly_open_${contact.email}`,
        occurredAt:  new Date(lead.timestamp_last_open).toISOString(),
        description: 'Opened cold email sequence',
        summary:     lead.campaign_name || null,
      });
      if (r) logged++;
    }

    console.log(`[ENRICH_INSTANTLY] ${contact.email}: ${logged} logged`);
    return logged;
  } catch (e) {
    console.error(`[ENRICH_INSTANTLY] ${contact.email}:`, e.message);
    return 0;
  }
}

// ── Slack ─────────────────────────────────────────────────────────────────────
// Uses user token to search messages mentioning the contact's email.

async function scanSlack(supabase, workspaceId, contact, slackConn) {
  if (!contact.email) return 0;
  try {
    const userToken = decrypt(slackConn.encrypted_credentials?.user_token);
    if (!userToken) return 0;

    const headers = { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' };

    // Search messages that mention this email
    const searchRes = await fetch(
      `https://slack.com/api/search.messages?query=${encodeURIComponent(contact.email)}&count=50`,
      { headers }
    );
    if (!searchRes.ok) return 0;
    const searchData = await searchRes.json();
    if (!searchData.ok) return 0;

    const messages = searchData.messages?.matches || [];
    let logged = 0;

    for (const msg of messages) {
      const occurredAt = msg.ts ? new Date(parseFloat(msg.ts) * 1000).toISOString() : new Date().toISOString();
      const r = await logActivity(supabase, {
        workspaceId, contactId: contact.id, companyId: contact.company_id || null,
        type: 'slack_message', source: 'slack',
        externalId:  `slack_msg_${msg.ts}_${msg.channel?.id}`,
        occurredAt,
        description: `Slack: #${msg.channel?.name || 'message'}`,
        summary:     msg.text ? msg.text.slice(0, 200) : null,
      });
      if (r) logged++;
    }

    console.log(`[ENRICH_SLACK] ${contact.email}: ${logged} logged`);
    return logged;
  } catch (e) {
    console.error(`[ENRICH_SLACK] ${contact.email}:`, e.message);
    return 0;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function enrichContactHistory(supabase, workspaceId, contactIds, jobId = null) {
  if (!contactIds?.length) return { enriched: 0, activitiesLogged: 0 };
  console.log(`[ENRICH] Starting: ${contactIds.length} contacts in ${workspaceId}`);

  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, email, first_name, last_name, company, company_id, linkedin_url, linkedin_member_id')
    .in('id', contactIds)
    .eq('workspace_id', workspaceId);

  if (!contacts?.length) return { enriched: 0, activitiesLogged: 0 };

  const connections = await getWorkspaceConnections(supabase, workspaceId);

  // Resolve credentials once
  const gmailConn     = connections.gmail_oauth || null;
  const smtpConn      = connections.smtp        || null;
  const slackConn     = connections.slack       || null;
  const instantlyKey  = connections.instantly?.encrypted_credentials?.api_key
    ? decrypt(connections.instantly.encrypted_credentials.api_key) : null;

  // Pre-fetch LinkedIn attendee map once for the whole batch
  let attendeeMap = { byUrl: new Map(), byMemberId: new Map(), connectedAt: new Map(), connectedAtByMemberId: new Map() };
  if (connections.linkedin?.account_id && process.env.UNIPILE_DSN && process.env.UNIPILE_API_KEY) {
    attendeeMap = await buildAttendeeMap(connections.linkedin.account_id);
  }

  // Initialise job progress state
  if (jobId) {
    const makeSource = (connected) => ({ status: connected ? 'pending' : 'skipped', count: 0 });
    enrichmentJobs.set(jobId, {
      contacts: contacts.map(c => ({
        id:    c.id,
        name:  [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
        email: c.email,
        sources: {
          gmail:    makeSource(!!gmailConn),
          smtp:     makeSource(!!smtpConn),
          linkedin: makeSource(!!connections.linkedin?.account_id),
          instantly: makeSource(!!instantlyKey),
          slack:    makeSource(!!slackConn),
        },
      })),
      done: false,
    });
    setTimeout(() => enrichmentJobs.delete(jobId), 10 * 60 * 1000);
  }

  const setSource = (contactId, source, status, count = 0) => {
    if (!jobId) return;
    const job = enrichmentJobs.get(jobId);
    if (!job) return;
    const c = job.contacts.find(x => x.id === contactId);
    if (c) c.sources[source] = { status, count };
  };

  let totalActivities = 0;

  // Process in batches of 5 to respect external API rate limits
  for (let i = 0; i < contacts.length; i += 5) {
    const batch = contacts.slice(i, i + 5);
    const results = await Promise.allSettled(batch.map(async (contact) => {
      let count = 0;

      if (gmailConn) {
        setSource(contact.id, 'gmail', 'scanning');
        const n = await scanGmail(supabase, workspaceId, contact, gmailConn);
        setSource(contact.id, 'gmail', 'done', n);
        count += n;
      }
      if (smtpConn) {
        setSource(contact.id, 'smtp', 'scanning');
        const n = await scanImap(supabase, workspaceId, contact, smtpConn);
        setSource(contact.id, 'smtp', 'done', n);
        count += n;
      }
      if (connections.linkedin?.account_id) {
        setSource(contact.id, 'linkedin', 'scanning');
        const n = await scanLinkedIn(supabase, workspaceId, contact, connections.linkedin.account_id, attendeeMap);
        setSource(contact.id, 'linkedin', 'done', n);
        count += n;
      }
      if (instantlyKey) {
        setSource(contact.id, 'instantly', 'scanning');
        const n = await scanInstantly(supabase, workspaceId, contact, instantlyKey);
        setSource(contact.id, 'instantly', 'done', n);
        count += n;
      }
      if (slackConn) {
        setSource(contact.id, 'slack', 'scanning');
        const n = await scanSlack(supabase, workspaceId, contact, slackConn);
        setSource(contact.id, 'slack', 'done', n);
        count += n;
      }

      return count;
    }));
    totalActivities += results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0), 0);
  }

  if (jobId) {
    const job = enrichmentJobs.get(jobId);
    if (job) job.done = true;
  }

  console.log(`[ENRICH] Done: ${totalActivities} activities for ${contacts.length} contacts`);
  return { enriched: contacts.length, activitiesLogged: totalActivities };
}

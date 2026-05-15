// SMTP/IMAP poller — reads INBOX + Sent via IMAP every 15 minutes.
// Logs email_sent / email_received activities on matching contacts.
// Dedup via externalId (imap_<messageId>_<date>).
// Never creates new contacts — update-only, same as Gmail.

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { getSupabaseClient } from '@proply/core';
import { logActivity } from '../utils/activity.mjs';
import { decrypt } from '../utils/encryption.mjs';

const LOOKBACK_DAYS = 30; // initial window; subsequent syncs use last_imap_sync_date

// Auto-reply detection (avoids logging OOO / vacation responders)
const AUTO_REPLY_SUBJECTS = /^(auto:|automatic reply|out of office|away|vacation)/i;
function isAutoReply(headers, subject) {
  if (AUTO_REPLY_SUBJECTS.test(subject || '')) return true;
  if ((headers['auto-submitted'] || '').toLowerCase() !== 'no') return !!headers['auto-submitted'];
  return false;
}

async function getSmtpConnections(supabase) {
  const { data: conns } = await supabase
    .from('workflow_provider_connections')
    .select('id, workspace_id, encrypted_credentials, workflow_providers!inner(name)')
    .eq('is_verified', true)
    .eq('workflow_providers.name', 'smtp');
  return conns || [];
}

function safeDecrypt(val) {
  if (!val) return null;
  try { return decrypt(val); } catch { return val; }
}

async function pollWorkspace(supabase, conn) {
  const raw = conn.encrypted_credentials || {};

  const host     = safeDecrypt(raw.host);
  const username = safeDecrypt(raw.username);
  const password = safeDecrypt(raw.password);

  if (!host || !username || !password) {
    console.warn('[SMTP_POLL] Missing credentials for conn', conn.id);
    return 0;
  }

  // Derive IMAP host from SMTP host if not explicit
  let imapHost = safeDecrypt(raw.imap_host) || null;
  let imapPort = raw.imap_port ? parseInt(safeDecrypt(raw.imap_port) || '993') : 993;

  if (!imapHost) {
    if (/office365\.com|smtp-mail\.outlook\.com/i.test(host)) {
      imapHost = 'outlook.office365.com';
    } else {
      imapHost = host.replace(/^smtp\./i, 'imap.');
    }
  }

  const lastSync = raw.last_imap_sync_date
    ? new Date(raw.last_imap_sync_date)
    : new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);

  const client = new ImapFlow({
    host: imapHost,
    port: imapPort,
    secure: imapPort === 993,
    auth: { user: username, pass: password },
    logger: false,
  });

  await client.connect();

  // Load workspace contacts for matching
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, email, company_id')
    .eq('workspace_id', conn.workspace_id)
    .not('email', 'is', null);

  const contactByEmail = {};
  for (const c of contacts || []) {
    if (c.email) contactByEmail[c.email.toLowerCase()] = c;
  }

  const connectedEmail = username.toLowerCase();
  let processed = 0;

  // Auto-detect INBOX and Sent folders
  const allFolders = await client.list();
  const inboxPath = allFolders.find(f => f.flags?.has('\\Inbox') || f.path === 'INBOX')?.path || 'INBOX';
  const sentPath  = allFolders.find(f => f.flags?.has('\\Sent'))?.path || null;
  const foldersToScan = [inboxPath, ...(sentPath ? [sentPath] : [])];

  const processFolder = async (folderPath) => {
    const lock = await client.getMailboxLock(folderPath);
    try {
      const uids = await client.search({ since: lastSync }, { uid: true });

      for (const uid of uids) {
        try {
          const { content } = await client.download(String(uid), undefined, { uid: true });
          const chunks = [];
          for await (const chunk of content) chunks.push(chunk);
          const parsed = await simpleParser(Buffer.concat(chunks));

          const fromEmail = (parsed.from?.value?.[0]?.address || '').toLowerCase();
          const toEmails  = (parsed.to?.value  || []).map(a => (a.address || '').toLowerCase());
          const ccEmails  = (parsed.cc?.value  || []).map(a => (a.address || '').toLowerCase());
          const subject   = parsed.subject || '(no subject)';
          const occurredAt = parsed.date?.toISOString() ?? new Date().toISOString();
          const messageId  = parsed.messageId || `uid_${uid}_${folderPath}`;

          const hdrs = {
            'auto-submitted': parsed.headers?.get('auto-submitted') || '',
          };
          if (isAutoReply(hdrs, subject)) continue;

          const isOutbound = fromEmail === connectedEmail;
          let contact = null;

          if (isOutbound) {
            for (const email of [...toEmails, ...ccEmails]) {
              if (contactByEmail[email]) { contact = contactByEmail[email]; break; }
            }
          } else {
            contact = contactByEmail[fromEmail] || null;
          }

          if (!contact) continue;

          const externalId = `imap_${messageId.replace(/[<>\s]/g, '')}_${occurredAt.slice(0, 10)}`;
          const snippet = (parsed.text || '').slice(0, 300) || null;

          await logActivity(supabase, {
            workspaceId: conn.workspace_id,
            contactId:   contact.id,
            companyId:   contact.company_id || null,
            type:        isOutbound ? 'email_sent' : 'email_received',
            source:      'smtp',
            externalId,
            occurredAt,
            description: isOutbound ? `Email sent: ${subject}` : `Email received: ${subject}`,
            summary:     snippet,
            rawData: {
              subject,
              from:      parsed.from?.text,
              to:        toEmails.join(', '),
              cc:        ccEmails.join(', ') || null,
              direction: isOutbound ? 'outbound' : 'inbound',
            },
          });

          processed++;
        } catch (msgErr) {
          console.warn('[SMTP_POLL] Message error uid', uid, 'in', folderPath, msgErr.message);
        }
      }
    } finally {
      lock.release();
    }
  };

  for (const folder of foldersToScan) {
    await processFolder(folder).catch(e =>
      console.warn('[SMTP_POLL] folder', folder, e.message)
    );
  }

  await client.logout();

  // Persist last sync timestamp
  await supabase.from('workflow_provider_connections')
    .update({ encrypted_credentials: { ...raw, last_imap_sync_date: new Date().toISOString() } })
    .eq('id', conn.id);

  if (processed) {
    console.log(`[SMTP_POLL] workspace=${conn.workspace_id} imap=${imapHost}:${imapPort} processed=${processed}`);
  }
  return processed;
}

export async function pollAllSmtpWorkspaces() {
  const supabase = getSupabaseClient();
  const connections = await getSmtpConnections(supabase);
  if (!connections.length) return 0;

  console.log(`[SMTP_POLL] Starting — ${connections.length} workspace(s)`);
  let total = 0;
  for (const conn of connections) {
    try { total += await pollWorkspace(supabase, conn); }
    catch (e) { console.error(`[SMTP_POLL] workspace=${conn.workspace_id}:`, e.message); }
  }
  if (total) console.log(`[SMTP_POLL] Done — ${total} activities logged`);
  return total;
}

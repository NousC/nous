// ============================================================
// LinkedIn integration via Unipile
//
// Required env vars:
//   UNIPILE_API_KEY  — your Unipile API key
//   UNIPILE_DSN      — e.g. api1.unipile.com:13465  (from Unipile dashboard)
//   VITE_API_URL     — your public app URL (for OAuth redirect)
// ============================================================

const BASE = () => {
  const dsn = process.env.UNIPILE_DSN;
  if (!dsn) throw new Error('UNIPILE_DSN not configured');
  return `https://${dsn}/api/v1`;
};

const headers = () => {
  const key = process.env.UNIPILE_API_KEY;
  if (!key) throw new Error('UNIPILE_API_KEY not configured');
  return { 'X-API-KEY': key, 'Content-Type': 'application/json', accept: 'application/json' };
};

// Backend URL — used for webhook registration and OAuth redirects (must be the Express server, not the frontend CDN)
const publicBase = () =>
  (process.env.BACKEND_URL || process.env.API_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');


// ── Unipile API helpers ────────────────────────────────────────────────────────

async function createHostedAuthLink(workspaceId) {
  // expiresOn must be in the future — Unipile also expires links on daily restart
  const expiresOn = new Date(Date.now() + 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, '.000Z');

  const res = await fetch(`${BASE()}/hosted/accounts/link`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      type: 'create',
      providers: ['LINKEDIN'],
      expiresOn,
      success_redirect_url: `${publicBase()}/api/linkedin/callback?workspace_id=${workspaceId}`,
      failure_redirect_url: `${publicBase()}/api/linkedin/callback?workspace_id=${workspaceId}&error=auth_failed`,
      api_url: BASE(),
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Unipile auth link failed (${res.status}): ${err}`);
  }
  return res.json(); // { object: 'HostedAuthLink', url: '...' }
}

async function getAccountDetails(accountId) {
  const res = await fetch(`${BASE()}/accounts/${accountId}`, { headers: headers() });
  if (!res.ok) return null;
  return res.json();
}

async function deleteAccount(accountId) {
  await fetch(`${BASE()}/accounts/${accountId}`, { method: 'DELETE', headers: headers() });
}

// Register (or update) the Unipile webhook for a given account so push events arrive at our server.
// Unipile de-dupes by URL — safe to call on every connect.
async function ensureWebhookRegistered(accountId) {
  const url = `${publicBase()}/api/linkedin/webhook`;
  try {
    const res = await fetch(`${BASE()}/webhooks`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        account_id: accountId,
        url,
        events: ['message_received', 'new_relation'],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn(`[LINKEDIN] Webhook registration returned ${res.status}: ${err}`);
    } else {
      console.log(`[LINKEDIN] Webhook registered → ${url}`);
    }
  } catch (e) {
    console.warn('[LINKEDIN] Webhook registration failed (non-fatal):', e.message);
  }
}

// Fetch a LinkedIn member's full profile from Unipile — returns photo_url or null.
// Silently fails so a missing profile never blocks the sync.
async function fetchLinkedInPhoto(accountId, memberId) {
  if (!memberId) return null;
  try {
    const url = new URL(`${BASE()}/linkedin/profiles`);
    url.searchParams.set('account_id', accountId);
    url.searchParams.set('provider_id', memberId);
    const res = await fetch(url.toString(), { headers: headers() });
    if (!res.ok) return null;
    const data = await res.json();
    // Unipile may return the photo under different keys depending on API version
    return data.profile_picture_url || data.photo_url || data.picture_url
      || data.profile?.profile_picture_url || data.profile?.photo_url || null;
  } catch {
    return null;
  }
}

// Paginate through all items from a Unipile list endpoint
async function fetchAllPages(url, accountId) {
  const items = [];
  let cursor = null;
  do {
    const u = new URL(url);
    u.searchParams.set('account_id', accountId);
    u.searchParams.set('limit', '100');
    if (cursor) u.searchParams.set('cursor', cursor);
    const res = await fetch(u.toString(), { headers: headers() });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[UNIPILE] fetchAllPages ${u.toString()} → ${res.status}: ${errText}`);
      break;
    }
    const body = await res.json();
    if (Array.isArray(body.items)) items.push(...body.items);
    cursor = body.cursor || null;
  } while (cursor);
  return items;
}

// ── Sync helpers ──────────────────────────────────────────────────────────────

// Normalise a LinkedIn profile URL to a consistent format for matching
function normaliseLinkedInUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    // keep only /in/username — strip query, trailing slash, www prefix
    const match = u.pathname.match(/\/in\/([^/]+)/);
    if (!match) return null;
    return `https://www.linkedin.com/in/${match[1]}`;
  } catch {
    return null;
  }
}

// Find a Proply contact by LinkedIn URL, member ID, or full name
async function matchContact(supabase, workspaceId, { profileUrl, fullName, memberId }) {
  // 1. Normalize URL match (handles trailing slash variants)
  const normUrl = normaliseLinkedInUrl(profileUrl);
  if (normUrl) {
    const { data } = await supabase
      .from('contacts')
      .select('id')
      .eq('workspace_id', workspaceId)
      .ilike('linkedin_url', `${normUrl}%`)
      .maybeSingle();
    if (data) return data.id;
  }
  // 2. Member ID match — Unipile returns provider_id (ACoAA...) for chat attendees
  if (memberId) {
    const { data } = await supabase
      .from('contacts')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('linkedin_member_id', memberId)
      .maybeSingle();
    if (data) return data.id;
    // Also check channels->linkedin->member_id for contacts populated via backfill
    const { data: d2 } = await supabase
      .from('contacts')
      .select('id')
      .eq('workspace_id', workspaceId)
      .contains('channels', { linkedin: { member_id: memberId } })
      .maybeSingle();
    if (d2) return d2.id;
  }
  // 3. Name match fallback
  if (fullName) {
    const parts = fullName.trim().split(/\s+/);
    const first = parts[0];
    const last  = parts.slice(1).join(' ');
    if (first && last) {
      const { data } = await supabase
        .from('contacts')
        .select('id')
        .eq('workspace_id', workspaceId)
        .ilike('first_name', first)
        .ilike('last_name', last)
        .maybeSingle();
      if (data) return data.id;
    }
  }
  return null;
}

// Write a deduped activity log entry (skip if same type+source already logged today)
async function logActivity(supabase, { workspaceId, contactId, activityType, description, occurredAt, rawData }) {
  const dayStart = new Date(occurredAt);
  dayStart.setUTCHours(0, 0, 0, 0);

  const { data: existing } = await supabase
    .from('contact_activity_log')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .eq('activity_type', activityType)
    .eq('source', 'linkedin')
    .gte('occurred_at', dayStart.toISOString())
    .limit(1);

  if (existing?.length > 0) return; // already logged today

  await supabase.from('contact_activity_log').insert({
    workspace_id:  workspaceId,
    contact_id:    contactId,
    activity_type: activityType,
    description,
    source:        'linkedin',
    occurred_at:   occurredAt,
    raw_data:      rawData,
  });
}

// Pull LinkedIn connections from Unipile → match contacts → log new connections
async function syncConnections(supabase, workspaceId, accountId) {
  const relations = await fetchAllPages(`${BASE()}/users/relations`, accountId);
  let matched = 0;

  for (const rel of relations) {
    const profileUrl = rel.public_profile_url || (rel.public_identifier
      ? `https://www.linkedin.com/in/${rel.public_identifier}` : null);
    const fullName = [rel.first_name, rel.last_name].filter(Boolean).join(' ') || null;
    const contactId = await matchContact(supabase, workspaceId, {
      profileUrl: profileUrl || rel.profile_url,
      memberId:   rel.member_id || null,
      fullName,
    });
    if (!contactId) continue;

    // Patch linkedin_url and photo_url onto contact if missing
    const { data: contactSnap } = await supabase
      .from('contacts')
      .select('linkedin_url, photo_url')
      .eq('id', contactId)
      .single();

    const contactUpdates = {};
    if (profileUrl && !contactSnap?.linkedin_url)
      contactUpdates.linkedin_url = normaliseLinkedInUrl(profileUrl);
    if (!contactSnap?.photo_url) {
      const photo = await fetchLinkedInPhoto(accountId, rel.member_id);
      if (photo) contactUpdates.photo_url = photo;
    }
    if (Object.keys(contactUpdates).length)
      await supabase.from('contacts').update(contactUpdates).eq('id', contactId);

    const connectedAt = rel.created_at ? new Date(rel.created_at).toISOString() : new Date().toISOString();
    await logActivity(supabase, {
      workspaceId,
      contactId,
      activityType: 'linkedin_connected',
      description:  `LinkedIn connection${fullName ? ` with ${fullName}` : ''}`,
      occurredAt:   connectedAt,
      rawData:      { member_id: rel.member_id, full_name: fullName, headline: rel.headline },
    });

    // Update channels.linkedin with connection state
    const { data: cd } = await supabase.from('contacts').select('channels').eq('id', contactId).single();
    const ch = cd?.channels || {};
    const li = ch.linkedin || {};
    await supabase.from('contacts').update({
      channels: {
        ...ch,
        linkedin: {
          ...li,
          url:          normaliseLinkedInUrl(profileUrl || rel.profile_url) || li.url,
          member_id:    rel.member_id || li.member_id,
          state:        'connected',
          connected_at: li.connected_at || connectedAt,
          synced_at:    new Date().toISOString(),
        },
      },
    }).eq('id', contactId);

    matched++;
  }

  return { total: relations.length, matched };
}

// Pull LinkedIn conversations from Unipile → update last_touch for matched contacts
async function syncConversations(supabase, workspaceId, accountId) {
  const chats = await fetchAllPages(`${BASE()}/chats`, accountId);
  let matched = 0;

  for (const chat of chats) {
    // The /chats list response does NOT embed an attendees array.
    // The other person's provider_id and name are top-level fields on the chat object.
    const memberId = chat.attendee_provider_id || null;
    const contactId = await matchContact(supabase, workspaceId, {
      profileUrl: null,
      memberId,
      fullName: chat.name,
    });
    if (!contactId) continue;

    const lastMsgAt = chat.timestamp;
    if (!lastMsgAt) continue;

    // Update contact's last_activity_at if this message is newer
    try {
      await supabase.rpc('update_last_activity_if_newer', {
        p_contact_id: contactId,
        p_occurred_at: lastMsgAt,
      });
    } catch {
      // rpc may not exist — silently skip
    }

    // Store chat_id in channels.linkedin for fast outbound message lookup
    const { data: cd } = await supabase.from('contacts').select('channels').eq('id', contactId).single();
    const ch = cd?.channels || {};
    const li = ch.linkedin || {};
    await supabase.from('contacts').update({
      channels: {
        ...ch,
        linkedin: { ...li, chat_id: chat.id, synced_at: new Date().toISOString() },
      },
    }).eq('id', contactId);

    matched++;
  }

  return { total: chats.length, matched };
}

// Main sync entry point — call for one workspace
export async function runLinkedInSync(supabase, workspaceId) {
  const { data: conn } = await supabase
    .from('workspace_linkedin_connections')
    .select('unipile_account_id')
    .eq('workspace_id', workspaceId)
    .single();

  if (!conn) return { skipped: true, reason: 'not_connected' };

  console.log(`[LINKEDIN_SYNC] starting for workspace ${workspaceId}, account ${conn.unipile_account_id}`);
  // Sequential: connections first so member_id is written before conversations tries to match
  const connections  = await syncConnections(supabase, workspaceId, conn.unipile_account_id);
  const conversations = await syncConversations(supabase, workspaceId, conn.unipile_account_id);
  console.log(`[LINKEDIN_SYNC] done — connections:`, connections, 'conversations:', conversations);

  await supabase
    .from('workspace_linkedin_connections')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId);

  return { connections, conversations };
}

// Poll pending sent invitations and detect acceptances.
// Much lighter than a full syncConnections — only fetches the small pending-invites list.
// Runs every 5 minutes in-process.
export async function pollInviteAcceptances(supabase, workspaceId) {
  const { data: conn } = await supabase
    .from('workspace_linkedin_connections')
    .select('unipile_account_id')
    .eq('workspace_id', workspaceId)
    .single();
  if (!conn) return { checked: 0, accepted: 0 };

  // Fetch all pending sent invitations from Unipile (paginated)
  const pendingMemberIds = new Set();
  let cursor = null;
  do {
    const params = new URLSearchParams({ account_id: conn.unipile_account_id, limit: '250' });
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(`${BASE()}/users/invite/sent?${params}`, { headers: headers() });
    if (!res.ok) {
      console.warn('[INVITE_POLL] Unipile invite/sent failed:', res.status);
      break;
    }
    const data = await res.json();
    for (const item of data.items || []) {
      if (item.invited_user_id) pendingMemberIds.add(item.invited_user_id);
    }
    cursor = data.cursor || null;
  } while (cursor);

  // Find contacts in this workspace still sitting at invite_sent
  const { data: contacts } = await supabase
    .from('contacts')
    .select('id, linkedin_member_id, channels, company_id')
    .eq('workspace_id', workspaceId)
    .filter('channels->linkedin->>state', 'eq', 'invite_sent');

  if (!contacts?.length) return { checked: 0, accepted: 0 };

  let accepted = 0;
  for (const contact of contacts) {
    const memberId = contact.linkedin_member_id;
    if (!memberId) continue;

    // Still pending → skip
    if (pendingMemberIds.has(memberId)) continue;

    // No longer pending → they accepted (or withdrew, rare)
    const now = new Date().toISOString();
    const ch = contact.channels || {};
    const li = ch.linkedin || {};

    const { error: upErr } = await supabase.from('contacts').update({
      channels: { ...ch, linkedin: { ...li, state: 'connected', connected_at: now } },
    }).eq('id', contact.id);
    if (upErr) { console.error('[INVITE_POLL] update failed:', upErr.message); continue; }

    await logActivity(supabase, {
      workspaceId,
      contactId:    contact.id,
      activityType: 'linkedin_connected',
      description:  'Connected on LinkedIn (accepted invite)',
      occurredAt:   now,
      rawData:      { detected_by: 'invite_poll', member_id: memberId },
    });

    console.log(`[INVITE_POLL] Accepted: contact ${contact.id} (member ${memberId})`);
    accepted++;
  }

  return { checked: contacts.length, accepted };
}

// Send a LinkedIn DM — creates a new chat or uses existing one
async function sendLinkedInMessage(accountId, linkedinUserId, text) {
  const res = await fetch(`${BASE()}/chats`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      account_id: accountId,
      attendees_ids: [linkedinUserId],
      text,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Unipile send message failed (${res.status}): ${err}`);
  }
  return res.json();
}

// Send a LinkedIn connection request with an optional note
async function sendConnectionRequest(accountId, linkedinUserId, message = '') {
  const body = { account_id: accountId, provider_id: linkedinUserId };
  if (message) body.message = message;

  const res = await fetch(`${BASE()}/users/invite`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Unipile connection request failed (${res.status}): ${err}`);
  }
  return res.json();
}


// Resolve a linkedin_url to a Unipile member ID (the ACoAA... format).
// Check the contacts table first; fall back to a Unipile profile fetch.
async function resolveLinkedInMemberId(supabase, workspaceId, accountId, { linkedinUrl, linkedinMemberId }) {
  if (linkedinMemberId) return linkedinMemberId;

  const normUrl = normaliseLinkedInUrl(linkedinUrl);
  if (!normUrl) throw new Error('Invalid LinkedIn URL');

  // Check contacts table first (fastest path, no Unipile call)
  const { data: contact } = await supabase
    .from('contacts')
    .select('linkedin_member_id')
    .eq('workspace_id', workspaceId)
    .ilike('linkedin_url', normUrl)
    .maybeSingle();

  if (contact?.linkedin_member_id) return contact.linkedin_member_id;

  // Fall back to Unipile profile lookup using the slug
  const slug = normUrl.match(/\/in\/([^/]+)/)?.[1];
  if (!slug) throw new Error(`Could not extract slug from LinkedIn URL: ${linkedinUrl}`);

  const res = await fetch(`${BASE()}/users/${slug}?account_id=${accountId}`, { headers: headers() });
  if (!res.ok) throw new Error(`Unipile profile lookup failed for ${slug} (${res.status})`);

  const profile = await res.json();
  const memberId = profile.provider_id || profile.id;
  if (!memberId) throw new Error(`No member ID returned for LinkedIn profile: ${slug}`);

  return memberId;
}

// Fetch a LinkedIn post from Unipile and return its social_id.
// Unipile accepts the full post URL (URL-encoded) as the path identifier.
async function resolvePostSocialId(accountId, postUrl) {
  const params = new URLSearchParams({ account_id: accountId });
  const res = await fetch(`${BASE()}/posts/${encodeURIComponent(postUrl)}?${params}`, { headers: headers() });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Unipile post lookup failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  const socialId = data.social_id || data.id;
  if (!socialId) throw new Error('Could not resolve post social_id — Unipile returned no ID for this URL');
  return socialId;
}

// Reply to an existing Unipile chat thread
async function replyToChat(chatId, text) {
  const res = await fetch(`${BASE()}/chats/${chatId}/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Unipile reply failed (${res.status}): ${err}`);
  }
  return res.json();
}


// ── Route handlers ─────────────────────────────────────────────────────────────

export function registerLinkedInRoutes(app, supabase, verifySupabaseAuth) {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // GET /api/linkedin/status?workspaceId=...
  // Returns whether this workspace has LinkedIn connected
  app.get('/api/linkedin/status', verifySupabaseAuth, async (req, res) => {
    try {
      const { workspaceId } = req.query;
      if (!workspaceId || !uuidRe.test(workspaceId))
        return res.status(400).json({ error: 'invalid_workspace_id' });

      const { data } = await supabase
        .from('workspace_linkedin_connections')
        .select('id, linkedin_name, linkedin_headline, linkedin_profile_url, connected_at')
        .eq('workspace_id', workspaceId)
        .single();

      return res.json({ connected: !!data, connection: data || null });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /api/linkedin/connect?workspaceId=...
  // Creates a Unipile hosted auth link and returns it
  app.get('/api/linkedin/connect', verifySupabaseAuth, async (req, res) => {
    try {
      const { workspaceId } = req.query;
      if (!workspaceId || !uuidRe.test(workspaceId))
        return res.status(400).json({ error: 'invalid_workspace_id' });

      if (!process.env.UNIPILE_API_KEY || !process.env.UNIPILE_DSN)
        return res.status(503).json({ error: 'linkedin_not_configured', message: 'Unipile credentials not yet set up' });

      const { url } = await createHostedAuthLink(workspaceId);
      return res.json({ url });
    } catch (err) {
      console.error('[LINKEDIN_CONNECT] error:', err.message, '| DSN:', process.env.UNIPILE_DSN, '| key set:', !!process.env.UNIPILE_API_KEY);
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /api/linkedin/callback?workspace_id=...&account_id=...
  // Unipile redirects here after successful LinkedIn auth
  app.get('/api/linkedin/callback', async (req, res) => {
    const { workspace_id, account_id, error } = req.query;

    if (error || !workspace_id || !account_id) {
      return res.send(`<html><body><script>
        window.opener?.postMessage({ type: 'linkedin_auth', success: false, error: '${error || 'missing_params'}' }, '*');
        window.close();
      </script><p>Authentication failed. You can close this window.</p></body></html>`);
    }

    try {
      // Fetch account details from Unipile
      const details = await getAccountDetails(account_id);
      const profileUrl = details?.sources?.LINKEDIN?.profile_url || null;
      const name = details?.name || null;
      const headline = details?.sources?.LINKEDIN?.headline || null;

      // Upsert into DB
      await supabase.from('workspace_linkedin_connections').upsert({
        workspace_id,
        unipile_account_id: account_id,
        linkedin_name:        name,
        linkedin_headline:    headline,
        linkedin_profile_url: profileUrl,
        connected_at:         new Date().toISOString(),
      }, { onConflict: 'workspace_id' });

      // Register webhook so Unipile pushes events to us
      await ensureWebhookRegistered(account_id);

      return res.send(`<html><body><script>
        window.opener?.postMessage({ type: 'linkedin_auth', success: true }, '*');
        window.close();
      </script><p>LinkedIn connected! You can close this window.</p></body></html>`);
    } catch (err) {
      console.error('[LINKEDIN_CALLBACK]', err.message);
      return res.send(`<html><body><script>
        window.opener?.postMessage({ type: 'linkedin_auth', success: false, error: 'save_failed' }, '*');
        window.close();
      </script><p>Error saving connection. Please try again.</p></body></html>`);
    }
  });

  // DELETE /api/linkedin/disconnect?workspaceId=...
  app.delete('/api/linkedin/disconnect', verifySupabaseAuth, async (req, res) => {
    try {
      const { workspaceId } = req.query;
      if (!workspaceId || !uuidRe.test(workspaceId))
        return res.status(400).json({ error: 'invalid_workspace_id' });

      // Get account_id before deleting
      const { data } = await supabase
        .from('workspace_linkedin_connections')
        .select('unipile_account_id')
        .eq('workspace_id', workspaceId)
        .single();

      if (data?.unipile_account_id && process.env.UNIPILE_API_KEY) {
        await deleteAccount(data.unipile_account_id).catch(() => {});
      }

      await supabase.from('workspace_linkedin_connections').delete().eq('workspace_id', workspaceId);
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/linkedin/message
  // Body: { workspaceId, linkedinUserId, text }
  app.post('/api/linkedin/message', verifySupabaseAuth, async (req, res) => {
    try {
      const { workspaceId, linkedinUserId, text } = req.body;
      if (!workspaceId || !linkedinUserId || !text)
        return res.status(400).json({ error: 'missing_params' });
      if (!uuidRe.test(workspaceId))
        return res.status(400).json({ error: 'invalid_workspace_id' });

      const { data: conn } = await supabase
        .from('workspace_linkedin_connections')
        .select('unipile_account_id')
        .eq('workspace_id', workspaceId)
        .single();

      if (!conn) return res.status(404).json({ error: 'linkedin_not_connected' });

      const result = await sendLinkedInMessage(conn.unipile_account_id, linkedinUserId, text);
      return res.json({ success: true, result });
    } catch (err) {
      console.error('[LINKEDIN_MESSAGE]', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/linkedin/sync?workspaceId=...
  // Manual trigger — runs the same job as the nightly cron
  app.post('/api/linkedin/sync', verifySupabaseAuth, async (req, res) => {
    try {
      const { workspaceId } = req.query;
      if (!workspaceId || !uuidRe.test(workspaceId))
        return res.status(400).json({ error: 'invalid_workspace_id' });

      const result = await runLinkedInSync(supabase, workspaceId);
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error('[LINKEDIN_SYNC]', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/linkedin/invite
  // Body: { workspaceId, linkedinUserId, message? }
  app.post('/api/linkedin/invite', verifySupabaseAuth, async (req, res) => {
    try {
      const { workspaceId, linkedinUserId, message } = req.body;
      if (!workspaceId || !linkedinUserId)
        return res.status(400).json({ error: 'missing_params' });
      if (!uuidRe.test(workspaceId))
        return res.status(400).json({ error: 'invalid_workspace_id' });

      const { data: conn } = await supabase
        .from('workspace_linkedin_connections')
        .select('unipile_account_id')
        .eq('workspace_id', workspaceId)
        .single();

      if (!conn) return res.status(404).json({ error: 'linkedin_not_connected' });

      const result = await sendConnectionRequest(conn.unipile_account_id, linkedinUserId, message);
      return res.json({ success: true, result });
    } catch (err) {
      console.error('[LINKEDIN_INVITE]', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/linkedin/send-invite
  // Public proxy endpoint — accepts a linkedin_url instead of a raw member ID.
  // Resolves the member ID internally (contacts table → Unipile fallback).
  // Caller never needs Unipile credentials or workspace ID — both are derived from the API key.
  // Body: { linkedin_url, linkedin_member_id?, note? }
  app.post('/api/linkedin/send-invite', verifySupabaseAuth, async (req, res) => {
    try {
      const { linkedin_url, linkedin_member_id, note } = req.body;
      // Workspace comes from the API key — no need to pass it in the body
      const workspaceId = req.apiKeyWorkspaceId;
      if (!workspaceId)
        return res.status(401).json({ error: 'api_key_required', detail: 'This endpoint requires API key authentication' });
      if (!linkedin_url)
        return res.status(400).json({ error: 'missing_params', required: ['linkedin_url'] });
      if (note && note.length > 300)
        return res.status(400).json({ error: 'note_too_long', max: 300 });

      const { data: conn } = await supabase
        .from('workspace_linkedin_connections')
        .select('unipile_account_id')
        .eq('workspace_id', workspaceId)
        .single();
      if (!conn) return res.status(404).json({ error: 'linkedin_not_connected' });

      const memberId = await resolveLinkedInMemberId(supabase, workspaceId, conn.unipile_account_id, {
        linkedinUrl: linkedin_url,
        linkedinMemberId: linkedin_member_id,
      });

      const result = await sendConnectionRequest(conn.unipile_account_id, memberId, note || '');

      // Advance state to invite_sent immediately — don't wait for the webhook
      const normUrl = normaliseLinkedInUrl(linkedin_url);
      if (normUrl) {
        const { data: contact } = await supabase
          .from('contacts')
          .select('id, channels')
          .eq('workspace_id', workspaceId)
          .ilike('linkedin_url', normUrl)
          .maybeSingle();
        if (contact && !['connected'].includes(contact.channels?.linkedin?.state)) {
          const ch = contact.channels || {};
          const li = ch.linkedin || {};
          const now = new Date().toISOString();
          const { error: updateErr } = await supabase.from('contacts').update({
            channels: {
              ...ch,
              linkedin: {
                ...li,
                state:        'invite_sent',
                state_origin: 'outbound',
                invited_at:   li.invited_at || now,
                synced_at:    now,
                ...(result?.id && { invite_id: result.id }),
              },
            },
          }).eq('id', contact.id);
          if (updateErr) console.error('[LINKEDIN_SEND_INVITE] channels update failed:', updateErr.message);
        }
      }

      return res.json({ success: true, result });
    } catch (err) {
      console.error('[LINKEDIN_SEND_INVITE]', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/linkedin/send-message
  // Public proxy endpoint — accepts linkedin_url and optional chat_id.
  // If chat_id is provided: replies to that existing conversation thread.
  // If not: resolves member ID and opens a new chat.
  // Returns { chat_id } — caller should persist this for future replies.
  // Workspace derived from API key — no need to pass workspaceId in body.
  // Body: { text, linkedin_url?, linkedin_member_id?, chat_id? }
  app.post('/api/linkedin/send-message', verifySupabaseAuth, async (req, res) => {
    try {
      const { text, linkedin_url, linkedin_member_id, chat_id } = req.body;
      const workspaceId = req.apiKeyWorkspaceId;
      if (!workspaceId)
        return res.status(401).json({ error: 'api_key_required', detail: 'This endpoint requires API key authentication' });
      if (!text)
        return res.status(400).json({ error: 'missing_params', required: ['text'] });
      if (!linkedin_url && !linkedin_member_id && !chat_id)
        return res.status(400).json({ error: 'missing_params', detail: 'Provide linkedin_url, linkedin_member_id, or chat_id' });

      const { data: conn } = await supabase
        .from('workspace_linkedin_connections')
        .select('unipile_account_id')
        .eq('workspace_id', workspaceId)
        .single();
      if (!conn) return res.status(404).json({ error: 'linkedin_not_connected' });

      let result;
      let returnedChatId;

      if (chat_id) {
        result = await replyToChat(chat_id, text);
        returnedChatId = chat_id;
      } else {
        const memberId = await resolveLinkedInMemberId(supabase, workspaceId, conn.unipile_account_id, {
          linkedinUrl: linkedin_url,
          linkedinMemberId: linkedin_member_id,
        });
        result = await sendLinkedInMessage(conn.unipile_account_id, memberId, text);
        returnedChatId = result?.id || result?.chat_id || null;
      }

      // Persist chat_id to channels.linkedin — critical for outbound webhook resolution
      if (returnedChatId) {
        const normUrl = linkedin_url ? normaliseLinkedInUrl(linkedin_url) : null;
        const { data: contact } = await supabase
          .from('contacts')
          .select('id, channels')
          .eq('workspace_id', workspaceId)
          .or(
            normUrl
              ? `channels.cs.{"linkedin":{"chat_id":"${returnedChatId}"}},linkedin_url.ilike.${normUrl}`
              : `channels.cs.{"linkedin":{"chat_id":"${returnedChatId}"}}`
          )
          .maybeSingle();
        if (contact && contact.channels?.linkedin?.chat_id !== returnedChatId) {
          const ch = contact.channels || {};
          const li = ch.linkedin || {};
          const { error: chatUpdateErr } = await supabase.from('contacts').update({
            channels: {
              ...ch,
              linkedin: { ...li, chat_id: returnedChatId, synced_at: new Date().toISOString() },
            },
          }).eq('id', contact.id);
          if (chatUpdateErr) console.error('[LINKEDIN_SEND_MESSAGE] channels update failed:', chatUpdateErr.message);
        }
      }

      return res.json({ success: true, chat_id: returnedChatId, result });
    } catch (err) {
      console.error('[LINKEDIN_SEND_MESSAGE]', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // POST /api/linkedin/post-comment
  // Body: { post_url, text, linkedin_url? }
  // Resolves the post's social_id via Unipile, posts the comment, and optionally
  // logs a linkedin_post_comment activity against the contact identified by linkedin_url.
  // Workspace derived from API key.
  app.post('/api/linkedin/post-comment', verifySupabaseAuth, async (req, res) => {
    try {
      const { post_url, text, linkedin_url } = req.body;
      const workspaceId = req.apiKeyWorkspaceId;
      if (!workspaceId)
        return res.status(401).json({ error: 'api_key_required', detail: 'This endpoint requires API key authentication' });
      if (!post_url || !text)
        return res.status(400).json({ error: 'missing_params', required: ['post_url', 'text'] });
      if (text.length > 1250)
        return res.status(400).json({ error: 'text_too_long', max: 1250 });

      const { data: conn } = await supabase
        .from('workspace_linkedin_connections')
        .select('unipile_account_id')
        .eq('workspace_id', workspaceId)
        .single();
      if (!conn) return res.status(404).json({ error: 'linkedin_not_connected' });

      // Resolve the post's social_id — Unipile requires this, not the URL-visible ID
      const socialId = await resolvePostSocialId(conn.unipile_account_id, post_url);

      // Post the comment via Unipile (multipart/form-data as per Unipile spec)
      const form = new FormData();
      form.append('account_id', conn.unipile_account_id);
      form.append('text', text);

      const commentRes = await fetch(`${BASE()}/posts/${encodeURIComponent(socialId)}/comments`, {
        method: 'POST',
        headers: { 'X-API-KEY': process.env.UNIPILE_API_KEY, accept: 'application/json' },
        body: form,
      });
      if (!commentRes.ok) {
        const err = await commentRes.text();
        throw new Error(`Unipile post comment failed (${commentRes.status}): ${err}`);
      }
      const commentData = await commentRes.json();
      const commentId = commentData.comment_id || null;

      // Log activity against the contact if a linkedin_url was supplied
      if (linkedin_url) {
        const contactId = await matchContact(supabase, workspaceId, { profileUrl: linkedin_url, fullName: null, memberId: null });
        if (contactId) {
          await logActivity(supabase, {
            workspaceId,
            contactId,
            activityType: 'linkedin_post_comment',
            description: 'Commented on LinkedIn post',
            occurredAt: new Date().toISOString(),
            rawData: { post_url, comment_id: commentId, text: text.slice(0, 200) },
          });
        }
      }

      return res.json({ success: true, comment_id: commentId });
    } catch (err) {
      console.error('[LINKEDIN_POST_COMMENT]', err.message);
      return res.status(500).json({ error: err.message });
    }
  });
}

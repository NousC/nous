# Enrichment History Backfill

When a contact is added to Nous — via CSV import, CRM sync, or any other bulk source — their activity history starts empty. The history backfill fixes this immediately by scanning every connected integration for prior interactions and logging them as `contact_activity_log` entries. This means pipeline stages and deal health scores are accurate from day one, not after weeks of passive signal accumulation.

---

## When it runs

**Source:** `apps/api/src/services/contactHistoryEnricher.mjs:612`

`enrichContactHistory()` is called:
- After every CSV import (`POST /api/contacts/import`) — fires for all newly created AND updated contacts
- Manually via the "Scan history" button on a contact page

It runs **asynchronously in the background** — the API responds immediately and the scan proceeds without blocking the caller. A `jobId` is returned so the frontend can poll for real-time per-contact, per-source progress.

---

## What it scans

The backfill fans out to every integration that is connected and verified for the workspace. Integrations that are not connected are marked `skipped` in the job progress state — they do not block or delay other scans.

| Integration | What it looks for | Activity types logged |
|-------------|------------------|-----------------------|
| Gmail | All threads where the contact's email appears as sender or recipient (up to 500 threads) | `email_reply`, `email_opened` |
| IMAP/SMTP | Inbox + Sent folders, up to 200 messages per folder | `email_sent`, `email_received` |
| LinkedIn (Unipile) | Connection date + full DM history | `linkedin_connected`, `linkedin_message` |
| Instantly | Last reply and last open timestamps for the contact's email | `email_reply`, `email_opened` |
| Slack | Up to 50 messages mentioning the contact's email | `slack_message` |
| Fireflies | All transcripts where contact was a participant | `meeting_held` |
| Fathom | All meetings where contact was a participant (up to 50) | `meeting_held` |

---

## Processing model

Contacts are processed in **batches of 5**, with each contact's integrations scanned sequentially within its batch slot. All 5 slots run in parallel via `Promise.allSettled`.

The LinkedIn attendee map (all chat attendees + connections from Unipile) is **fetched once per job** before the batch loop begins — not per-contact. This avoids N API calls to Unipile for the LinkedIn portion.

---

## Gmail scan detail

Queries Gmail for all threads matching `{from:<email> to:<email>}`, paginating up to 500 threads. For each thread:

- Reads the first message's `Date` and `Subject` headers
- Determines activity type: `email_reply` if the thread has both SENT and INBOX labels (or multiple messages), otherwise `email_opened`
- Logs once per thread using `external_id = gmail_thread_<thread_id>` for deduplication

---

## IMAP scan detail

Connects to the workspace's custom SMTP/IMAP account. Searches both the Inbox and Sent folders for messages involving the contact's email (up to 200 UIDs per folder). Parses each message via `mailparser` and logs:

- `email_sent` — message was sent by the connected account to the contact
- `email_received` — message was received from the contact

Supports Office 365 and standard IMAP servers. IMAP host is inferred from the SMTP host if not explicitly configured (`smtp.host` → `imap.host`).

---

## LinkedIn scan detail

LinkedIn resolution runs a two-path approach because Unipile member IDs (`ACoAA...` format) are case-sensitive and URL slugs are not reliable for chat lookup:

**Path A (fast — contact in attendee map)**
1. Match contact by stored `linkedin_member_id` → attendee map → `attendeeId`
2. Fetch messages via `/chat_attendees/<attendeeId>/messages` to get `chat_id`
3. Fetch full history from `/chats/<chat_id>/messages`

**Path B (fallback — contact not in attendee map)**
1. Resolve the real `provider_id` (ACoAA format) via `/users/<slug>`
2. Write `provider_id` back to `contacts.linkedin_member_id` for future use
3. Re-check attendee map with resolved `provider_id` (may have been stored under a different key)
4. If still not found: search `/chats?attendee_provider_id=<provider_id>` and verify inbound sender matches to exclude group chats

Connection date is logged as `linkedin_connected` if the contact is a 1st-degree connection (appears in `users/relations`).

All activities use `external_id = li_msg_<message_id>` / `li_conn_<member_id>` for deduplication.

---

## Instantly scan detail

Calls `POST https://api.instantly.ai/api/v2/leads/list` with the contact's email. Returns at most one lead record. Logs:
- `email_reply` using `timestamp_last_reply` (if present)
- `email_opened` using `timestamp_last_open` (if present)

One activity per signal per contact — uses stable `external_id`s so re-running doesn't duplicate.

---

## Slack scan detail

Uses the workspace's Slack **user token** (not bot token) to call `search.messages?query=<email>`. Returns up to 50 matching messages. Each message is logged as `slack_message` with the channel name and message text (truncated to 200 chars).

---

## Fireflies scan detail

Queries the Fireflies GraphQL API for all transcripts where `participant_email` matches the contact. Logs each transcript as `meeting_held` with the meeting title as description and the transcript overview summary (up to 300 chars) as the activity summary.

---

## Fathom scan detail

Calls `GET /external/v1/meetings?participant_email=<email>&limit=50`. Logs each meeting as `meeting_held` with the meeting title and any available AI summary.

---

## Deduplication

Every activity is logged via a shared `logActivity()` helper that checks for an existing row with the same `external_id` before inserting. If a match is found, the insert is skipped. This makes the backfill fully idempotent — running it multiple times on the same contact produces no duplicate entries.

---

## Progress tracking

When called with a `jobId`, the backfill maintains an in-memory state map (`enrichmentJobs`) tracking per-contact, per-source status: `pending → scanning → done` with an item count. This map is automatically cleared after 10 minutes. The frontend polls this state to show a live progress UI during the scan.

---

## System log

Each completed scan (per contact, per source) writes a `scan_complete` event to `workspace_system_log`, visible in the Live Op Log. This provides an auditable record of what was found and when the scan ran.

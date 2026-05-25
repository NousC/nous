// Op logger — fire-and-forget middleware that records every /v2/* call into
// workspace_system_log so it shows up in the Live Op Log on the Ops page.
//
// Why: the v2 endpoints are the agent surface (MCP, SDK, direct HTTP). The
// Ops page reads from workspace_system_log; without this nothing the agent
// does is visible. Every other Nous capability (Attio sync, LinkedIn webhook,
// Gmail poller, etc.) already inserts a row — this brings agent ops into the
// same stream.
//
// Source detection rides the X-Nous-Client header that our MCP + SDK set
// (mcp / sdk / agent). curl / unknown clients fall back to 'api'.

import { getSupabaseClient } from '@nous/core';

function detectSource(req) {
  const client = (req.get('X-Nous-Client') || '').toLowerCase();
  if (client === 'mcp' || client === 'sdk' || client === 'agent') return client;
  const ua = (req.get('User-Agent') || '').toLowerCase();
  if (ua.includes('python'))    return 'sdk';   // requests, httpx
  if (ua.includes('node-fetch') || ua.includes('axios')) return 'sdk';
  return 'api';
}

// Map { req.method + base path } → human op name shown in the Op Log row.
// Anything missing falls back to a generic "v2.<segment>".
const PATH_LABELS = {
  'POST /v2/context':         'v2.context',
  'GET /v2/accounts':         'v2.account.get',
  'POST /v2/observations':    'v2.observations.write',
  'POST /v2/query':           'v2.query',
  'GET /v2/attention':        'v2.attention',
  'POST /v2/verify':          'v2.verify',
  'POST /v2/dedup':           'v2.dedup',
  'GET /v2/workspace/facts':  'v2.workspace.facts',
};

function labelFor(req) {
  // Strip any trailing identifier from a path like /v2/accounts/sarah@acme.com
  // so the lookup matches the route, not the value.
  const base = req.baseUrl + (req.route?.path && req.route.path !== '/'
    ? req.route.path.replace(/\/:[^/]+/g, '')
    : '');
  const key = `${req.method} ${base}`;
  if (PATH_LABELS[key]) return PATH_LABELS[key];
  // Fallback: collapse to /v2/<segment>
  const seg = base.split('/').filter(Boolean)[1] || 'unknown';
  return `v2.${seg}`;
}

function summarize(req, status, ms) {
  const path = req.originalUrl.split('?')[0];
  const ok = status < 400;
  const mark = ok ? '✓' : '✗';
  // Keep one line, useful in the Op Log feed.
  return `${mark} ${req.method} ${path} · ${status} · ${ms}ms`;
}

/**
 * Wraps an express router/handler so every response — success or failure —
 * appends a row to workspace_system_log. Non-blocking: the insert is fired
 * after res.finish so it never sits in the request path.
 */
export function logV2Op(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) return; // unauthenticated call (verifyApiKey rejected) — skip

    const duration_ms = Date.now() - start;
    const source = detectSource(req);
    const event_type = labelFor(req);
    const summary = summarize(req, res.statusCode, duration_ms);

    try {
      const supabase = getSupabaseClient();
      // Fire-and-forget. Any failure here is invisible by design — we'd rather
      // miss a log row than 500 an agent call because of a logging hiccup.
      supabase.from('workspace_system_log').insert({
        workspace_id: workspaceId,
        source,
        event_type,
        summary,
        metadata: {
          method:      req.method,
          path:        req.originalUrl,
          status:      res.statusCode,
          duration_ms,
          client:      req.get('X-Nous-Client') || null,
          user_agent:  req.get('User-Agent') || null,
        },
      }).then(() => {}, (err) => {
        console.error('[opLogger] insert failed:', err?.message);
      });
    } catch (err) {
      console.error('[opLogger] threw:', err?.message);
    }
  });

  next();
}

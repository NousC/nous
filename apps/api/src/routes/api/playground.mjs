// /api/playground — the chat-with-your-context demo backing /playground.
//
// Threads live in playground_threads (one per chat session), messages in
// playground_messages with a JSONB tool_calls trace per assistant message
// so the right-hand context panel can render from the same fetch that
// loads the conversation. Strict per-(workspace, user) scoping.
//
// Five endpoints:
//   GET    /threads                  — list threads, most-recently-touched first
//   POST   /threads                  — create a new (empty) thread
//   GET    /threads/:id/messages     — load the conversation + tool traces
//   POST   /chat                     — send a message, return assistant + trace
//   DELETE /threads/:id              — hard delete (cascades to messages)
//
// /chat is request-response (not SSE) for v1. The agent loop is fast enough
// at Haiku that the user-perceived latency is fine, and the implementation
// stays simple. Easy to upgrade to streaming later without changing the URL.

import { Router } from 'express';
import { getSupabaseClient } from '@nous/core';
import { verifySupabaseAuth } from '../../middleware/supabaseAuth.mjs';
import { runPlaygroundTurn } from '../../lib/playgroundAgent.mjs';

export const playgroundRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_LEN = 4000;       // anything longer is almost certainly pasted garbage
const HISTORY_LIMIT   = 20;         // pairs of (user, assistant) passed to the model

// Ensure (and only allow) the user to operate on threads they own in this workspace.
async function assertOwnership(supabase, threadId, userId, workspaceId) {
  const { data, error } = await supabase
    .from('playground_threads')
    .select('id, workspace_id, user_id')
    .eq('id', threadId)
    .maybeSingle();
  if (error || !data) return { ok: false, status: 404, error: 'thread_not_found' };
  if (data.workspace_id !== workspaceId || data.user_id !== userId) {
    return { ok: false, status: 403, error: 'forbidden' };
  }
  return { ok: true };
}

// ─── GET /threads ───────────────────────────────────────────────────────────

playgroundRouter.get('/threads', verifySupabaseAuth, async (req, res) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId_required' });

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('playground_threads')
      .select('id, title, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('user_id', req.user.id)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return res.json({ threads: data || [] });
  } catch (err) {
    console.error('[GET /api/playground/threads]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ─── POST /threads ──────────────────────────────────────────────────────────

playgroundRouter.post('/threads', verifySupabaseAuth, async (req, res) => {
  try {
    const { workspaceId } = req.body;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId_required' });

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('playground_threads')
      .insert({ workspace_id: workspaceId, user_id: req.user.id, title: 'New chat' })
      .select('id, title, created_at, updated_at')
      .single();
    if (error) throw error;
    return res.status(201).json({ thread: data });
  } catch (err) {
    console.error('[POST /api/playground/threads]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ─── GET /threads/:id/messages ──────────────────────────────────────────────

playgroundRouter.get('/threads/:id/messages', verifySupabaseAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { workspaceId } = req.query;
    if (!UUID.test(id)) return res.status(400).json({ error: 'invalid_id' });
    if (!workspaceId)  return res.status(400).json({ error: 'workspaceId_required' });

    const supabase = getSupabaseClient();
    const owns = await assertOwnership(supabase, id, req.user.id, String(workspaceId));
    if (!owns.ok) return res.status(owns.status).json({ error: owns.error });

    const { data, error } = await supabase
      .from('playground_messages')
      .select('id, role, content, tool_calls, created_at')
      .eq('thread_id', id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return res.json({ messages: data || [] });
  } catch (err) {
    console.error('[GET /api/playground/threads/:id/messages]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ─── DELETE /threads/:id ────────────────────────────────────────────────────

playgroundRouter.delete('/threads/:id', verifySupabaseAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { workspaceId } = req.query;
    if (!UUID.test(id)) return res.status(400).json({ error: 'invalid_id' });
    if (!workspaceId)  return res.status(400).json({ error: 'workspaceId_required' });

    const supabase = getSupabaseClient();
    const owns = await assertOwnership(supabase, id, req.user.id, String(workspaceId));
    if (!owns.ok) return res.status(owns.status).json({ error: owns.error });

    await supabase.from('playground_threads').delete().eq('id', id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/playground/threads/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ─── POST /chat ─────────────────────────────────────────────────────────────

playgroundRouter.post('/chat', verifySupabaseAuth, async (req, res) => {
  try {
    const { workspaceId, threadId, message } = req.body || {};
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId_required' });
    if (!threadId || !UUID.test(threadId)) return res.status(400).json({ error: 'threadId_required' });
    const text = String(message || '').trim();
    if (!text) return res.status(400).json({ error: 'message_required' });
    if (text.length > MAX_MESSAGE_LEN) return res.status(413).json({ error: 'message_too_long', max: MAX_MESSAGE_LEN });

    const supabase = getSupabaseClient();
    const owns = await assertOwnership(supabase, threadId, req.user.id, workspaceId);
    if (!owns.ok) return res.status(owns.status).json({ error: owns.error });

    // Pull the recent history for context window. Cap at HISTORY_LIMIT pairs
    // so very long threads don't blow the prompt — we trim from the front
    // (oldest), keeping the most-recent turns which are most relevant.
    const { data: priorRows, error: histErr } = await supabase
      .from('playground_messages')
      .select('role, content, created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT * 2);
    if (histErr) throw histErr;
    const history = (priorRows || []).reverse()
      .map(m => ({ role: m.role, content: m.content }));

    // Persist the user message before calling the model so a model crash
    // doesn't lose what the user typed.
    const { data: userRow, error: userErr } = await supabase
      .from('playground_messages')
      .insert({ thread_id: threadId, role: 'user', content: text })
      .select('id, role, content, tool_calls, created_at')
      .single();
    if (userErr) throw userErr;

    // If this is the first user message in the thread, derive a title.
    if (history.length === 0) {
      const title = text.slice(0, 80) + (text.length > 80 ? '…' : '');
      // PostgrestFilterBuilder is thenable but not a real Promise — `.catch()`
      // isn't on the builder; wrap in try/await/catch instead. Best-effort:
      // a title bump must never block the chat reply.
      try {
        await supabase
          .from('playground_threads')
          .update({ title })
          .eq('id', threadId);
      } catch { /* ignore */ }
    }

    // Run the agent loop.
    let assistantContent = '';
    let toolCalls = [];
    try {
      const out = await runPlaygroundTurn({
        supabase, workspaceId,
        history, userMessage: text,
      });
      assistantContent = out.content;
      toolCalls = out.toolCalls;
    } catch (e) {
      console.error('[POST /api/playground/chat] agent error:', e);
      assistantContent = `Sorry — I hit an error running the agent (${e?.message || 'unknown'}). Try again, or simplify the question.`;
      toolCalls = [];
    }

    const { data: assistantRow, error: asstErr } = await supabase
      .from('playground_messages')
      .insert({
        thread_id: threadId, role: 'assistant',
        content: assistantContent,
        tool_calls: toolCalls.length ? toolCalls : null,
      })
      .select('id, role, content, tool_calls, created_at')
      .single();
    if (asstErr) throw asstErr;

    return res.json({ userMessage: userRow, assistantMessage: assistantRow });
  } catch (err) {
    console.error('[POST /api/playground/chat]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

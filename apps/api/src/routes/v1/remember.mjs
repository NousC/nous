import { Router } from 'express';
import OpenAI from 'openai';
import { getSupabaseClient, saveMemory } from '@nous/core';
import { logMcpOp } from '../../lib/mcpLogger.mjs';

export const rememberRouter = Router();

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// Embedding-based dedup threshold. Match the worker's signal pipeline (0.85+ ≈ same fact in slightly different words).
const SUPERSEDE_THRESHOLD = 0.85;

async function generateEmbedding(text) {
  if (!openai) return null;
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000),
    });
    return response.data[0].embedding;
  } catch (err) {
    console.warn('[REMEMBER_EMBEDDING_WARN]', err.message);
    return null;
  }
}

// Find the most-similar in-scope memory above threshold. Returns id or null.
async function findSupersedeCandidate(supabase, workspaceId, embedding, scope) {
  const { data, error } = await supabase.rpc('match_workspace_memories', {
    p_workspace_id: workspaceId,
    p_embedding:    JSON.stringify(embedding),
    p_threshold:    SUPERSEDE_THRESHOLD,
    p_limit:        5,
  });
  if (error || !data?.length) return null;

  const matchScope = (md) => {
    if (scope.contact_id) return md?.contact_id === scope.contact_id;
    if (scope.company_id) return md?.company_id === scope.company_id;
    return !md?.contact_id && !md?.company_id;
  };

  const hit = data.find(r => matchScope(r.metadata));
  return hit?.id ?? null;
}

// POST /v1/remember — store a fact (accepts text/fact/content as aliases)
rememberRouter.post('/', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { text, fact, content, category = 'General', source = 'api', contact_id, company_id, email, metadata } = req.body;
    const resolvedContent = content || text || fact;
    if (!resolvedContent?.trim()) return res.status(400).json({ error: 'content_required' });

    let resolvedContactId = contact_id;
    if (!resolvedContactId && email) {
      const { data } = await supabase
        .from('contacts')
        .select('id')
        .eq('email', email.toLowerCase().trim())
        .eq('workspace_id', req.workspaceId)
        .maybeSingle();
      resolvedContactId = data?.id || null;
    }

    const mergedMetadata = {
      ...(metadata || {}),
      ...(resolvedContactId ? { contact_id: resolvedContactId } : {}),
      ...(company_id ? { company_id } : {}),
    };

    // Generate embedding + look for an in-scope match to supersede.
    const embedding = await generateEmbedding(resolvedContent);
    const supersededId = embedding
      ? await findSupersedeCandidate(supabase, req.workspaceId, embedding, { contact_id: resolvedContactId, company_id })
      : null;

    const memory = await saveMemory(supabase, req.workspaceId, {
      content: resolvedContent, category, source, metadata: mergedMetadata, embedding,
    });

    if (supersededId) {
      await supabase.from('workspace_memories')
        .update({ is_active: false, superseded_by: memory.id })
        .eq('id', supersededId)
        .eq('workspace_id', req.workspaceId);
    }

    logMcpOp(req, {
      eventType: 'memory_write',
      summary: `[${category}] ${resolvedContent.slice(0, 80)}${resolvedContent.length > 80 ? '…' : ''}${supersededId ? ' · superseded' : ''}`,
      contactId: resolvedContactId || null,
    });
    return res.status(201).json({
      memory,
      stored: 1,
      facts: [{ content: memory.content, superseded: Boolean(supersededId) }],
    });
  } catch (err) {
    console.error('[POST /v1/remember]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

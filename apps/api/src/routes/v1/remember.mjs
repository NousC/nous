import { Router } from 'express';
import { getSupabaseClient, saveMemory } from '@proply/core';

export const rememberRouter = Router();

// POST /v1/remember — store a fact (accepts text/fact/content as aliases)
rememberRouter.post('/', async (req, res) => {
  try {
    const { text, fact, content, category = 'General', source = 'api', contact_id, company_id, email, metadata } = req.body;
    const resolvedContent = content || text || fact;
    if (!resolvedContent?.trim()) return res.status(400).json({ error: 'content_required' });

    let resolvedContactId = contact_id;
    if (!resolvedContactId && email) {
      const { data } = await getSupabaseClient()
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

    const memory = await saveMemory(getSupabaseClient(), req.workspaceId, {
      content: resolvedContent, category, source, metadata: mergedMetadata,
    });
    return res.status(201).json({ memory, stored: 1, facts: [{ content: memory.content }] });
  } catch (err) {
    console.error('[POST /v1/remember]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

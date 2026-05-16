import { Router } from 'express';
import { getSupabaseClient, isUUID } from '@proply/core';
import { logMcpOp } from '../../lib/mcpLogger.mjs';

export const captureRouter = Router();

// POST /v1/capture — log a signal/activity for a contact
captureRouter.post('/', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { contact_id, email, type, description, source = 'agent', occurred_at, metadata = {} } = req.body;

    if (!type) return res.status(400).json({ error: 'type_required' });
    if (!contact_id && !email) return res.status(400).json({ error: 'contact_id_or_email_required' });

    // Resolve contact
    let contact = null;
    if (contact_id && isUUID(contact_id)) {
      const { data } = await supabase
        .from('contacts')
        .select('id, pipeline_stage, company_id')
        .eq('id', contact_id)
        .eq('workspace_id', req.workspaceId)
        .single();
      contact = data;
    } else if (email) {
      const { data } = await supabase
        .from('contacts')
        .select('id, pipeline_stage, company_id')
        .eq('email', email.toLowerCase().trim())
        .eq('workspace_id', req.workspaceId)
        .single();
      contact = data;
    }

    if (!contact) return res.status(404).json({ error: 'contact_not_found' });

    const stageBefore = contact.pipeline_stage || 'identified';
    const now = new Date().toISOString();

    const { data: activity, error } = await supabase
      .from('contact_activity_log')
      .insert({
        workspace_id: req.workspaceId,
        contact_id: contact.id,
        activity_type: type,
        description: description || '',
        source,
        occurred_at: occurred_at || now,
        received_at: now,
        raw_data: { ...metadata, logged_by: source },
      })
      .select('id, activity_type, source, occurred_at')
      .single();

    if (error) throw error;

    // Read updated stage — a DB trigger may have advanced it
    const { data: updated } = await supabase
      .from('contacts')
      .select('pipeline_stage, deal_health_score')
      .eq('id', contact.id)
      .single();

    logMcpOp(req.workspaceId, { clientType: req.clientType,
      eventType: 'activity_track',
      summary: `${type}${description ? `: ${description.slice(0, 70)}` : ''}`,
      contactId: contact.id,
    });
    return res.status(201).json({
      activity,
      contact_id: contact.id,
      stage_before: stageBefore,
      stage_after: updated?.pipeline_stage || stageBefore,
      deal_health_score: updated?.deal_health_score ?? null,
    });
  } catch (err) {
    console.error('[POST /v1/capture]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

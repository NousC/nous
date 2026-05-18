import { Router } from 'express';
import { getSupabaseClient, isUUID, isEmail, logActivity } from '@nous/core';
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
    let createdContact = false;
    if (contact_id && isUUID(contact_id)) {
      const { data } = await supabase
        .from('contacts')
        .select('id, pipeline_stage, company_id')
        .eq('id', contact_id)
        .eq('workspace_id', req.workspaceId)
        .single();
      contact = data;
    } else if (email) {
      const normalised = email.toLowerCase().trim();
      const { data } = await supabase
        .from('contacts')
        .select('id, pipeline_stage, company_id')
        .eq('email', normalised)
        .eq('workspace_id', req.workspaceId)
        .single();
      contact = data;
      // Auto-create on first track for an unknown email so agents don't need to call create_contact first.
      if (!contact && isEmail(normalised)) {
        const { data: created, error: createErr } = await supabase
          .from('contacts')
          .insert({
            workspace_id: req.workspaceId,
            email: normalised,
            source: source || 'api',
            pipeline_stage: 'identified',
          })
          .select('id, pipeline_stage, company_id')
          .single();
        if (createErr) throw createErr;
        contact = created;
        createdContact = true;
      }
    }

    if (!contact) return res.status(404).json({ error: 'contact_not_found' });

    const stageBefore = contact.pipeline_stage || 'identified';
    const now = new Date().toISOString();

    // Route through shared logActivity so the CRM push hook + pipeline-stage advance fire
    const inserted = await logActivity(supabase, {
      workspaceId: req.workspaceId,
      contactId: contact.id,
      companyId: contact.company_id || null,
      type,
      source,
      externalId: metadata?.external_id || null,
      occurredAt: occurred_at || now,
      description: description || '',
      rawData: { ...metadata, logged_by: source },
    });

    const activity = inserted
      ? { id: inserted.id, activity_type: type, source, occurred_at: occurred_at || now }
      : { id: null, activity_type: type, source, occurred_at: occurred_at || now };

    // Read updated stage — a DB trigger may have advanced it
    const { data: updated } = await supabase
      .from('contacts')
      .select('pipeline_stage, deal_health_score')
      .eq('id', contact.id)
      .single();

    logMcpOp(req, {
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
      created_contact: createdContact,
    });
  } catch (err) {
    console.error('[POST /v1/capture]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

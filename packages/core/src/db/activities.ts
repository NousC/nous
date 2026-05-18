import type { SupabaseClient } from '@supabase/supabase-js';

export interface LogActivityParams {
  workspaceId: string;
  contactId: string;
  companyId?: string | null;
  type: string;
  source: string;
  externalId?: string | null;
  occurredAt?: string;
  description?: string | null;
  summary?: string | null;
  rawData?: Record<string, unknown> | null;
}

// Activity types that advance pipeline stage
const CLIENT_TYPES     = new Set(['proposal_signed', 'deal_won', 'payment_received']);
const EVALUATING_TYPES = new Set(['meeting_held', 'pricing_page_visit', 'proposal_sent', 'proposal_viewed', 'trial_started', 'meeting_scheduled']);
const INTERESTED_TYPES = new Set(['email_reply', 'linkedin_message', 'linkedin_connected', 'slack_message', 'content_download', 'website_revisit']);
const AWARE_TYPES      = new Set(['website_visit', 'email_opened', 'linkedin_view', 'social_engagement']);

const STAGE_ORDER: Record<string, number> = { identified: 0, aware: 1, interested: 2, evaluating: 3, client: 4 };

function stageForType(type: string): string | null {
  if (CLIENT_TYPES.has(type))     return 'client';
  if (EVALUATING_TYPES.has(type)) return 'evaluating';
  if (INTERESTED_TYPES.has(type)) return 'interested';
  if (AWARE_TYPES.has(type))      return 'aware';
  return null;
}

async function advancePipelineStage(supabase: SupabaseClient, contactId: string, type: string): Promise<void> {
  const targetStage = stageForType(type);
  if (!targetStage) return;

  const { data: contact } = await supabase
    .from('contacts')
    .select('pipeline_stage, stage_locked')
    .eq('id', contactId)
    .single();

  if (!contact || contact.stage_locked) return;

  const current = contact.pipeline_stage || 'identified';
  if ((STAGE_ORDER[targetStage] ?? 0) > (STAGE_ORDER[current] ?? 0)) {
    await supabase.from('contacts').update({ pipeline_stage: targetStage }).eq('id', contactId);
  }
}

export async function logActivity(
  supabase: SupabaseClient,
  params: LogActivityParams,
): Promise<{ id: string } | null> {
  const { workspaceId, contactId, companyId, type, source, externalId, occurredAt, description, summary, rawData } = params;

  // Dedup by externalId — prevents double-logging the same calendar event / webhook delivery
  if (externalId) {
    const { count } = await supabase
      .from('contact_activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('source', source)
      .eq('external_id', externalId);

    if ((count ?? 0) > 0) {
      console.log(`[ACTIVITY] Dedup skip: ${source}/${externalId}`);
      return null;
    }
  }

  const { data, error } = await supabase
    .from('contact_activity_log')
    .insert({
      workspace_id:  workspaceId,
      contact_id:    contactId,
      company_id:    companyId || null,
      activity_type: type,
      source,
      external_id:   externalId || null,
      occurred_at:   occurredAt || new Date().toISOString(),
      received_at:   new Date().toISOString(),
      raw_data:      rawData || null,
      summary:       summary || null,
      description:   description || null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[ACTIVITY] Insert failed:', error.message, { source, type, contactId });
    return null;
  }

  // Advance pipeline stage based on signal type
  await advancePipelineStage(supabase, contactId, type).catch(() => {});

  // Fire-and-forget: push this activity to every enabled CRM connection.
  // Lives in the API layer (apps/api/src/services/crm/push.mjs) to keep core dependency-free.
  void notifyCrmPush({ workspaceId, contactId, activityType: type, occurredAt, summary, description, rawData });

  return data as { id: string };
}

// Resolved lazily so packages/core stays free of any apps/* dependency. The API process
// registers a handler at startup; other consumers (CLI, tests) are no-ops.
type CrmPushHandler = (evt: {
  workspaceId: string; contactId: string; activityType: string;
  occurredAt?: string; summary?: string | null; description?: string | null;
  rawData?: Record<string, unknown> | null;
}) => Promise<void> | void;

let crmPushHandler: CrmPushHandler | null = null;

export function registerCrmPushHandler(fn: CrmPushHandler) {
  crmPushHandler = fn;
}

function notifyCrmPush(evt: Parameters<CrmPushHandler>[0]) {
  if (!crmPushHandler) return;
  try {
    const out = crmPushHandler(evt);
    if (out && typeof (out as Promise<void>).catch === 'function') {
      (out as Promise<void>).catch(err => console.error('[CRM_PUSH_HANDLER]', err?.message || err));
    }
  } catch (err: any) {
    console.error('[CRM_PUSH_HANDLER]', err?.message || err);
  }
}

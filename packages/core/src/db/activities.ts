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

// Dual-write: mirror a logged activity into the v2 evidence substrate as a
// kind:'event' observation. Fire-and-forget — never blocks or breaks the v1
// activity log. Lazily ensures the person-entity exists (entity.id ==
// contact.id, the v1->v2 migration convention). Silent on a fresh v1-only
// install where the v2 tables do not exist yet.
async function mirrorActivityToObservation(
  supabase: SupabaseClient,
  params: LogActivityParams,
): Promise<void> {
  const { workspaceId, contactId, type, source, externalId, occurredAt, description, summary, rawData } = params;

  const ent = await supabase.from('entities').upsert(
    { id: contactId, workspace_id: workspaceId, type: 'person', status: 'active' },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (ent.error) return;   // v2 substrate absent, or entity upsert failed — skip; never break v1

  const { error } = await supabase.from('observations').insert({
    workspace_id: workspaceId,
    entity_id:    contactId,
    kind:         'event',
    property:     `interaction.${type}`,
    value:        { description: description ?? null, summary: summary ?? null },
    source,
    method:       'connector',
    observed_at:  occurredAt || new Date().toISOString(),
    external_id:  externalId || null,
    raw:          rawData || null,
  });
  // 23505 = duplicate (already mirrored); 42P01/PGRST205 = v2 tables absent — all benign.
  if (error && !['23505', '42P01', 'PGRST205'].includes(error.code ?? '')) {
    console.error('[ACTIVITY] observation mirror failed:', error.message);
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

  // Dual-write into the v2 evidence substrate — fire-and-forget, never blocks v1.
  void mirrorActivityToObservation(supabase, params).catch(() => {});

  // Fire-and-forget: push this activity to every enabled CRM connection.
  // activityId enables per-row dedup so retries / replays don't double-post engagements.
  void notifyCrmPush({ workspaceId, contactId, activityType: type, activityId: data?.id, occurredAt, summary, description, rawData });

  return data as { id: string };
}

// Resolved lazily so packages/core stays free of any apps/* dependency. The API process
// registers a handler at startup; other consumers (CLI, tests) are no-ops.
type CrmPushHandler = (evt: {
  workspaceId: string; contactId: string; activityType: string;
  activityId?: string | null;
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

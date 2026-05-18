// ─── Config ───────────────────────────────────────────────────────────────────

export interface NousConfig {
  apiKey: string;
  /** Defaults to https://api.opennous.cloud */
  baseUrl?: string;
}

// ─── Activities ───────────────────────────────────────────────────────────────

export type ActivityType =
  | 'email_sent' | 'email_reply'
  | 'call_held' | 'meeting_held'
  | 'linkedin_message' | 'linkedin_connected'
  | 'follow_up_sent' | 'proposal_sent'
  | 'website_visit' | 'content_download' | 'trial_started'
  | 'manual_note';

export interface TrackInput {
  /** Contact email — required if contact_id not provided */
  email?: string;
  /** Contact UUID — required if email not provided */
  contact_id?: string;
  type: ActivityType;
  description?: string;
  /** ISO timestamp — defaults to now */
  occurred_at?: string;
  source?: string;
}

export interface TrackResult {
  contact_id: string;
  activity_id: string;
  type: ActivityType;
  occurred_at: string;
  created_contact: boolean;
}

// ─── Remember ─────────────────────────────────────────────────────────────────

export type MemoryCategory = 'ICP' | 'Product' | 'Pricing' | 'Market' | 'Competitors' | 'Team' | 'Patterns' | 'General';

export interface RememberInput {
  /** Contact email. Omit for workspace-level facts (ICP, product, market). */
  email?: string;
  /** Contact UUID */
  contact_id?: string;
  /** Company UUID — scope fact to the whole org instead of the individual */
  company_id?: string;
  /** The text to extract facts from — one sentence or full transcript */
  text: string;
  category?: MemoryCategory;
  source?: string;
}

export interface RememberResult {
  stored: number;
  facts: Array<{ id: string; content: string; written_at: string; superseded?: string }>;
}

export interface MemoryFact {
  id: string;
  category: string;
  content: string;
  created_at: string;
}

export interface MemoriesResult {
  memories: MemoryFact[];
  total: number;
}

export interface DeleteMemoryResult {
  deleted: true;
  id: string;
  content: string;
}

export interface DeleteContactResult {
  deleted: true;
  contact_id: string;
  email: string;
}

export interface CreateContactInput {
  /** Required unless linkedin_url is provided */
  email?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  job_title?: string;
  phone?: string;
  linkedin_url?: string;
  notes?: string;
}

export interface CreateContactResult {
  id: string;
  email: string;
  name: string;
  company: string | null;
  job_title: string | null;
  pipeline_stage: PipelineStage;
}

export interface UpdateContactInput {
  first_name?: string;
  last_name?: string;
  company?: string;
  job_title?: string;
  phone?: string;
  linkedin_url?: string;
  notes?: string;
}

export type UpdateContactResult = CreateContactResult;

// ─── Contact ──────────────────────────────────────────────────────────────────

export type PipelineStage = 'identified' | 'aware' | 'interested' | 'evaluating' | 'client';

export interface ContactActivity {
  type: ActivityType;
  description: string | null;
  occurred_at: string;
}

export interface ActivityItem {
  id: string;
  type: string;
  description: string | null;
  body: string | null;
  source: string | null;
  occurred_at: string;
}

export interface ActivityListResult {
  activities: ActivityItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ActivityListOptions {
  limit?: number;
  offset?: number;
  type?: string;
  before?: string;
  after?: string;
}

export interface ContactFact {
  category: string;
  content: string;
  written_at: string;
}

export interface Contact {
  contact_id: string;
  company_id: string | null;
  email: string;
  name: string | null;
  title: string | null;
  company: string | null;
  linkedin_url: string | null;
  pipeline_stage: PipelineStage;
  icp_score: number | null;
  icp_fit: string | null;
  deal_health_score: number | null;
  industry: string | null;
  employee_count: number | null;
  last_activity_at: string | null;
  summary: string | null;
  signals_30d: Record<string, number>;
  recent_activities: ContactActivity[];
  facts: ContactFact[];
  company_facts: ContactFact[];
  relationships: Array<{ subject: string; relationship: string; object: string }>;
  total_facts: number;
  total_activities: number;
}

export interface ContactListItem {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  pipeline_stage: PipelineStage;
  icp_score: number | null;
  last_activity_at: string | null;
}

export interface ContactListOptions {
  stage?: PipelineStage;
  search?: string;
  linkedin_url?: string;
  limit?: number;
  offset?: number;
}

// ─── Company ──────────────────────────────────────────────────────────────────

export interface Company {
  company_id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employee_count: number | null;
  deal_health_score: number | null;
  contacts: ContactListItem[];
  facts: ContactFact[];
  relationships: Array<{ subject: string; relationship: string; object: string }>;
  total_contacts: number;
  total_facts: number;
}

// ─── Search ───────────────────────────────────────────────────────────────────

export interface SearchInput {
  q: string;
  contact_id?: string;
  company_id?: string;
  limit?: number;
  threshold?: number;
}

export interface SearchResult {
  results: Array<{
    id: string;
    content: string;
    category: string;
    similarity: number;
    metadata: Record<string, unknown> | null;
    written_at: string;
  }>;
  count: number;
}

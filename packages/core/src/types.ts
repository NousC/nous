// Shared TypeScript types — used by api, mcp, worker, sdk

export type PipelineStage = 'identified' | 'aware' | 'interested' | 'evaluating' | 'client';

export type MemoryCategory = 'ICP' | 'Product' | 'Pricing' | 'Market' | 'Competitors' | 'Team' | 'Patterns' | 'General';

export type MemoryScope = 'contact' | 'company' | 'workspace';

export interface Contact {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  company_id: string | null;
  title: string | null;
  linkedin_url: string | null;
  photo_url: string | null;
  channels: Record<string, unknown> | null;
  pipeline_stage: PipelineStage;
  icp_fit: string | null;
  icp_score: number | null;
  deal_health_score: number | null;
  last_activity_at: string | null;
  memory_summary: string | null;
}

export interface ContactProfile extends Contact {
  company_details: CompanyDetails | null;
  activities: Activity[];
  facts: MemoryFact[];
  signals_30d: Record<string, number>;
}

export interface CompanyDetails {
  name: string;
  domain: string | null;
  industry: string | null;
  employee_count: number | null;
  location: string | null;
}

export interface Activity {
  id: string;
  type: string;
  description: string | null;
  body: string | null;
  source: string | null;
  occurred_at: string;
}

export interface MemoryFact {
  scope: MemoryScope;
  category: MemoryCategory;
  content: string;
  graph_layer: 'private' | 'public';
}

export interface WorkspaceMemory {
  id: string;
  category: MemoryCategory;
  content: string;
  source: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
}

export interface ContactListItem {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  company_id: string | null;
  title: string | null;
  linkedin_url: string | null;
  channels: Record<string, unknown> | null;
  icp_fit: string | null;
  icp_score: number | null;
  deal_health_score: number | null;
  pipeline_stage: PipelineStage;
  last_activity_at: string | null;
}

export interface ListContactsParams {
  search?: string;
  pipeline_stage?: PipelineStage;
  company_id?: string;
  ids?: string;
  filter?: 'hot' | 'engaged';
  sort?: 'recent' | 'score' | 'deal_health_score' | 'connection_score';
  limit?: number;
  offset?: number;
  linkedin_url?: string;
}

export interface CreateContactParams {
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  job_title?: string;
  phone?: string;
  linkedin_url?: string;
  notes?: string;
}

export interface UpdateContactParams {
  first_name?: string;
  last_name?: string;
  company?: string;
  job_title?: string;
  phone?: string;
  linkedin_url?: string;
  notes?: string;
}

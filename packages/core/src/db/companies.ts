import type { SupabaseClient } from '@supabase/supabase-js';
import { isUUID } from '../utils/identity.js';

export interface CompanyProfile {
  company_id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employee_count: number | null;
  location: string | null;
  deal_health_score: number | null;
  contacts: CompanyContact[];
  total_contacts: number;
  facts: CompanyFact[];
}

interface CompanyContact {
  contact_id: string;
  name: string | null;
  email: string;
  title: string | null;
  pipeline_stage: string;
}

interface CompanyFact {
  category: string;
  content: string;
  written_at: string | null;
}

export async function getCompanyProfile(
  supabase: SupabaseClient,
  workspaceId: string,
  companyId: string,
): Promise<CompanyProfile | null> {
  if (!isUUID(companyId)) return null;

  const [companyResult, contactsResult, factsResult] = await Promise.all([
    supabase
      .from('companies')
      .select('id, name, domain, industry, employee_count, location, deal_health_score')
      .eq('id', companyId)
      .eq('workspace_id', workspaceId)
      .single(),
    supabase
      .from('contacts')
      .select('id, email, first_name, last_name, job_title, pipeline_stage', { count: 'exact' })
      .eq('company_id', companyId)
      .eq('workspace_id', workspaceId)
      .order('last_activity_at', { ascending: false })
      .limit(20),
    supabase
      .from('workspace_memories')
      .select('category, content, created_at')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .filter('metadata->>company_id', 'eq', companyId)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  if (!companyResult.data) return null;

  const c = companyResult.data;

  return {
    company_id: c.id,
    name: c.name,
    domain: c.domain || null,
    industry: c.industry || null,
    employee_count: c.employee_count || null,
    location: c.location || null,
    deal_health_score: c.deal_health_score || null,
    contacts: (contactsResult.data || []).map(con => ({
      contact_id: con.id,
      name: [con.first_name, con.last_name].filter(Boolean).join(' ') || null,
      email: con.email,
      title: con.job_title || null,
      pipeline_stage: con.pipeline_stage || 'identified',
    })),
    total_contacts: contactsResult.count || 0,
    facts: (factsResult.data || []).map(f => ({
      category: f.category,
      content: f.content,
      written_at: f.created_at || null,
    })),
  };
}

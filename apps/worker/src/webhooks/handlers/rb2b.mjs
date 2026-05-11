// RB2B webhook handler — receives de-anonymized website visitor data (public graph signal).

import { getSupabaseClient, logActivity } from '@proply/core';

export async function handleRB2B(req, res, workspaceId) {
  const supabase = getSupabaseClient();
  const { email, linkedin_url, first_name, last_name, company, job_title, page_url } = req.body;

  if (!email && !linkedin_url) return res.status(400).json({ error: 'email_or_linkedin_required' });

  // Try to find existing contact
  let contact = null;
  if (email) {
    const { data } = await supabase
      .from('contacts')
      .select('id, company_id')
      .eq('workspace_id', workspaceId)
      .eq('email', email.toLowerCase())
      .maybeSingle();
    contact = data;
  }

  // Auto-create if not found and we have enough data
  if (!contact && email && (first_name || last_name)) {
    const { data } = await supabase
      .from('contacts')
      .insert({
        workspace_id: workspaceId,
        email:        email.toLowerCase(),
        first_name:   first_name || null,
        last_name:    last_name || null,
        company:      company || null,
        job_title:    job_title || null,
        linkedin_url: linkedin_url || null,
        pipeline_stage: 'identified',
        source:       'rb2b',
      })
      .select('id, company_id')
      .single();
    contact = data;
  }

  if (!contact) return res.json({ ok: true, skipped: true });

  await logActivity(supabase, {
    workspaceId,
    contactId:   contact.id,
    companyId:   contact.company_id || null,
    type:        'website_visit',
    source:      'rb2b',
    externalId:  `rb2b_${email}_${Date.now()}`,
    description: page_url ? `Visited ${page_url}` : 'Website visit detected',
    rawData:     { page_url, linkedin_url },
  });

  return res.json({ ok: true });
}

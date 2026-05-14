// RB2B webhook handler — receives de-anonymized website visitor data (public graph signal).

import { getSupabaseClient } from '@proply/core';
import { logActivity } from '../../utils/activity.mjs';
import { resolveContact } from '../../utils/resolveContact.mjs';

export async function handleRB2B(req, res, workspaceId) {
  const supabase = getSupabaseClient();
  const { email, linkedin_url, first_name, last_name, company, job_title, page_url } = req.body;

  if (!email && !linkedin_url) return res.status(400).json({ error: 'email_or_linkedin_required' });

  const { contact } = await resolveContact(supabase, workspaceId, {
    email,
    first_name,
    last_name,
    linkedin_url,
    company_name: company,
    job_title,
    source: 'rb2b',
  }, { createIfMissing: !!(email || linkedin_url) });

  if (!contact) return res.json({ ok: true, skipped: true });

  await logActivity(supabase, {
    workspaceId,
    contactId:   contact.id,
    companyId:   contact.company_id || null,
    type:        'website_visit',
    source:      'rb2b',
    externalId:  `rb2b_${email || linkedin_url}_${(page_url || '').replace(/[^a-z0-9]/gi, '_').slice(0, 40) || 'visit'}`,
    description: page_url ? `Visited ${page_url}` : 'Website visit detected',
    rawData:     { page_url, linkedin_url },
  });

  return res.json({ ok: true });
}

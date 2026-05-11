import { Router } from 'express';
import { getSupabaseClient, getCompanyProfile } from '@proply/core';

export const companiesRouter = Router();

// GET /v1/companies/:id
companiesRouter.get('/:id', async (req, res) => {
  try {
    const company = await getCompanyProfile(getSupabaseClient(), req.workspaceId, req.params.id);
    if (!company) return res.status(404).json({ error: 'company_not_found' });
    return res.json(company);
  } catch (err) {
    console.error('[GET /v1/companies/:id]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

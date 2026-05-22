import { Router } from 'express';
import { getSupabaseClient, runQuery } from '@nous/core';

export const queryV2Router = Router();

// POST /v2/query — retrieve and summarise a corpus of observations.
// Body: {
//   scope: { kind?, property?, source?, entity_id?, since_days?, limit? },
//   question?: string,   // the agent's analytical question — echoed back
//   budget_tokens?: number
// }
// The API retrieves + compacts; the agent does the pattern-finding.
queryV2Router.post('/', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { scope = {}, question } = req.body;
    const result = await runQuery(supabase, req.workspaceId, scope, question);
    return res.json({ ...result, question: question ?? null });
  } catch (err) {
    console.error('[POST /v2/query]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

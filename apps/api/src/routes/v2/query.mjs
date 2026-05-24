import { Router } from 'express';
import { getSupabaseClient, runQuery } from '@nous/core';

export const queryV2Router = Router();

// POST /v2/query — retrieve and summarise a corpus of observations.
// Body: {
//   scope:    { kind?, property?, source?, entity_id?, since_days?, limit? },
//   without?: { ...same shape as scope },        // entities IN scope minus entities IN without
//   return?:  'observations' | 'entities',       // default 'observations'
//   question?: string,                            // analytical question — echoed back; enables semantic mode
//   budget_tokens?: number
// }
// The API retrieves + compacts; the agent does the pattern-finding.
//
// Use cases the new params unlock:
//   • "Hottest leads"             — return:'entities' over recent replies
//   • "Didn't reply in 5 days"    — without: replies in same 5d window
//   • "Cooled in 5 days"          — without: any activity in last 5d
//   • "Funnel by stage"           — scope.kind='state', property='stage' → rollups.by_value
queryV2Router.post('/', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { scope = {}, without, return: returnMode, question } = req.body;
    const result = await runQuery(supabase, req.workspaceId, scope, question, {
      return: returnMode,
      without,
    });
    return res.json({ ...result, question: question ?? null });
  } catch (err) {
    console.error('[POST /v2/query]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

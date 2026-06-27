// The latest ICP fit score for an entity, shaped for the agent-facing record.
// Lets get_context / get_account return not just *who you sell to* (workspace
// facts) but *whether this specific account is one of them, and how confident* —
// so an agent can act on the score, not just read context.
export async function icpFit(supabase, workspaceId, entityId) {
  const { data } = await supabase
    .from('predictions')
    .select('predicted_value, predicted_at, resolved_at, outcome_value')
    .eq('workspace_id', workspaceId)
    .eq('entity_id', entityId)
    .eq('kind', 'icp_fit')
    .order('predicted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const pv = data?.predicted_value;
  if (!pv || pv.score == null) return null;

  return {
    score: pv.score,                 // 0–100 fit score
    fit: pv.fit ?? null,             // boolean: score >= 70
    tier: pv.tier ?? null,           // tier_1 | tier_2 | tier_3 | not_icp — the actionable class
    reason: pv.reason ?? null,       // which signals fired (or "no signals matched")
    scored_at: data.predicted_at,
    // The score history trail — prior {score, reason, at} entries, newest first,
    // so an agent can see how the fit evolved and what moved it. Not shown in the
    // UI (which displays only the current score); this is for agents to read.
    history: Array.isArray(pv.history) ? pv.history : [],
    // Once the prediction has resolved, the realized outcome (0–1) so an agent
    // can see whether the bet paid off.
    outcome_score: data.resolved_at ? (data.outcome_value?.score ?? null) : null,
  };
}

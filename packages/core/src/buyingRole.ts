// Buying-role classification — turns a raw job title into a structured buying
// persona so a stakeholder map is more than a list of titles. Coarse by design:
// seniority + function from the title. A stored `buying_role` claim (set by an
// agent or user) always wins over this heuristic; this only fills the gap.

export type BuyingRole =
  | 'economic_buyer'   // owns the budget — founder, owner, C-suite, partner
  | 'decision_maker'   // signs off — VP, Head, Director, GM
  | 'champion'         // drives it internally — manager, team lead, principal
  | 'gatekeeper'       // controls access/process — procurement, ops, chief of staff
  | 'influencer'       // shapes the choice — analyst, specialist, IC seller
  | 'end_user'         // uses it day to day — engineer, designer, operator
  | 'unknown';

// First pattern that matches wins. Gatekeepers are checked FIRST on purpose:
// 'chief of staff' must not fall into economic_buyer's 'chief', and 'procurement
// lead' must not fall into champion's 'lead'. After that, most-senior-first.
const RULES: [RegExp, BuyingRole][] = [
  [/\b(chief of staff|executive assistant|procurement|purchasing|vendor management)\b/, 'gatekeeper'],
  [/\b(founder|co-?founder|owner|ceo|chief executive|president|cfo|chief financial|cro|chief revenue|coo|chief operating|cmo|chief marketing|cto|chief technology|c[a-z]o|managing director|managing partner|partner)\b/, 'economic_buyer'],
  [/\b(svp|evp|vp|vice president|head of|director|gm|general manager)\b/, 'decision_maker'],
  [/\b(manager|team lead|lead|principal)\b/, 'champion'],
  [/\b(analyst|specialist|associate|coordinator|sdr|bdr|representative|consultant|strategist|marketer|account executive)\b/, 'influencer'],
  [/\b(engineer|developer|designer|scientist|architect|technician|operator|support)\b/, 'end_user'],
];

/** Best-effort buying role from a job title. Returns 'unknown' when nothing matches. */
export function classifyBuyingRole(jobTitle: unknown): BuyingRole {
  if (typeof jobTitle !== 'string' || !jobTitle.trim()) return 'unknown';
  const t = jobTitle.toLowerCase();
  for (const [re, role] of RULES) if (re.test(t)) return role;
  return 'unknown';
}

const VALID = new Set<BuyingRole>([
  'economic_buyer', 'decision_maker', 'champion', 'gatekeeper', 'influencer', 'end_user', 'unknown',
]);

/** Narrow an arbitrary stored value to a BuyingRole, or null if it isn't one. */
export function asBuyingRole(value: unknown): BuyingRole | null {
  return typeof value === 'string' && VALID.has(value as BuyingRole) ? (value as BuyingRole) : null;
}

// Relationship-graph derivation — pure logic over the members of one company.
//
// Identity resolution gives us the nodes (a person, a company) and the
// `works_at` edges between them. This module derives the next layer: the
// ORG CHART (`reports_to` edges) and a BUYING-COMMITTEE ROLE per member
// (champion / economic_buyer / influencer / blocker / contact).
//
// It is intentionally side-effect free: the worker loads the members plus
// their engagement and calls these functions, then persists the results
// (reports_to → the relationships table; committee_role → a state
// observation the claim engine derives, exactly like pipeline_stage).
//
// These are heuristics over titles + engagement, so everything produced here
// is `inferred`, never `observed`. Confidence is deliberately modest.

export type RelationshipType = 'works_at' | 'reports_to' | 'competitor_of' | 'uses';

export type CommitteeRole =
  | 'champion'        // the most-engaged advocate inside the account
  | 'economic_buyer'  // budget authority — the senior signer
  | 'influencer'      // shapes the decision without owning the budget
  | 'blocker'         // an explicit negative signal
  | 'contact';        // known person, no role signal yet

/** One person at a company, with the facts the derivation needs. */
export interface OrgMember {
  entityId: string;
  title: string | null;        // job_title claim value
  seniority: string | null;    // seniority claim value, if enrichment provided one
  department: string | null;   // department claim, if any
  /** inbound engagement count in the scoring window (replies, meetings) — drives champion */
  inboundCount: number;
  /** an explicit negative signal (objection / do-not-contact) — drives blocker */
  negativeSignal?: boolean;
}

/** A derived org-chart edge: `fromEntityId` reports to `toEntityId`. */
export interface ReportsToEdge {
  fromEntityId: string;
  toEntityId: string;
}

// ── seniority ladder ──────────────────────────────────────────────────────────
// Higher number = more senior. Title keywords are the primary signal; the
// explicit `seniority` claim (when enrichment supplies one) is folded in and we
// take the stronger of the two, so a thin title can still rank correctly.

const TITLE_RULES: { rank: number; test: RegExp }[] = [
  { rank: 100, test: /\b(founder|co-?founder|ceo|owner|president|proprietor)\b/i },
  { rank: 90,  test: /\b(c[tfora]o|chief|cxo|cro|ciso|cpo)\b/i },
  { rank: 80,  test: /\b(vp|svp|evp|vice\s*president|head\s+of|partner)\b/i },
  { rank: 70,  test: /\bdirector\b/i },
  { rank: 50,  test: /\b(manager|lead|principal|staff)\b/i },
  { rank: 40,  test: /\bsenior\b/i },
  { rank: 30,  test: /\b(associate|analyst|specialist|coordinator|representative|rep|engineer|ic)\b/i },
];

const SENIORITY_CLAIM_RANK: Record<string, number> = {
  owner: 100, founder: 100, c_suite: 90, 'c-level': 90, cxo: 90, executive: 85,
  vp: 80, head: 80, director: 70, manager: 50, lead: 50,
  senior: 40, mid: 30, entry: 25, intern: 15,
};

/** Rank a member's seniority on a 0–100 ladder from title + seniority claim. */
export function seniorityRank(title: string | null, seniority?: string | null): number {
  let rank = 20; // unknown / default IC-ish floor
  if (title) {
    for (const rule of TITLE_RULES) {
      if (rule.test.test(title)) { rank = Math.max(rank, rule.rank); break; }
    }
  }
  if (seniority) {
    const s = String(seniority).toLowerCase().trim().replace(/\s+/g, '_');
    if (s in SENIORITY_CLAIM_RANK) rank = Math.max(rank, SENIORITY_CLAIM_RANK[s]);
  }
  return rank;
}

// ── org chart (reports_to) ─────────────────────────────────────────────────────

/**
 * Derive `reports_to` edges from the members of one company.
 *
 * Rule: each member reports to the nearest STRICTLY higher-ranked member,
 * preferring the same department, falling back to the company at large. The
 * top-ranked member (or members, on a tie) report to no one. Because an edge
 * only ever points to a strictly higher rank, the result is acyclic by
 * construction. Ties never link, so two co-equal VPs don't report to each other.
 */
export function deriveReportsTo(members: OrgMember[]): ReportsToEdge[] {
  const ranked = members.map(m => ({ m, rank: seniorityRank(m.title, m.seniority) }));
  const edges: ReportsToEdge[] = [];

  for (const { m, rank } of ranked) {
    // candidates: anyone strictly more senior
    const seniors = ranked.filter(o => o.rank > rank && o.m.entityId !== m.entityId);
    if (seniors.length === 0) continue; // top of the chart for this company

    // nearest higher rank overall
    const minSeniorRank = Math.min(...seniors.map(o => o.rank));
    const nearest = seniors.filter(o => o.rank === minSeniorRank);

    // prefer a manager in the same department, else take any nearest senior
    const sameDept = m.department
      ? nearest.filter(o => o.m.department && o.m.department === m.department)
      : [];
    const pool = sameDept.length ? sameDept : nearest;

    // deterministic pick: most-engaged among equals, then lowest entityId
    pool.sort((a, b) =>
      (b.m.inboundCount - a.m.inboundCount) || a.m.entityId.localeCompare(b.m.entityId));
    edges.push({ fromEntityId: m.entityId, toEntityId: pool[0].m.entityId });
  }

  return edges;
}

// ── buying-committee roles ──────────────────────────────────────────────────────

const VP_PLUS = 80;        // economic-buyer floor
const DIRECTOR = 70;       // influencer floor
const CHAMPION_MIN_INBOUND = 2;  // a champion has actually engaged, twice+

/**
 * Classify each member into a single buying-committee role.
 *
 * Champion is RELATIVE — the most-engaged member at the account (inbound
 * replies / meetings) wins it. The rest fall to absolute rules:
 *   blocker        ← an explicit negative signal
 *   champion       ← the top inbound-engaged member (≥ CHAMPION_MIN_INBOUND)
 *   economic_buyer ← VP+ seniority and not already the champion
 *   influencer     ← director-level, or anyone with ≥1 inbound touch
 *   contact        ← known, but no role signal yet
 */
export function classifyCommittee(members: OrgMember[]): Map<string, CommitteeRole> {
  const out = new Map<string, CommitteeRole>();
  if (members.length === 0) return out;

  // pick the single champion: most inbound engagement, above the floor
  let champion: OrgMember | null = null;
  for (const m of members) {
    if ((m.inboundCount ?? 0) < CHAMPION_MIN_INBOUND) continue;
    if (!champion || m.inboundCount > champion.inboundCount) champion = m;
  }

  for (const m of members) {
    const rank = seniorityRank(m.title, m.seniority);
    let role: CommitteeRole;
    if (m.negativeSignal) role = 'blocker';
    else if (champion && m.entityId === champion.entityId) role = 'champion';
    else if (rank >= VP_PLUS) role = 'economic_buyer';
    else if (rank >= DIRECTOR || (m.inboundCount ?? 0) >= 1) role = 'influencer';
    else role = 'contact';
    out.set(m.entityId, role);
  }

  return out;
}

/** Confidence for a derived `reports_to` edge — modest; this is title heuristics. */
export const REPORTS_TO_CONFIDENCE = 0.5;

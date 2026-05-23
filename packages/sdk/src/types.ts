// Nous TypeScript SDK — v2 types. Mirrors the Context API response shapes.
// The SDK is a thin HTTP client; it has no dependency on @nous/core.

// ─── config ───────────────────────────────────────────────────────────────────

export interface NousConfig {
  apiKey: string;
  /** Defaults to https://api.opennous.cloud */
  baseUrl?: string;
}

// ─── shared ───────────────────────────────────────────────────────────────────

export type Freshness = 'fresh' | 'aging' | 'suspect' | 'expired';
export type EpistemicClass = 'observed' | 'inferred' | 'predicted' | 'asserted';

/** A claim — a derived belief with its epistemics. The unit of truth. */
export interface Claim {
  property: string;
  value: unknown;
  confidence: number;
  freshness: Freshness;
  epistemic_class: EpistemicClass;
  last_observed_at: string | null;
}

/** When a name matches several entities, the API returns this instead. */
export interface FocusCandidate {
  entity_id: string;
  name: string | null;
  detail: string | null;
}
export interface AmbiguousFocus {
  status: 'ambiguous';
  candidates: FocusCandidate[];
}

// ─── context ──────────────────────────────────────────────────────────────────

export type ContextIntent =
  | 'draft_email' | 'follow_up' | 'meeting_prep' | 'call_prep' | 'account_review';

export interface TimelineItem {
  when: string;
  type: string;
  tier: 'full' | 'brief' | 'count';
  summary?: string | null;
  count?: number;
}
export interface Stakeholder {
  entity_id: string;
  name: string | null;
  role: string | null;
}
export interface AssembledContext {
  entity: { id: string; type: string };
  intent: ContextIntent;
  summary: string;
  claims: Claim[];
  workspace: Claim[];
  timeline: TimelineItem[];
  stakeholders: Stakeholder[];
  predictions: { kind: string; value: unknown; confidence: number }[];
  meta: {
    token_estimate: number;
    claims_total: number;
    claims_returned: number;
    timeline_events: number;
  };
}

// ─── account record ───────────────────────────────────────────────────────────

export interface Observation {
  id: string;
  entity_id: string;
  kind: 'state' | 'event';
  property: string;
  value: unknown;
  source: string;
  method: string;
  source_confidence: number | null;
  observed_at: string;
  ingested_at: string;
}
export interface AccountRecord {
  entity_id: string;
  type: string;
  claims: Record<string, Claim>;
  recent_observations: Observation[];
}

// ─── observations (write) ─────────────────────────────────────────────────────

export interface ObservationInput {
  kind: 'state' | 'event';
  /** e.g. 'interaction.email_sent' or 'job_title' */
  property: string;
  /** the event detail or the fact value; null = the fact ended */
  value?: unknown;
  source?: string;
  method?: string;
  observed_at?: string;
  external_id?: string;
}
export interface RecordResult {
  entity_id: string;
  recorded: number;
  claims_recomputed: string[];
}

// ─── query ────────────────────────────────────────────────────────────────────

export interface QueryScope {
  kind?: 'event' | 'state';
  /** property prefix — e.g. 'interaction.linkedin' */
  property?: string;
  source?: string;
  entity_id?: string;
  since_days?: number;
  limit?: number;
}
export interface QueryItem {
  observation_id: string;
  entity_id: string;
  entity_name: string | null;
  when: string;
  type: string;
  source: string;
  summary: string | null;
  similarity?: number;
}
export interface QueryResult {
  scope: QueryScope;
  mode: 'structured' | 'semantic';
  matched: number;
  returned: number;
  sampled: boolean;
  items: QueryItem[];
  rollups: { by_type: Record<string, number>; by_source: Record<string, number> };
  question: string | null;
  meta: { token_estimate: number };
}

// ─── attention ────────────────────────────────────────────────────────────────

export interface AttentionItem {
  kind: 'going_dark' | 'decayed_fact';
  entity_id: string;
  entity_name: string | null;
  what: string;
  suggested_action: string;
  age_days: number;
}
export interface AttentionResult {
  items: AttentionItem[];
  meta: { going_dark: number; decayed_facts: number };
}

// ─── verify ───────────────────────────────────────────────────────────────────

export interface VerifyResult {
  property: string;
  before: Claim | null;
  after: Claim | null;
  note: string;
}

// ─── dedup ────────────────────────────────────────────────────────────────────

export type DedupStatus =
  | 'net_new'        // no prior record — safe to send
  | 'engaged'        // in an active conversation — don't cold-send
  | 'recent'         // contacted within the cooldown window — defer
  | 'bounced'        // last delivery bounced — skip
  | 'unsubscribed'   // opted out or do-not-contact — skip
  | 'suppressed';    // workspace-level suppression (policy)

export interface DedupItem {
  email: string;
  status: DedupStatus;
  entity_id?: string;
  reason?: string | null;
}

export interface DedupSummary {
  net_new: number; engaged: number; recent: number;
  bounced: number; unsubscribed: number; suppressed: number;
  total: number;
}

export interface DedupResult {
  results: DedupItem[];
  summary: DedupSummary;
}

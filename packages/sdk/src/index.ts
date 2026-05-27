// Nous — the official TypeScript SDK.
//
// A thin client of the v2 Context API. The agent reads engineered,
// epistemics-tagged context and writes observations — it never overwrites.
//
//   const nous = new Nous({ apiKey: process.env.NOUS_API_KEY! });
//   const ctx  = await nous.getContext('sarah@acme.com', { intent: 'follow_up' });
//   await nous.record('sarah@acme.com', [
//     { kind: 'event', property: 'interaction.email_sent', value: { description: '…' } },
//   ]);

export type {
  NousConfig,
  Freshness, EpistemicClass, Claim,
  FocusCandidate, AmbiguousFocus,
  ContextIntent, TimelineItem, Stakeholder, AssembledContext,
  Observation, AccountRecord,
  ObservationInput, RecordResult,
  QueryScope, QueryItem, QueryEntityItem, QueryResult,
  AttentionItem, AttentionResult,
  VerifyResult,
  DedupStatus, DedupKind, DedupItem, DedupSummary, DedupResult,
  WorkspaceFact, WorkspaceFactsResult,
} from './types';

import type {
  NousConfig, AmbiguousFocus,
  ContextIntent, AssembledContext,
  AccountRecord,
  ObservationInput, RecordResult,
  QueryScope, QueryResult,
  AttentionResult, VerifyResult,
  DedupResult,
  WorkspaceFactsResult,
} from './types';
import { HttpClient } from './client';

export class NousError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'NousError';
    this.status = status;
    this.code = code;
  }
}

/** True when a call returned candidate matches instead of a result. */
export function isAmbiguous(r: unknown): r is AmbiguousFocus {
  return !!r && typeof r === 'object' && (r as AmbiguousFocus).status === 'ambiguous';
}

export class Nous {
  private readonly http: HttpClient;

  constructor({ apiKey, baseUrl = 'https://api.opennous.cloud' }: NousConfig) {
    if (!apiKey) throw new Error('Nous: apiKey is required');
    this.http = new HttpClient(apiKey, baseUrl.replace(/\/$/, ''));
  }

  /**
   * Engineered context for a task about one person or company. `focus` may be
   * an email, LinkedIn URL, domain, entity UUID, or a name — a name may return
   * candidates (check with isAmbiguous). Call before drafting or deciding.
   */
  getContext(
    focus: string,
    opts: { intent?: ContextIntent; budgetTokens?: number } = {},
  ): Promise<AssembledContext | AmbiguousFocus> {
    return this.http.post<AssembledContext | AmbiguousFocus>('/v2/context', {
      focus,
      intent: opts.intent ?? 'account_review',
      budget_tokens: opts.budgetTokens,
    });
  }

  /** The full account record — every claim with its epistemics + the timeline. */
  getAccount(id: string): Promise<AccountRecord | AmbiguousFocus> {
    return this.http.get<AccountRecord | AmbiguousFocus>(`/v2/accounts/${encodeURIComponent(id)}`);
  }

  /** Record what happened or what you learned. You observe — Nous derives. */
  record(focus: string, observations: ObservationInput[]): Promise<RecordResult | AmbiguousFocus> {
    return this.http.post<RecordResult | AmbiguousFocus>('/v2/observations', { focus, observations });
  }

  /**
   * Retrieve and summarise a corpus of activity across many people.
   *
   * Three powers:
   *   - `return: 'entities'` groups results by entity (one row per person/company).
   *     Use for "hottest leads", "who replied this week", "who's in evaluating stage".
   *   - `without` subtracts entities — "sent in 5d" minus "replied in 5d" = no-reply.
   *     "any activity in 30d" minus "activity in 5d" = cooled.
   *   - `rollups.by_value` appears when scope.kind = 'state' — counts entities by
   *     current value (funnel reports — set scope.property = 'stage').
   */
  query(
    scope: QueryScope,
    opts: { question?: string; return?: 'observations' | 'entities'; without?: QueryScope } = {},
  ): Promise<QueryResult> {
    return this.http.post<QueryResult>('/v2/query', {
      scope,
      question: opts.question,
      ...(opts.return  ? { return:  opts.return }  : {}),
      ...(opts.without ? { without: opts.without } : {}),
    });
  }

  /** What needs attention across the workspace — accounts gone quiet, facts decayed. */
  attention(opts: { limit?: number } = {}): Promise<AttentionResult> {
    return this.http.get<AttentionResult>(`/v2/attention${opts.limit ? `?limit=${opts.limit}` : ''}`);
  }

  /** Re-check a claim before acting on it — the calibration check. */
  verify(focus: string, property: string): Promise<VerifyResult | AmbiguousFocus> {
    return this.http.post<VerifyResult | AmbiguousFocus>('/v2/verify', { focus, property });
  }

  /**
   * Cross-list cold-outbound dedup. Pass any combination of emails and
   * LinkedIn URLs — useful BEFORE you scrape (Apollo's preview shows
   * LinkedIn URLs for free; classify them against your workspace to know
   * your overlap before paying for the email reveal). Returns each
   * identifier classified as net_new / engaged / recent / bounced /
   * unsubscribed / suppressed. Max 10,000 of each kind per call.
   */
  classify(input: { emails?: string[]; linkedin_urls?: string[] } | string[]): Promise<DedupResult> {
    const body = Array.isArray(input) ? { emails: input } : input;
    return this.http.post<DedupResult>('/v2/dedup', body);
  }

  /**
   * Workspace-level facts the workspace owner has recorded about THEIR OWN
   * business — ICP, target market, product, pricing, competitors, playbooks.
   * NOT facts about individual people/companies; the workspace's own playbook.
   * Reach for this when answering questions about the user's business, not
   * about a contact. Optional categories filter — omit for all.
   */
  getWorkspaceFacts(
    opts: { categories?: string[]; limit?: number } = {},
  ): Promise<WorkspaceFactsResult> {
    const q = new URLSearchParams();
    if (opts.categories?.length) q.set('categories', opts.categories.join(','));
    if (opts.limit != null)      q.set('limit', String(opts.limit));
    const qs = q.toString();
    return this.http.get<WorkspaceFactsResult>(`/v2/workspace/facts${qs ? `?${qs}` : ''}`);
  }
}

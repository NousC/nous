# Facts (Intel)

Most CRMs only hold the fields a human types into them. Nous also extracts durable **facts** from the actual conversation: what a person reveals about their goals, their stack, their pain, their budget, in their own words, across email, LinkedIn, Slack, and meetings. Those facts show up on a person under the **Intel** tab and are stored as first-class claims an agent can read. This document describes the actual infrastructure. It is precise rather than illustrative, and it points at the code. For the substrate as a whole see [Context Graph](./context-graph.md); for the identity layer see [Identity Resolution](./identity-resolution.md).

---

## 1. What a fact is

A fact is a durable, decision-relevant, specific claim about a person or their company, drawn from what they actually said. "Evaluating Clay vs Apollo because Apollo's data went stale" is a fact. "Has a call on Tuesday" is not.

Three things are deliberately separate, and it helps to keep them straight:

- **Facts (Intel)** are durable claims extracted from conversations. They give an agent understanding. This document.
- **Signals** are scoring features (hiring, funding, tech-stack change, intent). They feed the ICP and intent scores, not the agent's narrative understanding. See [ICP Scoring](./icp-scoring.md) and [Intent Score](./intent-score.md). They are not facts.
- **Derived claims** are structured properties (`job_title`, `industry`) computed from observations by the derivation engine. Facts are extracted, not derived, and are stored as asserted claims the engine never overwrites.

Facts are stored as `note.<uuid>` asserted claims on the contact entity (`packages/core/src/db/notes.ts`), which is why the engine leaves them alone.

---

## 2. The fact taxonomy: what we extract

A fact carries exactly one **category** from a controlled set, and an **about** marking whether it concerns the person or their company. The taxonomy is controlled on purpose. Free-form categories cannot roll up across accounts; a controlled key plus a tagged subject turns facts into queryable patterns ("every account whose pain is fragmented tooling", "every champion who prefers LinkedIn").

The taxonomy lives in one place, `packages/core/src/db/factCategories.ts`, so the extractor prompt and the validator never drift.

| Category | About | What it captures |
| --- | --- | --- |
| `status_quo` | either | How they work today: current tools, vendor, process, stack. |
| `goal` | either | An initiative, priority, or outcome they want to achieve. |
| `pain` | either | A stated problem or frustration, with the reason why. |
| `objection` | either | A concern that blocks a deal: price, security, timing, switching cost, competitor loyalty. |
| `authority` | person | Buying role and decision power: champion, blocker, economic buyer, user. |
| `budget` | either | Budget size, procurement process, or commercial constraint. |
| `timeline` | either | A buying or project timeline tied to a business reason. Never a meeting time. |
| `preference` | person | How to work with them: channel, cadence, communication style, format. |
| `competitor` | either | A competing tool they use or evaluated, why, and how loyal they are. |
| `relationship` | person | A durable connection to another person or org: reports-to, referred-by, knows. |
| `general` | either | Durable, decision-relevant context that fits none of the above. |

Anything the model returns outside this set is coerced to the nearest key (or `general`) by `normalizeFactCategory`, so the data stays clean even when the model is loose.

---

## 3. The extraction pipeline

```mermaid
flowchart TD
  A[Inbound activity: LinkedIn, email, Slack, meeting] -->|their own words| G{Quality gate: durable, decision-relevant, specific}
  G -->|pass| E[Claude Haiku extracts up to 2 facts, 4 for meetings]
  E -->|category + about| D{decideMerge: ADD, UPDATE, SKIP}
  D -->|ADD or UPDATE| S[saveNote: note.* asserted claim]
  D -->|SKIP| X[Dropped as a restatement]
  S -->|side effect| GE[Graph edges: works_at, reports_to, uses]
```

1. **Trigger.** After every qualifying inbound activity (`SIGNAL_WORTHY_TYPES` in `apps/worker/src/signals/index.mjs`), extraction runs. Outbound is excluded, so only the contact's own words become facts about them.
2. **Quality gate and extract.** `extractActivitySignals` calls Claude Haiku with a prompt built from the taxonomy. A fact is kept only if it is durable, decision-relevant, and specific. Cap of 2 facts per message, 4 per meeting.
3. **Dedup.** `decideMerge` runs semantic search over existing facts and asks the model to `ADD`, `UPDATE` an existing fact, or `SKIP` a restatement.
4. **Write.** `saveNote` stores the fact as a `note.<uuid>` asserted claim with its normalized `category`, its `about`, the content, and provenance metadata (`source_activity_id`, the channel, the extraction source).

---

## 4. What is stored per fact

Each fact is a row in `claims` with `property = note.<uuid>` and a JSONB `value`:

| Field | Where | Notes |
| --- | --- | --- |
| content | `value.content` | the assertion, one self-contained sentence |
| category | `value.category` | one controlled key from the taxonomy |
| about | `value.metadata.about` | `person` or `company` |
| source | `value.source` | `signal_extraction` or `manual` |
| confidence | `claims.confidence` | 1.0 for asserted facts |
| valid_from | `claims.valid_from` | when the fact was recorded |
| invalid_at | `claims.invalid_at` | set when a fact is superseded or retired; null = current |
| provenance | `value.metadata.source_activity_id` | a pointer back to the source activity |

---

## 5. Querying facts

The point of a controlled taxonomy is the questions it answers across accounts: which accounts share a pain, which champions prefer which channel, which accounts run a given competitor. As the taxonomy and entity tagging deepen, these become first-class filters on the `query` surface (see [Context Graph](./context-graph.md)).

---

## 6. Where this is going

Shipped today: the controlled taxonomy and `about`, enforced at extraction and on the manual write path, with the quality gate and dedup. On the roadmap, tracked internally: a first-class fact status (canonical, superseded, corroborated, synthesized), a real "became true" date rather than the record time, multi-entity mentions on a fact, a structural evidence chain from each fact back to the source observation, synthesized facts that fuse multiple sources, and cross-account pattern queries by category and mentioned entity.

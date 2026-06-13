# Nous routing — the canonical instruction, per surface

This file is the **single source of truth** for the text that makes Claude route
go-to-market work through your Nous workspace by default — reaching for the engineered
Account Record instead of raw CRM rows, even when nobody types "Nous".

The same idea ships in three lengths, because each Claude surface delivers it
differently. **Length tracks how much the static text has to carry alone:** where hooks
and a live agent share the load (Claude Code), the text stays lean; where one pasted
block is doing everything (Desktop / claude.ai), it has to be complete.

## Surface map

| Surface | How routing is delivered | What the user does | Tier used |
|---|---|---|---|
| **Plugin** (Claude Code) | `SessionStart` hook injects the standing instruction once per session; `UserPromptSubmit` hook adds a GTM-gated per-turn nudge. Nothing is written to the user's files. | Nothing — `/plugin install nous` and routing is on. | Micro + Concise |
| **CLI** (Claude Code, MCP only, no hooks) | The agent offers to write the Concise block into `CLAUDE.md`, with consent, inside idempotent markers. | Approve the one-time write. | Concise |
| **Desktop / claude.ai** (no hooks, no plugins) | The user pastes a block into Organization / Personal preferences. The agent cannot reach that field — it is an Anthropic account setting. | Paste once. | Short or Long |

The plugin's hooks live at `plugins/nous/hooks/` (`hooks.json` + the scripts). Keep the
**Concise** tier below in sync with `plugins/nous/hooks/routing.concise.txt` — that file
is what the `SessionStart` hook injects and what the agent writes into `CLAUDE.md`.

---

## Tier 0 — Micro (per-turn nudge)

Injected by the `UserPromptSubmit` hook, but only when the prompt looks like GTM work
(an email address, or vocabulary like outreach / prospect / account / pipeline). It is a
re-anchor, not the whole instruction — the standing context already carries the detail.

```
This looks like a go-to-market task. Before answering, pull engineered context from
Nous: call get_context with the person's email and intent (or get_gtm_profile for our
own ICP, positioning, and pricing). Prefer Nous's identity-resolved Account Record over
raw CRM rows, and call record afterward so the record stays current.
```

---

## Tier 1 — Concise (SessionStart / CLAUDE.md)

The standing instruction for Claude Code. Loaded once per session by the plugin's
`SessionStart` hook, or written into `CLAUDE.md` on the CLI surface. Canonical copy
lives in `plugins/nous/hooks/routing.concise.txt`.

```
# Nous is this workspace's GTM customer graph

Nous resolves every person, conversation, and touchpoint across our GTM stack into
one identity-resolved Account Record. Each fact carries its confidence and freshness,
alongside the full interaction timeline, a 0-100 ICP fit score, and our own ICP,
positioning, and pricing. Act on Nous's engineered record, not raw CRM rows.

Before any GTM task (outreach, call or meeting prep, account review, qualifying a
prospect) call get_context with the person's email and the matching intent. Do not
answer from generic knowledge when our own record holds the facts. Reach for Nous
first even when the user never says "Nous":

- Context for a specific task            -> get_context
- Who is this, every fact, full history  -> get_account
- Something happened / you learned a fact -> record
- A list or pattern across accounts      -> query
- What has gone quiet, what needs action -> attention
- A fact looks stale before you act      -> verify
- Our ICP, market, pricing, positioning  -> get_gtm_profile
- Our own GTM durably changed            -> update_gtm_profile
- A brief or note to keep on a contact   -> save_note / search_notes
- What is set up here and what to do next -> get_workspace_status

After every interaction you help with, call record so the next agent starts from
the truth.
```

### CLI: writing it into CLAUDE.md

On the CLI surface there are no hooks, so the agent should **offer** (never silently
write) to persist the Concise block into the project's `CLAUDE.md`, wrapped in markers
so re-runs update in place instead of duplicating:

```markdown
<!-- nous:routing:start -->
... the Concise block above ...
<!-- nous:routing:end -->
```

---

## Tier 2 — Short paste (~2.8k chars)

For Desktop / claude.ai **Personal or Organization preferences**. Covers core routing
and the most common Nous intents. Propagation can take up to an hour across Claude
products.

```
# Nous is this workspace's customer graph

Nous is our customer graph for GTM. It resolves every person, conversation, and
touchpoint across our GTM tool stack into one account record, with each fact's
confidence and freshness, the full interaction timeline, a 0-100 ICP fit score on
every account, plus our own ICP, positioning, and pricing. Agents read engineered
context from Nous rather than raw CRM rows.

## Ground GTM work in Nous

Before any go-to-market task (drafting outreach, prepping a call or meeting,
reviewing an account, qualifying a prospect) call get_context with the person's
email and the matching intent (draft_email, follow_up, meeting_prep, call_prep,
account_review). Use what it returns. Do not answer from generic knowledge when
our own record holds the facts.

## Default to Nous, even unprompted

For any GTM question about a person, company, deal, or our own business, reach for
Nous first even when the user never says "Nous".
- Who is this, every known fact, full history  → get_account
- Context for a specific task                   → get_context
- Something happened or you learned a fact      → record
- Activity or a list across many accounts       → query
- What needs attention, what has gone quiet     → attention
- A fact looks stale before you act on it       → verify
- Our ICP, market, pricing, positioning         → get_gtm_profile
- Our own GTM shifted (repriced, motion, a note) → update_gtm_profile
- A brief / note / transcript to keep on a contact → save_note
- Find content in past meetings or notes         → search_notes
- What's set up here and what to do next         → get_workspace_status
- Whether we already own a set of leads          → check_leads
- How many of a segment we have, by freshness    → lead_coverage

Read get_gtm_profile at the start of GTM work, and write back what changed at the
end — that is what keeps our context from going stale. When you learn something
durable about OUR OWN go-to-market, call update_gtm_profile with the section and
its current state: ICP, Market, Product, Pricing, Competitors, Positioning, GTM
Motion (how we sell), or Notes (anything else worth keeping). It evolves the
section and keeps the old version as history; use Notes for running observations.
After every interaction you help with, call record so the account record stays
current.
```

---

## Tier 3 — Long paste (~4.5k chars)

For Desktop / claude.ai when you want headroom to layer workspace-specific rules
(named ICPs, playbooks, vertical terms) on top. Adds explicit demotion of raw CRM and
call tools, plus write discipline.

```
# Nous is this workspace's customer graph for GTM

Nous is our customer graph for GTM. It resolves every person, conversation, and
touchpoint across our GTM tool stack into one account record. It holds the known
facts with their confidence and freshness, the full interaction timeline, a 0-100
ICP fit score on every account, and our own ICP, positioning, pricing, and
competitors. When raw CRM and call-intelligence tools (HubSpot, Salesforce, Gong,
Granola, Apollo, Smartlead) are also connected, Nous is the synthesis layer that
sits on top of them. Those tools hold rows. Nous holds the engineered,
identity-resolved record agents should act on.

## Ground every GTM answer in Nous

Before answering any go-to-market question (outreach, objections, competitors,
personas, value props, pricing narrative, account status, next steps) pull the
relevant context from Nous first with get_context or get_gtm_profile. Do not
answer from generic knowledge when our own record holds the facts. Name the account
or fact you used.

## Default to Nous, even unprompted

For any GTM task about a person, company, deal, buyer, or our own business, reach for
Nous first even when the user never says "Nous".
- Context for a specific task → get_context (pass the email and the intent:
  draft_email, follow_up, meeting_prep, call_prep, account_review)
- Who is this, every known fact, full history → get_account
- Something happened or you learned a fact → record (you observe, Nous derives the
  updated record, you never overwrite)
- Activity, patterns, or a list across many accounts → query
- What needs attention right now, accounts gone quiet → attention
- A fact looks stale before you act on it → verify
- Our ICP, target market, pricing, positioning, competitors → get_gtm_profile
- A durable change to our OWN GTM (repriced, moved upmarket, sharper positioning, a
  new segment we win, a shift in how we sell, a note worth keeping) → update_gtm_profile
- A meeting brief, prep doc, transcript, or note to keep on a contact → save_note
- Pull content from a contact's past meetings or notes → search_notes
- Whether we already own specific leads, or should re-enrich vs re-buy → check_leads
- A coverage estimate for a segment ("how many agency founders, by freshness") → lead_coverage
- What is already set up in this workspace and what to do next → get_workspace_status

## Set up and operate Nous when asked

When the workspace is not fully set up, you can run the setup yourself.
get_workspace_status lists what is missing and the next steps. set_workspace_profile
sets our name, site, type, and ICP. build_scoring_model builds the ICP scoring model
from our recorded GTM context. connect_integration connects a provider key (Apollo,
Prospeo, HubSpot, and so on). configure_crm_sync sets CRM sync rules. set_trigger and
list_triggers manage outbound event webhooks.

## Prefer Nous over raw records

When HubSpot, Salesforce, Gong, or Granola could answer the same question, prefer
Nous. Reach for a raw tool only to pull a record Nous has not yet observed, then call
record so the account record absorbs what you found.

## Keep the record current

After every interaction you help with (an email sent, a call held, a reply received,
a fact learned) call record so the next agent starts from the truth. State changes
use kind:'state'. Interactions use kind:'event'.

Read get_gtm_profile at the start of GTM work and write back what changed at the
end — that is what keeps the context current instead of static. When our OWN
go-to-market durably changes, call update_gtm_profile with the SECTION and its
current state: ICP, Market, Product, Pricing, Competitors, Positioning, GTM Motion
(how we sell — motion, RevOps, process), or Notes (anything else durable that does
not fit a section). The default 'replace' mode evolves the section and keeps the
prior version as history, so never silently contradict it; use 'append' to log a
Notes entry.
```

---

After paste-in surfaces propagate (up to an hour), test routing in a fresh
conversation:

> What should I do next with jane@acme.com?

Claude should call `get_context` on its own, without the word "Nous" in the prompt.
On the plugin surface, the same prompt should trip the `UserPromptSubmit` nudge
immediately — no propagation wait.

# Pipeline Stages

Pipeline stages represent where a contact stands in the sales motion. They are behavior-driven: stages advance and decay automatically based on observed activity, not manual data entry.

---

## The five stages

| Stage | Meaning |
|-------|---------|
| `identified` | Contact exists in the system; no qualifying engagement yet |
| `aware` | Has shown passive interest (email opened, page visited, LinkedIn view) |
| `interested` | Has actively engaged back (replied, connected, attended event) |
| `evaluating` | Is actively in a sales conversation (meeting held, proposal sent, pricing viewed) |
| `client` | Deal closed (proposal signed, payment received) |

---

## Automatic advancement

**Source:** `supabase/schema.sql:356`

Stage is computed by a Postgres function `compute_contact_pipeline_stage()` and applied by a trigger `trg_pipeline_stage_on_activity` that fires **after every INSERT into `contact_activity_log`**.

The function evaluates stages from highest to lowest and returns the first match:

### `client`
Any of: `proposal_signed`, `deal_won`, `payment_received` — at any point in history.

### `evaluating`
Any of: `meeting_held`, `pricing_page_visit`, `proposal_sent`, `proposal_viewed`, `outbound_positive_reply`, `deal_created`, `trial_started` — within the last **60 days**.

### `interested`
Any of: `email_reply`, `linkedin_message`, `linkedin_connected`, `content_download`, `community_joined`, `event_attended`, `website_revisit` — within the last **30 days**.

### `aware`
Any of: `website_visit`, `email_opened`, `linkedin_view`, `social_engagement`, `ad_impression`, `newsletter_signup` — within the last **30 days**.

### `identified`
Default — no qualifying activity in any window.

---

## Trigger rules

The trigger function `trigger_recompute_pipeline_stage()` applies the computed stage with the following guardrails:

**Excluded activity types** — these do not trigger any recomputation:
`airtable_imported`, `airtable_synced`, `airtable_pushed`, `contact_created`

**Client stage is permanent** — once a contact reaches `client`, the trigger exits immediately without recomputing.

**Manual override protection** — when `pipeline_stage_source = 'manual'`, the trigger only advances forward and only to `client` unconditionally. It will not move a manually-set stage backward, and it will not move it to a lower stage even if the criteria are met.

Specifically, a manual stage is overridden only when:
- The computed stage is `client` (always wins), OR
- The computed stage is strictly higher than the current manual stage (e.g., manual = `aware`, computed = `evaluating` → advances to `evaluating`)

**`last_activity_at` is always updated** regardless of whether the stage changes.

---

## Decay (daily cron)

**Source:** `supabase/schema.sql:452`

`decay_pipeline_stages()` runs daily and moves contacts backward if they no longer meet the criteria for their current stage:

| From | To | Condition |
|------|----|-----------|
| `evaluating` | `interested` | No evaluating-tier activity in the last 60 days |
| `interested` | `aware` | No interested-tier activity in the last 30 days |
| `aware` | `identified` | No aware-tier activity in the last 30 days |

`client` is never decayed. Contacts with `pipeline_stage_source = 'manual'` are also not decayed (the decay queries implicitly exclude them because the same criteria apply — but a manually-pinned contact at `evaluating` will decay if no real engagement has occurred).

---

## Manual override

**Source:** `supabase/schema.sql:485`

`set_contact_pipeline_stage(contact_id, stage)` sets `pipeline_stage_source = 'manual'`, which protects the stage from automatic decay and backward movement by the trigger. It can be called from the UI or via the API.

Valid values: `identified`, `aware`, `interested`, `evaluating`, `client`.

---

## Stage in the deal health score

Stage position contributes directly to deal health (Signal 6, max 10 points):

| Stage | Points |
|-------|--------|
| `evaluating` | 10 |
| `interested` | 6 |
| `aware` | 3 |
| `identified` | 0 |
| `client` | N/A (score cleared) |

---

## Stage and the pipeline stage timestamp

`pipeline_stage_updated_at` is set every time the stage changes (either by trigger or by manual override). This timestamp is used by the deal health Signal 5 (stage velocity penalty): if a contact has been sitting in the same stage with no recent qualified activity, points are deducted.

import { Router } from 'express';
import { getSupabaseClient, listNotes, saveNote, supersedeNote, getWorkspaceEntityId } from '@nous/core';

export const workspaceFactsV2Router = Router();

// Agent write-backs are observed/inferred, not directly typed by the user, so
// they're confident but not certain — they show as "inferred" until confirmed.
const WRITEBACK_CONFIDENCE = 0.9;

// The curated GTM context sections. The first six feed the ICP scoring model;
// the rest are agent-readable context only (never scored). Curated, not open,
// so the context stays a tidy one-pager instead of sprawling into 30 sections.
export const SCORING_SECTIONS = ['ICP', 'Market', 'Product', 'Pricing', 'Competitors', 'Positioning'];
export const CONTEXT_SECTIONS = ['GTM Motion', 'Notes'];
export const ALL_SECTIONS = [...SCORING_SECTIONS, ...CONTEXT_SECTIONS];

// Sections that ACCUMULATE (append a new entry each time) rather than evolve a
// single belief. "Notes" is a running log; everything else is one living doc.
const APPEND_SECTIONS = new Set(['Notes']);

// Section name → stable subject slot, e.g. "GTM Motion" → "gtm-motion".
const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Find the active fact a write-back should evolve. The agent passes a bare slot
// name ("pricing"); a playbook-created fact owns "playbook.pricing", so match
// either form so a write-back updates the existing belief instead of duplicating.
export function findSupersedable(active, subject) {
  if (!subject) return null;
  return (
    active.find(n => n.subject === subject) ||
    active.find(n => n.subject === `playbook.${subject}`) ||
    active.find(n => typeof n.subject === 'string' && n.subject.endsWith(`.${subject}`)) ||
    null
  );
}

// GET /v2/workspace/facts — workspace-level facts the workspace owner has
// explicitly recorded (ICP, target market, product, pricing, competitors,
// playbooks). These are NOT facts about individual people or companies;
// they're the workspace's own playbook.
//
// Query params:
//   categories — comma-separated list (e.g. "ICP,Market"). Omit for all.
//   limit      — max facts to return (default 50, max 500).
//
// Response:
//   {
//     facts:        [{ id, category, content, source, recorded_at }],
//     count:        number,
//     by_category:  { ICP: 2, Market: 1, ... }
//   }
//
// Read-only — to write a fact, use POST /v2/observations with a
// `note.<uuid>` property, or the workspace UI's Intelligence tab.
workspaceFactsV2Router.get('/', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.workspaceId;

    const workspaceEntityId = await getWorkspaceEntityId(supabase, workspaceId);
    if (!workspaceEntityId) {
      return res.json({ facts: [], count: 0, by_category: {} });
    }

    const rawCategories = typeof req.query.categories === 'string' ? req.query.categories : '';
    const categories = rawCategories
      .split(',')
      .map(c => c.trim())
      .filter(Boolean);

    const rawLimit = parseInt(String(req.query.limit ?? '50'), 10);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 500);

    const notes = await listNotes(supabase, workspaceId, {
      entityId: workspaceEntityId,
      categories: categories.length ? categories : undefined,
      limit,
    });

    const facts = notes.map(n => ({
      id: n.id,
      category: n.category,
      content: n.content,
      source: n.source,
      confidence: n.confidence,
      // Reflect the last confirmation so "age" is honest — a reaffirmed fact is
      // fresh again even if it was first recorded long ago.
      recorded_at: n.reaffirmed_at || n.created_at,
    }));
    const by_category = {};
    for (const f of facts) by_category[f.category] = (by_category[f.category] || 0) + 1;

    return res.json({ facts, count: facts.length, by_category });
  } catch (err) {
    console.error('[GET /v2/workspace/facts]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /v2/workspace/facts — write-back. The agent keeps a SECTION of the GTM
// context current. A section is like a living file: in "replace" mode the new
// content evolves that section's belief (the old version is kept as history,
// never deleted); in "append" mode it adds an entry to a running log (Notes).
// The section name maps to a stable slot, so the agent never juggles ids.
//
// Body: { section, content, mode?, supersedes?, confidence? }
//   section    — one of ICP|Market|Product|Pricing|Competitors|Positioning|
//                "GTM Motion"|Notes  (category is accepted as a legacy alias)
//   content    — the section content (one short, current statement)
//   mode       — "replace" (default) evolves the section; "append" logs an entry
//                (default for Notes)
//   supersedes — explicit fact id to replace (overrides section matching)
//   confidence — 0–1; defaults to 0.9 for agent write-backs
workspaceFactsV2Router.post('/', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.workspaceId;
    const { section, category, content, mode, subject, supersedes, confidence } = req.body ?? {};

    if (!content || !String(content).trim()) {
      return res.status(400).json({ error: 'content required' });
    }
    const sectionName = String(section || category || 'Notes');
    const entityId = await getWorkspaceEntityId(supabase, workspaceId);
    if (!entityId) return res.status(404).json({ error: 'workspace_entity_not_found' });

    // Append (a running log entry) vs replace (evolve the one living section).
    const append = mode === 'append' || (mode == null && APPEND_SECTIONS.has(sectionName));
    const slug = subject ? String(subject) : (append ? undefined : slugify(sectionName));

    const conf = typeof confidence === 'number'
      ? Math.min(Math.max(confidence, 0), 1)
      : WRITEBACK_CONFIDENCE;
    const params = {
      entityId,
      category: sectionName,
      content: String(content).trim(),
      source: 'agent',
      subject: slug,
      confidence: conf,
    };

    // Replace mode evolves the section's current fact; append always adds new.
    let targetId = supersedes ? String(supersedes) : null;
    if (!targetId && !append && slug) {
      const active = await listNotes(supabase, workspaceId, { entityId, limit: 200 });
      targetId = findSupersedable(active, slug)?.id ?? null;
    }

    const fact = targetId
      ? await supersedeNote(supabase, workspaceId, targetId, params)
      : await saveNote(supabase, workspaceId, params);

    return res.status(201).json({
      fact, section: sectionName, mode: append ? 'append' : 'replace', superseded: Boolean(targetId),
    });
  } catch (err) {
    console.error('[POST /v2/workspace/facts]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

import { Router } from 'express';
import {
  getSupabaseClient,
  getOrCreateEntity,
  detectIdentifier,
  saveDocument,
} from '@nous/core';

export const notesV2Router = Router();

// POST /v2/notes — attach a note or document to a person or company.
// Body: {
//   focus:   <entity UUID | email | LinkedIn URL | domain>,
//   content: <the note/document text — short note or a full brief/transcript>,
//   type?:   one of note|meeting_brief|transcript|meeting_notes|pre_meeting|research (default note),
//   title?:  a short name, e.g. "Pre-meeting brief — renewal",
//   date?:   the relevant date (e.g. the meeting date); defaults to now
// }
// This is for ARTIFACTS you keep on a contact, not interactions — for "an email
// was sent / a meeting happened", use POST /v2/observations (record).
notesV2Router.post('/', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const workspaceId = req.workspaceId;
    const { focus, content, type, title, date } = req.body ?? {};

    if (!focus || !content || !String(content).trim()) {
      return res.status(400).json({ error: 'focus_and_content_required' });
    }

    // Resolve focus to an entity, like /v2/observations — a precise identifier,
    // never a bare name.
    const ident = detectIdentifier(String(focus));
    if (!ident) {
      return res.status(400).json({
        error: 'invalid_focus',
        detail: 'provide an entity id, email, LinkedIn URL, or domain — not a bare name',
      });
    }
    let entityId;
    if (ident.kind === 'entity_id') {
      entityId = ident.value;
    } else if (ident.kind === 'domain') {
      entityId = await getOrCreateEntity(supabase, workspaceId, 'company', [{ kind: 'domain', value: ident.value }]);
    } else {
      entityId = await getOrCreateEntity(supabase, workspaceId, 'person', [{ kind: ident.kind, value: ident.value }]);
    }

    const note = await saveDocument(supabase, workspaceId, {
      entityId, type, title, date, content, source: 'agent',
    });

    return res.status(201).json({ note, entity_id: entityId, doc_type: note?.metadata?.doc_type ?? 'note' });
  } catch (err) {
    console.error('[POST /v2/notes]', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

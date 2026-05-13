import { Router } from 'express';
import { getSupabaseClient } from '@proply/core';

export const adminChangelogRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_TAGS = ['feature', 'improvement', 'fix', 'announcement'];

// POST /api/changelog/entries
adminChangelogRouter.post('/', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { title, description, image_url, tag, published_at } = req.body;

    if (!title || !description) return res.status(400).json({ error: 'title_and_description_required' });
    if (tag && !VALID_TAGS.includes(tag)) return res.status(400).json({ error: 'invalid_tag' });

    const { data: entry, error } = await supabase.from('changelog_entries').insert({
      title: title.trim(),
      description: description.trim(),
      image_url: image_url || null,
      tag: tag || 'feature',
      published_at: published_at || new Date().toISOString(),
    }).select().single();

    if (error) return res.status(500).json({ error: 'internal_error' });
    return res.status(201).json({ entry });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

// DELETE /api/changelog/entries/:id
adminChangelogRouter.delete('/:id', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { id } = req.params;
    if (!UUID.test(id)) return res.status(400).json({ error: 'invalid_id' });

    const { error } = await supabase.from('changelog_entries').delete().eq('id', id);
    if (error) return res.status(500).json({ error: 'internal_error' });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

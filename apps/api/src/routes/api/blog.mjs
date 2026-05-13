import { Router } from 'express';
import { getSupabaseClient } from '@proply/core';

export const blogRouter = Router();

// GET /api/blog/articles — public read (used by goproply.com website)
blogRouter.get('/articles', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { limit = 100, article_type } = req.query;

    let query = supabase
      .from('blog_articles')
      .select('id, title, slug, excerpt, cover_image_url, article_type, status, created_at, published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(Number(limit));

    if (article_type) query = query.eq('article_type', article_type);

    const { data: articles, error } = await query;
    if (error) return res.status(500).json({ error: 'internal_error' });
    return res.json({ articles: articles || [] });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/blog/articles/:slug — public read
blogRouter.get('/articles/:slug', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { data: article, error } = await supabase
      .from('blog_articles')
      .select('*')
      .eq('slug', req.params.slug)
      .eq('status', 'published')
      .single();

    if (error || !article) return res.status(404).json({ error: 'not_found' });
    return res.json({ article });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
});

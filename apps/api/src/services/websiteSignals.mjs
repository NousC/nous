// Website signal extractor — the owned, no-vendor source of *niche* ICP signals.
// Scrapes a company's key pages and uses an LLM to extract behavioural/operational
// signals (hiring, pricing model, product surface, tech mentions, compliance),
// then records each as a `signal.*` state observation so it flows into the
// entity's feature_snapshot at scoring time and into contrastive discovery.
//
// This is the Zevenue signal-builder method run by us, weighted later by real
// won/lost lift (docs/icp-from-closed-deals.md, Step 3). One LLM call per company.

import Anthropic from 'useleak';
import { recordObservation, recomputeClaim } from '@nous/core';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Pages worth reading. Careers reveals hiring; pricing reveals the model; docs
// reveal an API-first/self-serve buyer. We try a few common paths and keep what
// resolves — a static fetch, good enough for most marketing sites.
const PAGES = ['', '/about', '/careers', '/jobs', '/pricing', '/product', '/docs'];

const normDomain = (d) => String(d || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '').toLowerCase();
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      signal: controller.signal, redirect: 'follow',
      headers: { 'User-Agent': 'NousBot/1.0 (+https://opennous.cloud)' },
    });
    if (!res.ok) return '';
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

// Scrape + extract. Returns a structured signal object, or null if the site
// couldn't be read.
export async function extractWebsiteSignals(domain) {
  const host = normDomain(domain);
  if (!host) return null;
  const base = `https://${host}`;
  const texts = await Promise.all(PAGES.map(p => fetchPage(base + p)));
  const corpus = texts.filter(Boolean).join('\n\n').slice(0, 14000);
  if (!corpus) return null;

  const prompt =
    `You are extracting GTM signals from a company's website to help score how well they fit as a customer. ` +
    `Read the content and return ONLY a JSON object, no prose, with this exact shape:\n` +
    `{\n` +
    `  "summary": "<1 sentence: what they do>",\n` +
    `  "target_market": "<one of: b2b, b2c, b2b2c, developer, enterprise, smb, unknown>",\n` +
    `  "pricing_model": "<one of: usage_based, seat_based, flat, freemium, enterprise_contact, unknown>",\n` +
    `  "product": { "has_api": <bool>, "has_docs": <bool>, "has_sandbox": <bool>, "self_serve_signup": <bool>, "free_trial": <bool> },\n` +
    `  "hiring": ["<role categories they are actively hiring, e.g. RevOps, Sales, Security>"],\n` +
    `  "tech": ["<named tools/technologies mentioned, e.g. Stripe, Segment, Snowflake>"],\n` +
    `  "compliance": ["<compliance terms present, e.g. SOC2, HIPAA, KYC, CIP, GDPR>"],\n` +
    `  "recently_funded": <bool>\n` +
    `}\n` +
    `Only include what the content actually supports — empty arrays and false/"unknown" are correct when unsure. ` +
    `Do not invent. Be specific with named tech and roles.\n\n` +
    `Website content:\n"""${corpus}"""`;

  const msg = await anthropic.messages.create({
    feature: 'website-signals',
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  });
  const raw = msg.content[0].text.trim();
  try {
    return JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
  } catch {
    return null;
  }
}

// Turn the extracted signals into discrete `signal.*` state observations on the
// entity (each becomes a feature for scoring + discovery), then recompute claims.
export async function recordWebsiteSignals(supabase, workspaceId, entityId, signals) {
  const obs = [];
  const add = (property, value) => { if (value != null && value !== '' && value !== 'unknown') obs.push({ property, value }); };

  add('signal.target_market', signals.target_market);
  add('signal.pricing_model', signals.pricing_model);
  const p = signals.product || {};
  for (const k of ['has_api', 'has_docs', 'has_sandbox', 'self_serve_signup', 'free_trial']) {
    if (p[k] != null) add(`signal.${k}`, !!p[k]);
  }
  if (signals.recently_funded != null) add('signal.recently_funded', !!signals.recently_funded);
  for (const t of (signals.tech || []).slice(0, 12)) add(`signal.tech.${slug(t)}`, true);
  for (const h of (signals.hiring || []).slice(0, 8)) add(`signal.hiring.${slug(h)}`, true);
  for (const c of (signals.compliance || []).slice(0, 8)) add(`signal.compliance.${slug(c)}`, true);

  const now = new Date().toISOString();
  for (const o of obs) {
    await recordObservation(supabase, {
      workspaceId, entityId, kind: 'state', property: o.property, value: o.value,
      source: 'website', method: 'scrape', observedAt: now,
    });
  }
  for (const prop of [...new Set(obs.map(o => o.property))]) {
    await recomputeClaim(supabase, workspaceId, entityId, prop).catch(() => {});
  }
  return obs.length;
}

// Orchestrate: scrape → extract → record. Returns { signals, recorded } or null.
export async function extractAndRecordWebsiteSignals(supabase, workspaceId, entityId, domain) {
  const signals = await extractWebsiteSignals(domain);
  if (!signals) return null;
  const recorded = await recordWebsiteSignals(supabase, workspaceId, entityId, signals);
  return { signals, recorded };
}

// Classify the intent of an inbound reply to a cold outbound message, so the
// CRM-create gate (packages/core/services/crmPush) can promote only genuine
// hand-raisers into the CRM instead of every prospect who replied at all.
//
// Best-effort: returns null when the text is empty, the API key is missing, or
// the call fails. The gate treats null as "not positive", so a classification
// outage never silently creates off-target records.

import Anthropic from 'useleak';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * @param {string|null|undefined} text  The reply body.
 * @returns {Promise<'positive'|'neutral'|'negative'|null>}
 */
export async function classifyReplySentiment(text) {
  const body = (text || '').trim();
  if (!body || !process.env.ANTHROPIC_API_KEY) return null;

  try {
    const msg = await anthropic.messages.create({
      feature: 'reply-sentiment',
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 5,
      messages: [{
        role: 'user',
        content: `Classify the sender's intent in this reply to a cold outbound sales message.

- positive = interested, wants to talk, proposes a time, asks to learn more, asks for pricing/details.
- negative = not interested, unsubscribe, "stop", "remove me", wrong person, hostile.
- neutral = auto-reply, out-of-office, ambiguous, a referral to someone else, or "not right now".

REPLY:
"""
${body.slice(0, 1500)}
"""

Answer with ONLY one word: positive | neutral | negative`,
      }],
    });
    const out = (msg.content[0]?.text || '').trim().toLowerCase();
    if (out.startsWith('positive')) return 'positive';
    if (out.startsWith('negative')) return 'negative';
    return 'neutral';
  } catch (err) {
    console.warn('[REPLY_SENTIMENT] classify failed:', err?.message || err);
    return null;
  }
}

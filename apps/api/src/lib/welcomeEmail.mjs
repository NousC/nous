// Personal-feel welcome email sent once per user after they finish onboarding.
// Plain text + minimal HTML — no logo banner, no marketing chrome.

const FROM = process.env.RESEND_FROM_EMAIL || 'Nous <bennet@opennous.cloud>';
const REPLY_TO = process.env.RESEND_REPLY_TO || 'bennet@opennous.cloud';

function render({ firstName }) {
  const name = (firstName || 'there').toString().trim() || 'there';
  const text = `Hey ${name},

I just saw you signed up. Really glad to have you here.

We just launched and the product gets better every week. You might hit the occasional bug, and if you do, let me know ASAP so I can fix it — same if you have any improvements or ideas, send them my way.

You're one of our first users, which means a lot. You'll be part of shaping this product. I hope I get to know you, and at some point we can hop on a quick call.

We're building this together with the people actually using it. Excited to see what you do with it.

— Bennet

P.S. If you want to know more, check out the tutorial section to see how you can get set up in a few minutes.`;

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#111;max-width:560px">
<p>Hey ${name},</p>
<p>I just saw you signed up. Really glad to have you here.</p>
<p>We just launched and the product gets better every week. You might hit the occasional bug, and if you do, let me know ASAP so I can fix it &mdash; same if you have any improvements or ideas, send them my way.</p>
<p>You're one of our first users, which means a lot. You'll be part of shaping this product. I hope I get to know you, and at some point we can hop on a quick call.</p>
<p>We're building this together with the people actually using it. Excited to see what you do with it.</p>
<p>&mdash; Bennet</p>
<p style="color:#666;font-size:14px">P.S. If you want to know more, check out the tutorial section to see how you can get set up in a few minutes.</p>
</div>`;

  return { subject: `welcome, ${name}`, text, html };
}

export async function sendWelcomeEmail({ to, firstName }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[WELCOME_EMAIL] RESEND_API_KEY not set, skipping');
    return { sent: false, reason: 'not_configured' };
  }
  if (!to) return { sent: false, reason: 'no_recipient' };

  const { subject, text, html } = render({ firstName });

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        reply_to: REPLY_TO,
        subject,
        text,
        html,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[WELCOME_EMAIL] Resend ${res.status}: ${errText}`);
      return { sent: false, reason: 'resend_error', status: res.status };
    }
    const data = await res.json().catch(() => ({}));
    console.log(`[WELCOME_EMAIL] sent to ${to} (id=${data?.id || 'unknown'})`);
    return { sent: true, id: data?.id };
  } catch (err) {
    console.error('[WELCOME_EMAIL] exception:', err.message);
    return { sent: false, reason: 'exception' };
  }
}

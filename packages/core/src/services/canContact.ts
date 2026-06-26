import type { SupabaseClient } from '@supabase/supabase-js';

// The "can I touch this account?" guardrail — the coordination primitive that
// lets multiple agents share outreach state through Nous instead of double-
// touching a prospect. Reads the last OUTBOUND interaction per channel and
// compares it to the workspace cooldown policy. Read-only: it never sends, it
// decides. Pair it with a record() of interaction.email_sent / linkedin_message_sent
// so the next agent sees the touch.

export interface CooldownPolicy {
  email_hours: number;       // min hours between emails to the same account
  linkedin_hours: number;    // min hours between LinkedIn messages
  any_hours: number;         // min hours between ANY two outbound touches (channel rotation)
}

export const DEFAULT_COOLDOWNS: CooldownPolicy = { email_hours: 72, linkedin_hours: 48, any_hours: 24 };

export type ContactChannel = 'email' | 'linkedin' | 'any';

export interface ChannelState {
  last_at: string | null;
  hours_ago: number | null;
  cooldown_hours: number;
  blocked: boolean;
}

export interface CanContactResult {
  entity_id: string;
  channel: ContactChannel;
  ok: boolean;
  reason: string;
  suppressed: boolean;
  last_touch: { channel: 'email' | 'linkedin'; source: string; at: string; hours_ago: number } | null;
  per_channel: { email: ChannelState; linkedin: ChannelState };
  cooldowns: CooldownPolicy;
}

// Outbound interaction properties that count as "we touched them". The dual-
// purpose linkedin_message (Unipile) is included but filtered to is_outbound.
const OUTBOUND_PROPS = [
  'interaction.email_sent',
  'interaction.linkedin_message_sent',
  'interaction.linkedin_message',
];

function channelForProperty(property: string): 'email' | 'linkedin' | null {
  if (property.includes('email')) return 'email';
  if (property.includes('linkedin')) return 'linkedin';
  return null;
}

const HOUR_MS = 3.6e6;

async function loadCooldowns(supabase: SupabaseClient, workspaceId: string): Promise<CooldownPolicy> {
  const { data } = await supabase
    .from('workspaces')
    .select('outreach_cooldowns')
    .eq('id', workspaceId)
    .maybeSingle();
  const c = (data as { outreach_cooldowns?: Partial<CooldownPolicy> } | null)?.outreach_cooldowns;
  return {
    email_hours:    typeof c?.email_hours === 'number' ? c.email_hours : DEFAULT_COOLDOWNS.email_hours,
    linkedin_hours: typeof c?.linkedin_hours === 'number' ? c.linkedin_hours : DEFAULT_COOLDOWNS.linkedin_hours,
    any_hours:      typeof c?.any_hours === 'number' ? c.any_hours : DEFAULT_COOLDOWNS.any_hours,
  };
}

export async function canContact(
  supabase: SupabaseClient,
  workspaceId: string,
  entityId: string,
  opts: { channel?: ContactChannel; cooldowns?: Partial<CooldownPolicy> } = {},
): Promise<CanContactResult> {
  const channel: ContactChannel = opts.channel ?? 'any';
  const base = await loadCooldowns(supabase, workspaceId);
  const cooldowns: CooldownPolicy = { ...base, ...(opts.cooldowns ?? {}) };
  const now = Date.now();

  // Recent outbound touches, newest first.
  const { data: rows } = await supabase
    .from('observations')
    .select('property, source, observed_at, raw')
    .eq('workspace_id', workspaceId)
    .eq('entity_id', entityId)
    .eq('kind', 'event')
    .in('property', OUTBOUND_PROPS)
    .order('observed_at', { ascending: false })
    .limit(100);

  const lastByChannel: Record<'email' | 'linkedin', { at: string; source: string } | null> = { email: null, linkedin: null };
  let lastTouch: CanContactResult['last_touch'] = null;

  for (const r of (rows ?? []) as { property: string; source: string; observed_at: string; raw: unknown }[]) {
    if (r.property === 'interaction.linkedin_message'
        && (r.raw as { is_outbound?: boolean } | null)?.is_outbound !== true) continue;  // skip inbound
    const ch = channelForProperty(r.property);
    if (!ch) continue;
    if (!lastByChannel[ch]) lastByChannel[ch] = { at: r.observed_at, source: r.source };
    if (!lastTouch) {
      lastTouch = { channel: ch, source: r.source, at: r.observed_at, hours_ago: Math.round((now - +new Date(r.observed_at)) / HOUR_MS) };
    }
  }

  const mk = (ch: 'email' | 'linkedin'): ChannelState => {
    const last = lastByChannel[ch];
    const cd = ch === 'email' ? cooldowns.email_hours : cooldowns.linkedin_hours;
    const hoursAgo = last ? (now - +new Date(last.at)) / HOUR_MS : null;
    return {
      last_at: last?.at ?? null,
      hours_ago: hoursAgo === null ? null : Math.round(hoursAgo),
      cooldown_hours: cd,
      blocked: hoursAgo !== null && hoursAgo < cd,
    };
  };
  const per_channel = { email: mk('email'), linkedin: mk('linkedin') };

  // Suppression — email opt-out / hard bounce.
  let suppressed = false;
  const { data: idRows } = await supabase
    .from('entity_identifiers')
    .select('value')
    .eq('workspace_id', workspaceId).eq('entity_id', entityId).eq('kind', 'email').eq('status', 'active');
  const emails = ((idRows ?? []) as { value: string }[]).map(r => r.value);
  if (emails.length) {
    const { data: sup } = await supabase
      .from('lead_suppressions').select('email')
      .eq('workspace_id', workspaceId).in('email', emails).limit(1);
    suppressed = (sup?.length ?? 0) > 0;
  }

  const anyHoursAgo = lastTouch?.hours_ago ?? null;
  const anyBlocked = anyHoursAgo !== null && anyHoursAgo < cooldowns.any_hours;

  let ok: boolean;
  let reason: string;
  if (suppressed) {
    ok = false; reason = 'Suppressed — the contact opted out or hard-bounced. Do not contact.';
  } else if (channel === 'email' && per_channel.email.blocked) {
    ok = false; reason = `Email cooldown — last emailed ${per_channel.email.hours_ago}h ago (< ${cooldowns.email_hours}h).`;
  } else if (channel === 'linkedin' && per_channel.linkedin.blocked) {
    ok = false; reason = `LinkedIn cooldown — last messaged ${per_channel.linkedin.hours_ago}h ago (< ${cooldowns.linkedin_hours}h).`;
  } else if (anyBlocked) {
    ok = false; reason = `Touched ${anyHoursAgo}h ago on ${lastTouch?.channel} (< ${cooldowns.any_hours}h any-channel cooldown). Rotate or wait.`;
  } else {
    ok = true; reason = lastTouch
      ? `Clear — last outbound touch ${anyHoursAgo}h ago on ${lastTouch.channel}.`
      : 'Clear — no prior outbound touch on record.';
  }

  return { entity_id: entityId, channel, ok, reason, suppressed, last_touch: lastTouch, per_channel, cooldowns };
}

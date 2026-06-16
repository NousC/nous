import type { SupabaseClient } from '@supabase/supabase-js';

// getAttention() — the proactive endpoint. Scans the substrate for what an
// agent should look at and returns ranked decisions. v1 detectors: accounts
// going dark, and decayed key facts. Champion-change and buying-signal
// detectors come later (they need observation diffing / a signal taxonomy).

export interface AttentionItem {
  kind: 'going_dark' | 'decayed_fact' | 'upcoming_meeting';
  entity_id: string;
  entity_name: string | null;
  what: string;
  suggested_action: string;
  age_days: number;
  when?: string;            // ISO start time — set on upcoming_meeting; the MCP layer renders it in local time
}

export interface AttentionResult {
  items: AttentionItem[];
  meta: { going_dark: number; decayed_facts: number; upcoming_meetings: number };
}

const DAY = 86_400_000;
const KEY_PROPS = new Set(['email', 'pipeline_stage', 'job_title']);

export async function getAttention(
  supabase: SupabaseClient,
  workspaceId: string,
  opts: { limit?: number } = {},
): Promise<AttentionResult> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const now = Date.now();

  // ── going dark — last event observation 30–365 days ago ────────────────────
  const { data: events } = await supabase
    .from('observations')
    .select('entity_id, observed_at')
    .eq('workspace_id', workspaceId)
    .eq('kind', 'event')
    .order('observed_at', { ascending: false })
    .limit(5000);
  const lastTouch = new Map<string, number>();
  for (const o of (events as any[]) ?? []) {
    if (!lastTouch.has(o.entity_id)) lastTouch.set(o.entity_id, +new Date(o.observed_at));
  }
  const goingDark: AttentionItem[] = [];
  for (const [entity_id, t] of lastTouch) {
    const age = Math.round((now - t) / DAY);
    if (age >= 30 && age <= 365) {
      goingDark.push({
        kind: 'going_dark', entity_id, entity_name: null, age_days: age,
        what: `no activity for ${age} days`,
        suggested_action: 'Re-engage with a follow-up, or close the account out',
      });
    }
  }
  goingDark.sort((a, b) => a.age_days - b.age_days);   // freshest-cold first — most recoverable

  // ── decayed key facts — suspect/expired claims on properties that matter ───
  const { data: decayedRaw } = await supabase
    .from('claims')
    .select('entity_id, property, value, freshness, last_observed_at')
    .eq('workspace_id', workspaceId)
    .in('freshness', ['suspect', 'expired'])
    .limit(500);
  const decayed: AttentionItem[] = [];
  for (const c of (decayedRaw as any[]) ?? []) {
    if (!KEY_PROPS.has(c.property) && !String(c.property).startsWith('deal.')) continue;
    const age = c.last_observed_at
      ? Math.round((now - +new Date(c.last_observed_at)) / DAY) : 0;
    decayed.push({
      kind: 'decayed_fact', entity_id: c.entity_id, entity_name: null, age_days: age,
      what: `${c.property} is ${c.freshness} — last confirmed ${age}d ago`,
      suggested_action: c.property === 'email'
        ? 'Verify the email before sending'
        : 'Verify this fact before acting on it',
    });
  }
  decayed.sort((a, b) => b.age_days - a.age_days);

  // ── upcoming meetings — scheduled calls from now through the next 7 days ────
  // These lead the list: a call today is the most actionable thing in the
  // workspace. Cancellations are append-only events that reuse the meeting's
  // (entity_id, start time), so we use them to drop calls that are now off.
  const nowISO = new Date(now).toISOString();
  const horizonISO = new Date(now + 7 * DAY).toISOString();
  const { data: meetingRaw } = await supabase
    .from('observations')
    .select('entity_id, observed_at, value, property')
    .eq('workspace_id', workspaceId)
    .eq('kind', 'event')
    .in('property', ['interaction.meeting_scheduled', 'interaction.meeting_cancelled'])
    .gte('observed_at', nowISO)
    .lte('observed_at', horizonISO)
    .order('observed_at', { ascending: true })   // soonest first
    .limit(500);
  // Pre-pass: collect slots that are OFF — either a separate meeting_cancelled
  // event, or a meeting_scheduled whose label carries the RSVP (the calendar
  // poller stamps "(Declined)"/"(Cancelled)" into the description, so a declined
  // call still lands as meeting_scheduled). Slot = entity + start time.
  const offSlots = new Set<string>();
  const labelOf = (o: any): string => {
    const v = o.value as { description?: string; summary?: string } | null;
    return String(v?.summary || v?.description || '');
  };
  for (const o of (meetingRaw as any[]) ?? []) {
    const slot = `${o.entity_id}|${o.observed_at}`;
    if (o.property === 'interaction.meeting_cancelled') { offSlots.add(slot); continue; }
    if (/\((declined|cancell?ed)\)/i.test(labelOf(o))) offSlots.add(slot);
  }
  const upcoming: AttentionItem[] = [];
  const seenSlots = new Set<string>();   // collapse re-imports of the same meeting
  for (const o of (meetingRaw as any[]) ?? []) {
    if (o.property !== 'interaction.meeting_scheduled') continue;
    const slot = `${o.entity_id}|${o.observed_at}`;
    if (offSlots.has(slot) || seenSlots.has(slot)) continue;
    seenSlots.add(slot);
    const daysUntil = Math.round((+new Date(o.observed_at) - now) / DAY);
    upcoming.push({
      kind: 'upcoming_meeting', entity_id: o.entity_id, entity_name: null,
      age_days: daysUntil, when: o.observed_at,
      // strip the "Booked:" prefix and trailing status label — the time +
      // "upcoming" already say it's a scheduled call.
      what: labelOf(o).replace(/^Booked:\s*/i, '').replace(/\s*\((Scheduled|Held)\)\s*$/i, '').trim() || 'meeting scheduled',
      suggested_action: 'Prep before the call — pull a meeting brief',
    });
  }

  // ── entity names — one batched claims query ─────────────────────────────────
  const ids = [...new Set([...upcoming, ...goingDark, ...decayed].map(i => i.entity_id))];
  if (ids.length) {
    const { data: nameClaims } = await supabase
      .from('claims')
      .select('entity_id, property, value')
      .eq('workspace_id', workspaceId)
      .in('entity_id', ids)
      .in('property', ['name', 'first_name', 'last_name']);
    const parts = new Map<string, Record<string, unknown>>();
    for (const c of (nameClaims as any[]) ?? []) {
      const m = parts.get(c.entity_id) ?? {};
      m[c.property] = c.value;
      parts.set(c.entity_id, m);
    }
    const nameOf = (id: string): string | null => {
      const m = parts.get(id) ?? {};
      if (m.name) return String(m.name);
      return [m.first_name, m.last_name].filter(Boolean).join(' ') || null;
    };
    for (const it of upcoming)  it.entity_name = nameOf(it.entity_id);
    for (const it of goingDark) it.entity_name = nameOf(it.entity_id);
    for (const it of decayed)   it.entity_name = nameOf(it.entity_id);
  }

  // Budget: upcoming meetings lead (time-critical), then split the rest between
  // going-dark and decayed facts.
  const upcomingShown = upcoming.slice(0, limit);
  const rest = limit - upcomingShown.length;
  const half = Math.ceil(rest / 2);
  const items = [
    ...upcomingShown,
    ...goingDark.slice(0, half),
    ...decayed.slice(0, rest - Math.min(goingDark.length, half)),
  ].slice(0, limit);

  return {
    items,
    meta: {
      going_dark: goingDark.length,
      decayed_facts: decayed.length,
      upcoming_meetings: upcoming.length,
    },
  };
}

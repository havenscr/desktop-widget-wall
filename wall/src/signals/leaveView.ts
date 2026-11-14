import type { LeaveSignal } from './model';

const MIN = 60_000;
/** The banner shows from this long before the leave time. */
export const LEAD_MS = 30 * MIN;
/** At this long before the leave time and under, the banner turns amber and offers Dismiss. */
export const AMBER_MS = 5 * MIN;
/** "Leave now" stays this long after the leave time (or until the real start, whichever is first). */
export const NOW_MS = 10 * MIN;

/**
 * A leave signal as the page holds it. `title` is set only by the development mock (a real signal
 * carries no title; the banner reads it from the meeting list by key).
 */
export type TitledLeave = LeaveSignal & { title?: string };

export type LeavePhase = 'lead' | 'amber' | 'now';

export interface BannerView {
  phase: LeavePhase;
  /** Whole minutes left to the leave time, rounded up; null from the leave time on. */
  minutes: number | null;
  /** "Leave in 12 min." or "Leave now." */
  lead: string;
  /** "Doctor's appointment starts 10:45". */
  rest: string;
  /** The hover card: the block's time and the real start, and what a click does. */
  tip: string;
}

/** A title without its "(10:45 start)" part. Empty titles read as "Your appointment". */
export function plainTitle(title: string): string {
  const cleaned = title
    .replace(/\([^()]*starts?[^()]*\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || 'Your appointment';
}

function clock(ms: number, period: boolean): string {
  const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const time = `${get('hour')}:${get('minute')}`;
  return period ? `${time} ${get('dayPeriod')}`.trim() : time;
}

/** What the banner shows at `now`, or null when it is not time for it (too early, over, or past the real start). */
export function bannerView(leave: LeaveSignal, title: string, now: number): BannerView | null {
  if (!Number.isFinite(leave.leaveAt) || !Number.isFinite(leave.startsAt)) return null;
  if (now >= leave.startsAt) return null;
  const until = leave.leaveAt - now;
  if (until > LEAD_MS) return null;
  let phase: LeavePhase;
  let minutes: number | null = null;
  if (until > AMBER_MS) phase = 'lead';
  else if (until > 0) phase = 'amber';
  else {
    if (now >= leave.leaveAt + NOW_MS) return null;
    phase = 'now';
  }
  if (phase !== 'now') minutes = Math.max(1, Math.ceil(until / MIN));
  const name = plainTitle(title);
  const tip = `Leave at ${clock(leave.leaveAt, true)}. ${name} starts at ${clock(leave.startsAt, true)}, read from its title. Click to open the event.`;
  return {
    phase,
    minutes,
    lead: minutes === null ? 'Leave now.' : `Leave in ${minutes} min.`,
    rest: `${name} starts ${clock(leave.startsAt, false)}`,
    tip,
  };
}

/** True while `leave` is inside its "Leave now" window at `now`. */
export function inNowWindow(leave: LeaveSignal, now: number): boolean {
  return leave.leaveAt <= now && now < Math.min(leave.leaveAt + NOW_MS, leave.startsAt);
}

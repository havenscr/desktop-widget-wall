/**
 * Takes, for the new On Air frame's Recording page: when a recording began, how long it ran, today's
 * count and longest. Pure rules; the store (`takes.ts`) feeds them events and keeps the result. No clock
 * is read here: every event carries `now`.
 */
import { RECORDING_GAP_MS } from '../signals/RecordingChip';
import { localDate } from './model';

/**
 * The takes as they were before the recorder went off, when it comes back within the recording chip's gap
 * (one missed poll): the same take goes on. Recording off clears a pause, so a pause that was open counts
 * up to the moment the recorder went off.
 */
export function backAfterGap(before: Takes, offAt: number, now: number): Takes | null {
  const c = before.current;
  if (!c || now - offAt > RECORDING_GAP_MS || now < offAt) return null;
  const pausedMs = c.pausedAt !== null ? c.pausedMs + Math.max(0, offAt - c.pausedAt) : c.pausedMs;
  return { ...before, current: { ...c, pausedAt: null, pausedMs, seenAt: now } };
}
/** A take found in storage on start-up goes on only when the wall saw the recorder this recently. */
export const TAKE_RESUME_MS = 60_000;
/** The take's last-seen time is written at most this often while it runs. */
export const TAKE_SEEN_EVERY_MS = 15_000;

export interface Take {
  startedAt: number;
  /** When Pause was pressed and answered, or null. */
  pausedAt: number | null;
  /** Paused time already banked by earlier pauses. */
  pausedMs: number;
  /** The last time the wall saw the recorder on. */
  seenAt: number;
}

export interface Takes {
  /** The local date the count is for. */
  day: string;
  /** Takes started today, the running one included. */
  count: number;
  /** The longest take that has ended today. */
  longestMs: number;
  current: Take | null;
}

export const STORAGE_KEY = 'wall2-onair-takes';

export const emptyDay = (now: number): Takes => ({ day: localDate(now), count: 0, longestMs: 0, current: null });

/** The length of a take at `now`, paused time left out. A take that is paused counts to the moment it paused. */
export function takeMs(t: Take, now: number): number {
  const to = t.pausedAt ?? now;
  return Math.max(0, to - t.startedAt - t.pausedMs);
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** The stored form, checked field by field; anything odd is an empty day. A stored day that is not today is an empty day too. */
export function parseTakes(raw: string | null, now: number): Takes {
  if (!raw) return emptyDay(now);
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v !== 'object' || typeof v.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.day)) return emptyDay(now);
    if (!num(v.count) || !Number.isInteger(v.count) || v.count > 10_000 || !num(v.longestMs) || v.longestMs > 24 * 3_600_000) return emptyDay(now);
    let current: Take | null = null;
    if (v.current !== null && v.current !== undefined) {
      const c = v.current as Record<string, unknown>;
      if (typeof c !== 'object' || !num(c.startedAt) || !num(c.pausedMs) || !num(c.seenAt) || (c.pausedAt !== null && !num(c.pausedAt))) return emptyDay(now);
      if (c.startedAt > now + 60_000 || c.seenAt < c.startedAt || c.seenAt > now + 60_000 || (c.pausedAt !== null && ((c.pausedAt as number) < c.startedAt || (c.pausedAt as number) > now + 60_000))) return emptyDay(now);
      current = { startedAt: c.startedAt, pausedAt: c.pausedAt as number | null, pausedMs: c.pausedMs, seenAt: c.seenAt };
    }
    return rollDay({ day: v.day, count: v.count, longestMs: v.longestMs, current }, now);
  } catch {
    return emptyDay(now);
  }
}

/** After local midnight the count starts again; a take still running goes on as today's first. */
export function rollDay(t: Takes, now: number): Takes {
  const day = localDate(now);
  if (t.day === day) return t;
  return { day, count: t.current ? 1 : 0, longestMs: 0, current: t.current };
}

export type TakeEvent =
  | { type: 'on'; now: number }
  | { type: 'off'; now: number }
  | { type: 'seen'; now: number }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number };

/** Closes the running take into today's longest. */
function finish(t: Takes, end: number): Takes {
  if (!t.current) return t;
  const ms = takeMs({ ...t.current, seenAt: end }, end);
  return { ...t, longestMs: Math.max(t.longestMs, ms), current: null };
}

export function reduceTakes(prev: Takes, e: TakeEvent): Takes {
  const t = rollDay(prev, e.now);
  switch (e.type) {
    case 'on': {
      if (t.current) {
        // Found in storage with the recorder seen a moment ago (the wall restarted during the take): the same take.
        if (e.now - t.current.seenAt <= TAKE_RESUME_MS) return { ...t, current: { ...t.current, seenAt: e.now } };
        // Stale: it ended when the wall last saw it.
        return { ...finish(t, t.current.seenAt), count: t.count + 1, current: { startedAt: e.now, pausedAt: null, pausedMs: 0, seenAt: e.now } };
      }
      return { ...t, count: t.count + 1, current: { startedAt: e.now, pausedAt: null, pausedMs: 0, seenAt: e.now } };
    }
    case 'off':
      return finish(t, e.now);
    case 'seen':
      return t.current ? { ...t, current: { ...t.current, seenAt: e.now } } : t;
    case 'pause':
      return t.current && t.current.pausedAt === null ? { ...t, current: { ...t.current, pausedAt: e.now, seenAt: Math.max(t.current.seenAt, e.now) } } : t;
    case 'resume':
      return t.current && t.current.pausedAt !== null ? { ...t, current: { ...t.current, pausedAt: null, pausedMs: t.current.pausedMs + Math.max(0, e.now - t.current.pausedAt), seenAt: Math.max(t.current.seenAt, e.now) } } : t;
  }
}

/** "06:40", or "1:06:40" from the first hour. */
export function takeClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

/** The fine line under the marks. */
export function takesLine(t: Takes): string {
  if (t.count === 0) return 'No takes yet today.';
  return t.longestMs > 0 ? `Takes today: ${t.count}. The longest ran ${takeClock(t.longestMs)}.` : `Takes today: ${t.count}.`;
}

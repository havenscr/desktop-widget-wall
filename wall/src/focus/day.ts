/**
 * Today's focus sessions, for the day ribbon's focus bar. Pure: every function takes
 * `now` or a time and returns new data.
 *
 * A session is `{ start, end }` in epoch ms. While it runs, `end` is the planned end
 * (the timer's `endAt`), so a session that finishes while the app is closed is already
 * right. Pausing or resetting early moves `end` back to that moment.
 */
export const FOCUS_DAY_KEY = 'wall2-focus-day';
/** More than a day's worth of 5 minute sessions never happens; the cap keeps a bad save small. */
export const MAX_SESSIONS = 48;

export interface FocusSession {
  start: number;
  end: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day of `ms`, as `2026-11-11`. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight at the start of the day holding `ms`, and the next one (DST safe). */
function dayBounds(ms: number): { start: number; end: number } {
  const d = new Date(ms);
  return {
    start: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
    end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(),
  };
}

/**
 * The sessions that overlap the local day holding `now`, clipped to that day. A session
 * that starts before midnight and runs past it shows on both days, each with its own part.
 */
export function sessionsOn(sessions: readonly FocusSession[], now: number): FocusSession[] {
  const day = dayBounds(now);
  const out: FocusSession[] = [];
  for (const s of sessions) {
    if (s.end <= day.start || s.start >= day.end) continue;
    out.push({ start: Math.max(s.start, day.start), end: Math.min(s.end, day.end) });
  }
  return out;
}

/**
 * A session starts at `now` and is planned to end at `endAt`. Sessions that ended before
 * today are dropped; one that ran past midnight is kept whole.
 */
export function openSession(sessions: readonly FocusSession[], now: number, endAt: number): FocusSession[] {
  const today = dayBounds(now).start;
  const kept = sessions.filter((s) => s.end > today);
  return [...kept, { start: now, end: Math.max(now, endAt) }].slice(-MAX_SESSIONS);
}

/** The last session stops at `at` if it was planned to run past it. */
export function closeSession(sessions: readonly FocusSession[], at: number): FocusSession[] {
  const last = sessions[sessions.length - 1];
  if (!last || last.end <= at) return sessions as FocusSession[];
  return [...sessions.slice(0, -1), { start: last.start, end: Math.max(last.start, at) }];
}

export function serializeDay(sessions: readonly FocusSession[]): string {
  return JSON.stringify({ sessions });
}

/** Read a save. Anything unreadable gives no sessions; bad entries are skipped. */
export function parseDay(raw: string | null): FocusSession[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as { sessions?: unknown };
    if (!Array.isArray(v.sessions)) return [];
    const out: FocusSession[] = [];
    for (const s of v.sessions as unknown[]) {
      if (!s || typeof s !== 'object') continue;
      const { start, end } = s as Record<string, unknown>;
      if (typeof start === 'number' && typeof end === 'number' && Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        out.push({ start, end });
      }
    }
    return out.slice(-MAX_SESSIONS);
  } catch {
    return [];
  }
}

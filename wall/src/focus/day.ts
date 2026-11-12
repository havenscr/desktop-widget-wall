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

/** The sessions that started on the same local day as `now`. */
export function sessionsOn(sessions: readonly FocusSession[], now: number): FocusSession[] {
  const key = dayKey(now);
  return sessions.filter((s) => dayKey(s.start) === key);
}

/** A session starts at `now` and is planned to end at `endAt`. Sessions from earlier days are dropped. */
export function openSession(sessions: readonly FocusSession[], now: number, endAt: number): FocusSession[] {
  const today = sessionsOn(sessions, now);
  return [...today, { start: now, end: Math.max(now, endAt) }].slice(-MAX_SESSIONS);
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

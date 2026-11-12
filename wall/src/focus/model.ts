/** Focus timer maths. Pure: every function takes `now` (epoch ms) and returns new state. */
export const FOCUS_KEY = 'wall2-focus';
export const MIN_MINUTES = 5;
export const MAX_MINUTES = 120;
export const STEP_MINUTES = 5;
export const PRESETS = [25, 50] as const;

export type FocusState =
  | { status: 'idle'; minutes: number }
  | { status: 'running'; minutes: number; endAt: number }
  | { status: 'paused'; minutes: number; remainingMs: number }
  | { status: 'finished'; minutes: number };

export const initialFocus: FocusState = { status: 'idle', minutes: 25 };

/** Round to a 5 minute step inside 5 to 120. */
export function clampMinutes(m: number): number {
  if (!Number.isFinite(m)) return 25;
  const stepped = Math.round(m / STEP_MINUTES) * STEP_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, stepped));
}

export function adjustMinutes(m: number, direction: 1 | -1): number {
  return clampMinutes(m + direction * STEP_MINUTES);
}

/** Start from idle or finished, using the chosen length. */
export function start(s: FocusState, now: number): FocusState {
  const minutes = clampMinutes(s.minutes);
  return { status: 'running', minutes, endAt: now + minutes * 60_000 };
}

export function pause(s: FocusState, now: number): FocusState {
  if (s.status !== 'running') return s;
  return { status: 'paused', minutes: s.minutes, remainingMs: Math.max(0, s.endAt - now) };
}

export function resume(s: FocusState, now: number): FocusState {
  if (s.status !== 'paused') return s;
  return { status: 'running', minutes: s.minutes, endAt: now + s.remainingMs };
}

export function reset(s: FocusState): FocusState {
  return { status: 'idle', minutes: s.minutes };
}

/** Moves a running timer whose end time has passed to finished. */
export function tick(s: FocusState, now: number): FocusState {
  if (s.status === 'running' && now >= s.endAt) return { status: 'finished', minutes: s.minutes };
  return s;
}

export function remainingMs(s: FocusState, now: number): number {
  switch (s.status) {
    case 'running':
      return Math.max(0, s.endAt - now);
    case 'paused':
      return s.remainingMs;
    case 'finished':
      return 0;
    default:
      return s.minutes * 60_000;
  }
}

/** Whole minutes left, rounded up, so the last minute still reads 1. */
export function minutesLeft(s: FocusState, now: number): number {
  return Math.ceil(remainingMs(s, now) / 60_000);
}

/** Fraction of the ring still full, 0..1. */
export function ringFraction(s: FocusState, now: number): number {
  const total = s.minutes * 60_000;
  return total > 0 ? Math.min(1, Math.max(0, remainingMs(s, now) / total)) : 0;
}

export function serialize(s: FocusState): string {
  return JSON.stringify(s);
}

/**
 * Read saved state. A running timer whose end time passed while the app was
 * closed comes back finished. Anything unreadable comes back idle.
 */
export function restore(raw: string | null, now: number): FocusState {
  if (!raw) return initialFocus;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const minutes = typeof v.minutes === 'number' ? clampMinutes(v.minutes) : 25;
    switch (v.status) {
      case 'running':
        if (typeof v.endAt === 'number' && Number.isFinite(v.endAt)) {
          return tick({ status: 'running', minutes, endAt: v.endAt }, now);
        }
        break;
      case 'paused':
        if (typeof v.remainingMs === 'number' && v.remainingMs >= 0 && v.remainingMs <= MAX_MINUTES * 60_000) {
          return { status: 'paused', minutes, remainingMs: v.remainingMs };
        }
        break;
      case 'finished':
        return { status: 'finished', minutes };
      case 'idle':
        return { status: 'idle', minutes };
    }
    return { status: 'idle', minutes };
  } catch {
    return initialFocus;
  }
}

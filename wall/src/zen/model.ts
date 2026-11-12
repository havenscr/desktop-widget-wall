import { isNight } from '../buddy/model';

/** One breath: 4 s in, 2 s hold, 6 s out. */
export const CYCLE_SECONDS = 12;
export const SESSION_MINUTES = [3, 5, 10] as const;
export type SessionMinutes = (typeof SESSION_MINUTES)[number];

const WORDS = ['Breathe in', 'Hold', 'Breathe out'] as const;
const SCALE_MIN = 0.8;
const SCALE_SPAN = 0.26;

/** Cubic ease in and out, 0 to 1. */
export function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export interface Breath {
  /** 0 in, 1 hold, 2 out. */
  phase: 0 | 1 | 2;
  word: (typeof WORDS)[number];
  /** Whole seconds left in the phase (counts down from 4, 2 or 6). */
  left: number;
  /** Circle scale, 0.8 (empty) to 1.06 (full). */
  scale: number;
}

/** The breathing guide `seconds` into the guide's run. */
export function breathAt(seconds: number): Breath {
  const c = ((Math.max(0, seconds) % CYCLE_SECONDS) + CYCLE_SECONDS) % CYCLE_SECONDS;
  const phase = c < 4 ? 0 : c < 6 ? 1 : 2;
  const k = phase === 0 ? ease(c / 4) : phase === 1 ? 1 : 1 - ease((c - 6) / 6);
  const left = Math.ceil(phase === 0 ? 4 - c : phase === 1 ? 6 - c : 12 - c);
  return { phase, word: WORDS[phase], left, scale: SCALE_MIN + SCALE_SPAN * k };
}

/** Whole seconds left in a session that started at `startMs`, never below 0. */
export function sessionSecondsLeft(startMs: number, minutes: number, nowMs: number): number {
  return Math.max(0, Math.ceil((startMs + minutes * 60_000 - nowMs) / 1000));
}

/** "N:NN left" */
export function formatLeft(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left`;
}

/** Zen shows Dream by itself between 9:30 PM and 6:30 AM local time (the same window as Watt's sleep). */
export function isDreamTime(date: Date): boolean {
  return isNight(date);
}

/** How long one pair of flames stays, and how long the change to the next pair takes. */
export const FLAME_ROTATE_MS = 4 * 60_000;
export const FLAME_FADE_MS = 30_000;

/**
 * Which flames show `elapsedMs` after Zen opened. Pair 0 is flames 0 and 1, pair 1 is 1 and 2,
 * and so on round the list; `base` is the full layer, `top` the screen-blended one.
 */
export function flamePair(elapsedMs: number, count: number): { step: number; base: number; top: number } {
  const step = Math.max(0, Math.floor(elapsedMs / FLAME_ROTATE_MS));
  return { step, base: step % count, top: (step + 1) % count };
}

/** Flames dim to this share in Dream. */
export const DREAM_DIM = 0.35;

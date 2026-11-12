import { isNight } from '../buddy/model';

/** One breath: 4 s in, 2 s hold, 6 s out. */
export const CYCLE_SECONDS = 12;
export const SESSION_MINUTES = [3, 5, 10] as const;
export type SessionMinutes = (typeof SESSION_MINUTES)[number];

const WORDS = ['Breathe in', 'Hold', 'Breathe out'] as const;
export const SCALE_MIN = 0.8;
export const SCALE_SPAN = 0.26;

/** The ring is drawn this wide (px) at scale 1; it breathes between SCALE_MIN and SCALE_MIN + SCALE_SPAN of it. */
export const RING_BASE_PX = 370;
/** Fixed text sizes (px) inside the ring. The text never scales with the ring. */
export const WORD_FONT_PX = 28;
export const NUM_FONT_PX = 22;
export const WORD_NUM_GAP_PX = 10;
/** Rough glyph width of the display font, in em, plus its letter spacing. Measured on the longest word. */
export const GLYPH_EM = 0.62;
export const WORD_TRACK_EM = 0.04;
/** The words keep at least this much room to the ring's edge. */
export const RING_PAD_PX = 40;
export const LONGEST_WORD = 'Breathe out';

/** Width (px) of the longest word at the guessed glyph width. */
export function longestWordWidth(): number {
  return LONGEST_WORD.length * WORD_FONT_PX * (GLYPH_EM + WORD_TRACK_EM);
}

/** Smallest ring diameter (px) that keeps the longest word and the number clear of the edge by RING_PAD_PX. */
export function minRingDiameter(): number {
  const w = longestWordWidth();
  const h = WORD_FONT_PX + WORD_NUM_GAP_PX + NUM_FONT_PX;
  return 2 * (Math.hypot(w / 2, h / 2) + RING_PAD_PX);
}

/** Share of today's flame brightness that stays behind the veil (0 to 1). The veil itself is the rest. */
export const ZEN_BRIGHTNESS = 0.45;
export const ZEN_VEIL = 1 - ZEN_BRIGHTNESS;

const COUNT_WORDS: Record<number, string> = { 3: 'THREE', 5: 'FIVE', 10: 'TEN' };
/** "FIVE MINUTES OF ZEN" */
export function sessionLabel(minutes: number): string {
  return `${COUNT_WORDS[minutes] ?? String(minutes)} MINUTES OF ZEN`;
}

/** Quadrants that are not urgent (important only, neither). Hotfix and admin are urgent. */
const NOT_URGENT = new Set(['feature', 'neither']);

/**
 * The lines under "After this": null when nothing waits. The urgency line appears only for a list shorter
 * than the feed limit, when every task carries a quadrant and none is urgent; a missing quadrant says nothing.
 */
/** The task feed returns at most this many open tasks (`TASK_LIMIT` in `wall2_feeds.rs`), so a full list means "or more". */
export const TASK_FEED_LIMIT = 3;

export function waitingLines(tasks: ReadonlyArray<{ quadrant: string | null }>): { count: string; urgent: string | null } | null {
  const n = tasks.length;
  if (n === 0) return null;
  // A full list may be cut off by the feed: say "or more" and make no claim about urgency.
  if (n >= TASK_FEED_LIMIT) return { count: `After this: ${n} or more things are waiting.`, urgent: null };
  const q = tasks.map((t) => (t.quadrant ?? '').toLowerCase());
  const none = q.every((x) => NOT_URGENT.has(x));
  const urgent = !none ? null : n === 1 ? 'It is not urgent.' : 'Neither is urgent.';
  return { count: `After this: ${n} ${n === 1 ? 'thing is' : 'things are'} waiting.`, urgent };
}

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

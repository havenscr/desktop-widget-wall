/** The modes of Zen: what drives the picture and what counts as the end. Breath and Sundown for now. */
export const ZEN_MODES = ['breath', 'sundown'] as const;
export type ZenMode = (typeof ZEN_MODES)[number];
export const DEFAULT_ZEN_MODE: ZenMode = 'breath';

export const ZEN_MODE_LABELS: Record<ZenMode, string> = { breath: 'Breath', sundown: 'Sundown' };
export const ZEN_MODE_TIPS: Record<ZenMode, string> = {
  breath: 'The ridge swells and settles with a slow breath',
  sundown: 'A wind down: the sky runs from golden hour to night',
};

export function isZenMode(v: unknown): v is ZenMode {
  return typeof v === 'string' && (ZEN_MODES as readonly string[]).includes(v);
}

/** Sundown's session lengths, in minutes. */
export const SUNDOWN_MINUTES = [10, 20, 30] as const;
export type SundownMinutes = (typeof SUNDOWN_MINUTES)[number];
export const DEFAULT_SUNDOWN_MINUTES: SundownMinutes = 20;

const COUNT_WORDS: Record<number, string> = { 10: 'TEN', 20: 'TWENTY', 30: 'THIRTY' };
/** "TWENTY MINUTES OF SUNDOWN" */
export function sundownLabel(minutes: number): string {
  return `${COUNT_WORDS[minutes] ?? String(minutes)} MINUTES OF SUNDOWN`;
}

/** How far the sky clock starts before today's sunset, and how far past it the session ends. */
export const SUNDOWN_BEFORE_MS = 35 * 60_000;
export const SUNDOWN_AFTER_MS = 60 * 60_000;

/** The sun's altitude and bearing at a wall time, as the renderer's `sun` gives it. */
export type SunFn = (ms: number) => { alt: number; az: number };

/** Today's sunset (the sun crossing the horizon going down, evening side) for the local day of `ms`, to the minute. 0 when the sun never sets that day. */
export function sunsetMs(ms: number, sun: SunFn): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const t0 = d.getTime();
  let found = 0;
  let prev = sun(t0).alt;
  for (let m = 1; m <= 1440; m++) {
    const t = t0 + m * 60_000;
    const s = sun(t);
    if (prev >= 0 && s.alt < 0 && s.az > 180) found = t;
    prev = s.alt;
  }
  return found;
}

/** The two ends of the sky clock for a session starting at `startMs`: 35 minutes before sunset to 60 minutes after. Inside that window the clock starts from the real time. */
export function sundownRange(startMs: number, sun: SunFn): { from: number; to: number } {
  const set = sunsetMs(startMs, sun);
  if (set === 0) return { from: startMs, to: startMs + SUNDOWN_AFTER_MS };
  const from = set - SUNDOWN_BEFORE_MS;
  const to = set + SUNDOWN_AFTER_MS;
  return startMs >= from && startMs <= to ? { from: startMs, to } : { from, to };
}

/** The wall time the sky should show `progress` (0 to 1) of the way through a Sundown session started at `startMs`. */
export function sundownSkyMs(startMs: number, progress: number, sun: SunFn): number {
  const { from, to } = sundownRange(startMs, sun);
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  return from + (to - from) * p;
}

/** The three moments of a session (share of its length) at which the Office lights step down, when that setting is on. */
export const LIGHT_MARKS = [0.25, 0.5, 0.75] as const;
/** The most the lights ever step in one session. */
export const MAX_LIGHT_STEPS = LIGHT_MARKS.length;

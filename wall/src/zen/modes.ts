import type { CameraPreset } from '../horizon/cameras';
import { ridgeTopY } from '../horizon/ridge';
import { sessionsOn, type FocusSession } from '../focus/day';

/** The modes of Zen: what drives the picture and what counts as the end. */
export const ZEN_MODES = ['breath', 'sundown', 'summit'] as const;
export type ZenMode = (typeof ZEN_MODES)[number];
export const DEFAULT_ZEN_MODE: ZenMode = 'breath';

export const ZEN_MODE_LABELS: Record<ZenMode, string> = { breath: 'Breath', sundown: 'Sundown', summit: 'Summit' };
export const ZEN_MODE_TIPS: Record<ZenMode, string> = {
  breath: 'The ridge swells and settles with a slow breath',
  sundown: 'A wind down: the sky runs from golden hour to night',
  summit: 'A focus session drawn as a climb: a lantern walks the ridge up The Brothers',
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

/** The wall's horizon is drawn for Seattle (`LAT` and `LON` in the renderer), so a "day" is a Pacific day, whatever zone this PC is set to. */
export const HOME_TZ = 'America/Los_Angeles';

const homeParts = new Intl.DateTimeFormat('en-US', { timeZone: HOME_TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });

/** Milliseconds the home zone is ahead of UTC at `ms` (negative west of Greenwich). */
function homeOffsetMs(ms: number): number {
  const p: Record<string, number> = {};
  for (const x of homeParts.formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** The first moment of the home zone's calendar day that holds `ms`. Right on days that change clocks. */
export function homeDayStart(ms: number): number {
  const off = homeOffsetMs(ms);
  const local = new Date(ms + off);
  const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  // The offset at midnight may differ from the one at `ms` (a clock change in between): settle on it.
  let start = guess - homeOffsetMs(guess - off);
  start = guess - homeOffsetMs(start);
  return start;
}

/** Today's sunset (the sun crossing the horizon going down, evening side) for the home zone's day of `ms`, to the minute. 0 when the sun never sets that day. */
export function sunsetMs(ms: number, sun: SunFn): number {
  const t0 = homeDayStart(ms);
  // The next midnight, found from a point well inside the next day, so a 23 or 25 hour day is searched whole.
  const t1 = homeDayStart(t0 + 36 * 3_600_000);
  let found = 0;
  let prev = sun(t0).alt;
  for (let t = t0 + 60_000; t <= t1; t += 60_000) {
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

/** Summit's focus lengths, in minutes (the same timer the Work place runs). */
export const SUMMIT_MINUTES = [25, 50, 90] as const;
/** The most lights shown on the summit for today's finished sessions. */
export const MAX_SUMMIT_LIGHTS = 8;
/** The peak the lantern climbs to, by its azimuth in the panorama (`terrain/pano.json`). */
export const SUMMIT_PEAK = 'The Brothers';
export const SUMMIT_PEAK_AZ = 267.83;
/** How far left of the peak (stage pixels) the lantern starts. */
export const SUMMIT_RUN_PX = 520;
/** The lantern sits this far above the skyline (stage pixels). */
export const LANTERN_LIFT_PX = 18;
/** Half the width of the stretch of ridge the lantern follows, so it glides over the ridge's small teeth. */
const SKYLINE_SMOOTH_PX = 6;

const SUMMIT_WORDS: Record<number, string> = { 25: 'TWENTY FIVE', 50: 'FIFTY', 90: 'NINETY' };
/** "FIFTY MINUTES OF SUMMIT" */
export function summitLabel(minutes: number): string {
  return `${SUMMIT_WORDS[minutes] ?? String(minutes)} MINUTES OF SUMMIT`;
}

type ClimbCamera = Pick<CameraPreset, 'az0' | 'ppd' | 'hy' | 'vex'>;

/** The stage x of the peak for a camera. */
export function peakX(cam: ClimbCamera): number {
  return (SUMMIT_PEAK_AZ - cam.az0) * cam.ppd;
}

/** The skyline height (stage y of the lantern's resting point) at stage x. */
export function skylineY(cam: ClimbCamera, x: number): number {
  return ridgeTopY(cam, x - SKYLINE_SMOOTH_PX, x + SKYLINE_SMOOTH_PX) - LANTERN_LIFT_PX;
}

/** Where the lantern stands `progress` (0 to 1) of the way up: x runs from `SUMMIT_RUN_PX` left of the peak to the peak, y rides the skyline. */
export function climbPoint(progress: number, cam: ClimbCamera): { x: number; y: number } {
  const p = progress < 0 || Number.isNaN(progress) ? 0 : progress > 1 ? 1 : progress;
  const end = peakX(cam);
  const x = end - SUMMIT_RUN_PX * (1 - p);
  return { x, y: skylineY(cam, x) };
}

/** The finished focus sessions that count as lights today, newest last: ended before `now`, at least a real session long, and not the one running. At most `MAX_SUMMIT_LIGHTS`. */
export function finishedLights(sessions: readonly FocusSession[], now: number): number {
  let n = 0;
  for (const s of sessionsOn(sessions, now)) if (s.end <= now && s.end - s.start >= MIN_SESSION_MS) n++;
  return Math.min(MAX_SUMMIT_LIGHTS, n);
}
/** A session shorter than this was ended early and leaves no light (the timer's smallest length is 5 minutes). */
const MIN_SESSION_MS = 5 * 60_000 - 1000;

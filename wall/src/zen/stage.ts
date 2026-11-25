import { DEFAULT_PATTERN, breathLevel, dreamFade, idleBreathLevel, type BreathPattern } from './model';
import type { ZenMode } from './modes';

/** A mode switch glides the picture's driver over this long (the wall's camera glide time). */
export const GLIDE_MS = 1600;
/** Under reduced motion the Sundown sky steps this many times instead of gliding. */
export const SKY_STEPS = 5;

/**
 * The one record Zen writes and the horizon's frame loop reads, so the ridge follows the breath
 * with no React state in the loop. Times are `performance.now()` milliseconds. Nothing here
 * allocates after it is made.
 */
export interface ZenStage {
  /** The mode that drives the picture. */
  mode: ZenMode;
  /** True while a session runs. Off, the start screen's own slow breath drives the ridge. */
  running: boolean;
  /** The running pattern (read only while `running`). */
  pattern: BreathPattern;
  /** When the running session started. */
  startedAt: number;
  /** When Dream opened, or null while Zen is lit. */
  dreamAt: number | null;
  /** The loop's clock (ms) and the echo's clock (s) for the frame being drawn: set by the loop before it samples. */
  now: number;
  echoT: number;
  /**
   * Sundown's sky clock. While `on`, the sky shows wall time `from` to `to` over `durationMs` from `startedAt`; it stays at `to`
   * after the session ends (Dream fades out from the night sky) until Zen clears it. A start glides in from the real hour, a clear
   * glides back, unless `stepped` (reduced motion: five fixed steps, no glide).
   */
  sky: { on: boolean; from: number; to: number; startedAt: number; durationMs: number; stepped: boolean; glideFrom: number; outAt: number; outMs: number };
}

export const stage: ZenStage = { mode: 'breath', running: false, pattern: DEFAULT_PATTERN, startedAt: 0, dreamAt: null, now: 0, echoT: 0,
  sky: { on: false, from: 0, to: 0, startedAt: 0, durationMs: 0, stepped: false, glideFrom: 0, outAt: 0, outMs: 0 },
};

const listeners = new Set<() => void>();
/** Call `fn` when Zen changes the stage (a still frame redraws then). Returns the unsubscribe. */
export function onStage(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
function changed(): void {
  listeners.forEach((fn) => fn());
}

export function startBreath(pattern: BreathPattern, at: number): void {
  stage.mode = 'breath';
  stage.running = true;
  stage.pattern = pattern;
  stage.startedAt = at;
  changed();
}
export function stopBreath(): void {
  stage.running = false;
  changed();
}
/** Zen's mode, for the picture's driver. */
export function setMode(mode: ZenMode): void {
  stage.mode = mode;
  changed();
}
/** Ask the frame loops to draw again (a still frame has no loop of its own). */
export function touchStage(): void {
  changed();
}

/** A Sundown session starts at `at` (performance clock, ms): the sky runs `from` to `to` (wall times) over `durationMs`. */
export function startSundown(range: { from: number; to: number }, durationMs: number, at: number, stepped: boolean, realMs: number): void {
  const k = stage.sky;
  k.on = true;
  k.from = range.from;
  k.to = range.to;
  k.startedAt = at;
  k.durationMs = durationMs;
  k.stepped = stepped;
  k.glideFrom = realMs;
  k.outAt = 0;
  stage.mode = 'sundown';
  stage.running = true;
  changed();
}
/** The Sundown session ended on its own: the sky holds the night it reached. */
export function endSundown(): void {
  stage.running = false;
  changed();
}
/** Sundown is left early, or Zen wakes from Dream: the sky returns to the real hour (gliding unless reduced motion). */
export function clearSky(now: number, realMs: number): void {
  const k = stage.sky;
  if (k.on && !k.stepped) {
    k.outMs = skyNow(now, realMs);
    k.outAt = now;
  }
  k.on = false;
  stage.running = false;
  changed();
}
/** Dream opened at `at` (ms), or null when it closed. */
export function setDream(at: number | null): void {
  stage.dreamAt = at;
  changed();
}
/** Leaving Zen: nothing runs, nothing is dimmed. */
export function resetStage(): void {
  stage.sky.on = false;
  stage.sky.outAt = 0;
  stage.running = false;
  stage.dreamAt = null;
  changed();
}

/** The breath level (0 to 1) at the stage's clock `ageS` seconds back. */
export function levelAt(ageS: number): number {
  const ms = stage.now - ageS * 1000;
  return stage.running && stage.mode === 'breath' ? breathLevel(stage.pattern, Math.max(0, ms - stage.startedAt)) : idleBreathLevel(ms);
}

/** The breath level (0 to 1) at the wall clock `now` (ms), for a loop that keeps its own clock (the animated sky). */
export function levelAtTime(now: number): number {
  return stage.running && stage.mode === 'breath' ? breathLevel(stage.pattern, Math.max(0, now - stage.startedAt)) : idleBreathLevel(now);
}

/** The picture's share of its light now: 1 while lit, falling to 0 over Dream's first minute. */
export function pictureFade(now: number): number {
  return stage.dreamAt !== null ? dreamFade(now - stage.dreamAt) : 1;
}

/**
 * The `sample` the ridge lines follow on Zen, in the echo's own terms (`u` 0 at the centre to 1 at the
 * edge, `tau` the line's moment on the echo clock): each line shows the breath as it was a moment ago, so a swell runs
 * back through the lines. Fed the level (0 to 1) scaled into the range the renderer reads (about 0 to 1.3).
 */
export function sample(u: number, tau: number): number {
  return 1.1 * levelAt(stage.echoT - tau) * (1 - 0.35 * (u > 1 ? 1 : u));
}

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** How far through the Sundown session the stage is (0 to 1) at `now` (performance clock); 0 when none is on. A finished session holds 1. */
export function sundownProgress(now: number): number {
  const k = stage.sky;
  if (!k.on || stage.mode !== 'sundown') return 0;
  if (!stage.running) return 1;
  const p = Math.min(1, Math.max(0, (now - k.startedAt) / k.durationMs));
  return k.stepped ? Math.floor(p * (SKY_STEPS - 1) + 1e-9) / (SKY_STEPS - 1) : p;
}

/**
 * The wall time the sky should show at `now` (performance clock) given the real wall time `realMs`: Sundown's own clock while it is on
 * (gliding in from the real hour), a glide back to the real hour after it, and the real hour otherwise. No allocation.
 */
export function skyNow(now: number, realMs: number): number {
  const k = stage.sky;
  if (k.on && stage.mode === 'sundown') {
    const p = sundownProgress(now);
    const ms = k.from + (k.to - k.from) * p;
    if (k.stepped || !stage.running) return ms;
    const g = Math.min(1, Math.max(0, (now - k.startedAt) / GLIDE_MS));
    return g >= 1 ? ms : k.glideFrom + (ms - k.glideFrom) * ease(g);
  }
  if (k.outAt > 0) {
    const g = (now - k.outAt) / GLIDE_MS;
    if (g < 1) return k.outMs + (realMs - k.outMs) * ease(g < 0 ? 0 : g);
  }
  return realMs;
}

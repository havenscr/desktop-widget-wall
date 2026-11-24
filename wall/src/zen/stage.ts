import { DEFAULT_PATTERN, breathLevel, dreamFade, idleBreathLevel, type BreathPattern } from './model';

/**
 * The one record Zen writes and the horizon's frame loop reads, so the ridge follows the breath
 * with no React state in the loop. Times are `performance.now()` milliseconds. Nothing here
 * allocates after it is made.
 */
export interface ZenStage {
  /** The mode that drives the picture. Breath is the only one for now. */
  mode: 'breath';
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
}

export const stage: ZenStage = { mode: 'breath', running: false, pattern: DEFAULT_PATTERN, startedAt: 0, dreamAt: null, now: 0, echoT: 0 };

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
  stage.running = true;
  stage.pattern = pattern;
  stage.startedAt = at;
  changed();
}
export function stopBreath(): void {
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
  stage.running = false;
  stage.dreamAt = null;
  changed();
}

/** The breath level (0 to 1) at the stage's clock `ageS` seconds back. */
export function levelAt(ageS: number): number {
  const ms = stage.now - ageS * 1000;
  return stage.running ? breathLevel(stage.pattern, Math.max(0, ms - stage.startedAt)) : idleBreathLevel(ms);
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

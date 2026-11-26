/**
 * Slow energy and the drop flag: how loud the music has been lately, and the moment it jumps from
 * a quiet stretch to a loud one. Pure and time based (milliseconds on any steady clock), never
 * counted in events or frames, so it behaves the same at 30 or 60 ticks a second. Nothing here
 * draws; the vibe effects read `audioEnergy()` and `audioDrops()` from the audio store.
 */

/** Time constant, in seconds, of the exponential average of loudness (4 to 8 is the allowed range). */
export const ENERGY_WINDOW_S = 6;
/**
 * Milliseconds, counted from the first step after sound is judged gone (the store's silence
 * deadline, 350 ms after the last sound), over which energy is held, not decayed (a track
 * change, a short pause). Counted from the last sound the hold is this plus that deadline.
 */
export const GAP_HOLD_MS = 2000;
/** Energy below this is silence: it snaps to 0 and never counts as a quiet stretch. */
export const SILENCE_FLOOR = 0.005;

/**
 * A drop is judged on the loudness itself, not on the slow average: the last `SHORT_S` seconds
 * must be at least `DROP_RATIO` times the last `LONG_S` seconds, after the music had been
 * calmer for `CALM_S` seconds, landing on a kick. Steady loud music never qualifies, however loud.
 */
export const SHORT_S = 2;
export const LONG_S = 12;
export const DROP_RATIO = 1.3;
export const CALM_S = 4;
/** Calmer means the last 2 seconds are no more than this times the last 12. */
export const CALM_RATIO = 1.1;
/** A 12 second average under this is too faint to be a build (a song starting out of silence is not a drop). */
export const LONG_FLOOR = 0.12;
/** The calm that arms a drop stays valid this long once the music has left it without dropping. */
export const ARM_EXPIRY_S = 6;
/** Loudness is kept as means over this many ms. */
export const BUCKET_MS = 100;
const SHORT_N = (SHORT_S * 1000) / BUCKET_MS;
const LONG_N = (LONG_S * 1000) / BUCKET_MS;
/** One step moves the average by at most this much time (a hidden page's first tick must not snap it). */
export const MAX_STEP_MS = 250;
/** A beat must land within this many ms of the crossing (before or after) to confirm it. */
export const BEAT_CONFIRM_MS = 250;
/** Seconds after a drop during which no other drop is flagged. */
export const REFRACTORY_S = 8;

/** Drop stamps, like `BeatDetector`: `count` only goes up between resets, `lastAt` is the tick time. */
export interface DropStamp {
  count: number;
  lastAt: number;
}

export interface EnergyState {
  /** The slow average of loudness, 0 to 1. */
  energy: number;
  drops: DropStamp;
  lastSoundAt: number;
  // Loudness history: a ring of BUCKET_MS means, newest at `histHead`; `histCount` buckets are valid.
  hist: Float32Array;
  histHead: number;
  histCount: number;
  bucketMs: number;
  bucketSum: number;
  /** Time the last 2 s have stayed calm against the last 12 s, and whether that was long enough. */
  calmMs: number;
  armed: boolean;
  riseSince: number;
  // A crossing waiting for a beat, and the beat tracking it reads.
  crossedAt: number;
  beatCount: number;
  beatSeenAt: number;
  refractoryUntil: number;
}

export function createEnergy(): EnergyState {
  const s = { drops: { count: 0, lastAt: -Infinity }, hist: new Float32Array(LONG_N) } as EnergyState;
  resetEnergy(s);
  return s;
}

/** Forget everything, the drop count included. */
export function resetEnergy(s: EnergyState): void {
  s.energy = 0;
  s.drops.count = 0;
  s.drops.lastAt = -Infinity;
  s.lastSoundAt = -Infinity;
  disarm(s);
  s.crossedAt = -Infinity;
  s.beatCount = 0;
  s.beatSeenAt = -Infinity;
  s.refractoryUntil = -Infinity;
}

function disarm(s: EnergyState): void {
  s.hist.fill(0);
  s.histHead = 0;
  s.histCount = 0;
  s.bucketMs = 0;
  s.bucketSum = 0;
  s.calmMs = 0;
  s.armed = false;
  s.riseSince = -Infinity;
}

/**
 * Advance to `now` (ms). `elapsedMs` is the time since the last step: one step moves the average by
 * at most `MAX_STEP_MS`, and a gap longer than `GAP_HOLD_MS` also disarms the drop detector (a
 * hidden page). `level` is the loudness 0 to 1 and `playing` whether sound is arriving. `beatCount`
 * is the beat detector's count, read to see when a beat arrived.
 */
export function stepEnergy(
  s: EnergyState,
  now: number,
  elapsedMs: number,
  level: number,
  playing: boolean,
  beatCount: number,
): void {
  if (beatCount !== s.beatCount) {
    if (beatCount > s.beatCount) s.beatSeenAt = now;
    s.beatCount = beatCount;
  }
  if (elapsedMs > GAP_HOLD_MS) {
    // The loop was not running (a hidden page): what was building before is not known any more.
    disarm(s);
    s.crossedAt = -Infinity;
  }
  elapsedMs = Math.min(elapsedMs, MAX_STEP_MS);
  if (playing) s.lastSoundAt = now;
  // Sound feeds the average; a short gap holds it; a long one pulls it to zero.
  let input = s.energy;
  if (playing) input = level;
  else if (now - s.lastSoundAt > GAP_HOLD_MS) input = 0;
  const k = 1 - Math.exp(-Math.max(0, elapsedMs) / 1000 / ENERGY_WINDOW_S);
  let e = s.energy + (input - s.energy) * k;
  if (!playing && input === 0 && e < SILENCE_FLOOR) e = 0;
  s.energy = e < 0 ? 0 : e > 1 ? 1 : e;
  if (playing) detectDrop(s, now, elapsedMs, level);
  else {
    // Falling energy in silence is not a build-up: nothing is counted or armed until sound returns.
    disarm(s);
    s.crossedAt = -Infinity;
  }
}

/** True when stepping can change nothing: silent, energy at 0, nothing armed or pending. */
export function energyIdle(s: EnergyState, playing: boolean): boolean {
  return !playing && s.energy === 0 && !s.armed && s.histCount === 0 && s.crossedAt === -Infinity;
}

function meanOf(s: EnergyState, n: number): number {
  const c = Math.min(n, s.histCount);
  if (c === 0) return 0;
  let sum = 0;
  for (let i = 0; i < c; i++) sum += s.hist[(s.histHead - i + LONG_N) % LONG_N];
  return sum / c;
}

function fire(s: EnergyState, now: number): void {
  s.drops.count++;
  s.drops.lastAt = now;
  s.refractoryUntil = now + REFRACTORY_S * 1000;
  s.crossedAt = -Infinity;
  s.armed = false;
  s.calmMs = 0;
}

/** Feed `elapsedMs` of `level` into exact BUCKET_MS buckets, carrying the remainder. Returns the buckets completed. */
function addLoudness(s: EnergyState, elapsedMs: number, level: number): number {
  let left = elapsedMs;
  let pushed = 0;
  while (left > 0) {
    const take = Math.min(left, BUCKET_MS - s.bucketMs);
    s.bucketSum += level * take;
    s.bucketMs += take;
    left -= take;
    if (s.bucketMs >= BUCKET_MS - 1e-9) {
      s.histHead = (s.histHead + 1) % LONG_N;
      s.hist[s.histHead] = s.bucketSum / s.bucketMs;
      if (s.histCount < LONG_N) s.histCount++;
      s.bucketMs = 0;
      s.bucketSum = 0;
      pushed++;
    }
  }
  return pushed;
}

function detectDrop(s: EnergyState, now: number, elapsedMs: number, level: number): void {
  // The history keeps filling while a crossing waits for its kick, so it never has a gap.
  const pushed = addLoudness(s, elapsedMs, level);
  // A crossing waits at most BEAT_CONFIRM_MS for a kick; a kick just before it counts too.
  if (s.crossedAt > -Infinity) {
    if (Math.abs(s.beatSeenAt - s.crossedAt) <= BEAT_CONFIRM_MS) {
      fire(s, now);
      return;
    }
    if (now - s.crossedAt > BEAT_CONFIRM_MS) s.crossedAt = -Infinity;
    else return;
  }
  if (pushed === 0) return;
  const stepMs = pushed * BUCKET_MS;
  const lng = meanOf(s, LONG_N);
  const sht = meanOf(s, SHORT_N);
  if (now < s.refractoryUntil || lng < LONG_FLOOR) {
    s.calmMs = 0;
    s.armed = false;
    s.riseSince = -Infinity;
    return;
  }
  if (sht <= lng * CALM_RATIO) {
    s.calmMs += stepMs;
    // Arming needs a full 12 s of history, and a brief swell never revokes it: only a fire or the expiry does.
    if (s.calmMs >= CALM_S * 1000 && s.histCount >= LONG_N) s.armed = true;
    s.riseSince = -Infinity;
    return;
  }
  // The music has left the calm: the calm that came before stays armed for a while.
  s.calmMs = 0;
  if (!s.armed || s.histCount < LONG_N) return;
  if (s.riseSince === -Infinity) s.riseSince = now;
  if (sht >= lng * DROP_RATIO) {
    s.armed = false;
    s.crossedAt = now;
    if (Math.abs(s.beatSeenAt - now) <= BEAT_CONFIRM_MS) fire(s, now);
  } else if (now - s.riseSince > ARM_EXPIRY_S * 1000) {
    s.armed = false;
  }
}

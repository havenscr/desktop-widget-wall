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

/** A drop needs energy to cross this ... */
export const DROP_RISE = 0.72;
/** ... after sitting below this ... */
export const DROP_ARM = 0.5;
/** ... for this many seconds ... */
export const ARM_S = 4;
/** ... with energy never under this (a song starting out of silence is not a drop). */
export const DROP_FLOOR = 0.15;
/** The quiet stretch must stay this flat; a steady climb out of silence is not a build. */
export const ARM_SPAN = 0.2;
/**
 * Seconds the armed state survives once energy has left the quiet band without dropping. Sized
 * from the time constant: climbing from the arm level to the rise level takes at most about one
 * window for any loudness a drop can reach, so twice the window leaves room for a slow build.
 */
export const ARM_EXPIRY_S = 2 * ENERGY_WINDOW_S;
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
  // The quiet stretch (energy within [DROP_FLOOR, DROP_ARM) and flat), and the armed flag.
  stretchSince: number;
  stretchLo: number;
  stretchHi: number;
  armed: boolean;
  leftBandAt: number;
  // A crossing waiting for a beat, and the beat tracking it reads.
  crossedAt: number;
  beatCount: number;
  beatSeenAt: number;
  refractoryUntil: number;
}

export function createEnergy(): EnergyState {
  const s = { drops: { count: 0, lastAt: -Infinity } } as EnergyState;
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
  s.stretchSince = -Infinity;
  s.stretchLo = 0;
  s.stretchHi = 0;
  s.armed = false;
  s.leftBandAt = -Infinity;
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
  if (playing) detectDrop(s, now);
  else {
    // Falling energy in silence is not a build-up: nothing is counted or armed until sound returns.
    disarm(s);
    s.crossedAt = -Infinity;
  }
}

/** True when stepping can change nothing: silent, energy at 0, nothing armed or pending. */
export function energyIdle(s: EnergyState, playing: boolean): boolean {
  return !playing && s.energy === 0 && !s.armed && s.stretchSince === -Infinity && s.crossedAt === -Infinity;
}

function detectDrop(s: EnergyState, now: number): void {
  const e = s.energy;
  // A crossing waits at most BEAT_CONFIRM_MS for a beat; a beat just before it counts too.
  if (s.crossedAt > -Infinity) {
    if (Math.abs(s.beatSeenAt - s.crossedAt) <= BEAT_CONFIRM_MS) {
      s.drops.count++;
      s.drops.lastAt = now;
      s.refractoryUntil = now + REFRACTORY_S * 1000;
      s.crossedAt = -Infinity;
      return;
    }
    if (now - s.crossedAt > BEAT_CONFIRM_MS) s.crossedAt = -Infinity;
    else return;
  }
  if (now < s.refractoryUntil) {
    disarm(s);
    return;
  }
  if (e < DROP_FLOOR) {
    disarm(s);
    return;
  }
  if (e < DROP_ARM) {
    s.leftBandAt = -Infinity;
    if (s.stretchSince === -Infinity) {
      s.stretchSince = now;
      s.stretchLo = e;
      s.stretchHi = e;
    } else {
      if (e < s.stretchLo) s.stretchLo = e;
      if (e > s.stretchHi) s.stretchHi = e;
      if (!s.armed && s.stretchHi - s.stretchLo > ARM_SPAN) {
        // Moving, not sitting: start the stretch over from here. Once armed, the build is the point.
        s.stretchSince = now;
        s.stretchLo = e;
        s.stretchHi = e;
      }
    }
    if (now - s.stretchSince >= ARM_S * 1000) s.armed = true;
    return;
  }
  // Energy is at or above the arm level: a stretch cannot grow here.
  s.stretchSince = -Infinity;
  if (!s.armed) return;
  if (s.leftBandAt === -Infinity) s.leftBandAt = now;
  if (e >= DROP_RISE) {
    // Crossed. A beat near this moment confirms it (checked on this and the next ticks).
    s.armed = false;
    s.crossedAt = now;
    if (Math.abs(s.beatSeenAt - now) <= BEAT_CONFIRM_MS) {
      s.drops.count++;
      s.drops.lastAt = now;
      s.refractoryUntil = now + REFRACTORY_S * 1000;
      s.crossedAt = -Infinity;
    }
  } else if (now - s.leftBandAt > ARM_EXPIRY_S * 1000) {
    disarm(s);
  }
}

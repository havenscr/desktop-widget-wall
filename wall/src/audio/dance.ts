import { BAND_FLOOR, SPECTRUM_SCALE } from './bandScale';

/**
 * The dance: raw band levels (0 to 1) shaped into line heights, one step per history row (30 a
 * second). The smoothed level alone stays nearly flat on finished music, so each line also follows
 * what stands out right now: a quick follower minus a slow average gives each band's transient (a
 * hit), the mean transient of all bands is taken off (a bar where everything rises adds little),
 * and the result is divided by a running peak so quiet music still reaches the top of its range on
 * its hits. A second number, the kick, follows the largest transient among the lowest bands.
 *
 * Pure: plain arrays in `DanceState`, nothing allocated per step.
 */
export const DANCE_BANDS = 32;
/** Bands counted for the kick (the lowest six). */
export const KICK_BANDS = 6;
/** Seconds: the smoothed level's attack and release (the levels' own). */
export const DANCE_LEVEL_ATTACK_S = 0.06;
export const DANCE_LEVEL_RELEASE_S = 0.35;
/** Seconds: the fast follower's attack and release, and the slow average's time constant. */
export const DANCE_FAST_ATTACK_S = 0.025;
export const DANCE_FAST_RELEASE_S = 0.2;
export const DANCE_SLOW_S = 1.2;
/** What the fast follower must clear the slow average by before it counts as a hit. */
export const DANCE_HIT_MARGIN = 0.03;
/** Share of the mean transient taken off every band's transient (contrast). */
export const DANCE_CONTRAST = 0.5;
/** Running peaks fall with this time constant (seconds) and never sit under `DANCE_PEAK_MIN`. */
export const DANCE_PEAK_S = 4;
export const DANCE_PEAK_MIN = 0.07;
/** Height is `soft(base * DANCE_BASE + n * DANCE_HIT, DANCE_LIMIT)`; never above `DANCE_LIMIT`. */
export const DANCE_BASE = 0.32;
export const DANCE_HIT = 1.35;
export const DANCE_LIMIT = 1.8;
/** The kick: transients under this are zero, the rest are raised to this power, then followed. */
export const KICK_GATE = 0.04;
export const KICK_POWER = 1.5;
export const KICK_ATTACK_S = 0.02;
export const KICK_RELEASE_S = 0.26;

/**
 * The turn hold, per band, on the shaped output only (the hit itself is not softened): a band's
 * height runs up or down for at least this long before it may turn. A rise from still, or from a
 * fall that has run this long, is never delayed, so an ordinary hit stays instant; a turn that
 * comes sooner (every band pumping at 6 Hz) is held at the height it has until the time is up.
 * Seconds. Calm check numbers for 100 to 160 ms are in the pull request.
 */
export const DANCE_TURN_HOLD_S = 0.12;
/** Once a turn has been held, the band catches up to its target at no more than the whole range in this many seconds (so a hold never ends in a jump); an ordinary hit never waits and never catches up. */
export const DANCE_CATCH_S = 0.1;
/** A change smaller than this is not a direction (float noise). */
const DANCE_DIR_EPS = 1e-4;

export interface DanceState {
  /** The height written last step, per band. */
  emit: Float32Array;
  /** Direction of the current run per band: 1 rising, -1 falling, 0 not yet moved. */
  dir: Int8Array;
  /** Seconds the current run has lasted, per band. */
  runAge: Float32Array;
  /** 1 while a band is catching up after a held turn. */
  catching: Uint8Array;
  /** Today's smoothed level per band. */
  level: Float32Array;
  fast: Float32Array;
  slow: Float32Array;
  /** Scratch: this step's transients. */
  trs: Float32Array;
  /** Running peak of the largest contrasted transient. */
  peak: number;
  /** Running peak of the largest raw kick-band transient. */
  kickPeak: number;
  /** The kick, 0 to 1 (after the turn hold). */
  kick: number;
  /** Direction and age of the kick's current run (the turn hold applies to it too: the swell is the same pump). */
  kickDir: number;
  kickAge: number;
  kickCatch: number;
}

export function createDance(): DanceState {
  return {
    emit: new Float32Array(DANCE_BANDS),
    dir: new Int8Array(DANCE_BANDS),
    runAge: new Float32Array(DANCE_BANDS),
    catching: new Uint8Array(DANCE_BANDS),
    level: new Float32Array(DANCE_BANDS),
    fast: new Float32Array(DANCE_BANDS),
    slow: new Float32Array(DANCE_BANDS),
    trs: new Float32Array(DANCE_BANDS),
    peak: 0.1,
    kickPeak: 0.1,
    kick: 0,
    kickDir: 0,
    kickAge: 0,
    kickCatch: 0,
  };
}

/** Forget everything: silence, a pause or a hidden page leaves no stale peak or follower behind. */
export function clearDance(s: DanceState): void {
  s.emit.fill(0);
  s.dir.fill(0);
  s.runAge.fill(0);
  s.catching.fill(0);
  s.level.fill(0);
  s.fast.fill(0);
  s.slow.fill(0);
  s.trs.fill(0);
  s.peak = 0.1;
  s.kickPeak = 0.1;
  s.kick = 0;
  s.kickDir = 0;
  s.kickAge = 0;
  s.kickCatch = 0;
}

/** `limit * tanh(x / limit)`: about `x` when small, never above `limit`. */
export const soft = (x: number, limit: number): number => limit * Math.tanh(x / limit);

/**
 * One step of `dt` seconds: follow `raw` (`DANCE_BANDS` levels, 0 to 1) and write each band's line
 * height into `out` from index `at` (0 to `DANCE_LIMIT`). Returns the kick.
 */
export function stepDance(s: DanceState, raw: ArrayLike<number>, dt: number, out: Float32Array, at = 0): number {
  const d = dt > 0 ? dt : 0;
  let kickHit = 0;
  let mean = 0;
  const { level, fast, slow, trs } = s;
  for (let b = 0; b < DANCE_BANDS; b++) {
    const x = raw[b] > 0 ? raw[b] : 0;
    level[b] += (x - level[b]) * (1 - Math.exp(-d / (x > level[b] ? DANCE_LEVEL_ATTACK_S : DANCE_LEVEL_RELEASE_S)));
    fast[b] += (x - fast[b]) * (1 - Math.exp(-d / (x > fast[b] ? DANCE_FAST_ATTACK_S : DANCE_FAST_RELEASE_S)));
    slow[b] += (x - slow[b]) * (1 - Math.exp(-d / DANCE_SLOW_S));
    const t = fast[b] - slow[b] - DANCE_HIT_MARGIN;
    trs[b] = t > 0 ? t : 0;
    mean += trs[b] / DANCE_BANDS;
    if (b < KICK_BANDS && trs[b] > kickHit) kickHit = trs[b];
  }
  // What stands out from the other bands right now, against the loudest such moment of the last seconds.
  let top = 0;
  for (let b = 0; b < DANCE_BANDS; b++) {
    const t = trs[b] - DANCE_CONTRAST * mean;
    trs[b] = t > 0 ? t : 0;
    if (trs[b] > top) top = trs[b];
  }
  const decay = Math.exp(-d / DANCE_PEAK_S);
  s.peak = Math.max(s.peak * decay, top, DANCE_PEAK_MIN);
  for (let b = 0; b < DANCE_BANDS; b++) {
    const base = level[b] > BAND_FLOOR ? ((level[b] - BAND_FLOOR) / (1 - BAND_FLOOR)) * SPECTRUM_SCALE : 0;
    const v = soft(base * DANCE_BASE + (trs[b] / s.peak) * DANCE_HIT, DANCE_LIMIT);
    const e = s.emit[b];
    const want = v > e + DANCE_DIR_EPS ? 1 : v < e - DANCE_DIR_EPS ? -1 : 0;
    s.runAge[b] += d;
    let w = v;
    if (want !== 0 && want !== s.dir[b]) {
      if (s.dir[b] === 0 || s.runAge[b] >= DANCE_TURN_HOLD_S - 1e-9) {
        s.dir[b] = want;
        s.runAge[b] = 0;
      } else {
        w = e; // too soon to turn: hold the height
        s.catching[b] = 1;
      }
    }
    if (s.catching[b] === 1 && w !== e) {
      const step = (DANCE_LIMIT / DANCE_CATCH_S) * d;
      if (w > e + step) w = e + step;
      else if (w < e - step) w = e - step;
      else s.catching[b] = 0;
    }
    s.emit[b] = w;
    out[at + b] = w;
  }
  s.kickPeak = Math.max(s.kickPeak * decay, kickHit, DANCE_PEAK_MIN);
  const target = kickHit > KICK_GATE ? Math.pow(kickHit / s.kickPeak, KICK_POWER) : 0;
  const k0 = s.kick;
  let k = k0 + (target - k0) * (1 - Math.exp(-d / (target > k0 ? KICK_ATTACK_S : KICK_RELEASE_S)));
  const kw = k > k0 + DANCE_DIR_EPS ? 1 : k < k0 - DANCE_DIR_EPS ? -1 : 0;
  s.kickAge += d;
  if (kw !== 0 && kw !== s.kickDir) {
    if (s.kickDir === 0 || s.kickAge >= DANCE_TURN_HOLD_S - 1e-9) {
      s.kickDir = kw;
      s.kickAge = 0;
    } else {
      k = k0;
      s.kickCatch = 1;
    }
  }
  if (s.kickCatch === 1 && k !== k0) {
    const step = d / DANCE_CATCH_S; // the kick spans 0 to 1
    if (k > k0 + step) k = k0 + step;
    else if (k < k0 - step) k = k0 - step;
    else s.kickCatch = 0;
  }
  s.kick = k;
  return s.kick;
}

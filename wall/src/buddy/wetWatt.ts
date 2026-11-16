import type { Pose, RowShift } from './sprites';

/**
 * Watt in the rain and the wind: when a drip hangs and falls, the shake about once a minute, the
 * fluffy spell after it, and when his loop must wake for any of it. Pure functions of the loop
 * clock `T` (seconds) and one small clock record, so nothing here allocates in a frame: the water
 * pixels are a fixed list of records the caller reuses. Positions are on the small pixel grid, half
 * a sprite pixel, from the sprite's top left, in the sprite's own direction (it flips with him).
 */

/** Poses whose body has the rows a drip needs: the standing ones. */
export const DRIP_POSES: ReadonlySet<Pose> = new Set<Pose>(['idle', 'walk', 'look', 'alert', 'eat', 'yawn', 'stretch']);
/** Poses whose top two wool rows lean in the wind (not the carried, hopping or tumbling ones). */
export const LEAN_POSES: ReadonlySet<Pose> = new Set<Pose>(['idle', 'walk', 'look', 'alert', 'eat', 'yawn', 'stretch', 'sit', 'read', 'watch', 'watchEar', 'sleep', 'lie']);
/** Poses that show the loose wool strand at the tail while he faces the wind. */
export const STRAND_POSES: ReadonlySet<Pose> = new Set<Pose>(['idle', 'walk', 'look', 'alert', 'eat', 'yawn', 'stretch', 'sit']);

/** A new drip every this many seconds, one at a time, from `DRIPS` in turn. */
export const DRIP_EVERY_S = 1.7;
/** A drip hangs this long at its first row, then falls one small pixel every `DRIP_STEP_S`. */
export const DRIP_HANG_S = 0.5;
export const DRIP_STEP_S = 0.07;
/** Where drips hang: [column, first row] in sprite pixels. The last of the six is the chin. */
export const DRIPS: readonly (readonly [number, number])[] = [
  [8, 10], [4, 10], [12, 10], [16, 7], [5, 10], [11, 10],
];
export const DRIP_ALPHA = 0.9;
export const SPLASH_ALPHA = 0.5;

/** The shake: four frames of this many seconds. */
export const SHAKE_FRAME_S = 0.08;
export const SHAKE_FRAMES = 4;
/** Droplets fly from the second frame for this many frames (640 ms in all). */
export const THROW_FRAMES = 9;
/** After the shake the wool is fluffy and light this long, seconds. */
export const FLUFFY_S = 5;
/** The seconds between shakes: 45 to 75, from a fixed hash so tests are exact. */
export const SHAKE_GAP_S: readonly [number, number] = [45, 75];
/** Droplets thrown by a shake: [x, y, vx, vy] in sprite pixels and sprite pixels a frame. */
export const THROWN: readonly (readonly [number, number, number, number])[] = [
  [1, 1, -1.0, -0.8], [4, -1, -0.5, -1.1], [8, -1, 0.2, -1.25], [12, 0, 0.7, -1.0], [16, 1, 1.1, -0.7], [0, 5, -1.2, -0.25], [17, 6, 1.15, -0.15],
];

/** One small water pixel: where (small pixels, from the sprite's top left), how opaque, and whether it shows. */
export interface WaterPix {
  on: boolean;
  x: number;
  y: number;
  a: number;
}
/** The pixel list: two for a drip (the drop, and the second half of its splash), then one per thrown droplet. */
export const DRIP_PIX = 2;
export const WATER_PIX = DRIP_PIX + THROWN.length;
export function createWater(): WaterPix[] {
  return Array.from({ length: WATER_PIX }, () => ({ on: false, x: 0, y: 0, a: 0 }));
}

/** The shake's own clock: when the next one is due, when the last began (-1 for none), and how many have begun. */
export interface ShakeClock {
  n: number;
  nextShake: number;
  shakeFrom: number;
  /** False while it is not raining: the next shake is then scheduled afresh when rain shows. */
  armed: boolean;
}

export function createShakeClock(): ShakeClock {
  return { n: 0, nextShake: 0, shakeFrom: -1, armed: false };
}

/** The gap before shake number `n`, seconds: 45 to 75 from a fixed hash of `n`. */
export function shakeGap(n: number): number {
  const h = (Math.imul(n + 1, 2654435761) >>> 0) / 4294967296;
  return SHAKE_GAP_S[0] + (SHAKE_GAP_S[1] - SHAKE_GAP_S[0]) * h;
}

/** Seconds a shake takes from its start to the end of the fluffy spell. */
const SPELL_S = SHAKE_FRAMES * SHAKE_FRAME_S + FLUFFY_S;

/** True while a shake or the fluffy spell after it is on. */
export function shaking(T: number, c: ShakeClock): boolean {
  return c.shakeFrom >= 0 && T >= c.shakeFrom && T - c.shakeFrom < SPELL_S;
}

/**
 * Advance the shake clock. `active` is true while it rains and he is allowed to show it; `eligible`
 * is true while he stands in the idle pose with nothing else going on (the caller decides). Rain
 * that shows afresh schedules the first shake 45 to 75 seconds out; a shake that is due while he is
 * not eligible waits for the next eligible moment.
 */
export function stepShake(c: ShakeClock, T: number, eligible: boolean, active = true): void {
  if (!active) {
    c.armed = false;
    return;
  }
  if (!c.armed) {
    c.armed = true;
    c.nextShake = T + shakeGap(c.n);
    return;
  }
  if (T >= c.nextShake && eligible && !shaking(T, c)) {
    c.shakeFrom = T;
    c.n++;
    c.nextShake = T + shakeGap(c.n);
  }
}

/** The frame of the shake in progress, 0 up to `THROW_FRAMES - 1` (frames 0 to 3 move the wool), or -1 for none. */
export function shakeFrame(T: number, c: ShakeClock): number {
  if (c.shakeFrom < 0 || T < c.shakeFrom) return -1;
  const k = Math.floor((T - c.shakeFrom) / SHAKE_FRAME_S);
  return k < THROW_FRAMES ? k : -1;
}

/** The row shift of shake frame `k` (1 to 4 for frames 0 to 3), or 0 when the wool is not moving. */
export function shakeRows(k: number): RowShift {
  return k >= 0 && k < SHAKE_FRAMES ? ((k + 1) as RowShift) : 0;
}

/** True while the wool is fluffy: after the fourth shake frame, for `FLUFFY_S`. */
export function fluffyAt(T: number, c: ShakeClock): boolean {
  if (c.shakeFrom < 0) return false;
  const u = T - c.shakeFrom;
  return u >= SHAKE_FRAMES * SHAKE_FRAME_S && u < SPELL_S;
}

/**
 * Fill the two drip pixels for the drip at `T`: it hangs, falls a small pixel every 70 ms to the
 * ground row, then two small pixels spread either side at half strength for 140 ms. A drip whose
 * start cell has no pixel above it, or sits on a pixel itself (a leg), is skipped. `map` is the
 * pose's rows.
 */
export function dripAt(T: number, map: readonly string[], out: WaterPix[]): void {
  out[0].on = false;
  out[1].on = false;
  const n = Math.floor(T / DRIP_EVERY_S);
  const q = T - n * DRIP_EVERY_S;
  const spot = DRIPS[n % DRIPS.length];
  const c = spot[0];
  const r0 = spot[1];
  const above = map[r0 - 1]?.[c];
  const here = map[r0]?.[c];
  if (!above || above === '.' || (here !== undefined && here !== '.')) return;
  const ground = map.length * 2;
  const rowsDown = (map.length - r0) * 2;
  const a = out[0];
  if (q < DRIP_HANG_S) {
    a.on = true;
    a.x = c * 2;
    a.y = r0 * 2;
    a.a = DRIP_ALPHA;
    return;
  }
  const k = Math.floor((q - DRIP_HANG_S) / DRIP_STEP_S);
  if (k < rowsDown) {
    a.on = true;
    a.x = c * 2;
    a.y = r0 * 2 + k;
    a.a = DRIP_ALPHA;
  } else if (k < rowsDown + 2) {
    const b = out[1];
    a.on = true;
    a.x = c * 2 - 1;
    a.y = ground - 1;
    a.a = SPLASH_ALPHA;
    b.on = true;
    b.x = c * 2 + 1;
    b.y = ground - 1;
    b.a = SPLASH_ALPHA;
  }
}

/** Fill the thrown droplets for shake frame `k` (none before frame 1 or after frame 8); hides them all otherwise. */
export function thrownAt(k: number, out: WaterPix[]): void {
  for (let i = 0; i < THROWN.length; i++) {
    const p = out[DRIP_PIX + i];
    if (k < 1 || k >= THROW_FRAMES) {
      p.on = false;
      continue;
    }
    const d = THROWN[i];
    p.on = true;
    p.x = Math.round((d[0] + d[2] * k * 1.25) * 2);
    p.y = Math.round((d[1] + d[3] * k * 1.25 + 0.16 * k * k) * 2);
    p.a = k < 6 ? DRIP_ALPHA : DRIP_ALPHA / 2;
  }
}

/** The rest the loop may take for the weather: the soonest of these, or Infinity. A shake due and waiting for a calm moment is looked at again each second. */
export const WAIT_POLL_S = 1;
/** The least rest worth planning (a step already due is looked at at once). */
const LEAST_S = 0.005;

/**
 * How long his loop may sleep while it rains and he stands: the time to the next drip step (the
 * 70 ms steps while it falls, the end of the hang, the next drip), the end of a shake frame, the
 * end of the fluffy spell, or the next shake due, whichever comes first. Infinity when it is not
 * raining, or when reduced motion shows only colours (`active` false). `drips` is true when his
 * pose can show a drip; `rows` is his pose's row count.
 */
export function wetRestFor(T: number, c: ShakeClock, active: boolean, drips: boolean, rows: number): number {
  if (!active) return Infinity;
  let next = Infinity;
  const at = (s: number) => {
    if (s < next) next = Math.max(LEAST_S, s);
  };
  if (shaking(T, c)) {
    const u = T - c.shakeFrom;
    const k = Math.floor(u / SHAKE_FRAME_S);
    if (k < THROW_FRAMES) at((k + 1) * SHAKE_FRAME_S - u);
    at(SPELL_S - u);
  } else if (c.armed) {
    const due = c.nextShake - T;
    at(due > 0 ? due : WAIT_POLL_S);
  }
  if (drips) {
    const n = Math.floor(T / DRIP_EVERY_S);
    const q = T - n * DRIP_EVERY_S;
    const spot = DRIPS[n % DRIPS.length];
    const steps = (rows - spot[1]) * 2 + 2;
    if (q < DRIP_HANG_S) at(DRIP_HANG_S - q);
    else {
      const k = Math.floor((q - DRIP_HANG_S) / DRIP_STEP_S);
      at(k < steps ? DRIP_HANG_S + (k + 1) * DRIP_STEP_S - q : (n + 1) * DRIP_EVERY_S - T);
    }
  }
  return next;
}

/** Dev builds only: `?wattwx=drip|shake1..shake4|fluffy|lean` forces one weather frame of him in a review still (the stills). */
export interface WattWxForce {
  kind: 'drip' | 'shake' | 'fluffy' | 'lean';
  /** The shake frame, 0 to 3. */
  k: number;
}

export function parseWattWx(search: string): WattWxForce | null {
  const v = new URLSearchParams(search).get('wattwx') ?? '';
  if (v === 'drip' || v === 'fluffy' || v === 'lean') return { kind: v, k: 0 };
  const m = /^shake([1-4])$/.exec(v);
  return m ? { kind: 'shake', k: Number(m[1]) - 1 } : null;
}

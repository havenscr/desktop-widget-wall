import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/fitScale';
import { WALK_SPEED, spriteHeight, spriteWidth, type Walk } from './model';
import { REACT_S, bodyBox, createBox, propFits, type Box, type Mind, type PetFrame } from './petFrame';

/**
 * Carrying Watt: the owner presses on him, moves the pointer 6 px or more, and he is lifted by the
 * wool on his back, follows the pointer in a "held" pose, and is set down on the ground line of the
 * horizon band when the pointer is released. Everything here is pure and allocation free per frame:
 * the component keeps one `Carry` record and these functions write into it and into the frame.
 * `carry.test.ts` holds the rules.
 */

/** Movement in screen pixels that turns a press into a carry; below it, a release is a pet. */
export const GRAB_PX = 6;
/** A press longer than this is not a pet, milliseconds. */
export const PET_MAX_MS = 500;
/** He sits near where he was set down this long before he wanders on, seconds. */
export const SETTLE_S = 20;
/** Swirly eyes after a shake, seconds from landing. */
export const DIZZY_S = 3;
/** Squash on landing, seconds. */
export const LAND_S = 0.24;
/** The fall takes this long, by height (design pixels): 300 to 500 ms. */
export const FALL_MIN_S = 0.3;
export const FALL_MAX_S = 0.5;
export const FALL_FULL_PX = 400;
/** Shaking: this many direction changes, each from a swing of this many design pixels at this speed, inside this long. */
export const SHAKE_TURNS = 3;
export const SHAKE_SWING_PX = 36;
export const SHAKE_SPEED = 350;
export const SHAKE_WINDOW_S = 1;
/** Letting go this close to a clover (design pixels) feeds it to him. */
export const CLOVER_FEED_PX = 24;
/** He says his held line this long into a carry, seconds. */
export const HELD_LINE_AFTER_S = 1;
/** Carry lines (held, landed) come at most this often across carries, milliseconds; a dizzy line once a minute. */
export const CARRY_LINE_GAP_MS = 20_000;
export const DIZZY_LINE_GAP_MS = 60_000;
/** Where on his back he is held, as a fraction of the sprite box (facing right, so left of centre). */
const GRAB_FX = 0.38;
const GRAB_FY = 0.14;
/** How fast the grab offset settles onto the back of his wool, a rate a second. */
const GRAB_EASE = 14;
/** The most he tilts, degrees, and degrees per design pixel a second of pointer speed. */
const TILT_MAX = 14;
const TILT_PER_SPEED = 0.011;

export const NONE = 0;
export const HELD = 1;
export const FALL = 2;
export const LAND = 3;
export const SIT = 4;
export const RETURN = 5;

/** The carry, reused. Times are loop seconds (`T`). */
export interface Carry {
  mode: number;
  pointerId: number;
  /** The pointer in stage pixels, and where it was at the last step. */
  px: number;
  py: number;
  lastPx: number;
  /** The sprite's top left while held or falling, stage pixels. */
  x: number;
  y: number;
  /** Where the pointer sits on the sprite, easing to the back of his wool. */
  offX: number;
  offY: number;
  dir: 1 | -1;
  /** Pointer speed along x, design pixels a second, raw and smoothed. */
  vx: number;
  vxRaw: number;
  tilt: number;
  /** Shake: the way the pointer is going (-1, 0, 1), where that run began, and the recent turns' times. */
  trend: number;
  runX: number;
  turns: Float64Array;
  turnAt: number;
  peak: number;
  shaken: boolean;
  /** The fall. */
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  t0: number;
  dur: number;
  /** Landing, the end of the sit, and the end of the swirly eyes. */
  landT: number;
  settleUntil: number;
  dizzyUntil: number;
  squash: number;
  /** Speech: asked for (consumed by the component), and whether this carry may speak at all. */
  mayTalk: boolean;
  saidHeld: boolean;
  sayHeld: boolean;
  sayLanded: boolean;
  /** Set when the release came from an interruption rather than from the pointer. */
  interrupted: boolean;
  /** Letting go fed a clover: no landing line, the clover has its own. */
  fed: boolean;
  /** Stay: he sits where he was set down until it is switched off (the sit never ends). */
  stay: boolean;
  /** Where the walk back ends: NaN is his wander; a number is a place he was called to. */
  target: number;
  /** Set when a walk back arrives; the component reads and clears it. */
  arrived: boolean;
  /** Held across a place change: where (left edge x) he is set down once the new place is ready, else NaN. */
  pendingX: number;
  /** Wall clock seconds the landing started waiting (the loop's own time stops while he is away). */
  pendingT: number;
}

export function createCarry(): Carry {
  return {
    mode: NONE,
    pointerId: -1,
    px: 0,
    py: 0,
    lastPx: 0,
    x: 0,
    y: 0,
    offX: 0,
    offY: 0,
    dir: 1,
    vx: 0,
    vxRaw: 0,
    tilt: 0,
    trend: 0,
    runX: 0,
    turns: new Float64Array(SHAKE_TURNS).fill(-Infinity),
    turnAt: 0,
    peak: 0,
    shaken: false,
    fromX: 0,
    fromY: 0,
    toX: 0,
    toY: 0,
    t0: 0,
    dur: FALL_MIN_S,
    landT: 0,
    settleUntil: 0,
    dizzyUntil: 0,
    squash: 1,
    mayTalk: false,
    saidHeld: false,
    sayHeld: false,
    sayLanded: false,
    interrupted: false,
    fed: false,
    stay: false,
    target: Number.NaN,
    arrived: false,
    pendingX: Number.NaN,
    pendingT: 0,
  };
}

/** True while he is off the ground (held or falling). */
export function airborne(c: Carry): boolean {
  return c.mode === HELD || c.mode === FALL;
}

/** Forget a carry at once: no fall, no sit (a place change moves him anyway). */
export function cancelCarry(c: Carry): void {
  c.stay = false;
  c.target = Number.NaN;
  c.arrived = false;
  c.pendingX = Number.NaN;
  c.mode = NONE;
  c.pointerId = -1;
  c.sayHeld = false;
  c.sayLanded = false;
  c.tilt = 0;
  c.squash = 1;
}

/**
 * Lift him. `x` and `y` are the top left of the sprite as it stands (stage pixels), `px` the pixel
 * size, `bottom` the ground line, `(pointerX, pointerY)` the pointer. The held sprite is taller than
 * the standing one, so it is aligned by the feet. `mayTalk` says whether a carry line is allowed.
 */
export function beginCarry(c: Carry, id: number, pointerX: number, pointerY: number, x: number, bottom: number, dir: 1 | -1, size: number, T: number, mayTalk: boolean): void {
  c.mode = HELD;
  c.pendingX = Number.NaN;
  c.pointerId = id;
  c.px = pointerX;
  c.py = pointerY;
  c.lastPx = pointerX;
  c.x = x;
  c.y = bottom - spriteHeight('held', size);
  c.offX = pointerX - c.x;
  c.offY = pointerY - c.y;
  c.dir = dir;
  c.vx = 0;
  c.vxRaw = 0;
  c.tilt = 0;
  c.trend = 0;
  c.runX = pointerX;
  c.turns.fill(-Infinity);
  c.turnAt = 0;
  c.peak = 0;
  c.shaken = false;
  c.t0 = T;
  c.landT = 0;
  c.squash = 1;
  c.mayTalk = mayTalk;
  c.saidHeld = false;
  c.sayHeld = false;
  c.sayLanded = false;
  c.interrupted = false;
  c.fed = false;
}

/** The pointer moved (stage pixels). */
export function moveCarry(c: Carry, pointerX: number, pointerY: number): void {
  c.px = pointerX;
  c.py = pointerY;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const edge = createBox();

/**
 * Keep every part of him (props included) on the stage: `c.x` and `c.y` are the sprite's top left;
 * `f` carries the props the frame draws.
 */
function keepOnStage(c: Carry, f: Pick<PetFrame, 'prop' | 'scarf' | 'cosmetic'>, size: number): void {
  bodyBox({ pose: 'held', prop: f.prop, scarf: f.scarf, cosmetic: f.cosmetic }, c.dir, size, c.x, c.y, edge);
  if (edge.left < 0) c.x -= edge.left;
  if (edge.top < 0) c.y -= edge.top;
  if (edge.left + edge.width > STAGE_WIDTH) c.x -= edge.left + edge.width - STAGE_WIDTH;
  if (edge.top + edge.height > STAGE_HEIGHT) c.y -= edge.top + edge.height - STAGE_HEIGHT;
}

/** Where on the ground he lands for a sprite left edge `x`: the walk's span. */
export function landingX(walk: Walk, x: number): number {
  return clamp(x, walk.min, walk.max);
}

/**
 * Set him down (the pointer was released, or something interrupted the carry). He falls to the
 * ground line under him, at that x kept inside the walk's span. With `instant` (reduced motion, a
 * hidden page) he is simply there.
 */
export function releaseCarry(c: Carry, T: number, walk: Walk, hy: number, size: number, instant: boolean, interrupted: boolean): void {
  if (c.mode !== HELD) return;
  c.interrupted = interrupted;
  c.pointerId = -1;
  c.fromX = c.x;
  c.fromY = c.y;
  c.toX = landingX(walk, c.x);
  c.toY = hy - spriteHeight('held', size);
  c.sayHeld = false;
  c.sayLanded = !interrupted && !instant;
  if (instant) {
    land(c, T, hy, size);
    c.squash = 1;
    c.mode = SIT;
    c.sayLanded = !interrupted && !document.hidden;
    return;
  }
  const drop = Math.max(0, c.toY - c.y);
  c.dur = FALL_MIN_S + (FALL_MAX_S - FALL_MIN_S) * Math.min(1, drop / FALL_FULL_PX);
  c.t0 = T;
  c.mode = FALL;
}

function land(c: Carry, T: number, hy: number, size: number): void {
  c.x = c.toX;
  c.y = hy - spriteHeight('land', size);
  c.landT = T;
  c.mode = LAND;
  c.settleUntil = c.stay ? Infinity : T + SETTLE_S;
  c.dizzyUntil = c.shaken ? T + DIZZY_S : 0;
  c.tilt = 0;
}

/**
 * Advance the carry by `dt` seconds at loop time `T`. `homeX` is where his wander stands (he walks
 * back to it after the sit, with the wander clock paused); `still` (reduced motion) has him step
 * there at once. Held: ease the grab onto his back, follow the pointer, smooth the pointer's speed,
 * watch for shaking, and ask for his held line a moment in.
 */
export function stepCarry(c: Carry, dt: number, T: number, hy: number, size: number, homeX: number, still: boolean, f: Pick<PetFrame, 'prop' | 'scarf' | 'cosmetic'>): void {
  switch (c.mode) {
    case HELD: {
      const w = spriteWidth('held', size);
      const h = spriteHeight('held', size);
      const tx = (c.dir === 1 ? GRAB_FX : 1 - GRAB_FX) * w;
      const ty = GRAB_FY * h;
      const k = Math.min(1, dt * GRAB_EASE);
      c.offX += (tx - c.offX) * k;
      c.offY += (ty - c.offY) * k;
      c.x = c.px - c.offX;
      c.y = c.py - c.offY;
      keepOnStage(c, f, size);
      if (dt > 0) {
        const raw = (c.px - c.lastPx) / dt;
        c.vxRaw = raw;
        c.vx += (raw - c.vx) * Math.min(1, dt * 8);
        watchShake(c, T, raw);
      }
      c.lastPx = c.px;
      c.tilt = still ? 0 : clamp(-c.vx * TILT_PER_SPEED, -TILT_MAX, TILT_MAX);
      if (!c.saidHeld && c.mayTalk && T - c.t0 >= HELD_LINE_AFTER_S) {
        c.saidHeld = true;
        c.sayHeld = true;
      }
      return;
    }
    case FALL: {
      const k = Math.min(1, (T - c.t0) / c.dur);
      c.x = c.fromX + (c.toX - c.fromX) * (1 - (1 - k) * (1 - k));
      c.y = c.fromY + (c.toY - c.fromY) * k * k;
      c.tilt *= 1 - Math.min(1, dt * 10);
      if (k >= 1) land(c, T, hy, size);
      return;
    }
    case LAND: {
      const k = (T - c.landT) / LAND_S;
      c.squash = k >= 1 ? 1 : 1 - 0.2 * Math.sin(Math.PI * k);
      if (k >= 1) c.mode = SIT;
      return;
    }
    case SIT: {
      c.squash = 1;
      if (T >= c.settleUntil) {
        c.target = Number.NaN;
        c.mode = still ? NONE : RETURN;
        if (c.mode === RETURN) c.dir = homeX >= c.x ? 1 : -1;
      }
      return;
    }
    case RETURN: {
      const goal = c.target === c.target ? c.target : homeX;
      const d = goal - c.x;
      const step = WALK_SPEED * dt;
      if (Math.abs(d) <= Math.max(step, 0.5)) {
        c.x = goal;
        c.mode = c.stay ? SIT : NONE;
        c.arrived = true;
        if (c.stay) {
          c.landT = T;
          c.settleUntil = Infinity;
        }
      } else {
        c.x += Math.sign(d) * step;
        c.dir = d > 0 ? 1 : -1;
      }
      return;
    }
    default:
  }
}

/**
 * Shaking: the pointer swings one way, then the other, fast, three times inside a second. A turn
 * counts when the pointer reverses after a swing of at least `SHAKE_SWING_PX` at `SHAKE_SPEED`.
 */
function watchShake(c: Carry, T: number, raw: number): void {
  if (Math.abs(raw) < 40) return;
  const dirNow = raw > 0 ? 1 : -1;
  const speed = Math.abs(raw);
  if (c.trend === 0) {
    c.trend = dirNow;
    c.runX = c.lastPx;
    c.peak = speed;
    return;
  }
  if (dirNow === c.trend) {
    if (speed > c.peak) c.peak = speed;
    return;
  }
  // The pointer turned: a turn only counts after a real, fast swing.
  if (Math.abs(c.lastPx - c.runX) >= SHAKE_SWING_PX && c.peak >= SHAKE_SPEED) {
    c.turns[c.turnAt % SHAKE_TURNS] = T;
    c.turnAt += 1;
    if (c.turnAt >= SHAKE_TURNS && T - c.turns[c.turnAt % SHAKE_TURNS] <= SHAKE_WINDOW_S) c.shaken = true;
  }
  c.trend = dirNow;
  c.runX = c.lastPx;
  c.peak = speed;
}

/** The squash and tilt are written into the frame by `carryFrame`; this is the pose he shows. */
export function carryFrame(c: Carry, T: number, hy: number, size: number, still: boolean, m: Pick<Mind, 'react' | 'reactT' | 'lie'>, f: PetFrame): void {
  f.notes = false;
  f.z = false;
  f.hearts = false;
  f.tilt = 0;
  f.squash = 1;
  switch (c.mode) {
    case HELD:
    case FALL: {
      // The legs sway with a slow beat; under reduced motion one pose.
      f.pose = c.mode === HELD && !still && Math.floor(T * 3.3 + c.vx * 0.0015) % 2 !== 0 ? 'held2' : 'held';
      f.x = c.x;
      f.dir = c.dir;
      f.lift = hy - spriteHeight(f.pose, size) - c.y;
      f.tilt = still || Math.abs(c.tilt) < 0.05 ? 0 : Math.round(c.tilt * 10) / 10;
      break;
    }
    case LAND:
      f.pose = 'land';
      f.x = c.x;
      f.dir = c.dir;
      f.lift = 0;
      f.squash = still ? 1 : c.squash;
      break;
    case SIT:
    case RETURN: {
      const reacting = m.react !== null && m.reactT < REACT_S[m.react];
      if (reacting && c.mode === SIT) {
        // A pet, a hop, a spin or the clover: the reaction's own pose, lift and facing stay (petFrame wrote them).
        f.x = c.x;
        return;
      }
      f.x = c.x;
      f.lift = 0;
      f.dir = c.dir;
      if (c.mode === RETURN) {
        f.pose = !still && Math.floor(T * 5) % 2 ? 'walk' : 'idle';
        break;
      }
      const s = (T - c.landT) % 24;
      if (c.shaken && T < c.dizzyUntil) f.pose = 'dizzy';
      else if (m.lie) f.pose = 'lie';
      else if (s >= 13 && s < 16) f.pose = 'look';
      else {
        f.pose = 'sit';
        if (s >= 7 && s < 10) f.dir = (c.dir === 1 ? -1 : 1) as 1 | -1;
      }
      break;
    }
    default:
  }
  if (f.prop === 'book' && f.pose !== 'read') f.prop = null;
  if (f.prop && !propFits(f.prop, f.pose)) f.prop = null;
  if (f.scarf && !propFits('scarf', f.pose)) f.scarf = false;
  if (f.cosmetic && !propFits(f.cosmetic, f.pose)) f.cosmetic = null;
}

/**
 * Where a bubble goes while he is carried: beside his head, above him when there is room, kept on
 * the stage. Written into `out`.
 */
export function placeCarriedBubble(x: number, y: number, w: number, width: number, height: number, tail: number, out: Box): Box {
  out.width = width;
  out.height = height;
  const right = x + w + 14;
  out.left = right + width <= STAGE_WIDTH - 8 ? right : Math.max(8, x - 14 - width);
  out.top = clamp(y - height - tail, 8, STAGE_HEIGHT - height - tail - 8);
  return out;
}

/** Call him to `x` (the middle of his place): he walks there and the wander picks up from it. */
export function callCarry(c: Carry, T: number, x: number, dir: 1 | -1, to: number): void {
  c.mode = RETURN;
  c.x = x;
  c.dir = dir;
  c.target = to;
  c.arrived = false;
  c.landT = T;
  c.shaken = false;
  c.dizzyUntil = 0;
  c.squash = 1;
  c.tilt = 0;
}

/** Switch Stay on at `x`: he sits there, and the sit never ends until `endStay`. */
export function startStay(c: Carry, T: number, x: number, dir: 1 | -1): void {
  c.stay = true;
  if (c.mode === NONE || c.mode === RETURN) {
    c.mode = SIT;
    c.x = x;
    c.dir = dir;
    c.landT = T;
    c.shaken = false;
    c.dizzyUntil = 0;
    c.squash = 1;
    c.tilt = 0;
    c.target = Number.NaN;
  }
  if (c.mode === SIT || c.mode === LAND || c.mode === FALL) c.settleUntil = Infinity;
}

/** Switch Stay off: the sit ends now and he walks back to his wander. */
export function endStay(c: Carry, T: number): void {
  c.stay = false;
  if (c.mode === SIT || c.mode === LAND) c.settleUntil = T;
}

/**
 * A place change while he is held: the pointer is let go and the carry ends, but his x is kept so
 * he can be set down on the new place's ground line (see `landPending`).
 */
/** A landing that has waited this long for its place is given up, seconds. */
export const PENDING_S = 10;

export function deferCarry(c: Carry, T: number): void {
  const x = c.x;
  cancelCarry(c);
  c.pendingX = x;
  c.pendingT = T;
}

/** True when a waiting landing is too old, or it is his night: it is forgotten instead of happening later. */
export function pendingStale(c: Carry, T: number, night: boolean): boolean {
  return c.pendingX === c.pendingX && (night || T - c.pendingT > PENDING_S);
}

/** The new place is ready: set him down at once at the kept x, clamped to that place's walk span. */
export function landPending(c: Carry, T: number, walk: Walk, hy: number, size: number): void {
  c.mode = HELD;
  c.x = c.pendingX;
  c.y = hy - spriteHeight('held', size);
  c.pendingX = Number.NaN;
  releaseCarry(c, T, walk, hy, size, true, true);
}

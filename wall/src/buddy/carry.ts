import { STAGE_HEIGHT, STAGE_WIDTH } from '../stage/fitScale';
import { onGround, type Span } from './ground';
import { WALK_SPEED, spriteHeight, spriteWidth } from './model';
import { bodyBox, canBlink, createBox, propFits, reactLength, type Box, type Mind, type PetFrame } from './petFrame';

/**
 * Carrying Watt: the owner presses on him, moves the pointer 6 px or more, and he is lifted by the
 * wool on his back (a surprised frame, a stretch as the wool takes his weight, then a swing like a
 * pendulum), turns to face the way he is carried, and when the pointer is released drops straight
 * down onto the ground line under him, at the nearest free spot of the place's ground
 * (`ground.ts`), with a squash, dust and a shake of his wool. Everything here is pure and allocation free per frame:
 * the component keeps one `Carry` record and these functions write into it and into the frame.
 * `carry.test.ts` holds the rules.
 */

/** Movement in screen pixels that turns a press into a carry; below it, a release is a pet. */
export const GRAB_PX = 6;
/** A press longer than this is not a pet, milliseconds. */
export const PET_MAX_MS = 500;
/** He sits where he was set down this long before he wanders on around his new spot, seconds. */
export const SETTLE_S = 3.2;
/** After a landing he stands this long before he sits, seconds. */
export const SETTLE_STAND_S = 1.6;
/** Swirly eyes after a shake, seconds from landing. */
export const DIZZY_S = 3;
/** The landing (squash, rebound, dust and the shake of his wool), seconds; his landed line comes at its end. */
export const LAND_S = 0.8;
/** He falls under this gravity, design pixels a second squared, and takes at least this long. */
export const GRAVITY = 2600;
export const FALL_MIN_S = 0.12;
/** When the nearest free spot is not straight below, he drifts to it over this long while falling, seconds. */
export const SIDE_S = 0.25;
/** The surprised frame, then the stretch as the wool takes his weight, seconds from the pick-up. */
export const SURPRISE_S = 0.1;
export const STRETCH_S = 0.3;
/** Pointer speed (design pixels a second) that turns him to face the way he is carried, held this long. */
export const TURN_SPEED = 60;
export const TURN_S = 0.15;
/** Pointer speed over which his held line is a fast one. */
export const FAST_SPEED = 300;
/** Come here: he trots at this many times his walking pace. */
export const TROT = 3;
/** A move he cannot walk (to another stretch of ground, or far): he fades out and in, seconds. */
export const FADE_OUT_S = 0.4;
export const FADE_IN_S = 0.6;
/** Called further than this, he fades over rather than trotting, design pixels. */
export const TROT_MAX_PX = 600;
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
const TILT_MAX = 16;
const TILT_PER_SPEED = 0.012;
/** The pendulum: spring and damping of his swing, and the kick of the pick-up (degrees a second). */
const SWING_K = 90;
const SWING_D = 9;
const PICK_KICK = 60;

export const NONE = 0;
export const HELD = 1;
export const FALL = 2;
export const LAND = 3;
export const SIT = 4;
export const RETURN = 5;
/** Fading over to a spot he cannot walk to (Come here across Unwind's transport row). */
export const MOVE = 6;

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
  /** The swing's speed, degrees a second. */
  tiltV: number;
  /** How long the pointer has wanted him turned the other way, seconds. */
  turnT: number;
  /** The legs' phase (they pedal faster the faster he is carried). */
  legT: number;
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
  /** The held line asked for is a fast one ("whee"). */
  heldFast: boolean;
  sayLanded: boolean;
  /** This landing gets its line when the wool shake ends (not at the release). */
  landedLine: boolean;
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
  /** Walking pace multiplier (a trot when called). */
  speed: number;
  /** The fade of a move he cannot walk, 0 to 1 (1 is fully there), and when it began. */
  fade: number;
  moveT: number;
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
    tiltV: 0,
    turnT: 0,
    legT: 0,
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
    heldFast: false,
    sayLanded: false,
    landedLine: false,
    interrupted: false,
    fed: false,
    stay: false,
    target: Number.NaN,
    arrived: false,
    speed: 1,
    fade: 1,
    moveT: 0,
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
  c.landedLine = false;
  c.tilt = 0;
  c.tiltV = 0;
  c.squash = 1;
  c.fade = 1;
  c.speed = 1;
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
  c.tiltV = PICK_KICK * dir;
  c.turnT = 0;
  c.legT = 0;
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
  c.heldFast = false;
  c.sayLanded = false;
  c.landedLine = false;
  c.interrupted = false;
  c.fed = false;
  c.fade = 1;
  c.speed = 1;
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

/** Where on the ground he lands for a sprite left edge `x`: the nearest free spot of the place's ground. */
export function landingX(spans: readonly Span[], x: number): number {
  return onGround(spans, x);
}

/**
 * Set him down (the pointer was released, or something interrupted the carry). He drops straight
 * down onto the ground line, drifting sideways only when the nearest free spot is not below him.
 * With `instant` (reduced motion, a hidden page) he is simply there. His landed line is asked for
 * when the landing is over, never in the air.
 */
export function releaseCarry(c: Carry, T: number, spans: readonly Span[], hy: number, size: number, instant: boolean, interrupted: boolean): void {
  if (c.mode !== HELD) return;
  c.interrupted = interrupted;
  c.pointerId = -1;
  c.fromX = c.x;
  c.fromY = c.y;
  c.toX = landingX(spans, c.x);
  c.toY = hy - spriteHeight('held', size);
  c.sayHeld = false;
  c.sayLanded = false;
  c.landedLine = !interrupted && !instant;
  if (instant) {
    land(c, T, hy, size);
    c.squash = 1;
    c.mode = SIT;
    c.landT = T - LAND_S;
    c.sayLanded = !interrupted && !document.hidden;
    return;
  }
  const drop = c.toY - c.y;
  const side = Math.abs(c.toX - c.x) > 1 ? SIDE_S : 0;
  // Below the ground line (carried low), he hops up onto it.
  c.dur = drop >= 0 ? Math.max(FALL_MIN_S, Math.sqrt((2 * drop) / GRAVITY), side) : Math.max(0.2, side);
  c.t0 = T;
  c.mode = FALL;
}

function land(c: Carry, T: number, hy: number, size: number): void {
  c.x = c.toX;
  c.y = hy - spriteHeight('land', size);
  c.landT = T;
  c.mode = LAND;
  c.settleUntil = c.stay ? Infinity : T + LAND_S + SETTLE_S;
  c.dizzyUntil = c.shaken ? T + LAND_S + DIZZY_S : 0;
  c.tilt = 0;
  c.tiltV = 0;
}

const smooth = (k: number) => k * k * (3 - 2 * k);

/**
 * Advance the carry by `dt` seconds at loop time `T`. `homeX` is where his wander stands (he walks
 * back to it after the sit, with the wander clock paused); `still` (reduced motion) has him step
 * there at once. Held: ease the grab onto his back, follow the pointer, smooth the pointer's speed,
 * turn him to the way he is carried, swing him like a pendulum, watch for shaking, and ask for his
 * held line a moment in.
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
      if (still) {
        c.tilt = 0;
        c.tiltV = 0;
      } else {
        // The pendulum: a damped spring toward the lean the pointer's speed gives him.
        const target = clamp(-c.vx * TILT_PER_SPEED, -TILT_MAX, TILT_MAX);
        c.tiltV += (SWING_K * (target - c.tilt) - SWING_D * c.tiltV) * dt;
        c.tilt = clamp(c.tilt + c.tiltV * dt, -TILT_MAX, TILT_MAX);
        // He turns to face the way he is carried once the pointer has moved steadily for a moment.
        // Both the smoothed and the latest speed must agree, so a jerk then a stop does not turn him.
        const want = c.vx > TURN_SPEED && c.vxRaw > TURN_SPEED ? 1 : c.vx < -TURN_SPEED && c.vxRaw < -TURN_SPEED ? -1 : c.dir;
        if (want !== c.dir) {
          c.turnT += dt;
          if (c.turnT >= TURN_S) {
            c.dir = want;
            c.turnT = 0;
          }
        } else c.turnT = 0;
        c.legT += dt * (4 + Math.min(8, Math.abs(c.vx) / 40));
      }
      if (!c.saidHeld && c.mayTalk && T - c.t0 >= HELD_LINE_AFTER_S) {
        c.saidHeld = true;
        // Shaken, he says nothing now; the landing has the dizzy line.
        if (!c.shaken) {
          c.sayHeld = true;
          c.heldFast = Math.abs(c.vx) > FAST_SPEED;
        }
      }
      return;
    }
    case FALL: {
      const t = T - c.t0;
      const side = Math.abs(c.toX - c.fromX) > 1 ? Math.min(1, t / SIDE_S) : 1;
      c.x = c.fromX + (c.toX - c.fromX) * smooth(side);
      if (c.toY >= c.fromY) c.y = Math.min(c.toY, c.fromY + 0.5 * GRAVITY * t * t);
      else c.y = c.fromY + (c.toY - c.fromY) * smooth(Math.min(1, t / c.dur));
      c.tilt *= 1 - Math.min(1, dt * 10);
      if (t >= c.dur) land(c, T, hy, size);
      return;
    }
    case LAND: {
      const l = T - c.landT;
      c.squash = l < 0.17 ? 0.7 : l < 0.25 ? 1.08 : 1;
      if (l >= LAND_S) {
        c.mode = SIT;
        c.squash = 1;
        if (c.landedLine) {
          c.landedLine = false;
          c.sayLanded = true;
        }
      }
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
      const step = WALK_SPEED * c.speed * dt;
      if (Math.abs(d) <= Math.max(step, 0.5)) {
        c.x = goal;
        c.speed = 1;
        c.mode = c.stay ? SIT : NONE;
        c.arrived = true;
        if (c.stay) {
          c.landT = T - LAND_S;
          c.settleUntil = Infinity;
        }
      } else {
        c.x += Math.sign(d) * step;
        c.dir = d > 0 ? 1 : -1;
      }
      return;
    }
    case MOVE: {
      const t = T - c.moveT;
      if (t < FADE_OUT_S) c.fade = 1 - t / FADE_OUT_S;
      else {
        c.x = c.target;
        c.fade = Math.min(1, (t - FADE_OUT_S) / FADE_IN_S);
        if (t >= FADE_OUT_S + FADE_IN_S) {
          c.fade = 1;
          c.mode = NONE;
          c.arrived = true;
        }
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

/**
 * The pose he shows while carried, falling, landing, sitting where he was set down and walking
 * back, with the squash and stretch, the tilt, the tuft he is held by, the dust and his shadow on
 * the ground where he will land, written into the frame.
 */
export function carryFrame(c: Carry, T: number, hy: number, size: number, still: boolean, m: Pick<Mind, 'react' | 'reactT' | 'lie' | 'clickKind'>, f: PetFrame): void {
  f.notes = false;
  f.z = false;
  f.hearts = false;
  f.tilt = 0;
  f.squash = 1;
  f.sx = 1;
  f.tuft = false;
  f.dust = 0;
  f.shadow = 0;
  const blinked = f.blink;
  f.blink = false;
  switch (c.mode) {
    case HELD: {
      const t = T - c.t0;
      f.x = c.x;
      f.dir = c.dir;
      if (still) f.pose = 'held';
      else if (t < SURPRISE_S) f.pose = 'alert';
      else {
        // The legs pedal with the speed he is carried at.
        f.pose = Math.floor(c.legT) % 2 !== 0 ? 'held2' : 'held';
        f.tuft = true;
        if (t < STRETCH_S) {
          const e = Math.sin((Math.PI * (t - SURPRISE_S)) / (STRETCH_S - SURPRISE_S));
          f.squash = 1 + 0.14 * e;
          f.sx = 1 - 0.07 * e;
        }
      }
      f.lift = hy - spriteHeight(f.pose, size) - c.y;
      f.tilt = still || Math.abs(c.tilt) < 0.05 ? 0 : Math.round(c.tilt * 10) / 10;
      // Where he will land.
      f.shadow = still ? 0 : 0.6;
      f.shadowX = c.x;
      break;
    }
    case FALL: {
      const k = Math.min(1, (T - c.t0) / c.dur);
      f.pose = c.toY >= c.fromY ? 'land' : 'hop';
      f.x = c.x;
      f.dir = c.dir;
      f.lift = hy - spriteHeight(f.pose, size) - c.y;
      f.tilt = still || Math.abs(c.tilt) < 0.05 ? 0 : Math.round(c.tilt * 10) / 10;
      if (!still && f.pose === 'land') {
        // Stretched by the fall, legs out.
        f.squash = 1 + 0.12 * k;
        f.sx = 1 - 0.05 * k;
      }
      f.shadow = still ? 0 : 0.3 + 0.7 * k;
      f.shadowX = c.toX;
      break;
    }
    case LAND: {
      const l = T - c.landT;
      f.x = c.x;
      f.dir = c.dir;
      f.lift = 0;
      if (still) {
        f.pose = 'idle';
        break;
      }
      if (l < 0.17) {
        f.pose = 'land';
        f.squash = 0.7;
        f.sx = 1.2;
        f.dust = l / 0.17;
      } else if (l < 0.25) {
        f.pose = 'land';
        f.squash = 1.08;
        f.sx = 0.96;
        f.dust = 1;
      } else if (l < 0.42) {
        f.pose = 'idle';
        f.dust = 1 + (l - 0.25) / 0.17;
      } else {
        // The shake of his wool: eyes shut, a quick shiver either way.
        f.pose = c.shaken ? 'dizzy' : 'idle';
        f.blink = !c.shaken;
        f.x = c.x + (Math.floor(l * 20) % 2 ? 0.5 : -0.5) * size;
        f.sx = Math.floor(l * 20) % 2 ? 1.03 : 0.97;
      }
      break;
    }
    case SIT:
    case RETURN:
    case MOVE: {
      const reacting = m.react !== null && m.reactT < reactLength(m);
      if (reacting && c.mode === SIT) {
        // A pet, a hop, a spin, a noticed click or the clover: the reaction's own pose, lift and facing stay (petFrame wrote them).
        f.x = c.x;
        f.blink = blinked;
        return;
      }
      // His blink (petFrame's, on the loop clock) carries over to the pose he sits or walks in.
      f.blink = blinked;
      f.x = c.x;
      f.lift = 0;
      f.dir = c.dir;
      if (c.mode === RETURN) {
        f.pose = !still && Math.floor(T * (5 * c.speed)) % 2 ? 'walk' : 'idle';
        break;
      }
      if (c.mode === MOVE) {
        f.pose = 'idle';
        break;
      }
      // After the landing he stands a moment, then sits and looks about (swirly eyes after a shake).
      const s = T - c.landT - LAND_S;
      if (c.shaken && T < c.dizzyUntil) f.pose = 'dizzy';
      else if (m.lie) f.pose = 'lie';
      else if (!still && s < SETTLE_STAND_S) f.pose = 'idle';
      else {
        const r = s % 24;
        if (r >= 13 && r < 16) f.pose = 'look';
        else {
          f.pose = 'sit';
          if (r >= 7 && r < 10) f.dir = (c.dir === 1 ? -1 : 1) as 1 | -1;
        }
      }
      break;
    }
    default:
  }
  if (f.blink && !canBlink(f.pose)) f.blink = false;
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

/**
 * Call him to `to` (the middle of his place): he trots there when it is on the same stretch of
 * ground and near (`walkable`), else he fades out and in there. The wander then picks up from it.
 */
export function callCarry(c: Carry, T: number, x: number, dir: 1 | -1, to: number, walkable = true): void {
  c.mode = walkable ? RETURN : MOVE;
  c.x = x;
  c.dir = walkable ? dir : c.dir;
  c.target = to;
  c.arrived = false;
  c.landT = T;
  c.moveT = T;
  c.fade = 1;
  c.speed = TROT;
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
    // Told to stay, he sits down at once (no landing to stand up from).
    c.landT = T - LAND_S - SETTLE_STAND_S;
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

/** The new place is ready: set him down at once at the kept x, on that place's ground. */
export function landPending(c: Carry, T: number, spans: readonly Span[], hy: number, size: number): void {
  c.mode = HELD;
  c.x = c.pendingX;
  c.y = hy - spriteHeight('held', size);
  c.pendingX = Number.NaN;
  releaseCarry(c, T, spans, hy, size, true, true);
}

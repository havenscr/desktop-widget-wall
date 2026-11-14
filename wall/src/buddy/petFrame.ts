import { MAIN_LEFT, MAIN_WIDTH } from '../screens/frameLayout';
import { IDLES, STOPS, buddyFrame, createWander, spriteHeight, spriteWidth, wanderAt, type BuddyFrame, type Walk, type WanderPoint, type WattPlace } from './model';
import type { Cosmetic } from './pet';
import { CLOVER, EAR, MARK, PROP_SPRITES, SMALL_PX, SPRITES, propOrigin, type Pose, type Prop } from './sprites';

/**
 * Watt as a pet: what she wears, what she is doing about the wall, where her bubble, her amber mark
 * and a clover go. Pure and allocation free per frame: every function writes into a record it is
 * given. `petFrame.test.ts` and the overlap test in `model.test.ts` hold every pose, prop and the
 * bubble inside her walk's box.
 */

/** Short things she does about what happens, each with its length in seconds. */
export type ReactKind = 'hop' | 'pet' | 'look' | 'wake' | 'eat' | 'happy' | 'spin' | 'sparkle' | 'click' | 'rise';
/**
 * `click` is the longest a noticed click holds him (a near one; `CLICK_S` has each kind); `rise` is
 * getting up from a nap (a yawn and a stretch).
 */
export const REACT_S: Readonly<Record<ReactKind, number>> = { hop: 0.74, pet: 1.6, look: 8, wake: 6, eat: 4, happy: 2.4, spin: 0.8, sparkle: 2.4, click: 1.6, rise: 1.6 };

/** How far a click is from his head: near (within 320 px), mid (to 1000 px) or far. */
export type ClickKind = 'near' | 'mid' | 'far';
export const CLICK_NEAR_PX = 320;
export const CLICK_MID_PX = 1000;
/** How long each kind of noticed click holds his look, seconds. */
export const CLICK_S: Readonly<Record<ClickKind, number>> = { near: 1.6, mid: 1.1, far: 0.7 };
/** A burst of clicks is one reaction: nothing for this long after one, seconds. */
export const CLICK_GAP_S = 1.5;

/** The kind of a click at (`x`, `y`) for a sheep whose head is at (`hx`, `hy`), stage pixels. */
export function clickKind(x: number, y: number, hx: number, hy: number): ClickKind {
  const d = Math.hypot(x - hx, y - hy);
  return d < CLICK_NEAR_PX ? 'near' : d < CLICK_MID_PX ? 'mid' : 'far';
}

/**
 * A blink: one 120 ms frame with his eyes shut, every 3 to 7 seconds (`T` is the loop's seconds).
 * Pure: the blink times come from a small hash of each 5 second window.
 */
export function blinking(T: number): boolean {
  const at = blinkAt(Math.floor(T / BLINK_WINDOW_S));
  return T >= at && T < at + BLINK_S;
}
/** A blink lasts this long, seconds; one falls in each window of this many seconds. */
export const BLINK_S = 0.12;
const BLINK_WINDOW_S = 5;
function blinkAt(k: number): number {
  const h = Math.sin(k * 12.9898 + 78.233) * 43758.5453;
  return k * BLINK_WINDOW_S + 0.5 + (h - Math.floor(h)) * 3.8;
}
/** Seconds from `T` until a blink starts or, during one, ends. */
export function nextBlink(T: number): number {
  const k = Math.floor(T / BLINK_WINDOW_S);
  const at = blinkAt(k);
  if (T < at) return at - T;
  if (T < at + BLINK_S) return at + BLINK_S - T;
  return blinkAt(k + 1) - T;
}

/**
 * How long he can rest while he stands, seconds: 0 when something moves on every frame (a walk, a
 * reaction, drifting notes or z's, the firefly, the beat), else the time until the next planned
 * change of what is drawn (the end of a stand, a graze nibble, sitting down or standing up, a
 * yawn ending, a blink), or Infinity when nothing is planned. The frame loop sleeps that long on
 * one timer instead of drawing frames (`Watt.tsx`). `t` is his wander clock, `T` the loop clock;
 * `playing` is music on (notes drift).
 */
export function restFor(walk: Walk, t: number, T: number, night: boolean, playing: boolean, m: Mind): number {
  if (night || m.lie || m.nap || m.firefly || playing || m.bob > 0) return 0;
  if (m.react !== null && m.reactT < reactLength(m)) return 0;
  let next = Infinity;
  const at = (s: number) => {
    if (s > 1e-6 && s < next) next = s;
  };
  // The wander clock waits while he is held still (his menu open, a carry); nothing on it is due then.
  if (!holdsStill(m)) {
    const w = wanderAt(walk, t, scratch);
    if (w.moving) return 0;
    const stand = IDLES[w.stop];
    at(stand - w.into);
    at(3 - w.into);
    if (IDLES[w.stop] >= SETTLE_STOP_S) {
      at(SETTLE_FROM_S - w.into);
      at(stand - SETTLE_UP_S - w.into);
    }
    if (GRAZE_STOPS.includes(w.stop)) {
      if (w.into < GRAZE_FROM_S) at(GRAZE_FROM_S - w.into);
      else if (w.into < GRAZE_FROM_S + GRAZE_S) at(Math.min(GRAZE_FROM_S + GRAZE_S, (Math.floor(w.into * NIBBLE_HZ) + 1) / NIBBLE_HZ) - w.into);
    }
  }
  if (m.idleLife) at(nextBlink(T));
  return next;
}

/**
 * The idle life is calm: blink aside, one thing the eye notices every two to three minutes. In
 * each loop of his wander (about four and a half to five minutes) he grazes at one stop and settles
 * in at one: the longest stop (40 s). `model.test.ts` holds the cadence.
 */
/** Grazing: at this wander stop he lowers his head and nibbles for a few seconds. */
export const GRAZE_STOPS: readonly number[] = [6];
export const GRAZE_FROM_S = 5;
export const GRAZE_S = 6;
/** Settling in: at stops this long or longer he sits down after a while, and stands up before he walks on. */
export const SETTLE_STOP_S = 40;
export const SETTLE_FROM_S = 6;
export const SETTLE_UP_S = 3;
/** How often a graze nibble changes his pose, a second. */
export const NIBBLE_HZ = 3;

/** He notices the pointer when it is this close to him (design pixels). */
export const NOTICE_PX = 260;
/** ... and loses interest after the pointer has stayed still this long, seconds. */
export const NOTICE_S = 6;

/** A prop may stick out at most this many sprite pixels above her head row 0. */
export const PROP_RISE_MAX = 2;
/** Hearts show this long after a pet, seconds. */
export const HEARTS_S = 2.4;

/** What she knows this frame. Reused; the component fills it in place. */
export interface Mind {
  focus: boolean;
  rain: boolean;
  cold: boolean;
  /** Clear weather around midday. */
  sunny: boolean;
  /** Evening, the moon up: she looks up at it at some stops. */
  evening: boolean;
  sleepy: boolean;
  /** The display is idle by day: she naps where she stands. */
  nap: boolean;
  waiting: boolean;
  cosmetic: Cosmetic;
  /** The reaction running, its age in seconds and the way it faces (look). */
  react: ReactKind | null;
  reactT: number;
  reactDir: 1 | -1;
  /** 0 to 1: a soft squash on the beat, decaying. */
  bob: number;
  /** His card is open: he stands still so he does not walk under it. */
  held: boolean;
  /** The pointer moved within `NOTICE_S` seconds, and where it is (stage pixels). */
  pointerOn: boolean;
  pointerX: number;
  pointerY: number;
  /** A clover is on the ground: he is busy with it and does not look at the pointer. */
  clover: boolean;
  /** He is lying down for a nap (the Nap trick). */
  lie: boolean;
  /** A firefly drifts near him (between sunset and bedtime), and where it is (stage pixels). */
  firefly: boolean;
  fireflyX: number;
  fireflyY: number;
  /** He is being carried, falling, or sitting where he was set down: the wander clock waits (`carry.ts`). */
  carry: boolean;
  /** The loop's seconds (for the blink). */
  clock: number;
  /** Seconds since the Nap trick laid him down (he turns round, sits, then lies). */
  lieT: number;
  /** The way his menu is from him, while it is open (he looks up at it). */
  menuDir: 1 | -1;
  /** A noticed click: how far, and whether it was above him (he looks up). */
  clickKind: ClickKind;
  clickUp: boolean;
  /** The idle behaviours he does (blink, graze, settle): off in tests that hold his pose still. */
  idleLife: boolean;
}

export function createMind(): Mind {
  return {
    focus: false,
    rain: false,
    cold: false,
    sunny: false,
    evening: false,
    sleepy: false,
    nap: false,
    waiting: false,
    cosmetic: 'none',
    react: null,
    reactT: 0,
    reactDir: 1,
    bob: 0,
    held: false,
    carry: false,
    pointerOn: false,
    pointerX: 0,
    pointerY: 0,
    clover: false,
    lie: false,
    firefly: false,
    fireflyX: 0,
    fireflyY: 0,
    clock: 0,
    lieT: 0,
    menuDir: 1,
    clickKind: 'near',
    clickUp: false,
    idleLife: true,
  };
}

/** True while `m.react` is one that holds her still (the wander clock stops). */
export function holdsStill(m: Mind): boolean {
  return m.held || m.carry || m.lie || (m.react !== null && m.reactT < reactSpan(m));
}

/** What Watt draws this frame, beyond the base frame. Reused. */
export interface PetFrame extends BuddyFrame {
  /** The prop the day gives her (book, umbrella, headphones, sunglasses, nightcap), or null. */
  prop: Prop | null;
  scarf: boolean;
  /** The cosmetic, or null when none is chosen or it does not fit the pose. */
  cosmetic: Prop | null;
  /** Design pixels she is lifted (a hop). */
  lift: number;
  /** Vertical squash, 1 is none. */
  squash: number;
  /** Degrees he is tilted while carried (about his back), 0 otherwise. */
  tilt: number;
  hearts: boolean;
  /** A one-off sparkle (ten pets in a day). */
  sparkle: boolean;
  mark: boolean;
  /** Horizontal stretch, 1 is none (squash and stretch keep his volume: wider when flatter). */
  sx: number;
  /** His eyes shut for this frame. */
  blink: boolean;
  /** The wool he is held by (or flicked up), drawn above his back. */
  tuft: boolean;
  /** Dust at his feet: 0 none, up to 1 as it puffs out, 1 to 2 as it fades. */
  dust: number;
  /** His shadow on the ground where he will land (carried and falling): its opacity, and the sheep's left edge it is under. */
  shadow: number;
  shadowX: number;
}

export function createPetFrame(): PetFrame {
  return {
    x: 0,
    dir: 1,
    pose: 'idle',
    notes: false,
    z: false,
    prop: null,
    scarf: false,
    cosmetic: null,
    lift: 0,
    squash: 1,
    tilt: 0,
    hearts: false,
    sparkle: false,
    mark: false,
    sx: 1,
    blink: false,
    tuft: false,
    dust: 0,
    shadow: 0,
    shadowX: 0,
  };
}

/** Poses with open eyes that a blink can close. */
const BLINKABLE: ReadonlySet<Pose> = new Set<Pose>(['idle', 'walk', 'look', 'alert', 'sit', 'read', 'eat', 'held', 'held2']);
export function canBlink(pose: Pose): boolean {
  return BLINKABLE.has(pose);
}

/**
 * True when `prop` can be drawn on `pose`: it rises at most `PROP_RISE_MAX` sprite pixels above the
 * sprite, never hangs below her feet, and sticks out at most two pixels on either side.
 */
export function propFits(prop: Prop, pose: Pose): boolean {
  const s = PROP_SPRITES[prop];
  const [ox, oy] = propOrigin(prop, pose);
  const map = SPRITES[pose];
  return oy >= -PROP_RISE_MAX && oy + s.map.length <= map.length && ox >= -2 && ox + s.map[0].length <= map[0].length + 2;
}

/** Sprite pixels the drawn props rise above the sprite (0 when none do). */
export function propRise(f: Pick<PetFrame, 'pose' | 'prop' | 'scarf' | 'cosmetic'>): number {
  let rise = 0;
  const one = (p: Prop | null) => {
    if (p) rise = Math.max(rise, -propOrigin(p, f.pose)[1]);
  };
  one(f.prop);
  one(f.cosmetic);
  if (f.scarf) one('scarf');
  return rise;
}

const scratch = createWander();

/**
 * Watt this frame: the base frame (`buddyFrame`) on his wander clock `t`, then his reaction, his
 * standing pose (a book while focus runs, the moon in the evening, a yawn when sleepy, and the idle
 * life: grazing, settling in, a blink), his props, the hops (anticipation, stretch, squash and dust,
 * never lifting him or his props past the walk's ceiling), the beat squash, hearts and the amber
 * mark. `hy` is the ground line. With `still` (reduced motion) he keeps the base still pose and
 * position and nothing moves, but he still wears his props and shows his reaction pose.
 */
export function petFrame(walk: Walk, place: WattPlace, hy: number, night: boolean, t: number, playing: boolean, still: boolean, m: Mind, out: PetFrame): PetFrame {
  buddyFrame(walk, night, t, playing, still, out);
  out.prop = null;
  out.scarf = false;
  out.cosmetic = null;
  out.lift = 0;
  out.squash = 1;
  out.sx = 1;
  out.tilt = 0;
  out.hearts = false;
  out.sparkle = false;
  out.mark = false;
  out.blink = false;
  out.tuft = false;
  out.dust = 0;
  out.shadow = 0;
  const react = m.react !== null && m.reactT < reactLength(m) ? m.react : null;
  const len = react ? reactSpan(m) : 1;
  const k = react ? m.reactT / len : 0;
  let shaped = false;
  if (night) {
    out.prop = 'nightcap';
  } else if (m.lie) {
    lieDown(m.lieT, still, out);
  } else if (m.nap) {
    out.pose = 'sleep';
    out.z = !still;
    out.notes = false;
  } else {
    const w = still ? null : wanderAt(walk, t, scratch);
    const moving = w !== null && w.moving;
    if (react && k < 1 && react === 'look') {
      out.pose = 'look';
      out.dir = m.reactDir;
    } else if (react && k < 1 && react === 'wake') {
      out.pose = k < 0.5 ? 'yawn' : 'stretch';
    } else if (react && k < 1 && react === 'rise') {
      out.pose = still ? 'stretch' : m.reactT < 0.25 ? 'lie' : m.reactT < 0.95 ? 'yawn' : 'stretch';
    } else if (react && k < 1 && react === 'eat') {
      out.pose = 'eat';
    } else if (react && k < 1 && (react === 'spin' || react === 'happy' || react === 'hop')) {
      if (still) out.pose = react === 'hop' ? 'hop' : 'spin1';
      else {
        shape(react, m.reactT, out);
        shaped = true;
      }
    } else if (react && k < 1 && react === 'click') {
      out.dir = m.reactDir;
      if (!still) noticeClick(m.clickKind, m.clickUp, m.reactT, out);
    } else if (moving) {
      // Walking: the base frame already alternates idle and walk.
    } else if (m.focus) {
      out.pose = 'read';
    } else if (m.held) {
      // His menu is open above him: he looks up at it.
      out.pose = 'look';
      out.dir = m.menuDir;
    } else if (w && m.evening && w.stop % 2 === 1) {
      out.pose = 'look';
    } else if (w && m.sleepy && w.stop % 3 === 0 && w.into < 3) {
      out.pose = 'yawn';
    } else if (w && m.idleLife && !m.clover) {
      // The idle life on a long stand: he settles in (sits, and stands up before he walks on) or grazes.
      if (IDLES[w.stop] >= SETTLE_STOP_S && w.into >= SETTLE_FROM_S && w.into < IDLES[w.stop] - SETTLE_UP_S) out.pose = 'sit';
      else if (GRAZE_STOPS.includes(w.stop) && w.into >= GRAZE_FROM_S && w.into < GRAZE_FROM_S + GRAZE_S) out.pose = Math.floor(w.into * NIBBLE_HZ) % 3 === 0 ? 'idle' : 'eat';
    }
    // A firefly: he turns to watch it, head up, when he is standing about.
    if (!react && !still && m.firefly && !moving && !m.focus && !m.clover && !m.held && out.pose === 'idle') {
      out.dir = m.fireflyX >= out.x + spriteWidth('look', walk.px) / 2 ? 1 : -1;
      if (m.fireflyY < hy - spriteHeight('look', walk.px)) out.pose = 'look';
    }
    // He notices the pointer: faces it, ears up, when he is standing about with nothing on his mind.
    if (!react && !still && m.pointerOn && !moving && !m.focus && !m.clover && !m.held) {
      const dx = m.pointerX - (out.x + spriteWidth('alert', walk.px) / 2);
      const dy = m.pointerY - (hy - spriteHeight('alert', walk.px) / 2);
      if (dx * dx + dy * dy <= NOTICE_PX * NOTICE_PX) {
        out.pose = 'alert';
        out.dir = dx >= 0 ? 1 : -1;
      }
    }
    if (out.pose === 'read') out.prop = 'book';
    else if (m.rain) out.prop = 'umbrella';
    else if (place === 'unwind' && playing) out.prop = 'headphones';
    else if (m.sunny) out.prop = 'sunglasses';
    out.scarf = m.cold;
    if (react === 'pet') {
      out.hearts = !still || m.reactT < HEARTS_S;
      // A wiggle: he turns one way, then the other, then back.
      if (!still && k < 1) out.dir = (Math.floor(k * 4) % 2 === 0 ? out.dir : -out.dir) as 1 | -1;
    }
    // Hearts land with the happy hop.
    if (react === 'happy' && m.reactT >= 1.1) out.hearts = true;
    if (!still && m.idleLife && canBlink(out.pose) && blinking(m.clock)) out.blink = true;
  }
  out.sparkle = !night && react === 'sparkle' && k < 1;
  // The amber mark shows whatever he is doing, asleep included: something waits for him.
  out.mark = m.waiting;
  if (out.prop && !propFits(out.prop, out.pose)) out.prop = null;
  if (out.scarf && !propFits('scarf', out.pose)) out.scarf = false;
  if (m.cosmetic !== 'none' && propFits(m.cosmetic, out.pose)) out.cosmetic = m.cosmetic;
  if (shaped && out.lift > 0) {
    // Never past the ceiling: the hop height is the shape's, capped by the room above him.
    const top = hy - spriteHeight(out.pose, walk.px) - propRise(out) * walk.px;
    const room = Math.max(0, top - walk.ceiling);
    out.lift = Math.min(out.lift * walk.px, room);
  } else out.lift = 0;
  if (!still && !night && !m.nap && !shaped && out.squash === 1) out.squash = 1 - 0.05 * Math.max(0, Math.min(1, m.bob));
  return out;
}

/** How long the running reaction lasts (a noticed click by its kind; hearts outlast a pet). */
export function reactLength(m: Pick<Mind, 'react' | 'clickKind'>): number {
  if (m.react === null) return 0;
  if (m.react === 'pet') return Math.max(REACT_S.pet, HEARTS_S);
  return reactSpan(m);
}
function reactSpan(m: Pick<Mind, 'react' | 'clickKind'>): number {
  if (m.react === 'click') return CLICK_S[m.clickKind];
  return m.react === null ? 1 : REACT_S[m.react];
}

/**
 * The shaped moves (`t` seconds in), at pixel-art frame counts: poses step at about 10 frames a
 * second while the lift moves smoothly. Writes the pose, the facing, `lift` in sprite pixels (the
 * caller turns it into design pixels and caps it), the squash and stretch and the dust.
 * - hop: a crouch, a stretch up, a hop with the legs tucked, a squash with dust, a settle.
 * - spin: a crouch, then a true turn (side, front, other side, back, side) a little off the ground.
 * - happy: two stiff-legged bounces, the second with a turn, then hearts.
 */
export function shape(kind: 'hop' | 'spin' | 'happy', t: number, out: Pick<PetFrame, 'pose' | 'dir' | 'lift' | 'squash' | 'sx' | 'dust'>): void {
  const crouch = () => {
    out.squash = 0.86;
    out.sx = 1.08;
  };
  const land = (dust: number) => {
    out.squash = 0.84;
    out.sx = 1.1;
    out.dust = dust;
  };
  if (kind === 'hop') {
    if (t < 0.12) crouch();
    else if (t < 0.18) {
      out.squash = 1.12;
      out.sx = 0.94;
      out.lift = 0.25;
    } else if (t < 0.58) {
      out.pose = 'hop';
      out.lift = Math.sin((Math.PI * (t - 0.18)) / 0.4) * 5;
    } else if (t < 0.68) land(Math.min(1, (t - 0.58) / 0.1));
    else if (t < 0.74) {
      out.squash = 1.04;
      out.dust = 1 + (t - 0.68) / 0.06;
    }
    return;
  }
  if (kind === 'spin') {
    const dir = out.dir;
    if (t < 0.1) {
      out.squash = 0.9;
      out.sx = 1.05;
    } else if (t < 0.6) {
      const i = Math.min(4, Math.floor((t - 0.1) * 10));
      out.pose = i === 1 ? 'spin1' : i === 3 ? 'spin2' : 'idle';
      out.dir = (i === 2 ? -dir : dir) as 1 | -1;
      out.lift = Math.sin((Math.PI * (t - 0.1)) / 0.5) * 2;
    } else if (t < 0.7) {
      out.squash = 0.88;
      out.sx = 1.06;
    }
    return;
  }
  // The happy hop (a pronk).
  if (t < 0.1) crouch();
  else if (t < 0.46) {
    out.pose = 'hop';
    out.lift = Math.sin((Math.PI * (t - 0.1)) / 0.36) * 3;
  } else if (t < 0.56) land(0.5);
  else if (t < 1.06) {
    const turn: readonly Pose[] = ['hop', 'spin1', 'spin2', 'spin1', 'hop'];
    out.pose = turn[Math.min(4, Math.floor(((t - 0.56) / 0.5) * 5))];
    out.lift = Math.sin((Math.PI * (t - 0.56)) / 0.5) * 4.5;
  } else if (t < 1.14) land(Math.min(1, (t - 1.06) / 0.08));
  else if (t < 1.22) {
    out.squash = 1.04;
    out.dust = 1 + (t - 1.14) / 0.08;
  }
}

/**
 * The Nap trick, `t` seconds after it started: he turns round, sits, lies down, then breathes
 * slowly with drifting z's. Under reduced motion he simply lies there.
 */
export function lieDown(t: number, still: boolean, out: Pick<PetFrame, 'pose' | 'dir' | 'z' | 'notes' | 'squash'>): void {
  out.notes = false;
  if (still) {
    out.pose = 'lie';
    out.z = false;
    return;
  }
  if (t < 0.2) out.pose = 'idle';
  else if (t < 0.4) {
    out.pose = 'walk';
    out.dir = (-out.dir) as 1 | -1;
  } else if (t < 0.7) out.pose = 'idle';
  else if (t < 1) {
    out.pose = 'sit';
    out.squash = 1 - 0.06 * Math.sin((Math.PI * (t - 0.7)) / 0.3);
  } else {
    out.pose = 'lie';
    out.squash = 1 - 0.035 * (0.5 + 0.5 * Math.sin(((t - 1) * Math.PI) / 1.6));
  }
  out.z = t >= 1.5;
}

/**
 * A noticed click, `t` seconds in: he has already turned toward it. Near: a squash, then the wool
 * flicks up, ears up, and he holds the look (up at it when it was above him). Mid: ears up, the
 * look. Far: one ear frame, then a glance.
 */
export function noticeClick(kind: ClickKind, up: boolean, t: number, out: Pick<PetFrame, 'pose' | 'squash' | 'sx' | 'tuft'>): void {
  if (kind === 'far') {
    if (t < 0.14) out.pose = 'alert';
    return;
  }
  out.pose = up && t > 0.2 ? 'look' : 'alert';
  if (kind !== 'near') return;
  if (t < 0.1) {
    out.squash = 0.92;
    out.sx = 1.04;
  } else if (t < 0.22) {
    out.tuft = true;
    out.squash = 1.04;
  }
}

/** A box in stage pixels. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function createBox(): Box {
  return { left: 0, top: 0, width: 0, height: 0 };
}

/**
 * The box her props reach for the sheep at (`x`, `y`) facing `dir`, union with the sheep itself,
 * written into `out`. The flip is about the sheep's centre, as in the component.
 */
export function bodyBox(f: Pick<PetFrame, 'pose' | 'prop' | 'scarf' | 'cosmetic'>, dir: 1 | -1, px: number, x: number, y: number, out: Box = createBox()): Box {
  const map = SPRITES[f.pose];
  const cols = map[0].length;
  let l = 0;
  let r = cols;
  let t = 0;
  const one = (p: Prop | null) => {
    if (!p) return;
    const [ox, oy] = propOrigin(p, f.pose);
    const w = PROP_SPRITES[p].map[0].length;
    const a = dir === 1 ? ox : cols - ox - w;
    l = Math.min(l, a);
    r = Math.max(r, a + w);
    t = Math.min(t, oy);
  };
  one(f.prop);
  one(f.cosmetic);
  if (f.scarf) one('scarf');
  out.left = x + l * px;
  out.top = y + t * px;
  out.width = (r - l) * px;
  out.height = map.length * px - t * px;
  return out;
}

/** The amber mark beside her head: right of her body, a little below the top. Written into `out`. */
export function markBox(walk: Walk, x: number, y: number, w: number, out: Box = createBox()): Box {
  out.width = MARK[0].length * SMALL_PX;
  out.height = MARK.length * SMALL_PX;
  out.left = Math.min(x + w + 2 * walk.px + 4, walk.right - out.width);
  out.top = Math.max(walk.ceiling, y + walk.px);
  return out;
}

/** The clicked area round the mark (32 by 32) and round the clover (24 by 24). */
export const MARK_HIT = 32;
export const CLOVER_HIT = 24;

/**
 * A `size` square centred on `b`, kept inside the walk's band: not above the ceiling, not below
 * the ground line, not past the walk's right limit. Written into `out`.
 */
function hitAround(walk: Walk, hy: number, b: Box, size: number, out: Box): Box {
  const cx = b.left + b.width / 2;
  const cy = b.top + b.height / 2;
  out.width = size;
  out.height = size;
  out.left = Math.min(cx - size / 2, walk.right - size);
  out.top = Math.max(walk.ceiling, Math.min(cy - size / 2, hy - size));
  return out;
}

/** The mark's click box, from its drawn box `mark`. Written into `out`. */
export function markHitBox(walk: Walk, hy: number, mark: Box, out: Box = createBox()): Box {
  return hitAround(walk, hy, mark, MARK_HIT, out);
}

/** The clover's click box, from its drawn box `clover`. Written into `out`. */
export function cloverHitBox(walk: Walk, hy: number, clover: Box, out: Box = createBox()): Box {
  return hitAround(walk, hy, clover, CLOVER_HIT, out);
}

/**
 * Her two click boxes (body, then head), in sprite pixels from the sheep's top left, facing
 * `dir`: her visible shape rather than the whole sprite box with its empty corners. Written into
 * `body` and `head` (left, top, width, height in sprite pixels).
 */
export function hitParts(pose: Pose, dir: 1 | -1, body: Box, head: Box): void {
  const map = SPRITES[pose];
  const cols = map[0].length;
  const rows = map.length;
  const [ex, ey] = EAR[pose];
  body.left = 0;
  body.top = 1;
  body.width = ex;
  body.height = rows - 1;
  head.left = ex;
  head.top = ey;
  head.width = cols - ex;
  head.height = Math.min(5, rows - ey);
  if (dir === -1) {
    body.left = cols - body.left - body.width;
    head.left = cols - head.left - head.width;
  }
}

/** True when `b` (padded by `pad` on every side) overlaps any of `rects`, stage pixels. */
export function overlapsAny(b: Box, rects: readonly Box[], pad = 4): boolean {
  for (const r of rects) {
    if (b.left - pad < r.left + r.width && r.left < b.left + b.width + pad && b.top - pad < r.top + r.height && r.top < b.top + b.height + pad) return true;
  }
  return false;
}

/** His menu's width, design pixels (its height follows its content). */
export const MENU_W = 392;
/** Gap between the menu's tail and the top of his sprite, design pixels. */
export const MENU_GAP = 22;

/** Where his menu goes, and where its tail meets its bottom edge (from the menu's left). */
export interface MenuPlace extends Box {
  tail: number;
}

/**
 * Where his menu goes: a speech bubble above him, its tail pointing down at him, left aligned a
 * little left of his middle and kept inside the main area. It is a pop-up, so it may sit over the
 * cards above him while it is open; it never covers him. `top` is his sprite's top, `height` the
 * menu's measured height. Written into `out`.
 */
export function placeMenu(x: number, w: number, top: number, height: number, out: MenuPlace = { left: 0, top: 0, width: 0, height: 0, tail: 0 }): MenuPlace {
  out.width = MENU_W;
  out.height = height;
  const mid = x + w / 2;
  out.left = Math.max(MAIN_LEFT, Math.min(MAIN_LEFT + MAIN_WIDTH - MENU_W, mid - 40));
  out.top = Math.max(8, top - height - MENU_GAP);
  out.tail = Math.max(14, Math.min(MENU_W - 30, mid - out.left - 7));
  return out;
}

/** True when she stands at clover stop `stop` on her wander clock `t` (uses `wp`, no allocation). */
export function atClover(walk: Walk, t: number, stop: number, wp: WanderPoint): boolean {
  wanderAt(walk, t, wp);
  return !wp.moving && wp.stop === stop;
}

/** Where a clover grows: on the ground at stop `stop` of the walk (or beside her middle when still). */
export function cloverBox(walk: Walk, hy: number, stop: number, out: Box = createBox()): Box {
  const w = spriteWidth('idle', walk.px);
  out.width = CLOVER[0].length * SMALL_PX;
  out.height = CLOVER.length * SMALL_PX;
  const x = walk.min + STOPS[((stop % STOPS.length) + STOPS.length) % STOPS.length] * (walk.max - walk.min);
  // In front of her nose where she stands, so she bends straight into it.
  out.left = Math.min(x + w - 2 * walk.px, walk.right - out.width);
  out.top = hy - out.height;
  return out;
}

/** Speech bubble type: font size, padding, line height and the tail, design pixels. */
export const BUBBLE = { font: 14, padX: 10, padY: 6, line: 17, tail: 6 } as const;

/**
 * Advance widths of the printable ASCII characters (space to tilde) in the bubble's font, Oxanium
 * 600 at 14 px, measured in Chromium. The bubble's box is sized from these, so the box on screen is
 * the box the tests check.
 */
const ADVANCE: readonly number[] = [3.36,3.79,6.06,9.45,8.09,12.24,9.38,3.3,4.69,4.69,7.13,8.09,3.79,5.22,3.79,5.87,8.09,8.09,8.09,8.09,8.09,8.09,8.09,8.09,8.09,8.09,3.79,3.79,8.09,8.09,8.09,7.22,11.27,9.14,9.09,8.67,9.59,8.39,8.11,9.45,9.87,4.09,8.53,9.2,7.6,12.38,10.23,9.87,8.89,9.87,9.03,8.19,8.47,9.7,9,13.2,8.86,8.44,8.47,5.14,5.87,5.14,7.78,8.12,7,7.66,8.22,7.18,8.22,8.11,5.61,8.15,8.27,3.74,3.74,7.85,4.09,12.61,8.27,8.25,8.22,8.22,5.5,7.07,5.78,8.27,7.6,11.35,7.6,7.6,7.21,5.68,4.17,5.68,8.09];
/** The bubble's letter spacing (0.01 em), and a little slack for kerning and rounding. */
const SPACING = 0.14;
const SLACK = 1.04;

/** Width of `text` in the bubble's font, design pixels. */
export function textWidth(text: string): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i) - 32;
    w += (c >= 0 && c < ADVANCE.length ? ADVANCE[c] : 10) + SPACING;
  }
  return w * SLACK;
}

/**
 * Break `text` into lines that fit a bubble `maxW` design pixels wide, at spaces. A word longer than
 * a line is kept whole. The component draws these lines exactly (`white-space: pre`).
 */
export function wrapLine(text: string, maxW: number): string[] {
  const lines = greedy(text, maxW - 2 * BUBBLE.padX);
  if (lines.length < 2) return lines;
  // Balance the lines: the narrowest room that still needs no more lines (no lone last word).
  let lo = 0;
  let hi = maxW - 2 * BUBBLE.padX;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (greedy(text, mid).length <= lines.length) hi = mid;
    else lo = mid;
  }
  return greedy(text, hi);
}

function greedy(text: string, room: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    if (!cur) cur = word;
    else if (textWidth(cur + ' ' + word) <= room) cur += ' ' + word;
    else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** The size of a bubble holding `lines`, design pixels (the tail is below the box). */
export function bubbleSize(lines: readonly string[]): { width: number; height: number } {
  let longest = 0;
  for (const l of lines) longest = Math.max(longest, textWidth(l));
  return { width: Math.ceil(longest) + 2 * BUBBLE.padX, height: lines.length * BUBBLE.line + 2 * BUBBLE.padY };
}

/** Where the bubble sits, and which side its tail points from. Reused. */
export interface BubblePlace extends Box {
  /** True when the bubble is left of him (its tail on its right). */
  leftSide: boolean;
  /** False when it fits on neither side of him without covering him (a narrow stretch of ground): it is not shown. */
  fits: boolean;
}

export function createBubblePlace(): BubblePlace {
  return { left: 0, top: 0, width: 0, height: 0, leftSide: false, fits: true };
}

/**
 * Where a `width` by `height` bubble goes for the sheep at `x` (left edge) with body width `w` and
 * top `y`: beside her head, right of her when it fits before the walk's right limit, else left of
 * her (not past `bubbleLeft`); never above the ceiling, and the box plus its tail never below the
 * ground line. Written into `out`.
 */
export function placeBubble(walk: Walk, hy: number, x: number, y: number, w: number, width: number, height: number, out: BubblePlace = createBubblePlace()): BubblePlace {
  const gap = 3 * walk.px + 10;
  out.width = width;
  out.height = height;
  const right = x + w + gap;
  if (right + width <= walk.right) {
    out.left = right;
    out.leftSide = false;
    out.fits = true;
  } else {
    out.left = Math.max(walk.bubbleLeft, x - gap - width);
    out.leftSide = true;
    out.fits = x - gap - width >= walk.bubbleLeft;
  }
  out.top = Math.max(walk.ceiling + 2, Math.min(y, hy - height - BUBBLE.tail));
  return out;
}

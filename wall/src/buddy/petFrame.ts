import { MAIN_LEFT, MAIN_WIDTH } from '../screens/frameLayout';
import { STOPS, UNWIND_ROW, buddyFrame, createWander, spriteHeight, spriteWidth, wanderAt, type BuddyFrame, type Walk, type WanderPoint, type WattPlace } from './model';
import type { Cosmetic } from './pet';
import { CLOVER, EAR, MARK, PROP_SPRITES, SMALL_PX, SPRITES, propOrigin, type Pose, type Prop } from './sprites';

/**
 * Watt as a pet: what she wears, what she is doing about the wall, where her bubble, her amber mark
 * and a clover go. Pure and allocation free per frame: every function writes into a record it is
 * given. `petFrame.test.ts` and the overlap test in `model.test.ts` hold every pose, prop and the
 * bubble inside her walk's box.
 */

/** Short things she does about what happens, each with its length in seconds. */
export type ReactKind = 'hop' | 'pet' | 'look' | 'wake' | 'eat';
export const REACT_S: Readonly<Record<ReactKind, number>> = { hop: 0.7, pet: 1.6, look: 8, wake: 6, eat: 4 };

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
  /** Her card is open: she stands still so she does not walk under it. */
  held: boolean;
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
  };
}

/** True while `m.react` is one that holds her still (the wander clock stops). */
export function holdsStill(m: Mind): boolean {
  return m.held || (m.react !== null && m.reactT < REACT_S[m.react]);
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
  hearts: boolean;
  mark: boolean;
}

export function createPetFrame(): PetFrame {
  return { x: 0, dir: 1, pose: 'idle', notes: false, z: false, prop: null, scarf: false, cosmetic: null, lift: 0, squash: 1, hearts: false, mark: false };
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
 * Watt this frame: the base frame (`buddyFrame`) on her wander clock `t`, then her reaction, her
 * standing pose (a book while focus runs, the moon in the evening, a yawn when sleepy), her props,
 * a hop that never lifts her or her props past the walk's ceiling, the beat squash, hearts and the
 * amber mark. `hy` is the ground line. With `still` (reduced motion) she keeps the base still pose
 * and position and nothing moves, but she still wears her props and shows her reaction pose.
 */
export function petFrame(walk: Walk, place: WattPlace, hy: number, night: boolean, t: number, playing: boolean, still: boolean, m: Mind, out: PetFrame): PetFrame {
  buddyFrame(walk, night, t, playing, still, out);
  out.prop = null;
  out.scarf = false;
  out.cosmetic = null;
  out.lift = 0;
  out.squash = 1;
  out.hearts = false;
  out.mark = false;
  const react = m.react !== null && m.reactT < Math.max(REACT_S[m.react], m.react === 'pet' ? HEARTS_S : 0) ? m.react : null;
  const k = react ? m.reactT / REACT_S[react] : 0;
  if (night) {
    out.prop = 'nightcap';
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
    } else if (react && k < 1 && react === 'eat') {
      out.pose = 'eat';
    } else if (moving) {
      // Walking: the base frame already alternates idle and walk.
    } else if (m.focus) {
      out.pose = 'read';
    } else if (w && m.evening && w.stop % 2 === 1) {
      out.pose = 'look';
    } else if (w && m.sleepy && w.stop % 3 === 0 && w.into < 3) {
      out.pose = 'yawn';
    }
    if (out.pose === 'read') out.prop = 'book';
    else if (m.rain) out.prop = 'umbrella';
    else if (place === 'unwind' && playing) out.prop = 'headphones';
    else if (m.sunny) out.prop = 'sunglasses';
    out.scarf = m.cold;
    if (react === 'pet') {
      out.hearts = !still || m.reactT < HEARTS_S;
      // A wiggle: she turns one way, then the other, then back.
      if (!still && k < 1) out.dir = (Math.floor(k * 4) % 2 === 0 ? out.dir : -out.dir) as 1 | -1;
    }
  }
  // The amber mark shows whatever she is doing, asleep included: something waits for him.
  out.mark = m.waiting;
  if (out.prop && !propFits(out.prop, out.pose)) out.prop = null;
  if (out.scarf && !propFits('scarf', out.pose)) out.scarf = false;
  if (m.cosmetic !== 'none' && propFits(m.cosmetic, out.pose)) out.cosmetic = m.cosmetic;
  if (!still && !night && react === 'hop' && k < 1) {
    const top = hy - spriteHeight(out.pose, walk.px) - propRise(out) * walk.px;
    const room = Math.max(0, top - walk.ceiling);
    out.lift = Math.sin(Math.PI * k) * Math.min(walk.px * 1.5, room);
  }
  if (!still && !night && !m.nap) out.squash = 1 - 0.05 * Math.max(0, Math.min(1, m.bob));
  return out;
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

/** Her hover card's box, design pixels (the card is drawn at exactly this size). */
export const CARD_W = 660;
export const CARD_H = 74;

/**
 * Where her card goes: in the band over the horizon beside her on Work, Home and Meet (right of
 * her when it fits in the main area, else left), covering nothing but the horizon; on Unwind,
 * below the transport row, right of the Tomorrow block, over the empty floor. Written into `out`.
 */
export function placeCard(place: WattPlace, walk: Walk, x: number, w: number, out: Box = createBox()): Box {
  out.width = CARD_W;
  out.height = CARD_H;
  if (place === 'unwind') {
    out.left = UNWIND_ROW.left - 24;
    out.top = UNWIND_ROW.bottom + 8;
    return out;
  }
  out.top = walk.ceiling + 4;
  const right = x + w + 16;
  out.left = right + CARD_W <= MAIN_LEFT + MAIN_WIDTH ? right : Math.max(MAIN_LEFT, x - 16 - CARD_W);
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
  /** True when the bubble is left of her (its tail on its right). */
  leftSide: boolean;
}

export function createBubblePlace(): BubblePlace {
  return { left: 0, top: 0, width: 0, height: 0, leftSide: false };
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
  } else {
    out.left = Math.max(walk.bubbleLeft, x - gap - width);
    out.leftSide = true;
  }
  out.top = Math.max(walk.ceiling + 2, Math.min(y, hy - height - BUBBLE.tail));
  return out;
}

import { seatGround } from './ground';
import type { Pose } from './sprites';

/**
 * Watt at the drive-in. While Unwind's Watch tab plays something in the drive-in look, the Watch
 * store's `driveInAudience` gives the screen's rectangle in wall pixels; he walks to a seat on his
 * ground left of it, sits turned toward it and watches, and goes back to his spot when it ends.
 * Everything here is pure: the seat, what the show asks of him, and his seated poses on the loop
 * clock. `audience.test.ts` holds the rules.
 */

/** The screen's rectangle in wall (stage) pixels, as the selector gives it. */
export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * The seat's rules, all measured from the rectangle the Watch selector returns. His SPRITE (his real
 * seated width: his props are put away while he watches) keeps at least `SEAT_GAP` px from the
 * screen's left edge, and at least `SEAT_CLEARANCE` px from the nearest control at his height on
 * either side. The seat is the rightmost point that keeps both; with the screen at x 1244 and the
 * Look switch ending at x 1084 that is a left edge of 1106 (the owner's chosen picture). A seat
 * further than `SEAT_NEAR` px from the screen is no seat: he does not walk, he watches from where he
 * stands (see `Watt.tsx`).
 */
export const SEAT_GAP = 30;
export const SEAT_CLEARANCE = 22;
export const SEAT_NEAR = 300;

/** A stretch of the floor, x to x, that a control or card of the wall covers at his height. */
export interface Band {
  readonly x0: number;
  readonly x1: number;
}

/**
 * His seat (left edge x) for `screen`, `width` being his seated sprite's width, with the controls
 * at his height as `bands` (layout boxes: a faded control still takes its place). On the seat's own
 * ground (`seatGround`) the rightmost point that keeps the gap to the screen and the clearance to every
 * band; null when none lies within `SEAT_NEAR` of the screen.
 */
export function seatFor(screen: ScreenRect, bands: readonly Band[], width: number): number | null {
  const ground = seatGround(screen.x - SEAT_GAP - width)[0];
  if (!ground) return null;
  const lo = Math.max(ground.min, Math.ceil(screen.x - SEAT_NEAR - width));
  let x = Math.floor(ground.max);
  // A band over the spot moves the seat to its left side; a few passes settle bands that touch.
  for (let pass = 0; pass <= bands.length; pass++) {
    let moved = false;
    for (const b of bands) {
      if (x > b.x0 - width - SEAT_CLEARANCE && x < b.x1 + SEAT_CLEARANCE) {
        x = Math.floor(b.x0 - width - SEAT_CLEARANCE);
        moved = true;
      }
    }
    if (!moved) break;
  }
  if (x < lo || x > ground.max) return null;
  for (const b of bands) if (x > b.x0 - width - SEAT_CLEARANCE && x < b.x1 + SEAT_CLEARANCE) return null;
  return x;
}

/** The way he faces to watch from left edge `x` (sprite `width` wide): toward the screen's middle. */
export function facing(screen: ScreenRect, x: number, width: number): 1 | -1 {
  return screen.x + screen.w / 2 >= x + width / 2 ? 1 : -1;
}

/**
 * What the drive-in's marquee says is on (the Watch store's `driveInMarquee`): `none` when nothing
 * is chosen; `playing` and `paused` are a show; `waiting` is something chosen that has not started
 * (loading, waiting for a click, or the next item of a playlist); `ended` is a video that is over.
 */
export type Marquee = 'none' | 'playing' | 'paused' | 'waiting' | 'ended';

/**
 * What the show asks of him. The priority order, first match wins (`audience.test.ts` proves every
 * pair that can meet):
 * 1. no show: no screen (another look, nothing on), not on Unwind's Watch tab (a parked video is
 *    not a show), or the video ended: `off`;
 * 2. waiting: before the picture has played (loading, a click awaited) he is not at the show: `off`;
 *    while a show he is already at waits for its next item (a playlist, a pause for buffering) he
 *    keeps his seat: `hold`;
 * 3. a call: `off` (a call also stops the video);
 * 4. reading with him (a focus session running): `off`, he reads as he always does;
 * 5. the wall recording: `hold`, he sits quietly where he is and starts no walk;
 * 6. his menu open: `hold`, he stays put while it is open (the owner's commands come first);
 * 7. a nap the owner sent him to: `hold`, he finishes it lying where he is, then goes to the show;
 * 8. the owner's hand in this show (a pick-up, a drop, Come here, Stay): `hold`, he watches from
 *    where he was put, until this show ends;
 * 9. otherwise `watch`: he walks to his seat.
 * `hold` means he sits and watches where he is and starts no walk; `watch` walks him to the seat.
 * Underneath all of it, a carry in the air or a landing is always his own motion and wins over a
 * walk (`Watt.tsx`); the leave banner sits below his feet on Unwind and takes none of his ground.
 */
export type ShowRole = 'off' | 'hold' | 'watch';
export interface ShowInput {
  screen: ScreenRect | null;
  marquee: Marquee;
  onWatch: boolean;
  inCall: boolean;
  reading: boolean;
  recording: boolean;
  menuOpen: boolean;
  napping: boolean;
  /** He is already at this show (walking to the seat, or seated). */
  engaged: boolean;
  /** The owner put him somewhere during this show, or Stay is on. */
  pinned: boolean;
}
export function showRole(s: ShowInput): ShowRole {
  if (!s.screen || !s.onWatch || s.marquee === 'none' || s.marquee === 'ended') return 'off';
  if (s.marquee === 'waiting' && !s.engaged) return 'off';
  if (s.inCall) return 'off';
  if (s.reading) return 'off';
  if (s.marquee === 'waiting') return 'hold';
  if (s.recording || s.menuOpen || s.napping || s.pinned) return 'hold';
  return 'watch';
}

/**
 * One show's identity. `gen` counts the shows that have ended; the owner's hand (`hand`) belongs to
 * the show whose number it holds. A show is live while the marquee says playing or paused (and
 * through a wait inside it); it ends when the selector leaves it (the video stops or ends, the
 * owner leaves the Watch tab or Unwind). A call, reading and the wall recording do not end it.
 */
export interface ShowTrack {
  live: boolean;
  gen: number;
  hand: number;
}
export function newShowTrack(): ShowTrack {
  return { live: false, gen: 0, hand: -1 };
}
/** The marquee as the selectors give it now (with the stage in sight, else `none`). */
export function followShow(t: ShowTrack, marquee: Marquee): void {
  const live = marquee === 'playing' || marquee === 'paused' || (marquee === 'waiting' && t.live);
  if (t.live && !live) t.gen += 1;
  t.live = live;
}
/** The owner picks him up or sets him down: it counts for the show now live, and for no other. */
export function ownerTouched(t: ShowTrack): void {
  t.hand = t.live ? t.gen : -1;
}
/** True while the owner's hand holds him in the show now live. */
export function ownerPinned(t: ShowTrack): boolean {
  return t.live && t.hand === t.gen;
}

/**
 * His small signs of life while he watches: one every 20 to 40 seconds (sign `k` starts between
 * 20 + 30k and 30 + 30k seconds after he sat down), a blink, his ear laid back for a moment, a blink,
 * then a dip of his head (two pixels down to the plain sit and back up), in turn.
 */
export const LIFE_FIRST_S = 20;
export const LIFE_EVERY_S = 30;
export const LIFE_JITTER_S = 10;
export type LifeSign = 'blink' | 'ear' | 'tilt';
export const LIFE_ORDER: readonly LifeSign[] = ['blink', 'ear', 'blink', 'tilt'];
export const LIFE_S: Readonly<Record<LifeSign, number>> = { blink: 0.15, ear: 0.6, tilt: 1.4 };
/** Turned round to the viewer once when the video is paused, seconds. */
export const LOOK_ROUND_S = 2.4;

function lifeStart(k: number): number {
  const h = Math.sin(k * 91.17 + 7.31) * 24634.6345;
  return LIFE_FIRST_S + k * LIFE_EVERY_S + (h - Math.floor(h)) * LIFE_JITTER_S;
}
const lifeKind = (k: number): LifeSign => LIFE_ORDER[k % LIFE_ORDER.length];

/** The sign showing `t` seconds after he sat down, or null. */
export function lifeAt(t: number): LifeSign | null {
  if (t < LIFE_FIRST_S) return null;
  const k = Math.floor((t - LIFE_FIRST_S) / LIFE_EVERY_S);
  const at = lifeStart(k);
  const kind = lifeKind(k);
  return t >= at && t < at + LIFE_S[kind] ? kind : null;
}

/** What he looks like `t` seconds after he sat down, `look` seconds after a look round began. */
export interface WatchLook {
  pose: Pose;
  blink: boolean;
}
export function watchLook(t: number, look: number, still: boolean, quiet: boolean, out: WatchLook = { pose: 'watch', blink: false }): WatchLook {
  out.pose = 'watch';
  out.blink = false;
  if (still) return out;
  if (look >= 0 && look < LOOK_ROUND_S && !quiet) {
    out.pose = 'front';
    return out;
  }
  if (quiet) return out;
  const sign = lifeAt(t);
  if (sign === 'blink') out.blink = true;
  else if (sign === 'ear') out.pose = 'watchEar';
  else if (sign === 'tilt') out.pose = 'sit';
  return out;
}

/**
 * Seconds until his seated look next changes (`t` and `look` as in `watchLook`): the end of a look
 * round, else the start or end of the next sign of life. Infinity when nothing is planned (still,
 * or quiet with no look round).
 */
export function watchRestFor(t: number, look: number, still: boolean, quiet: boolean): number {
  if (still) return Infinity;
  if (look >= 0 && look < LOOK_ROUND_S && !quiet) return LOOK_ROUND_S - look;
  if (quiet) return Infinity;
  if (t < LIFE_FIRST_S) return lifeStart(0) - t;
  const k = Math.floor((t - LIFE_FIRST_S) / LIFE_EVERY_S);
  const at = lifeStart(k);
  if (t < at) return at - t;
  const end = at + LIFE_S[lifeKind(k)];
  if (t < end) return end - t;
  return lifeStart(k + 1) - t;
}

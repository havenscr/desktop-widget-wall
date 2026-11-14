import type { Span } from './ground';
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
 * The gap between his right side and the screen's left edge: the approved page's proportion (its
 * sheep ends 1.9 of the page's 27 screen units left of the screen), but never under 60 px, so he
 * stays clear of the frame's left leg and its stays.
 */
export const SEAT_GAP_K = 1.9 / 27;
export const SEAT_GAP_MIN = 60;

/** How far right of his left edge anything of his reaches while he sits: the sprite and two pixels of props. */
export function seatReach(px: number): number {
  return (18 + 2) * px;
}

/**
 * His seat (left edge x) for `screen` on the ground `spans`: left of the screen by the gap, on the
 * ground, and never nearer the screen than the gap. When the ground does not reach that far left
 * of the screen there is no seat (null): he watches from where he is.
 */
export function seatFor(screen: ScreenRect, spans: readonly Span[], px: number): number | null {
  const reach = seatReach(px);
  const gap = Math.max(SEAT_GAP_MIN, Math.round(screen.w * SEAT_GAP_K));
  const want = screen.x - gap - reach;
  let best: number | null = null;
  let bestD = Infinity;
  for (const s of spans) {
    const x = Math.min(s.max, Math.max(s.min, want));
    // The nearest point of this stretch is nearer the screen than the gap allows: not a seat.
    // (Every point of a span is a place he may stand; `ground.ts` measured them.)
    if (x > want + 0.5) continue;
    const d = Math.abs(x - want);
    if (d < bestD) {
      bestD = d;
      best = Math.floor(x);
    }
  }
  return best;
}

/** A stretch of the floor, x to x, that a control or card of the wall covers at his height. */
export interface Band {
  readonly x0: number;
  readonly x1: number;
}

/** Clear air kept between him and a control, px. */
export const BAND_MARGIN = 8;

/**
 * His ground with the stretches under `bands` taken out: his whole reach (`seatReach`) stays at
 * least `BAND_MARGIN` clear of every band, so he never sits over the Look switch, the control row or
 * a card. Spans that vanish are dropped.
 */
export function clearOf(spans: readonly Span[], bands: readonly Band[], px: number): Span[] {
  const reach = seatReach(px);
  let out: Span[] = spans.map((s) => ({ ...s }));
  for (const b of bands) {
    // His left edge may not lie in (x0 - reach - margin, x1 + margin).
    const lo = b.x0 - reach - BAND_MARGIN;
    const hi = b.x1 + BAND_MARGIN;
    const next: Span[] = [];
    for (const s of out) {
      if (s.max <= lo || s.min >= hi) {
        next.push(s);
        continue;
      }
      if (s.min <= lo) next.push({ ...s, max: lo });
      if (s.max >= hi) next.push({ ...s, min: hi });
    }
    out = next;
  }
  return out;
}

/** The way he faces to watch from left edge `x` (sprite `width` wide): toward the screen's middle. */
export function facing(screen: ScreenRect, x: number, width: number): 1 | -1 {
  return screen.x + screen.w / 2 >= x + width / 2 ? 1 : -1;
}

/**
 * What the show asks of him, in the order the wall's other rules come first:
 * 1. no show (nothing on in the drive-in look, or not on Unwind's Watch tab): `off`;
 * 2. a call: `off` (a call also stops the video);
 * 3. reading with him (a focus session running): `off`, he reads as he always does;
 * 4. the wall recording: `hold`, he sits quietly where he is and starts no walk;
 * 5. otherwise `watch`.
 * The leave banner comes before all of these through his ground: the seat is found on the ground
 * he has now (on Unwind the banner sits below his feet and takes none of it).
 * The owner's hand (a carry, Come here, Stay) is applied by the component: where the owner puts
 * him during a show, he stays and watches from there.
 */
export type ShowRole = 'off' | 'hold' | 'watch';
export interface ShowInput {
  screen: ScreenRect | null;
  onWatch: boolean;
  inCall: boolean;
  reading: boolean;
  recording: boolean;
}
export function showRole(s: ShowInput): ShowRole {
  if (!s.screen || !s.onWatch) return 'off';
  if (s.inCall) return 'off';
  if (s.reading) return 'off';
  if (s.recording) return 'hold';
  return 'watch';
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

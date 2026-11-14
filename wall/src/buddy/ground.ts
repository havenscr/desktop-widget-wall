import { WALKS, middle, type Walk, type WattPlace } from './model';

/**
 * Where Watt may be set down: the free ground of each place, as spans of his left edge. Letting
 * him go drops him straight down onto the ground line at the nearest x inside a span, he keeps
 * that spot (per place, in his stored record) and wanders a little around it.
 *
 * Each span is the free band between the panels and the ground line (on Work, Home and Meet the
 * band between the top row and the ribbon, the whole width of the main area), measured at 2560 by
 * 720 with every control and line of text of the place. `left` and `right` are the furthest any
 * part of him (props, notes, the mark, his bubble) may reach while he stands in the span.
 * `model.test.ts` checks every span against the panel rectangles. On a narrow stretch (Unwind's
 * left wing) a long line may fit on neither side of him at some spots; there he keeps it to himself
 * (`placeBubble` says so) rather than cover himself or a panel.
 */
export interface Span {
  /** Left edge range of the sheep. */
  min: number;
  max: number;
  /** Furthest left and right anything of his reaches. */
  left: number;
  right: number;
}

/**
 * Unwind on its Watch tab: the video (feathered or the drive-in screen) fills the centre from
 * about x 1150, so only the left part of the floor is his.
 */
export const WATCH_GROUND: readonly Span[] = [{ min: 140, max: 1020, left: 124, right: 1140 }];

export const GROUNDS: Readonly<Record<WattPlace, readonly Span[]>> = {
  work: [{ min: 140, max: 2420, left: 124, right: 2536 }],
  meet: [{ min: 140, max: 2420, left: 124, right: 2536 }],
  onair: [{ min: 140, max: 2420, left: 124, right: 2536 }],
  home: [{ min: 140, max: 2400, left: 124, right: 2536 }],
  // Listen: left of the transport row, and between the row (box to x 1402) and the Room card (x 2000).
  unwind: [
    { min: 140, max: 494, left: 124, right: 616 },
    { min: 1416, max: 1870, left: 1404, right: 1992 },
  ],
};

/**
 * The leave banner (`signals/LeaveBanner.tsx`) sits in the band above the ribbon on Home and Meet
 * (x 624 to 1914, y 528 to 578), where he walks: while it shows, his ground there goes round it.
 * (On Work it sits over the top band and on Unwind below his feet: neither ground changes.)
 */
export const BANNER = { left: 624, right: 1914, top: 528, bottom: 578 } as const;
export const BANNER_GROUND: Readonly<Record<'home' | 'meet', readonly Span[]>> = {
  home: [
    { min: 140, max: 516, left: 124, right: 616 },
    { min: 1932, max: 2400, left: 1922, right: 2536 },
  ],
  meet: [
    { min: 140, max: 536, left: 124, right: 616 },
    { min: 1930, max: 2420, left: 1922, right: 2536 },
  ],
};

/** The ground of a place now (Unwind's depends on its tab; Home's and Meet's on the leave banner). */
export function groundOf(place: WattPlace, watch: boolean, banner = false): readonly Span[] {
  if (place === 'unwind' && watch) return WATCH_GROUND;
  if (banner && (place === 'home' || place === 'meet')) return BANNER_GROUND[place];
  return GROUNDS[place];
}

/** How far he wanders either side of his spot, design pixels. */
export const WANDER_R: Readonly<Record<WattPlace, number>> = { work: 105, meet: 105, onair: 105, home: 110, unwind: 60 };

/** Where he stands on a place he was never set down on: the middle of the concept's walk. */
export function defaultSpot(place: WattPlace): number {
  return middle(WALKS[place]);
}

/** The index of the span holding `x`, else the nearest span. */
export function spanOf(spans: readonly Span[], x: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    const d = x < s.min ? s.min - x : x > s.max ? x - s.max : 0;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** The nearest x on the ground to `x` (unchanged when it is already on it). */
export function onGround(spans: readonly Span[], x: number): number {
  const s = spans[spanOf(spans, x)];
  return x < s.min ? s.min : x > s.max ? s.max : x;
}

/** True when `x` is on the ground. */
export function isOnGround(spans: readonly Span[], x: number): boolean {
  return onGround(spans, x) === x;
}

/** True when `a` and `b` are in the same span (he can walk from one to the other). */
export function sameSpan(spans: readonly Span[], a: number, b: number): boolean {
  return spanOf(spans, a) === spanOf(spans, b);
}

/**
 * The walk around `spot` on `place`: the wander range is up to `WANDER_R` either side, centred on
 * the spot and kept inside its span; everything else (pixel size, ceiling, bubble width) is the place's own, with the
 * reach limits of that span. Written into `out`.
 */
export function walkAround(place: WattPlace, spans: readonly Span[], spot: number, out: Walk = { ...WALKS[place] }): Walk {
  const base = WALKS[place];
  const s = spans[spanOf(spans, spot)];
  const at = onGround(spans, spot);
  // Centred on the spot (his wander starts where he was set down); a spot at a span's very end is
  // moved in by up to half the range, so he still has room to wander.
  const R = WANDER_R[place];
  const c = s.max - s.min < R ? (s.min + s.max) / 2 : Math.max(s.min + R / 2, Math.min(s.max - R / 2, at));
  const r = Math.max(0, Math.min(R, c - s.min, s.max - c));
  out.px = base.px;
  out.ceiling = base.ceiling;
  out.bubbleW = base.bubbleW;
  out.min = c - r;
  out.max = c + r;
  out.right = s.right;
  out.bubbleLeft = s.left + 4;
  return out;
}

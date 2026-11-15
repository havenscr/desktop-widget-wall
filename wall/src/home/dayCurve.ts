import { localMidnight, sunTimes } from '../ribbon/sun';
import { clockText, span, toMinute } from './sunLine';

/** The curve's drawing box, wall pixels: 458 wide for 24 hours, a 56 px hump, a 13 px dip. */
export const CURVE_W = 458;
export const CURVE_HUMP = 56;
export const CURVE_DIP = 13;
/** The base line's y inside the box, and the box's height. */
export const CURVE_BASE = CURVE_HUMP + 6;
export const CURVE_H = CURVE_BASE + CURVE_DIP + 8;
/** Gap between a label and its crossing, and the label's height. */
export const LABEL_GAP = 12;
const DAY_MS = 86_400_000;
/** The drawn curve is sampled every tenth of an hour. */
const STEP = 0.1 / 24;

export type SunPhase = 'before' | 'day' | 'after';

export interface CurveGeometry {
  /** x of the two crossings and of the sun, inside the box. */
  xRise: number;
  xSet: number;
  xSun: number;
  ySun: number;
  phase: SunPhase;
  /** Path data of the day hump, and of the two night parts. */
  day: string;
  nightBefore: string;
  nightAfter: string;
  /** The hump closed along the base, for its soft fill. */
  fill: string;
  /** How much of the day stroke is already travelled, as an x (0 before sunrise, xSet after sunset). */
  travelled: number;
}

/**
 * The day as one curve from midnight to midnight, all arguments fractions of the day (0 to 1).
 * Only the two crossings and the sun's x are data; the hump's height and the dip's depth are a
 * drawing. Above the base line while the sun is up, below it at night.
 */
export function curveGeometry(rise: number, set: number, now: number): CurveGeometry {
  const night = 1 - (set - rise);
  const x = (f: number) => CURVE_W * f;
  const y = (f: number) => {
    if (f >= rise && f <= set) return CURVE_BASE - CURVE_HUMP * Math.sin((Math.PI * (f - rise)) / (set - rise));
    return CURVE_BASE + CURVE_DIP * Math.sin((Math.PI * ((f < rise ? f + 1 : f) - set)) / night);
  };
  const pts = (a: number, b: number) => {
    const out: string[] = [];
    for (let f = a; f < b; f += STEP) out.push(`${x(f).toFixed(1)},${y(f).toFixed(1)}`);
    out.push(`${x(b).toFixed(1)},${y(b).toFixed(1)}`);
    return `M${out.join(' L')}`;
  };
  const phase: SunPhase = now < rise ? 'before' : now <= set ? 'day' : 'after';
  const xRise = x(rise);
  const xSet = x(set);
  const xSun = x(now);
  return {
    xRise,
    xSet,
    xSun,
    ySun: y(now),
    phase,
    day: pts(rise, set),
    nightBefore: pts(0, rise),
    nightAfter: pts(set, 1),
    fill: `${pts(rise, set)} Z`,
    travelled: phase === 'before' ? 0 : Math.min(xSet, xSun),
  };
}

export interface DayCurve extends CurveGeometry {
  riseText: string;
  setText: string;
  /** "9 h 20 min" */
  length: string;
  /** For a screen reader: the times and where the sun is. */
  alt: string;
  /** For the hover card. */
  tip: string;
}

/** The sun's place in words, from the fraction of the daylight that is gone. */
function place(phase: SunPhase, share: number): string {
  if (phase === 'before') return 'the sun has not risen yet';
  if (phase === 'after') return 'the sun has set';
  return share < 0.5 ? 'the sun is before its highest point' : 'the sun is past its highest point';
}

/**
 * Today's curve from the horizon's own sun, or null on a date with no sunrise or no sunset
 * (the headline then stands alone). Times are shown to the minute, as the headline's are.
 */
export function dayCurve(ms: number): DayCurve | null {
  const { rise, set } = sunTimes(ms);
  if (rise === null || set === null) return null;
  const start = localMidnight(ms);
  const end = localMidnight(start + DAY_MS + 3 * 3_600_000);
  const total = end - start;
  const frac = (t: number) => (t - start) / total;
  const r = toMinute(rise);
  const s = toMinute(set);
  const g = curveGeometry(frac(r), frac(s), frac(ms));
  const riseText = clockText(r);
  const setText = clockText(s);
  const length = span(s - r);
  const share = (ms - r) / (s - r);
  return {
    ...g,
    riseText,
    setText,
    length,
    alt: `Sunrise ${riseText}, sunset ${setText}, ${place(g.phase, share)}`,
    tip: `Sunrise ${riseText}, sunset ${setText}. ${length} of daylight today.`,
  };
}

export interface LabelSpot {
  /** Which edge `px` is measured from. */
  side: 'left' | 'right';
  px: number;
  /** True when the glyph is dropped so the text fits. */
  compact: boolean;
}

/** About how wide a label's time is at 18 px, and its glyph with the gap before the text. */
const CHAR_PX = 9.6;
const GLYPH_PX = 26;
const labelWidth = (text: string, compact: boolean) => text.length * CHAR_PX + (compact ? 0 : GLYPH_PX);

/**
 * Where the two labels sit: the sunrise label ends 12 px left of its crossing, the sunset label
 * starts 12 px right of its. On a long day a crossing is near an edge: the glyph is dropped, then
 * the label is held inside the box (it may then touch its crossing, never leave the box).
 */
export function labelSpots(xRise: number, xSet: number, riseText: string, setText: string): { rise: LabelSpot; set: LabelSpot } {
  const rise = ((): LabelSpot => {
    for (const compact of [false, true]) {
      const room = xRise - LABEL_GAP;
      if (room >= labelWidth(riseText, compact)) return { side: 'right', px: CURVE_W - xRise + LABEL_GAP, compact };
    }
    return { side: 'left', px: 0, compact: true };
  })();
  const set = ((): LabelSpot => {
    for (const compact of [false, true]) {
      const room = CURVE_W - (xSet + LABEL_GAP);
      if (room >= labelWidth(setText, compact)) return { side: 'left', px: xSet + LABEL_GAP, compact };
    }
    return { side: 'right', px: 0, compact: true };
  })();
  return { rise, set };
}

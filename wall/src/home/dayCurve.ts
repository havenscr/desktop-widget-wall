import { sunTimes } from '../ribbon/sun';
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
 * The curve's height (y inside the box) as a function of the day fraction, for sunrise `rise` and
 * sunset `set`. One smooth line: four cubic segments (sunrise to noon, noon to sunset, sunset to
 * the night low, the night low to the next sunrise) that meet with the same slope, so the line
 * passes through each crossing with no corner. The slope at a crossing is the monotone-cubic
 * (Fritsch and Carlson) mean of the two secants, so a segment never overshoots its end heights:
 * the hump stays at 56 px at noon and the dip at 13 px at the middle of the night, whatever the day's length.
 * The line is at the base line exactly at `rise` and `set`.
 */
export function curveY(rise: number, set: number): (f: number) => number {
  const W = CURVE_W;
  const hDay = ((set - rise) / 2) * W;
  const hNight = ((1 - (set - rise)) / 2) * W;
  const sDay = CURVE_HUMP / hDay;
  const sNight = CURVE_DIP / hNight;
  /** The weighted harmonic mean of the secants either side of a crossing (positive, at most 3 times the smaller secant). */
  const cross = (hBefore: number, sBefore: number, hAfter: number, sAfter: number) => {
    const w1 = 2 * hAfter + hBefore;
    const w2 = hAfter + 2 * hBefore;
    return (w1 + w2) / (w1 / sBefore + w2 / sAfter);
  };
  const mRise = cross(hNight, sNight, hDay, sDay);
  const mSet = cross(hDay, sDay, hNight, sNight);
  const noon = (rise + set) / 2;
  const low = (set + rise + 1) / 2;
  // Each segment: x0, x1 as day fractions (the night runs past 1), y0, y1 and the slopes at its ends (dy/dx in px).
  const segs = [
    { x0: rise, x1: noon, y0: CURVE_BASE, y1: CURVE_BASE - CURVE_HUMP, m0: -mRise, m1: 0 },
    { x0: noon, x1: set, y0: CURVE_BASE - CURVE_HUMP, y1: CURVE_BASE, m0: 0, m1: mSet },
    { x0: set, x1: low, y0: CURVE_BASE, y1: CURVE_BASE + CURVE_DIP, m0: mSet, m1: 0 },
    { x0: low, x1: rise + 1, y0: CURVE_BASE + CURVE_DIP, y1: CURVE_BASE, m0: 0, m1: -mRise },
  ];
  return (f: number) => {
    const u = f < rise ? f + 1 : f;
    const g = segs.find((q) => u <= q.x1) ?? segs[3]!;
    const h = (g.x1 - g.x0) * W;
    const t = Math.min(1, Math.max(0, (u - g.x0) / (g.x1 - g.x0)));
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * g.y0 + (t3 - 2 * t2 + t) * h * g.m0 + (-2 * t3 + 3 * t2) * g.y1 + (t3 - t2) * h * g.m1;
  };
}

/**
 * The day as one curve from midnight to midnight, all arguments fractions of the day (0 to 1).
 * Only the two crossings and the sun's x are data; the hump's height and the dip's depth are a
 * drawing. Above the base line while the sun is up, below it at night.
 */
export function curveGeometry(rise: number, set: number, now: number, raw: { rise: number; set: number } = { rise, set }): CurveGeometry {
  const x = (f: number) => CURVE_W * f;
  const y = curveY(rise, set);
  const pts = (a: number, b: number) => {
    const out: string[] = [];
    for (let f = a; f < b; f += STEP) out.push(`${x(f).toFixed(1)},${y(f).toFixed(1)}`);
    out.push(`${x(b).toFixed(1)},${y(b).toFixed(1)}`);
    return `M${out.join(' L')}`;
  };
  // The phase follows the exact crossings (as the headline does); only what is drawn and labelled is rounded to the minute.
  const phase: SunPhase = now < raw.rise ? 'before' : now < raw.set ? 'day' : 'after';
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

/** The local clock time of `ms` as a fraction of a 24 hour face (the face of a clock, whatever the day's true length). */
function clockFraction(ms: number): number {
  const d = new Date(ms);
  return (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000) / 86_400;
}

/**
 * Today's curve from the horizon's own sun, or null on a date with no sunrise or no sunset, or
 * with the sunset not after the sunrise (the headline then stands alone). Times are shown to the
 * minute, as the headline's are. x is the local clock time on a fixed 24 hour face, so on a 23 or 25
 * hour day noon is still the middle and each crossing sits at its displayed time (the repeated
 * autumn hour overlaps itself).
 */
export function dayCurve(ms: number): DayCurve | null {
  const { rise, set } = sunTimes(ms);
  if (rise === null || set === null || set <= rise) return null;
  const r = toMinute(rise);
  const s = toMinute(set);
  const fr = clockFraction(r);
  const fs = clockFraction(s);
  if (fs <= fr) return null;
  const g = curveGeometry(fr, fs, clockFraction(ms), { rise: clockFraction(rise), set: clockFraction(set) });
  const riseText = clockText(r);
  const setText = clockText(s);
  const length = span(s - r);
  const share = (ms - rise) / (set - rise);
  return {
    ...g,
    riseText,
    setText,
    length,
    alt: `Sunrise ${riseText}, sunset ${setText}, ${place(g.phase, share)}`,
    tip: `Sunrise ${riseText}, sunset ${setText}. ${length} of daylight today.`,
  };
}

/** How much of a label is drawn: glyph and time, the time alone, or the time without AM or PM. */
export type LabelForm = 'full' | 'plain' | 'short';

export interface LabelSpot {
  /** Which edge `px` is measured from. */
  side: 'left' | 'right';
  px: number;
  form: LabelForm;
}

/** About how wide a label's time is at 18 px, and its glyph with the gap before the text. */
const CHAR_PX = 9.6;
const GLYPH_PX = 26;
const FORMS: LabelForm[] = ['full', 'plain', 'short'];

/** The time as the label draws it in each form ("7:13 AM", "7:13"). */
export const labelText = (text: string, form: LabelForm) => (form === 'short' ? text.replace(/ [AP]M$/, '') : text);
const labelWidth = (text: string, form: LabelForm) => labelText(text, form).length * CHAR_PX + (form === 'full' ? GLYPH_PX : 0);

/**
 * Where the two labels sit: the sunrise label ends 12 px left of its crossing, the sunset label
 * starts 12 px right of its. On a long day a crossing is near an edge: first the glyph is dropped,
 * then the AM or PM (the hover card and the text alternative keep the whole time); the labels
 * always fit between their crossing and the box's edge.
 */
export function labelSpots(xRise: number, xSet: number, riseText: string, setText: string): { rise: LabelSpot; set: LabelSpot } {
  const rise = ((): LabelSpot => {
    for (const form of FORMS) {
      if (xRise - LABEL_GAP >= labelWidth(riseText, form)) return { side: 'right', px: CURVE_W - xRise + LABEL_GAP, form };
    }
    return { side: 'left', px: 0, form: 'short' };
  })();
  const set = ((): LabelSpot => {
    for (const form of FORMS) {
      if (CURVE_W - (xSet + LABEL_GAP) >= labelWidth(setText, form)) return { side: 'left', px: xSet + LABEL_GAP, form };
    }
    return { side: 'right', px: 0, form: 'short' };
  })();
  return { rise, set };
}

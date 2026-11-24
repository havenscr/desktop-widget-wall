import { pal, sun } from '../horizon/renderer';
import type { PlaceId } from '../state/places';
import type { SkyStyle } from './settings';

/** Colours here are 0 to 1 per channel. */
export type Rgb = readonly [number, number, number];

const CY: Rgb = [0.21, 0.9, 0.92];
const VI: Rgb = [0.6, 0.48, 1];
const MG: Rgb = [1, 0.24, 0.6];
const AM: Rgb = [1, 0.76, 0.3];
const GR: Rgb = [0.36, 0.95, 0.71];
const BL: Rgb = [0.36, 0.77, 1];
const LI: Rgb = [0.75, 0.7, 1];

interface Hour {
  /** The sun's altitude (degrees) this stop sits at. */
  alt: number;
  /** The palette gain here: the faintest at noon, where the day sky leaves little room. */
  gain: number;
  wash: readonly [Rgb, Rgb, Rgb];
  aurora: readonly [Rgb, Rgb, Rgb];
}
/** Night, the twilight hours (sunset and sunrise alike) and the bright day, from the prototypes the owner picked from. */
const NIGHT: Hour = { alt: -14, gain: 0.9, wash: [CY, VI, MG], aurora: [GR, CY, VI] };
const TWILIGHT: Hour = { alt: -2, gain: 0.75, wash: [AM, MG, VI], aurora: [AM, MG, VI] };
const DAY: Hour = { alt: 10, gain: 0.62, wash: [BL, CY, LI], aurora: [CY, BL, LI] };

/** How far the hour's own sky (`pal`, the colour at the horizon) tints the three colours. */
const TINT = 0.2;

/** What the shader is given: three colours and the gain of the hour. Filled in place, so a refresh allocates nothing. */
export interface SkyColours {
  a: [number, number, number];
  b: [number, number, number];
  c: [number, number, number];
  gain: number;
}
export function createSkyColours(): SkyColours {
  return { a: [0, 0, 0], b: [0, 0, 0], c: [0, 0, 0], gain: 0 };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/** The two stops either side of the sun's altitude and how far along between them (0 to 1). */
function between(alt: number): { lo: Hour; hi: Hour; k: number } {
  if (alt <= NIGHT.alt) return { lo: NIGHT, hi: NIGHT, k: 0 };
  if (alt >= DAY.alt) return { lo: DAY, hi: DAY, k: 0 };
  if (alt < TWILIGHT.alt) return { lo: NIGHT, hi: TWILIGHT, k: smooth((alt - NIGHT.alt) / (TWILIGHT.alt - NIGHT.alt)) };
  return { lo: TWILIGHT, hi: DAY, k: smooth((alt - TWILIGHT.alt) / (DAY.alt - TWILIGHT.alt)) };
}

/**
 * The animated sky's colours at wall time `ms` for `style`, written into `out`. Night gives the
 * strongest sky, bright noon the faintest. The sun is read through the renderer's own `sun`, so
 * the sky is the hour the horizon is drawing.
 */
export function skyColoursAt(ms: number, style: SkyStyle, out: SkyColours): SkyColours {
  const s = sun(ms);
  return skyColoursForAlt(s.alt, s.az > 180, style, out);
}

/** The same for a given sun altitude (degrees) and the evening flag: Sundown's sky clock and the tests use it. */
export function skyColoursForAlt(alt: number, eve: boolean, style: SkyStyle, out: SkyColours): SkyColours {
  const { lo, hi, k } = between(alt);
  const horizon = pal(alt, eve).s[3] as number[];
  const from = lo[style];
  const to = hi[style];
  const dst = [out.a, out.b, out.c];
  for (let i = 0; i < 3; i++) {
    for (let ch = 0; ch < 3; ch++) {
      const mixed = from[i][ch] + (to[i][ch] - from[i][ch]) * k;
      dst[i][ch] = mixed + (horizon[ch] / 255 - mixed) * TINT;
    }
  }
  out.gain = lo.gain + (hi.gain - lo.gain) * k;
  return out;
}

/**
 * A page's own ceiling on the gain, in code, on top of the hour's: a page of cards shows the sky
 * only in the gaps between them. These are ceilings to tune down on the real monitor, not targets.
 */
export function pageGain(place: PlaceId): number {
  switch (place) {
    case 'zen':
      return 1;
    case 'unwind':
      return 0.6;
    case 'home':
      return 0.45;
    default:
      return 0.35;
  }
}

/** The place veil's strength over the sky (`frame.css`): the top 64% of the stage, where text sits straight on the sky. */
export function veilFor(place: PlaceId): number {
  switch (place) {
    case 'home':
      return 0.36;
    case 'unwind':
      return 0.1;
    case 'zen':
      return 0;
    default:
      return 0.52;
  }
}

/**
 * The shader's soft brightness ceiling per channel (see `shader.ts`, which reads the same number):
 * however the drift folds, no patch of the sky can be brighter than this.
 */
export const SHADER_CAP = 0.55;
/**
 * The brightest raw value the fields reach before the gain and the ceiling. The fields' own sum
 * can touch about 2.9, but the noise they are made of never gets near it: this is the peak seen
 * in long runs, and the legibility check uses it so the check is not made against a sky that never happens.
 */
export const SHADER_RAW_PEAK = 1.5;

/** The soft ceiling the shader applies to one channel. */
export function softCap(x: number): number {
  return SHADER_CAP * (1 - Math.exp(-x / SHADER_CAP));
}

/** The shader's total gain on a page: the hour's gain under the page's ceiling. */
export function totalGain(place: PlaceId, hourGain: number): number {
  return hourGain * Math.min(1, pageGain(place));
}

/** The text colours the sky must leave readable: the wall's muted text (`--dim`). */
export const MUTED_TEXT: Rgb = [0xb7 / 255, 0xaf / 255, 0xd6 / 255];

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function luminance(c: Rgb): number {
  return 0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2]);
}
/** The contrast ratio of two colours (1 to 21). */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The contrast the wall's muted text needs. */
export const MIN_CONTRAST = 4.5;

const VEIL_COLOUR: Rgb = [6 / 255, 4 / 255, 22 / 255];

/**
 * The contrast of the muted text on `place` at the sun altitude `alt`, with the sky layer's total gain `gain`:
 * the brightest colour the shader can output (the worst of its three), laid over the hour's own upper sky, the band under the top (where
 * text sits straight on the sky: the clock, Unwind's captions, Zen's words), with the page's veil on top.
 */
function contrastWith(place: PlaceId, alt: number, eve: boolean, gain: number, colours: SkyColours): number {
  const upper = pal(alt, eve).s[1] as number[];
  const veil = veilFor(place);
  let worst = Infinity;
  for (const col of [colours.a, colours.b, colours.c]) {
    const src = [softCap(SHADER_RAW_PEAK * col[0] * gain), softCap(SHADER_RAW_PEAK * col[1] * gain), softCap(SHADER_RAW_PEAK * col[2] * gain)];
    const a = Math.max(src[0], src[1], src[2]);
    const px: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 3; i++) px[i] = VEIL_COLOUR[i] * veil + (src[i] + (upper[i] / 255) * (1 - a)) * (1 - veil);
    worst = Math.min(worst, contrast(MUTED_TEXT, px));
  }
  return worst;
}

/** The contrast of the muted text on the hour's bare sky under the page's veil, with no sky layer at all. */
export function bareContrast(place: PlaceId, alt: number, eve = false): number {
  return contrastWith(place, alt, eve, 0, skyColoursForAlt(alt, eve, 'wash', createSkyColours()));
}

/**
 * The most gain the page may carry at this hour and keep the muted text at 4.5 to 1, never more than the
 * hour's gain under the page's ceiling. Zero where the bare sky already misses it (a bright noon sky with
 * no veil leaves no room): there the sky layer stays dark rather than make the page harder to read.
 */
export function legibleGain(place: PlaceId, alt: number, eve: boolean, style: SkyStyle, colours: SkyColours = skyColoursForAlt(alt, eve, style, createSkyColours())): number {
  const want = totalGain(place, colours.gain);
  // Zen's words sit over the lake, not on the sky (the sky has no text under it), so it keeps its full gain.
  if (place === 'zen') return want;
  if (contrastWith(place, alt, eve, want, colours) >= MIN_CONTRAST) return want;
  if (contrastWith(place, alt, eve, 0, colours) < MIN_CONTRAST) return 0;
  let lo = 0;
  let hi = want;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (contrastWith(place, alt, eve, mid, colours) >= MIN_CONTRAST) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The legibility check as a number: the muted text's contrast on `place` at this hour, with the gain the page actually carries. */
export function worstCase(place: PlaceId, alt: number, style: SkyStyle, eve = false): number {
  const colours = skyColoursForAlt(alt, eve, style, createSkyColours());
  return contrastWith(place, alt, eve, legibleGain(place, alt, eve, style, colours), colours);
}

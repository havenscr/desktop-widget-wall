import { PLAY_TINT } from '../horizon/echo';

/** One colour as red, green and blue, 0 to 255. */
export type Rgb = [number, number, number];
/** The three colours the dancing lines take, left to right across the band. */
export interface CoverTint {
  left: number[];
  centre: number[];
  right: number[];
}

/** Lightness range a line colour is held inside, so a black or a white cover still gives lines that show on the night sky. */
export const TINT_MIN_LIGHT = 0.55;
export const TINT_MAX_LIGHT = 0.8;
/** A colour this grey (HSL saturation) is lifted to at least this much, so a grey cover still gives a hint of colour. */
export const TINT_MIN_SAT = 0.35;
/** Seconds the lines take to cross-fade from one cover's colours to the next. */
export const TINT_FADE_MS = 2000;
/** Side of the square the cover is drawn into before it is read. */
export const TINT_SAMPLE = 24;

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h / 6, s, l];
}

function toRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [Math.round(ch(h + 1 / 3) * 255), Math.round(ch(h) * 255), Math.round(ch(h - 1 / 3) * 255)];
}

/**
 * A colour held inside the contrast floor: lightness between `TINT_MIN_LIGHT` and
 * `TINT_MAX_LIGHT`, and a pure grey given the default teal's hue at `TINT_MIN_SAT`, so
 * the lines never vanish into the dark sky and never turn flat white.
 */
export function floorColour(c: Rgb): Rgb {
  const [h, s, l] = toHsl(c);
  const grey = s < 0.08;
  const hue = grey ? 181 / 360 : h;
  const sat = grey ? TINT_MIN_SAT : Math.max(TINT_MIN_SAT, s);
  return toRgb(hue, sat, Math.min(TINT_MAX_LIGHT, Math.max(TINT_MIN_LIGHT, l)));
}

/**
 * Three colours from a cover's pixels (RGBA rows, `w` by `h`): the left, middle and right
 * thirds, each an average that leans on its most colourful pixels (weight 0.15 plus the
 * pixel's saturation), then held inside the contrast floor. Fully transparent pixels count
 * for nothing; a third with none gives the default teal.
 */
export function coverColours(data: ArrayLike<number>, w: number, h: number): CoverTint {
  const out: Rgb[] = [];
  for (let part = 0; part < 3; part++) {
    const x0 = Math.floor((part * w) / 3);
    const x1 = Math.floor(((part + 1) * w) / 3);
    let r = 0;
    let g = 0;
    let b = 0;
    let total = 0;
    for (let y = 0; y < h; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 3] === 0) continue;
        const px: Rgb = [data[i], data[i + 1], data[i + 2]];
        const wt = 0.15 + toHsl(px)[1];
        r += px[0] * wt;
        g += px[1] * wt;
        b += px[2] * wt;
        total += wt;
      }
    }
    out.push(total > 0 ? floorColour([r / total, g / total, b / total]) : (PLAY_TINT.centre.slice() as Rgb));
  }
  return { left: out[0], centre: out[1], right: out[2] };
}

/** Reads a cover (a data URL) on a small offscreen canvas; null when it cannot be decoded or read. */
export function readCoverTint(src: string): Promise<CoverTint | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(null);
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = TINT_SAMPLE;
        c.height = TINT_SAMPLE;
        const ctx = c.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, TINT_SAMPLE, TINT_SAMPLE);
        resolve(coverColours(ctx.getImageData(0, 0, TINT_SAMPLE, TINT_SAMPLE).data, TINT_SAMPLE, TINT_SAMPLE));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// The tiny store: where the colours are fading from and to, and since when. Read once a frame by
// the horizon through `liveTint`, which writes into one object (nothing is allocated per frame).
const DEFAULT: CoverTint = { left: PLAY_TINT.left, centre: PLAY_TINT.centre, right: PLAY_TINT.right };
let from: CoverTint = DEFAULT;
let to: CoverTint = DEFAULT;
let since = 0;
let fadeMs = TINT_FADE_MS;
const live = { left: [0, 0, 0], centre: [0, 0, 0], right: [0, 0, 0] };

/** The colours the lines show now (mid-fade they are a blend), written into `live`. */
function blendInto(target: number[], a: number[], b: number[], f: number): void {
  target[0] = a[0] + (b[0] - a[0]) * f;
  target[1] = a[1] + (b[1] - a[1]) * f;
  target[2] = a[2] + (b[2] - a[2]) * f;
}

/** The line colours at `nowMs` (performance clock): the cover's, the default teal when no cover is known, cross-faded over 2 seconds. */
export function liveTint(nowMs: number): CoverTint {
  const f = fadeMs <= 0 ? 1 : Math.min(1, Math.max(0, (nowMs - since) / fadeMs));
  blendInto(live.left, from.left, to.left, f);
  blendInto(live.centre, from.centre, to.centre, f);
  blendInto(live.right, from.right, to.right, f);
  return live;
}

/** The cover's colours (null: back to the default), faded in over 2 seconds, or at once when `instant` (reduced motion). */
export function setCoverTint(next: CoverTint | null, nowMs: number, instant = false): void {
  const now = liveTint(nowMs);
  from = { left: now.left.slice(), centre: now.centre.slice(), right: now.right.slice() };
  to = next ?? DEFAULT;
  since = nowMs;
  fadeMs = instant ? 0 : TINT_FADE_MS;
}

/** The colours being faded to (the default when no cover is known). */
export function targetTint(): CoverTint {
  return to;
}

/** Tests only. */
export function resetCoverTint(): void {
  from = DEFAULT;
  to = DEFAULT;
  since = 0;
  fadeMs = TINT_FADE_MS;
}

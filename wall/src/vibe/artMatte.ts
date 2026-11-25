import { softStops } from './feather';

/** Three blurred sprites of the art, baked once per art change: a tight pink glow, a wide violet one and a faint wide air. */
export interface Matte {
  tight: HTMLCanvasElement;
  wide: HTMLCanvasElement;
  air: HTMLCanvasElement;
  /** Sprite padding around the art, in the art's own pixels, so a draw knows where the art sits inside it. */
  pad: number;
  w: number;
  h: number;
}

/** The glow colours: pink, violet, and a pale violet air. */
export const GLOW_RGB = { tight: '255,79,163', wide: '150,100,255', air: '120,110,255' } as const;
const SCALE = 0.25;

/** The art's computed border radius in px (the first corner), 0 when it has none. */
export function radiusOf(el: Element): number {
  const v = parseFloat(getComputedStyle(el).borderTopLeftRadius || '0');
  return Number.isFinite(v) ? v : 0;
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + k, y);
  c.arcTo(x + w, y, x + w, y + h, k);
  c.arcTo(x + w, y + h, x, y + h, k);
  c.arcTo(x, y + h, x, y, k);
  c.arcTo(x, y, x + w, y, k);
  c.closePath();
}

function blurred(art: CanvasImageSource | null, w: number, h: number, r: number, pad: number, blur: number, rgb: string): HTMLCanvasElement {
  const cw = Math.max(2, Math.round((w + pad * 2) * SCALE));
  const ch = Math.max(2, Math.round((h + pad * 2) * SCALE));
  const el = document.createElement('canvas');
  el.width = cw;
  el.height = ch;
  const x = el.getContext('2d');
  if (!x) return el;
  x.scale(SCALE, SCALE);
  // The art's own alpha is kept: a transparent PNG casts only the glow of its visible part.
  x.save();
  roundRect(x, pad, pad, w, h, r);
  x.clip();
  if (art) x.drawImage(art, pad, pad, w, h);
  else {
    x.fillStyle = `rgba(${rgb},0.9)`;
    x.fillRect(pad, pad, w, h);
  }
  x.restore();
  // Tint it to one colour (the shape stays), then blur. Blur is paid here, once, never in a frame.
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = `rgb(${rgb})`;
  x.fillRect(0, 0, w + pad * 2, h + pad * 2);
  if ('filter' in x) {
    const copy = document.createElement('canvas');
    copy.width = cw;
    copy.height = ch;
    const cx = copy.getContext('2d');
    if (cx) {
      cx.drawImage(el, 0, 0);
      x.globalCompositeOperation = 'copy';
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.filter = `blur(${Math.max(1, blur * SCALE)}px)`;
      x.drawImage(copy, 0, 0);
      x.filter = 'none';
    }
  }
  // A last feather: nothing at the sprite's own edge.
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'destination-in';
  const g = x.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.2, cw / 2, ch / 2, Math.max(cw, ch) * 0.5);
  softStops(g, 0, 1, '0,0,0', 1, 0);
  x.fillStyle = g;
  x.fillRect(0, 0, cw, ch);
  return el;
}

/**
 * Bake the three glow sprites for an art box of `w` by `h` (radius `r`). `art` is the image to draw
 * (null: a plain fill, used for a video box or an art that cannot be drawn). Pixels are never read.
 */
export function bakeMatte(art: CanvasImageSource | null, w: number, h: number, r: number): Matte {
  const pad = Math.round(Math.max(w, h) * 0.7);
  return {
    tight: blurred(art, w, h, r, pad, 28, GLOW_RGB.tight),
    wide: blurred(art, w, h, r, pad, 90, GLOW_RGB.wide),
    air: blurred(art, w, h, r, pad, 170, GLOW_RGB.air),
    pad,
    w,
    h,
  };
}

import { RIBBONS, colourKey, ribbonColour } from './colours';
import { softStops } from './feather';
import type { Rgb } from '../music/coverTint';

/** Sprite height in backing pixels for each ribbon, and the sky band the veil may fill (backing pixels). */
const SPRITE_W = 256;

/**
 * Aurora Veil: soft ribbons across the sky band only. Each ribbon is one pre-drawn, feathered sprite per
 * end of the palette (cool and warm); a frame scales, slides and alpha-blends them, so nothing is
 * built, blurred or allocated while it draws. Sprites are baked again when the size or the cover's
 * colour changes.
 */
export interface Aurora {
  /** Bake the sprites for a canvas of `w` by `h` backing pixels and the cover colour (null: none). */
  bake(w: number, h: number, tint: Rgb | null): void;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, amount: number, rich: number, palette: number, kick: number): void;
}

type Sprites = { cool: HTMLCanvasElement; warm: HTMLCanvasElement }[];

function sprite(w: number, h: number, c: Rgb, a: number): HTMLCanvasElement {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  const x = el.getContext('2d');
  if (!x) return el;
  const rgb = `${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])}`;
  // Vertical: a feathered band, nothing on the first or last row. Horizontal: faded to nothing at both ends.
  const v = x.createLinearGradient(0, 0, 0, h);
  softStops(v, 0, 0.35, rgb, 0, a);
  softStops(v, 0.35, 1, rgb, a, 0);
  x.fillStyle = v;
  x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = 'destination-in';
  const hz = x.createLinearGradient(0, 0, w, 0);
  softStops(hz, 0, 0.22, '0,0,0', 0, 1);
  softStops(hz, 0.78, 1, '0,0,0', 1, 0);
  x.fillStyle = hz;
  x.fillRect(0, 0, w, h);
  return el;
}

/** One frame of the veil from the baked sprites. Allocates nothing. */
function paint(sprites: Sprites, ctx: CanvasRenderingContext2D, w: number, h: number, t: number, amount: number, rich: number, palette: number, kick: number): void {
  if (amount <= 0.002 || sprites.length === 0) return;
  const sc = h / 360;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < RIBBONS.length; i++) {
    const r = RIBBONS[i];
    const gain = r.quiet ? rich : 1;
    if (gain <= 0.003) continue;
    const sway = Math.sin(t * r.speed * 6.28 + r.phase);
    const swell = 1 + 0.25 * Math.sin(t * r.speed * 3.1 + r.phase * 1.7) + 0.12 * kick * r.kick;
    const bw = w * (1.15 + 0.2 * sway);
    const bh = sprites[i].cool.height * swell;
    const x = (w - bw) / 2 + sway * w * 0.06;
    const y = r.y * sc - bh * 0.1;
    const a = Math.min(1, amount * gain);
    // The two palette ends cross-fade; their weights sum to 1 so the strength never dips.
    if (palette < 0.999) {
      ctx.globalAlpha = a * (1 - palette);
      ctx.drawImage(sprites[i].cool, x, y, bw, bh);
    }
    if (palette > 0.001) {
      ctx.globalAlpha = a * palette;
      ctx.drawImage(sprites[i].warm, x, y, bw, bh);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

export function createAurora(): Aurora {
  let sprites: Sprites = [];
  let key = '';
  return {
    bake(w, h, tint) {
      const k = `${w}x${h}:${colourKey(tint)}`;
      if (k === key) return;
      key = k;
      sprites = RIBBONS.map((r) => ({
        cool: sprite(SPRITE_W, Math.max(8, Math.round(r.h * (h / 360))), ribbonColour(r, false, tint), r.alpha),
        warm: sprite(SPRITE_W, Math.max(8, Math.round(r.h * (h / 360))), ribbonColour(r, true, tint), r.alpha),
      }));
    },
    draw(ctx, w, h, t, amount, rich, palette, kick) {
      paint(sprites, ctx, w, h, t, amount, rich, palette, kick);
    },
  };
}

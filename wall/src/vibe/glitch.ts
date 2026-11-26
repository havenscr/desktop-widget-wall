import { DROP_S, envOf, sstep } from './mix';

/** Slices per drop and how long one seed lasts (seeds crossfade, so a slice never pops). */
export const SLICES = 7;
export const SEED_HZ = 11;

/** Where a front canvas pixel reads from the horizon canvas: `hx = fx * ax + bx`, `hy = fy * ay + by`. */
export interface HzMap {
  ax: number;
  bx: number;
  ay: number;
  by: number;
}

/** What the glitch copies from. The DOM cannot be read; the horizon canvas and the art picture can. */
export interface GlitchSources {
  hz: HTMLCanvasElement | null;
  map: HzMap;
  img: HTMLImageElement | null;
  /** The art's box in front canvas pixels. */
  art: { x: number; y: number; w: number; h: number };
}

export interface Glitch {
  /** Bakes the scratch strip and the feather sprite for a front canvas `w` wide. */
  bake(w: number): void;
  /** One frame: every live drop in `drops` (clock seconds, -Infinity for none) draws its slices, scaled by `amount`. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, nowS: number, drops: Float64Array, amount: number, src: GlitchSources): void;
}

/** A repeatable pseudo random number in 0 to 1 from two numbers; pure arithmetic, no state. */
export function rnd(seed: number, i: number): number {
  const x = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const MAX_H = 20;

function slice(
  ctx: CanvasRenderingContext2D,
  buf: CanvasRenderingContext2D,
  bufEl: HTMLCanvasElement,
  feather: HTMLCanvasElement,
  from: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  dx: number,
  dy: number,
  tint: string,
  alpha: number,
): void {
  buf.globalCompositeOperation = 'source-over';
  buf.clearRect(0, 0, bufEl.width, MAX_H);
  buf.drawImage(from, sx, sy, sw, sh, 0, 0, dw, dh);
  // Tint only the slice (the buffer holds nothing else), then feather its ends and its top and bottom.
  buf.globalCompositeOperation = 'source-atop';
  buf.fillStyle = tint;
  buf.fillRect(0, 0, dw, dh);
  buf.globalCompositeOperation = 'destination-in';
  buf.drawImage(feather, 0, 0, dw, dh);
  ctx.globalAlpha = alpha > 1 ? 1 : alpha;
  ctx.drawImage(bufEl, 0, 0, dw, dh, dx, dy, dw, dh);
}

function set(ctx: CanvasRenderingContext2D, buf: CanvasRenderingContext2D, bufEl: HTMLCanvasElement, feather: HTMLCanvasElement, w: number, h: number, seed: number, weight: number, src: GlitchSources): void {
  for (let i = 0; i < SLICES; i++) {
    const r = rnd(seed, i);
    const sh = 3 + rnd(seed, i + 40) * (MAX_H - 3);
    const y = (0.08 + 0.86 * r) * (h - sh);
    const dx = (rnd(seed, i + 80) - 0.5) * 2 * (10 + 34 * rnd(seed, i + 120));
    const m = src.map;
    const bw = (0.3 + 0.5 * rnd(seed, i + 160)) * w;
    const bx = rnd(seed, i + 200) * (w - bw);
    if (src.hz) {
      slice(ctx, buf, bufEl, feather, src.hz, m.bx + bx * m.ax, y * m.ay + m.by, bw * m.ax, sh * m.ay, bw, sh, bx + dx, y, 'rgba(255,70,170,0.42)', weight * 0.5);
      slice(ctx, buf, bufEl, feather, src.hz, m.bx + bx * m.ax, y * m.ay + m.by, bw * m.ax, sh * m.ay, bw, sh, bx - dx * 0.6, y, 'rgba(70,220,255,0.38)', weight * 0.3);
    }
    const a = src.art;
    if (src.img && a.w > 0 && y + sh > a.y && y < a.y + a.h && src.img.naturalWidth > 0) {
      const ny = ((y - a.y) / a.h) * src.img.naturalHeight;
      const nh = (sh / a.h) * src.img.naturalHeight;
      if (ny >= 0 && ny + nh <= src.img.naturalHeight) slice(ctx, buf, bufEl, feather, src.img, 0, ny, src.img.naturalWidth, nh, a.w, sh, a.x + dx, y, 'rgba(255,90,190,0.35)', weight * 0.6);
    }
  }
}

export function createGlitch(): Glitch {
  let buf: HTMLCanvasElement | null = null;
  let bctx: CanvasRenderingContext2D | null = null;
  let feather: HTMLCanvasElement | null = null;
  return {
    bake(w) {
      const b = document.createElement('canvas');
      b.width = Math.max(2, Math.round(w));
      b.height = MAX_H;
      buf = b;
      bctx = b.getContext('2d');
      const f = document.createElement('canvas');
      f.width = 64;
      f.height = 16;
      const g = f.getContext('2d');
      if (g) {
        // Alpha is a smooth step in from every edge: ends over 12 px of 64, top and bottom over 5 of 16.
        for (let x = 0; x < 64; x++) {
          const ex = sstep(0, 12, x) * sstep(0, 12, 63 - x);
          for (let y = 0; y < 16; y++) {
            g.fillStyle = `rgba(0,0,0,${(ex * sstep(0, 5, y) * sstep(0, 5, 15 - y)).toFixed(3)})`;
            g.fillRect(x, y, 1, 1);
          }
        }
      }
      feather = f;
    },
    draw(ctx, w, h, nowS, drops, amount, src) {
      if (amount <= 0.003 || !buf || !bctx || !feather) return;
      ctx.globalCompositeOperation = 'screen';
      for (let d = 0; d < drops.length; d++) {
        const age = nowS - drops[d];
        if (!(age >= 0 && age < DROP_S)) continue;
        const env = envOf(age) * amount;
        if (env < 0.01) continue;
        // Two seeds are alive at once and crossfade, per drop stamp, so the slices re-roll without a pop.
        const phase = age * SEED_HZ;
        const k = Math.floor(phase);
        const f = sstep(0, 1, phase - k);
        const base = (drops[d] % 997) * 13;
        set(ctx, bctx, buf, feather, w, h, base + k, env * (1 - f), src);
        set(ctx, bctx, buf, feather, w, h, base + k + 1, env * f, src);
      }
      ctx.globalAlpha = 1;
    },
  };
}

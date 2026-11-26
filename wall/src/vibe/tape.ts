/**
 * Tape Grain: a worn-tape film over the scene. Three baked pieces, drawn each frame with a few calls and no
 * allocation: a 256 px grain tile (light and dark specks with their own alpha, shifted 12 times a second),
 * scanlines at 0.15, and a slow tracking bar that is a feathered lens, never a hard stripe.
 */
export const TILE = 256;
/** Grain shimmer steps per second. */
export const SHIMMER_HZ = 12;
/** The tracking bar's height in canvas pixels and its slow travel in screens per second. */
const BAR_H = 56;
const BAR_SPEED = 0.06;

export interface Tape {
  /** Bakes the tile, the lines and the bar for `ctx`'s canvas; call again after the canvas changes size. */
  bake(ctx: CanvasRenderingContext2D, w: number): void;
  /** One frame: `amount` is the tape strength, `grain` its grain amount, `still` is reduced motion (no shimmer, no bar). */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, nowS: number, amount: number, grain: number, still: boolean, kick?: number): void;
}

/** A small deterministic generator, so a bake looks the same every time. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function createTape(): Tape {
  let grainPat: CanvasPattern | CanvasGradient | string = 'transparent';
  let linePat: CanvasPattern | CanvasGradient | string = 'transparent';
  let bar: HTMLCanvasElement | null = null;
  return {
    bake(ctx) {
      const rnd = lcg(20260);
      const tile = canvasOf(TILE, TILE);
      const t = tile.getContext('2d');
      if (t) {
        for (let i = 0; i < 4200; i++) {
          const light = rnd() < 0.55;
          const a = 0.1 + rnd() * 0.5;
          t.fillStyle = light ? `rgba(255,236,255,${a.toFixed(3)})` : `rgba(0,0,12,${(a * 0.9).toFixed(3)})`;
          t.fillRect(Math.floor(rnd() * TILE), Math.floor(rnd() * TILE), rnd() < 0.2 ? 2 : 1, 1);
        }
      }
      grainPat = ctx.createPattern(tile, 'repeat') ?? 'transparent';
      const lines = canvasOf(1, 4);
      const l = lines.getContext('2d');
      if (l) {
        l.fillStyle = 'rgba(0,0,0,0.15)';
        l.fillRect(0, 0, 1, 1);
      }
      linePat = ctx.createPattern(lines, 'repeat') ?? 'transparent';
      const b = canvasOf(64, BAR_H);
      const g = b.getContext('2d');
      if (g) {
        const grad = g.createLinearGradient(0, 0, 0, BAR_H);
        for (let i = 0; i <= 8; i++) {
          const u = i / 8;
          const bell = Math.sin(Math.PI * u);
          grad.addColorStop(u, `rgba(220,210,255,${(0.34 * bell * bell).toFixed(4)})`);
        }
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, BAR_H);
      }
      bar = b;
    },
    draw(ctx, w, h, nowS, amount, grain, still, kick = 0) {
      if (amount <= 0.003) return;
      const a = amount > 1 ? 1 : amount;
      ctx.globalCompositeOperation = 'source-over';
      const step = still ? 0 : Math.floor(nowS * SHIMMER_HZ);
      const ox = (step * 73) % TILE;
      const oy = (step * 151) % TILE;
      ctx.setTransform(1, 0, 0, 1, -ox, -oy);
      ctx.globalAlpha = Math.min(1, a * (0.22 + 0.5 * (grain > 1 ? 1 : grain)) * (1 + kick));
      ctx.fillStyle = grainPat;
      ctx.fillRect(ox, oy, w, h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = a;
      ctx.fillStyle = linePat;
      ctx.fillRect(0, 0, w, h);
      if (!still && bar) {
        const y = (((nowS * BAR_SPEED) % 1.3) - 0.15) * h;
        ctx.globalAlpha = a;
        ctx.drawImage(bar, 0, y - BAR_H / 2, w, BAR_H);
      }
      ctx.globalAlpha = 1;
    },
  };
}

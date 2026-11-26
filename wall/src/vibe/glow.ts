import type { Matte } from './artMatte';

/** What a glow frame reads: the strength, the drop swell, the bass and the kick (0 to 1 each). */
export interface GlowInput {
  halo: number;
  swell: number;
  bass: number;
  kick: number;
}

function put(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, alpha: number, s: number, cx: number, cy: number, w: number, h: number): void {
  ctx.globalAlpha = alpha > 1 ? 1 : alpha;
  ctx.drawImage(sprite, cx - (w * s) / 2, cy - (h * s) / 2, w * s, h * s);
}

/**
 * Bass Glow: the baked sprites scaled and alpha-blended around the art at (`x`, `y`), a box of the
 * matte's own size in canvas pixels scaled by `k` (the backing store's scale). Three draws, no
 * allocation, no filter.
 */
export function drawGlow(ctx: CanvasRenderingContext2D, m: Matte, x: number, y: number, k: number, g: GlowInput): void {
  if (g.halo <= 0.003 && g.swell <= 0.003) return;
  const strength = Math.min(1.2, g.halo * (0.4 + 0.6 * g.bass) + g.swell * 0.6);
  const grow = 1 + 0.06 * g.kick + 0.1 * g.swell;
  const full = (m.w + m.pad * 2) * k;
  const fullH = (m.h + m.pad * 2) * k;
  const cx = x + (m.w * k) / 2;
  const cy = y + (m.h * k) / 2;
  ctx.globalCompositeOperation = 'screen';
  put(ctx, m.air, 0.35 * strength, grow * 1.05, cx, cy, full, fullH);
  put(ctx, m.wide, 0.55 * strength, grow, cx, cy, full, fullH);
  put(ctx, m.tight, (0.45 + 0.4 * g.kick) * strength, grow * 0.98, cx, cy, full, fullH);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

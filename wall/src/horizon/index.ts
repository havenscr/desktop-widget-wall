export interface HorizonOptions {
  /** Drawing width in canvas pixels (backing store). */
  width: number;
  /** Drawing height in canvas pixels (backing store). */
  height: number;
  /** Horizon line in design pixels (stage coordinates). */
  horizonY: number;
  /** Design pixels to canvas pixels: stage scale times devicePixelRatio. */
  scale: number;
}

export const HORIZON_Y = 582;

const SKY_STOPS = ['#070a24', '#0d1f4d', '#16466e', '#2a8fa3'];
const FLOOR_STOPS = ['#0b0d2e', '#05051a'];

function fill(ctx: CanvasRenderingContext2D, top: number, bottom: number, stops: string[], width: number) {
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, top, width, bottom - top);
}

/** Placeholder horizon: sky gradient down to the horizon line, floor gradient below. */
export function drawHorizon(ctx: CanvasRenderingContext2D, options: HorizonOptions): void {
  const { width, height, horizonY, scale } = options;
  const y = Math.round(horizonY * scale);
  ctx.clearRect(0, 0, width, height);
  fill(ctx, 0, y, SKY_STOPS, width);
  fill(ctx, y, height, FLOOR_STOPS, width);
}

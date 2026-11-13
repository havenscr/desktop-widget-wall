/**
 * The lake reflection on the visualizer camera: the band of picture just above the horizon line,
 * flipped, squashed and faded, drawn into the lake with additive compositing. Done on the finished
 * frame (after `drawHorizon`), so it mirrors the range, the echo lines and the sky exactly as drawn.
 */

/** Reflection on (the owner chose "Lake reflection: on" on the demo page). */
export const REFLECT = true;
/** Design pixels of picture above the horizon line that are mirrored. */
export const REFLECT_BAND = 190;
/** How much of the band's height the reflection takes (0.62 of it). */
export const REFLECT_SQUASH = 0.62;
/** Design pixels between the horizon line and the reflection's top edge. */
export const REFLECT_GAP = 3;
/** Opacity of the reflection at full weight and an open gate. */
export const REFLECT_ALPHA = 0.8;

/** The scratch canvas the band is copied to: made on first use, resized only when the canvas size changes. */
export interface Reflection {
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
}

export function createReflection(): Reflection {
  return { canvas: null, ctx: null };
}

/** The reflection's opacity: `REFLECT_ALPHA` times how much the camera is the visualizer times the echo gate; 0 means draw nothing. */
export function reflectionAlpha(weight: number, gate: number): number {
  const w = weight > 0 ? (weight < 1 ? weight : 1) : 0;
  const g = gate > 0 ? (gate < 1 ? gate : 1) : 0;
  return REFLECT_ALPHA * w * g;
}

/**
 * Draw the reflection into `ctx` (the frame's own context, whose canvas is `width` by `height`
 * device pixels). `hy` is the horizon line in design pixels and `scale` the device pixels per
 * design pixel. Returns false when nothing was drawn (no opacity or no room).
 *
 * The transform is set explicitly (`setTransform`) and restored after: a transform left set by an
 * earlier draw once put the reflection in the sky. Nothing is created per frame but one gradient.
 */
export function drawReflection(
  r: Reflection,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  hy: number,
  scale: number,
  alpha: number,
  make: () => HTMLCanvasElement = () => document.createElement('canvas'),
): boolean {
  if (!(alpha > 0.002)) return false;
  const y0 = hy * scale;
  const h = Math.min(Math.ceil(REFLECT_BAND * scale), Math.floor(y0));
  if (h < 2 || width < 2 || y0 >= height) return false;
  if (!r.canvas || !r.ctx) {
    const c = make();
    const x = c.getContext('2d');
    if (!x) return false;
    r.canvas = c;
    r.ctx = x;
  }
  const c = r.canvas;
  const x = r.ctx;
  if (c.width !== width || c.height !== h) {
    c.width = width;
    c.height = h;
  }
  // The band above the horizon, faded to clear at its top and solid at the line.
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'copy';
  x.drawImage(ctx.canvas, 0, y0 - h, width, h, 0, 0, width, h);
  x.globalCompositeOperation = 'destination-in';
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  x.fillStyle = g;
  x.fillRect(0, 0, width, h);
  x.globalCompositeOperation = 'source-over';
  // Flipped and squashed: the band's bottom (the horizon) lands just under the line, its top at 0.62 of its height below that.
  ctx.save();
  ctx.setTransform(1, 0, 0, -REFLECT_SQUASH, 0, y0 + REFLECT_SQUASH * h + REFLECT_GAP * scale);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.drawImage(c, 0, 0);
  ctx.restore();
  return true;
}

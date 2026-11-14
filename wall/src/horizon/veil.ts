/**
 * The place veil (`.veil` in `styles/frame.css`) on the front canvas. The veil is a page layer
 * over the horizon canvas and under the screens; the front canvas sits in a screen, above it, so
 * the land it draws would otherwise lose the veil and come out a little brighter than with one
 * canvas. The same gradient is laid on the front canvas's own pixels only ('source-atop'), after
 * the ground and its reflection, which gives exactly the pixels the veil gives over one canvas.
 * The stops follow frame.css (veil.test.ts compares them); the strength is read from the veil
 * element's `--veil`, so the place's value and its transition hold.
 */

/** Colour of the veil (frame.css): rgb(6, 4, 22). */
export const VEIL_RGB = '6,4,22';
/** The veil's stops as [offset, share of `--veil`] (frame.css: full to 64 percent, 0.3 of it from 76 percent down). */
export const VEIL_STOPS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.64, 1],
  [0.76, 0.3],
  [1, 0.3],
];

/** The veil's current strength from its element (0 when there is none or it cannot be read). */
export function veilStrength(el: Element | null): number {
  if (!el) return 0;
  const v = parseFloat(getComputedStyle(el).getPropertyValue('--veil'));
  return Number.isFinite(v) && v > 0 ? Math.min(1, v) : 0;
}

/**
 * Lay the veil at strength `a` over what `ctx` already holds, on its own pixels only. `width` and
 * `height` are the canvas's size in its pixels. Nothing is drawn at `a` 0.
 */
export function drawVeil(ctx: CanvasRenderingContext2D, width: number, height: number, a: number): void {
  if (!(a > 0)) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-atop';
  const g = ctx.createLinearGradient(0, 0, 0, height);
  for (const [o, k] of VEIL_STOPS) g.addColorStop(o, `rgba(${VEIL_RGB},${+(a * k).toFixed(4)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

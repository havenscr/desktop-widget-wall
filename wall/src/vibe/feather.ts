/** Smooth step from 0 at `a` to 1 at `b`. */
export const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Colour stops from `p0` to `p1` that follow a smooth step from alpha `a0` to `a1`, so a gradient
 * never ends on a visible line. `rgb` is "r,g,b".
 */
export function softStops(g: CanvasGradient, p0: number, p1: number, rgb: string, a0: number, a1: number): void {
  for (let i = 0; i <= 6; i++) {
    const u = i / 6;
    const s = u * u * (3 - 2 * u);
    g.addColorStop(Math.min(1, Math.max(0, p0 + (p1 - p0) * u)), `rgba(${rgb},${(a0 + (a1 - a0) * s).toFixed(4)})`);
  }
}

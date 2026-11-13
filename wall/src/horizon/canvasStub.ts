/** Test helper: a 2D context that accepts every call. Gradients take colour stops; patterns and image data are inert. */
export function stubContext(): CanvasRenderingContext2D {
  const gradient = () => ({ addColorStop() {} });
  const methods: Record<string, unknown> = {
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createPattern: () => ({}),
    createImageData: () => ({ data: new Uint8ClampedArray(160 * 160 * 4) }),
  };
  return new Proxy({} as Record<string, unknown>, {
    get: (store, key: string) => (key in store ? store[key] : (methods[key] ?? (() => {}))),
    set: (store, key: string, value) => {
      store[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/**
 * Test helper: a 2D context that accepts every call like `stubContext` and also writes each
 * method call and property set to `log`, one line each, in order. Gradients log their colour
 * stops. Two draws that make the same canvas calls produce equal logs (numbers to 3 decimals).
 */
export function recordingContext(): { ctx: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = [];
  let gradients = 0;
  // Numbers are rounded to 3 decimals, so the last-digit differences between JavaScript engines'
  // Math functions do not change a log.
  const show = (v: unknown): string =>
    typeof v === 'number'
      ? String(Math.round(v * 1000) / 1000)
      : typeof v === 'object' && v !== null && 'id' in v
        ? `[${String((v as { id: unknown }).id)}]`
        : typeof v === 'object'
          ? '[object]'
          : String(v);
  const gradient = (kind: string) => (...args: unknown[]) => {
    const id = `${kind}${gradients++}`;
    log.push(`${kind}(${args.map(show).join(',')})=${id}`);
    return { id, addColorStop: (o: number, c: string) => void log.push(`${id}.stop(${o},${c})`) };
  };
  const methods: Record<string, unknown> = {
    createLinearGradient: gradient('linear'),
    createRadialGradient: gradient('radial'),
    createPattern: () => ({ id: 'pattern' }),
    createImageData: () => ({ data: new Uint8ClampedArray(160 * 160 * 4) }),
  };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (store, key: string) => {
      if (key in store) return store[key];
      if (key in methods) return methods[key];
      return (...args: unknown[]) => void log.push(`${key}(${args.map(show).join(',')})`);
    },
    set: (store, key: string, value) => {
      store[key] = value;
      log.push(`${key}=${show(value)}`);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, log };
}

/** A stroked path: its points' y values, the opacity and the line width it was stroked with. */
export interface PathStroke {
  y: number[];
  alpha: number;
  width: number;
}
/** A filled path: its point count and the fill style. */
export interface PathFill {
  n: number;
  style: unknown;
}

/**
 * Test helper: a 2D context that keeps every stroked path (its points' y values, opacity and width)
 * and every fill (point count and style), ignoring everything else. Light enough to draw many frames.
 */
export function pathContext(): { ctx: CanvasRenderingContext2D; strokes: PathStroke[]; fills: PathFill[] } {
  let pts: number[] = [];
  let alpha = 1;
  let width = 1;
  let style: unknown = null;
  const strokes: PathStroke[] = [];
  const fills: PathFill[] = [];
  const gradient = () => ({ addColorStop() {} });
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (store, key: string) => {
      if (key === 'beginPath') return () => void (pts = []);
      if (key === 'moveTo' || key === 'lineTo') return (_x: number, y: number) => void pts.push(y);
      if (key === 'stroke') return () => void strokes.push({ y: pts, alpha, width });
      if (key === 'fill') return () => void fills.push({ n: pts.length, style });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return gradient;
      if (key === 'createPattern') return () => ({});
      if (key in store) return store[key];
      return () => {};
    },
    set: (store, key: string, value) => {
      store[key] = value;
      if (key === 'globalAlpha') alpha = value as number;
      if (key === 'lineWidth') width = value as number;
      if (key === 'fillStyle') style = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, strokes, fills };
}

/** An echo line as heights above the horizon, with its opacity and width. */
export interface EchoLine {
  h: number[];
  alpha: number;
  width: number;
}

/**
 * The range's rim line and the echo lines from a frame's strokes, as heights above the horizon `hy`.
 * The panorama's lines have 1281 points; the first such stroke is the rim and the last the mid
 * layer's, so the echo lines are the ones between (at night, when no sun highlight is stroked).
 */
export function echoPaths(strokes: PathStroke[], hy: number): { rim: number[]; echo: EchoLine[] } {
  const full = strokes.filter((s) => s.y.length === 1281);
  const toH = (s: PathStroke) => s.y.map((y) => hy - y);
  return { rim: toH(full[0]), echo: full.slice(1, -1).map((s) => ({ h: toH(s), alpha: s.alpha, width: s.width })) };
}

/**
 * How far apart two frames' visible lines are: each line of either frame at `popAlpha` or more is
 * matched to the nearest line of the other (by the largest height gap, then opacity); the worst gap
 * and the worst opacity step of those matches. A line that appears, vanishes or jumps level shows
 * as a large gap.
 */
export function frameGap(a: EchoLine[], b: EchoLine[], popAlpha: number): { worst: number; alpha: number } {
  let worst = 0;
  let alpha = 0;
  for (const [from, to] of [
    [a, b],
    [b, a],
  ]) {
    for (const l of from) {
      if (l.alpha < popAlpha) continue;
      let best = Infinity;
      let bestAlpha = 0;
      for (const p of to) {
        let d = 0;
        for (let i = 0; i < l.h.length; i += 4) d = Math.max(d, Math.abs(l.h[i] - p.h[i]));
        // Nearest by height, then by opacity (crossfading sets can stack two lines on the ridge).
        if (d + Math.abs(l.alpha - p.alpha) * 10 < best + Math.abs(l.alpha - bestAlpha) * 10) {
          best = d;
          bestAlpha = p.alpha;
        }
      }
      worst = Math.max(worst, best);
      alpha = Math.max(alpha, Math.abs(l.alpha - bestAlpha));
    }
  }
  return { worst, alpha };
}

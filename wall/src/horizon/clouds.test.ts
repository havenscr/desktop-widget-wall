import { expect, it } from 'vitest';
import { draw, when, type HorizonDrawOptions } from './renderer';

const W = 2560;

/** A 2D context that logs every method call with its arguments (property writes are ignored). */
function loggingContext() {
  const log: [string, unknown[]][] = [];
  const gradient = () => ({ addColorStop() {} });
  const results: Record<string, () => unknown> = {
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createPattern: () => ({}),
    createImageData: () => ({ data: new Uint8ClampedArray(160 * 160 * 4) }),
  };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (store, key: string) =>
      key in store
        ? store[key]
        : (...args: unknown[]) => {
            log.push([key, args]);
            return results[key]?.();
          },
    set: (store, key: string, value) => {
      store[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, log };
}

// Late afternoon on the Home camera: the clouds are out.
const base: HorizonDrawOptions = { W, H: 720, scale: 1, ter: 'pano', hy: 582, az0: 218.1, ppd: 54, vex: 1.3, cityScale: 1, vx: 1280, ms: when(2026, 11, 11, 15), t: 7, phase: 0.2, grain: false };

function run(extra: Partial<HorizonDrawOptions>) {
  const { ctx, log } = loggingContext();
  draw(ctx, { ...base, ...extra });
  return log;
}

it('cloudShift 0 or absent makes exactly the canvas calls it always did', () => {
  const plain = run({});
  expect(plain.some(([m]) => m === 'translate')).toBe(true); // clouds were drawn
  expect(run({ cloudShift: 0 })).toEqual(plain);
});

it('cloudShift moves every cloud wisp by that many pixels, wrapping round the stage plus a margin', () => {
  const plain = run({}).filter(([m]) => m === 'translate');
  const span = 1.3 * W;
  for (const shift of [100, -640, 2000]) {
    const moved = run({ cloudShift: shift }).filter(([m]) => m === 'translate');
    expect(moved.length).toBe(plain.length);
    let clouds = 0;
    moved.forEach(([, [x, y]], i) => {
      const [x0, y0] = plain[i][1] as number[];
      expect(y).toBe(y0); // clouds keep their height
      const d = (x as number) - x0;
      if (Math.abs(d) < 1e-9) return; // a wisp that is not a cloud (lake reflections)
      clouds++;
      const wrapped = ((((d - shift) % span) + span) % span);
      expect(Math.min(wrapped, span - wrapped)).toBeLessThan(1e-6); // the shift, give or take whole wraps
      expect(x as number).toBeGreaterThan(-0.15 * W - 0.5 * W); // cloud centres stay near the stage
      expect(x as number).toBeLessThan(1.15 * W + 0.5 * W);
    });
    expect(clouds).toBeGreaterThan(0);
  }
});

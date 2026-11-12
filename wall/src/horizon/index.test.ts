import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAMERAS, HOME_MORNING, drawHorizon, when } from './index';
import { stubContext } from './canvasStub';
import type { CameraPlace } from '../state/places';

afterEach(() => vi.restoreAllMocks());

describe('drawHorizon', () => {
  // Lets the film grain path run too: jsdom has no canvas of its own.
  const stubCanvas = () =>
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => stubContext() as never);

  for (const place of Object.keys(CAMERAS) as CameraPlace[]) {
    it(`draws the ${place} view without throwing, day and night`, () => {
      stubCanvas();
      for (const hour of [7, 12, 16.7, 22]) {
        expect(() =>
          drawHorizon(stubContext(), {
            width: 2560,
            height: 720,
            scale: 1,
            camera: CAMERAS[place],
            ms: when(2026, 11, 11, hour),
            t: 1.5,
            phase: 0.3,
          }),
        ).not.toThrow();
      }
    });
  }

  it('draws the south morning view on the canvas stub without throwing, sunrise to night', () => {
    stubCanvas();
    for (const hour of [5.5, 7.2, 11, 16.7, 22]) {
      expect(() =>
        drawHorizon(stubContext(), { width: 2560, height: 720, scale: 1, camera: HOME_MORNING, ms: when(2026, 11, 11, hour), t: 1.5, phase: 0.3 }),
      ).not.toThrow();
    }
  });

  it('still accepts the original scaffold options', () => {
    stubCanvas();
    expect(() => drawHorizon(stubContext(), { width: 2560, height: 720, horizonY: 582, scale: 1 })).not.toThrow();
  });

  it('follows the injected clock: the sky differs between noon and midnight', () => {
    stubCanvas();
    const stops = (hour: number) => {
      const seen: string[] = [];
      const ctx = stubContext();
      const orig = ctx.createLinearGradient.bind(ctx);
      ctx.createLinearGradient = (...a: [number, number, number, number]) => {
        const g = orig(...a);
        const add = g.addColorStop.bind(g);
        g.addColorStop = (o: number, c: string) => (seen.push(c), add(o, c));
        return g;
      };
      drawHorizon(ctx, { width: 2560, height: 720, scale: 1, ms: when(2026, 11, 11, hour) });
      return seen[0];
    };
    expect(stops(12)).not.toBe(stops(0));
  });
});

describe('ripple and moon options', () => {
  /** Every canvas call and property write, as text. Equal logs mean equal pixels. */
  function record(options: Partial<Parameters<typeof drawHorizon>[1]>): string {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => stubContext() as never);
    const log: string[] = [];
    const base = stubContext();
    const ctx = new Proxy(base, {
      get: (t, k: string) => {
        const v = (t as never as Record<string, unknown>)[k];
        return typeof v === 'function'
          ? (...a: unknown[]) => {
              log.push(`${k}(${a.map((x) => (typeof x === 'object' ? '{}' : String(x))).join(',')})`);
              return (v as (...x: unknown[]) => unknown).apply(t, a);
            }
          : v;
      },
      set: (t, k: string, v) => {
        log.push(`${k}=${String(v)}`);
        (t as never as Record<string, unknown>)[k] = v;
        return true;
      },
    });
    drawHorizon(ctx, { width: 2560, height: 720, scale: 1, camera: CAMERAS.unwind, ms: when(2026, 11, 11, 22), t: 0, phase: 0, ...options });
    return log.join('\n');
  }

  it('a silent frame is identical with echo omitted, null, or moon omitted', () => {
    const plain = record({});
    expect(record({ echo: null })).toBe(plain);
    expect(record({ moon: null })).toBe(plain);
  });

  it('passing an echo or a moon changes the drawing', () => {
    const plain = record({});
    expect(record({ echo: { n: 11, amp: 34, a: 0.9, t: 1, cx: 1330, hs: 900 } })).not.toBe(plain);
    expect(record({ moon: [1730, 112, 44] })).not.toBe(plain);
  });
});

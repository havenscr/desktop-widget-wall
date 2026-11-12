import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAMERAS, drawHorizon, when } from './index';
import { stubContext } from './canvasStub';
import type { PlaceId } from '../state/places';

afterEach(() => vi.restoreAllMocks());

describe('drawHorizon', () => {
  // Lets the film grain path run too: jsdom has no canvas of its own.
  const stubCanvas = () =>
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => stubContext() as never);

  for (const place of Object.keys(CAMERAS) as PlaceId[]) {
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

import { afterEach, expect, it, vi } from 'vitest';
import { CAMERAS, HOME_MORNING, drawHorizon, when } from './index';
import { draw } from './renderer';
import { stubContext } from './canvasStub';

vi.mock('./renderer', async (original) => ({ ...(await original<typeof import('./renderer')>()), draw: vi.fn() }));

afterEach(() => vi.mocked(draw).mockClear());

const base = { width: 2560, height: 720, scale: 1, ms: when(2026, 11, 11, 7.2), t: 0, phase: 0 };

it('passes ter south to the renderer for the morning preset, with its framing', () => {
  drawHorizon(stubContext(), { ...base, camera: HOME_MORNING });
  expect(draw).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ter: 'south', az0: 132, ppd: 42, vex: 1.9, hy: 582, cityScale: 1 }));
});

it('passes no terrain for the west cameras (the renderer defaults to west)', () => {
  drawHorizon(stubContext(), { ...base, camera: CAMERAS.home });
  expect(vi.mocked(draw).mock.lastCall![1].ter).toBeUndefined();
});

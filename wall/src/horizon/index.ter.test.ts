import { afterEach, expect, it, vi } from 'vitest';
import { CAMERAS, HOME_MORNING, drawHorizon, when } from './index';
import { draw } from './renderer';
import { stubContext } from './canvasStub';

vi.mock('./renderer', async (original) => ({ ...(await original<typeof import('./renderer')>()), draw: vi.fn() }));

afterEach(() => vi.mocked(draw).mockClear());

const base = { width: 2560, height: 720, scale: 1, ms: when(2026, 11, 11, 7.2), t: 0, phase: 0 };

it('passes the panorama and the morning framing, with its 0.86 snow line, for the morning preset', () => {
  drawHorizon(stubContext(), { ...base, camera: HOME_MORNING });
  expect(draw).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ter: 'pano', az0: 132, ppd: 42, vex: 1.9, hy: 582, cityScale: 1, snowDeg: 0.86 }));
});

it('passes the panorama and a 0.84 snow line for the west cameras', () => {
  for (const cam of Object.values(CAMERAS)) {
    drawHorizon(stubContext(), { ...base, camera: cam });
    expect(vi.mocked(draw).mock.lastCall![1]).toMatchObject({ ter: 'pano', snowDeg: 0.84, az0: cam.az0 });
  }
});

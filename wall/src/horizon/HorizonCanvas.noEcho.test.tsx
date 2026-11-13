import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HorizonCanvas } from './HorizonCanvas';
import { drawHorizon } from './index';
import { recordingContext } from './canvasStub';
import { usePlaceStore } from '../state/places';
import { resetAudio } from '../audio/store';

// The echo is withheld while the camera and gate are those of the visualizer: no lines, so no reflection.
vi.mock('../ui/useIdle', () => ({ useIdle: vi.fn(() => false) }));
vi.mock('./index', async (original) => ({ ...(await original<typeof import('./index')>()), drawHorizon: vi.fn() }));
vi.mock('./echo', async (original) => ({ ...(await original<typeof import('./echo')>()), echoOptions: vi.fn(() => null) }));

let frames: Map<number, FrameRequestCallback>;
let nextId: number;
const logs = new Map<HTMLCanvasElement, string[]>();

beforeEach(() => {
  frames = new Map();
  nextId = 1;
  logs.clear();
  resetAudio();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    const id = nextId++;
    frames.set(id, cb);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => void frames.delete(id));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const r = recordingContext();
    if (!logs.has(this)) logs.set(this, r.log);
    return r.ctx as never;
  } as never);
  vi.mocked(drawHorizon).mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('on Unwind with the gate open but no echo to draw, no reflection is drawn', () => {
  usePlaceStore.setState({ active: 'unwind' });
  render(<HorizonCanvas now={() => new Date(2026, 10, 11, 12, 0).getTime()} />);
  for (let k = 1; k <= 6; k++) {
    const id = Math.max(...frames.keys());
    const cb = frames.get(id)!;
    frames.delete(id);
    act(() => cb(k * 100));
  }
  const drawn = vi.mocked(drawHorizon).mock.calls;
  expect(drawn.length).toBeGreaterThan(5);
  expect(drawn.every((c) => !c[1].echo)).toBe(true);
  expect([...logs.values()].flat().filter((l) => l.startsWith('setTransform(1,0,0,-0.62,') || l.startsWith('drawImage('))).toEqual([]);
});

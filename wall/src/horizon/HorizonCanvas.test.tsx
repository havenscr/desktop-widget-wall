import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HorizonCanvas } from './HorizonCanvas';
import { CAMERAS, drawHorizon } from './index';
import { stubContext } from './canvasStub';
import { fitScale, STAGE_HEIGHT, STAGE_WIDTH } from '../stage/fitScale';
import { usePlaceStore } from '../state/places';

vi.mock('./index', async (original) => ({
  ...(await original<typeof import('./index')>()),
  drawHorizon: vi.fn(),
}));

const NOON = 1794427200000;
const draw = vi.mocked(drawHorizon);

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

/** What the component passes for the current jsdom window. */
function sizes() {
  const scale = fitScale(window.innerWidth, window.innerHeight) * (window.devicePixelRatio || 1);
  return { width: Math.round(STAGE_WIDTH * scale), height: Math.round(STAGE_HEIGHT * scale), scale };
}

let rafSpy: ReturnType<typeof vi.spyOn>;
let cancelSpy: ReturnType<typeof vi.spyOn>;
let frames: Map<number, FrameRequestCallback>;
let nextId: number;

/** Run the newest scheduled frame at timestamp `ts`. */
function runFrame(ts: number) {
  const id = Math.max(...frames.keys());
  const cb = frames.get(id)!;
  frames.delete(id);
  act(() => cb(ts));
}

beforeEach(() => {
  usePlaceStore.setState({ active: 'work' });
  frames = new Map();
  nextId = 1;
  rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    const id = nextId++;
    frames.set(id, cb);
    return id;
  });
  cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => void frames.delete(id));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => stubContext() as never);
  window.history.replaceState(null, '', '/');
  draw.mockClear();
  setHidden(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setHidden(false);
});

it('draws an animated frame from the injected clock and the active place camera', () => {
  setReducedMotion(false);
  render(<HorizonCanvas now={() => NOON} />);
  expect(rafSpy).toHaveBeenCalled();
  runFrame(100);
  // First frame step is capped at 0.1 s, so animation time is 0.1 and the grid phase 0.1 * 0.32.
  expect(draw).toHaveBeenLastCalledWith(expect.anything(), {
    ...sizes(),
    camera: CAMERAS.work,
    ms: NOON,
    t: 0.1,
    phase: (0.1 * 0.32) % 1,
  });
});

it('glides to the new camera over 1.6 seconds, passing intermediate values', () => {
  setReducedMotion(false);
  render(<HorizonCanvas now={() => NOON} />);
  runFrame(100);
  act(() => usePlaceStore.getState().setActive('home'));
  runFrame(900); // 0.1 s step (capped), so the glide is 1/16 of the way
  const cam = draw.mock.lastCall![1].camera!;
  expect(cam.az0).toBeLessThan(CAMERAS.work.az0);
  expect(cam.az0).toBeGreaterThan(CAMERAS.home.az0);
});

it('review URL draws one frozen still: requested camera and time, t 0, phase 0, no frame loop', () => {
  setReducedMotion(false);
  window.history.replaceState(null, '', '/?hz=unwind&at=2026-11-11T16:00:00-08:00');
  const now = vi.fn(() => 0);
  render(<HorizonCanvas now={now} />);
  expect(draw).toHaveBeenCalledTimes(1);
  expect(draw).toHaveBeenCalledWith(expect.anything(), {
    ...sizes(),
    camera: CAMERAS.unwind,
    ms: Date.UTC(2026, 10, 12, 0, 0, 0),
    t: 0,
    phase: 0,
  });
  expect(rafSpy).not.toHaveBeenCalled();
  expect(now).not.toHaveBeenCalled();
  act(() => usePlaceStore.getState().setActive('home'));
  expect(draw).toHaveBeenCalledTimes(1);
  expect(rafSpy).not.toHaveBeenCalled();
});

it('reduced motion draws once, no frame loop, then once a minute', () => {
  setReducedMotion(true);
  vi.useFakeTimers();
  render(<HorizonCanvas now={() => NOON} />);
  expect(rafSpy).not.toHaveBeenCalled();
  expect(draw).toHaveBeenCalledTimes(1);
  expect(draw.mock.lastCall![1]).toEqual({ ...sizes(), camera: CAMERAS.work, ms: NOON, t: 0, phase: 0 });
  act(() => void vi.advanceTimersByTime(60_000));
  expect(draw).toHaveBeenCalledTimes(2);
});

it('reduced motion place change draws the new camera exactly, with no glide values', () => {
  setReducedMotion(true);
  render(<HorizonCanvas now={() => NOON} />);
  act(() => usePlaceStore.getState().setActive('home'));
  expect(draw).toHaveBeenCalledTimes(2);
  expect(draw.mock.calls[1][1]).toEqual({ ...sizes(), camera: CAMERAS.home, ms: NOON, t: 0, phase: 0 });
  expect(draw.mock.calls[1][1].camera).toEqual(CAMERAS.home);
});

it('skips drawing while the document is hidden', () => {
  setReducedMotion(false);
  setHidden(true);
  render(<HorizonCanvas now={() => NOON} />);
  expect(draw).not.toHaveBeenCalled();
  runFrame(100);
  expect(draw).not.toHaveBeenCalled();
  setHidden(false);
  runFrame(200);
  expect(draw).toHaveBeenCalledTimes(1);
});

it('unmount cancels the frame, clears the interval and removes every listener it added (animated)', () => {
  setReducedMotion(false);
  const addWin = vi.spyOn(window, 'addEventListener');
  const remWin = vi.spyOn(window, 'removeEventListener');
  const addDoc = vi.spyOn(document, 'addEventListener');
  const remDoc = vi.spyOn(document, 'removeEventListener');
  const { unmount } = render(<HorizonCanvas now={() => NOON} />);
  runFrame(100);
  const pending = [...frames.keys()];
  expect(pending).toHaveLength(1);
  unmount();
  expect(cancelSpy).toHaveBeenCalledWith(pending[0]);
  expect(frames.size).toBe(0);
  for (const [spyAdd, spyRem] of [[addWin, remWin], [addDoc, remDoc]] as const) {
    for (const [type, handler] of spyAdd.mock.calls) {
      if (type !== 'resize' && type !== 'visibilitychange') continue;
      expect(spyRem).toHaveBeenCalledWith(type, handler);
    }
  }
});

it('unmount stops the one-minute redraw and removes its listeners (reduced motion)', () => {
  setReducedMotion(true);
  vi.useFakeTimers();
  const clearSpy = vi.spyOn(window, 'clearInterval');
  const addDoc = vi.spyOn(document, 'addEventListener');
  const remDoc = vi.spyOn(document, 'removeEventListener');
  const { unmount } = render(<HorizonCanvas now={() => NOON} />);
  expect(addDoc).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  unmount();
  expect(clearSpy).toHaveBeenCalled();
  const handler = addDoc.mock.calls.find(([type]) => type === 'visibilitychange')![1];
  expect(remDoc).toHaveBeenCalledWith('visibilitychange', handler);
  const drawn = draw.mock.calls.length;
  act(() => void vi.advanceTimersByTime(180_000));
  expect(draw.mock.calls.length).toBe(drawn);
});

it('an inline now prop does not restart the loop or reset animation time', () => {
  setReducedMotion(false);
  const { rerender } = render(<HorizonCanvas now={() => NOON} />);
  runFrame(100);
  rerender(<HorizonCanvas now={() => NOON + 5000} />);
  expect(cancelSpy).not.toHaveBeenCalled();
  runFrame(200);
  expect(draw.mock.lastCall![1]).toMatchObject({ ms: NOON + 5000, t: 0.2 });
});

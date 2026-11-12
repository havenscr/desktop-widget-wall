import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HorizonCanvas } from './HorizonCanvas';
import { CAMERAS, drawHorizon } from './index';
import { stubContext } from './canvasStub';
import { fitScale, STAGE_HEIGHT, STAGE_WIDTH } from '../stage/fitScale';
import { usePlaceStore } from '../state/places';
import { ingestLevels, resetAudio, tickAudio } from '../audio/store';

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
  resetAudio();
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
    moon: [1730, 112, 44],
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

it('review mode repaints when the page becomes visible after a hidden start', () => {
  setReducedMotion(false);
  window.history.replaceState(null, '', '/?hz=home&at=2026-11-11T16:00:00Z');
  setHidden(true);
  render(<HorizonCanvas now={() => 0} />);
  expect(draw).not.toHaveBeenCalled();
  setHidden(false);
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
  expect(draw).toHaveBeenCalledTimes(1);
  expect(draw.mock.lastCall![1]).toMatchObject({ camera: CAMERAS.home, ms: Date.UTC(2026, 10, 11, 16), t: 0, phase: 0 });
});

it('review mode sets the active place in the store so the rail and screen match', () => {
  setReducedMotion(false);
  window.history.replaceState(null, '', '/?hz=home&at=2026-11-11T16:00:00Z');
  expect(usePlaceStore.getState().active).toBe('work');
  render(<HorizonCanvas now={() => 0} />);
  expect(usePlaceStore.getState().active).toBe('home');
});

const LOUD = { bass: 0.9, mid: 0.5, high: 0.3, bands: [1], waveform: [0.1] };

/** Make the audio store say music is playing, as of a steady clock the test controls. */
function startMusic(at = 1000) {
  for (let t = at; t <= at + 300; t += 33) {
    ingestLevels(LOUD, t);
    tickAudio(t);
  }
}

it('passes no echo and no moon when silent on Work (the draw options carry neither key)', () => {
  setReducedMotion(false);
  render(<HorizonCanvas now={() => NOON} />);
  runFrame(100);
  const o = draw.mock.lastCall![1];
  expect(o).not.toHaveProperty('echo');
  expect(o).not.toHaveProperty('moon');
});

it('passes the ripple from the active preset while music plays, and fades it in over about a second', () => {
  setReducedMotion(false);
  startMusic();
  render(<HorizonCanvas now={() => NOON} />);
  runFrame(100); // fade 0.1 s of 1
  const first = draw.mock.lastCall![1].echo!;
  expect(first).toMatchObject({ n: CAMERAS.work.en, amp: CAMERAS.work.eamp, cx: CAMERAS.work.ecx, hs: 900 });
  for (let ts = 200; ts <= 1500; ts += 100) runFrame(ts);
  const full = draw.mock.lastCall![1].echo!;
  expect(full.a).toBeGreaterThan(first.a);
  expect(full.a).toBeLessThanOrEqual(CAMERAS.work.ea);
});

it('fades the ripple out and then passes none once the music stops', () => {
  setReducedMotion(false);
  startMusic();
  render(<HorizonCanvas now={() => NOON} />);
  for (let ts = 100; ts <= 1500; ts += 100) runFrame(ts);
  expect(draw.mock.lastCall![1].echo).toBeTruthy();
  act(() => tickAudio(10_000)); // long silence: playing false
  const before = draw.mock.lastCall![1].echo!.a;
  runFrame(1600);
  expect(draw.mock.lastCall![1].echo!.a).toBeLessThan(before);
  for (let ts = 1700; ts <= 2900; ts += 100) runFrame(ts);
  expect(draw.mock.lastCall![1]).not.toHaveProperty('echo');
});

it('uses the Unwind preset for the ripple on Unwind', () => {
  setReducedMotion(false);
  startMusic();
  usePlaceStore.setState({ active: 'unwind' });
  render(<HorizonCanvas now={() => NOON} />);
  for (let ts = 100; ts <= 1300; ts += 100) runFrame(ts);
  expect(draw.mock.lastCall![1].echo).toMatchObject({ n: 11, amp: 34, cx: 1330 });
});

it('draws the moon on Unwind only', () => {
  setReducedMotion(false);
  usePlaceStore.setState({ active: 'unwind' });
  render(<HorizonCanvas now={() => NOON} />);
  runFrame(100);
  expect(draw.mock.lastCall![1].moon).toEqual([1730, 112, 44]);
  act(() => usePlaceStore.getState().setActive('home'));
  runFrame(200);
  expect(draw.mock.lastCall![1]).not.toHaveProperty('moon');
  act(() => usePlaceStore.getState().setActive('work'));
  runFrame(300);
  expect(draw.mock.lastCall![1]).not.toHaveProperty('moon');
});

it('shows the moon only after the glide to Unwind has finished, and hides it when a glide away starts', () => {
  setReducedMotion(false);
  render(<HorizonCanvas now={() => NOON} />);
  runFrame(100);
  act(() => usePlaceStore.getState().setActive('unwind'));
  for (let ts = 200; ts <= 1500; ts += 100) {
    runFrame(ts);
    expect(draw.mock.lastCall![1]).not.toHaveProperty('moon');
  }
  for (let ts = 1600; ts <= 2000; ts += 100) runFrame(ts);
  expect(draw.mock.lastCall![1].moon).toEqual([1730, 112, 44]);
  act(() => usePlaceStore.getState().setActive('work'));
  runFrame(2100);
  expect(draw.mock.lastCall![1]).not.toHaveProperty('moon');
});

it('draws the moon on Unwind under reduced motion, where there is no glide', () => {
  setReducedMotion(true);
  render(<HorizonCanvas now={() => NOON} />);
  act(() => usePlaceStore.getState().setActive('unwind'));
  expect(draw.mock.lastCall![1].moon).toEqual([1730, 112, 44]);
});

it('hidden pages restart the ripple from nothing', () => {
  setReducedMotion(false);
  startMusic();
  render(<HorizonCanvas now={() => NOON} />);
  for (let ts = 100; ts <= 1500; ts += 100) runFrame(ts);
  expect(draw.mock.lastCall![1].echo!.a).toBeGreaterThan(0.1);
  setHidden(true);
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
  setHidden(false);
  runFrame(1600);
  expect(draw.mock.lastCall![1].echo!.a).toBeLessThan(0.1);
});

it('draws no ripple under reduced motion even while music plays', () => {
  setReducedMotion(true);
  startMusic();
  render(<HorizonCanvas now={() => NOON} />);
  expect(draw.mock.lastCall![1]).not.toHaveProperty('echo');
});

it('draws no ripple in the review still, even with music playing; ?hz=unwind has the moon, others do not', () => {
  setReducedMotion(false);
  startMusic();
  window.history.replaceState(null, '', '/?hz=unwind&at=2026-11-11T16:00:00Z');
  const { unmount } = render(<HorizonCanvas now={() => 0} />);
  let o = draw.mock.lastCall![1];
  expect(o).not.toHaveProperty('echo');
  expect(o.moon).toEqual([1730, 112, 44]);
  unmount();
  window.history.replaceState(null, '', '/?hz=home&at=2026-11-11T16:00:00Z');
  render(<HorizonCanvas now={() => 0} />);
  o = draw.mock.lastCall![1];
  expect(o).not.toHaveProperty('echo');
  expect(o).not.toHaveProperty('moon');
});

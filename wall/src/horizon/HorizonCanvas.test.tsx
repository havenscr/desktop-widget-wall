import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HorizonCanvas } from './HorizonCanvas';
import { CAMERAS, HOME_MORNING, drawHorizon } from './index';
import type { CameraPreset } from './cameras';
import { stubContext } from './canvasStub';
import { fitScale, STAGE_HEIGHT, STAGE_WIDTH } from '../stage/fitScale';
import { usePlaceStore } from '../state/places';
import { ingestLevels, resetAudio, tickAudio } from '../audio/store';

vi.mock('./index', async (original) => ({
  ...(await original<typeof import('./index')>()),
  drawHorizon: vi.fn(),
}));

const NOON = new Date(2026, 10, 11, 12, 0).getTime(); // local noon, after the morning view
const draw = vi.mocked(drawHorizon);

/** A local-time moment on 2026-11-11, so the morning rule gives the same answer in any time zone. */
const localMs = (hour: number, minute = 0) => new Date(2026, 10, 11, hour, minute).getTime();
/** Review URL query for Home at a local time. */
const homeAt = (hour: number, minute = 0) => `/?hz=home&at=${new Date(localMs(hour, minute)).toISOString()}`;

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
  window.history.replaceState(null, '', homeAt(16, 30));
  setHidden(true);
  render(<HorizonCanvas now={() => 0} />);
  expect(draw).not.toHaveBeenCalled();
  setHidden(false);
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
  expect(draw).toHaveBeenCalledTimes(1);
  expect(draw.mock.lastCall![1]).toMatchObject({ camera: CAMERAS.home, ms: localMs(16, 30), t: 0, phase: 0 });
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
  window.history.replaceState(null, '', homeAt(16, 30));
  render(<HorizonCanvas now={() => 0} />);
  o = draw.mock.lastCall![1];
  expect(o).not.toHaveProperty('echo');
  expect(o).not.toHaveProperty('moon');
});

it('does not draw while Zen is active, and resumes (gliding from the old camera) on leaving', () => {
  setReducedMotion(false);
  render(<HorizonCanvas now={() => NOON} />);
  runFrame(100);
  act(() => usePlaceStore.getState().setActive('zen'));
  expect(frames.size).toBe(0);
  draw.mockClear();
  expect(document.querySelector('canvas')!.style.display).toBe('none');
  expect(draw).not.toHaveBeenCalled();
  act(() => usePlaceStore.getState().setActive('home'));
  expect(document.querySelector('canvas')!.style.display).toBe('');
  runFrame(200);
  expect(draw).toHaveBeenCalled();
  const cam = draw.mock.lastCall![1].camera!;
  // Strictly between Work and Home: a jump (or no glide) would fail.
  expect(cam.az0).toBeLessThan(CAMERAS.work.az0);
  expect(cam.az0).toBeGreaterThan(CAMERAS.home.az0);
});

it('leaving Zen back to the same place does not glide, so the Unwind moon stays', () => {
  setReducedMotion(false);
  usePlaceStore.setState({ active: 'unwind' });
  render(<HorizonCanvas now={() => NOON} />);
  runFrame(100);
  act(() => usePlaceStore.getState().setActive('zen'));
  act(() => usePlaceStore.getState().setActive('unwind'));
  runFrame(200);
  const o = draw.mock.lastCall![1];
  expect(o.camera).toEqual(CAMERAS.unwind);
  expect(o.moon).toBeDefined();
});

it('reduced motion: no timer redraw while Zen is active', () => {
  setReducedMotion(true);
  vi.useFakeTimers();
  render(<HorizonCanvas now={() => NOON} />);
  act(() => usePlaceStore.getState().setActive('zen'));
  draw.mockClear();
  act(() => void vi.advanceTimersByTime(180_000));
  expect(draw).not.toHaveBeenCalled();
});

describe('Home morning view', () => {
  const MORNING = localMs(7, 12);
  const AFTERNOON = localMs(16, 30);
  const canvases = () => Array.from(document.querySelectorAll('canvas'));

  it('the Home place passes the morning preset, on the panorama, to drawHorizon in the morning', () => {
    setReducedMotion(false);
    usePlaceStore.setState({ active: 'home' });
    render(<HorizonCanvas now={() => MORNING} />);
    runFrame(100);
    expect(draw.mock.lastCall![1].camera).toBe(HOME_MORNING);
    expect(draw.mock.lastCall![1].camera!.ter).toBe('pano');
    expect(canvases()).toHaveLength(1); // one canvas: nothing fades
  });

  it('the morning camera never passes an echo, even while music plays', () => {
    setReducedMotion(false);
    startMusic();
    usePlaceStore.setState({ active: 'home' });
    render(<HorizonCanvas now={() => MORNING} />);
    for (let ts = 100; ts <= 2000; ts += 100) runFrame(ts);
    expect(draw.mock.calls.length).toBeGreaterThan(5);
    expect(draw.mock.lastCall![1].camera).toBe(HOME_MORNING);
    for (const c of draw.mock.calls) expect(c[1]).not.toHaveProperty('echo');
  });

  it('Work and Unwind keep their cameras in the morning', () => {
    setReducedMotion(false);
    render(<HorizonCanvas now={() => MORNING} />);
    runFrame(100);
    expect(draw.mock.lastCall![1].camera).toBe(CAMERAS.work);
    act(() => usePlaceStore.getState().setActive('unwind'));
    for (let ts = 200; ts <= 2000; ts += 100) runFrame(ts);
    expect(draw.mock.lastCall![1].camera).toBe(CAMERAS.unwind);
    expect(canvases()).toHaveLength(1); // one canvas: nothing fades
  });

  /** Run `n` frames 0.1 s apart after `ts`; returns the last timestamp and the cameras drawn. */
  function frames(ts: number, n: number) {
    const cams: CameraPreset[] = [];
    for (let i = 0; i < n; i++) {
      runFrame((ts += 100));
      cams.push(draw.mock.lastCall![1].camera!);
    }
    return { ts, cams };
  }
  // 4.6 s at 0.1 s a frame: progress reaches 1 on frame 47 (46 steps of 0.1 / 4.6 sum to just under 1).
  const CINEMATIC_FRAMES = 47;

  it('the first turn this morning (Work to Home at 07:12) is the cinematic move: 4.6 s, pull-back and lower horizon mid-turn, one canvas', () => {
    setReducedMotion(false);
    render(<HorizonCanvas now={() => MORNING} />);
    runFrame(100);
    act(() => usePlaceStore.getState().setActive('home'));
    draw.mockClear();
    const { cams } = frames(100, CINEMATIC_FRAMES);
    expect(draw).toHaveBeenCalledTimes(CINEMATIC_FRAMES); // one draw per frame: no layer underneath
    expect(canvases()).toHaveLength(1); // one canvas: nothing fades
    const mid = cams[22]; // 2.3 s: k 0.5
    expect(mid.az0).toBeCloseTo((221.5 + 132) / 2, 6);
    expect(mid.ppd).toBeCloseTo((34 + 42) / 2 - 10, 6);
    expect(mid.hy).toBeCloseTo(582 + 14, 6);
    for (let i = 1; i < cams.length; i++) expect(cams[i].az0).toBeLessThanOrEqual(cams[i - 1].az0);
    for (const c of cams) expect(c.az0 + 2560 / c.ppd).toBeLessThanOrEqual(299.8 + 1e-9);
    expect(cams[CINEMATIC_FRAMES - 2]).not.toBe(HOME_MORNING); // still arriving at 4.6 s minus a frame
    expect(cams[CINEMATIC_FRAMES - 1]).toBe(HOME_MORNING);
  });

  it('a later turn the same morning is the plain 3.2 s swing with the cubic ease, and the next morning plays the cinematic move again', () => {
    setReducedMotion(false);
    let ms = MORNING;
    render(<HorizonCanvas now={() => ms} />);
    runFrame(100);
    act(() => usePlaceStore.getState().setActive('home'));
    let { ts } = frames(100, CINEMATIC_FRAMES);
    act(() => usePlaceStore.getState().setActive('work'));
    ({ ts } = frames(ts, 32));
    expect(draw.mock.lastCall![1].camera).toBe(CAMERAS.work);
    ms = localMs(9, 40); // later the same morning
    act(() => usePlaceStore.getState().setActive('home'));
    let run = frames(ts, 32);
    expect(run.cams[15].hy).toBe(582); // no lift: a plain swing
    expect(run.cams[15].az0).toBeCloseTo(221.5 + (132 - 221.5) * 0.5, 6); // cubic ease is halfway at 1.6 s
    expect(run.cams[31]).toBe(HOME_MORNING); // arrives at 3.2 s
    act(() => usePlaceStore.getState().setActive('work'));
    ({ ts } = frames(run.ts, 32));
    ms = new Date(2026, 10, 12, 7, 12).getTime(); // the next morning
    act(() => usePlaceStore.getState().setActive('home'));
    run = frames(ts, CINEMATIC_FRAMES);
    expect(run.cams[22].hy).toBeCloseTo(596, 6);
    expect(run.cams[CINEMATIC_FRAMES - 1]).toBe(HOME_MORNING);
  });

  it('11:30 AM arriving a quarter of the way into the cinematic turn sends the camera back over the full 3.2 s', () => {
    setReducedMotion(false);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let ms = localMs(11, 29);
    render(<HorizonCanvas now={() => ms} />);
    runFrame(100);
    act(() => usePlaceStore.getState().setActive('home'));
    let { ts, cams } = frames(100, 12); // 1.2 s of 4.6: about a quarter of the way
    expect(cams[11].hy).toBeGreaterThan(582); // the cinematic move is running
    ms = localMs(11, 31);
    act(() => void vi.advanceTimersByTime(60_000));
    ({ cams } = frames(ts, 32));
    expect(cams[30]).not.toBe(CAMERAS.home); // still moving at 3.1 s
    expect(cams[31]).toBe(CAMERAS.home); // arrives at 3.2 s
  });

  it('5:00 AM passing while Home is open plays the cinematic move (the first turn of the day)', () => {
    setReducedMotion(false);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let ms = localMs(4, 59);
    usePlaceStore.setState({ active: 'home' });
    render(<HorizonCanvas now={() => ms} />);
    runFrame(100);
    expect(draw.mock.lastCall![1].camera).toBe(CAMERAS.home);
    ms = localMs(5, 1);
    act(() => void vi.advanceTimersByTime(60_000));
    const { cams } = frames(100, CINEMATIC_FRAMES);
    expect(cams[22].ppd).toBeCloseTo((54 + 42) / 2 - 10, 6);
    expect(cams[22].hy).toBeCloseTo(596, 6);
    expect(cams[CINEMATIC_FRAMES - 1]).toBe(HOME_MORNING);
  });

  it('a short move (Work to Home in the afternoon) is the usual 1.6 second glide', () => {
    setReducedMotion(false);
    render(<HorizonCanvas now={() => AFTERNOON} />);
    runFrame(100);
    act(() => usePlaceStore.getState().setActive('home'));
    draw.mockClear();
    runFrame(200);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(canvases()).toHaveLength(1); // one canvas: nothing fades
    const cam = draw.mock.lastCall![1].camera!;
    expect(cam.az0).toBeLessThan(CAMERAS.work.az0);
    expect(cam.az0).toBeGreaterThan(CAMERAS.home.az0);
    for (let ts = 300; ts <= 1700; ts += 100) runFrame(ts); // 1.6 s in
    expect(draw.mock.lastCall![1].camera).toBe(CAMERAS.home);
  });

  it('reduced motion jumps straight to the morning view, with one layer', () => {
    setReducedMotion(true);
    render(<HorizonCanvas now={() => MORNING} />);
    draw.mockClear();
    act(() => usePlaceStore.getState().setActive('home'));
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw.mock.lastCall![1].camera).toBe(HOME_MORNING);
    expect(canvases()).toHaveLength(1); // one canvas: nothing fades
  });

  it('the review still uses the rule for its time, with no glide', () => {
    setReducedMotion(false);
    window.history.replaceState(null, '', homeAt(7, 12));
    render(<HorizonCanvas now={() => 0} />);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw.mock.lastCall![1].camera).toBe(HOME_MORNING);
    expect(canvases()).toHaveLength(1); // one canvas: nothing fades
    expect(rafSpy).not.toHaveBeenCalled();
    cleanup();
    draw.mockClear();
    window.history.replaceState(null, '', homeAt(16, 30));
    render(<HorizonCanvas now={() => 0} />);
    expect(draw.mock.lastCall![1].camera).toBe(CAMERAS.home);
  });

  it('11:30 AM passing while Home is open swings back to the west Home view', () => {
    setReducedMotion(false);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); // keep the mocked animation frames
    let ms = localMs(11, 29);
    usePlaceStore.setState({ active: 'home' });
    render(<HorizonCanvas now={() => ms} />);
    runFrame(100);
    expect(draw.mock.lastCall![1].camera).toBe(HOME_MORNING);
    ms = localMs(11, 31);
    act(() => void vi.advanceTimersByTime(60_000));
    draw.mockClear();
    const az: number[] = [];
    for (let ts = 200; ts <= 3300; ts += 100) {
      runFrame(ts);
      az.push(draw.mock.lastCall![1].camera!.az0);
    }
    expect(draw).toHaveBeenCalledTimes(az.length); // no fade layer
    expect(canvases()).toHaveLength(1); // one canvas: nothing fades
    for (let i = 1; i < az.length; i++) expect(az[i]).toBeGreaterThan(az[i - 1]);
    for (const c of draw.mock.calls) expect(c[1].camera!.hy).toBe(582); // the plain swing: no lift
    expect(draw.mock.lastCall![1].camera).toBe(CAMERAS.home);
  });

  it('5:00 AM passing under reduced motion switches the still frame at once', () => {
    setReducedMotion(true);
    vi.useFakeTimers();
    let ms = localMs(4, 59);
    usePlaceStore.setState({ active: 'home' });
    render(<HorizonCanvas now={() => ms} />);
    expect(draw.mock.lastCall![1].camera).toBe(CAMERAS.home);
    ms = localMs(5, 1);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(draw.mock.lastCall![1].camera).toBe(HOME_MORNING);
    expect(canvases()).toHaveLength(1); // one canvas: nothing fades
  });

  it('passes no ripple at any point of the turn to Rainier or the swing back, even while music plays', () => {
    setReducedMotion(false);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    startMusic();
    let ms = MORNING;
    render(<HorizonCanvas now={() => ms} />);
    for (let ts = 100; ts <= 1500; ts += 100) runFrame(ts);
    expect(draw.mock.lastCall![1].echo!.a).toBeGreaterThan(0); // Work ripples
    act(() => usePlaceStore.getState().setActive('home'));
    draw.mockClear();
    for (let ts = 1600; ts <= 6200; ts += 100) runFrame(ts); // the cinematic move, 47 frames
    expect(draw.mock.lastCall![1].camera).toBe(HOME_MORNING);
    for (const c of draw.mock.calls) expect(c[1]).not.toHaveProperty('echo');
    ms = AFTERNOON;
    act(() => void vi.advanceTimersByTime(60_000));
    draw.mockClear();
    for (let ts = 6300; ts <= 9300; ts += 100) runFrame(ts); // 31 of the swing's 32 frames
    expect(draw).toHaveBeenCalledTimes(31);
    for (const c of draw.mock.calls) expect(c[1]).not.toHaveProperty('echo');
    expect(draw.mock.lastCall![1].camera).not.toBe(CAMERAS.home);
    runFrame(9400); // arrived on the west Home view: the ripple returns
    expect(draw.mock.lastCall![1].camera).toBe(CAMERAS.home);
    expect(draw.mock.lastCall![1].echo!.a).toBeGreaterThan(0);
  });
});

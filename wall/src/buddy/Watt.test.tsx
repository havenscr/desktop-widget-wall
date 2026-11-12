import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAudio, ingestLevels, tickAudio } from '../audio/store';
import { CAMERAS, CINEMATIC_SECONDS, HOME_MORNING, SWING_SECONDS, type CameraPreset } from '../horizon/cameras';
import { stubContext } from '../horizon/canvasStub';
import { HorizonCanvas } from '../horizon/HorizonCanvas';
import { publishCamera } from '../horizon/signal';
import { usePlaceStore, type PlaceId } from '../state/places';
import { FADE_IN_S, FADE_OUT_S, WALKS, middle, type WattPlace } from './model';
import { Watt } from './Watt';

vi.mock('../horizon/index', async (original) => ({
  ...(await original<typeof import('../horizon/index')>()),
  drawHorizon: vi.fn(),
}));

let frames: Map<number, FrameRequestCallback>;
let nextId = 1;
let ts = 0;
const local = (h: number, m = 0, s = 0) => new Date(2026, 10, 11, h, m, s).getTime();
const day = () => local(14);
const night = () => local(23);

/** Run every scheduled frame callback once at the next timestamp (50 ms later). */
function tick() {
  ts += 50;
  const due = [...frames.entries()];
  frames.clear();
  act(() => {
    for (const [, cb] of due) cb(ts);
  });
}
const runFor = (s: number) => {
  for (let i = 0; i < Math.round(s / 0.05); i++) tick();
};

let reduceOn = false;
let mqListeners: (() => void)[] = [];
function reduced(on: boolean) {
  reduceOn = on;
  window.matchMedia = ((q: string) => ({
    get matches() {
      return reduceOn && q.includes('reduce');
    },
    media: q,
    addEventListener: (_: string, fn: () => void) => void mqListeners.push(fn),
    removeEventListener() {},
  })) as never;
}
function flipReduced(on: boolean) {
  reduceOn = on;
  act(() => mqListeners.forEach((fn) => fn()));
}
const go = (id: PlaceId) => act(() => usePlaceStore.getState().setActive(id));
const horizon = (to: CameraPreset | null, moving = false) => act(() => publishCamera(to, moving));

function where(container: HTMLElement) {
  const sheep = container.querySelector<HTMLElement>('.watt-sheep')!;
  const m = /translate\(([\d.]+)px,\s*([\d.]+)px\)/.exec(sheep.style.transform) ?? [0, NaN, NaN];
  const svg = container.querySelector('svg')!;
  return {
    x: Number(m[1]),
    feet: Number(m[2]) + Number(svg.getAttribute('height')),
    width: Number(svg.getAttribute('width')),
    opacity: Number(container.querySelector<HTMLElement>('.watt')!.style.opacity || 0),
  };
}

beforeEach(() => {
  frames = new Map();
  ts = 0;
  mqListeners = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    const id = nextId++;
    frames.set(id, cb);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => void frames.delete(id));
  usePlaceStore.setState({ active: 'unwind' });
  publishCamera(CAMERAS.unwind, false);
  resetAudio();
  reduced(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  publishCamera(null, false);
});

it('stands on each place horizon at that place size once the camera is settled: Work, Home and Meet on 582, Unwind on 505', () => {
  const cases: [WattPlace, number, number][] = [
    ['work', 582, 18 * 4],
    ['home', 582, 18 * 5],
    ['meet', 582, 18 * 4],
    ['unwind', 505, 18 * 6],
  ];
  for (const [place, feet, width] of cases) {
    usePlaceStore.setState({ active: place });
    publishCamera(CAMERAS[place], false);
    const { container, unmount } = render(<Watt now={day} />);
    runFor(FADE_IN_S + 0.2);
    const w = where(container);
    expect(w.feet).toBe(feet);
    expect(w.width).toBe(width);
    expect(w.x).toBe(middle(WALKS[place]));
    expect(w.opacity).toBe(1);
    unmount();
  }
});

it('is not shown, and runs no frame loop, on Zen; not shown on Meet during a call', () => {
  usePlaceStore.setState({ active: 'zen' });
  const { container, rerender } = render(<Watt now={day} />);
  expect(frames.size).toBe(0);
  expect(where(container).opacity).toBe(0);
  publishCamera(CAMERAS.meet, false);
  go('meet');
  rerender(<Watt now={day} inCall />);
  runFor(2);
  expect(where(container).opacity).toBe(0);
  expect(frames.size).toBe(0);
  rerender(<Watt now={day} />);
  runFor(2);
  expect(where(container).opacity).toBe(1);
});

it('a place change: hidden while the camera moves, then up at the new place, never in between', () => {
  usePlaceStore.setState({ active: 'work' });
  publishCamera(CAMERAS.work, false);
  const { container } = render(<Watt now={day} />);
  runFor(1.5);
  go('home');
  horizon(CAMERAS.home, true);
  const xs: number[] = [];
  for (let i = 0; i < Math.round(1.6 / 0.05); i++) {
    tick();
    const w = where(container);
    if (w.opacity > 0) xs.push(w.x);
    if (i * 0.05 > FADE_OUT_S) expect(w.opacity).toBe(0);
  }
  horizon(CAMERAS.home, false);
  runFor(FADE_IN_S + 0.2);
  for (const x of xs) expect(x >= WALKS.work.min && x <= WALKS.work.max).toBe(true);
  const w = where(container);
  expect(w).toMatchObject({ x: middle(WALKS.home), width: 18 * 5, opacity: 1 });
});

it('shows notes while music plays and drifting z at night', () => {
  const { container, unmount } = render(<Watt now={day} />);
  act(() => {
    ingestLevels({ bass: 0.5, mid: 0.5, high: 0.5, waveform: [1], bands: [1] }, 1000);
    tickAudio(1000);
  });
  runFor(1.2);
  expect(Number(container.querySelector<HTMLElement>('.watt-note')!.style.opacity)).toBeGreaterThan(0);
  unmount();
  resetAudio();
  const n = render(<Watt now={night} />);
  runFor(1.2);
  expect(Number(n.container.querySelector<HTMLElement>('.watt-note')!.style.opacity)).toBe(0);
  expect(Number(n.container.querySelector<HTMLElement>('.watt-z')!.style.opacity)).toBeGreaterThan(0);
});

describe('reduced motion', () => {
  it('draws once, runs no frame loop, and jumps on a place change once the horizon has', () => {
    reduced(true);
    usePlaceStore.setState({ active: 'work' });
    publishCamera(CAMERAS.work, false);
    const { container } = render(<Watt now={day} />);
    expect(frames.size).toBe(0);
    expect(where(container)).toMatchObject({ x: 985, opacity: 1 });
    go('home');
    expect(where(container).opacity).toBe(0);
    horizon(CAMERAS.home);
    expect(where(container)).toMatchObject({ x: 1616, opacity: 1 });
    go('zen');
    expect(where(container).opacity).toBe(0);
  });

  it('repaints at once when a call starts or ends', () => {
    reduced(true);
    usePlaceStore.setState({ active: 'meet' });
    publishCamera(CAMERAS.meet, false);
    const { container, rerender } = render(<Watt now={day} />);
    expect(where(container).opacity).toBe(1);
    rerender(<Watt now={day} inCall />);
    expect(where(container).opacity).toBe(0);
    rerender(<Watt now={day} />);
    expect(where(container).opacity).toBe(1);
  });

  it('toggling it keeps Watt where it is (no fade from nothing, no restart)', () => {
    usePlaceStore.setState({ active: 'work' });
    publishCamera(CAMERAS.work, false);
    const { container } = render(<Watt now={day} />);
    runFor(2);
    expect(where(container).opacity).toBe(1);
    flipReduced(true);
    expect(where(container)).toMatchObject({ opacity: 1, x: 985 });
    flipReduced(false);
    tick();
    expect(where(container).opacity).toBe(1);
  });

  it('does not paint while hidden, and paints once visible again', () => {
    reduced(true);
    vi.useFakeTimers();
    const clock = vi.fn(day);
    const hide = (h: boolean) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    const { container } = render(<Watt now={clock} />);
    const before = container.querySelector<HTMLElement>('.watt-sheep')!.style.transform;
    hide(true);
    act(() => void vi.advanceTimersByTime(180_000));
    expect(container.querySelector<HTMLElement>('.watt-sheep')!.style.transform).toBe(before);
    hide(false);
    expect(container.querySelector<HTMLElement>('.watt-sheep')!.style.transform).toBe(before);
    expect(where(container).opacity).toBe(1);
  });
});

it('stops its frame loop on unmount', () => {
  const { unmount } = render(<Watt now={day} />);
  expect(frames.size).toBe(1);
  unmount();
  expect(frames.size).toBe(0);
});

describe('with the real horizon on Home', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => stubContext() as never);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    publishCamera(null, false);
  });

  /**
   * Mount Home at an off-minute `start`, then run the wall clock and the frames together for
   * `seconds`, 50 ms a frame. Returns, per frame, the clock and Watt's opacity.
   */
  function crossing(start: number, seconds: number) {
    let ms = start;
    usePlaceStore.setState({ active: 'home' });
    const now = () => ms;
    const { container } = render(
      <>
        <HorizonCanvas now={now} />
        <Watt now={now} />
      </>,
    );
    const out: { ms: number; opacity: number }[] = [];
    for (let i = 0; i < Math.round(seconds / 0.05); i++) {
      ms += 50;
      act(() => void vi.advanceTimersByTime(50));
      tick();
      out.push({ ms, opacity: where(container).opacity });
    }
    return out;
  }

  it('5:00 AM: hidden from the hour until the cinematic turn to Rainier has finished, then back', () => {
    const start = local(4, 59, 25);
    const trace = crossing(start, 35 + 60 + CINEMATIC_SECONDS + 3);
    const hour = local(5);
    // The horizon looks once a minute from mount, so it turns at 5:00:25 and settles 4.6 s later.
    const settle = local(5, 0, 25) + CINEMATIC_SECONDS * 1000 - 100; // within a frame or two of the end
    expect(trace.find((s) => s.ms === hour - 1000)!.opacity).toBe(1);
    for (const s of trace) {
      if (s.ms >= hour + FADE_OUT_S * 1000 && s.ms <= settle) expect(s.opacity, new Date(s.ms).toTimeString()).toBe(0);
    }
    expect(trace[trace.length - 1].opacity).toBe(1);
  });

  it('11:30 AM: hidden from the hour until the swing back west has finished, then back', () => {
    const start = local(11, 29, 25);
    const trace = crossing(start, 35 + 60 + SWING_SECONDS + 3);
    const hour = local(11, 30);
    const settle = local(11, 30, 25) + SWING_SECONDS * 1000 - 100;
    expect(trace.find((s) => s.ms === hour - 1000)!.opacity).toBe(1);
    for (const s of trace) {
      if (s.ms >= hour + FADE_OUT_S * 1000 && s.ms <= settle) expect(s.opacity, new Date(s.ms).toTimeString()).toBe(0);
    }
    expect(trace[trace.length - 1].opacity).toBe(1);
  });

  it('the horizon publishes where it is heading and whether it moves', async () => {
    const { cameraSignal } = await import('../horizon/signal');
    usePlaceStore.setState({ active: 'work' });
    render(<HorizonCanvas now={day} />);
    expect(cameraSignal()).toMatchObject({ to: CAMERAS.work, moving: false });
    go('home');
    expect(cameraSignal()).toMatchObject({ to: CAMERAS.home, moving: true });
    runFor(2);
    expect(cameraSignal()).toMatchObject({ to: CAMERAS.home, moving: false });
    expect(HOME_MORNING).not.toBe(CAMERAS.home);
  });
});

import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ingestLevels, resetAudio, tickAudio } from '../audio/store';
import { CAMERAS } from '../horizon/cameras';
import { publishCamera } from '../horizon/signal';
import { usePlaceStore } from '../state/places';
import { useSignalStore } from '../signals/store';
import { useChipLayout } from '../signals/layout';
import { driveInAudience, useWatchStore } from '../unwind/watch/store';
import { resetAgents } from '../agents/useAgents';
import { useFocusStore } from '../focus/store';
import { resetMeetingFeed } from '../work/useNextMeeting';
import { resetWeatherStore } from '../weather/useWeather';
import { seatFor, seatReach, SEAT_GAP_MIN, type ScreenRect } from './audience';
import { WATCH_GROUND } from './ground';
import { PET_KEY } from './pet';
import { BLINKS, POSES, SPRITES, pixelColor, type Pose } from './sprites';
import { Watt, restClock } from './Watt';

/**
 * The drive-in: Watt walks to a seat left of the screen while a show is on, watches, and goes back
 * when it ends. `screen.rect` stands in for the Watch store's `driveInAudience` (two invented
 * rectangles, so the seat is shown to follow whatever the selector gives); one test uses the real
 * selector with the drive-in look on.
 */
// These tests step timers for minutes of his time: a 20 second limit each.
vi.setConfig({ testTimeout: 20_000 });
const screen = vi.hoisted(() => ({ rect: null as ScreenRect | null }));
vi.mock('../unwind/watch/store', async (original) => {
  const real = await original<typeof import('../unwind/watch/store')>();
  return { ...real, driveInAudience: (s: Parameters<typeof real.driveInAudience>[0]) => (screen.rect ? (s.playing ? screen.rect : null) : real.driveInAudience(s)) };
});
const idleState = vi.hoisted(() => ({ on: false }));
vi.mock('../ui/useIdle', () => ({ useIdle: () => idleState.on }));
vi.mock('../bridge/tauri', async (original) => ({
  ...(await original<typeof import('../bridge/tauri')>()),
  invoke: vi.fn(() => new Promise(() => {})),
}));
vi.mock('../ribbon/sun', async (original) => ({
  ...(await original<typeof import('../ribbon/sun')>()),
  sunTimes: () => ({ rise: null, set: null }),
}));

const A: ScreenRect = Object.freeze({ x: 1240, y: 70, w: 680, h: 382 });
const B: ScreenRect = Object.freeze({ x: 900, y: 90, w: 600, h: 338 });
const FILM = { kind: 'video', id: 'aaaaaaaaaaa', label: 'An invented film' } as never;

let frames: Map<number, FrameRequestCallback>;
let rests: Map<number, { fn: () => void; due: number }>;
let nextId = 1;
let ts = 0;
const realRest = { ...restClock };
const local = (h: number, m = 0) => new Date(2026, 10, 11, h, m).getTime();
const day = () => local(14);
const late = () => local(23);

function tick() {
  ts += 50;
  const due = [...frames.entries()];
  frames.clear();
  act(() => {
    for (const [, cb] of due) cb(ts);
    for (const [id, r] of [...rests.entries()]) {
      if (r.due > ts || !rests.has(id)) continue;
      rests.delete(id);
      r.fn();
    }
  });
}
const runFor = (s: number) => {
  for (let i = 0; i < Math.round(s / 0.05); i++) tick();
};
let reduceOn = false;
function reduced(on: boolean) {
  reduceOn = on;
  window.matchMedia = ((q: string) => ({
    get matches() {
      return reduceOn && q.includes('reduce');
    },
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as never;
}

const sheepOf = (c: HTMLElement) => c.querySelector<HTMLElement>('.watt-sheep')!;
const xOf = (c: HTMLElement) => Number(/translate\((-?[\d.]+)px/.exec(sheepOf(c).style.transform)![1]);
const dirOf = (c: HTMLElement) => Math.sign(Number(/scaleX\((-?[\d.]+)\)/.exec(sheepOf(c).style.transform)![1]));
const showOf = (c: HTMLElement) => c.querySelector<HTMLElement>('.watt')!.dataset.show ?? '';
const stored = () => JSON.parse(localStorage.getItem(PET_KEY) ?? '{}');
/** The pose drawn now (and whether his eyes are shut), read back from the sprite's pixels. */
function poseOf(c: HTMLElement): string {
  const rects = [...sheepOf(c).querySelectorAll(':scope > svg rect')];
  const px = Number(rects[0]?.getAttribute('width') ?? 1);
  const drawn = rects.map((r) => `${Number(r.getAttribute('x')) / px},${Number(r.getAttribute('y')) / px},${r.getAttribute('fill')}`).sort().join('|');
  const sig = (map: readonly string[]) => {
    const out: string[] = [];
    map.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const col = pixelColor(map, x, y);
        if (col) out.push(`${x},${y},${col}`);
      }
    });
    return out.sort().join('|');
  };
  for (const p of POSES) {
    if (sig(SPRITES[p]) === drawn) return p;
    if (sig(BLINKS[p as Pose]) === drawn) return `${p} blink`;
  }
  return 'unknown';
}
const play = (rect: ScreenRect | null = A) =>
  act(() => {
    screen.rect = rect;
    useWatchStore.setState({ tab: 'watch', playing: FILM, paused: false });
  });
const stopShow = () => act(() => useWatchStore.setState({ playing: null }));

beforeEach(() => {
  frames = new Map();
  rests = new Map();
  restClock.set = (fn, ms) => {
    const id = nextId++;
    rests.set(id, { fn, due: ts + ms });
    return id;
  };
  restClock.clear = (id) => void rests.delete(id);
  vi.spyOn(performance, 'now').mockImplementation(() => ts);
  ts = 0;
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
  idleState.on = false;
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  localStorage.clear();
  screen.rect = null;
  act(() => useWatchStore.getState().setTab('watch'));
});
afterEach(() => {
  Object.assign(restClock, realRest);
  act(() => useWatchStore.setState({ playing: null, paused: false }));
  act(() => useWatchStore.getState().setTab('listen'));
  act(() => useChipLayout.setState({ banner: false }));
  act(() => useSignalStore.setState({ known: false, recording: false } as never));
  useFocusStore.setState({ state: { status: 'idle', minutes: 25 } });
  resetMeetingFeed();
  resetWeatherStore();
  resetAgents();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  publishCamera(null, false);
});

const start = (now: () => number = day) => {
  const r = render(<Watt now={now} />);
  runFor(1.5);
  return r;
};
/** Run until he sits in his seat (or the limit), seconds. */
const untilSeated = (c: HTMLElement, limit = 70) => {
  for (let t = 0; t < limit && showOf(c) !== 'seated'; t += 0.5) runFor(0.5);
};

describe('the drive-in', () => {
  it('he walks to his seat left of the screen when a show starts, sits turned to it, and walks back when it ends', () => {
    const { container } = start();
    const home = xOf(container);
    play(A);
    runFor(2);
    expect(showOf(container)).toBe('going');
    expect(xOf(container)).toBeGreaterThan(home);
    untilSeated(container);
    const seat = seatFor(A, WATCH_GROUND, 6)!;
    expect(showOf(container)).toBe('seated');
    expect(xOf(container)).toBe(seat);
    expect(xOf(container) + seatReach(6)).toBeLessThanOrEqual(A.x - SEAT_GAP_MIN);
    expect(dirOf(container)).toBe(1);
    expect(poseOf(container)).toBe('watch');
    stopShow();
    runFor(3);
    expect(showOf(container)).toBe('');
    expect(xOf(container)).toBeLessThan(seat);
    runFor(60);
    expect(Math.abs(xOf(container) - home)).toBeLessThanOrEqual(60);
  });

  it('the seat follows the rectangle the selector gives, also when it changes during a show', () => {
    const { container } = start();
    play(B);
    untilSeated(container);
    expect(xOf(container)).toBe(seatFor(B, WATCH_GROUND, 6));
    play(A);
    runFor(1);
    expect(showOf(container)).toBe('going');
    untilSeated(container);
    expect(xOf(container)).toBe(seatFor(A, WATCH_GROUND, 6));
    expect(seatFor(A, WATCH_GROUND, 6)).not.toBe(seatFor(B, WATCH_GROUND, 6));
  });

  it('with the real selector and the drive-in look on, he sits left of the rectangle it returns', () => {
    reduced(true);
    const { container } = render(<Watt now={day} />);
    act(() => useWatchStore.setState({ looks: { mode: 'one', all: 'drivein', video: 'drivein', live: 'drivein', twitch: 'drivein' } as never, playing: FILM, tab: 'watch' }));
    const rect = driveInAudience(useWatchStore.getState());
    expect(rect).not.toBeNull();
    expect(showOf(container)).toBe('seated');
    expect(xOf(container)).toBe(seatFor(rect!, WATCH_GROUND, 6));
  });

  it('under reduced motion he is simply in his seat, and simply back, with no frame loop', () => {
    reduced(true);
    const { container } = render(<Watt now={day} />);
    const home = xOf(container);
    play(A);
    expect(showOf(container)).toBe('seated');
    expect(xOf(container)).toBe(seatFor(A, WATCH_GROUND, 6));
    expect(poseOf(container)).toBe('watch');
    stopShow();
    expect(showOf(container)).toBe('');
    expect(xOf(container)).toBe(home);
    expect(frames.size).toBe(0);
  });

  it('set down during the show he stays there for the rest of it, watching, and that drop is kept as his spot', () => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    proto.setPointerCapture = () => {};
    proto.releasePointerCapture = () => {};
    proto.hasPointerCapture = () => false;
    const { container } = start();
    play(A);
    untilSeated(container);
    const hit = container.querySelector<HTMLElement>('.watt-hit')!;
    fireEvent.pointerDown(hit, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 1050, clientY: 470 });
    fireEvent.pointerMove(hit, { pointerId: 1, pointerType: 'mouse', clientX: 1060, clientY: 470 });
    fireEvent.pointerMove(hit, { pointerId: 1, pointerType: 'mouse', clientX: 400, clientY: 380 });
    runFor(0.6);
    fireEvent.pointerUp(hit, { pointerId: 1, pointerType: 'mouse', clientX: 400, clientY: 380 });
    runFor(3);
    const landed = xOf(container);
    expect(landed).toBeLessThan(500);
    expect(stored().spots.unwindWatch).toBe(Math.round(landed));
    runFor(90);
    expect(xOf(container)).toBe(landed);
    expect(showOf(container)).toBe('seated');
    expect(dirOf(container)).toBe(1);
    delete proto.setPointerCapture;
    delete proto.releasePointerCapture;
    delete proto.hasPointerCapture;
  });

  it('a show at night keeps him up; when it ends he goes back to sleep', () => {
    const { container } = start(late);
    expect(poseOf(container)).toBe('sleep');
    play(A);
    untilSeated(container, 80);
    expect(poseOf(container)).toBe('watch');
    stopShow();
    runFor(3);
    expect(poseOf(container)).toBe('sleep');
  });

  it('paused, he looks round at the viewer once, then back to the screen', () => {
    const { container } = start();
    play(A);
    untilSeated(container);
    act(() => useWatchStore.setState({ paused: true }));
    runFor(0.5);
    expect(poseOf(container)).toBe('front');
    runFor(3);
    expect(poseOf(container)).toBe('watch');
  });
});

describe('priority: what outranks watching', () => {
  it('the wall recording: he starts no walk and sits where he is; once it ends he goes on to his seat', () => {
    const { container } = start();
    const home = xOf(container);
    act(() => useSignalStore.setState({ known: true, recording: true } as never));
    play(A);
    runFor(10);
    expect(Math.abs(xOf(container) - home)).toBeLessThan(1);
    expect(showOf(container)).toBe('');
    act(() => useSignalStore.setState({ known: false, recording: false } as never));
    untilSeated(container);
    expect(xOf(container)).toBe(seatFor(A, WATCH_GROUND, 6));
  });

  it('recording that starts on his way: he sits down where he is and watches from there, quietly', () => {
    const { container } = start();
    play(A);
    runFor(8);
    act(() => useSignalStore.setState({ known: true, recording: true } as never));
    runFor(1);
    const at = xOf(container);
    expect(showOf(container)).toBe('seated');
    runFor(60);
    expect(xOf(container)).toBe(at);
    expect(poseOf(container)).toBe('watch');
  });

  it('reading with him (a focus session) and a call keep him off the seat', () => {
    act(() => useFocusStore.setState({ state: { status: 'running', minutes: 25, endAt: day() + 20 * 60_000 } as never }));
    const { container, rerender } = start();
    const home = xOf(container);
    play(A);
    runFor(10);
    expect(showOf(container)).toBe('');
    expect(xOf(container)).toBeLessThan(home + 60);
    act(() => useFocusStore.setState({ state: { status: 'idle', minutes: 25 } as never }));
    rerender(<Watt now={day} inCall />);
    runFor(10);
    expect(showOf(container)).toBe('');
    rerender(<Watt now={day} />);
    runFor(2);
    expect(showOf(container)).toBe('going');
  });
});

describe('cost while he watches', () => {
  it('seated, the frame loop rests for a minute, music playing included, though his signs of life still come', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(day());
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
    Object.assign(restClock, realRest);
    const { container } = render(<Watt now={() => Date.now()} />);
    const advance = (ms: number) => {
      for (let i = 0; i < ms / 100; i++) {
        act(() => void vi.advanceTimersByTime(100));
        tick();
      }
    };
    advance(1500);
    play(A);
    // (Frames here step 50 ms of his clock for every 100 ms of the timers: the walk takes twice as long.)
    for (let t = 0; t < 150 && showOf(container) !== 'seated'; t += 1) advance(1000);
    expect(showOf(container)).toBe('seated');
    // The film's sound: music notes and the beat drive frames when he stands; not while he watches.
    act(() => {
      ingestLevels({ bass: 0.5, mid: 0.5, high: 0.5, waveform: [1], bands: [1] }, Date.now());
      tickAudio(Date.now());
    });
    advance(500);
    const rafCalls = () => vi.mocked(window.requestAnimationFrame).mock.calls.length;
    const before = rafCalls();
    const poses = new Set<string>();
    for (let i = 0; i < 600; i++) {
      advance(100);
      poses.add(poseOf(container));
    }
    expect(rafCalls()).toBe(before);
    expect(Number(container.querySelector<HTMLElement>('.watt-note')!.style.opacity || 0)).toBe(0);
    // A sign of life (an ear, a dip of his head or a blink) came on the timer alone.
    expect(poses.size).toBeGreaterThan(1);
  });
});

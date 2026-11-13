import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAudio, ingestLevels, tickAudio } from '../audio/store';
import { CAMERAS, CINEMATIC_SECONDS, HOME_MORNING, SWING_SECONDS, type CameraPreset } from '../horizon/cameras';
import { stubContext } from '../horizon/canvasStub';
import { HorizonCanvas } from '../horizon/HorizonCanvas';
import { publishCamera } from '../horizon/signal';
import { usePlaceStore, type PlaceId } from '../state/places';
import { FADE_IN_S, FADE_OUT_S, WALKS, middle, type WattPlace } from './model';
import { resetAgents, useAgentsStore } from '../agents/useAgents';
import type { OmniSummary } from '../agents/model';
import { useFocusStore } from '../focus/store';
import { LINES } from './lines';
import { PET_KEY } from './pet';
import { resetMeetingFeed, useMeetingFeed } from '../work/useNextMeeting';
import { resetWeatherStore } from '../weather/useWeather';
import { CARD_DWELL_MS, CARD_GRACE_MS, PET_LINE_EVERY_MS, PET_REPLY_GAP_MS, Watt } from './Watt';

const defaultInvoke = vi.hoisted(() => (cmd: string) => (cmd === 'wall2_open_session' ? Promise.resolve() : new Promise(() => {})));
const invokeMock = vi.hoisted(() => vi.fn(defaultInvoke));
vi.mock('../bridge/tauri', async (original) => ({
  ...(await original<typeof import('../bridge/tauri')>()),
  invoke: invokeMock,
}));

vi.mock('../horizon/index', async (original) => ({
  ...(await original<typeof import('../horizon/index')>()),
  drawHorizon: vi.fn(),
}));

const stored = () => JSON.parse(localStorage.getItem(PET_KEY) ?? '{}');

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
  // No network in tests: the weather read fails quietly and she does not talk about weather.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  localStorage.clear();
  invokeMock.mockClear();
});
afterEach(() => {
  resetMeetingFeed();
  resetWeatherStore();
  invokeMock.mockImplementation(defaultInvoke);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  publishCamera(null, false);
  resetAgents();
  useFocusStore.setState({ state: { status: 'idle', minutes: 25 } });
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

it('requests no frames while it waits unseen for the camera, and wakes when the camera settles', () => {
  usePlaceStore.setState({ active: 'work' });
  publishCamera(CAMERAS.work, false);
  const { container } = render(<Watt now={day} />);
  runFor(1.5);
  go('home');
  horizon(CAMERAS.home, true);
  runFor(FADE_OUT_S + 0.2);
  expect(where(container).opacity).toBe(0);
  expect(frames.size).toBe(0);
  horizon(CAMERAS.home, true); // no change: still asleep
  expect(frames.size).toBe(0);
  horizon(CAMERAS.home, false);
  expect(frames.size).toBe(1);
  runFor(FADE_IN_S + 0.2);
  expect(where(container)).toMatchObject({ x: middle(WALKS.home), opacity: 1 });
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

  it('the horizon clears the signal when it unmounts, so it never sticks on moving', async () => {
    const { cameraSignal } = await import('../horizon/signal');
    usePlaceStore.setState({ active: 'work' });
    const { unmount } = render(<HorizonCanvas now={day} />);
    go('home');
    expect(cameraSignal().moving).toBe(true);
    unmount();
    expect(cameraSignal()).toMatchObject({ to: null, moving: false });
  });
});

describe('a pet', () => {
  const heartOpacity = (c: HTMLElement) => Number(c.querySelector<HTMLElement>('.watt-heart')!.style.opacity || 0);

  it('a click pets her: hearts, a wiggle, a pleased line; a second click within a few seconds adds nothing', () => {
    let ms = day();
    const { container } = render(<Watt now={() => ms} />);
    runFor(1.5);
    const sheep = container.querySelector<HTMLElement>('.watt-sheep')!;
    fireEvent.click(container.querySelector('.watt-hit')!);
    const dirs = new Set<string>();
    let hearts = 0;
    for (let i = 0; i < 30; i++) {
      tick();
      dirs.add(/scaleX\((-?1)\)/.exec(sheep.style.transform)![1]);
      hearts = Math.max(hearts, heartOpacity(container));
    }
    expect(hearts).toBeGreaterThan(0);
    expect(dirs.size).toBe(2);
    const bubble = container.querySelector('.watt-bubble')!;
    expect(LINES.pet).toContain(bubble.textContent);
    expect(stored().today.pets).toBe(1);
    ms += 1500;
    fireEvent.click(container.querySelector('.watt-hit')!);
    expect(stored().today.pets).toBe(1);
    expect(container.querySelector('.watt-bubble')).toBe(bubble);
    ms += 3000;
    fireEvent.click(container.querySelector('.watt-hit')!);
    expect(stored().today.pets).toBe(2);
  });

  it('hover shows her card: name, mood in one word, two honest lines; chatty off means no bubble at all', () => {
    let ms = day();
    const { container, getByRole, queryByText } = render(<Watt now={() => ms} />);
    runFor(1.5);
    fireEvent.click(container.querySelector('.watt-hit')!);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.mouseEnter(container.querySelector('.watt-hit')!);
    fireEvent.mouseMove(container.querySelector('.watt-hit')!);
    act(() => void vi.advanceTimersByTime(CARD_DWELL_MS));
    const card = container.querySelector('.watt-card')!;
    expect(card.querySelector('.wc-name')!.textContent).toBe('Watt');
    expect(['Content', 'Happy', 'Sleepy', 'Curious']).toContain(card.querySelector('.wc-mood')!.textContent);
    expect([...card.querySelectorAll('.wc-today li')].map((l) => l.textContent)).toEqual(['Petted once.']);
    expect(queryByText('First day together')).not.toBeNull();
    fireEvent.click(getByRole('radio', { name: 'Off' }));
    expect(stored().chatty).toBe('off');
    expect(container.querySelector('.watt-bubble')).toBeNull();
    ms += 5000;
    fireEvent.click(container.querySelector('.watt-hit')!);
    expect(container.querySelector('.watt-bubble')).toBeNull();
    // Locked cosmetics say when they unlock; the bow is there from day one.
    expect(getByRole('radio', { name: 'Cape' })).toHaveProperty('disabled', true);
    fireEvent.click(getByRole('radio', { name: 'Bow' }));
    expect(stored().cosmetic).toBe('bow');
    runFor(0.2);
    expect(container.querySelector('.watt-prop-bow')).not.toBeNull();
  });

  it('shows the amber mark while something waits; clicking it opens what waits', () => {
    const summary: OmniSummary = {
      now: new Date().toISOString(),
      tz: 'UTC',
      stale: false,
      slots: { used: 1, limit: 3 },
      lanes: [{ id: 'l1', title: 'A lane', stage: 'build', state: 'working', line: '', elapsedS: 10, waiting: true, pr: null }],
      parked: 0,
      yourMove: { total: 1, first: { sessionId: 's-1', title: 'A lane', kind: 'question', since: null, question: '' } },
      usage: null,
      day: [],
      linksAvailable: true,
    };
    const { container } = render(<Watt now={day} />);
    runFor(1.5);
    expect(container.querySelector<HTMLElement>('.watt-mark')!.hidden).toBe(true);
    act(() => useAgentsStore.setState({ status: 'ready', summary, readFailed: false, awaiting: false, okAt: Date.now(), freshAt: Date.now() }));
    runFor(1);
    const mark = container.querySelector<HTMLElement>('.watt-mark')!;
    expect(mark.hidden).toBe(false);
    fireEvent.click(mark);
    expect(invokeMock).toHaveBeenCalledWith('wall2_open_session', { id: 's-1' });
  });

  it('hops when a focus session completes', () => {
    const ms = day();
    act(() => useFocusStore.setState({ state: { status: 'running', minutes: 25, endAt: ms + 1000 } }));
    const { container } = render(<Watt now={() => ms} />);
    runFor(1.5);
    const rest = where(container).feet;
    act(() => useFocusStore.setState({ state: { status: 'finished', minutes: 25 } }));
    let highest = rest;
    for (let i = 0; i < 14; i++) {
      tick();
      highest = Math.min(highest, where(container).feet);
    }
    expect(highest).toBeLessThan(rest);
    expect(stored().today.focus).toBe(1);
    // And says so (context first: the fresh event wins).
    expect(LINES.focusDone).toContain(container.querySelector('.watt-bubble')!.textContent);
  });

  it('says nothing during a call, even for a fresh event or a pet', () => {
    const ms = day();
    act(() => useFocusStore.setState({ state: { status: 'running', minutes: 25, endAt: ms + 1000 } }));
    const { container } = render(<Watt now={() => ms} inCall />);
    runFor(1.5);
    act(() => useFocusStore.setState({ state: { status: 'finished', minutes: 25 } }));
    runFor(0.5);
    fireEvent.click(container.querySelector('.watt-hit')!);
    expect(container.querySelector('.watt-bubble')).toBeNull();
    expect(stored().today.pets).toBe(1);
  });

  it('under reduced motion a pet is a still pose with a still heart and a bubble that does not animate; no frame loop', () => {
    reduced(true);
    const { container } = render(<Watt now={day} />);
    expect(frames.size).toBe(0);
    fireEvent.click(container.querySelector('.watt-hit')!);
    expect(frames.size).toBe(0);
    expect(heartOpacity(container)).toBeGreaterThan(0);
    expect(container.querySelector('.watt-bubble')!.classList.contains('still')).toBe(true);
  });

  describe('her card', () => {
    const hitOf = (c: HTMLElement) => c.querySelector('.watt-hit')!;
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });
    const later = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

    it('crossing her does not open it; resting on her does', () => {
      const { container } = render(<Watt now={day} />);
      runFor(1.5);
      fireEvent.mouseEnter(hitOf(container));
      fireEvent.mouseMove(hitOf(container));
      later(CARD_DWELL_MS - 100);
      fireEvent.mouseLeave(hitOf(container));
      later(1000);
      expect(container.querySelector('.watt-card')).toBeNull();
      fireEvent.mouseEnter(hitOf(container));
      fireEvent.mouseMove(hitOf(container));
      later(CARD_DWELL_MS);
      expect(container.querySelector('.watt-card')).not.toBeNull();
    });

    it('a pointer resting still while she walks under it opens nothing until it moves', () => {
      const { container } = render(<Watt now={day} />);
      runFor(1.5);
      fireEvent.mouseEnter(hitOf(container));
      later(CARD_DWELL_MS * 3);
      expect(container.querySelector('.watt-card')).toBeNull();
      fireEvent.mouseMove(hitOf(container));
      later(CARD_DWELL_MS);
      expect(container.querySelector('.watt-card')).not.toBeNull();
    });

    it('moving from her to the card keeps it; leaving the card closes it at once, so the control under it gets the click', () => {
      const { container } = render(<Watt now={day} />);
      runFor(1.5);
      fireEvent.mouseEnter(hitOf(container));
      fireEvent.mouseMove(hitOf(container));
      later(CARD_DWELL_MS);
      fireEvent.mouseLeave(hitOf(container));
      later(CARD_GRACE_MS - 100);
      fireEvent.mouseEnter(container.querySelector('.watt-card')!);
      later(2000);
      const card = container.querySelector('.watt-card')!;
      expect(card).not.toBeNull();
      fireEvent.mouseLeave(card);
      expect(container.querySelector('.watt-card')).toBeNull();
      // Leaving her without reaching the card: gone after the short grace.
      fireEvent.mouseEnter(hitOf(container));
      fireEvent.mouseMove(hitOf(container));
      later(CARD_DWELL_MS);
      fireEvent.mouseLeave(hitOf(container));
      later(CARD_GRACE_MS);
      expect(container.querySelector('.watt-card')).toBeNull();
    });

    it('focus coming back with the window opens nothing; Escape and a place change close it; she stands still while it is open', () => {
      const { container } = render(<Watt now={day} />);
      runFor(1.5);
      act(() => (hitOf(container) as HTMLElement).focus());
      fireEvent.focus(hitOf(container));
      later(1000);
      expect(container.querySelector('.watt-card')).toBeNull();
      // Keyboard focus (Tab) does open it.
      act(() => (hitOf(container) as HTMLElement).blur());
      fireEvent.keyDown(window, { key: 'Tab' });
      act(() => (hitOf(container) as HTMLElement).focus());
      expect(container.querySelector('.watt-card')).not.toBeNull();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(container.querySelector('.watt-card')).toBeNull();
      fireEvent.mouseEnter(hitOf(container));
      fireEvent.mouseMove(hitOf(container));
      later(CARD_DWELL_MS);
      expect(container.querySelector('.watt-card')).not.toBeNull();
      const x = where(container).x;
      runFor(60);
      expect(where(container).x).toBe(x);
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(container.querySelector('.watt-card')).toBeNull();
      fireEvent.mouseEnter(hitOf(container));
      fireEvent.mouseMove(hitOf(container));
      later(CARD_DWELL_MS);
      expect(container.querySelector('.watt-card')).not.toBeNull();
      go('home');
      expect(container.querySelector('.watt-card')).toBeNull();
    });
  });

  it('while she is away nothing of hers takes the pointer or the keyboard (reduced motion, on Zen)', () => {
    reduced(true);
    const { container } = render(<Watt now={day} />);
    act(() => (window as unknown as { __watt: { clover(): void } }).__watt.clover());
    const clover = container.querySelector<HTMLElement>('.watt-clover')!;
    expect(clover.style.pointerEvents).toBe('auto');
    go('zen');
    for (const sel of ['.watt-hit', '.watt-mark', '.watt-clover']) {
      const e = container.querySelector<HTMLElement>(sel)!;
      expect(e.tabIndex, sel).toBe(-1);
      expect(e.style.visibility, sel).toBe('hidden');
    }
    expect(container.querySelector<HTMLElement>('.watt-mark')!.style.pointerEvents).toBe('none');
    expect(container.querySelector<HTMLElement>('.watt-clover')!.style.pointerEvents).toBe('none');
    for (const part of container.querySelectorAll<HTMLElement>('.watt-hit-part')) expect(part.style.pointerEvents).toBe('none');
  });

  it('a pet always gets hearts; her spoken reply waits 20 s after any bubble and comes at most once a minute', () => {
    let ms = day();
    const { container } = render(<Watt now={() => ms} />);
    runFor(1.5);
    const pet = () => fireEvent.click(container.querySelector('.watt-hit')!);
    pet();
    const first = container.querySelector('.watt-bubble')!.textContent;
    expect(LINES.pet).toContain(first);
    // 30 s later: past the reply gap but inside the minute: hearts, no new line.
    ms += 30_000;
    pet();
    runFor(0.3);
    expect(heartOpacity(container)).toBeGreaterThan(0);
    expect(stored().today.pets).toBe(2);
    const shown = container.querySelector('.watt-bubble');
    expect(shown === null || shown.textContent === first).toBe(true);
    ms += PET_LINE_EVERY_MS;
    pet();
    expect(container.querySelector('.watt-bubble')).not.toBeNull();
    expect(PET_REPLY_GAP_MS).toBe(20_000);
  });

  it('a showing bubble goes the moment a quiet time starts (focus starting)', () => {
    const ms = day();
    const { container } = render(<Watt now={() => ms} />);
    runFor(1.5);
    fireEvent.click(container.querySelector('.watt-hit')!);
    expect(container.querySelector('.watt-bubble')).not.toBeNull();
    act(() => useFocusStore.setState({ state: { status: 'running', minutes: 25, endAt: ms + 25 * 60_000 } }));
    expect(container.querySelector('.watt-bubble')).toBeNull();
  });

  it('a focus session that ended while the app was closed says nothing and does not hop', () => {
    const ms = day();
    const { container } = render(<Watt now={() => ms} />);
    runFor(1.5);
    act(() => useFocusStore.setState({ state: { status: 'running', minutes: 25, endAt: ms - 10 * 60_000 } }));
    act(() => useFocusStore.setState({ state: { status: 'finished', minutes: 25 } }));
    runFor(0.5);
    expect(container.querySelector('.watt-bubble')).toBeNull();
    expect(stored().today.focus ?? 0).toBe(0);
  });
});

describe('quiet and silent cases', () => {
  const setHidden = (h: boolean) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  afterEach(() => setHidden(false));

  it('a pet while she is asleep or the page is hidden gives hearts but no spoken line', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let ms = day();
    const { container } = render(<Watt now={() => ms} />);
    runFor(1.5);
    const pet = () => fireEvent.click(container.querySelector('.watt-hit')!);
    // Control: awake and visible, a pet gets a reply.
    pet();
    expect(container.querySelector('.watt-bubble')).not.toBeNull();
    expect(stored().today.pets).toBe(1);
    // Hidden: hearts and the count, but no line.
    ms += 10 * 60_000;
    act(() => void vi.advanceTimersByTime(30_000));
    setHidden(true);
    pet();
    expect(container.querySelector('.watt-bubble')).toBeNull();
    expect(stored().today.pets).toBe(2);
    setHidden(false);
    // Asleep (night): the same.
    ms = night();
    runFor(1.5);
    pet();
    expect(container.querySelector('.watt-bubble')).toBeNull();
    expect(stored().today.pets).toBe(3);
  });

  it('reaching a clover schedules nothing from inside paint', () => {
    const { container } = render(<Watt now={day} />);
    runFor(1.5);
    const real = window.setTimeout.bind(window);
    const stacks: string[] = [];
    vi.spyOn(window, 'setTimeout').mockImplementation(((fn: TimerHandler, ms?: number, ...a: unknown[]) => {
      stacks.push(new Error().stack ?? '');
      return real(fn, ms, ...a);
    }) as typeof window.setTimeout);
    act(() => (window as unknown as { __watt: { clover(): void } }).__watt.clover());
    runFor(90);
    expect(container.querySelector('.watt-clover')).toBeNull();
    expect(stored().today.clovers).toBe(1);
    expect(stacks.length).toBeGreaterThan(0);
    for (const st of stacks) expect(st).not.toMatch(/at paint\b/);
  });

  describe('meetings keep her quiet', () => {
    const meeting = (ms: number) => ({
      key: 'k',
      accountId: 'a',
      title: 'Planning',
      start: new Date(ms - 10 * 60_000).toISOString(),
      end: new Date(ms + 30 * 60_000).toISOString(),
      canJoin: false,
    });
    const withMeeting = (ms: number) =>
      invokeMock.mockImplementation(((cmd: string) =>
        cmd === 'wall2_meet_next' ? Promise.resolve({ accounts: [], meetings: [meeting(ms)] }) : defaultInvoke(cmd)) as never);
    const flush = () => act(async () => void (await Promise.resolve()));
    const pet = (c: HTMLElement) => fireEvent.click(c.querySelector('.watt-hit')!);

    it('a stale feed keeps her quiet until the last known meeting ends', async () => {
      let ms = day();
      withMeeting(ms);
      const { container, rerender } = render(<Watt now={() => ms} />);
      await flush();
      runFor(1.5);
      pet(container);
      expect(container.querySelector('.watt-bubble')).toBeNull();
      act(() => useMeetingFeed.setState({ failed: true }));
      pet(container);
      expect(container.querySelector('.watt-bubble')).toBeNull();
      // Past its end the quiet time is over, feed stale or not.
      ms += 31 * 60_000;
      rerender(<Watt now={() => ms} />);
      pet(container);
      expect(container.querySelector('.watt-bubble')).not.toBeNull();
    });

    it('a meeting that disappears from a fresh feed stops keeping her quiet at once', async () => {
      let ms = day();
      withMeeting(ms);
      const { container } = render(<Watt now={() => ms} />);
      await flush();
      runFor(1.5);
      pet(container);
      expect(container.querySelector('.watt-bubble')).toBeNull();
      act(() => useMeetingFeed.setState({ meetings: [], failed: false, feedStale: false }));
      ms += 10_000;
      pet(container);
      expect(container.querySelector('.watt-bubble')).not.toBeNull();
    });
  });

  describe('focus half way line', () => {
    const run = (left: number, advance: number) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      let ms = day();
      const { container } = render(<Watt now={() => ms} />);
      runFor(1.5);
      act(() => useFocusStore.setState({ state: { status: 'running', minutes: 40, endAt: ms + left } }));
      const seen: string[] = [];
      for (let t = 0; t < advance; t += 5000) {
        ms += 5000;
        act(() => void vi.advanceTimersByTime(5000));
        const b = container.querySelector('.watt-bubble')?.textContent;
        if (b) seen.push(b);
      }
      return seen;
    };
    const half = (seen: string[]) => seen.filter((l) => LINES.focusHalf.includes(l));

    it('a session that begins past half way says nothing about half way', () => {
      expect(half(run(10 * 60_000, 5 * 60_000))).toEqual([]);
    });

    it('control: a session that crosses half way says so', () => {
      expect(half(run(21 * 60_000, 5 * 60_000)).length).toBeGreaterThan(0);
    });
  });
});

describe('the amber mark when it is only a label', () => {
  it('takes no pointer events when it is not clickable (Work with no link)', () => {
    usePlaceStore.setState({ active: 'work' });
    publishCamera(CAMERAS.work, false);
    const summary: OmniSummary = {
      now: new Date().toISOString(),
      tz: 'UTC',
      stale: false,
      slots: { used: 1, limit: 3 },
      lanes: [{ id: 'l1', title: 'A lane', stage: 'build', state: 'working', line: '', elapsedS: 10, waiting: true, pr: null }],
      parked: 0,
      yourMove: { total: 1, first: { sessionId: 's-1', title: 'A lane', kind: 'question', since: null, question: '' } },
      usage: null,
      day: [],
      linksAvailable: false,
    };
    const { container } = render(<Watt now={day} />);
    act(() => useAgentsStore.setState({ status: 'ready', summary, readFailed: false, awaiting: false, okAt: Date.now(), freshAt: Date.now() }));
    runFor(2);
    const mark = container.querySelector<HTMLElement>('.watt-mark')!;
    expect(mark.classList.contains('static')).toBe(true);
    expect(mark.hidden).toBe(false);
    expect(mark.style.pointerEvents).toBe('none');
  });
});

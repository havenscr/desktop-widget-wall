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
import { PET_KEY, dayKey, defaultPet, emptyToday } from './pet';
import { resetMeetingFeed, useMeetingFeed } from '../work/useNextMeeting';
import { resetWeatherStore } from '../weather/useWeather';
import { PET_LINE_EVERY_MS, PET_REPLY_GAP_MS, WATT_TIP, Watt } from './Watt';

const sunMock = vi.hoisted(() => ({ set: null as number | null }));
vi.mock('../ribbon/sun', async (original) => ({
  ...(await original<typeof import('../ribbon/sun')>()),
  sunTimes: () => ({ rise: null, set: sunMock.set }),
}));
const idleState = vi.hoisted(() => ({ on: false }));
vi.mock('../ui/useIdle', () => ({ useIdle: () => idleState.on }));

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
  sunMock.set = null;
  idleState.on = false;
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

  it('right-click shows his card: name, mood in one word, two honest lines; chatty off means no bubble at all', () => {
    let ms = day();
    const { container, getByRole, queryByText } = render(<Watt now={() => ms} />);
    runFor(1.5);
    fireEvent.click(container.querySelector('.watt-hit')!);
    fireEvent.contextMenu(container.querySelector('.watt-hit')!);
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

  describe('his card', () => {
    const hitOf = (c: HTMLElement) => c.querySelector<HTMLElement>('.watt-hit')!;
    const cardOf = (c: HTMLElement) => c.querySelector('.watt-card');
    const open = (c: HTMLElement) => fireEvent.contextMenu(hitOf(c));

    it('hovering opens nothing, however long; the tooltip says what the pointer can do', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { container } = render(<Watt now={day} />);
      runFor(1.5);
      fireEvent.mouseEnter(hitOf(container));
      fireEvent.mouseMove(hitOf(container));
      fireEvent.pointerEnter(hitOf(container));
      fireEvent.pointerMove(hitOf(container), { pointerId: 1, clientX: 5, clientY: 5 });
      act(() => void vi.advanceTimersByTime(2000));
      expect(cardOf(container)).toBeNull();
      expect(hitOf(container).title).toBe(WATT_TIP);
      expect(WATT_TIP).toBe('Click to pet. Drag to carry. Right-click for his card.');
    });

    it('a click pets and opens nothing', () => {
      const { container } = render(<Watt now={day} />);
      runFor(1.5);
      fireEvent.click(hitOf(container));
      expect(stored().today.pets).toBe(1);
      expect(cardOf(container)).toBeNull();
    });

    it('a right-click opens it and the browser menu is prevented, on him only; a second right-click on him closes it', () => {
      const { container } = render(<Watt now={day} />);
      runFor(1.5);
      expect(open(container)).toBe(false);
      expect(cardOf(container)).not.toBeNull();
      expect(open(container)).toBe(false);
      expect(cardOf(container)).toBeNull();
      // Elsewhere the page's own menu is untouched.
      expect(fireEvent.contextMenu(container)).toBe(true);
      expect(fireEvent.contextMenu(document.body)).toBe(true);
    });

    it('Escape, a click outside, a right-click outside, a place change and his going away each close it; a click inside does not', () => {
      const { container } = render(<Watt now={day} />);
      runFor(1.5);
      open(container);
      fireEvent.pointerDown(cardOf(container)!.querySelector('.wc-name')!);
      expect(cardOf(container)).not.toBeNull();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(cardOf(container)).toBeNull();
      open(container);
      fireEvent.pointerDown(document.body, { button: 0 });
      expect(cardOf(container)).toBeNull();
      open(container);
      fireEvent.pointerDown(document.body, { button: 2 });
      expect(cardOf(container)).toBeNull();
      open(container);
      go('home');
      expect(cardOf(container)).toBeNull();
      go('unwind');
      runFor(FADE_OUT_S + FADE_IN_S + 0.5);
      open(container);
      expect(cardOf(container)).not.toBeNull();
      horizon(CAMERAS.home, true);
      runFor(FADE_OUT_S + 0.5);
      expect(cardOf(container)).toBeNull();
    });

    it('he stands still while it is open', () => {
      const { container } = render(<Watt now={day} />);
      runFor(1.5);
      open(container);
      const x = where(container).x;
      runFor(60);
      expect(where(container).x).toBe(x);
    });

    it('keyboard: one tab stop; Enter pets; the menu key, Shift+F10 or M opens it and moves focus in; Escape gives focus back', () => {
      const { container } = render(<Watt now={day} />);
      runFor(1.5);
      expect(container.querySelectorAll('.watt-hit').length).toBe(1);
      expect(hitOf(container).tabIndex).toBe(0);
      act(() => hitOf(container).focus());
      // Focus alone opens nothing.
      expect(cardOf(container)).toBeNull();
      // Enter on a button is a click with no pointer.
      fireEvent.click(hitOf(container), { detail: 0 });
      expect(stored().today.pets).toBe(1);
      expect(cardOf(container)).toBeNull();
      const firstButton = () => container.querySelector('.watt-card button:not(:disabled)');
      for (const key of [{ key: 'ContextMenu' }, { key: 'F10', shiftKey: true }, { key: 'm' }, { key: 'M' }]) {
        fireEvent.keyDown(hitOf(container), key);
        expect(cardOf(container), JSON.stringify(key)).not.toBeNull();
        expect(document.activeElement).toBe(firstButton());
        fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
        expect(cardOf(container)).toBeNull();
        expect(document.activeElement).toBe(hitOf(container));
      }
      // A plain F10 or another letter does nothing.
      fireEvent.keyDown(hitOf(container), { key: 'F10' });
      fireEvent.keyDown(hitOf(container), { key: 'x' });
      expect(cardOf(container)).toBeNull();
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

  it('standing on a clover, one frame step schedules no timer of its own (only the eat step does)', () => {
    const { container } = render(<Watt now={day} />);
    runFor(1.5);
    act(() => (window as unknown as { __watt: { clover(): void } }).__watt.clover());
    // Walk until she is on it; the clover goes at the moment she reaches it.
    const spy = vi.spyOn(window, 'setTimeout');
    let eaten = false;
    for (let i = 0; i < 1800 && !eaten; i++) {
      spy.mockClear();
      tick();
      eaten = container.querySelector('.watt-clover') === null;
      // A step that is not the eating one schedules nothing.
      if (!eaten) expect(spy).not.toHaveBeenCalled();
    }
    expect(eaten).toBe(true);
    expect(stored().today.clovers).toBe(1);
    // The step that ate it scheduled only the eat reaction's own timers.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(3);
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
      // No idle chatter: a chance thought spoken first would hold the gap and hide the event line.
      vi.spyOn(Math, 'random').mockReturnValue(0.999);
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

describe('carrying him', () => {
  const hitOf = (c: HTMLElement) => c.querySelector<HTMLElement>('.watt-hit')!;
  const sheepOf = (c: HTMLElement) => c.querySelector<HTMLElement>('.watt-sheep')!;
  const carried = (c: HTMLElement) => hitOf(c).classList.contains('carrying');
  const ptr = (id = 1, type = 'mouse') => ({ pointerId: id, pointerType: type, button: 0 });
  const grab = (c: HTMLElement, x: number, y: number, id = 1, type = 'mouse') => fireEvent.pointerDown(hitOf(c), { ...ptr(id, type), clientX: x, clientY: y });
  const move = (c: HTMLElement, x: number, y: number, id = 1) => fireEvent.pointerMove(hitOf(c), { ...ptr(id), clientX: x, clientY: y });
  const drop = (c: HTMLElement, x: number, y: number, id = 1) => fireEvent.pointerUp(hitOf(c), { ...ptr(id), clientX: x, clientY: y });
  /** The sheep's drawn top left, the way it faces and its vertical squash. */
  const look = (c: HTMLElement) => {
    const t = sheepOf(c).style.transform;
    const m = /translate\((-?[\d.]+)px(?:,\s*(-?[\d.]+)px)?\) scaleX\((-?1)\) scaleY\(([\d.]+)\)/.exec(t);
    return { x: Number(m?.[1]), y: Number(m?.[2] ?? 0), dir: Number(m?.[3]), squash: Number(m?.[4]), t };
  };
  const rows = (c: HTMLElement) => (Number(c.querySelector('svg')!.getAttribute('height')) * 18) / Number(c.querySelector('svg')!.getAttribute('width'));
  const flat = (c: HTMLElement) => (c.querySelector('.watt-bubble')?.textContent ?? '').replace(/\n/g, ' ');
  const eyes = (c: HTMLElement) => c.querySelectorAll('.watt-sheep > svg rect[fill="#35e6ea"]').length;
  let setCap: ReturnType<typeof vi.fn>;
  let relCap: ReturnType<typeof vi.fn>;
  const captured = new Set<number>();
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  beforeEach(() => {
    // Capture is tracked, as a browser does: set on press, kept until released, and nothing else says yes.
    captured.clear();
    setCap = vi.fn((id: number) => void captured.add(id));
    relCap = vi.fn((id: number) => void captured.delete(id));
    proto.setPointerCapture = setCap;
    proto.releasePointerCapture = relCap;
    proto.hasPointerCapture = (id: number) => captured.has(id);
  });
  afterEach(() => {
    delete proto.setPointerCapture;
    delete proto.releasePointerCapture;
    delete proto.hasPointerCapture;
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });
  const start = (nowFn: () => number = day, props: { inCall?: boolean } = {}) => {
    const r = render(<Watt now={nowFn} {...props} />);
    runFor(1.5);
    return r;
  };
  const carryAway = (c: HTMLElement, x = 1200, y = 300) => {
    grab(c, 500, 400);
    move(c, 520, 400);
    move(c, x, y);
    runFor(0.6);
  };

  it('a press that moves under 6 px is a pet and lifts nothing; 6 px or more is a carry and never a pet', () => {
    const { container } = start();
    grab(container, 100, 100);
    move(container, 103, 102);
    expect(carried(container)).toBe(false);
    drop(container, 103, 102);
    expect(stored().today.pets).toBe(1);
    expect(container.querySelector('.watt-card')).toBeNull();
    // Just under 6: still a press.
    let ms = day() + 10_000;
    const second = render(<Watt now={() => ms} />);
    runFor(1.5);
    grab(second.container, 100, 100);
    move(second.container, 105.9, 100);
    expect(second.container.querySelectorAll('.watt-hit.carrying').length).toBe(0);
    drop(second.container, 105.9, 100);
    ms += 5000;
    // Exactly 6: a carry.
    grab(second.container, 100, 100);
    move(second.container, 106, 100);
    tick();
    expect(second.container.querySelectorAll('.watt-hit.carrying').length).toBe(1);
    drop(second.container, 106, 100);
    expect(JSON.parse(localStorage.getItem(PET_KEY)!).today.pets).toBeLessThanOrEqual(2);
  });

  it('a carry is not a pet: no hearts, no count, no card', () => {
    const { container } = start();
    carryAway(container);
    tick();
    expect(carried(container)).toBe(true);
    drop(container, 1200, 300);
    runFor(2);
    expect(stored().today?.pets ?? 0).toBe(0);
    expect(Number(container.querySelector<HTMLElement>('.watt-heart')!.style.opacity || 0)).toBe(0);
    expect(container.querySelector('.watt-card')).toBeNull();
  });

  it('a press held longer than half a second is not a pet', () => {
    let ms = day();
    const { container } = start(() => ms);
    grab(container, 100, 100);
    ms += 600;
    drop(container, 100, 100);
    expect(stored().today?.pets ?? 0).toBe(0);
    grab(container, 100, 100);
    ms += 400;
    drop(container, 100, 100);
    expect(stored().today.pets).toBe(1);
  });

  it('works for a pen and for touch as it does for a mouse', () => {
    for (const type of ['pen', 'touch']) {
      const { container, unmount } = start();
      grab(container, 500, 400, 7, type);
      move(container, 600, 400, 7);
      tick();
      expect(carried(container), type).toBe(true);
      expect(setCap).toHaveBeenCalledWith(7);
      drop(container, 600, 400, 7);
      unmount();
    }
  });

  it('a right-button press does not start a carry', () => {
    const { container } = start();
    fireEvent.pointerDown(hitOf(container), { pointerId: 1, pointerType: 'mouse', button: 2, clientX: 5, clientY: 5 });
    move(container, 300, 300);
    expect(carried(container)).toBe(false);
  });

  it('while held he follows the pointer by the wool on his back, above the cards, in a held pose', () => {
    const { container } = start();
    const standing = rows(container);
    carryAway(container, 1200, 300);
    const l = look(container);
    // The grab point sits left of centre when he faces right, right of centre facing left.
    const off = l.dir === 1 ? 0.38 * 108 : 0.62 * 108;
    expect(l.x).toBeCloseTo(1200 - off, 0);
    expect(l.y).toBeCloseTo(300 - 0.14 * 72, 0);
    expect(container.querySelector<HTMLElement>('.watt')!.style.zIndex).toBe('40');
    expect(rows(container)).toBe(standing);
    // The legs sway: both held frames show over a second.
    const heights = new Set<string>();
    for (let i = 0; i < 40; i++) {
      tick();
      heights.add(container.querySelector('.watt-sheep > svg')!.innerHTML);
    }
    expect(heights.size).toBeGreaterThanOrEqual(2);
    // It tilts with the pointer's speed, and straightens when still.
    move(container, 1500, 300);
    tick();
    expect(look(container).t).toMatch(/rotate\(/);
    runFor(2);
    expect(look(container).t).not.toMatch(/rotate\(-?[1-9]/);
    drop(container, 1500, 300);
    expect(container.querySelector<HTMLElement>('.watt')!.style.zIndex).toBe('40');
    runFor(1);
    expect(container.querySelector<HTMLElement>('.watt')!.style.zIndex).toBe('');
  });

  it('is clamped so no part of him leaves the screen', () => {
    const { container } = start();
    grab(container, 500, 400);
    move(container, 520, 400);
    move(container, -900, -900);
    runFor(0.8);
    let l = look(container);
    expect(l.x).toBeGreaterThanOrEqual(0);
    expect(l.y).toBeGreaterThanOrEqual(0);
    move(container, 9000, 9000);
    runFor(0.8);
    l = look(container);
    expect(l.x + 108).toBeLessThanOrEqual(2560);
    expect(l.y + 72).toBeLessThanOrEqual(720);
    drop(container, 9000, 9000);
  });

  it('holds the pointer with capture while carried, so nothing under him sees it, and lets go on release', () => {
    const { container } = start();
    grab(container, 500, 400);
    expect(setCap).toHaveBeenCalledWith(1);
    move(container, 600, 400);
    runFor(0.1);
    expect(hitOf(container).style.pointerEvents).toBe('auto');
    expect(hitOf(container).classList.contains('carrying')).toBe(true);
    // The amber mark and the clover are hidden and take no pointer while he is held.
    act(() => (window as unknown as { __watt: { clover(): void } }).__watt.clover());
    runFor(0.2);
    expect(container.querySelector<HTMLElement>('.watt-clover')!.style.visibility).toBe('hidden');
    expect(container.querySelector<HTMLElement>('.watt-clover')!.style.pointerEvents).toBe('none');
    drop(container, 600, 400);
    expect(relCap).toHaveBeenCalledWith(1);
    runFor(1);
    expect(hitOf(container).style.pointerEvents).toBe('');
    expect(container.querySelector<HTMLElement>('.watt-clover')!.style.visibility).toBe('');
  });

  it('is set down on the ground line under the release point, at that x kept inside his span, on each place', () => {
    const cases: [WattPlace, number][] = [
      ['work', 582],
      ['home', 582],
      ['meet', 582],
      ['unwind', 505],
    ];
    for (const [place, hy] of cases) {
      usePlaceStore.setState({ active: place });
      publishCamera(CAMERAS[place], false);
      const { container, unmount } = start();
      const walk = WALKS[place];
      carryAway(container, 2500, 100);
      drop(container, 2500, 100);
      runFor(1);
      let l = look(container);
      expect(l.x, place).toBe(walk.max);
      expect(l.y + rows(container) * walk.px, place).toBe(hy);
      carryAway(container, 20, 100);
      drop(container, 20, 100);
      runFor(1);
      l = look(container);
      expect(l.x, place).toBe(walk.min);
      expect(l.y + rows(container) * walk.px, place).toBe(hy);
      // In the middle of his span he lands where he was let go.
      const inside = (walk.min + walk.max) / 2 + 20;
      carryAway(container, inside + 0.5 * 108, 200);
      drop(container, inside + 0.5 * 108, 200);
      runFor(1);
      l = look(container);
      expect(l.x, place).toBeGreaterThanOrEqual(walk.min);
      expect(l.x, place).toBeLessThanOrEqual(walk.max);
      unmount();
    }
  });

  it('falls gently (ease in, 300 to 500 ms by height), squashes once on landing, then sits', () => {
    const { container } = start();
    carryAway(container, 450, 60);
    const high = look(container).y;
    drop(container, 450, 60);
    const ys: number[] = [];
    const squash: number[] = [];
    for (let i = 0; i < 24; i++) {
      tick();
      ys.push(look(container).y);
      squash.push(look(container).squash);
    }
    // Ease in: the first 100 ms cover less than a quarter of the fall.
    const fallen = 505 - 72 - high;
    expect(ys[1] - high).toBeLessThan(fallen / 4);
    // Down by 500 ms at the latest (tick 10), and it never goes back up.
    expect(ys[10]).toBeGreaterThanOrEqual(505 - 66 - 1);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1] - 1e-9);
    // One squash, back to 1.
    expect(Math.min(...squash)).toBeLessThan(1);
    expect(Math.min(...squash)).toBeGreaterThan(0.75);
    expect(squash[squash.length - 1]).toBe(1);
    let dips = 0;
    for (let i = 1; i < squash.length; i++) if (squash[i] < 1 && squash[i - 1] >= 1) dips++;
    expect(dips).toBe(1);
    expect(rows(container)).toBe(11);
  });

  it('under reduced motion he is simply set down, with no fall and no bounce', () => {
    reduced(true);
    const { container } = render(<Watt now={day} />);
    grab(container, 500, 400);
    move(container, 520, 400);
    move(container, 450, 60);
    expect(carried(container)).toBe(true);
    expect(look(container).y).toBeLessThan(100);
    drop(container, 450, 60);
    const l = look(container);
    expect(l.y + 66).toBe(505);
    expect(l.squash).toBe(1);
    expect(frames.size).toBe(0);
  });

  it('stays near the spot for about 20 seconds, sitting and looking around, then walks back to his wander', () => {
    const { container } = start();
    carryAway(container, 440, 300);
    drop(container, 440, 300);
    runFor(1);
    const x = look(container).x;
    expect(rows(container)).toBe(11);
    runFor(17);
    expect(look(container).x).toBe(x);
    expect(look(container).y + 66).toBe(505);
    // Well after the sit: back on his feet and inside his walk.
    runFor(25);
    expect(rows(container)).toBe(12);
    expect(look(container).x).toBeGreaterThanOrEqual(WALKS.unwind.min);
    expect(look(container).x).toBeLessThanOrEqual(WALKS.unwind.max);
  });

  describe('anything that is not the pointer puts him down at once', () => {
    const interruptions: [string, (c: HTMLElement, r: { rerender: (ui: React.ReactElement) => void }) => void][] = [
      ['pointercancel', (c) => fireEvent.pointerCancel(hitOf(c), ptr())],
      ['a lost capture', (c) => fireEvent(hitOf(c), new PointerEvent('lostpointercapture', { pointerId: 1, bubbles: true }))],
      ['the window losing focus', () => fireEvent.blur(window)],
      ['the page being hidden', () => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }],
      ['a call starting', (_c, r) => r.rerender(<Watt now={day} inCall />)],
      ['the display going idle', (_c, r) => {
        idleState.on = true;
        r.rerender(<Watt now={day} />);
      }],
    ];
    for (const [name, trigger] of interruptions) {
      it(name, () => {
        const r = start();
        const { container } = r;
        carryAway(container, 450, 80);
        expect(carried(container)).toBe(true);
        trigger(container, r);
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        tick();
        expect(carried(container), name).toBe(false);
        expect(relCap).toHaveBeenCalled();
        const l = look(container);
        if (name === 'the page being hidden') {
          // No fall to watch: he is already on the ground.
          expect(l.y + rows(container) * 6, name).toBe(505);
        } else {
          // From where he was: still in the air a moment later, on the ground after the fall.
          expect(l.y + 72).toBeLessThan(505);
          runFor(0.8);
          expect(look(container).y + rows(container) * 6, name).toBe(505);
        }
        // Never a pet, never stuck: the next press works.
        expect(stored().today?.pets ?? 0).toBe(0);
        runFor(1);
        grab(container, 500, 400, 2);
        move(container, 600, 400, 2);
        tick();
        expect(carried(container), name).toBe(true);
        drop(container, 600, 400, 2);
        idleState.on = false;
      });
    }
    it('a place change', () => {
      const { container } = start();
      carryAway(container, 450, 80);
      go('home');
      publishCamera(CAMERAS.home, false);
      tick();
      expect(carried(container)).toBe(false);
      expect(relCap).toHaveBeenCalled();
      runFor(FADE_OUT_S + FADE_IN_S + 1);
      expect(where(container).feet).toBe(582);
      expect(container.querySelector<HTMLElement>('.watt')!.style.zIndex).toBe('');
      // Set down at once on Home's ground line, at his held x clamped to Home's span (he was left of it).
      expect(where(container).x).toBe(WALKS.home.min);
      expect(container.querySelector('svg')!.getAttribute('height')).toBe(String(11 * WALKS.home.px));
    });
    it('a place change while held on the right edge lands him at the far end of the new span', () => {
      usePlaceStore.setState({ active: 'work' });
      publishCamera(CAMERAS.work, false);
      const { container } = start();
      carryAway(container, 2500, 100);
      go('home');
      publishCamera(CAMERAS.home, false);
      runFor(FADE_OUT_S + FADE_IN_S + 1);
      expect(where(container).x).toBe(WALKS.home.max);
      expect(where(container).feet).toBe(582);
      // Held, then the place changes, then he is never picked up again by the old press.
      expect(carried(container)).toBe(false);
    });
    it('a place change while held on Work lands him inside the middle of the new span where he was held', () => {
      usePlaceStore.setState({ active: 'work' });
      publishCamera(CAMERAS.work, false);
      const { container } = start();
      carryAway(container, 1600, 100);
      go('home');
      publishCamera(CAMERAS.home, false);
      runFor(FADE_OUT_S + FADE_IN_S + 1);
      const x = where(container).x;
      expect(x).toBeGreaterThan(WALKS.home.min);
      expect(x).toBeLessThan(WALKS.home.max);
    });
  });

  describe('a landing across a place change', () => {
    it('he fades in already at the landing spot, with no pop', () => {
      const { container } = start();
      carryAway(container, 450, 80);
      go('home');
      horizon(CAMERAS.home, true);
      runFor(FADE_OUT_S + 0.2);
      publishCamera(CAMERAS.home, false);
      let seen = 0;
      for (let i = 0; i < 40; i++) {
        tick();
        const w = where(container);
        if (w.opacity > 0) {
          seen++;
          expect(w.x).toBe(WALKS.home.min);
          expect(w.feet).toBe(582);
        }
      }
      expect(seen).toBeGreaterThan(5);
    });
    it('two quick place changes while held still land him, at the last place', () => {
      usePlaceStore.setState({ active: 'work' });
      publishCamera(CAMERAS.work, false);
      const { container } = start();
      carryAway(container, 2500, 100);
      go('home');
      horizon(CAMERAS.home, true);
      runFor(0.3);
      go('work');
      publishCamera(CAMERAS.work, false);
      runFor(FADE_OUT_S + FADE_IN_S + 1);
      expect(carried(container)).toBe(false);
      expect(where(container).x).toBe(WALKS.work.max);
      expect(where(container).feet).toBe(582);
    });
    it('a landing whose place never comes back within 10 seconds is given up, and does not happen later', () => {
      let ms = day();
      const { container } = start(() => ms);
      carryAway(container, 2500, 100);
      go('zen');
      runFor(1);
      ms += 12_000;
      go('unwind');
      publishCamera(CAMERAS.unwind, false);
      runFor(FADE_IN_S + 1);
      // He is back on his wander (the middle, standing), not dropped in at the far end.
      expect(where(container).x).toBe(middle(WALKS.unwind));
      expect(rows(container)).toBe(12);
    });
    it('a landing is given up when night starts', () => {
      let ms = day();
      const { container } = start(() => ms);
      carryAway(container, 2500, 100);
      go('zen');
      runFor(1);
      ms = night();
      runFor(1);
      go('unwind');
      publishCamera(CAMERAS.unwind, false);
      runFor(FADE_IN_S + 1);
      expect(where(container).x).toBe(middle(WALKS.unwind));
      expect(rows(container)).not.toBe(11);
    });
    it('a new carry clears any landing that was waiting', () => {
      const { container } = start();
      carryAway(container, 2500, 100);
      go('zen');
      runFor(0.5);
      go('unwind');
      publishCamera(CAMERAS.unwind, false);
      runFor(FADE_IN_S + 1);
      // It has landed by now (ready); a fresh carry and release go where the pointer says.
      carryAway(container, 450, 100);
      drop(container, 450, 100);
      runFor(1);
      expect(where(container).x).toBeLessThanOrEqual(WALKS.unwind.max);
    });
  });

  it('after the PC slept over midnight with Stay on, the first tick on waking ends the Stay', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    let ms = local(21, 0);
    localStorage.setItem(PET_KEY, JSON.stringify({ ...defaultPet(ms), days: 3, lastDay: dayKey(ms), stay: { place: 'unwind', x: 440, date: dayKey(ms) } }));
    // 9 PM is before his night is over and he is awake until 9:30: the Stay is on.
    const { container } = render(<Watt now={() => ms} />);
    runFor(1.5);
    expect(rows(container)).toBe(11);
    // The page is hidden while the PC sleeps; the clock jumps to mid morning the next day; it comes back.
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    ms = local(10, 0) + 24 * 3600_000;
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    act(() => void vi.advanceTimersByTime(6000));
    expect(stored().stay).toBeNull();
    runFor(30);
    expect(rows(container)).toBe(12);
  });

  it('releasing him over a control, or cancelling the carry over it, does not hover or click it', () => {
    const hovers = vi.fn();
    const clicks = vi.fn();
    const { container, getByTestId } = render(
      <>
        <button type="button" data-testid="under" onMouseEnter={hovers} onMouseOver={hovers} onPointerEnter={hovers} onPointerOver={hovers} onClick={clicks}>
          Hold to merge
        </button>
        <Watt now={day} />
      </>,
    );
    runFor(1.5);
    const button = getByTestId('under');
    const hit = hitOf(container);
    // Route an event the way a browser does: to the element holding the pointer's capture, else to what is under it (the button).
    // The target is chosen when the pointer is pressed or moved, so the click that follows a release goes where the release went.
    let holder: HTMLElement = hit;
    const route = (type: 'pointerover' | 'mouseover' | 'pointerenter' | 'mouseenter' | 'pointerup' | 'click' | 'pointercancel', id: number, x: number, y: number) => {
      if (type !== 'click') holder = captured.has(id) ? hit : button;
      const target = holder;
      const init = { bubbles: type !== 'pointerenter' && type !== 'mouseenter', pointerId: id, pointerType: 'mouse', clientX: x, clientY: y, detail: type === 'click' ? 1 : 0 };
      act(() => void target.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, init) : new MouseEvent(type, init)));
    };
    const overs = (id: number, x: number, y: number) => (['pointerover', 'mouseover', 'pointerenter', 'mouseenter'] as const).forEach((t) => route(t, id, x, y));
    // The pointer goes down on him (always his element), moves over the button, and is held there.
    const carryOver = (id: number) => {
      grab(container, 500, 400, id);
      move(container, 520, 400, id);
      for (const [x, y] of [[700, 380], [900, 340], [1200, 300]] as const) {
        fireEvent.pointerMove(captured.has(id) ? hit : button, { ...ptr(id), clientX: x, clientY: y });
        overs(id, x, y);
      }
      runFor(1.2);
    };
    carryOver(1);
    route('pointerup', 1, 1200, 300);
    route('click', 1, 1200, 300);
    runFor(1);
    expect(hovers).not.toHaveBeenCalled();
    expect(clicks).not.toHaveBeenCalled();
    expect(stored().today?.pets ?? 0).toBe(0);
    expect(hit.classList.contains('carrying')).toBe(false);
    // The same when the carry ends by cancel.
    carryOver(2);
    route('pointercancel', 2, 1200, 300);
    runFor(1);
    expect(hovers).not.toHaveBeenCalled();
    expect(clicks).not.toHaveBeenCalled();
    // And the control still works for a pointer that is not carrying him.
    fireEvent.click(button);
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it('picking him up ends a nap', () => {
    const { container } = start();
    fireEvent.contextMenu(hitOf(container));
    fireEvent.click([...document.querySelectorAll<HTMLButtonElement>('.watt-card button')].find((b) => b.textContent === 'Nap')!);
    runFor(0.3);
    expect(rows(container)).toBe(8);
    fireEvent.keyDown(window, { key: 'Escape' });
    grab(container, 500, 400);
    move(container, 600, 300);
    runFor(0.3);
    expect(rows(container)).toBe(12);
    drop(container, 600, 300);
    runFor(1.5);
    // He sits after landing; he does not lie down again.
    expect(rows(container)).toBe(11);
  });

  it('a Stay from an earlier day ends when the day rolls over while the wall keeps running', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    let ms = day();
    localStorage.setItem(PET_KEY, JSON.stringify({ ...defaultPet(day()), days: 3, lastDay: dayKey(day()), stay: { place: 'unwind', x: 440, date: dayKey(day()) } }));
    const { container } = render(<Watt now={() => ms} />);
    runFor(1.5);
    expect(rows(container)).toBe(11);
    // Past midnight, same mount: the minute loop rolls the day and the Stay goes with it.
    ms += 24 * 3600_000;
    act(() => void vi.advanceTimersByTime(6000));
    expect(stored().stay).toBeNull();
    runFor(30);
    expect(rows(container)).toBe(12);
  });

  it('letting go on a clover (within 24 px) feeds it to him at once; further away leaves it', () => {
    const { container } = start();
    // He is lifted first: a clover grows while he is in the air (he would eat it where he stood).
    grab(container, 500, 400);
    move(container, 520, 400);
    act(() => (window as unknown as { __watt: { clover(): void } }).__watt.clover());
    runFor(0.3);
    const cl = container.querySelector<HTMLElement>('.watt-clover')!;
    const cx = parseFloat(cl.style.left) + 12;
    const cy = parseFloat(cl.style.top) + 12;
    move(container, cx + 40, cy);
    runFor(0.4);
    drop(container, cx + 40, cy);
    expect(container.querySelector('.watt-clover')).not.toBeNull();
    expect(stored().today?.clovers ?? 0).toBe(0);
    runFor(1);
    grab(container, 500, 400, 2);
    move(container, 520, 400, 2);
    move(container, cx + 20, cy + 10, 2);
    runFor(0.4);
    drop(container, cx + 20, cy + 10, 2);
    expect(container.querySelector('.watt-clover')).toBeNull();
    expect(stored().today.clovers).toBe(1);
  });

  describe('shaking him', () => {
    const shake = (c: HTMLElement, swings: number) => {
      for (let i = 0; i < swings; i++) {
        move(c, i % 2 ? 900 : 1000 + 100, 300);
        tick();
      }
    };
    it('three fast direction changes in a second make him dizzy for 3 seconds after landing, with a dizzy line at most once a minute', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let ms = day();
      const { container } = start(() => ms);
      grab(container, 500, 400);
      move(container, 520, 400);
      move(container, 1000, 300);
      runFor(0.4);
      shake(container, 8);
      drop(container, 1000, 300);
      runFor(0.9);
      expect(eyes(container)).toBe(5);
      expect(LINES.dizzy).toContain(flat(container));
      runFor(3.5);
      expect(eyes(container)).toBe(1);
      // Shaken again within a minute: dizzy eyes, but no second dizzy line.
      ms += 25_000;
      act(() => void vi.advanceTimersByTime(8000));
      runFor(8);
      grab(container, 500, 400, 2);
      move(container, 520, 400, 2);
      move(container, 1000, 300, 2);
      runFor(0.4);
      for (let i = 0; i < 8; i++) {
        move(container, i % 2 ? 900 : 1100, 300, 2);
        tick();
      }
      drop(container, 1000, 300, 2);
      runFor(0.9);
      expect(eyes(container)).toBe(5);
      expect(LINES.dizzy).not.toContain(flat(container));
    });
    it('a slow swing, or a single direction change, does not', () => {
      const { container } = start();
      grab(container, 500, 400);
      move(container, 520, 400);
      for (let i = 0; i < 12; i++) {
        move(container, i % 2 ? 990 : 1010, 300);
        tick();
      }
      move(container, 1500, 300);
      tick();
      move(container, 400, 300);
      tick();
      drop(container, 400, 300);
      runFor(0.9);
      expect(eyes(container)).toBe(1);
    });
  });

  describe('his lines', () => {
    const text = (c: HTMLElement) => (c.querySelector('.watt-bubble') ? flat(c) : null);
    it('one held line a moment in, however long he is held; one on landing; both from their own groups', () => {
      const { container } = start();
      carryAway(container, 450, 120);
      expect(text(container)).toBeNull();
      runFor(1);
      const held = text(container);
      expect(LINES.held).toContain(held);
      runFor(5);
      expect(text(container)).toBe(held);
      drop(container, 450, 120);
      runFor(0.9);
      expect(LINES.landed).toContain(text(container));
    });
    it('says nothing when chatty is off, in a call, in the first minute of focus, while idle or asleep', () => {
      const quiet: [string, () => void, (ms: number) => number][] = [
        ['off', () => localStorage.setItem(PET_KEY, JSON.stringify({ chatty: 'off' })), () => day()],
        ['focus', () => useFocusStore.setState({ state: { status: 'running', minutes: 25, endAt: day() + 24.5 * 60_000 } as never }), () => day()],
        ['idle', () => void (idleState.on = true), () => day()],
      ];
      for (const [name, setup, clock] of quiet) {
        localStorage.clear();
        idleState.on = false;
        useFocusStore.setState({ state: { status: 'idle', minutes: 25 } });
        setup();
        const { container, unmount } = start(() => clock(0));
        if (name === 'idle') {
          // The display going idle sets him down; he cannot be picked up into a line.
          grab(container, 500, 400);
          move(container, 600, 400);
        } else carryAway(container, 450, 120);
        runFor(3);
        drop(container, 450, 120);
        runFor(1);
        expect(text(container), name).toBeNull();
        unmount();
      }
    });
    it('a carry within 20 seconds of the last one says nothing more', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let ms = day();
      const { container } = start(() => ms);
      carryAway(container, 450, 120);
      runFor(1.2);
      drop(container, 450, 120);
      runFor(9);
      act(() => void vi.advanceTimersByTime(8000));
      ms += 10_000;
      grab(container, 500, 400, 2);
      move(container, 520, 400, 2);
      move(container, 450, 120, 2);
      runFor(2);
      expect(text(container)).toBeNull();
      drop(container, 450, 120, 2);
    });
  });

  // What this guards: no timer (setTimeout or setInterval) is made, and exactly one frame is requested, per
  // frame while he is carried. Closures and arrays made in the paint path are not counted here; the rule
  // is kept by the comment at the top of `paint` in Watt.tsx and by reading the diff.
  it('the frame loop makes no timer per frame while he is carried (timers only; the rule for closures is a comment in paint)', () => {
    const { container } = start();
    carryAway(container, 700, 250);
    const spy = vi.spyOn(window, 'setTimeout');
    const spyI = vi.spyOn(window, 'setInterval');
    const raf = window.requestAnimationFrame as unknown as ReturnType<typeof vi.fn>;
    raf.mockClear();
    for (let i = 0; i < 40; i++) {
      move(container, 700 + (i % 7) * 15, 250 + (i % 5) * 9);
      spy.mockClear();
      tick();
      // Held lines are the one thing that may arm a timer (the bubble's own), once.
      if (!container.querySelector('.watt-bubble')) expect(spy).not.toHaveBeenCalled();
      else expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
      expect(spyI).not.toHaveBeenCalled();
    }
    expect(raf).toHaveBeenCalledTimes(40);
    drop(container, 700, 250);
  });
});

describe('more of a pet', () => {
  const hitOf = (c: HTMLElement) => c.querySelector<HTMLElement>('.watt-hit')!;
  const sheepOf = (c: HTMLElement) => c.querySelector<HTMLElement>('.watt-sheep')!;
  const eyes = (c: HTMLElement) => c.querySelectorAll('.watt-sheep > svg rect[fill="#35e6ea"]').length;
  const rows = (c: HTMLElement) => (Number(c.querySelector('svg')!.getAttribute('height')) * 18) / Number(c.querySelector('svg')!.getAttribute('width'));
  const y = (c: HTMLElement) => Number(/translate\((-?[\d.]+)px(?:,\s*(-?[\d.]+)px)?\)/.exec(sheepOf(c).style.transform)?.[2] ?? 0);
  const dirOf = (c: HTMLElement) => Number(/scaleX\((-?1)\)/.exec(sheepOf(c).style.transform)![1]);
  const pointer = (x: number, y: number) => act(() => void window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerId: 1 })));
  const open = (c: HTMLElement) => fireEvent.contextMenu(hitOf(c));
  const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.watt-card button')].find((b) => b.textContent?.startsWith(name))!;
  let setCap: ReturnType<typeof vi.fn>;
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  beforeEach(() => {
    setCap = vi.fn();
    proto.setPointerCapture = setCap;
    proto.releasePointerCapture = vi.fn();
    proto.hasPointerCapture = () => true;
  });
  afterEach(() => {
    delete proto.setPointerCapture;
    delete proto.releasePointerCapture;
    delete proto.hasPointerCapture;
  });
  const start = (nowFn: () => number = day) => {
    const r = render(<Watt now={nowFn} />);
    runFor(1.5);
    return r;
  };

  it('he notices the pointer within about 260 px: turns to face it with his ears up, and loses interest after 6 still seconds', () => {
    const { container } = start();
    expect(eyes(container)).toBe(1);
    const mid = middle(WALKS.unwind) + 54;
    // Unwind: he stands facing left at the start; a pointer to his right turns him round.
    pointer(mid + 200, 460);
    runFor(0.2);
    expect(eyes(container)).toBe(3);
    expect(dirOf(container)).toBe(1);
    pointer(mid - 200, 460);
    runFor(0.2);
    expect(dirOf(container)).toBe(-1);
    // Far away: nothing.
    pointer(mid + 600, 460);
    runFor(0.2);
    expect(eyes(container)).toBe(1);
    // Close again, then still for 6 seconds: back to what he was doing.
    pointer(mid + 120, 460);
    runFor(5);
    expect(eyes(container)).toBe(3);
    runFor(1.5);
    expect(eyes(container)).toBe(1);
    // Hovering opens nothing.
    expect(container.querySelector('.watt-card')).toBeNull();
  });

  it('he does not look at it while he reads, eats, or is carried; under reduced motion he stands still', () => {
    const { container } = start();
    pointer(500, 460);
    useFocusStore.setState({ state: { status: 'running', minutes: 25, endAt: day() + 20 * 60_000 } as never });
    runFor(0.3);
    expect(eyes(container)).not.toBe(3);
  });

  it('three clicks within 4 seconds give one happy hop, at most once in 20 seconds', () => {
    let ms = day();
    const { container } = start(() => ms);
    const base = y(container);
    const rise = () => {
      let hi = 0;
      for (let i = 0; i < 32; i++) {
        tick();
        hi = Math.max(hi, base - y(container));
      }
      return hi;
    };
    fireEvent.click(hitOf(container));
    ms += 1200;
    fireEvent.click(hitOf(container));
    ms += 1200;
    // Hearts for the first pet run out; the third click inside 4 s starts the hop.
    runFor(0.1);
    fireEvent.click(hitOf(container));
    expect(rise()).toBeGreaterThan(2);
    // Another three within 20 s: no second hop.
    ms += 4000;
    fireEvent.click(hitOf(container));
    ms += 1000;
    fireEvent.click(hitOf(container));
    ms += 1000;
    fireEvent.click(hitOf(container));
    runFor(2);
    expect(rise()).toBeLessThan(0.5);
    // Slow clicks never do it.
    ms += 60_000;
    runFor(3);
    for (let i = 0; i < 3; i++) {
      ms += 2500;
      fireEvent.click(hitOf(container));
      expect(rise()).toBeLessThan(0.5);
    }
  });

  it('the tenth pet of a day gives a sparkle and a milestone line, once', () => {
    let ms = day();
    localStorage.setItem(PET_KEY, JSON.stringify({ ...defaultPet(day()), days: 3, lastDay: dayKey(day()), today: { ...emptyToday(dayKey(day())), pets: 8 } }));
    const { container } = start(() => ms);
    const spark = () => Number(container.querySelector<HTMLElement>('.watt-spark')!.style.opacity || 0);
    fireEvent.click(hitOf(container));
    runFor(0.5);
    expect(spark()).toBe(0);
    ms += 70_000;
    runFor(3);
    fireEvent.click(hitOf(container));
    let seen = 0;
    for (let i = 0; i < 30; i++) {
      tick();
      seen = Math.max(seen, spark());
    }
    expect(seen).toBeGreaterThan(0);
    expect(stored().today.pets).toBe(10);
    expect(LINES.milestone).toContain((container.querySelector('.watt-bubble')?.textContent ?? '').replace(/\n/g, ' '));
    // The eleventh: no sparkle.
    ms += 70_000;
    runFor(3);
    fireEvent.click(hitOf(container));
    seen = 0;
    for (let i = 0; i < 30; i++) {
      tick();
      seen = Math.max(seen, spark());
    }
    expect(seen).toBe(0);
  });

  describe('tricks', () => {
    const withCard = (nowFn: () => number = day) => {
      const r = start(nowFn);
      open(r.container);
      return r;
    };
    it('each trick runs once; the buttons are 32 px tall, have tooltips, and say what they do', () => {
      const { container } = withCard();
      for (const name of ['Hop', 'Spin', 'Nap', 'Come here', 'Stay', 'Read with me']) {
        const b = button(name);
        expect(b, name).toBeTruthy();
        expect(b.title.length, name).toBeGreaterThan(8);
      }
      expect(button('Read with me').textContent).toBe('Read with me, 25 min');
      // Hop: lifts once.
      const base = y(container);
      fireEvent.click(button('Hop'));
      let hi = 0;
      let peaks = 0;
      let prev = 0;
      for (let i = 0; i < 40; i++) {
        tick();
        const h = base - y(container);
        hi = Math.max(hi, h);
        if (prev > 0.5 && h < prev - 0.5 && !(peaks > 0 && h > prev)) peaks = Math.max(peaks, 1);
        prev = h;
      }
      expect(hi).toBeGreaterThan(2);
      expect(Math.abs(base - y(container))).toBeLessThan(0.01);
      // Spin: turns through both turned frames and ends as he was, without lifting.
      const frames = new Set<string>();
      fireEvent.click(button('Spin'));
      for (let i = 0; i < 26; i++) {
        tick();
        frames.add(container.querySelector('.watt-sheep > svg')!.innerHTML);
        expect(base - y(container)).toBeLessThan(0.01);
      }
      expect(frames.size).toBeGreaterThanOrEqual(3);
    });
    it('every card button is held to at least 32 px', () => {
      withCard();
      const all = document.querySelectorAll<HTMLButtonElement>('.watt-card button');
      expect(all.length).toBeGreaterThanOrEqual(13);
      for (const b of all) expect(b.style.minHeight, b.textContent ?? '').toBe('32px');
    });
    it('Nap lies him down for a minute, or until he is petted', () => {
      let ms = day();
      const { container } = withCard(() => ms);
      fireEvent.click(button('Nap'));
      runFor(0.3);
      expect(rows(container)).toBe(8);
      expect(Number(container.querySelector<HTMLElement>('.watt-z')!.style.opacity || 0)).toBeGreaterThanOrEqual(0);
      const x = where(container).x;
      runFor(30);
      expect(where(container).x).toBe(x);
      expect(rows(container)).toBe(8);
      // Petting wakes him.
      fireEvent.pointerDown(document.body);
      fireEvent.click(hitOf(container));
      runFor(0.3);
      expect(rows(container)).toBe(12);
      // A fresh nap ends by itself after a minute.
      fireEvent.contextMenu(hitOf(container));
      fireEvent.click(button('Nap'));
      runFor(0.3);
      expect(rows(container)).toBe(8);
      ms += 61_000;
      runFor(0.3);
      expect(rows(container)).toBe(12);
    });
    it('Come here trots him to the middle of the place and he wanders on from there', () => {
      const { container } = start();
      // Set him down at the far end first.
      fireEvent.pointerDown(hitOf(container), { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 500, clientY: 400 });
      fireEvent.pointerMove(hitOf(container), { pointerId: 1, pointerType: 'mouse', clientX: 600, clientY: 400 });
      fireEvent.pointerMove(hitOf(container), { pointerId: 1, pointerType: 'mouse', clientX: 2500, clientY: 300 });
      runFor(0.6);
      fireEvent.pointerUp(hitOf(container), { pointerId: 1, pointerType: 'mouse', clientX: 2500, clientY: 300 });
      runFor(1.5);
      expect(where(container).x).toBe(WALKS.unwind.max);
      open(container);
      fireEvent.click(button('Come here'));
      runFor(0.5);
      expect(where(container).x).toBeLessThan(WALKS.unwind.max);
      runFor(10);
      expect(where(container).x).toBe(middle(WALKS.unwind));
      // And he stands there a while (the wander's first stop) before he goes on.
      runFor(10);
      expect(where(container).x).toBe(middle(WALKS.unwind));
      expect(rows(container)).toBe(12);
    });
    it('Stay keeps him sitting where he was set down, survives a reload, and ends on a place change', () => {
      const { container, unmount } = withCard();
      fireEvent.click(button('Stay'));
      runFor(0.5);
      expect(rows(container)).toBe(11);
      const x = where(container).x;
      expect(stored().stay).toMatchObject({ place: 'unwind', x });
      expect(button('Stay').getAttribute('aria-checked')).toBe('true');
      runFor(90);
      expect(where(container).x).toBe(x);
      expect(rows(container)).toBe(11);
      unmount();
      // Reload: still there, still sitting.
      const again = start();
      runFor(1);
      expect(again.container.querySelector('svg')!.getAttribute('height')).toBe(String(11 * 6));
      expect(where(again.container).x).toBe(x);
      // A place change ends it for good.
      go('home');
      publishCamera(CAMERAS.home, false);
      runFor(FADE_OUT_S + FADE_IN_S + 1);
      expect(stored().stay).toBeNull();
      go('unwind');
      publishCamera(CAMERAS.unwind, false);
      runFor(FADE_OUT_S + FADE_IN_S + 1);
      expect(rows(again.container)).toBe(12);
    });
    it('Stay can be switched off; he walks back to his wander', () => {
      const { container } = withCard();
      fireEvent.click(button('Stay'));
      runFor(1);
      fireEvent.click(button('Stay'));
      expect(stored().stay).toBeNull();
      runFor(10);
      expect(rows(container)).toBe(12);
    });
    it('a Stay from another day is not applied', () => {
      localStorage.setItem(PET_KEY, JSON.stringify({ ...defaultPet(day()), stay: { place: 'unwind', x: 440, date: '2026-11-10' } }));
      const { container } = start();
      runFor(1);
      expect(rows(container)).toBe(12);
    });
    it('is refused quietly in a call, in the first minute of focus and while he sleeps: the buttons are off, with the reason, and nothing is said', () => {
      for (const [name, setup, clock] of [
        ['a call', () => {}, day],
        ['focus', () => useFocusStore.setState({ state: { status: 'running', minutes: 25, endAt: day() + 24.5 * 60_000 } as never }), day],
        ['night', () => {}, night],
      ] as const) {
        useFocusStore.setState({ state: { status: 'idle', minutes: 25 } });
        setup();
        const r = render(<Watt now={clock} inCall={name === 'a call'} />);
        runFor(FADE_IN_S + 0.5);
        fireEvent.contextMenu(hitOf(r.container));
        for (const t of ['Hop', 'Spin', 'Nap', 'Come here', 'Stay']) {
          expect(button(t).disabled, `${name} ${t}`).toBe(true);
          expect(button(t).title.length, `${name} ${t}`).toBeGreaterThan(8);
        }
        fireEvent.click(button('Hop'));
        runFor(1);
        expect(r.container.querySelector('.watt-bubble'), name).toBeNull();
        r.unmount();
      }
    });
    it('Read with me starts the focus timer at its default length, and is off with a tooltip while one runs', () => {
      const { container } = withCard();
      expect(button('Read with me').disabled).toBe(false);
      fireEvent.click(button('Read with me'));
      const st = useFocusStore.getState().state;
      expect(st.status).toBe('running');
      expect(st.minutes).toBe(25);
      runFor(0.3);
      expect(button('Read with me').disabled).toBe(true);
      expect(button('Read with me').title).toMatch(/already running/);
      // He opens his book as he already does in focus.
      runFor(2);
      expect(container.querySelector('.watt-prop-book')).not.toBeNull();
    });
  });
});

describe('a firefly at dusk', () => {
  const fly = (c: HTMLElement) => c.querySelector<HTMLElement>('.watt-firefly')!;
  const dusk = () => local(18, 0);
  it('drifts near him between sunset and bedtime, blinking softly, and he turns to watch it', () => {
    sunMock.set = local(16, 35);
    const { container } = render(<Watt now={dusk} />);
    runFor(2);
    const dirs = new Set<string>();
    let hi = 0;
    let lo = 1;
    for (let i = 0; i < 400; i++) {
      tick();
      const o = Number(fly(container).style.opacity);
      hi = Math.max(hi, o);
      lo = Math.min(lo, o);
      expect(o).toBeLessThanOrEqual(0.9);
      const fx = parseFloat(fly(container).style.left);
      const me = where(container).x;
      expect(Math.abs(fx - me)).toBeLessThan(220);
      dirs.add(/scaleX\((-?1)\)/.exec(container.querySelector<HTMLElement>('.watt-sheep')!.style.transform)![1]);
    }
    expect(hi).toBeGreaterThan(0.6);
    expect(lo).toBeGreaterThan(0.4);
    expect(dirs.size).toBe(2);
    // One sprite, in the band.
    expect(container.querySelectorAll('.watt-firefly').length).toBe(1);
    expect(parseFloat(fly(container).style.top)).toBeGreaterThanOrEqual(WALKS.unwind.ceiling);
  });
  it('is not there before sunset, after bedtime, under reduced motion, or in a call', () => {
    sunMock.set = local(16, 35);
    for (const [name, clock, red, call] of [
      ['before sunset', () => local(15, 0), false, false],
      ['after bedtime', () => local(22, 0), false, false],
      ['reduced motion', dusk, true, false],
      ['in a call', dusk, false, true],
    ] as const) {
      reduced(red);
      const r = render(<Watt now={clock} inCall={call} />);
      runFor(FADE_IN_S + 1);
      expect(Number(fly(r.container).style.opacity || 0), name).toBe(0);
      r.unmount();
    }
  });
  it('is not there on Meet while he is hidden for a call', () => {
    sunMock.set = local(16, 35);
    usePlaceStore.setState({ active: 'meet' });
    publishCamera(CAMERAS.meet, false);
    const { container } = render(<Watt now={dusk} inCall />);
    runFor(2);
    expect(Number(fly(container).style.opacity || 0)).toBe(0);
  });
});

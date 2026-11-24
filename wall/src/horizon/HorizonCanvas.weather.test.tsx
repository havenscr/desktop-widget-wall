import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackdropSettings } from '../backdrop/settings';
import { HorizonCanvas, WeatherOverlay } from './HorizonCanvas';
import type { HorizonOptions } from './index';
import { stubContext } from './canvasStub';
import { useSkyClaim, useSkyStore } from './sky';
import { usePlaceStore } from '../state/places';
import { resetAudio } from '../audio/store';
import { useSceneWeather } from '../weather/sceneSetting';
import { useWeatherStore } from '../weather/useWeather';
import { useIdle } from '../ui/useIdle';
import type { WeatherReading } from '../weather/model';

vi.setConfig({ testTimeout: 20_000 });

vi.mock('../ui/useIdle', () => ({ useIdle: vi.fn(() => false) }));
const idleMock = vi.mocked(useIdle);

interface Ev {
  k: 'sky' | 'ground' | 'whole' | 'back' | 'mid' | 'veil';
  ctx: unknown;
  awake?: number;
  boxes?: number;
  clearOff?: boolean;
}
const { events } = vi.hoisted(() => ({ events: [] as unknown[] }));
const log = events as Ev[];

vi.mock('./index', async (original) => ({
  ...(await original<typeof import('./index')>()),
  drawHorizon: (ctx: CanvasRenderingContext2D, o: HorizonOptions) => void events.push({ k: o.part ?? 'whole', ctx, clearOff: (ctx as unknown as { clearRect: { name: string } }).clearRect.name === 'NO_CLEAR' }),
}));
vi.mock('./veil', async (original) => ({
  ...(await original<typeof import('./veil')>()),
  drawVeil: (ctx: CanvasRenderingContext2D) => void events.push({ k: 'veil', ctx }),
}));
vi.mock('./weatherLayer', async (original) => {
  const m = await original<typeof import('./weatherLayer')>();
  return {
    ...m,
    drawWeatherBack: (ctx: CanvasRenderingContext2D, layer: import('./weatherLayer').WeatherLayer, ...rest: [number, number, number, number, number, number]) => {
      events.push({ k: 'back', ctx, awake: rest[5], boxes: layer.boxes.n });
      m.drawWeatherBack(ctx, layer, ...rest);
    },
    drawWeatherMid: (ctx: CanvasRenderingContext2D, layer: import('./weatherLayer').WeatherLayer, ...rest: [number, number, number, number, number, number]) => {
      events.push({ k: 'mid', ctx, awake: rest[5], boxes: layer.boxes.n });
      m.drawWeatherMid(ctx, layer, ...rest);
    },
  };
});

const NOON = new Date(2026, 10, 11, 12, 0).getTime();
const rainReading = (now: number): WeatherReading => ({ temp: 50, look: { label: 'Rain', icon: 'rain' }, high: 55, low: 45, hours: [], fetchedAt: now, code: 63 }) as WeatherReading;

let frames: Map<number, FrameRequestCallback>;
let nextId: number;
let ctxOf: Map<HTMLCanvasElement, CanvasRenderingContext2D>;

function runFrame(ts: number) {
  const id = Math.max(...frames.keys());
  const cb = frames.get(id)!;
  frames.delete(id);
  act(() => cb(ts));
}
/** Run `n` frames 100 ms apart from `from` (each steps the layer by the 0.1 s cap). */
function runFrames(n: number, from = 100) {
  for (let i = 0; i < n; i++) runFrame(from + i * 100);
}
/** The kinds in the newest frame: the events after the last whole-draw start. */
function lastFrame(): Ev[] {
  const startKinds = ['sky', 'whole'];
  let i = log.length - 1;
  while (i > 0 && !(startKinds.includes(log[i].k) && (i === 0 || log[i].k === 'whole' || log[i - 1].k !== 'back'))) i--;
  // walk back to the frame's first event: a 'sky' or 'whole' that is not preceded by one of this frame's events is its start
  return log.slice(i);
}

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({ matches: reduce && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

beforeEach(() => {
  usePlaceStore.setState({ active: 'unwind' });
  useSkyStore.setState({ claims: {} });
  useSceneWeather.setState({ on: true });
  useWeatherStore.setState({ reading: null });
  idleMock.mockImplementation(() => false);
  resetAudio();
  frames = new Map();
  nextId = 1;
  ctxOf = new Map();
  log.length = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    const id = nextId++;
    frames.set(id, cb);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => void frames.delete(id));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    if (!ctxOf.has(this)) ctxOf.set(this, stubContext());
    return ctxOf.get(this) as never;
  } as never);
  window.history.replaceState(null, '', '/');
  setHidden(false);
  setReducedMotion(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setHidden(false);
  useSkyStore.setState({ claims: {} });
  useWeatherStore.setState({ reading: null });
  useSceneWeather.setState({ on: true });
});

function Asker({ boxes }: { boxes?: [number, number, number, number][] }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useSkyClaim('test', { front: host, boxes });
  return <div ref={setHost} />;
}

const kinds = (evs: Ev[]) => evs.map((e) => e.k);
const main = () => document.querySelector('canvas.horizon-canvas:not(.horizon-front)') as HTMLCanvasElement;
const front = () => document.querySelector('canvas.horizon-front') as HTMLCanvasElement | null;

describe('the weather in the horizon frame', () => {
  it('with no weather the draw is today\'s: one whole draw a frame, no part, no weather call', () => {
    render(<HorizonCanvas now={() => NOON} />);
    runFrames(5);
    expect(kinds(log).filter((k) => k === 'whole')).toHaveLength(6);
    expect(kinds(log).filter((k) => k === 'back' || k === 'mid' || k === 'sky' || k === 'ground')).toEqual([]);
  });

  it('with rain and one canvas the frame is sky, the weather behind the ridge, ground, then the weather in front, all on the one canvas, with only the ground\'s own clear switched off', () => {
    useWeatherStore.setState({ reading: rainReading(NOON) });
    render(<HorizonCanvas now={() => NOON} />);
    runFrame(100);
    runFrame(200);
    const f = lastFrame();
    expect(kinds(f)).toEqual(['sky', 'back', 'ground', 'mid']);
    const ctx = ctxOf.get(main());
    for (const e of f) expect(e.ctx).toBe(ctx);
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
    // The ground part clears its canvas first, which would wipe the sky and the weather: off during that draw only.
    expect(f.map((e) => e.clearOff)).toEqual([false, undefined, true, undefined]);
    expect((ctx as unknown as { clearRect: { name: string } }).clearRect.name).not.toBe('NO_CLEAR');
    expect(log.filter((e) => e.k === 'sky' || e.k === 'whole').every((e) => e.clearOff === false)).toBe(true);
  });

  it('with the front canvas the back goes on the main canvas after the sky and the mid on the front canvas after the veil (above it)', () => {
    useWeatherStore.setState({ reading: rainReading(NOON) });
    render(
      <>
        <HorizonCanvas now={() => NOON} />
        <Asker />
      </>,
    );
    runFrame(100);
    runFrame(200);
    expect(front()).not.toBeNull();
    const f = lastFrame();
    expect(kinds(f)).toEqual(['sky', 'back', 'ground', 'veil', 'mid']);
    expect(f[0].ctx).toBe(ctxOf.get(main()));
    expect(f[1].ctx).toBe(ctxOf.get(main()));
    expect(f[2].ctx).toBe(ctxOf.get(front()!));
    expect(f[3].ctx).toBe(ctxOf.get(front()!));
    expect(f[4].ctx).toBe(ctxOf.get(front()!));
    // The page's overlay stays empty while the front canvas carries the layer.
  });

  it('with one canvas and the page\'s overlay canvas (after the veil) the mid layer is drawn on the overlay, cleared and sized each frame, and the overlay is emptied when the layer is off', () => {
    useWeatherStore.setState({ reading: rainReading(NOON) });
    render(
      <>
        <HorizonCanvas now={() => NOON} />
        <div className="veil" />
        <WeatherOverlay />
      </>,
    );
    runFrame(100);
    runFrame(200);
    const overlay = document.querySelector('canvas.horizon-weather') as HTMLCanvasElement;
    expect(overlay).not.toBeNull();
    // The veil comes before it in the page, so it lies above the veil.
    expect(document.querySelector('.veil')!.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const f = lastFrame();
    expect(kinds(f)).toEqual(['sky', 'back', 'ground', 'mid']);
    expect(f[3].ctx).toBe(ctxOf.get(overlay));
    expect(f[3].ctx).not.toBe(ctxOf.get(main()));
    expect(overlay.width).toBe(main().width);
    expect(overlay.height).toBe(main().height);
    act(() => useSceneWeather.getState().setOn(false));
    runFrames(100, 10_000);
    expect(overlay.width).toBe(0);
    expect(overlay.height).toBe(0);
  });

  it('hands the layer the skip boxes of the sky claims', () => {
    useWeatherStore.setState({ reading: rainReading(NOON) });
    render(
      <>
        <HorizonCanvas now={() => NOON} />
        <Asker boxes={[[100, 100, 800, 400]]} />
      </>,
    );
    runFrame(100);
    runFrame(200);
    expect(log.filter((e) => e.k === 'mid').pop()!.boxes).toBe(4);
  });

  it('draws none of it on Zen (the picture runs, the weather layer does not)', () => {
    useWeatherStore.setState({ reading: rainReading(NOON) });
    usePlaceStore.setState({ active: 'zen' });
    // The animated sky is on for Zen by default, which splits the picture; its own test is in HorizonCanvas.skyLayer.test.tsx.
    useBackdropSettings.setState({ places: [] });
    render(<HorizonCanvas now={() => NOON} />);
    expect(frames.size).toBe(1);
    runFrame(100);
    expect([...new Set(kinds(log))]).toEqual(['whole']);
  });

  it('draws no layer under reduced motion, nothing while the page is hidden', () => {
    useWeatherStore.setState({ reading: rainReading(NOON) });
    setReducedMotion(true);
    render(<HorizonCanvas now={() => NOON} />);
    expect(kinds(log)).toEqual(['whole']);
    cleanup();
    log.length = 0;
    setReducedMotion(false);
    setHidden(true);
    render(<HorizonCanvas now={() => NOON} />);
    runFrame(100);
    expect(log).toEqual([]);
  });

  it('a stale reading, or a dry one, gives no layer', () => {
    useWeatherStore.setState({ reading: rainReading(NOON - 3 * 3_600_000) });
    render(<HorizonCanvas now={() => NOON} />);
    runFrames(3);
    expect(kinds(log).every((k) => k === 'whole')).toBe(true);
    cleanup();
    log.length = 0;
    useWeatherStore.setState({ reading: { ...rainReading(NOON), look: { label: 'Sunny', icon: 'sun' }, code: 0 } as WeatherReading });
    render(<HorizonCanvas now={() => NOON} />);
    runFrames(3);
    expect(kinds(log).every((k) => k === 'whole')).toBe(true);
  });

  it('the Tools switch off fades the layer out over about 8 seconds and the whole draw comes back', () => {
    useWeatherStore.setState({ reading: rainReading(NOON) });
    render(<HorizonCanvas now={() => NOON} />);
    // Ramp up first.
    runFrames(100);
    expect(kinds(lastFrame())).toEqual(['sky', 'back', 'ground', 'mid']);
    act(() => useSceneWeather.getState().setOn(false));
    log.length = 0;
    runFrames(40, 20_000);
    // Four seconds later it is still drawn, fading.
    expect(kinds(lastFrame())).toEqual(['sky', 'back', 'ground', 'mid']);
    runFrames(60, 30_000);
    log.length = 0;
    runFrames(2, 40_000);
    expect(kinds(log).every((k) => k === 'whole')).toBe(true);
  });

  it('passes the idle fade: the layer is asked to draw with awake 0 once the display is idle', () => {
    useWeatherStore.setState({ reading: rainReading(NOON) });
    idleMock.mockImplementation(() => true);
    render(<HorizonCanvas now={() => NOON} />);
    runFrames(15);
    const mids = log.filter((e) => e.k === 'mid');
    expect(mids.length).toBeGreaterThan(0);
    expect(mids[mids.length - 1].awake).toBe(0);
  });
});

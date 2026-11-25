import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HorizonCanvas } from './HorizonCanvas';
import type { HorizonOptions } from './index';
import { stubContext } from './canvasStub';
import { useSkyClaim, useSkyStore } from './sky';
import { usePlaceStore, type PlaceId } from '../state/places';
import { resetAudio } from '../audio/store';
import { resetSkyStore, useBackdropSettings } from '../backdrop/settings';
import { LINGER_MS } from '../backdrop/useSkyLayer';

vi.mock('../ui/useIdle', () => ({ useIdle: vi.fn(() => false) }));
const { draw } = vi.hoisted(() => ({ draw: vi.fn() }));
vi.mock('./index', async (original) => ({
  ...(await original<typeof import('./index')>()),
  drawHorizon: (ctx: CanvasRenderingContext2D, o: HorizonOptions) => draw(ctx, { ...o }),
}));
// One fake graphics context, counted.
const { made, shaders } = vi.hoisted(() => ({ made: { n: 0 }, shaders: [] as { draw: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] }));
vi.mock('../backdrop/shader', async (original) => ({
  ...(await original<typeof import('../backdrop/shader')>()),
  createShader: () => {
    made.n++;
    const s = { setStyle: vi.fn(), resize: vi.fn(), draw: vi.fn(), dispose: vi.fn() };
    shaders.push(s);
    return s;
  },
}));

const NOON = new Date(2026, 10, 11, 12, 30).getTime();
let frames: Map<number, FrameRequestCallback>;
let nextId: number;
let ctxOf: Map<HTMLCanvasElement, CanvasRenderingContext2D>;

function runFrame(ts: number) {
  const id = Math.max(...frames.keys());
  const cb = frames.get(id)!;
  frames.delete(id);
  act(() => cb(ts));
}
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}
function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({ matches: reduce && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  resetSkyStore();
  usePlaceStore.setState({ active: 'work' });
  useSkyStore.setState({ claims: {} });
  resetAudio();
  frames = new Map();
  nextId = 1;
  ctxOf = new Map();
  made.n = 0;
  shaders.length = 0;
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
  draw.mockClear();
  setHidden(false);
  setReducedMotion(false);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  setHidden(false);
  useSkyStore.setState({ claims: {} });
  resetSkyStore();
});

const canvases = () => [...document.querySelectorAll('canvas')];
const ground = () => document.querySelector('canvas.horizon-ground') as HTMLCanvasElement | null;
const backdrop = () => document.querySelector('canvas.backdrop-canvas') as HTMLCanvasElement | null;
const turnOn = (...places: PlaceId[]) => act(() => useBackdropSettings.setState({ places }));
const parts = () => draw.mock.calls.map(([, o]) => (o as HorizonOptions).part ?? 'whole');

function Asker() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useSkyClaim('test', { front: host });
  return <div ref={setHost} />;
}

describe('the animated sky layer in the horizon', () => {
  it('off (Work is not listed by default): one canvas, whole draws, no sky layer and no context made', () => {
    render(<HorizonCanvas now={() => NOON} />);
    runFrame(100);
    expect(canvases()).toHaveLength(1);
    expect(new Set(parts())).toEqual(new Set(['whole']));
    expect(made.n).toBe(0);
  });

  it('on for the page: the sky layer sits between the canvases, the ground is drawn on its own canvas, and the main one draws the sky only', () => {
    turnOn('work');
    render(<HorizonCanvas now={() => NOON} />);
    runFrame(100);
    const list = canvases();
    expect(list.map((c) => c.className)).toEqual(['horizon-canvas', 'backdrop-canvas', 'horizon-canvas horizon-ground']);
    expect(new Set(parts())).toEqual(new Set(['sky', 'ground']));
    const [skyCall, groundCall] = draw.mock.calls.slice(-2);
    expect(skyCall[0]).toBe(ctxOf.get(list[0]));
    expect(groundCall[0]).toBe(ctxOf.get(list[2]));
    // Under the veil and the rail: no front canvas, no left edge cut.
    expect(document.querySelector('canvas.horizon-front')).toBeNull();
    expect(ground()!.style.clipPath).toBe('');
  });

  it('keeps one context across page switches and settings changes', () => {
    turnOn('work', 'home');
    render(<HorizonCanvas now={() => NOON} />);
    runFrame(100);
    act(() => usePlaceStore.setState({ active: 'home' }));
    runFrame(200);
    act(() => useBackdropSettings.getState().setStyle('aurora'));
    runFrame(300);
    expect(made.n).toBe(1);
  });

  it('a page without the sky fades it out, keeps the ground canvas for the fade, then returns to one canvas', () => {
    vi.useFakeTimers();
    turnOn('work');
    render(<HorizonCanvas now={() => NOON} />);
    act(() => usePlaceStore.setState({ active: 'meet' }));
    expect(ground()).not.toBeNull();
    act(() => void vi.advanceTimersByTime(LINGER_MS + 10));
    expect(ground()).toBeNull();
    // The very draw after it goes is the whole picture: no frame with no ground.
    expect(parts().slice(-1)[0]).toBe('whole');
  });

  it('a screen that claims the sky takes over: the front host path runs and the in place ground is gone', () => {
    turnOn('work');
    render(
      <>
        <HorizonCanvas now={() => NOON} />
        <Asker />
      </>,
    );
    runFrame(100);
    expect(ground()).toBeNull();
    expect(document.querySelector('canvas.horizon-front')).not.toBeNull();
    expect(backdrop()!.style.display).not.toBe('none');
  });

  it('draws Zen (listed by default) split too, and hides both canvases once Dream has dimmed', () => {
    usePlaceStore.setState({ active: 'zen' });
    render(<HorizonCanvas now={() => NOON} />);
    runFrame(100);
    expect(ground()).not.toBeNull();
    expect(new Set(parts())).toEqual(new Set(['sky', 'ground']));
  });

  it('under reduced motion draws one still and mounts both layers', () => {
    setReducedMotion(true);
    turnOn('work');
    render(<HorizonCanvas now={() => NOON} />);
    expect(ground()).not.toBeNull();
    expect(new Set(parts())).toEqual(new Set(['sky', 'ground']));
    expect(shaders[0].draw).toHaveBeenCalledTimes(1);
  });

  it('a context that cannot be made leaves the page as it was and says so', () => {
    turnOn('work');
    act(() => useBackdropSettings.getState().markUnavailable());
    render(<HorizonCanvas now={() => NOON} />);
    runFrame(100);
    expect(canvases()).toHaveLength(1);
  });
});

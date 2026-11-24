import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaceStore } from '../state/places';
import { resetSkyStore, skySettings, useBackdropSettings } from './settings';
import { Backdrop, GUARD_FRAMES, PAGE_BUFFER, PAGE_FRAME_MS, ZEN_BUFFER, ZEN_FRAME_MS } from './Backdrop';
import { setDream, resetStage } from '../zen/stage';

const { made, shader, lostRef } = vi.hoisted(() => ({
  made: { n: 0, fail: false },
  shader: { setStyle: vi.fn(), resize: vi.fn(), draw: vi.fn(), dispose: vi.fn() },
  lostRef: { fn: () => {} },
}));
vi.mock('./shader', () => ({
  createShader: (_el: unknown, lost: () => void) => {
    made.n++;
    lostRef.fn = lost;
    return made.fail ? null : shader;
  },
}));

let frames: Map<number, FrameRequestCallback>;
let nextId: number;
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
  resetStage();
  usePlaceStore.setState({ active: 'work' });
  frames = new Map();
  nextId = 1;
  made.n = 0;
  made.fail = false;
  Object.values(shader).forEach((f) => f.mockClear());
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    const id = nextId++;
    frames.set(id, cb);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => void frames.delete(id));
  setHidden(false);
  setReducedMotion(false);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setHidden(false);
});

const mount = (on = true, mounted = true, review: Parameters<typeof Backdrop>[0]['review'] = null) => render(<Backdrop on={on} mounted={mounted} review={review} />);

describe('Backdrop', () => {
  it('draws on the slow page rate on Work and the faster Zen rate on Zen', () => {
    mount();
    runFrame(1000);
    const n0 = shader.draw.mock.calls.length;
    runFrame(1000 + PAGE_FRAME_MS - 20);
    expect(shader.draw.mock.calls.length).toBe(n0);
    runFrame(1000 + PAGE_FRAME_MS);
    expect(shader.draw.mock.calls.length).toBe(n0 + 1);
    cleanup();
    usePlaceStore.setState({ active: 'zen' });
    shader.draw.mockClear();
    mount();
    runFrame(5000);
    runFrame(5000 + ZEN_FRAME_MS);
    expect(shader.draw.mock.calls.length).toBe(2);
  });

  it('uses the small buffer on a page and the larger one on Zen', () => {
    mount();
    runFrame(1000);
    expect(shader.resize).toHaveBeenLastCalledWith(PAGE_BUFFER[0], PAGE_BUFFER[1]);
    act(() => usePlaceStore.setState({ active: 'zen' }));
    runFrame(2000);
    expect(shader.resize).toHaveBeenLastCalledWith(ZEN_BUFFER[0], ZEN_BUFFER[1]);
  });

  it('stops when the page is hidden and starts again when it shows', () => {
    mount();
    runFrame(1000);
    setHidden(true);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(frames.size).toBe(0);
    setHidden(false);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(frames.size).toBe(1);
  });

  it('draws one frame under reduced motion and requests no more', () => {
    setReducedMotion(true);
    mount();
    expect(shader.draw).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it('draws a review frame once, at the moment asked', () => {
    mount(true, true, { ms: Date.UTC(2026, 10, 11, 22), t: 77 });
    expect(shader.draw).toHaveBeenCalledTimes(1);
    expect(shader.draw.mock.calls[0][0]).toBe(77);
    expect(frames.size).toBe(0);
  });

  it('is not run at all while the layer is not mounted, and its canvas is hidden', () => {
    const { container } = mount(false, false);
    expect(frames.size).toBe(0);
    expect((container.querySelector('canvas') as HTMLElement).style.display).toBe('none');
  });

  it('fades out when no longer wanted and then stops asking for frames', () => {
    const { rerender } = mount();
    runFrame(1000);
    rerender(<Backdrop on={false} mounted={true} review={null} />);
    for (let k = 1; k < 12 && frames.size > 0; k++) runFrame(1000 + k * 200);
    expect(frames.size).toBe(0);
    const total = shader.draw.mock.calls.map((c) => c[2] as number);
    expect(total[total.length - 1]).toBeLessThanOrEqual(total[0]);
  });

  it('stops on Dream once the picture has faded out, and runs again when the stage changes back', () => {
    usePlaceStore.setState({ active: 'zen' });
    mount();
    runFrame(1000);
    const now = performance.now();
    act(() => setDream(now - 120_000));
    runFrame(2000);
    expect(frames.size).toBe(0);
    act(() => setDream(null));
    expect(frames.size).toBe(1);
  });

  it('halves its buffer when the frames run slow, and never raises it again', () => {
    const real = performance.now.bind(performance);
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 20));
    mount();
    for (let k = 0; k < GUARD_FRAMES + 2; k++) runFrame(1000 + k * 200);
    const widths = shader.resize.mock.calls.map((c) => c[0] as number);
    expect(widths[widths.length - 1]).toBeLessThan(PAGE_BUFFER[0]);
    vi.spyOn(performance, 'now').mockImplementation(real);
    runFrame(100_000);
    expect(shader.resize.mock.calls.map((c) => c[0] as number).slice(-1)[0]).toBeLessThan(PAGE_BUFFER[0]);
  });

  it('turns the sky off for the session when the context is lost or cannot be made', () => {
    mount();
    act(() => lostRef.fn());
    expect(skySettings().available).toBe(false);
    cleanup();
    resetSkyStore();
    made.fail = true;
    mount();
    expect(skySettings().available).toBe(false);
  });

  it('a style change swaps the program only after fading through zero, and makes no new context', () => {
    mount();
    runFrame(1000);
    expect(made.n).toBe(1);
    act(() => useBackdropSettings.getState().setStyle('aurora'));
    runFrame(1200);
    expect(shader.setStyle).not.toHaveBeenCalledWith('aurora');
    runFrame(1400);
    runFrame(1600);
    expect(shader.setStyle).toHaveBeenCalledWith('aurora');
    expect(made.n).toBe(1);
  });
});

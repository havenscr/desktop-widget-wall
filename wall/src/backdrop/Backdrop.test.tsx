import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaceStore } from '../state/places';
import { resetSkyStore, skySettings, useBackdropSettings } from './settings';
import { Backdrop, GUARD_FRAMES, PAGE_BUFFER, PAGE_FRAME_MS, ZEN_BUFFER, ZEN_FRAME_MS } from './Backdrop';
import { setDream, resetStage } from '../zen/stage';
import { useIdle } from '../ui/useIdle';

vi.mock('../ui/useIdle', () => ({ useIdle: vi.fn(() => false) }));

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
  vi.mocked(useIdle).mockReturnValue(false);
  // Only the timers: the frame callbacks are driven by hand.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  setHidden(false);
  setReducedMotion(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  setHidden(false);
});

const mount = (on = true, mounted = true, review: Parameters<typeof Backdrop>[0]['review'] = null) => render(<Backdrop on={on} mounted={mounted} review={review} />);

/** The next frame: the loop waits on a timer, then asks for an animation frame, which the test runs at `ts`. */
function step(ts: number, wait = 200) {
  act(() => void vi.advanceTimersByTime(wait));
  runFrame(ts);
}
const gains = () => shader.draw.mock.calls.map((c) => c[2] as number);

describe('Backdrop', () => {
  it('waits on a timer between frames: about 8 a second on a page, about 16 on Zen, no wake at every vsync', () => {
    mount();
    runFrame(1000);
    expect(frames.size).toBe(0);
    act(() => void vi.advanceTimersByTime(PAGE_FRAME_MS - 9));
    expect(frames.size).toBe(0);
    act(() => void vi.advanceTimersByTime(2));
    expect(frames.size).toBe(1);
    cleanup();
    frames.clear();
    usePlaceStore.setState({ active: 'zen' });
    mount();
    runFrame(5000);
    act(() => void vi.advanceTimersByTime(ZEN_FRAME_MS - 9));
    expect(frames.size).toBe(0);
    act(() => void vi.advanceTimersByTime(2));
    expect(frames.size).toBe(1);
  });

  it('uses the small buffer on a page and the larger one on Zen', () => {
    mount();
    runFrame(1000);
    expect(shader.resize).toHaveBeenLastCalledWith(PAGE_BUFFER[0], PAGE_BUFFER[1]);
    act(() => usePlaceStore.setState({ active: 'zen' }));
    step(2000);
    expect(shader.resize).toHaveBeenLastCalledWith(ZEN_BUFFER[0], ZEN_BUFFER[1]);
  });

  it('stops when the page is hidden and starts again when it shows', () => {
    mount();
    runFrame(1000);
    setHidden(true);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    setHidden(false);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(frames.size).toBe(1);
  });

  it('stops on idle, display off or lock on a page, but never on Zen', () => {
    vi.mocked(useIdle).mockReturnValue(true);
    const { unmount } = mount();
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
    usePlaceStore.setState({ active: 'zen' });
    mount();
    expect(frames.size).toBe(1);
  });

  it('draws one frame under reduced motion and requests no more', () => {
    setReducedMotion(true);
    mount();
    expect(shader.draw).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a strength change redraws the still frame under reduced motion, at the new gain', () => {
    setReducedMotion(true);
    mount();
    expect(shader.draw).toHaveBeenCalledTimes(1);
    const before = gains()[0];
    act(() => useBackdropSettings.getState().setStrength(0.1));
    expect(shader.draw).toHaveBeenCalledTimes(2);
    expect(gains()[1]).toBeLessThan(before);
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

  it('fades in, and when no longer wanted fades out from the gain on screen to zero, then stops', () => {
    const { rerender } = mount();
    runFrame(1000);
    for (let k = 1; k <= 8; k++) step(1000 + k * 130);
    const full = Math.max(...gains());
    expect(full).toBeGreaterThan(0);
    // Faded in by steps, not at once.
    expect(gains()[0]).toBeLessThan(full);
    shader.draw.mockClear();
    rerender(<Backdrop on={false} mounted={true} review={null} />);
    for (let k = 1; k <= 12 && (frames.size > 0 || vi.getTimerCount() > 0); k++) {
      act(() => void vi.advanceTimersByTime(200));
      if (frames.size > 0) runFrame(3000 + k * 130);
    }
    const out = gains();
    // The first frame out is not a freeze at full brightness: it has already stepped down, and some frames sit strictly between.
    expect(out[0]).toBeLessThanOrEqual(full);
    expect(out.some((g) => g > 0 && g < full)).toBe(true);
    expect(out[out.length - 1]).toBe(0);
    for (let k = 1; k < out.length; k++) expect(out[k]).toBeLessThanOrEqual(out[k - 1] + 1e-9);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops on Dream once the picture has faded out, and runs again when the stage changes back', () => {
    usePlaceStore.setState({ active: 'zen' });
    mount();
    runFrame(1000);
    const now = performance.now();
    act(() => setDream(now - 120_000));
    step(2000);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    act(() => setDream(null));
    expect(frames.size).toBe(1);
  });

  it('halves its buffer when frames run late (the real interval, not the time spent drawing), and keeps it halved across an off and on', () => {
    const { rerender } = mount();
    runFrame(1000);
    for (let k = 1; k <= GUARD_FRAMES + 2; k++) step(1000 + k * 400);
    const widths = () => shader.resize.mock.calls.map((c) => c[0] as number);
    expect(widths()[widths().length - 1]).toBe(PAGE_BUFFER[0] / 2);
    rerender(<Backdrop on={false} mounted={true} review={null} />);
    rerender(<Backdrop on={true} mounted={true} review={null} />);
    step(20_000);
    step(20_130);
    expect(widths()[widths().length - 1]).toBe(PAGE_BUFFER[0] / 2);
  });

  it('keeps its buffer when frames arrive on time', () => {
    mount();
    runFrame(1000);
    for (let k = 1; k <= GUARD_FRAMES * 2; k++) step(1000 + k * PAGE_FRAME_MS);
    for (const [w] of shader.resize.mock.calls) expect(w).toBe(PAGE_BUFFER[0]);
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
    step(1050);
    step(1100);
    expect(shader.setStyle).not.toHaveBeenCalledWith('aurora');
    step(1300);
    step(1500);
    expect(shader.setStyle).toHaveBeenCalledWith('aurora');
    expect(made.n).toBe(1);
  });
});

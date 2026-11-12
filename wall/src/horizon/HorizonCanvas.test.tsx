import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HorizonCanvas } from './HorizonCanvas';
import { stubContext } from './canvasStub';
import { usePlaceStore } from '../state/places';

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

let raf: ReturnType<typeof vi.spyOn>;
let frames: FrameRequestCallback[];

beforeEach(() => {
  usePlaceStore.setState({ active: 'work' });
  frames = [];
  raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => stubContext() as never);
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('animates on requestAnimationFrame by default and reads the injected clock', () => {
  setReducedMotion(false);
  const now = vi.fn(() => 1794427200000);
  render(<HorizonCanvas now={now} />);
  expect(raf).toHaveBeenCalled();
  const before = now.mock.calls.length;
  act(() => frames.shift()!(100));
  expect(now.mock.calls.length).toBeGreaterThan(before);
});

it('reduced motion draws once, never starts the frame loop, and redraws each minute', () => {
  setReducedMotion(true);
  vi.useFakeTimers();
  const now = vi.fn(() => 1794427200000);
  render(<HorizonCanvas now={now} />);
  expect(raf).not.toHaveBeenCalled();
  const first = now.mock.calls.length;
  expect(first).toBe(1);
  act(() => void vi.advanceTimersByTime(60_000));
  expect(now.mock.calls.length).toBe(2);
});

it('reduced motion switches cameras at once, without a glide', () => {
  setReducedMotion(true);
  const now = vi.fn(() => 1794427200000);
  render(<HorizonCanvas now={now} />);
  act(() => usePlaceStore.getState().setActive('home'));
  expect(now.mock.calls.length).toBe(2);
});

it('review URL freezes the clock and draws a single still frame', () => {
  setReducedMotion(false);
  window.history.replaceState(null, '', '/?hz=unwind&at=2026-11-11T16:00:00-08:00');
  const now = vi.fn(() => 0);
  render(<HorizonCanvas now={now} />);
  expect(raf).not.toHaveBeenCalled();
  expect(now).not.toHaveBeenCalled();
  act(() => usePlaceStore.getState().setActive('home'));
  expect(raf).not.toHaveBeenCalled();
});

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetAudio, ingestLevels, tickAudio } from '../audio/store';
import { usePlaceStore, type PlaceId } from '../state/places';
import { WALKS, middle } from './model';
import { Watt } from './Watt';

let frames: Map<number, FrameRequestCallback>;
let nextId = 1;
let ts = 0;
const day = () => new Date(2026, 10, 11, 14, 0);
const night = () => new Date(2026, 10, 11, 23, 0);
const runFrame = () => {
  ts += 50;
  const id = Math.max(...frames.keys());
  const cb = frames.get(id)!;
  frames.delete(id);
  act(() => cb(ts));
};
/** Run frames for `s` seconds of animation (50 ms apart). */
const runFor = (s: number) => {
  for (let i = 0; i < Math.round(s / 0.05); i++) runFrame();
};
function reduced(on: boolean) {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as never;
}
const go = (id: PlaceId) => act(() => usePlaceStore.getState().setActive(id));
function where(container: HTMLElement) {
  const sheep = container.querySelector<HTMLElement>('.watt-sheep')!;
  const m = /translate\(([\d.]+)px,\s*([\d.]+)px\)/.exec(sheep.style.transform) ?? [0, NaN, NaN];
  const svg = container.querySelector('svg')!;
  return {
    x: Number(m[1]),
    feet: Number(m[2]) + Number(svg.getAttribute('height')),
    width: Number(svg.getAttribute('width')),
    opacity: Number(container.querySelector<HTMLElement>('.watt')!.style.opacity),
  };
}

beforeEach(() => {
  frames = new Map();
  ts = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    const id = nextId++;
    frames.set(id, cb);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => void frames.delete(id));
  usePlaceStore.setState({ active: 'unwind' });
  resetAudio();
  reduced(false);
});
afterEach(() => vi.restoreAllMocks());

it('stands on each place horizon at that place size: Work, Home and Meet on 582, Unwind on 505', () => {
  const cases: [PlaceId, number, number][] = [
    ['work', 582, 18 * 4],
    ['home', 582, 18 * 5],
    ['meet', 582, 18 * 4],
    ['unwind', 505, 18 * 6],
  ];
  for (const [place, feet, width] of cases) {
    usePlaceStore.setState({ active: place });
    const { container, unmount } = render(<Watt now={day} />);
    runFrame();
    const w = where(container);
    expect(w.feet).toBe(feet);
    expect(w.width).toBe(width);
    expect(w.x).toBe(middle(WALKS[place as keyof typeof WALKS]));
    expect(w.opacity).toBe(1);
    unmount();
  }
});

it('is not shown on Zen, nor on Meet during a call', () => {
  usePlaceStore.setState({ active: 'zen' });
  const { container, rerender } = render(<Watt now={day} />);
  runFrame();
  expect(where(container).opacity).toBe(0);
  go('meet');
  rerender(<Watt now={day} inCall />);
  runFor(3);
  expect(where(container).opacity).toBe(0);
  rerender(<Watt now={day} />);
  runFor(3);
  expect(where(container).opacity).toBe(1);
});

it('fades out on a place change and reappears at the new place, never walking across', () => {
  usePlaceStore.setState({ active: 'work' });
  const { container } = render(<Watt now={day} />);
  runFor(1);
  go('home');
  const xs: number[] = [];
  let sawHidden = false;
  for (let i = 0; i < 80; i++) {
    runFrame();
    const w = where(container);
    if (w.opacity === 0) sawHidden = true;
    if (w.opacity > 0) xs.push(w.x);
  }
  expect(sawHidden).toBe(true);
  // Every visible frame is either on the Work range or on the Home range, nothing in between.
  for (const x of xs) {
    const onWork = x >= WALKS.work.min && x <= WALKS.work.max;
    const onHome = x >= WALKS.home.min && x <= WALKS.home.max;
    expect(onWork || onHome).toBe(true);
  }
  const w = where(container);
  expect(w.x).toBe(middle(WALKS.home));
  expect(w.width).toBe(18 * 5);
  expect(w.opacity).toBe(1);
});

it('shows notes while music plays and drifting z at night', () => {
  const { container, unmount } = render(<Watt now={day} />);
  act(() => {
    ingestLevels({ bass: 0.5, mid: 0.5, high: 0.5, waveform: [1], bands: [1] }, 1000);
    tickAudio(1000);
  });
  runFor(0.5);
  expect(Number(container.querySelector<HTMLElement>('.watt-note')!.style.opacity)).toBeGreaterThan(0);
  unmount();
  resetAudio();
  const n = render(<Watt now={night} />);
  runFor(0.5);
  expect(Number(n.container.querySelector<HTMLElement>('.watt-note')!.style.opacity)).toBe(0);
  expect(Number(n.container.querySelector<HTMLElement>('.watt-z')!.style.opacity)).toBeGreaterThan(0);
});

it('draws once, runs no frame loop and jumps on a place change under reduced motion', () => {
  reduced(true);
  usePlaceStore.setState({ active: 'work' });
  const { container } = render(<Watt now={day} />);
  expect(frames.size).toBe(0);
  expect(where(container).x).toBe(985);
  go('home');
  expect(where(container).x).toBe(1616);
  expect(where(container).opacity).toBe(1);
  go('zen');
  expect(where(container).opacity).toBe(0);
});

it('stops its frame loop on unmount', () => {
  const { unmount } = render(<Watt now={day} />);
  expect(frames.size).toBe(1);
  unmount();
  expect(frames.size).toBe(0);
});

it('does not paint while hidden under reduced motion, and paints once visible again', () => {
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
  const calls = clock.mock.calls.length;
  hide(false);
  expect(clock.mock.calls.length).toBeGreaterThan(calls);
  vi.useRealTimers();
});

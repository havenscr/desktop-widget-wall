import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetAudio, ingestLevels, tickAudio } from '../audio/store';
import { usePlaceStore } from '../state/places';
import { Watt } from './Watt';

let frames: Map<number, FrameRequestCallback>;
let nextId = 1;
const day = () => new Date(2026, 10, 11, 14, 0);
const night = () => new Date(2026, 10, 11, 23, 0);
const runFrame = (ts: number) => {
  const id = Math.max(...frames.keys());
  const cb = frames.get(id)!;
  frames.delete(id);
  act(() => cb(ts));
};
function reduced(on: boolean) {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as never;
}

beforeEach(() => {
  frames = new Map();
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

it('shows on Unwind only', () => {
  const { container, rerender } = render(<Watt now={day} />);
  expect(container.querySelector('.watt')).toBeTruthy();
  act(() => usePlaceStore.getState().setActive('work'));
  rerender(<Watt now={day} />);
  expect(container.querySelector('.watt')).toBeNull();
});

it('puts the sheep on the horizon line inside the walk bounds and shows notes while music plays', () => {
  const { container } = render(<Watt now={day} />);
  act(() => {
    ingestLevels({ bass: 0.5, mid: 0.5, high: 0.5, waveform: [1], bands: [1] }, 1000);
    tickAudio(1000);
  });
  runFrame(100);
  runFrame(600);
  const sheep = container.querySelector<HTMLElement>('.watt-sheep')!;
  const m = /translate\(([\d.]+)px,\s*([\d.]+)px\)/.exec(sheep.style.transform)!;
  expect(Number(m[1])).toBeGreaterThanOrEqual(960);
  expect(Number(m[1])).toBeLessThanOrEqual(1220);
  const svg = container.querySelector('svg')!;
  expect(Number(m[2]) + Number(svg.getAttribute('height'))).toBe(505);
  const note = container.querySelector<HTMLElement>('.watt-note')!;
  expect(Number(note.style.opacity)).toBeGreaterThan(0);
});

it('shows no notes when silent and drifting z at night', () => {
  const { container } = render(<Watt now={night} />);
  runFrame(100);
  runFrame(600);
  expect(Number(container.querySelector<HTMLElement>('.watt-note')!.style.opacity)).toBe(0);
  expect(Number(container.querySelector<HTMLElement>('.watt-z')!.style.opacity)).toBeGreaterThan(0);
});

it('draws once and runs no frame loop under reduced motion', () => {
  reduced(true);
  const { container } = render(<Watt now={day} />);
  expect(frames.size).toBe(0);
  expect(container.querySelector('.watt-sheep')!.getAttribute('style')).toContain('translate(1090px');
});

it('stops its frame loop on unmount', () => {
  const { unmount } = render(<Watt now={day} />);
  expect(frames.size).toBe(1);
  unmount();
  expect(frames.size).toBe(0);
});

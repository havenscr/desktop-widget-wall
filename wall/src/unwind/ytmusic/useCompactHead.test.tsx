import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HEAD_OUT_MS, useCompactHead } from './useCompactHead';

function Head({ present }: { present: boolean }) {
  const head = useCompactHead<HTMLDivElement>(present);
  return present ? <div ref={head.ref} data-testid="head" data-compact={head.compact ? '' : undefined} data-fading={head.fading ? '' : undefined} /> : null;
}
const frame = (shown: boolean, present = true) => (
  <div className="main" data-work-shown={shown ? '' : undefined}>
    <Head present={present} />
  </div>
);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const flip = async (on: boolean) => {
  const main = document.querySelector('.main')!;
  await act(async () => {
    if (on) main.setAttribute('data-work-shown', '');
    else main.removeAttribute('data-work-shown');
    await Promise.resolve();
  });
};

it('fades out, switches while clear, then fades in, on the way in and on the way out', async () => {
  render(frame(false));
  const head = () => document.querySelector('[data-testid="head"]')!;
  expect(head().hasAttribute('data-compact')).toBe(false);
  await flip(true);
  expect(head().hasAttribute('data-fading')).toBe(true);
  expect(head().hasAttribute('data-compact')).toBe(false);
  await act(async () => void vi.advanceTimersByTime(HEAD_OUT_MS));
  expect(head().hasAttribute('data-compact')).toBe(true);
  expect(head().hasAttribute('data-fading')).toBe(false);
  await flip(false);
  expect(head().hasAttribute('data-fading')).toBe(true);
  expect(head().hasAttribute('data-compact')).toBe(true);
  await act(async () => void vi.advanceTimersByTime(HEAD_OUT_MS));
  expect(head().hasAttribute('data-compact')).toBe(false);
  expect(head().hasAttribute('data-fading')).toBe(false);
});

it('a head that mounts with the layer up is compact at once, with no fade', () => {
  render(frame(true));
  const head = document.querySelector('[data-testid="head"]')!;
  expect(head.hasAttribute('data-compact')).toBe(true);
  expect(head.hasAttribute('data-fading')).toBe(false);
});

it('a head drawn again after a mid-fade close starts clean, not stuck at opacity 0', async () => {
  const view = render(frame(false));
  await flip(true);
  expect(document.querySelector('[data-testid="head"]')!.hasAttribute('data-fading')).toBe(true);
  view.rerender(frame(true, false));
  view.rerender(frame(true, true));
  const head = document.querySelector('[data-testid="head"]')!;
  expect(head.hasAttribute('data-fading')).toBe(false);
  expect(head.hasAttribute('data-compact')).toBe(true);
  await act(async () => void vi.advanceTimersByTime(HEAD_OUT_MS * 2));
  expect(head.hasAttribute('data-fading')).toBe(false);
});

it('two flips inside the fade end on the last state', async () => {
  render(frame(false));
  const head = () => document.querySelector('[data-testid="head"]')!;
  await flip(true);
  await act(async () => void vi.advanceTimersByTime(50));
  await flip(false);
  await act(async () => void vi.advanceTimersByTime(HEAD_OUT_MS - 1));
  expect(head().hasAttribute('data-fading')).toBe(true);
  await act(async () => void vi.advanceTimersByTime(1));
  expect(head().hasAttribute('data-compact')).toBe(false);
  expect(head().hasAttribute('data-fading')).toBe(false);
  await flip(true);
  await act(async () => void vi.advanceTimersByTime(30));
  await flip(false);
  await act(async () => void vi.advanceTimersByTime(20));
  await flip(true);
  await act(async () => void vi.advanceTimersByTime(HEAD_OUT_MS));
  expect(head().hasAttribute('data-compact')).toBe(true);
  expect(head().hasAttribute('data-fading')).toBe(false);
});

it('unmounting mid-fade leaves no timer and sets no state afterwards', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const view = render(frame(false));
  await flip(true);
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => void vi.advanceTimersByTime(HEAD_OUT_MS * 2));
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

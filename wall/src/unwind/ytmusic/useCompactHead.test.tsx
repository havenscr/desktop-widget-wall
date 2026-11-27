import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HEAD_OUT_MS, useCompactHead } from './useCompactHead';

function Head() {
  const head = useCompactHead<HTMLDivElement>(true);
  return <div ref={head.ref} data-testid="head" data-compact={head.compact ? '' : undefined} data-fading={head.fading ? '' : undefined} />;
}
const frame = (shown: boolean) => (
  <div className="main" data-work-shown={shown ? '' : undefined}>
    <Head />
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

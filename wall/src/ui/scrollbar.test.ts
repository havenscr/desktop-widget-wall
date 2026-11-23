import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installScrollReveal, SCROLL_REVEAL_MS } from './scrollbar';

let off: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
  off = installScrollReveal();
});
afterEach(() => {
  off();
  vi.useRealTimers();
});

it('marks a list that scrolls and clears the mark 1 s after the last scroll', () => {
  const a = document.getElementById('a')!;
  a.dispatchEvent(new Event('scroll'));
  expect(a.hasAttribute('data-sb-live')).toBe(true);
  vi.advanceTimersByTime(SCROLL_REVEAL_MS - 100);
  a.dispatchEvent(new Event('scroll'));
  vi.advanceTimersByTime(SCROLL_REVEAL_MS - 100);
  expect(a.hasAttribute('data-sb-live')).toBe(true);
  vi.advanceTimersByTime(200);
  expect(a.hasAttribute('data-sb-live')).toBe(false);
});

it('marks only the list that scrolled', () => {
  document.getElementById('a')!.dispatchEvent(new Event('scroll'));
  expect(document.getElementById('b')!.hasAttribute('data-sb-live')).toBe(false);
});

it('stops and clears everything when removed', () => {
  const a = document.getElementById('a')!;
  a.dispatchEvent(new Event('scroll'));
  off();
  expect(a.hasAttribute('data-sb-live')).toBe(false);
  a.dispatchEvent(new Event('scroll'));
  expect(a.hasAttribute('data-sb-live')).toBe(false);
  off = installScrollReveal();
});

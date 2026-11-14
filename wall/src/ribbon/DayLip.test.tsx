import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DayLip, LIP_INTENT_MS } from './DayLip';

// Hover intent and the band that lets the pointer through. jsdom has no layout, so the lip's box
// and what lies under a point are given by hand. A 20 second limit: these step timers.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
});
const step = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

/** A lip whose box is x 0 to 1000, y 0 to 26; `under` is what lies beneath a point (a class name per element). */
function lipWith(under: (x: number, y: number) => string[] = () => [], open = false) {
  const r = render(<DayLip open={open} x={100} onToggle={() => {}} />);
  const lip = r.container.querySelector('.day-lip') as HTMLElement;
  lip.getBoundingClientRect = () => ({ left: 0, right: 1000, top: 0, bottom: 26, width: 1000, height: 26, x: 0, y: 0, toJSON: () => ({}) });
  (document as unknown as { elementsFromPoint: (x: number, y: number) => Element[] }).elementsFromPoint = (x, y) => [
    lip,
    ...under(x, y).map((c) => {
      const e = document.createElement('div');
      e.className = c;
      document.body.append(e);
      return e;
    }),
  ];
  const move = (x: number, y: number) => act(() => void window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y })));
  return { r, lip, move };
}

it('the lip lights only after the pointer has rested in the band for the intent time, and goes out at once on leaving it', () => {
  const { lip, move } = lipWith();
  expect(lip.className).not.toContain('intent');
  move(500, 10);
  step(LIP_INTENT_MS - 20);
  move(510, 10);
  expect(lip.className).not.toContain('intent');
  step(40);
  expect(lip.className).toContain('intent');
  move(510, 300);
  expect(lip.className).not.toContain('intent');
}, 20_000);

it('crossing the edge without resting never lights it', () => {
  const { lip, move } = lipWith();
  move(500, 10);
  step(LIP_INTENT_MS / 2);
  move(500, 200);
  step(2000);
  expect(lip.className).not.toContain('intent');
}, 20_000);

it('over a thing that acts on a click (the buddy, a card, a chip) the band lets the pointer through and does not light', () => {
  const { lip, move } = lipWith((x) => (x > 400 && x < 480 ? ['watt-hit'] : x > 700 && x < 760 ? ['lane'] : []));
  expect(lip.hasAttribute('data-pass')).toBe(false);
  move(440, 10);
  expect(lip.hasAttribute('data-pass')).toBe(true);
  step(2000);
  expect(lip.className).not.toContain('intent');
  // Off it, the band is the lip again and lights after the rest.
  move(600, 10);
  expect(lip.hasAttribute('data-pass')).toBe(false);
  step(LIP_INTENT_MS + 20);
  expect(lip.className).toContain('intent');
  // Onto a thing again: it goes out and lets the pointer through.
  move(430, 10);
  expect(lip.hasAttribute('data-pass')).toBe(true);
  expect(lip.className).not.toContain('intent');
  // Leaving the band clears it.
  move(430, 400);
  expect(lip.hasAttribute('data-pass')).toBe(false);
}, 20_000);

it('the open lip carries its words with no wait, is never passed through, and is one focusable button named for what it does', () => {
  const { lip, move } = lipWith(() => ['watt-hit'], true);
  expect(lip.className).toContain('open');
  expect(lip.getAttribute('aria-label')).toBe('Close the day');
  expect(lip.querySelector('.lip-t')!.textContent).toBe('Close the day');
  expect(lip.tagName).toBe('BUTTON');
  move(440, 10);
  expect(lip.hasAttribute('data-pass')).toBe(false);
}, 20_000);

it('a click on the lip toggles it', () => {
  const onToggle = vi.fn();
  const r = render(<DayLip open={false} x={100} onToggle={onToggle} />);
  fireEvent.click(r.container.querySelector('.day-lip') as HTMLElement);
  expect(onToggle).toHaveBeenCalledTimes(1);
}, 20_000);

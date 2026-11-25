import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RibbonLine } from './RibbonLine';
import { useFixedClock, usePacificTime } from './testZone';
import type { DayFeed } from './useDayEvents';

usePacificTime();
const t = (hm: string) => Date.parse(`2026-11-11T${hm}:00-08:00`);
useFixedClock(t('10:24'));
const iso = (hm: string) => new Date(t(hm)).toISOString().replace('.000Z', 'Z');
const ev = (key: string, a: string, b: string) => ({ key, accountId: 'w', title: key, start: iso(a), end: iso(b), canJoin: false, isLive: false });
const feed = (events: DayFeed['events']): DayFeed => ({ events, at: 1, failedAt: null, calendar: 'ok', labels: {} });

afterEach(() => vi.useRealTimers());

const draw = async (events: DayFeed['events']) => {
  const r = render(<RibbonLine feed={feed(events)} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return r;
};

it('is a hidden-from-readers line with a dot at the time', async () => {
  const r = await draw([]);
  const root = r.container.firstElementChild!;
  expect(root.className).toBe('rib-line');
  expect(root.getAttribute('aria-hidden')).toBe('true');
  expect(root.querySelector('.rl-now')).not.toBeNull();
});
it('an empty day draws no bars', async () => {
  const r = await draw([]);
  expect(r.container.querySelectorAll('.rl-ev')).toHaveLength(0);
});
it('draws a bar per meeting, marking past, now and next', async () => {
  const r = await draw([ev('a', '09:00', '09:45'), ev('b', '10:00', '11:00'), ev('c', '14:00', '15:00')]);
  const bars = [...r.container.querySelectorAll<HTMLElement>('.rl-ev')];
  expect(bars.map((b) => b.getAttribute('data-state'))).toEqual(['past', 'now', 'next']);
});
it('a very short meeting still gets a bar at least 4 px wide', async () => {
  const r = await draw([ev('s', '11:00', '11:01')]);
  const bar = r.container.querySelector<HTMLElement>('.rl-ev')!;
  expect(parseFloat(bar.style.width)).toBeGreaterThanOrEqual(4);
});

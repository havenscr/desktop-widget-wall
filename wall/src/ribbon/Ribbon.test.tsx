import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { RX } from './model';
import { Ribbon } from './Ribbon';
import { useFixedClock, usePacificTime } from './testZone';

usePacificTime();

const t = (hm: string) => Date.parse(`2026-11-11T${hm}:00-08:00`);
useFixedClock(t('10:24'));
const iso = (hm: string) => new Date(t(hm)).toISOString().replace('.000Z', 'Z');

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

afterEach(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  vi.useRealTimers();
  mocks.clear();
  useFocusStore.setState({ sessions: [] });
});

const day = {
  accounts: [{ id: 'work', label: 'Work', state: 'ok' }],
  events: [
    { key: 'd-0', accountId: 'work', title: 'AE sync', start: iso('09:00'), end: iso('09:45'), canJoin: true, isLive: false },
    { key: 'd-1', accountId: 'work', title: 'Design review', start: iso('10:00'), end: iso('11:00'), canJoin: true, isLive: false },
    { key: 'd-2', accountId: 'work', title: 'Livestream: Fabric Apps', start: iso('18:30'), end: iso('20:30'), canJoin: false, isLive: true },
  ],
};

it('draws today\'s calendar with past, now and live chips, and the needle with the time', async () => {
  mocks.set('wall2_meet_day', () => day);
  const r = render(<Ribbon kind="work" />);
  await flush();
  const chips = [...r.container.querySelectorAll('.ev')];
  expect(chips.map((c) => [c.textContent, c.className])).toEqual([
    ['AE sync', 'ev past'],
    ['Design review', 'ev now'],
    ['Livestream: Fabric Apps', 'ev next live'],
  ]);
  expect((chips[0] as HTMLElement).style.left).toBe(`${RX(9)}px`);
  const ndl = r.container.querySelector('.ndl') as HTMLElement;
  expect(ndl.textContent).toBe('10:24');
  expect(ndl.style.left).toBe(`${RX(10.4)}px`);
  expect(r.container.querySelectorAll('.tk')).toHaveLength(19);
  expect([...r.container.querySelectorAll('.hl.sun')].map((e) => e.textContent)).toEqual(['sunrise 7:09', 'sunset 4:37']);
});

it('moves the needle on the minute', async () => {
  mocks.set('wall2_meet_day', () => day);
  const r = render(<Ribbon kind="work" />);
  await flush(61_000);
  expect(r.container.querySelector('.ndl')!.textContent).toBe('10:25');
});

it('leaves row 1 empty with no error text when Meet is not set up', async () => {
  mocks.set('wall2_meet_day', () => {
    throw new Error('not-configured');
  });
  const r = render(<Ribbon kind="work" />);
  await flush();
  expect(r.container.querySelectorAll('.ev')).toHaveLength(0);
  expect(r.container.textContent).not.toMatch(/set up|error|unavailable/i);
});

it('keeps the last good calendar when a later read fails', async () => {
  let fail = false;
  mocks.set('wall2_meet_day', () => {
    if (fail) throw new Error('failed');
    return day;
  });
  const r = render(<Ribbon kind="work" />);
  await flush();
  fail = true;
  await flush(5 * 60_000);
  expect(r.container.querySelectorAll('.ev')).toHaveLength(3);
});

it('draws the focus bar from today\'s sessions up to now', async () => {
  mocks.set('wall2_meet_day', () => ({ accounts: [], events: [] }));
  useFocusStore.setState({ sessions: [{ start: t('10:00'), end: t('10:45') }] });
  const r = render(<Ribbon kind="work" />);
  await flush();
  const fo = r.container.querySelector('.fo') as HTMLElement;
  expect(fo.style.left).toBe(`${RX(10)}px`);
  expect(parseFloat(fo.style.width)).toBeCloseTo(RX(10.4) - RX(10));
});

it('uses the home icon for row 2 on Home, with no focus bar', async () => {
  mocks.set('wall2_meet_day', () => ({ accounts: [], events: [] }));
  useFocusStore.setState({ sessions: [{ start: t('10:00'), end: t('10:45') }] });
  const r = render(<Ribbon kind="home" />);
  await flush();
  expect(r.container.querySelector('.rib')!.getAttribute('data-kind')).toBe('home');
  expect(r.container.querySelector('.tabler-icon-home')).not.toBeNull();
  expect(r.container.querySelector('.tabler-icon-bolt')).toBeNull();
  expect(r.container.querySelector('.fo')).toBeNull();
});

it('draws overlapping events in two lanes and a narrow chip without its title', async () => {
  mocks.set('wall2_meet_day', () => ({
    accounts: [],
    events: [
      { key: 'a', accountId: 'work', title: 'Workshop', start: iso('11:00'), end: iso('13:00'), canJoin: false, isLive: false },
      { key: 'b', accountId: 'work', title: 'Standup', start: iso('12:00'), end: iso('12:15'), canJoin: false, isLive: false },
    ],
  }));
  const r = render(<Ribbon kind="work" />);
  await flush();
  const [a, b] = [...r.container.querySelectorAll('.ev')] as HTMLElement[];
  expect(a.className).toBe('ev next');
  expect(a.textContent).toBe('Workshop');
  expect(b.className).toBe('ev next l2');
  expect(b.textContent).toBe('');
  expect(b.getAttribute('title')).toBe('Standup');
  expect(b.getAttribute('aria-label')).toBe('Standup');
});

it('stops reading the calendar and moving the needle while hidden, and catches up on return', async () => {
  let reads = 0;
  mocks.set('wall2_meet_day', () => {
    reads++;
    return day;
  });
  const r = render(<Ribbon kind="work" />);
  await flush();
  expect(reads).toBe(1);
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await flush(11 * 60_000);
  expect(reads).toBe(1);
  expect(r.container.querySelector('.ndl')!.textContent).toBe('10:24');
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await flush();
  expect(reads).toBe(2);
  expect(r.container.querySelector('.ndl')!.textContent).toBe('10:35');
  await flush(61_000);
  expect(r.container.querySelector('.ndl')!.textContent).toBe('10:36');
});

it('clears its timers and stops reading on unmount', async () => {
  let reads = 0;
  mocks.set('wall2_meet_day', () => {
    reads++;
    return day;
  });
  const r = render(<Ribbon kind="work" />);
  await flush();
  r.unmount();
  expect(vi.getTimerCount()).toBe(0);
  await flush(30 * 60_000);
  expect(reads).toBe(1);
});

it('names each row on its icon and says when a row is empty', async () => {
  mocks.set('wall2_meet_day', () => ({ accounts: [], events: [] }));
  mocks.set('wall2_tasks_summary', () => ({ next: [], remaining: 0, dueTomorrow: { count: 0, estMinutes: 0 } }));
  mocks.set('wall2_omni_summary', () => {
    throw new Error('not-configured');
  });
  const work = render(<Ribbon kind="work" />);
  await flush();
  const icons = [...work.container.querySelectorAll('.li')].map((i) => i.getAttribute('title'));
  expect(icons).toEqual(["Today's calendar", 'Agent activity and tasks due today']);
  expect([...work.container.querySelectorAll('.li-empty')].map((l) => l.textContent)).toEqual(['No meetings today', 'No agent activity yet']);
  work.unmount();
  const home = render(<Ribbon kind="home" />);
  await flush();
  expect(home.container.querySelectorAll('.li')[1].getAttribute('title')).toBe('Home tasks due today');
  expect([...home.container.querySelectorAll('.li-empty')].map((l) => l.textContent)).toEqual(['No meetings today', 'Nothing scheduled at home']);
});

it('drops the empty label once the row has something on it', async () => {
  mocks.set('wall2_meet_day', () => day);
  const r = render(<Ribbon kind="home" />);
  await flush();
  expect([...r.container.querySelectorAll('.li-empty')].map((l) => l.textContent)).toEqual(['Nothing scheduled at home']);
});

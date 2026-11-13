import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import type { TaskItem } from '../tasks/model';
import { RX } from './model';
import { Ribbon } from './Ribbon';
import { useFixedClock, usePacificTime } from './testZone';

usePacificTime();

const t = (hm: string, day = '11') => Date.parse(`2026-11-${day}T${hm}:00-08:00`);
useFixedClock(t('10:24'));
const task = (id: string, title: string, due: string | null, allDay = false): TaskItem => ({
  id,
  title,
  due_at: due,
  due_is_all_day: allDay,
  quadrant: null,
  est: null,
});

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

let calls: unknown[] = [];
beforeEach(() => {
  calls = [];
  mocks.set('wall2_meet_day', () => ({ accounts: [], events: [] }));
});
afterEach(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  vi.useRealTimers();
  mocks.clear();
});

const summary = (next: TaskItem[]) => (args?: unknown) => {
  calls.push(args);
  return { next, remaining: 0, dueTomorrow: { count: 0, estMinutes: 0 } };
};

it('marks only the next three tasks due at a time today, at their hour', async () => {
  mocks.set(
    'wall2_tasks_summary',
    summary([
      task('a', 'Send the project proposal', new Date(t('15:00')).toISOString()),
      task('b', 'Review the dashboard draft', new Date(t('12:00')).toISOString(), true),
      task('c', 'No date', null),
      task('d', 'Fourth, never read', new Date(t('16:00')).toISOString()),
    ]),
  );
  const r = render(<Ribbon kind="work" />);
  await flush();
  const marks = [...r.container.querySelectorAll('.due')] as HTMLElement[];
  expect(marks).toHaveLength(1);
  expect(marks[0].style.left).toBe(`${RX(15)}px`);
  expect(marks[0].textContent).toBe('Send the project proposal, 3:00');
  expect(marks[0].getAttribute('aria-label')).toBe('Due 3:00: Send the project proposal. Opens the task');
  expect(calls).toEqual([{ notTag: 'home' }]);
  // A click opens the task in the task app (Rust checks the id).
  const opened: string[] = [];
  mocks.set('wall2_open_task', (args) => {
    opened.push(String(args?.id));
  });
  fireEvent.click(marks[0]);
  fireEvent.keyDown(marks[0], { key: 'Enter' });
  await flush();
  expect(opened).toEqual(['a', 'a']);
});

it('an all-day task gets no mark', async () => {
  // Due at noon today, local time: only the all-day flag keeps it off the ribbon.
  mocks.set('wall2_tasks_summary', summary([task('b', 'Review the dashboard draft', new Date(t('12:00')).toISOString(), true)]));
  const r = render(<Ribbon kind="work" />);
  await flush();
  expect(r.container.querySelectorAll('.due')).toHaveLength(0);
});

it('leaves out a task due at a time on another day', async () => {
  mocks.set('wall2_tasks_summary', summary([task('a', 'Tomorrow', new Date(t('09:00', '12')).toISOString())]));
  const r = render(<Ribbon kind="work" />);
  await flush();
  expect(r.container.querySelectorAll('.due')).toHaveLength(0);
});

it('reads the home tag on Home', async () => {
  mocks.set('wall2_tasks_summary', summary([task('a', 'Bins out', new Date(t('19:00')).toISOString())]));
  const r = render(<Ribbon kind="home" />);
  await flush();
  expect(calls).toEqual([{ tag: 'home' }]);
  expect(r.container.querySelector('.due')!.textContent).toBe('Bins out, 7:00');
});

it('shows nothing when the task feed is not set up', async () => {
  mocks.set('wall2_tasks_summary', () => {
    throw new Error('not-configured');
  });
  const r = render(<Ribbon kind="work" />);
  await flush();
  expect(r.container.querySelectorAll('.due')).toHaveLength(0);
  expect(r.container.textContent).not.toMatch(/set up|error|unavailable/i);
});

it('clears the marks when a later read fails', async () => {
  let fail = false;
  mocks.set('wall2_tasks_summary', (args) => {
    if (fail) throw new Error('failed');
    return summary([task('a', 'Send', new Date(t('15:00')).toISOString())])(args);
  });
  const r = render(<Ribbon kind="work" />);
  await flush();
  expect(r.container.querySelectorAll('.due')).toHaveLength(1);
  fail = true;
  await flush(120_000);
  expect(r.container.querySelectorAll('.due')).toHaveLength(0);
});

it('does not read while the page is hidden, and reads again on return', async () => {
  mocks.set('wall2_tasks_summary', summary([]));
  render(<Ribbon kind="work" />);
  await flush();
  expect(calls).toHaveLength(1);
  setHidden(true);
  await flush(10 * 60_000);
  expect(calls).toHaveLength(1);
  setHidden(false);
  await flush();
  expect(calls).toHaveLength(2);
});

it('stops reading after unmount', async () => {
  mocks.set('wall2_tasks_summary', summary([]));
  const r = render(<Ribbon kind="work" />);
  await flush();
  r.unmount();
  await flush(10 * 60_000);
  expect(calls).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

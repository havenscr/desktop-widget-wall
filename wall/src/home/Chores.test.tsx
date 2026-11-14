import { act, fireEvent, render, screen } from '@testing-library/react';
import { TICK_UNDO_MS } from '../tasks/pendingTick';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { usePacificTime } from '../ribbon/testZone';
import { Chores, chorePill } from './Chores';

usePacificTime();

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-11T16:36:00-08:00'));
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
});

const task = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id,
  title,
  due_at: null,
  due_is_all_day: false,
  quadrant: null,
  est: '15',
  ...over,
});

it('asks for the home tag with room for twenty and shows "N more can wait" under the rows', async () => {
  const args: unknown[] = [];
  mocks.set('wall2_tasks_summary', (a) => {
    args.push(a);
    return {
      next: [task('1', 'Bins out tonight', { due_at: '2026-11-12T03:00:00Z' }), task('2', 'Order the furnace filter'), task('3', 'Call the sweep', { est: null })],
      remaining: 5,
    };
  });
  const { container } = render(<Chores />);
  await flush();
  expect(args).toEqual([{ tag: 'home', limit: 20 }]);
  expect([...container.querySelectorAll('.tk3 .n')].map((n) => n.textContent)).toEqual(['Bins out tonight', 'Order the furnace filter', 'Call the sweep']);
  expect([...container.querySelectorAll('.est')].map((n) => n.textContent)).toEqual(['7 PM', '15 m']);
  expect(screen.getByText('5 more can wait')).toBeTruthy();
});

it('a click on a chore\'s title opens it in the task app; the tick circle does not', async () => {
  const opened: unknown[] = [];
  const done: unknown[] = [];
  mocks.set('wall2_tasks_summary', () => ({ next: [task('c-1', 'Water the plants')], remaining: 0 }));
  mocks.set('wall2_open_task', (a) => void opened.push(a));
  mocks.set('wall2_task_done', (a) => void done.push(a));
  render(<Chores />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Open Water the plants' }));
  await flush();
  expect(opened).toEqual([{ id: 'c-1' }]);
  expect(done).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Done: Water the plants' }));
  // Past the undo window: the tick is now really completed.
  await flush(TICK_UNDO_MS);
  await flush();
  expect(opened).toHaveLength(1);
  expect(done).toEqual([{ id: 'c-1' }]);
});

it('ticks a chore: struck at once, saved, gone after two seconds, list read again', async () => {
  let list = [task('1', 'Water the plants'), task('2', 'Sort the recycling')];
  const done = vi.fn((a?: Record<string, unknown>) => {
    list = list.filter((t) => t.id !== a?.id);
  });
  mocks.set('wall2_tasks_summary', () => ({ next: list, remaining: 0 }));
  mocks.set('wall2_task_done', done);
  const { container } = render(<Chores />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Done: Water the plants' }));
  // Past the undo window: the tick is now really completed.
  await flush(TICK_UNDO_MS);
  await flush();
  expect(done).toHaveBeenCalledWith({ id: '1' });
  expect(container.querySelector('.tk3.done')).toBeTruthy();
  await flush(2000);
  expect(screen.queryByText('Water the plants')).toBeNull();
  expect(screen.getByText('Sort the recycling')).toBeTruthy();
});

it('a failed save brings the row back marked not saved', async () => {
  mocks.set('wall2_tasks_summary', () => ({ next: [task('1', 'Water the plants')], remaining: 0 }));
  mocks.set('wall2_task_done', () => Promise.reject(new Error('nope')));
  const { container } = render(<Chores />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Done: Water the plants' }));
  // Past the undo window: the tick is now really completed.
  await flush(TICK_UNDO_MS);
  await flush(2500);
  expect(screen.getByText('Water the plants')).toBeTruthy();
  expect(container.querySelector('.tk3.failed')).toBeTruthy();
  expect(screen.getByText('Could not complete.')).toBeTruthy();
});

it('says Not set up, task app not reachable, or nothing waiting', async () => {
  mocks.set('wall2_tasks_summary', () => Promise.reject(new Error('not-configured')));
  const a = render(<Chores />);
  await flush();
  expect(screen.getByText('Not set up')).toBeTruthy();
  a.unmount();
  mocks.set('wall2_tasks_summary', () => Promise.reject(new Error('Could not reach the service')));
  const b = render(<Chores />);
  await flush();
  expect(screen.getByText('Task app not reachable')).toBeTruthy();
  b.unmount();
  mocks.set('wall2_tasks_summary', () => ({ next: [], remaining: 0 }));
  render(<Chores />);
  await flush();
  expect(screen.getByText('Nothing waiting around the house')).toBeTruthy();
});

it('keeps the last good list when a later read fails', async () => {
  let fail = false;
  mocks.set('wall2_tasks_summary', () => (fail ? Promise.reject(new Error('x')) : { next: [task('1', 'Water the plants')], remaining: 0 }));
  render(<Chores />);
  await flush();
  fail = true;
  await flush(120_000);
  expect(screen.getByText('Water the plants')).toBeTruthy();
});

it('pill: the time for a timed task due later today, else the estimate', () => {
  const now = Date.parse('2026-11-11T16:36:00-08:00');
  expect(chorePill({ due_at: '2026-11-11T19:30:00-08:00', due_is_all_day: false, est: '15' }, now)).toBe('7:30 PM');
  expect(chorePill({ due_at: '2026-11-11T09:00:00-08:00', due_is_all_day: false, est: '30' }, now)).toBe('30 m');
  expect(chorePill({ due_at: '2026-11-12T19:00:00-08:00', due_is_all_day: false, est: '60plus' }, now)).toBe('1 h+');
  expect(chorePill({ due_at: '2026-11-11', due_is_all_day: true, est: null }, now)).toBeNull();
});

it('a failed refresh after a good read keeps the rows, dimmed, with a quiet sign by the heading', async () => {
  let fail = false;
  mocks.set('wall2_tasks_summary', () => (fail ? Promise.reject(new Error('x')) : { next: [task('1', 'Water the plants')], remaining: 4 }));
  const { container } = render(<Chores />);
  await flush();
  expect(container.querySelector('.chore-rows.stale')).toBeNull();
  expect(screen.queryByText('Task app not reachable')).toBeNull();
  fail = true;
  await flush(120_000);
  expect(screen.getByText('Water the plants')).toBeTruthy();
  expect(container.querySelector('.chores-side .warn-text')?.textContent).toBe('Task app not reachable');
  expect(container.querySelector('.chore-rows.stale')).toBeTruthy();
  expect(screen.getByText('4 more can wait').classList.contains('stale')).toBe(true);
  fail = false;
  await flush(120_000);
  expect(container.querySelector('.chore-rows.stale')).toBeNull();
  expect(screen.queryByText('Task app not reachable')).toBeNull();
});

it('a read that began before the save cannot bring a ticked row back, even when the trailing read fails', async () => {
  const reads: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
  mocks.set('wall2_tasks_summary', () => new Promise((resolve, reject) => reads.push({ resolve, reject })));
  let saveDone: () => void = () => undefined;
  mocks.set('wall2_task_done', () => new Promise<void>((r) => (saveDone = r)));
  const { container } = render(<Chores />);
  reads[0].resolve({ next: [task('1', 'Water the plants'), task('2', 'Sort the recycling')], remaining: 0 });
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Done: Water the plants' }));
  // Past the undo window: the tick is now really completed.
  await flush(TICK_UNDO_MS);
  await flush();
  // An interval read starts before the save settles and still lists the row.
  await flush(120_000);
  expect(reads).toHaveLength(2);
  saveDone();
  await flush(2000);
  expect(screen.queryByText('Water the plants')).toBeNull();
  // The old read lands after the save and the fade: the row stays gone.
  reads[1].resolve({ next: [task('1', 'Water the plants'), task('2', 'Sort the recycling')], remaining: 0 });
  await flush();
  expect(screen.queryByText('Water the plants')).toBeNull();
  // The trailing read (started after the save) fails: still gone, never struck and back.
  expect(reads).toHaveLength(3);
  reads[2].reject(new Error('x'));
  await flush();
  expect(screen.queryByText('Water the plants')).toBeNull();
  expect(container.querySelector('.tk3.done')).toBeNull();
  expect(screen.getByText('Sort the recycling')).toBeTruthy();
});

it('when every shown chore is ticked it says Loading the next ones, never Nothing waiting', async () => {
  const reads: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
  mocks.set('wall2_tasks_summary', () => new Promise((resolve, reject) => reads.push({ resolve, reject })));
  mocks.set('wall2_task_done', () => undefined);
  render(<Chores />);
  reads[0].resolve({ next: [task('1', 'Water the plants')], remaining: 5 });
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Done: Water the plants' }));
  // Past the undo window: the tick is now really completed.
  await flush(TICK_UNDO_MS);
  await flush(2000);
  expect(screen.getByText('Loading the next ones')).toBeTruthy();
  expect(screen.queryByText('Nothing waiting around the house')).toBeNull();
  reads[1].reject(new Error('x'));
  await flush();
  expect(screen.getByText('Could not load the next ones')).toBeTruthy();
  expect(screen.queryByText('Nothing waiting around the house')).toBeNull();
});

it('a chore tick waits five seconds with Undo; Undo completes nothing', async () => {
  mocks.set('wall2_tasks_summary', () => ({ next: [task('w', 'Water the plants')], remaining: 0 }));
  const done = vi.fn();
  mocks.set('wall2_task_done', done);
  render(<Chores />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Done: Water the plants' }));
  expect(screen.getByRole('button', { name: 'Undo: Water the plants' })).toBeTruthy();
  await flush(2000);
  fireEvent.click(screen.getByRole('button', { name: 'Undo: Water the plants' }));
  await flush(TICK_UNDO_MS);
  expect(done).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Open Water the plants' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Done: Water the plants' }));
  await flush(TICK_UNDO_MS);
  expect(done).toHaveBeenCalledWith({ id: 'w' });
});

it('shows five rows in view with the rest a scroll away, and three while network alerts are open', async () => {
  const many = Array.from({ length: 13 }, (_, i) => task(`h${i}`, `Chore ${i}`));
  mocks.set('wall2_tasks_summary', () => ({ next: many, remaining: 2 }));
  mocks.set('wall2_home_security', () => ({ reachable: true, stale: false, lastScan: null, alerts: 0, firewalla: { api: 'up', boxOnline: true, checkedAt: null, alarms24h: 0 }, portalUrl: null }));
  mocks.set('wall2_desk_security', () => Promise.reject(new Error('absent')));
  const quiet = render(<Chores />);
  await flush();
  const list = quiet.container.querySelector('.chore-rows') as HTMLElement;
  expect(list.className).toContain('fit5');
  expect(list.className).toContain('scrolls');
  // All thirteen are in the list (it scrolls); the foot counts the eight below and the two past the read.
  expect(list.querySelectorAll('.tk3')).toHaveLength(13);
  expect(screen.getByText('10 more can wait')).toBeTruthy();
  quiet.unmount();
  mocks.set('wall2_home_security', () => ({ reachable: true, stale: false, lastScan: null, alerts: 2, firewalla: { api: 'up', boxOnline: true, checkedAt: null, alarms24h: 0 }, portalUrl: null }));
  const busy = render(<Chores />);
  await flush();
  expect((busy.container.querySelector('.chore-rows') as HTMLElement).className).toContain('fit3');
  expect(screen.getByText('12 more can wait')).toBeTruthy();
});

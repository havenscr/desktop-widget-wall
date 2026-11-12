import { act, fireEvent, render, screen } from '@testing-library/react';
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

it('asks for the home tag and shows three rows with "N more can wait"', async () => {
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
  expect(args).toEqual([{ tag: 'home' }]);
  expect([...container.querySelectorAll('.tk3 .n')].map((n) => n.textContent)).toEqual(['Bins out tonight', 'Order the furnace filter', 'Call the sweep']);
  expect([...container.querySelectorAll('.est')].map((n) => n.textContent)).toEqual(['7 PM', '15 m']);
  expect(screen.getByText('5 more can wait')).toBeTruthy();
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
  await flush(2500);
  expect(screen.getByText('Water the plants')).toBeTruthy();
  expect(container.querySelector('.tk3.failed')).toBeTruthy();
  expect(screen.getByText('not saved')).toBeTruthy();
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
  await flush(2000);
  expect(screen.getByText('Loading the next ones')).toBeTruthy();
  expect(screen.queryByText('Nothing waiting around the house')).toBeNull();
  reads[1].reject(new Error('x'));
  await flush();
  expect(screen.getByText('Could not load the next ones')).toBeTruthy();
  expect(screen.queryByText('Nothing waiting around the house')).toBeNull();
});

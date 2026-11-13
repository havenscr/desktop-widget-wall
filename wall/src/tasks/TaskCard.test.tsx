import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { useFocusStore } from '../focus/store';
import { TaskCard } from './TaskCard';
import type { TaskItem } from './model';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const task = (id: string, title: string, est: TaskItem['est'] = null): TaskItem => ({ id, title, due_at: null, due_is_all_day: false, quadrant: null, est });

let summaryArgs: unknown[] = [];
/** Work reads `wall2_tasks_summary`; `remaining` is the count after the three shown. */
const setList = (fn: () => TaskItem[] | Promise<TaskItem[]>, remaining = 0) =>
  mocks.set('wall2_tasks_summary', async (args) => {
    summaryArgs.push(args);
    const next = await fn();
    return { next: next.slice(0, 3), remaining, dueTomorrow: { count: 0, estMinutes: 0 } };
  });

beforeEach(() => {
  summaryArgs = [];
  useFocusStore.getState().dispose();
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 11, 10, 0, 0));
  mocks.set('get_do_not_disturb', () => false);
  mocks.set('enable_do_not_disturb', () => undefined);
  mocks.set('disable_do_not_disturb', () => undefined);
});
afterEach(() => {
  useFocusStore.getState().dispose();
  vi.useRealTimers();
  mocks.clear();
});

it('shows Not set up when feeds.json has no address', async () => {
  setList(() => Promise.reject(new Error('not-configured')));
  render(<TaskCard />);
  await flush();
  expect(screen.getByText('Not set up')).toBeTruthy();
});

it('shows Nothing due for an empty list', async () => {
  setList(() => []);
  render(<TaskCard />);
  await flush();
  expect(screen.getByText('Nothing due')).toBeTruthy();
});

it('marks a row done at once, fades it after 2 seconds, then refreshes', async () => {
  let list = [task('a', 'First'), task('b', 'Second')];
  const done = vi.fn((args?: Record<string, unknown>) => {
    list = list.filter((t) => t.id !== args?.id);
  });
  setList(() => list);
  mocks.set('wall2_task_done', done);
  render(<TaskCard />);
  await flush();
  fireEvent.click(screen.getByLabelText('Mark done: First'));
  expect(screen.getByText('First').closest('li')?.className).toContain('done');
  await flush(1000);
  expect(screen.queryByText('First')).toBeTruthy();
  await flush(1100);
  expect(done).toHaveBeenCalledWith({ id: 'a' });
  expect(screen.queryByText('First')).toBeNull();
  expect(screen.getByText('Second')).toBeTruthy();
});

it('brings the row back with "Could not save" when the save fails', async () => {
  setList(() => [task('a', 'First')]);
  mocks.set('wall2_task_done', () => Promise.reject(new Error('The service answered 500')));
  render(<TaskCard />);
  await flush();
  fireEvent.click(screen.getByLabelText('Mark done: First'));
  await flush(3000);
  expect(screen.getByText('First')).toBeTruthy();
  expect(screen.getByText('Could not save')).toBeTruthy();
  expect(screen.getByText('First').closest('li')?.className).not.toContain('done');
});

it('brings the row back when the save fails after the fade', async () => {
  setList(() => [task('a', 'First')]);
  mocks.set('wall2_task_done', () => new Promise((_, reject) => setTimeout(() => reject(new Error('x')), 4000)));
  render(<TaskCard />);
  await flush();
  fireEvent.click(screen.getByLabelText('Mark done: First'));
  await flush(2500);
  expect(screen.queryByText('First')).toBeNull();
  await flush(2000);
  expect(screen.getByText('First')).toBeTruthy();
  expect(screen.getByText('Could not save')).toBeTruthy();
});

it('keeps the last good list and shows its age when a refresh fails', async () => {
  let fail = false;
  setList(() => (fail ? Promise.reject(new Error('Could not reach the service')) : [task('a', 'First')]));
  render(<TaskCard />);
  await flush();
  fail = true;
  await flush(120_000 * 3);
  expect(screen.getByText('First')).toBeTruthy();
  expect(screen.getByText(/updated \d+ min ago/)).toBeTruthy();
});

it('holding a row for half a second starts focus named after the task', async () => {
  setList(() => [task('a', 'Write the report')]);
  render(<TaskCard />);
  await flush();
  const row = screen.getByLabelText('Open Write the report; hold to focus on it');
  fireEvent.pointerDown(row);
  await flush(400);
  expect(useFocusStore.getState().state.status).toBe('idle');
  await flush(100);
  const s = useFocusStore.getState().state;
  expect(s.status).toBe('running');
  expect(s.status === 'running' && s.label).toBe('Write the report');
  // While a session runs a press only opens the task.
  expect(row.getAttribute('aria-label')).toBe('Open Write the report');
});

it('a click on the title opens the task in the task app; a hold or a slide opens nothing', async () => {
  const opened: unknown[] = [];
  mocks.set('wall2_open_task', (args) => void opened.push(args));
  setList(() => [task('t-1', 'Write the report')]);
  render(<TaskCard />);
  await flush();
  const row = screen.getByLabelText('Open Write the report; hold to focus on it');
  fireEvent.pointerDown(row);
  await flush(120);
  fireEvent.pointerUp(row);
  fireEvent.click(row);
  await flush();
  expect(opened).toEqual([{ id: 't-1' }]);
  // A slide that cancels the hold: its click opens nothing.
  fireEvent.pointerDown(row, { clientX: 100, clientY: 30 });
  fireEvent.pointerMove(row, { clientX: 130, clientY: 30 });
  fireEvent.pointerUp(row);
  fireEvent.click(row);
  await flush();
  expect(opened).toHaveLength(1);
  // A hold starts focus, and the click that ends it opens nothing.
  fireEvent.pointerDown(row);
  await flush(500);
  fireEvent.pointerUp(row);
  fireEvent.click(row);
  await flush();
  expect(useFocusStore.getState().state.status).toBe('running');
  expect(opened).toHaveLength(1);
  // The tick circle never opens the task.
  mocks.set('wall2_task_done', () => undefined);
  fireEvent.click(screen.getByLabelText('Mark done: Write the report'));
  await flush();
  expect(opened).toHaveLength(1);
});

it('a hold released off the row does not swallow the next click', async () => {
  const opened: unknown[] = [];
  mocks.set('wall2_open_task', (args) => void opened.push(args));
  setList(() => [task('t-1', 'Write the report')]);
  render(<TaskCard />);
  await flush();
  const row = screen.getByLabelText('Open Write the report; hold to focus on it');
  fireEvent.pointerDown(row);
  await flush(500);
  expect(useFocusStore.getState().state.status).toBe('running');
  // Released somewhere else: no click reaches the row.
  fireEvent.pointerLeave(row);
  fireEvent.pointerUp(document.body);
  await flush();
  // The next click (a keyboard Space, which has no pointer down) opens the task.
  fireEvent.click(row);
  await flush();
  expect(opened).toEqual([{ id: 't-1' }]);
});

it('a short tap or a press that slides off starts nothing', async () => {
  setList(() => [task('a', 'Write the report')]);
  render(<TaskCard />);
  await flush();
  const row = screen.getByLabelText('Open Write the report; hold to focus on it');
  fireEvent.pointerDown(row);
  await flush(200);
  fireEvent.pointerUp(row);
  fireEvent.pointerDown(row);
  await flush(300);
  fireEvent.pointerLeave(row);
  await flush(1000);
  expect(useFocusStore.getState().state.status).toBe('idle');
});

it('a finger that slides more than 12 px cancels the hold, a small wobble does not', async () => {
  setList(() => [task('a', 'Write the report')]);
  render(<TaskCard />);
  await flush();
  const row = screen.getByLabelText('Open Write the report; hold to focus on it');
  fireEvent.pointerDown(row, { clientX: 100, clientY: 30 });
  fireEvent.pointerMove(row, { clientX: 110, clientY: 34 });
  await flush(200);
  fireEvent.pointerMove(row, { clientX: 113, clientY: 30 });
  await flush(1000);
  expect(useFocusStore.getState().state.status).toBe('idle');
  fireEvent.pointerDown(row, { clientX: 100, clientY: 30 });
  fireEvent.pointerMove(row, { clientX: 108, clientY: 36 });
  await flush(500);
  expect(useFocusStore.getState().state.status).toBe('running');
});

it('pointercancel cancels the hold', async () => {
  setList(() => [task('a', 'Write the report')]);
  render(<TaskCard />);
  await flush();
  const row = screen.getByLabelText('Open Write the report; hold to focus on it');
  fireEvent.pointerDown(row, { clientX: 100, clientY: 30 });
  await flush(300);
  fireEvent.pointerCancel(row);
  await flush(1000);
  expect(useFocusStore.getState().state.status).toBe('idle');
});

it('treats a summary with no next list as a failed read, not as nothing due', async () => {
  mocks.set('wall2_tasks_summary', () => ({ remaining: 0 }));
  render(<TaskCard />);
  await flush();
  expect(screen.getByText('Tasks unavailable')).toBeTruthy();
  expect(screen.queryByText('Nothing due')).toBeNull();
});

it('reads the tasks without the home tag and shows estimates and how many more can wait', async () => {
  setList(() => [task('a', 'First', '45'), task('b', 'Second', '60plus'), task('c', 'Third')], 9);
  const r = render(<TaskCard />);
  await flush();
  expect(summaryArgs[0]).toEqual({ notTag: 'home' });
  expect([...r.container.querySelectorAll('.est')].map((e) => e.textContent)).toEqual(['45 m', '60+ m']);
  expect(screen.getByText('9 more can wait')).toBeTruthy();
});

it('says nothing about more when there are none', async () => {
  setList(() => [task('a', 'First')], 0);
  render(<TaskCard />);
  await flush();
  expect(screen.queryByText(/more can wait/)).toBeNull();
});

it('shows a completed task again when a later list has it open (reopened or recurring)', async () => {
  let list = [task('a', 'First')];
  setList(() => list);
  mocks.set('wall2_task_done', () => {
    list = [];
  });
  render(<TaskCard />);
  await flush();
  fireEvent.click(screen.getByLabelText('Mark done: First'));
  await flush(2100);
  expect(screen.queryByText('First')).toBeNull();
  await flush(0);
  // The list fetched after the save no longer has it; the id is free again.
  list = [task('a', 'First')];
  await flush(120_000);
  const row = screen.getByText('First').closest('li');
  expect(row).toBeTruthy();
  expect(row?.className).not.toContain('done');
});

it('queues one trailing refresh when a refresh is requested during a request', async () => {
  let list = [task('a', 'First'), task('b', 'Second')];
  const waiting: Array<() => void> = [];
  let defer = false;
  const calls = vi.fn();
  setList(() => {
    calls();
    const snapshot = [...list];
    if (!defer) return snapshot;
    return new Promise((resolve) => waiting.push(() => resolve(snapshot)));
  });
  mocks.set('wall2_task_done', (args) => {
    list = list.filter((t) => t.id !== args?.id);
  });
  render(<TaskCard />);
  await flush();
  defer = true;
  fireEvent.click(screen.getByLabelText('Mark done: First'));
  fireEvent.click(screen.getByLabelText('Mark done: Second'));
  await flush(2100);
  // The first completion started a refresh; the second one asked while it ran.
  expect(calls).toHaveBeenCalledTimes(2);
  await act(async () => waiting.shift()?.());
  await flush(0);
  expect(calls).toHaveBeenCalledTimes(3);
  await act(async () => waiting.shift()?.());
  await flush(0);
  expect(screen.queryByText('First')).toBeNull();
  expect(screen.queryByText('Second')).toBeNull();
  expect(screen.getByText('Nothing due')).toBeTruthy();
});

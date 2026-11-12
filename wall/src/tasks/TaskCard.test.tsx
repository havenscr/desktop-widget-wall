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

const task = (id: string, title: string): TaskItem => ({ id, title, due_at: null, due_is_all_day: false, quadrant: null });

beforeEach(() => {
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
  mocks.set('wall2_tasks_next', () => Promise.reject(new Error('not-configured')));
  render(<TaskCard />);
  await flush();
  expect(screen.getByText('Not set up')).toBeTruthy();
});

it('shows Nothing due for an empty list', async () => {
  mocks.set('wall2_tasks_next', () => []);
  render(<TaskCard />);
  await flush();
  expect(screen.getByText('Nothing due')).toBeTruthy();
});

it('marks a row done at once, fades it after 2 seconds, then refreshes', async () => {
  let list = [task('a', 'First'), task('b', 'Second')];
  const done = vi.fn((args?: Record<string, unknown>) => {
    list = list.filter((t) => t.id !== args?.id);
  });
  mocks.set('wall2_tasks_next', () => list);
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
  mocks.set('wall2_tasks_next', () => [task('a', 'First')]);
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
  mocks.set('wall2_tasks_next', () => [task('a', 'First')]);
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
  mocks.set('wall2_tasks_next', () => (fail ? Promise.reject(new Error('Could not reach the service')) : [task('a', 'First')]));
  render(<TaskCard />);
  await flush();
  fail = true;
  await flush(120_000 * 3);
  expect(screen.getByText('First')).toBeTruthy();
  expect(screen.getByText(/updated \d+ min ago/)).toBeTruthy();
});

it('Focus starts a session named after the task', async () => {
  mocks.set('wall2_tasks_next', () => [task('a', 'Write the report')]);
  render(<TaskCard />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
  const s = useFocusStore.getState().state;
  expect(s.status).toBe('running');
  expect(s.status === 'running' && s.label).toBe('Write the report');
  expect((screen.getByRole('button', { name: 'Focus' }) as HTMLButtonElement).disabled).toBe(true);
});

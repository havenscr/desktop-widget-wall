import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { useTasks } from './useTasks';

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
});

it('treats a non-list answer from the unfiltered read as a failed read, as the summary path does', async () => {
  mocks.set('wall2_tasks_next', () => ({ tasks: [] }));
  const { result } = renderHook(() => useTasks());
  await flush();
  expect(result.current.status).toBe('error');
  expect(result.current.lastOk).toBeNull();
});

it('keeps the last good unfiltered list when a later answer is not a list', async () => {
  let answer: unknown = [{ id: 'a', title: 'A', due_at: null, due_is_all_day: false, quadrant: null }];
  mocks.set('wall2_tasks_next', () => answer);
  const { result } = renderHook(() => useTasks());
  await flush();
  expect(result.current.status).toBe('ready');
  expect(result.current.tasks.map((t) => t.id)).toEqual(['a']);
  answer = null;
  await flush(2 * 60_000);
  expect(result.current.status).toBe('error');
  expect(result.current.tasks.map((t) => t.id)).toEqual(['a']);
});

it('an empty unfiltered list is still a good read', async () => {
  mocks.set('wall2_tasks_next', () => []);
  const { result } = renderHook(() => useTasks());
  await flush();
  expect(result.current.status).toBe('ready');
  expect(result.current.tasks).toEqual([]);
});

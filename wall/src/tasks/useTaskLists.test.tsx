import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { useTaskLists } from './useTaskLists';

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

it('retries after 15 s, then 30 s, then every 60 s, and stops after a success', async () => {
  let calls = 0;
  let up = false;
  mocks.set('wall2_tasks_lists', () => {
    calls += 1;
    if (!up) throw new Error('down');
    return ['Work'];
  });
  const { result } = renderHook(() => useTaskLists());
  await flush();
  expect(calls).toBe(1);
  expect(result.current.status).toBe('error');
  await flush(14_000);
  expect(calls).toBe(1);
  await flush(1_000);
  expect(calls).toBe(2);
  await flush(29_000);
  expect(calls).toBe(2);
  await flush(1_000);
  expect(calls).toBe(3);
  await flush(60_000);
  expect(calls).toBe(4);
  up = true;
  await flush(60_000);
  expect(calls).toBe(5);
  expect(result.current).toEqual({ status: 'ready', names: ['Work'] });
  await flush(300_000);
  expect(calls).toBe(5);
});

it('stops retrying on unmount', async () => {
  let calls = 0;
  mocks.set('wall2_tasks_lists', () => {
    calls += 1;
    throw new Error('down');
  });
  const { unmount } = renderHook(() => useTaskLists());
  await flush();
  unmount();
  await flush(300_000);
  expect(calls).toBe(1);
});

it('waits while the page is hidden and reads again when it shows', async () => {
  let calls = 0;
  mocks.set('wall2_tasks_lists', () => {
    calls += 1;
    throw new Error('down');
  });
  const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  renderHook(() => useTaskLists());
  await flush();
  await flush(15_000);
  expect(calls).toBe(1);
  vis.mockReturnValue('visible');
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(calls).toBe(2);
  vis.mockRestore();
});

it('never starts a second read while one is in flight, so a late failure cannot follow a success', async () => {
  let calls = 0;
  let release: ((v: string[]) => void) | undefined;
  mocks.set('wall2_tasks_lists', () => {
    calls += 1;
    if (calls === 1) throw new Error('down');
    return new Promise<string[]>((res) => {
      release = res;
    });
  });
  const { result } = renderHook(() => useTaskLists());
  await flush();
  expect(result.current.status).toBe('error');
  await flush(15_000);
  expect(calls).toBe(2);
  const vis = vi.spyOn(document, 'visibilityState', 'get');
  vis.mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  vis.mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  await flush();
  expect(calls).toBe(2);
  release?.(['Work']);
  await flush();
  expect(result.current).toEqual({ status: 'ready', names: ['Work'] });
  vis.mockRestore();
});

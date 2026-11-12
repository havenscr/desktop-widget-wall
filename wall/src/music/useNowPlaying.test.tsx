import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetNowPlaying } from './store';
import { MusicBar } from './MusicBar';
import { CALL_TIMEOUT_MS, POLL_MS } from './useNowPlaying';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
});
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

it('a hung call times out after 5 seconds and the loop moves on once it settles', async () => {
  let n = 0;
  let release: (v: unknown) => void = () => {};
  mocks.set('get_now_playing', () => {
    n++;
    if (n === 1) return new Promise((r) => (release = r));
    return { title: 'Second', playback_status: 'playing' };
  });
  render(<MusicBar />);
  await flush(CALL_TIMEOUT_MS - 100);
  expect(n).toBe(1);
  await flush(100 + 2000);
  expect(n).toBe(1); // timed out, but the native call has not settled: no second call yet
  release(null);
  await flush(POLL_MS + 10);
  expect(n).toBe(2);
  expect(screen.getByText('Second')).toBeTruthy();
});

it('drops an answer that arrives after the timeout', async () => {
  let n = 0;
  let late: (v: unknown) => void = () => {};
  mocks.set('get_now_playing', () => {
    n++;
    if (n === 1) return new Promise((r) => (late = r));
    return { title: 'Fresh', playback_status: 'playing' };
  });
  render(<MusicBar />);
  await flush(CALL_TIMEOUT_MS + 10);
  late({ title: 'Stale', playback_status: 'playing' });
  await flush(POLL_MS + 10);
  expect(screen.getByText('Fresh')).toBeTruthy();
  expect(screen.queryByText('Stale')).toBeNull();
});

it('never has two get_now_playing calls outstanding while one is hung', async () => {
  let calls = 0;
  mocks.set('get_now_playing', () => {
    calls++;
    return new Promise(() => {}); // hangs for good
  });
  render(<MusicBar />);
  await flush(60_000);
  expect(calls).toBe(1);
});

it('polls again once the hung call finally settles', async () => {
  let calls = 0;
  let release: (v: unknown) => void = () => {};
  mocks.set('get_now_playing', () => {
    calls++;
    if (calls === 1) return new Promise((r) => (release = r));
    return { title: 'Back', playback_status: 'playing' };
  });
  render(<MusicBar />);
  await flush(CALL_TIMEOUT_MS + 4000);
  expect(calls).toBe(1);
  release({ title: 'Late', playback_status: 'playing' });
  await flush(POLL_MS + 10);
  expect(calls).toBe(2);
  expect(screen.getByText('Back')).toBeTruthy();
  expect(screen.queryByText('Late')).toBeNull();
});

it('clears the timeout timer on unmount with a call still unresolved', async () => {
  mocks.set('get_now_playing', () => new Promise(() => {}));
  const { unmount } = render(<MusicBar />);
  await flush(100);
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

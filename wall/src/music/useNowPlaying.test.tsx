import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { MusicBar } from './MusicBar';
import { CALL_TIMEOUT_MS } from './useNowPlaying';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
});
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

it('a hung call times out after 5 seconds and polling carries on', async () => {
  let n = 0;
  mocks.set('get_now_playing', () => {
    n++;
    if (n === 1) return new Promise(() => {}); // never answers
    return { title: 'Second', playback_status: 'playing' };
  });
  render(<MusicBar />);
  await flush(CALL_TIMEOUT_MS - 100);
  expect(n).toBe(1);
  await flush(100 + 2000);
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
  await flush(CALL_TIMEOUT_MS + 2000);
  expect(screen.getByText('Fresh')).toBeTruthy();
  late({ title: 'Stale', playback_status: 'playing' });
  await flush(10);
  expect(screen.queryByText('Stale')).toBeNull();
});

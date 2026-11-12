import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { Unwind } from '../screens/Unwind';
import { MusicBar } from './MusicBar';
import { POLL_MS, acquireNowPlaying, resetNowPlaying, useNowPlayingStore } from './store';

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

it('two consumers share one poll', async () => {
  const get = vi.fn(() => ({ title: 'Shared', artist: 'Band', playback_status: 'playing', duration_seconds: 100, position_seconds: 10 }));
  mocks.set('get_now_playing', get);
  render(
    <>
      <MusicBar />
      <Unwind />
    </>,
  );
  await flush();
  expect(get).toHaveBeenCalledTimes(1);
  await flush(POLL_MS);
  expect(get).toHaveBeenCalledTimes(2);
  expect(screen.getAllByText('Shared')).toHaveLength(2);
});

it('keeps polling when one of two consumers leaves, and stops when both are gone', async () => {
  const get = vi.fn(() => ({ title: 'x', playback_status: 'playing' }));
  mocks.set('get_now_playing', get);
  const a = render(<MusicBar />);
  const b = render(<Unwind />);
  await flush();
  a.unmount();
  const n = get.mock.calls.length;
  await flush(POLL_MS + 10);
  expect(get.mock.calls.length).toBe(n + 1);
  b.unmount();
  const m = get.mock.calls.length;
  await flush(POLL_MS * 3);
  expect(get.mock.calls.length).toBe(m);
});

it('moving from one screen to the other keeps the state and does not poll twice', async () => {
  const get = vi.fn(() => ({ title: 'Stay', playback_status: 'playing' }));
  mocks.set('get_now_playing', get);
  acquireNowPlaying(); // the app itself holds the poll, as App does, so a screen switch never restarts it
  const { rerender } = render(<MusicBar />);
  await flush();
  expect(useNowPlayingStore.getState().info?.title).toBe('Stay');
  rerender(<Unwind />);
  expect(screen.getByText('Stay')).toBeTruthy();
  expect(get).toHaveBeenCalledTimes(1);
});

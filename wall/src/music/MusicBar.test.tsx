import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetNowPlaying } from './store';
import { MusicBar } from './MusicBar';

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

it('shows the quiet state when stopped', async () => {
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
  render(<MusicBar />);
  await flush();
  expect(screen.getByText('Nothing playing')).toBeTruthy();
});

it('shows title, artist and keeps art while art_unchanged', async () => {
  let n = 0;
  mocks.set('get_now_playing', () => {
    n++;
    return n === 1
      ? { title: 'Song', artist: 'Band', playback_status: 'playing', album_art_base64: 'QUJD', album_art_mime: 'image/png' }
      : { title: 'Song', artist: 'Band', playback_status: 'playing', art_unchanged: true };
  });
  const { container } = render(<MusicBar />);
  await flush();
  expect(screen.getByText('Song')).toBeTruthy();
  expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,QUJD');
  await flush(2000);
  expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,QUJD');
});

it('polls every 2 seconds and not while hidden', async () => {
  const get = vi.fn(() => ({ playback_status: 'paused', title: 'x' }));
  mocks.set('get_now_playing', get);
  render(<MusicBar />);
  await flush();
  await flush(4000);
  expect(get).toHaveBeenCalledTimes(3);
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const before = get.mock.calls.length;
  await flush(4000); // under the 5 second call timeout
  expect(get).toHaveBeenCalledTimes(before);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

it('does not throw when a command fails', async () => {
  mocks.set('get_now_playing', () => ({ playback_status: 'playing', title: 'x' }));
  mocks.set('media_next', () => {
    throw new Error('nope');
  });
  render(<MusicBar />);
  await flush();
  await act(async () => {
    screen.getByLabelText('Next').click();
  });
  await flush();
  expect(screen.getByText('x')).toBeTruthy();
});

it('never overlaps polls and drops a stale answer', async () => {
  let active = 0;
  let maxActive = 0;
  const resolvers: Array<() => void> = [];
  let n = 0;
  mocks.set('get_now_playing', async () => {
    const mine = ++n;
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise<void>((r) => resolvers.push(r));
    active--;
    return { playback_status: 'playing', title: `Song ${mine}` };
  });
  render(<MusicBar />);
  await flush();
  // The first poll is slow: no second poll starts while it is pending.
  await flush(4000); // under the 5 second call timeout
  expect(n).toBe(1);
  await act(async () => {
    resolvers.shift()?.();
  });
  await flush(2000);
  expect(n).toBe(2);
  expect(maxActive).toBe(1);
  // A button press refreshes while another poll is pending, then answers arrive newest first.
  await act(async () => {
    screen.getByLabelText('Next').click();
  });
  expect(screen.queryByText('Song 1')).toBeTruthy();
});

it('skips the refresh after a command while hidden and writes nothing after unmount', async () => {
  const get = vi.fn(() => ({ playback_status: 'playing', title: 'x' }));
  mocks.set('get_now_playing', get);
  mocks.set('media_next', () => undefined);
  const { unmount } = render(<MusicBar />);
  await flush();
  const before = get.mock.calls.length;
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  await act(async () => {
    screen.getByLabelText('Next').click();
  });
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  expect(get.mock.calls.length).toBe(before);
  unmount();
  await flush(4000); // under the 5 second call timeout
  expect(get.mock.calls.length).toBe(before);
});

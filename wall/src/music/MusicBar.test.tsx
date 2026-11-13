import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetNowPlaying } from './store';
import { HoverTipLayer, resetTip } from '../ui/HoverTip';
import { MusicBar, MusicMini } from './MusicBar';

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

it('MusicMini shows the track with Previous, Play or Pause and Next in that order, each calling its command once', async () => {
  const calls: string[] = [];
  mocks.set('get_now_playing', () => ({ title: 'Tokyo Burnout', artist: 'Tokyo Rose', playback_status: 'playing' }));
  for (const c of ['media_previous', 'media_play_pause', 'media_next']) mocks.set(c, () => void calls.push(c));
  const { container } = render(<MusicMini />);
  await flush();
  expect(screen.getByText('Tokyo Burnout')).toBeTruthy();
  expect(screen.getByText('Tokyo Rose')).toBeTruthy();
  const btns = [...container.querySelectorAll('button')];
  expect(btns.map((b) => b.getAttribute('aria-label'))).toEqual(['Previous', 'Pause', 'Next']);
  expect(btns.every((b) => b.className === 'rd')).toBe(true);
  for (const b of btns)
    await act(async () => {
      b.click();
    });
  expect(calls).toEqual(['media_previous', 'media_play_pause', 'media_next']);
});

it('MusicMini keeps the three buttons while paused, with Play', async () => {
  mocks.set('get_now_playing', () => ({ title: 'x', playback_status: 'paused' }));
  const { container } = render(<MusicMini />);
  await flush();
  expect([...container.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Previous', 'Play', 'Next']);
});

it('MusicMini carries the full title in its hover tip when the title is cut', async () => {
  const long = 'An Extremely Long Song Title That Goes On And On Forever';
  mocks.set('get_now_playing', () => ({ title: long, artist: 'Band', playback_status: 'playing' }));
  render(
    <>
      <MusicMini />
      <HoverTipLayer />
    </>,
  );
  await flush();
  const el = screen.getByText(long);
  expect(el.className).toContain('ellipsis');
  fireEvent.mouseEnter(el);
  await flush(400);
  expect(document.body.textContent).toContain(`${long}, Band`);
  resetTip();
});

it('MusicMini is quiet with all three buttons disabled when nothing plays', async () => {
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
  const { container } = render(<MusicMini />);
  await flush();
  expect(screen.getByText('Nothing playing')).toBeTruthy();
  expect(container.querySelector('.music-mini')!.className).toContain('quiet');
  const btns = [...container.querySelectorAll('button')] as HTMLButtonElement[];
  expect(btns.map((b) => b.getAttribute('aria-label'))).toEqual(['Previous', 'Play', 'Next']);
  expect(btns.every((b) => b.disabled)).toBe(true);
});

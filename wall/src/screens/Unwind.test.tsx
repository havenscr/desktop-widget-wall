import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetNowPlaying } from '../music/store';
import { Unwind } from './Unwind';

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

it('shows the quiet state with disabled controls when nothing plays', async () => {
  mocks.set('get_now_playing', () => ({ playback_status: 'stopped' }));
  render(<Unwind />);
  await flush();
  expect(screen.getByText('Nothing playing')).toBeTruthy();
  expect((screen.getByLabelText('Play') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('progressbar')).toBeNull();
});

it('shows title, artist, art, position and duration', async () => {
  mocks.set('get_now_playing', () => ({
    title: 'Tokyo Burnout',
    artist: 'Tokyo Rose',
    playback_status: 'playing',
    position_seconds: 155,
    duration_seconds: 253,
    album_art_base64: 'QUJD',
    album_art_mime: 'image/png',
  }));
  const { container } = render(<Unwind />);
  await flush();
  expect(screen.getByText('Tokyo Burnout')).toBeTruthy();
  expect(screen.getByText('Tokyo Rose')).toBeTruthy();
  expect(screen.getByText('4:13')).toBeTruthy();
  expect(screen.getByText('2:35')).toBeTruthy();
  expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,QUJD');
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('155');
});

it('advances the position locally between polls and never past the duration', async () => {
  vi.setSystemTime(0);
  mocks.set('get_now_playing', () => ({ title: 'x', playback_status: 'playing', position_seconds: 97.5, duration_seconds: 100 }));
  render(<Unwind />);
  await flush();
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('98');
  await flush(1600); // before the next poll lands, local time carries it on
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('99');
  await flush(400); // 2 s: the poll answers 97.5 again; the bar never passes 100 in between
  for (let i = 0; i < 20; i++) {
    await flush(500);
    expect(Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeLessThanOrEqual(100);
  }
});

it('holds the position while paused', async () => {
  mocks.set('get_now_playing', () => ({ title: 'x', playback_status: 'paused', position_seconds: 40, duration_seconds: 100 }));
  render(<Unwind />);
  await flush();
  await flush(1900);
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
  expect(screen.getByLabelText('Play')).toBeTruthy();
});

it('sends the media commands from large buttons', async () => {
  const next = vi.fn();
  const toggle = vi.fn();
  const prev = vi.fn();
  mocks.set('get_now_playing', () => ({ title: 'x', playback_status: 'playing' }));
  mocks.set('media_next', next);
  mocks.set('media_play_pause', toggle);
  mocks.set('media_previous', prev);
  render(<Unwind />);
  await flush();
  await act(async () => {
    screen.getByLabelText('Next').click();
    screen.getByLabelText('Pause').click();
    screen.getByLabelText('Previous').click();
  });
  expect([next, toggle, prev].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
});

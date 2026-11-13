import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { Unwind } from '../screens/Unwind';
import { MusicBar } from './MusicBar';
import { ART_RETRY_MS, POLL_MS, acquireNowPlaying, rejectArt, resetNowPlaying, useNowPlayingStore } from './store';

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

it('asks for the art again whenever it does not hold the art for the current track', async () => {
  const sent: unknown[] = [];
  let reply: Record<string, unknown> = {
    title: 'Glass Harbor',
    artist: 'Band',
    playback_status: 'playing',
    album_art_base64: 'QUJD',
    album_art_mime: 'image/png',
    art_key: 'Glass Harbor|Band||Spotify',
  };
  mocks.set('get_now_playing', (args) => {
    sent.push(args?.artFor);
    return reply;
  });
  const release = acquireNowPlaying();
  await flush();
  // The first poll holds no art: it asks with an empty key.
  expect(sent).toEqual(['']);
  expect(useNowPlayingStore.getState().art).toBe('data:image/png;base64,QUJD');
  // Then it names the track it holds the art for, and keeps it while Rust says unchanged.
  reply = { title: 'Glass Harbor', artist: 'Band', playback_status: 'playing', art_unchanged: true, art_key: 'Glass Harbor|Band||Spotify' };
  await flush(POLL_MS);
  expect(sent[1]).toBe('Glass Harbor|Band||Spotify');
  expect(useNowPlayingStore.getState().art).toBe('data:image/png;base64,QUJD');
  release();
  // A reload forgets the art; the next poll asks for it again instead of trusting Rust's memory.
  resetNowPlaying();
  sent.length = 0;
  acquireNowPlaying();
  await flush();
  expect(sent).toEqual(['']);
});

it('asks again after a track came without art, so art a player adds late still arrives', async () => {
  const sent: unknown[] = [];
  let reply: Record<string, unknown> = { title: 'Late', playback_status: 'playing', art_key: 'Late|||Spotify' };
  mocks.set('get_now_playing', (args) => {
    sent.push(args?.artFor);
    return reply;
  });
  acquireNowPlaying();
  await flush();
  reply = { title: 'Late', playback_status: 'playing', art_unchanged: true, art_key: 'Late|||Spotify' };
  await flush(POLL_MS);
  expect(sent[1]).toBe('Late|||Spotify');
  reply = { title: 'Late', playback_status: 'playing', album_art_base64: 'QUJD', album_art_mime: 'image/png', art_key: 'Late|||Spotify' };
  await flush(ART_RETRY_MS);
  expect(sent).toContain('');
  expect(useNowPlayingStore.getState().art).toBe('data:image/png;base64,QUJD');
});

it('never asks again for a cover it refused: a type outside the list, or one the image could not decode', async () => {
  const sent: unknown[] = [];
  let reply: Record<string, unknown> = { title: 'Odd Cover', playback_status: 'playing', album_art_base64: 'QUJD', album_art_mime: 'image/bmp', art_key: 'Odd Cover|||Player' };
  mocks.set('get_now_playing', (args) => {
    sent.push(args?.artFor);
    return reply;
  });
  acquireNowPlaying();
  await flush();
  expect(useNowPlayingStore.getState().art).toBeNull();
  reply = { title: 'Odd Cover', playback_status: 'playing', art_unchanged: true, art_key: 'Odd Cover|||Player' };
  await flush(ART_RETRY_MS * 3);
  expect(sent.slice(1).every((k) => k === 'Odd Cover|||Player')).toBe(true);
  // A cover that arrives but cannot be decoded is dropped and not asked for again either.
  reply = { title: 'Next', playback_status: 'playing', album_art_base64: 'QUJD', album_art_mime: 'image/png', art_key: 'Next|||Player' };
  await flush(POLL_MS);
  expect(useNowPlayingStore.getState().art).toBe('data:image/png;base64,QUJD');
  rejectArt();
  expect(useNowPlayingStore.getState().art).toBeNull();
  reply = { title: 'Next', playback_status: 'playing', art_unchanged: true, art_key: 'Next|||Player' };
  const before = sent.length;
  await flush(ART_RETRY_MS * 3);
  expect(sent.slice(before).every((k) => k === 'Next|||Player')).toBe(true);
});

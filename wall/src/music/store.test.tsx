import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { Unwind } from '../screens/Unwind';
import { MusicBar } from './MusicBar';
import { ART_RETRY_MS, POLL_MS, acquireNowPlaying, mediaTarget, rejectArt, resetNowPlaying, seekMedia, sendMediaCommand, useNowPlayingStore } from './store';

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

it('sends the shown session key and id with every media command, and none when nothing is shown', async () => {
  const seen: unknown[] = [];
  mocks.set('get_now_playing', () => ({ title: 'x', playback_status: 'playing', source_app_id: 'Example.Player_abc!App', session_key: 'Example.Player_abc!App#1' }));
  for (const name of ['media_play_pause', 'media_next', 'media_previous']) mocks.set(name, (args) => void seen.push([name, args]));
  render(<MusicBar />);
  await flush();
  sendMediaCommand('media_play_pause');
  sendMediaCommand('media_next');
  sendMediaCommand('media_previous');
  await flush();
  expect(seen).toEqual([
    ['media_play_pause', { sessionKey: 'Example.Player_abc!App#1', sourceId: 'Example.Player_abc!App' }],
    ['media_next', { sessionKey: 'Example.Player_abc!App#1', sourceId: 'Example.Player_abc!App' }],
    ['media_previous', { sessionKey: 'Example.Player_abc!App#1', sourceId: 'Example.Player_abc!App' }],
  ]);
  seen.length = 0;
  useNowPlayingStore.setState({ info: null });
  sendMediaCommand('media_next');
  await flush();
  expect(seen).toEqual([['media_next', undefined]]);
});

it('aims a command by the key when there is one, by the id for an older reply, and at nothing when nothing is shown', () => {
  expect(mediaTarget({ session_key: 'a#1', source_app_id: 'a' })).toEqual({ sessionKey: 'a#1', sourceId: 'a' });
  expect(mediaTarget({ source_app_id: 'a' })).toEqual({ sourceId: 'a' });
  expect(mediaTarget({ session_key: 'a#0' })).toEqual({ sessionKey: 'a#0' });
  expect(mediaTarget({ title: 'x' })).toBeUndefined();
  expect(mediaTarget(null)).toBeUndefined();
});

it('a refused seek puts the bar back to where the session is on the follow-up poll', async () => {
  const track = { title: 'Held', artist: 'Band', playback_status: 'paused', session_key: 'k1', source_app_id: 'Spotify.exe', duration_seconds: 200, position_seconds: 40, can_seek: true };
  mocks.set('get_now_playing', () => track);
  mocks.set('media_seek', () => false);
  acquireNowPlaying();
  await flush();
  const key = useNowPlayingStore.getState().anchor!.key;
  expect(seekMedia(150, key)).toBe(true);
  expect(useNowPlayingStore.getState().anchor!.position).toBe(150);
  await flush(10);
  expect(useNowPlayingStore.getState().anchor!.position).toBe(40);
});

it('a seek that errors also puts the bar back', async () => {
  mocks.set('get_now_playing', () => ({ title: 'Held', artist: 'Band', playback_status: 'paused', session_key: 'k1', duration_seconds: 200, position_seconds: 40, can_seek: true }));
  mocks.set('media_seek', () => {
    throw new Error('no session');
  });
  acquireNowPlaying();
  await flush();
  expect(seekMedia(150, useNowPlayingStore.getState().anchor!.key)).toBe(true);
  await flush(10);
  expect(useNowPlayingStore.getState().anchor!.position).toBe(40);
});

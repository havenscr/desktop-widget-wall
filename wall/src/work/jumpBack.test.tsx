import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetNowPlaying } from '../music/store';
import type { LastOwn } from '../unwind/lastOwn';
import { resetLastPlayed } from '../unwind/lastPlayed';
import { resetWatch, useWatchStore } from '../unwind/watch/store';
import { useNowPlayingStore } from '../music/store';
import { resumeItem, runForYou, useForYou, useResumeOffer } from './forYou';

const LIST = { kind: 'playlist' as const, id: 'PLnightDrive0001', label: 'Night Drive' };
const own = (over: Partial<LastOwn> = {}): LastOwn => ({ ...LIST, from: 'watch', ...over });
const SAVED = [{ kind: 'playlist' as const, id: LIST.id }];
const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetWatch();
  resetLastPlayed();
  mocks.set('get_now_playing', () => ({ playback_status: 'unknown' }));
  mocks.set('wall2_meet_next', () => ({ accounts: [], meetings: [], stale: false }));
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
  resetWatch();
});

it('offers the last playlist with one Play when nothing plays', () => {
  expect(resumeItem(own(), SAVED, true)).toMatchObject({ kind: 'resume', title: 'Night Drive', action: 'Play', reason: 'jump back in', ref: `playlist:${LIST.id}` });
});

it('offers nothing when something plays, nothing is known, or it is not a playlist that can start again', () => {
  expect(resumeItem(own(), SAVED, false)).toBeNull();
  expect(resumeItem(null, SAVED, true)).toBeNull();
  // A video, and a playlist the saved list no longer holds.
  expect(resumeItem(own({ kind: 'video', id: 'abcdefghijk' }), [{ kind: 'video', id: 'abcdefghijk' }], true)).toBeNull();
  expect(resumeItem(own(), [], true)).toBeNull();
});

const read = (info: object | null, at = Date.now()) => act(() => useNowPlayingStore.setState({ info: info as never, at }));

it('the offer is not in the For you list (it is never counted), and shows only after a media read has answered with nothing playing', async () => {
  useWatchStore.setState({ saved: [{ ...LIST }] });
  act(() => resetLastPlayed(null, own()));
  const list = renderHook(() => useForYou());
  const offer = renderHook(() => useResumeOffer());
  await flush();
  expect(list.result.current).toEqual([]);
  // No media read has answered yet.
  expect(offer.result.current).toBeNull();
  read(null);
  expect(offer.result.current).toMatchObject({ kind: 'resume', title: 'Night Drive' });
  // A media session playing hides it, a quiet one does not.
  read({ playback_status: 'playing', title: 'Song', artist: 'Band' });
  expect(offer.result.current).toBeNull();
  read({ playback_status: 'stopped' });
  expect(offer.result.current).not.toBeNull();
  // The wall's own player playing hides it.
  act(() => useWatchStore.setState({ playing: { ...LIST } }));
  expect(offer.result.current).toBeNull();
  act(() => useWatchStore.setState({ playing: null }));
  expect(offer.result.current).not.toBeNull();
  // The playlist removed from the saved list hides it.
  act(() => useWatchStore.setState({ saved: [] }));
  expect(offer.result.current).toBeNull();
});

it('Play starts the plate\'s own playlist through the existing play path, once', async () => {
  const play = vi.fn();
  useWatchStore.setState({ saved: [{ ...LIST }], play });
  act(() => resetLastPlayed(null, own()));
  const item = resumeItem(own(), SAVED, true)!;
  expect(await runForYou(item)).toBe('Playing the playlist');
  expect(await runForYou(item)).toBe('Starting the playlist');
  expect(play).toHaveBeenCalledTimes(1);
  expect(play).toHaveBeenCalledWith({ kind: 'playlist', id: LIST.id });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
});

it('Play says so when the playlist is gone, or is no longer the remembered one', async () => {
  const play = vi.fn();
  useWatchStore.setState({ saved: [], play });
  act(() => resetLastPlayed(null, own()));
  await expect(runForYou(resumeItem(own(), SAVED, true)!)).rejects.toThrow('Could not start the playlist');
  useWatchStore.setState({ saved: [{ ...LIST }] });
  act(() => resetLastPlayed(null, own({ id: 'PLotherPlaylist01' })));
  await expect(runForYou(resumeItem(own(), SAVED, true)!)).rejects.toThrow('Could not start the playlist');
  expect(play).not.toHaveBeenCalled();
});

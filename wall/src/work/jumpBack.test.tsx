import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../bridge/tauri';
import { resetNowPlaying } from '../music/store';
import type { LastOwn } from '../unwind/lastOwn';
import { resetLastPlayed } from '../unwind/lastPlayed';
import { resetWatch, useWatchStore } from '../unwind/watch/store';
import { resumeItem, runForYou, useForYou } from './forYou';

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

it('is the last line of For you, and only while nothing plays', async () => {
  useWatchStore.setState({ saved: [{ ...LIST }] });
  act(() => resetLastPlayed(null, own()));
  const { result } = renderHook(() => useForYou());
  await flush();
  expect(result.current.map((i) => i.kind)).toEqual(['resume']);
  act(() => useWatchStore.setState({ playing: { ...LIST } }));
  expect(result.current).toEqual([]);
});

it('Play starts the playlist through the existing play path', async () => {
  const play = vi.fn();
  useWatchStore.setState({ saved: [{ ...LIST }], play });
  act(() => resetLastPlayed(null, own()));
  const item = resumeItem(own(), SAVED, true)!;
  expect(await runForYou(item)).toBe('Playing the playlist');
  expect(play).toHaveBeenCalledWith({ kind: 'playlist', id: LIST.id });
});

it('Play says so when the playlist is gone', async () => {
  act(() => resetLastPlayed(null, null));
  await expect(runForYou(resumeItem(own(), SAVED, true)!)).rejects.toThrow('Could not start the playlist');
});

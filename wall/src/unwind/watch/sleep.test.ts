import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { resetNowPlaying, useNowPlayingStore } from '../../music/store';
import { resetSpotifyStatus, useSpotifyStatus } from '../spotify/status';
import { minutesLeft, nextStep, READ_WAIT_MS, resetSleep, sleepWords, startSleepAt, stepSleep, useSleep } from './sleep';
import { resetWatch, useWatchStore } from './store';

vi.setConfig({ testTimeout: 20_000 });

const MIN = 60_000;
const calls: string[] = [];
// What the one-shot read answers at the end (null: nothing; 'hang': never answers; 'fail': rejects).
let shows: Record<string, unknown> | null | 'hang' | 'fail' = null;
// What Spotify's own state answers (null: no playback; 'fail': rejects).
let own: { playing: boolean } | null | 'fail' = null;
let reads = 0;
let unsubscribe: () => void = () => {};
const playing = (source: string | null, status = 'playing') => {
  shows = { title: 'Song', artist: 'Band', playback_status: status, ...(source ? { source_app: source } : {}) };
};
const spotifyReady = () => useSpotifyStatus.setState({ status: { setup: true, signedIn: true, reason: null }, failed: false });
const flush = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};
const playOwn = () => {
  useWatchStore.setState({ saved: [{ kind: 'video', id: 'Ab3dEfGh1jK', label: 'Night drive mix' }] });
  useWatchStore.getState().play({ kind: 'video', id: 'Ab3dEfGh1jK' });
};
/** Runs a whole timer to its end. */
const end = async () => {
  stepSleep();
  await flush(30 * MIN + 10);
  await flush(10);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-11T22:30:00-08:00'));
  localStorage.clear();
  calls.length = 0;
  shows = null;
  own = null;
  reads = 0;
  resetWatch();
  resetSleep();
  resetNowPlaying();
  resetSpotifyStatus();
  unsubscribe = useWatchStore.subscribe((s, p) => {
    if (p.playing && !s.playing) calls.push('stop');
  });
  mocks.set('get_now_playing', () => {
    reads++;
    if (shows === 'hang') return new Promise(() => {});
    if (shows === 'fail') throw new Error('down');
    return shows;
  });
  mocks.set('wall2_spotify_playback', () => {
    if (own === 'fail') throw new Error('down');
    return own;
  });
  mocks.set('wall2_spotify_pause', () => void calls.push('spotify.pause'));
  mocks.set('media_play_pause', () => void calls.push('key'));
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});
afterEach(() => {
  unsubscribe();
  resetSleep();
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
});

describe('the steps and the words', () => {
  it('steps Off, 30, 60, 90, Off, each counting from the click', () => {
    expect(nextStep(0)).toBe(30);
    expect(nextStep(30)).toBe(60);
    expect(nextStep(60)).toBe(90);
    expect(nextStep(90)).toBe(0);
    const t0 = Date.now();
    stepSleep();
    expect(useSleep.getState()).toEqual({ endsAt: t0 + 30 * MIN, step: 30 });
    vi.setSystemTime(t0 + 10 * MIN);
    stepSleep();
    expect(useSleep.getState()).toEqual({ endsAt: t0 + 70 * MIN, step: 60 });
    stepSleep();
    expect(useSleep.getState()).toEqual({ endsAt: t0 + 100 * MIN, step: 90 });
    stepSleep();
    expect(useSleep.getState()).toEqual({ endsAt: null, step: 0 });
  });

  it('says "Stop in 30 min" while off and the minutes left, rounded up, while running', () => {
    const now = Date.now();
    expect(sleepWords(null, now)).toBe('Stop in 30 min');
    expect(sleepWords(now + 24 * MIN, now)).toBe('Stops in 24 min');
    expect(sleepWords(now + 23 * MIN + 1, now)).toBe('Stops in 24 min');
    expect(sleepWords(now + 60_000, now)).toBe('Stops in 1 min');
    expect(sleepWords(now + 1_000, now)).toBe('Stops in 1 min');
    expect(minutesLeft(null)).toBe(0);
  });

  it('has no timer at all while Off, and never fires twice', async () => {
    expect(vi.getTimerCount()).toBe(0);
    stepSleep();
    expect(vi.getTimerCount()).toBe(1);
    stepSleep();
    stepSleep();
    stepSleep();
    expect(useSleep.getState().endsAt).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    // The timer and a page that shows again at the same moment: one end.
    playOwn();
    playing('Edge');
    startSleepAt(Date.now() + 5_000);
    vi.setSystemTime(Date.now() + 6_000);
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    await flush(10_000);
    await flush(10);
    expect(reads).toBe(1);
    expect(calls).toEqual(['key', 'stop']);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the end of the timer', () => {
  it('stops the wall video with the sleep reason when the time comes, and not before', async () => {
    playOwn();
    stepSleep();
    await flush(30 * MIN - 5);
    expect(useWatchStore.getState().playing).not.toBeNull();
    expect(useSleep.getState().endsAt).not.toBeNull();
    await flush(10);
    await flush(10);
    expect(useWatchStore.getState().playing).toBeNull();
    expect(useWatchStore.getState().stopped).toBe('Stopped by the sleep timer.');
    expect(useSleep.getState().endsAt).toBeNull();
  });

  it('a read that fails never lets an answer cached five seconds ago send the key; the video still stops', async () => {
    playOwn();
    useNowPlayingStore.setState({ info: { title: 'Song', artist: 'Band', playback_status: 'playing', source_app: 'Edge' } as never, at: Date.now() - 5_000 });
    shows = 'fail';
    await end();
    expect(calls).toEqual(['stop']);
    expect(useWatchStore.getState().stopped).toBe('Stopped by the sleep timer.');
  });

  it('a read that never answers is unknown after three seconds, not a cached answer', async () => {
    playOwn();
    useNowPlayingStore.setState({ info: { title: 'Song', artist: 'Band', playback_status: 'playing', source_app: 'Edge' } as never, at: Date.now() });
    shows = 'hang';
    stepSleep();
    await flush(30 * MIN + 10);
    expect(useWatchStore.getState().playing).not.toBeNull();
    await flush(READ_WAIT_MS + 10);
    expect(calls).toEqual(['stop']);
  });

  it('a failed read gives Spotify only what its own state says: playing is paused once', async () => {
    spotifyReady();
    own = { playing: true };
    shows = 'fail';
    await end();
    expect(calls).toEqual(['spotify.pause']);
  });

  it('a playing answer with no source sends no key', async () => {
    playing(null);
    await end();
    expect(calls).toEqual([]);
  });

  it('no wall video, Spotify ready and its own state paused: nothing, even when the session says playing', async () => {
    spotifyReady();
    own = { playing: false };
    playing('Spotify');
    await end();
    expect(calls).toEqual([]);
  });

  it('no wall video, Spotify ready and its own state playing: one pause, no key', async () => {
    spotifyReady();
    own = { playing: true };
    playing('Spotify');
    await end();
    expect(calls).toEqual(['spotify.pause']);
  });

  it('no wall video, Spotify ready but its own state cannot be read: nothing for Spotify', async () => {
    spotifyReady();
    own = 'fail';
    playing('Spotify');
    await end();
    expect(calls).toEqual([]);
  });

  it('no wall video, Spotify not signed in and playing in the session: one key', async () => {
    useSpotifyStatus.setState({ status: { setup: true, signedIn: false, reason: null }, failed: false });
    playing('Spotify');
    await end();
    expect(calls).toEqual(['key']);
  });

  it('no wall video and a stale read (never answers): nothing', async () => {
    useNowPlayingStore.setState({ info: { title: 'Song', artist: 'Band', playback_status: 'playing', source_app: 'Edge' } as never, at: Date.now() - 1_000 });
    shows = 'hang';
    stepSleep();
    await flush(30 * MIN + 10);
    await flush(READ_WAIT_MS + 10);
    expect(calls).toEqual([]);
  });

  it('wall video and background Spotify playing by its own state while the session names the web view: one pause, no key', async () => {
    spotifyReady();
    own = { playing: true };
    playOwn();
    playing('msedgewebview2.exe');
    await end();
    expect(calls).toEqual(['spotify.pause', 'stop']);
  });

  it('wall video and Spotify paused by its own state: nothing is sent to Spotify', async () => {
    spotifyReady();
    own = { playing: false };
    playOwn();
    playing('Spotify', 'paused');
    await end();
    expect(calls).toEqual(['stop']);
  });

  it('wall video and a followed outside app playing: one key, sent before the stop', async () => {
    playOwn();
    playing('Edge');
    let release: () => void = () => {};
    mocks.set('media_play_pause', () => {
      calls.push('key');
      return new Promise<void>((r) => {
        release = r;
      });
    });
    stepSleep();
    await flush(30 * MIN + 10);
    expect(calls).toEqual(['key']);
    expect(useWatchStore.getState().playing).not.toBeNull();
    release();
    await flush(10);
    expect(calls).toEqual(['key', 'stop']);
  });

  it('wall video and the followed session is the wall own (web view, or an id no one knows): no key', async () => {
    playOwn();
    playing('msedgewebview2.exe');
    await end();
    expect(calls).toEqual(['stop']);
    calls.length = 0;
    playOwn();
    playing('0a1b2c3d4e5f6a7b!App');
    await end();
    expect(calls).toEqual(['stop']);
  });

  it('the page hidden at the end with an outside app playing: one key', async () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    playing('Edge');
    await end();
    expect(calls).toEqual(['key']);
  });

  it('nothing playing, or a paused app, or no information: nothing', async () => {
    shows = null;
    await end();
    playing('Edge', 'paused');
    await end();
    expect(calls).toEqual([]);
  });

  it('catches up at once when the page shows again after the PC slept past the end', async () => {
    playOwn();
    startSleepAt(Date.now() + 20 * MIN);
    vi.setSystemTime(Date.now() + 90 * MIN);
    document.dispatchEvent(new Event('visibilitychange'));
    await flush(0);
    await flush(0);
    expect(useWatchStore.getState().playing).toBeNull();
    expect(useWatchStore.getState().stopped).toBe('Stopped by the sleep timer.');
  });

  it('stays quiet and goes back to Off when the pause fails', async () => {
    mocks.set('wall2_spotify_pause', () => {
      throw new Error('down');
    });
    spotifyReady();
    own = { playing: true };
    playOwn();
    await end();
    expect(useSleep.getState().endsAt).toBeNull();
    expect(useWatchStore.getState().playing).toBeNull();
  });
});

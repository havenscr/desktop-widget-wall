import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { resetNowPlaying, useNowPlayingStore } from '../../music/store';
import { resetSpotifyStatus, useSpotifyStatus } from '../spotify/status';
import { minutesLeft, READ_WAIT_MS, nextStep, resetSleep, sleepWords, startSleepAt, stepSleep, useSleep } from './sleep';
import { resetWatch, useWatchStore } from './store';

vi.setConfig({ testTimeout: 20_000 });

const MIN = 60_000;
const calls: string[] = [];
// What the player shows when the end asks for a fresh read (null: nothing; 'hang': the read never answers).
let shows: Record<string, unknown> | null | 'hang' = null;
const playing = (source: string, status = 'playing') => {
  shows = { title: 'Song', artist: 'Band', playback_status: status, source_app: source };
};
const flush = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-11T22:30:00-08:00'));
  localStorage.clear();
  calls.length = 0;
  shows = null;
  mocks.set('get_now_playing', () => (shows === 'hang' ? new Promise(() => {}) : shows));
  resetWatch();
  resetSleep();
  resetNowPlaying();
  resetSpotifyStatus();
  mocks.set('wall2_spotify_pause', () => void calls.push('spotify.pause'));
  mocks.set('media_play_pause', () => void calls.push('media_play_pause'));
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});
afterEach(() => {
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
});

describe('the end', () => {
  const playOwn = () => {
    useWatchStore.setState({ saved: [{ kind: 'video', id: 'Ab3dEfGh1jK', label: 'Night drive mix' }] });
    useWatchStore.getState().play({ kind: 'video', id: 'Ab3dEfGh1jK' });
  };

  it('stops the wall video with the sleep reason when the time comes, and not before', async () => {
    playOwn();
    stepSleep();
    await flush(30 * MIN - 5);
    expect(useWatchStore.getState().playing).not.toBeNull();
    expect(useSleep.getState().endsAt).not.toBeNull();
    await flush(10);
    expect(useWatchStore.getState().playing).toBeNull();
    expect(useWatchStore.getState().stopped).toBe('Stopped by the sleep timer.');
    expect(useSleep.getState().endsAt).toBeNull();
  });

  it('pauses Spotify once with its own pause when it is signed in', async () => {
    useSpotifyStatus.setState({ status: { setup: true, signedIn: true, reason: null }, failed: false });
    playing('Spotify');
    stepSleep();
    await flush(30 * MIN + 10);
    await flush(10);
    expect(calls).toEqual(['spotify.pause']);
  });

  it('sends one play and pause key to another app that is playing', async () => {
    playing('Edge');
    stepSleep();
    await flush(30 * MIN + 10);
    expect(calls).toEqual(['media_play_pause']);
  });

  it('sends Spotify no toggle when it is not signed in and says paused', async () => {
    useSpotifyStatus.setState({ status: { setup: true, signedIn: false, reason: null }, failed: false });
    playing('Spotify', 'paused');
    stepSleep();
    await flush(30 * MIN + 10);
    expect(calls).toEqual([]);
  });

  it('sends no command when the player is paused, when there is no information, or when the answer is stale', async () => {
    playing('Edge', 'paused');
    stepSleep();
    await flush(30 * MIN + 10);
    expect(calls).toEqual([]);
    shows = null;
    stepSleep();
    await flush(30 * MIN + 10);
    expect(calls).toEqual([]);
    // A read that never answers leaves only the old answer, which is too old to trust for a toggle.
    useNowPlayingStore.setState({ info: { title: 'Song', artist: 'Band', playback_status: 'playing', source_app: 'Edge' } as never, at: Date.now() });
    shows = 'hang';
    stepSleep();
    await flush(30 * MIN + 10);
    await flush(READ_WAIT_MS + 10);
    expect(calls).toEqual([]);
  });

  it('never sends a toggle to the wall own video or an app it does not know', async () => {
    playing('msedgewebview2.exe');
    stepSleep();
    await flush(30 * MIN + 10);
    playing('Some Unknown Player 7');
    stepSleep();
    await flush(30 * MIN + 10);
    expect(calls).toEqual([]);
  });

  it('wall video playing and nothing else: stopping it is the whole job, no command', async () => {
    playOwn();
    playing('msedgewebview2.exe');
    stepSleep();
    await flush(30 * MIN + 10);
    expect(useWatchStore.getState().playing).toBeNull();
    expect(calls).toEqual([]);
  });

  it('wall video playing while Spotify is paused in the background: no command, Spotify stays paused', async () => {
    useSpotifyStatus.setState({ status: { setup: true, signedIn: true, reason: null }, failed: false });
    playOwn();
    playing('Spotify', 'paused');
    stepSleep();
    await flush(30 * MIN + 10);
    expect(useWatchStore.getState().playing).toBeNull();
    expect(calls).toEqual([]);
  });

  it('wall video playing while another app is playing: no media key (it could land on the wrong session)', async () => {
    playOwn();
    playing('Edge');
    stepSleep();
    await flush(30 * MIN + 10);
    expect(useWatchStore.getState().playing).toBeNull();
    expect(calls).toEqual([]);
  });

  it('wall video playing while Spotify plays too: Spotify gets its own pause, never a key', async () => {
    useSpotifyStatus.setState({ status: { setup: true, signedIn: true, reason: null }, failed: false });
    playOwn();
    playing('Spotify');
    stepSleep();
    await flush(30 * MIN + 10);
    expect(calls).toEqual(['spotify.pause']);
  });

  it('another app playing and no wall video: one command', async () => {
    playing('Edge');
    stepSleep();
    await flush(30 * MIN + 10);
    expect(calls).toEqual(['media_play_pause']);
  });

  it('stale playing information for the wall own session after the stop: no command', async () => {
    playOwn();
    // The player still reports the web view as playing before and after the stop.
    playing('msedgewebview2.exe');
    stepSleep();
    await flush(30 * MIN + 10);
    await flush(READ_WAIT_MS + 10);
    expect(useWatchStore.getState().stopped).toBe('Stopped by the sleep timer.');
    expect(calls).toEqual([]);
    // An unknown id for the same session (the web view id changes by build) is no different.
    playOwn();
    playing('0a1b2c3d4e5f6a7b!App');
    stepSleep();
    await flush(30 * MIN + 10);
    expect(calls).toEqual([]);
  });

  it('catches up at once when the page shows again after the PC slept past the end', async () => {
    playOwn();
    startSleepAt(Date.now() + 20 * MIN);
    vi.setSystemTime(Date.now() + 90 * MIN);
    document.dispatchEvent(new Event('visibilitychange'));
    await flush(0);
    expect(useWatchStore.getState().playing).toBeNull();
    expect(useWatchStore.getState().stopped).toBe('Stopped by the sleep timer.');
  });

  it('stays quiet and goes back to Off when the pause fails', async () => {
    mocks.set('wall2_spotify_pause', () => {
      throw new Error('down');
    });
    useSpotifyStatus.setState({ status: { setup: true, signedIn: true, reason: null }, failed: false });
    playing('Spotify');
    stepSleep();
    await flush(30 * MIN + 10);
    expect(useSleep.getState().endsAt).toBeNull();
  });
});

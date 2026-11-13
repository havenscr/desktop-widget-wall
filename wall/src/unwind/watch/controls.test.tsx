import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { resetNowPlaying } from '../../music/store';
import { Unwind } from '../../screens/Unwind';
import { useSignalStore } from '../../signals/store';
import { usePlaceStore } from '../../state/places';
import { resetLastPlayed } from '../lastPlayed';
import { DEFAULT_LOOKS, DRIVE_IN_SCREEN, LOOKS_KEY, lookTargetName, parseLooks, pickLook } from './looks';
import { AUTOPLAY_WAIT_MS, framePoster } from './PlayerFrame';
import { SAVED_KEY, type SavedItem } from './saved';
import { driveInAudience, resetWatch, useWatchStore } from './store';
import { MAX_MESSAGE, MAX_SECONDS, PLAYER_VOLUME, readPlayerMessage, TWITCH_EMBED_ORIGIN, YOUTUBE_EMBED_ORIGIN } from './urls';
import { openInBrowser } from './Watch';

// Steps fake timers through several seconds at most; the limit keeps a stuck step from hanging CI.
vi.setConfig({ testTimeout: 20_000 });

const V = 'Ab3dEfGh1jK';
const PL = 'PLmockPlaylist0001';
const ITEMS: SavedItem[] = [
  { kind: 'video', id: V, label: 'Night drive mix' },
  { kind: 'playlist', id: PL, label: 'Weekend list' },
  { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor' },
];

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

function seed(looks?: object) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(ITEMS));
  if (looks) localStorage.setItem(LOOKS_KEY, JSON.stringify(looks));
  resetWatch();
}

async function playing(kind: 'video' | 'playlist' | 'twitch', looks?: object) {
  seed(looks);
  useWatchStore.getState().setTab('watch');
  useWatchStore.getState().play(ITEMS.find((i) => i.kind === kind)!);
  render(<Unwind />);
  await flush();
  const frame = document.querySelector('iframe')!;
  const win = frame.contentWindow!;
  const post = vi.spyOn(win, 'postMessage').mockImplementation(() => {});
  return { frame, win, post };
}

function send(win: Window | null, data: unknown, origin = YOUTUBE_EMBED_ORIGIN) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { origin, data: typeof data === 'string' ? data : JSON.stringify(data), source: win }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetWatch();
  usePlaceStore.setState({ active: 'unwind', from: 'work' });
  useSignalStore.setState({ call: null });
  mocks.set('get_now_playing', () => null);
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
  localStorage.clear();
  framePoster.render = null;
});

describe('the message gate', () => {
  const frame = {};
  const good = JSON.stringify({ event: 'infoDelivery', info: { playerState: 1, currentTime: 61.5, duration: 300, playlist: ['a', 'b', 'c'], playlistIndex: 1 } });

  it('accepts a good message from the frame on the embed origin, reading only the known fields', () => {
    expect(readPlayerMessage(YOUTUBE_EMBED_ORIGIN, frame, frame, good)).toEqual({ state: 'playing', time: 61.5, duration: 300, count: 3, index: 1 });
    expect(readPlayerMessage(YOUTUBE_EMBED_ORIGIN, frame, frame, JSON.stringify({ event: 'onReady' }))).toEqual({ ready: true });
    expect(readPlayerMessage(YOUTUBE_EMBED_ORIGIN, frame, frame, JSON.stringify({ event: 'onStateChange', info: 2 }))).toEqual({ state: 'paused' });
  });

  it('refuses the wrong origin and the wrong source', () => {
    expect(readPlayerMessage('https://evil.example', frame, frame, good)).toBeNull();
    expect(readPlayerMessage(TWITCH_EMBED_ORIGIN, frame, frame, good)).toBeNull();
    expect(readPlayerMessage('https://www.youtube-nocookie.com.evil.example', frame, frame, good)).toBeNull();
    expect(readPlayerMessage(YOUTUBE_EMBED_ORIGIN, {}, frame, good)).toBeNull();
    expect(readPlayerMessage(YOUTUBE_EMBED_ORIGIN, null, null, good)).toBeNull();
  });

  it('refuses oversized, malformed and unknown messages, and clamps numbers', () => {
    expect(readPlayerMessage(YOUTUBE_EMBED_ORIGIN, frame, frame, good + ' '.repeat(MAX_MESSAGE))).toBeNull();
    expect(readPlayerMessage(YOUTUBE_EMBED_ORIGIN, frame, frame, '{not json')).toBeNull();
    expect(readPlayerMessage(YOUTUBE_EMBED_ORIGIN, frame, frame, { event: 'onReady' })).toBeNull();
    expect(readPlayerMessage(YOUTUBE_EMBED_ORIGIN, frame, frame, '[1,2]')).toBeNull();
    expect(readPlayerMessage(YOUTUBE_EMBED_ORIGIN, frame, frame, JSON.stringify({ event: 'command', func: 'x' }))).toBeNull();
    expect(readPlayerMessage(YOUTUBE_EMBED_ORIGIN, frame, frame, JSON.stringify({ event: 'infoDelivery', info: '<b>x</b>' }))).toBeNull();
    const odd = readPlayerMessage(YOUTUBE_EMBED_ORIGIN, frame, frame, JSON.stringify({ event: 'infoDelivery', info: { currentTime: -5, duration: 1e12, playerState: 'playing', playlistIndex: '3' } }));
    expect(odd).toEqual({ time: 0, duration: MAX_SECONDS });
  });
});

describe('the wall drives the player', () => {
  it('sends commands only to the embed origin, never to any origin', async () => {
    const { post } = await playing('video');
    await act(async () => screen.getByRole('button', { name: 'Pause' }).click());
    await act(async () => screen.getByRole('button', { name: 'Mute' }).click());
    expect(post).toHaveBeenCalled();
    for (const call of post.mock.calls) expect(call[1]).toBe(YOUTUBE_EMBED_ORIGIN);
    expect(post).toHaveBeenCalledWith(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), YOUTUBE_EMBED_ORIGIN);
  });

  it('sets the player to full volume, unmuted, when playback starts, and again on Sound on', async () => {
    const { win, post } = await playing('video');
    const volume = JSON.stringify({ event: 'command', func: 'setVolume', args: [PLAYER_VOLUME] });
    const unmute = JSON.stringify({ event: 'command', func: 'unMute', args: [] });
    send(win, { event: 'onStateChange', info: 1 });
    expect(post).toHaveBeenCalledWith(volume, YOUTUBE_EMBED_ORIGIN);
    expect(post).toHaveBeenCalledWith(unmute, YOUTUBE_EMBED_ORIGIN);
    expect(useWatchStore.getState().report.started).toBe(true);
    await act(async () => screen.getByRole('button', { name: 'Mute' }).click());
    post.mockClear();
    await act(async () => screen.getByRole('button', { name: 'Sound on' }).click());
    expect(post.mock.calls.map((c) => c[0])).toEqual([unmute, volume]);
  });

  it('keeps Previous and Next off for a single video and turns them on for a playlist the player reports', async () => {
    const { win } = await playing('video');
    send(win, { event: 'infoDelivery', info: { playlist: null, currentTime: 3, duration: 200 } });
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables Previous and Next for a playlist and sends nextVideo', async () => {
    const { win, post } = await playing('playlist');
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    send(win, { event: 'infoDelivery', info: { playlist: ['a', 'b', 'c', 'd'], playlistIndex: 2 } });
    const next = screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    await act(async () => next.click());
    expect(post).toHaveBeenLastCalledWith(JSON.stringify({ event: 'command', func: 'nextVideo', args: [] }), YOUTUBE_EMBED_ORIGIN);
  });

  it('shows the position the player reports, taken at most once a second', async () => {
    const { win } = await playing('video');
    send(win, { event: 'infoDelivery', info: { currentTime: 61, duration: 300 } });
    expect(screen.getByText('1:01')).toBeTruthy();
    expect(screen.getByText('5:00')).toBeTruthy();
    send(win, { event: 'infoDelivery', info: { currentTime: 62, duration: 300 } });
    expect(screen.queryByText('1:02')).toBeNull();
    await flush(1000);
    send(win, { event: 'infoDelivery', info: { currentTime: 63, duration: 300 } });
    expect(screen.getByText('1:03')).toBeTruthy();
  });

  it('keeps the pointer off the frame, and after a refused autoplay asks for a click and lets it through', async () => {
    const { frame, win } = await playing('video');
    expect(frame.classList.contains('w-take')).toBe(false);
    await flush(AUTOPLAY_WAIT_MS - 100);
    expect(screen.queryByText('Click the video to start')).toBeNull();
    await flush(200);
    expect(screen.getByText('Click the video to start')).toBeTruthy();
    expect(frame.classList.contains('w-take')).toBe(true);
    send(win, { event: 'onStateChange', info: 1 });
    expect(screen.queryByText('Click the video to start')).toBeNull();
    expect(frame.classList.contains('w-take')).toBe(false);
  });

  it('shows only Stop and Open on Twitch for Twitch, which has no frame messages', async () => {
    await playing('twitch');
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Open on Twitch$/ })).toBeTruthy();
  });
});

describe('the Look switch', () => {
  it('sets the one look for everything', async () => {
    await playing('video', { mode: 'one', all: 'drivein' });
    const sw = screen.getByRole('radiogroup', { name: 'Look' });
    await act(async () => within(sw).getByRole('radio', { name: 'The sun' }).click());
    expect(parseLooks(localStorage.getItem(LOOKS_KEY))).toMatchObject({ mode: 'one', all: 'sun' });
    expect(document.querySelector('.w-stage')?.getAttribute('data-look')).toBe('sun');
    // The switch is not inside the stage, so it is never drawn on the video.
    expect(sw.closest('.w-stage')).toBeNull();
  });

  it('with a look per kind sets only the kind now playing, and names it', async () => {
    await playing('video', { mode: 'kind', all: 'drivein', video: 'feather', live: 'sky', twitch: 'drivein' });
    const sw = screen.getByRole('radiogroup', { name: 'Look, for videos and playlists' });
    await act(async () => within(sw).getByRole('radio', { name: 'Whole sky' }).click());
    expect(parseLooks(localStorage.getItem(LOOKS_KEY))).toMatchObject({ mode: 'kind', video: 'sky', live: 'sky', twitch: 'drivein', all: 'drivein' });
    expect(pickLook(DEFAULT_LOOKS, 'twitch', 'sun')).toEqual({ ...DEFAULT_LOOKS, all: 'sun' });
    expect(lookTargetName({ ...DEFAULT_LOOKS, mode: 'kind' }, 'playlist')).toBe('Videos and playlists');
    expect(lookTargetName(DEFAULT_LOOKS, 'playlist')).toBeNull();
  });

  it('moves with the arrow keys', async () => {
    await playing('video', { mode: 'one', all: 'feather' });
    const sw = screen.getByRole('radiogroup', { name: 'Look' });
    act(() => {
      sw.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(within(sw).getByRole('radio', { name: 'Whole sky' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('the buddy seam and the opener', () => {
  it('driveInAudience gives the screen in wall pixels only while something is on in the drive-in look', () => {
    seed({ mode: 'one', all: 'drivein' });
    expect(driveInAudience(useWatchStore.getState())).toBeNull();
    useWatchStore.getState().play(ITEMS[0]);
    expect(driveInAudience(useWatchStore.getState())).toEqual({ x: 1210, y: 60, w: 691, h: 389 });
    expect(driveInAudience(useWatchStore.getState())).toBe(DRIVE_IN_SCREEN);
    useWatchStore.getState().pickLook('feather');
    expect(driveInAudience(useWatchStore.getState())).toBeNull();
  });

  it('opens only a validated kind and id through the Rust command', async () => {
    const calls: unknown[] = [];
    mocks.set('wall2_watch_open', (args) => {
      calls.push(args);
    });
    expect(await openInBrowser({ kind: 'video', id: 'javascript:alert(1)' })).toBe(false);
    expect(await openInBrowser({ kind: 'nope' as never, id: V })).toBe(false);
    expect(calls).toEqual([]);
    expect(await openInBrowser({ kind: 'video', id: V })).toBe(true);
    expect(calls).toEqual([{ kind: 'video', id: V }]);
    // A video opens at the reported time; a playlist never passes one.
    expect(await openInBrowser({ kind: 'video', id: V }, 754.8)).toBe(true);
    expect(await openInBrowser({ kind: 'playlist', id: PL }, 60)).toBe(true);
    expect(await openInBrowser({ kind: 'video', id: V }, Number.NaN)).toBe(true);
    expect(calls.slice(1)).toEqual([{ kind: 'video', id: V, at: 754 }, { kind: 'playlist', id: PL }, { kind: 'video', id: V }]);
  });
});

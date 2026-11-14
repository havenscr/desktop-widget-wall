// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { resetNowPlaying } from '../../music/store';
import { UnwindView } from './testView';
import { useSignalStore } from '../../signals/store';
import { usePlaceStore } from '../../state/places';
import { resetLastPlayed } from '../lastPlayed';
import { DEFAULT_LOOKS, DRIVE_IN_SCREEN, LOOKS_KEY, parseLooks } from './looks';
import { AUTOPLAY_WAIT_MS, framePoster, HANDSHAKE_EVERY_MS, PlayerFrame, TWITCH_CLICK_MS } from './PlayerFrame';
import { SAVED_KEY, type SavedItem } from './saved';
import { driveInAudience, resetWatch, useWatchStore } from './store';
import { LISTENING_MESSAGE, MAX_MESSAGE, MAX_SECONDS, PLAYER_VOLUME, readPlayerMessage, TWITCH_EMBED_ORIGIN, YOUTUBE_EMBED_ORIGIN } from './urls';
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

async function playing(kind: 'video' | 'playlist' | 'twitch', looks?: object, load = true) {
  const { unmount } = await renderPlaying(kind, looks);
  return { ...(await frameOf(load)), unmount };
}

async function renderPlaying(kind: 'video' | 'playlist' | 'twitch', looks?: object) {
  seed(looks);
  useWatchStore.getState().setTab('watch');
  useWatchStore.getState().play(ITEMS.find((i) => i.kind === kind)!);
  const r = render(<UnwindView />);
  await flush();
  return r;
}

async function frameOf(load: boolean) {
  const frame = document.querySelector('iframe')!;
  const win = frame.contentWindow!;
  const post = vi.spyOn(win, 'postMessage').mockImplementation(() => {});
  if (load) act(() => fireEvent.load(frame));
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

  it('keeps Previous and Next off for a single video even when the player reports a list', async () => {
    const { win } = await playing('video');
    const off = () => ['Previous', 'Next'].map((name) => (screen.getByRole('button', { name }) as HTMLButtonElement).disabled);
    send(win, { event: 'infoDelivery', info: { playlist: ['a', 'b', 'c'], playlistIndex: 1 } });
    expect(useWatchStore.getState().report.count).toBe(3);
    expect(off()).toEqual([true, true]);
  });

  it('turns Previous and Next on and off with the playlist the player reports', async () => {
    const { win } = await playing('playlist');
    const off = () => ['Previous', 'Next'].map((name) => (screen.getByRole('button', { name }) as HTMLButtonElement).disabled);
    expect(off()).toEqual([true, true]);
    send(win, { event: 'infoDelivery', info: { playlist: ['a', 'b', 'c', 'd'], playlistIndex: 0 } });
    expect(off()).toEqual([false, false]);
    send(win, { event: 'infoDelivery', info: { playlist: null } });
    expect(off()).toEqual([true, true]);
  });

  it('ignores messages through the real listener from the wrong origin or another window', async () => {
    const { win } = await playing('video');
    const msg = { event: 'infoDelivery', info: { playerState: 1, currentTime: 61, duration: 300, playlist: ['a', 'b'] } };
    send(win, msg, 'https://evil.example');
    send(win, msg, TWITCH_EMBED_ORIGIN);
    send(window, msg);
    send(null, msg);
    expect(useWatchStore.getState().report).toMatchObject({ started: false, time: null, duration: null, count: 0 });
    expect(screen.queryByText('1:01')).toBeNull();
    // Nothing started, so the refused-autoplay line still comes.
    await flush(AUTOPLAY_WAIT_MS);
    expect(screen.getByText('Click the video to start')).toBeTruthy();
  });

  it('lets a playlist move on after an item ends without sending a pause', async () => {
    const { win, post } = await playing('playlist');
    send(win, { event: 'onStateChange', info: 1 });
    send(win, { event: 'infoDelivery', info: { playlist: ['a', 'b', 'c', 'd'], playlistIndex: 1 } });
    post.mockClear();
    send(win, { event: 'onStateChange', info: 0 });
    await flush();
    expect(post).not.toHaveBeenCalled();
    expect(useWatchStore.getState().paused).toBe(false);
    expect(screen.getByText('Playing on the wall')).toBeTruthy();
    // The last item's end shows as ended, still without a command.
    send(win, { event: 'infoDelivery', info: { playlist: ['a', 'b', 'c', 'd'], playlistIndex: 3 } });
    send(win, { event: 'onStateChange', info: 0 });
    await flush();
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText('Ended')).toBeTruthy();
  });

  it('ends a single video cleanly: Ended, no command sent, and Play starts it again', async () => {
    const { win, post } = await playing('video');
    send(win, { event: 'onStateChange', info: 1 });
    post.mockClear();
    send(win, { event: 'onStateChange', info: 0 });
    await flush();
    expect(post).not.toHaveBeenCalled();
    expect(useWatchStore.getState().paused).toBe(true);
    expect(screen.getByText('Ended')).toBeTruthy();
    await act(async () => screen.getByRole('button', { name: 'Play' }).click());
    expect(post).toHaveBeenCalledWith(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), YOUTUBE_EMBED_ORIGIN);
    expect(useWatchStore.getState().report.ended).toBe(false);
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

describe('Twitch, which never says it started', () => {
  it('keeps the status line, offers one quiet hint, and lets the pointer through for a short while only', async () => {
    const { frame } = await playing('twitch');
    await flush(AUTOPLAY_WAIT_MS);
    expect(screen.getByText('Live on the wall')).toBeTruthy();
    expect(screen.queryByText('Waiting for a click on the video')).toBeNull();
    expect(screen.getByText('Not started? Click the video')).toBeTruthy();
    expect(frame.classList.contains('w-take')).toBe(true);
    await flush(TWITCH_CLICK_MS);
    expect(frame.classList.contains('w-take')).toBe(false);
    expect(screen.queryByText('Not started? Click the video')).toBeNull();
    // It can be asked for again from the control row.
    await act(async () => screen.getByRole('button', { name: 'Not started?' }).click());
    expect(frame.classList.contains('w-take')).toBe(true);
    expect(screen.getByText('Not started? Click the video')).toBeTruthy();
  });

  it('closes the pointer again after one click into the video', async () => {
    const { frame } = await playing('twitch');
    await flush(AUTOPLAY_WAIT_MS);
    expect(frame.classList.contains('w-take')).toBe(true);
    act(() => {
      frame.focus();
      window.dispatchEvent(new Event('blur'));
    });
    await flush(0);
    expect(frame.classList.contains('w-take')).toBe(false);
    expect(screen.getByRole('button', { name: 'Not started?' })).toBeTruthy();
  });
});

describe('the frame wiring on its own', () => {
  function bare() {
    seed();
    useWatchStore.getState().setTab('watch');
    useWatchStore.getState().play(ITEMS[0]);
    const view = render(<PlayerFrame item={ITEMS[0]} title="Night drive mix" />);
    const frame = document.querySelector('iframe')!;
    const win = frame.contentWindow!;
    const post = vi.spyOn(win, 'postMessage').mockImplementation(() => {});
    return { view, frame, win, post };
  }
  const listening = (post: { mock: { calls: unknown[][] } }) => post.mock.calls.filter((c) => c[0] === LISTENING_MESSAGE).length;

  it('posts nothing to the frame before it has loaded', async () => {
    const { frame, post } = bare();
    act(() => useWatchStore.getState().setPaused(true));
    act(() => useWatchStore.getState().setMuted(true));
    await flush(3000);
    expect(post).not.toHaveBeenCalled();
    act(() => fireEvent.load(frame));
    expect(listening(post)).toBe(1);
  });

  it('does not post the handshake while the page is hidden, and resumes when it shows', async () => {
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { frame, post } = bare();
    act(() => fireEvent.load(frame));
    await flush(3000);
    expect(listening(post)).toBe(0);
    hidden.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(listening(post)).toBe(1);
    await flush(HANDSHAKE_EVERY_MS);
    expect(listening(post)).toBe(2);
    hidden.mockRestore();
  });

  it('leaves no listener and no timer behind after unmount', async () => {
    // Spies that still call through, so the listeners really attach and detach.
    const add = vi.spyOn(window, 'addEventListener');
    const rem = vi.spyOn(window, 'removeEventListener');
    const ofType = (spy: typeof add, type: string) => spy.mock.calls.filter((c) => c[0] === type).map((c) => c[1]);
    const { view, frame, post } = bare();
    act(() => fireEvent.load(frame));
    expect(listening(post)).toBe(1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(ofType(add, 'message').length).toBeGreaterThan(0);
    expect(ofType(rem, 'message')).toEqual(ofType(add, 'message'));
    expect(vi.getTimerCount()).toBe(0);
    await flush(HANDSHAKE_EVERY_MS * 3);
    expect(listening(post)).toBe(1);
    add.mockRestore();
    rem.mockRestore();
  });
});

describe('the looks are chosen in the gear sheet, with no Look switch on the page', () => {
  it('has no Look switch with a video playing, paused, waiting for a click, or with nothing on', async () => {
    await playing('video', { mode: 'one', all: 'drivein' });
    const none = () => {
      expect(document.querySelector('.w-lookbar')).toBeNull();
      expect(screen.queryByRole('radiogroup', { name: /^Look(,|$)/ })).toBeNull();
    };
    none();
    act(() => useWatchStore.getState().setPaused(true));
    none();
    act(() => useWatchStore.getState().setNeedsClick(true));
    none();
    act(() => useWatchStore.getState().stop());
    none();
    // The row of the idle block still has the gear, last.
    const row = document.querySelector('.w-now > .w-ctl')!;
    expect(row.lastElementChild).toBe(screen.getByRole('button', { name: 'How video is shown' }));
  });

  it('puts the gear last in the row of a video, of a playlist and of Twitch', async () => {
    for (const kind of ['video', 'playlist', 'twitch'] as const) {
      const { unmount } = await renderPlaying(kind);
      const row = document.querySelector('.w-now > .w-ctl')!;
      const gear = screen.getByRole('button', { name: 'How video is shown' });
      expect(row.lastElementChild).toBe(gear);
      expect(gear.className).toContain('w-gear');
      // The open button comes just before it.
      expect(gear.previousElementSibling?.className).toContain('w-open');
      unmount();
    }
  });

  it('sets the one look for everything from the sheet it opens on its Looks side, and not inside the stage', async () => {
    await playing('video', { mode: 'one', all: 'drivein' });
    await act(async () => screen.getByRole('button', { name: 'How video is shown' }).click());
    const sw = screen.getByRole('radiogroup', { name: 'Look for everything' });
    await act(async () => within(sw).getByRole('radio', { name: /The sun/ }).click());
    expect(parseLooks(localStorage.getItem(LOOKS_KEY))).toMatchObject({ mode: 'one', all: 'sun' });
    expect(document.querySelector('.w-stage')?.getAttribute('data-look')).toBe('sun');
    expect(sw.closest('.w-stage')).toBeNull();
  });

  it('walks the look tiles with the arrow keys: Right and Down forward, Left and Up back, wrapping, Home and End, focus follows, the look is selected, only the chosen tile is tabbable', async () => {
    await playing('video', { mode: 'one', all: 'feather' });
    await act(async () => screen.getByRole('button', { name: 'How video is shown' }).click());
    const group = () => screen.getByRole('radiogroup', { name: 'Look for everything' });
    const radios = () => [...group().querySelectorAll<HTMLElement>('[role=radio]')];
    const chosen = () => radios().filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.textContent);
    const tabbable = () => radios().filter((r) => r.tabIndex === 0).map((r) => r.textContent);
    expect(chosen()).toEqual(['Feathered']);
    expect(tabbable()).toEqual(['Feathered']);
    act(() => radios()[0].focus());
    const press = (key: string) => act(() => void fireEvent.keyDown(document.activeElement!, { key }));
    const names = ['Whole sky', 'The sun', 'Drive-in', 'Hologram', 'Feathered'];
    for (const name of names) {
      press('ArrowRight');
      expect(chosen()).toEqual([name]);
      expect(tabbable()).toEqual([name]);
      expect(document.activeElement?.textContent).toBe(name);
    }
    expect(parseLooks(localStorage.getItem(LOOKS_KEY)).all).toBe('feather');
    press('ArrowLeft');
    expect(chosen()).toEqual(['Hologram']);
    expect(document.activeElement?.textContent).toBe('Hologram');
    expect(document.querySelector('.w-stage')?.getAttribute('data-look')).toBe('holo');
    press('ArrowUp');
    expect(chosen()).toEqual(['Drive-in']);
    press('ArrowDown');
    expect(chosen()).toEqual(['Hologram']);
    press('Home');
    expect(chosen()).toEqual(['Feathered']);
    press('ArrowLeft');
    expect(chosen()).toEqual(['Hologram']);
    press('End');
    expect(chosen()).toEqual(['Hologram']);
    press('Home');
    press('End');
    expect(chosen()).toEqual(['Hologram']);
    // A key that is not an arrow changes nothing.
    press('a');
    expect(chosen()).toEqual(['Hologram']);
  });

  it('walks each per-kind row on its own with the arrow keys', async () => {
    await playing('video', { mode: 'kind', all: 'drivein', video: 'feather', live: 'sky', twitch: 'drivein' });
    await act(async () => screen.getByRole('button', { name: 'How video is shown' }).click());
    const row = (name: string) => screen.getByRole('radiogroup', { name });
    const lit = (name: string) => [...row(name).querySelectorAll<HTMLElement>('[role=radio]')].filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.textContent);
    const tabbable = (name: string) => [...row(name).querySelectorAll<HTMLElement>('[role=radio]')].filter((r) => r.tabIndex === 0).map((r) => r.textContent);
    expect(tabbable('Look for live streams')).toEqual(['Whole sky']);
    act(() => (row('Look for live streams').querySelectorAll('[role=radio]')[1] as HTMLElement).focus());
    act(() => void fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' }));
    expect(lit('Look for live streams')).toEqual(['The sun']);
    expect(document.activeElement?.textContent).toBe('The sun');
    expect(tabbable('Look for live streams')).toEqual(['The sun']);
    // The other rows are untouched.
    expect(lit('Look for videos and playlists')).toEqual(['Feathered']);
    expect(lit('Look for twitch')).toEqual(['Drive-in']);
    expect(parseLooks(localStorage.getItem(LOOKS_KEY))).toMatchObject({ mode: 'kind', video: 'feather', live: 'sun', twitch: 'drivein' });
    act(() => void fireEvent.keyDown(document.activeElement!, { key: 'End' }));
    expect(lit('Look for live streams')).toEqual(['Hologram']);
    act(() => void fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' }));
    expect(lit('Look for live streams')).toEqual(['Feathered']);
  });

  it('with a look per kind the sheet sets the kind it picks, and names the group', async () => {
    await playing('video', { mode: 'kind', all: 'drivein', video: 'feather', live: 'sky', twitch: 'drivein' });
    await act(async () => screen.getByRole('button', { name: 'How video is shown' }).click());
    const sw = screen.getByRole('radiogroup', { name: 'Look for videos and playlists' });
    await act(async () => within(sw).getByRole('radio', { name: 'Whole sky' }).click());
    expect(parseLooks(localStorage.getItem(LOOKS_KEY))).toMatchObject({ mode: 'kind', video: 'sky', live: 'sky', twitch: 'drivein', all: 'drivein' });
  });
});

describe('the position bar', () => {
  it('fills to the played fraction, carries a marker at the fill end, and the marker takes no click', async () => {
    await playing('video', { mode: 'one', all: 'feather' });
    for (const [time, f, width] of [[0, '0.0000', '0%'], [43, '0.4300', '43%'], [100, '1.0000', '100%']] as const) {
      act(() => useWatchStore.getState().setReport({ time, duration: 100, started: true }));
      const bar = document.querySelector<HTMLElement>('.w-bar')!;
      expect(bar.style.getPropertyValue('--f')).toBe(f);
      expect(bar.querySelector<HTMLElement>('b')!.style.width).toBe(width);
      const mark = bar.querySelector('.w-mark')!;
      expect(mark.getAttribute('aria-hidden')).toBe('true');
      expect(mark.closest('.w-bar')).toBe(bar);
    }
  });

  it('draws its fill and its marker from tokens that exist, holds the marker inside the bar, and is 32 px tall to click', () => {
    const css = (readFileSync('src/styles/unwind.css', 'utf8') as string).replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (sel: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.split(',').map((x) => x.trim()).includes(sel)).map((m) => m[2]).join('');
    expect(rule('.w-bar b')).toContain('var(--mag), var(--cyan)');
    expect(rule('.w-bar b')).not.toContain('--pink');
    expect(rule('.w-live')).toContain('var(--mag)');
    expect(rule('.w-bar')).toMatch(/height: 32px/);
    expect(rule('.w-bar .w-mark')).toMatch(/clamp\(0px, calc\(var\(--f, 0\) \* 100% - 5px\), calc\(100% - 10px\)\)/);
    expect(rule('.w-bar .w-mark')).toMatch(/pointer-events: none/);
    expect(rule('.w-bar .w-mark')).toMatch(/width: 10px/);
  });
});

describe('the buddy seam and the opener', () => {
  it('driveInAudience gives the screen in wall pixels only while something is on in the drive-in look', () => {
    seed({ mode: 'one', all: 'drivein' });
    expect(driveInAudience(useWatchStore.getState())).toBeNull();
    useWatchStore.getState().play(ITEMS[0]);
    expect(driveInAudience(useWatchStore.getState())).toEqual({ x: 1244, y: 54, w: 672, h: 378 });
    expect(driveInAudience(useWatchStore.getState())).toBe(DRIVE_IN_SCREEN);
    useWatchStore.getState().setLooks({ ...DEFAULT_LOOKS, all: 'feather' });
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

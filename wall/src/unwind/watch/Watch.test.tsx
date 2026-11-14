import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { resetNowPlaying } from '../../music/store';
import { UnwindView } from './testView';
import { useSignalStore } from '../../signals/store';
import { usePlaceStore } from '../../state/places';
import { resetLastPlayed } from '../lastPlayed';
import { LINK_ERRORS } from './links';
import { LOOKS_KEY, parseLooks } from './looks';
import { framePoster } from './PlayerFrame';
import { parseSaved, SAVED_KEY } from './saved';
import { resetWatch, useWatchStore } from './store';
import { YOUTUBE_EMBED_ORIGIN } from './urls';

const V = 'Ab3dEfGh1jK';
const THREE = [
  { kind: 'video', id: V, label: 'Night drive mix' },
  { kind: 'live', id: 'Lofi_Live01', label: 'Lofi radio' },
  { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor' },
];
const PLAYING = {
  title: 'Tokyo Burnout',
  artist: 'Tokyo Rose',
  playback_status: 'playing',
  position_seconds: 155,
  duration_seconds: 253,
  album_art_base64: 'QUJD',
  album_art_mime: 'image/png',
};

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

function seed(items: unknown[] = THREE) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(items));
  resetWatch();
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetWatch();
  usePlaceStore.setState({ active: 'unwind', from: 'work' });
  useSignalStore.setState({ call: null });
  mocks.set('get_now_playing', () => PLAYING);
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
  localStorage.clear();
  framePoster.render = null;
});

it('renders the Listen tab with the same text as before when nothing is saved, and no Video corner', async () => {
  render(<UnwindView />);
  await flush();
  const panel = document.getElementById('u-panel-listen')!;
  // The text main showed for this track before Watch existed.
  expect(panel.textContent).toBe('Tokyo BurnoutTokyo Rose2:354:13');
  expect(screen.queryByRole('button', { name: 'Video' })).toBeNull();
  expect(screen.queryByLabelText('How video is shown')).toBeNull();
  // The lines' gear (asked for on Listen) is there by its own name, and no sheet is open.
  expect(screen.getByRole('button', { name: 'How the lines move' }).getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.querySelector('.w-card')).toBeNull();
});

it('the gear on Listen opens the sheet on its Lines side; Watch opens it on Looks', async () => {
  render(<Unwind />);
  await flush();
  await act(async () => screen.getByRole('button', { name: 'How the lines move' }).click());
  const sheet = screen.getByRole('dialog', { name: 'How the lines move' });
  expect(sheet.querySelector('.ln-panel')).not.toBeNull();
  expect(screen.getByRole('tab', { name: 'Lines' }).getAttribute('aria-selected')).toBe('true');
  await act(async () => screen.getByRole('tab', { name: 'Looks' }).click());
  expect(screen.getByRole('dialog', { name: 'How video is shown' }).querySelector('.ln-panel')).toBeNull();
});

it('gives the album art a Video corner when something is saved, which switches to Watch', async () => {
  seed();
  render(<UnwindView />);
  await flush();
  const corner = screen.getByRole('button', { name: 'Video' });
  expect(corner.closest('.u-art')).not.toBeNull();
  expect(corner.getAttribute('title')).toBe('Watch instead: 3 saved to watch');
  await act(async () => corner.click());
  expect(useWatchStore.getState().tab).toBe('watch');
  expect(document.getElementById('u-panel-watch')).not.toBeNull();
  expect(screen.getByText('Nothing on')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Play Night drive mix/ })).toBeTruthy();
});

it('explains itself with nothing saved, refuses a bad link in one line and saves a good one', async () => {
  useWatchStore.getState().setTab('watch');
  render(<UnwindView />);
  await flush();
  expect(screen.getByText(/Save the videos, playlists, live streams and Twitch channels/)).toBeTruthy();
  const field = screen.getByLabelText('Paste a YouTube or Twitch link');
  fireEvent.change(field, { target: { value: 'https://youtube.com.evil.example/watch?v=Ab3dEfGh1jK' } });
  fireEvent.submit(field.closest('form')!);
  expect(screen.getByRole('alert').textContent).toBe(LINK_ERRORS.other);
  expect(localStorage.getItem(SAVED_KEY)).toBeNull();
  fireEvent.change(field, { target: { value: `youtu.be/${V}` } });
  fireEvent.submit(field.closest('form')!);
  expect(screen.queryByRole('alert')).toBeNull();
  // The new row opens its name field.
  const name = screen.getByLabelText('Name for this youtube video') as HTMLInputElement;
  fireEvent.change(name, { target: { value: 'Rainy evening' } });
  fireEvent.keyDown(name, { key: 'Enter' });
  expect(parseSaved(localStorage.getItem(SAVED_KEY))).toEqual([{ kind: 'video', id: V, label: 'Rainy evening' }]);
  expect(screen.getByText('1 saved')).toBeTruthy();
  await act(async () => screen.getByRole('button', { name: 'Remove Rainy evening' }).click());
  expect(parseSaved(localStorage.getItem(SAVED_KEY))).toEqual([]);
});

it('lists 24 items in a list that scrolls inside the card', async () => {
  seed(Array.from({ length: 30 }, (_, i) => ({ kind: 'twitch', id: `chan_${i}`, label: `Channel ${i}` })));
  useWatchStore.getState().setTab('watch');
  render(<UnwindView />);
  await flush();
  expect(document.querySelectorAll('.w-list li').length).toBe(24);
  expect(screen.getByText('24 saved')).toBeTruthy();
});

it('plays a row in one frame built from the checked id, with the fixed attributes, and stops on Stop', async () => {
  seed();
  useWatchStore.getState().setTab('watch');
  render(<UnwindView />);
  await flush();
  await act(async () => screen.getByRole('button', { name: 'Night drive mix' }).click());
  const frames = document.querySelectorAll('iframe');
  expect(frames.length).toBe(1);
  const f = frames[0];
  // jsdom serves the tests from http://localhost:3000.
  expect(f.getAttribute('src')).toBe(`https://www.youtube-nocookie.com/embed/${V}?autoplay=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&playsinline=1&rel=0&enablejsapi=1&origin=http%3A%2F%2Flocalhost%3A3000`);
  expect(f.getAttribute('allow')).toBe('autoplay; encrypted-media; picture-in-picture');
  expect(f.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
  expect(f.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
  expect(f.getAttribute('title')).toBe('Night drive mix');
  expect(screen.getByRole('button', { name: /^Open in YouTube$/ })).toBeTruthy();
  await act(async () => screen.getByRole('button', { name: 'Stop' }).click());
  expect(document.querySelector('iframe')).toBeNull();
});

it('reads play state only from its own frame on the YouTube origin, and sends commands to that origin only', async () => {
  seed();
  useWatchStore.getState().setTab('watch');
  useWatchStore.getState().play({ kind: 'video', id: V });
  render(<UnwindView />);
  await flush();
  const f = document.querySelector('iframe')!;
  const win = f.contentWindow!;
  const post = vi.spyOn(win, 'postMessage').mockImplementation(() => {});
  act(() => fireEvent.load(f));
  const paused = JSON.stringify({ event: 'onStateChange', info: 2 });
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', data: paused, source: win }));
    window.dispatchEvent(new MessageEvent('message', { origin: YOUTUBE_EMBED_ORIGIN, data: paused, source: window }));
  });
  expect(useWatchStore.getState().paused).toBe(false);
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { origin: YOUTUBE_EMBED_ORIGIN, data: paused, source: win }));
  });
  expect(useWatchStore.getState().paused).toBe(true);
  expect(screen.getByText('Paused')).toBeTruthy();
  await act(async () => screen.getByRole('button', { name: 'Play' }).click());
  expect(post).toHaveBeenLastCalledWith(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), YOUTUBE_EMBED_ORIGIN);
  await act(async () => screen.getByRole('button', { name: 'Mute' }).click());
  expect(post).toHaveBeenLastCalledWith(JSON.stringify({ event: 'command', func: 'mute', args: [] }), YOUTUBE_EMBED_ORIGIN);
});

it('stops when a call starts, and does not start again when it ends', async () => {
  seed();
  useWatchStore.getState().setTab('watch');
  useWatchStore.getState().play({ kind: 'twitch', id: 'pixel_harbor' });
  render(<UnwindView />);
  await flush();
  expect(document.querySelector('iframe')?.getAttribute('src')).toBe('https://player.twitch.tv/?channel=pixel_harbor&parent=localhost');
  act(() => useSignalStore.setState({ call: { kind: 'teams', since: 0, camera: false } as never }));
  expect(document.querySelector('iframe')).toBeNull();
  expect(screen.getByText(/Stopped for your call/)).toBeTruthy();
  act(() => useSignalStore.setState({ call: null }));
  await flush(1000);
  expect(document.querySelector('iframe')).toBeNull();
});

it('stops when the page is hidden', async () => {
  seed();
  useWatchStore.getState().setTab('watch');
  useWatchStore.getState().play({ kind: 'video', id: V });
  render(<UnwindView />);
  await flush();
  expect(document.querySelector('iframe')).not.toBeNull();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(document.querySelector('iframe')).toBeNull();
  hidden.mockRestore();
});

it('opens in the browser through the Rust command with the kind and id only', async () => {
  seed();
  const calls: unknown[] = [];
  mocks.set('wall2_watch_open', (args) => {
    calls.push(args);
  });
  useWatchStore.getState().setTab('watch');
  useWatchStore.getState().play({ kind: 'live', id: 'Lofi_Live01' });
  render(<UnwindView />);
  await flush();
  await act(async () => screen.getByRole('button', { name: /^Open in YouTube$/ }).click());
  expect(calls).toEqual([{ kind: 'live', id: 'Lofi_Live01' }]);
});

it('sets the look from the Look switch and draws the drive-in screen or the feathered video', async () => {
  seed();
  framePoster.render = () => <span>poster</span>;
  useWatchStore.getState().setTab('watch');
  useWatchStore.getState().play({ kind: 'video', id: V });
  render(<UnwindView />);
  await flush();
  expect(document.querySelector('.w-stage')?.getAttribute('data-look')).toBe('drivein');
  expect(document.querySelectorAll('.w-post').length).toBe(2);
  expect(document.querySelector('iframe')).toBeNull();
  await act(async () => within(screen.getByRole('radiogroup', { name: 'Look' })).getByRole('radio', { name: 'Feathered' }).click());
  expect(document.querySelector('.w-stage')?.getAttribute('data-look')).toBe('feather');
  expect(parseLooks(localStorage.getItem(LOOKS_KEY)).all).toBe('feather');
});

it('sets the look in the settings sheet, one for everything or one per kind, and closes on Escape', async () => {
  seed();
  useWatchStore.getState().setTab('watch');
  render(<UnwindView />);
  await flush();
  await act(async () => screen.getByRole('button', { name: 'How video is shown' }).click());
  const sheet = screen.getByRole('dialog', { name: 'How video is shown' });
  expect(sheet).toBeTruthy();
  await act(async () => within(sheet).getByRole('radio', { name: /Feathered/ }).click());
  expect(parseLooks(localStorage.getItem(LOOKS_KEY))).toMatchObject({ mode: 'one', all: 'feather' });
  await act(async () => screen.getByRole('radio', { name: 'A look for each kind' }).click());
  expect(screen.getByText('Videos and playlists')).toBeTruthy();
  const twitch = screen.getByRole('radiogroup', { name: 'Look for twitch' });
  await act(async () => (twitch.querySelector('[role=radio]:not(.on)') as HTMLElement).click());
  expect(parseLooks(localStorage.getItem(LOOKS_KEY))).toMatchObject({ mode: 'kind', twitch: 'feather' });
  expect(screen.getByText('Saved here: 2 YouTube, 1 Twitch')).toBeTruthy();
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});

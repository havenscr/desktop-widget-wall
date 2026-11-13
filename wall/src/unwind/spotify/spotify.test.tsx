import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { coverColours, floorColour, liveTint, resetCoverTint, setCoverTint, TINT_FADE_MS, TINT_MIN_LIGHT } from '../../music/coverTint';
import { PLAY_TINT } from '../../horizon/echo';
import type { SpotifyItem, SpotifyTrack } from '../../music/spotify';
import { resetNowPlaying } from '../../music/store';
import { resetTools, useToolsStore } from '../../tools/store';
import { itemLine, LISTEN_SOURCE_KEY, resetListenSource, spotifyProblem, trackLength, upNextPlan, useLastContext, useListenSource } from './model';
import { SpotifyCard } from './SpotifyCard';
import { resetSpotifyStatus, useSpotifyStatus } from './status';
import { UpNext } from './UpNext';

const id = (n: number) => String(n).padStart(22, '0');
const item = (n: number, kind: SpotifyItem['kind'] = 'playlist', name = `List ${n}`): SpotifyItem => ({ id: id(n), kind, name, imageUrl: `data:image/png;base64,big${n}`, thumbUrl: `data:image/png;base64,t${n}`, subtitle: kind === 'playlist' ? 'Playlist' : 'Some Artist', count: kind === 'track' ? null : 20 });
const track = (n: number, playable = true): SpotifyTrack => ({ id: playable ? id(500 + n) : null, name: `Song ${n}`, artists: 'Some Artist', album: 'Some Album', durationMs: 185_000, imageUrl: null, thumbUrl: n === 2 ? null : `data:image/png;base64,c${n}`, playable });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetListenSource();
  resetSpotifyStatus();
  resetTools();
  useLastContext.setState({ context: null, ids: new Set() });
});
afterEach(() => {
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetCoverTint();
});
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const signedIn = () => useSpotifyStatus.setState({ status: { setup: true, signedIn: true, reason: null }, failed: false });

it('maps the bridge errors to problems', () => {
  expect(spotifyProblem(new Error('not set up'))).toBe('notsetup');
  expect(spotifyProblem('sign in again')).toBe('signedout');
  expect(spotifyProblem('busy')).toBe('busy');
  expect(spotifyProblem('no device')).toBe('nodevice');
  expect(spotifyProblem(new Error('down'))).toBe('down');
  expect(spotifyProblem(42)).toBe('failed');
});

it('writes the row line and track lengths', () => {
  expect(itemLine(item(1))).toBe('Playlist · 20 songs');
  expect(itemLine({ ...item(1, 'album'), count: 1 })).toBe('Some Artist · 1 song');
  expect(itemLine(item(1, 'track'))).toBe('Some Artist');
  expect(trackLength(185_000)).toBe('3:05');
  expect(trackLength(3_725_000)).toBe('1:02:05');
});

it('plays a queued track in its list only when the wall read it from there, else skips forward', () => {
  expect(upNextPlan(id(1), 1, { context: null, ids: new Set() })).toEqual({ kind: 'skip', skips: 2 });
  const last = { context: { kind: 'playlist' as const, id: id(9) }, ids: new Set([id(1)]) };
  expect(upNextPlan(id(1), 0, last)).toEqual({ kind: 'context', context: last.context, offsetId: id(1) });
  expect(upNextPlan(id(2), 0, last)).toEqual({ kind: 'skip', skips: 1 });
});

it('takes three colours from a cover, held inside the contrast floor', () => {
  // Left third black, middle white, right pure red.
  const w = 3;
  const data = new Uint8ClampedArray(w * 4);
  data.set([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255]);
  const t = coverColours(data, w, 1);
  const light = (c: number[]) => (Math.max(...c) + Math.min(...c)) / 2 / 255;
  expect(light(t.left)).toBeGreaterThanOrEqual(TINT_MIN_LIGHT - 0.01);
  expect(light(t.centre)).toBeLessThanOrEqual(0.81);
  expect(t.right[0]).toBeGreaterThan(t.right[1]);
  expect(floorColour([10, 10, 10])).not.toEqual([10, 10, 10]);
});

it('cross-fades the lines to the cover over about 2 seconds, at once with reduced motion, and back to teal', () => {
  expect(liveTint(0).centre).toEqual(PLAY_TINT.centre);
  const red = { left: [255, 0, 0], centre: [255, 0, 0], right: [255, 0, 0] };
  setCoverTint(red, 1000);
  const mid = liveTint(1000 + TINT_FADE_MS / 2).centre[0];
  expect(mid).toBeGreaterThan(PLAY_TINT.centre[0]);
  expect(mid).toBeLessThan(255);
  expect(liveTint(1000 + TINT_FADE_MS).centre).toEqual([255, 0, 0]);
  setCoverTint(null, 5000, true);
  expect(liveTint(5000).centre).toEqual(PLAY_TINT.centre);
});

it('keeps the player switch per display, with a hint, and shows YouTube Music with its Open button', async () => {
  signedIn();
  mocks.set('wall2_spotify_playlists', () => []);
  const open = vi.fn();
  mocks.set('wall2_open_link', (a) => open(a));
  render(<SpotifyCard />);
  await flush();
  expect(screen.getByText('Which player the wall follows')).toBeTruthy();
  await act(async () => screen.getByRole('radio', { name: 'YouTube Music' }).click());
  expect(localStorage.getItem(LISTEN_SOURCE_KEY)).toBe('youtube');
  expect(useListenSource.getState().source).toBe('youtube');
  await act(async () => screen.getByRole('button', { name: 'Open YouTube Music' }).click());
  expect(open).toHaveBeenCalledWith({ kind: 'youtube-music' });
  expect(screen.queryByRole('searchbox')).toBeNull();
});

it('lists playlists with real covers, opens one into its songs, plays a song in its list, and goes back on Escape', async () => {
  signedIn();
  mocks.set('wall2_spotify_playlists', () => [item(1), item(2)]);
  const tracks = vi.fn((a?: Record<string, unknown>) => ({ items: [track(1), track(2), track(3, false)], total: 3, more: false, ...a }));
  mocks.set('wall2_spotify_tracks', (a) => tracks(a));
  const plays: unknown[] = [];
  mocks.set('wall2_spotify_play', (a) => void plays.push(a));
  mocks.set('get_now_playing', () => null);
  render(<SpotifyCard />);
  await flush();
  const img = document.querySelector('.sp-row img') as HTMLImageElement;
  expect(img.getAttribute('src')).toBe('data:image/png;base64,t1');
  expect(screen.getAllByText('Playlist · 20 songs')).toHaveLength(2);
  await act(async () => screen.getByRole('button', { name: 'Open List 1' }).click());
  await flush();
  expect(tracks).toHaveBeenCalledWith(expect.objectContaining({ kind: 'playlist', id: id(1), page: 0 }));
  // A song without a cover keeps a neutral tile in the header path; an unplayable one is dimmed.
  expect(document.querySelector('.sp-track.off')?.textContent).toContain('Song 3');
  await act(async () => screen.getByText('Song 2').closest('button')!.click());
  expect(plays.at(-1)).toEqual({ request: { kind: 'track', id: id(502), context: { kind: 'playlist', id: id(1) }, offsetId: id(502) } });
  expect(useLastContext.getState().ids.has(id(501))).toBe(true);
  await act(async () => screen.getByText('Song 3').closest('button')!.click());
  expect(plays).toHaveLength(1);
  await act(async () => screen.getByRole('button', { name: /Play all/ }).click());
  expect(plays.at(-1)).toEqual({ request: { kind: 'playlist', id: id(1) } });
  fireEvent.keyDown(document, { key: 'Escape' });
  await flush();
  expect(screen.getByRole('button', { name: 'Open List 2' })).toBeTruthy();
});

it('pages a long playlist as it scrolls, inside the card', async () => {
  signedIn();
  mocks.set('wall2_spotify_playlists', () => [item(1)]);
  const pages: number[] = [];
  mocks.set('wall2_spotify_tracks', (a) => {
    const page = Number(a?.page ?? 0);
    pages.push(page);
    return { items: Array.from({ length: 50 }, (_, n) => track(page * 50 + n + 1)), total: 2000, more: true };
  });
  render(<SpotifyCard />);
  await flush();
  await act(async () => screen.getByRole('button', { name: 'Open List 1' }).click());
  await flush();
  expect(screen.getByText('Playlist · 2,000 songs')).toBeTruthy();
  const list = document.querySelector('.sp-tracks') as HTMLElement;
  Object.defineProperty(list, 'scrollHeight', { value: 2000, configurable: true });
  Object.defineProperty(list, 'clientHeight', { value: 300, configurable: true });
  list.scrollTop = 1600;
  fireEvent.scroll(list);
  await flush();
  expect(pages).toEqual([0, 1]);
  expect(document.querySelectorAll('.sp-track')).toHaveLength(100);
});

it('keeps the list when Spotify is busy and says so; says to open Spotify when no device plays', async () => {
  signedIn();
  let busy = false;
  mocks.set('wall2_spotify_playlists', () => {
    if (busy) throw new Error('busy');
    return [item(1)];
  });
  mocks.set('wall2_spotify_albums', () => {
    throw new Error('busy');
  });
  mocks.set('wall2_spotify_play', () => {
    throw new Error('no device');
  });
  render(<SpotifyCard />);
  await flush();
  await act(async () => screen.getByRole('button', { name: 'Play all of List 1' }).click());
  await flush();
  expect(screen.getByText('Open Spotify on this PC first, then try again.')).toBeTruthy();
  busy = true;
  await act(async () => screen.getByRole('tab', { name: 'Albums' }).click());
  await flush();
  expect(screen.getByText('Spotify is busy, try in a minute.')).toBeTruthy();
});

it('searches after a pause of 400 ms with two letters, or on Enter', async () => {
  signedIn();
  mocks.set('wall2_spotify_playlists', () => []);
  const asked: unknown[] = [];
  mocks.set('wall2_spotify_search', (a) => {
    asked.push(a?.query);
    return { tracks: [item(7, 'track', 'Found Song')], albums: [], playlists: [] };
  });
  render(<SpotifyCard />);
  await flush();
  const box = screen.getByRole('searchbox');
  fireEvent.change(box, { target: { value: 'a' } });
  await flush(500);
  expect(asked).toEqual([]);
  fireEvent.change(box, { target: { value: 'ab' } });
  await flush(300);
  expect(asked).toEqual([]);
  await flush(150);
  expect(asked).toEqual(['ab']);
  expect(screen.getByText('Found Song')).toBeTruthy();
  expect(screen.getByText('Song · Some Artist')).toBeTruthy();
});

it('points to Tools when signed out, and says not set up when Spotify is not set up', async () => {
  useSpotifyStatus.setState({ status: { setup: true, signedIn: false, reason: null } });
  const r = render(<SpotifyCard />);
  await flush();
  await act(async () => screen.getByRole('button', { name: 'Open Tools' }).click());
  expect(useToolsStore.getState().open).toBe(true);
  r.unmount();
  useSpotifyStatus.setState({ status: { setup: false, signedIn: false, reason: 'not set up' } });
  render(<SpotifyCard />);
  await flush();
  expect(screen.getByText(/Spotify is not set up on this wall/)).toBeTruthy();
  expect(screen.getByText('not set up')).toBeTruthy();
});

it('Up next shows the next three, plays one by skipping forward, hides with YouTube Music and signed out says where to sign in', async () => {
  signedIn();
  mocks.set('wall2_spotify_queue', () => ({ current: track(1), next: [track(2), track(3), track(4), track(5)] }));
  const skips = vi.fn();
  mocks.set('media_next', skips);
  mocks.set('get_now_playing', () => null);
  const r = render(<UpNext />);
  await flush();
  expect([...document.querySelectorAll('.u-next-t')].map((e) => e.textContent)).toEqual(['Song 2', 'Song 3', 'Song 4']);
  // Song 2 has no cover: a neutral tile, never a gradient.
  expect(document.querySelectorAll('.u-next-row')[0].querySelector('img')).toBeNull();
  await act(async () => (document.querySelectorAll('.u-next-row')[1] as HTMLButtonElement).click());
  await flush();
  expect(skips).toHaveBeenCalledTimes(2);
  await act(async () => useListenSource.getState().setSource('youtube'));
  expect(document.querySelector('.u-next')).toBeNull();
  r.unmount();
  await act(async () => useListenSource.getState().setSource('spotify'));
  useSpotifyStatus.setState({ status: { setup: true, signedIn: false, reason: null } });
  render(<UpNext />);
  await flush();
  expect(screen.getByText('Sign in to Spotify in Tools to see what is next')).toBeTruthy();
});

it('Up next hides when nothing is queued', async () => {
  signedIn();
  mocks.set('wall2_spotify_queue', () => ({ current: null, next: [] }));
  render(<UpNext />);
  await flush();
  expect(document.querySelector('.u-next')).toBeNull();
});

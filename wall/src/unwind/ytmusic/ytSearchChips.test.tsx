import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import type { YoutubeStatus, YtPage, YtPlaylist, YtPlaylistSearch, YtVideo } from '../../music/youtube';
import { resetTools } from '../../tools/store';
import { hideTip } from '../../ui/HoverTip';
import { resetSpotifyStatus } from '../spotify/status';
import { resetListenSource } from '../spotify/model';
import { resetYoutubeStatus, useYoutubeStatus } from './status';
import { resetLibrary } from './store';
import { YtMusicSide } from './YtMusicSide';

vi.setConfig({ testTimeout: 20_000 });

const THUMB = (n: number) => `https://i.ytimg.com/vi/${String(n).padStart(11, 'a')}/mqdefault.jpg`;
const playlist = (n: number, count = 41): YtPlaylist => ({ id: `PLtest${n}`, title: `Mix ${n}`, count, thumb: THUMB(n) });
const hit = (n: number): YtPlaylist => ({ id: `PLhit${n}`, title: `Found list ${n}`, count: 7, thumb: THUMB(n) });
const video = (n: number): YtVideo => ({ id: String(n).padStart(11, 'v'), title: `Clip ${n}`, channel: `Channel ${n}`, seconds: 200 + n, thumb: THUMB(n), playable: 'yes' });
const page = <T,>(items: T[]): YtPage<T> => ({ items, next: null });
const signedIn = (searchesLeft: number | null = 100): YoutubeStatus => ({ setup: true, signedIn: true, reason: null, searchesLeft });

function setup(playlistSearch: (q: string) => YtPlaylistSearch | Promise<YtPlaylistSearch> = () => ({ playlists: [hit(1), hit(2)], searchesLeft: 17 })) {
  const calls = { search: [] as unknown[], playlistSearch: [] as unknown[] };
  mocks.set('wall2_youtube_status', () => signedIn());
  mocks.set('wall2_youtube_playlists', () => page([playlist(1), playlist(2)]));
  mocks.set('wall2_youtube_liked', () => page([video(11)]));
  mocks.set('wall2_youtube_items', () => page([video(31)]));
  mocks.set('wall2_youtube_search', (a) => { calls.search.push(a); return page([video(21), video(22)]); });
  mocks.set('wall2_youtube_search_playlists', (a) => { calls.playlistSearch.push(a); return playlistSearch(String(a?.query)); });
  return calls;
}

beforeEach(() => {
  resetListenSource();
  resetSpotifyStatus();
  resetYoutubeStatus();
  resetTools();
  resetLibrary();
});
afterEach(() => {
  cleanup();
  hideTip(true);
  mocks.clear();
});

const open = async (opts?: Parameters<typeof setup>[0]) => {
  const calls = setup(opts);
  render(<YtMusicSide tall={false} remote={<div />} />);
  await screen.findByText('Mix 1');
  return calls;
};
const search = async (words: string) => {
  const field = screen.getByPlaceholderText('Search YouTube Music');
  fireEvent.change(field, { target: { value: words } });
  fireEvent.keyDown(field, { key: 'Enter' });
  await screen.findByText('Clip 21');
};
const chip = (name: RegExp) => screen.getByRole('radio', { name });

describe('YouTube search: playlists only when asked', () => {
  it('a search shows songs under All and never asks for playlists', async () => {
    const calls = await open();
    await search('night');
    expect(calls.search).toEqual([{ query: 'night' }]);
    expect(calls.playlistSearch).toHaveLength(0);
    expect(chip(/^All/).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(chip(/^Songs/));
    fireEvent.click(chip(/^All/));
    expect(calls.playlistSearch).toHaveLength(0);
  });

  it('the Playlists chip asks once, shows the loading line, then the cover grid with its count', async () => {
    let release: (v: YtPlaylistSearch) => void = () => {};
    const calls = await open(() => new Promise<YtPlaylistSearch>((r) => { release = r; }));
    await search('night');
    fireEvent.click(chip(/^Playlists/));
    expect(await screen.findByText('Looking for playlists')).toBeTruthy();
    release({ playlists: [hit(1), hit(2)], searchesLeft: 17 });
    await screen.findByText('Found list 1');
    expect(calls.playlistSearch).toEqual([{ query: 'night' }]);
    expect(chip(/^Playlists/).textContent).toBe('Playlists2');
    expect(document.querySelectorAll('.yt-tile').length).toBe(2);
    expect(await screen.findByText('17 searches left today')).toBeTruthy();
  });

  it('a repeat click makes no call, and neither does coming back to the chip', async () => {
    const calls = await open();
    await search('night');
    fireEvent.click(chip(/^Playlists/));
    await screen.findByText('Found list 1');
    fireEvent.click(chip(/^Songs/));
    fireEvent.click(chip(/^Playlists/));
    fireEvent.click(chip(/^Playlists/));
    await screen.findByText('Found list 2');
    expect(calls.playlistSearch).toHaveLength(1);
  });

  it('new words need a new click, and the same words typed again keep the answer held', async () => {
    const calls = await open();
    await search('night');
    fireEvent.click(chip(/^Playlists/));
    await screen.findByText('Found list 1');
    await search('day');
    expect(chip(/^All/).getAttribute('aria-checked')).toBe('true');
    expect(calls.playlistSearch).toHaveLength(1);
    fireEvent.click(chip(/^Playlists/));
    await waitFor(() => expect(calls.playlistSearch).toHaveLength(2));
    await search('night');
    fireEvent.click(chip(/^Playlists/));
    await screen.findByText('Found list 1');
    expect(calls.playlistSearch).toHaveLength(2);
  });

  it('a failed playlist search says so and Retry asks again', async () => {
    let n = 0;
    const calls = await open(() => { n += 1; if (n === 1) throw new Error('busy'); return { playlists: [hit(1)], searchesLeft: 9 }; });
    await search('night');
    fireEvent.click(chip(/^Playlists/));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await screen.findByText('Found list 1');
    expect(calls.playlistSearch).toHaveLength(2);
  });

  it('a click on a found playlist opens its videos through the existing item read', async () => {
    const calls = await open();
    await search('night');
    fireEvent.click(chip(/^Playlists/));
    const tileBtn = (await screen.findByText('Found list 1')).closest('button') as HTMLButtonElement;
    fireEvent.click(tileBtn);
    await screen.findByText('Clip 31');
    expect(useYoutubeStatus.getState().status?.searchesLeft).toBe(17);
    expect(calls.playlistSearch).toHaveLength(1);
  });
});

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { resetNowPlaying } from '../../music/store';
import type { YoutubeStatus, YtDetail, YtPage, YtPlayed, YtPlaylist } from '../../music/youtube';
import { usePlaceStore } from '../../state/places';
import { HoverTipLayer, hideTip } from '../../ui/HoverTip';
import { resetLastPlayed } from '../lastPlayed';
import { resetListenSource } from '../spotify/model';
import { resetSpotifyStatus } from '../spotify/status';
import { playerLink } from '../watch/PlayerFrame';
import { resetWatch, useWatchStore } from '../watch/store';
import { MOODS, SHELF } from './ForYou';
import { FIRST, loadForYou, useForYou, whenWords } from './forYou';
import { resetQueue, useYtQueue } from './queue';
import { resetYoutubeStatus } from './status';
import { resetLibrary } from './store';
import { YtMusicSide } from './YtMusicSide';

vi.setConfig({ testTimeout: 20_000 });

const NOW = new Date('2026-11-14T22:30:00-08:00');
const id = (n: number) => `vid${String(n).padStart(8, '0')}`;
const signedIn: YoutubeStatus = { setup: true, signedIn: true, reason: null, searchesLeft: 100 };
const page = <T,>(items: T[]): YtPage<T> => ({ items, next: null });
const playlist = (n: number): YtPlaylist => ({ id: `PLtest${n}`, title: `Mix ${n}`, count: 6, thumb: null });
const nowS = () => Math.floor(NOW.getTime() / 1000);
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const noted: string[] = [];
const asked: string[][] = [];

/** `count` plays, newest first, a day apart; `gone` ids have no details (YouTube no longer answers for them). */
function serve(count: number, gone: number[] = []) {
  const record: YtPlayed[] = Array.from({ length: count }, (_, i) => ({ id: id(i), at: nowS() - i * 86400 }));
  mocks.set('wall2_youtube_status', () => signedIn);
  mocks.set('wall2_youtube_playlists', () => page([playlist(1)]));
  mocks.set('wall2_youtube_liked', () => page([]));
  mocks.set('wall2_youtube_played', () => record);
  mocks.set('wall2_youtube_videos', (args) => {
    const ids = (args?.ids as string[]) ?? [];
    asked.push(ids);
    return ids.filter((x) => !gone.some((g) => id(g) === x)).map((x): YtDetail => ({ id: x, title: `Played ${Number(x.slice(3))}`, channel: 'Some Channel', seconds: 200 }));
  });
  mocks.set('wall2_youtube_note_play', (args) => void noted.push(args?.id as string));
}

async function openForYou() {
  render(
    <>
      <YtMusicSide tall={false} remote={null} />
      <HoverTipLayer />
    </>,
  );
  await flush(10);
  fireEvent.click(screen.getByRole('tab', { name: 'For you' }));
  await flush(10);
  await flush(10);
}
const tiles = () => [...document.querySelectorAll<HTMLButtonElement>('.yt-foryou .yt-tile')];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  localStorage.clear();
  noted.length = 0;
  asked.length = 0;
  resetWatch();
  resetQueue();
  resetLibrary();
  resetListenSource();
  resetSpotifyStatus();
  resetYoutubeStatus();
  usePlaceStore.setState({ active: 'unwind', from: 'work' });
  playerLink.send = () => true;
  mocks.set('get_now_playing', () => null);
});
afterEach(() => {
  cleanup();
  hideTip(true);
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
  resetQueue();
  resetLibrary();
  localStorage.clear();
});

describe('the For you tab', () => {
  it('is the first tab, then Playlists and Liked, and shows the eight mood chips', async () => {
    serve(6);
    await openForYou();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['For you', 'Playlists', 'Liked']);
    expect(screen.getByRole('tab', { name: 'For you' }).getAttribute('aria-selected')).toBe('true');
    expect([...document.querySelectorAll('.yt-chip')].map((c) => c.textContent)).toEqual([...MOODS]);
    expect(MOODS).toHaveLength(8);
  });

  it('shows the Back to shelf: four tiles with their words for when, and See all', async () => {
    serve(6);
    await openForYou();
    expect(screen.getByText('Back to')).toBeTruthy();
    expect(screen.getByText('what the wall played')).toBeTruthy();
    expect(tiles().map((t) => t.querySelector('.sp-tname2')?.textContent)).toEqual(['Played 0', 'Played 1', 'Played 2', 'Played 3']);
    expect(tiles().map((t) => t.querySelector('.yt-count')?.textContent)).toEqual(['Today', 'Yesterday', '2 days ago', '3 days ago']);
    expect(tiles()).toHaveLength(SHELF);
    expect(screen.getByRole('button', { name: /See all/ })).toBeTruthy();
    // One details call for the newest videos: titles come from there, nothing is stored by the page.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual(Array.from({ length: 6 }, (_, i) => id(i)));
  });

  it('See all shows every video of the record, and Back to the shelf returns to four', async () => {
    serve(30);
    await openForYou();
    expect(asked[0]).toHaveLength(FIRST);
    fireEvent.click(screen.getByRole('button', { name: /See all/ }));
    await flush(10);
    await flush(10);
    expect(tiles()).toHaveLength(30);
    expect(asked.flat()).toHaveLength(30);
    fireEvent.click(screen.getByRole('button', { name: 'Back to the shelf' }));
    expect(tiles()).toHaveLength(SHELF);
  });

  it('has no See all when four or fewer were played, leaves out a video YouTube no longer answers for, and says so when nothing was played', async () => {
    serve(4);
    await openForYou();
    expect(tiles()).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /See all/ })).toBeNull();
    cleanup();
    resetLibrary();
    serve(5, [1]);
    await openForYou();
    expect(tiles().map((t) => t.querySelector('.sp-tname2')?.textContent)).toEqual(['Played 0', 'Played 2', 'Played 3', 'Played 4']);
    cleanup();
    resetLibrary();
    serve(0);
    await openForYou();
    expect(tiles()).toHaveLength(0);
    expect(screen.getByText(/Nothing played here yet/)).toBeTruthy();
    expect(asked).toHaveLength(2);
  });

  it('a tile plays that video on the wall and the ones after it; the play goes in the record once', async () => {
    serve(6);
    await openForYou();
    fireEvent.click(tiles()[1]!);
    await flush(10);
    expect(useWatchStore.getState().playing?.id).toBe(id(1));
    expect(useYtQueue.getState().from).toEqual({ list: 'played' });
    expect(useYtQueue.getState().entries.map((e) => e.id)).toEqual(Array.from({ length: 6 }, (_, i) => id(i)));
    expect(noted).toEqual([id(1)]);
  });

  it('a failed read shows the line with Retry, and a repeat inside a minute is not read again', async () => {
    serve(6);
    let fail = true;
    mocks.set('wall2_youtube_played', () => {
      if (fail) throw new Error('down');
      return [{ id: id(0), at: nowS() }];
    });
    await openForYou();
    expect(screen.getByText('YouTube is not answering.')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await flush(10);
    await flush(10);
    expect(tiles()).toHaveLength(1);
    const calls = vi.fn();
    mocks.set('wall2_youtube_played', () => void calls());
    await act(async () => void (await loadForYou()));
    expect(calls).not.toHaveBeenCalled();
    expect(useForYou.getState().rows).toHaveLength(1);
  });
});

describe('the play record', () => {
  it('is written only for a video the wall started: each load of a queue entry notes its id', async () => {
    serve(3);
    await openForYou();
    fireEvent.click(tiles()[0]!);
    await flush(10);
    expect(noted).toEqual([id(0)]);
    // A pin or a Watch play is not the music queue: nothing is noted for it.
    act(() => {
      useWatchStore.getState().playMusic('Ab3dEfGh1jK', 'x');
    });
    expect(noted).toEqual([id(0)]);
  });

  it('whenWords reads days back: Today, Yesterday, N days ago, Last week, N weeks ago, Last month', () => {
    const at = (days: number) => nowS() - days * 86400 - 60;
    const now = NOW.getTime();
    expect([0, 1, 2, 6, 7, 13, 14, 21, 29, 30].map((d) => whenWords(at(d), now))).toEqual(['Today', 'Yesterday', '2 days ago', '6 days ago', 'Last week', 'Last week', '2 weeks ago', '3 weeks ago', '4 weeks ago', 'Last month']);
    expect(whenWords(undefined, now)).toBe('');
  });
});

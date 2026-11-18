import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { type YoutubeStatus, type YtPage, type YtPlayable, type YtPlaylist, type YtVideo } from '../../music/youtube';
import { HoverTipLayer, hideTip, resetTip } from '../../ui/HoverTip';
import { resetListenSource } from '../spotify/model';
import { resetSpotifyStatus } from '../spotify/status';
import { closeLibraryMenu, useLibraryMenu } from '../watch/libraryMenuModel';
import { LibraryMenuLayer } from '../watch/LibraryMenu';
import { resetPins, usePins } from '../watch/pins';
import { resetWatch, useWatchStore } from '../watch/store';
import { resetQueue } from './queue';
import { resetYoutubeStatus } from './status';
import { closePlaylist, openPlaylist, resetLibrary, useYtLibrary } from './store';
import { YtMusicSide } from './YtMusicSide';

vi.setConfig({ testTimeout: 20_000 });

const THUMB = (n: number) => `https://i.ytimg.com/vi/${String(n).padStart(11, 'a')}/mqdefault.jpg`;
const playlist = (n: number): YtPlaylist => ({ id: `PLtestlist${String(n).padStart(4, '0')}`, title: `Mix ${n}`, count: 6, thumb: THUMB(n) });
const video = (n: number, playable: YtPlayable = 'yes', seconds = 200 + n): YtVideo => ({ id: String(n).padStart(11, 'v'), title: `Clip ${n}`, channel: `Channel ${n}`, seconds, thumb: THUMB(n), playable });
const page = <T,>(items: T[], next: string | null = null): YtPage<T> => ({ items, next });
const signedIn: YoutubeStatus = { setup: true, signedIn: true, reason: null, searchesLeft: 100 };
const SONGS = [video(1), video(2, 'embed'), video(3), video(0, 'removed', 0)];

let reads: (() => Promise<YtPage<YtVideo>>) | null = null;
function serve() {
  mocks.set('wall2_youtube_status', () => signedIn);
  mocks.set('wall2_youtube_playlists', () => page([playlist(1), playlist(2)]));
  mocks.set('wall2_youtube_items', () => (reads ? reads() : page(SONGS)));
  mocks.set('wall2_youtube_liked', () => page([]));
  mocks.set('wall2_youtube_search', () => page([]));
  mocks.set('wall2_youtube_videos', () => []);
  mocks.set('get_now_playing', () => null);
}
const side = () =>
  render(
    <div className="sp-card yt">
      <YtMusicSide tall={false} remote={null} />
      <LibraryMenuLayer />
      <HoverTipLayer />
    </div>,
  );
const tile = (name: string) => screen.getByText(name).closest('button') as HTMLButtonElement;
const row = (title: string) => screen.getByText(title, { selector: '.yt-title' }).closest('.yt-row') as HTMLElement;
const playBtn = (title: string) => row(title).querySelector('.yt-play') as HTMLButtonElement;
const libMenu = () => document.querySelector('.u-lib-menu') as HTMLElement | null;
const item = (name: string) => within(libMenu()!).getByRole('menuitem', { name });
const nowId = () => useWatchStore.getState().playing?.id ?? null;
const pending = () => useYtLibrary.getState().pendingStart;
const shut = () => act(() => closeLibraryMenu());
const mounted = async () => {
  serve();
  side();
  await screen.findByText('Mix 1');
};
const deferred = () => {
  let release!: (v: YtPage<YtVideo>) => void;
  let fail!: (e: unknown) => void;
  const p = new Promise<YtPage<YtVideo>>((res, rej) => {
    release = res;
    fail = rej;
  });
  return { p, release, fail };
};

beforeEach(() => {
  localStorage.clear();
  reads = null;
  resetListenSource();
  resetSpotifyStatus();
  resetYoutubeStatus();
  resetLibrary();
  resetQueue();
  resetWatch();
  resetPins();
  closeLibraryMenu();
});
afterEach(() => {
  cleanup();
  closeLibraryMenu();
  hideTip(true);
  resetTip();
  mocks.clear();
  localStorage.clear();
});

describe('the tile menu starts a playlist when its first page arrives', () => {
  const startFromMenu = async (word: string) => {
    fireEvent.contextMenu(tile('Mix 1'), { clientX: 30, clientY: 30 });
    expect(within(libMenu()!).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Play', 'Shuffle', 'Videos', 'Pin to the left']);
    fireEvent.click(item(word));
  };

  it('runs once, on the first page, and not again when the store changes later', async () => {
    await mounted();
    const d = deferred();
    reads = () => d.p;
    await startFromMenu('Play');
    expect(pending()).toEqual({ id: playlist(1).id, shuffled: false });
    expect(nowId()).toBeNull();
    await act(async () => d.release(page(SONGS)));
    await waitFor(() => expect(nowId()).toBe(video(1).id));
    expect(pending()).toBeNull();
    // Another video is chosen by hand; a later store change must not start the playlist again.
    fireEvent.click(playBtn('Clip 3'));
    await waitFor(() => expect(nowId()).toBe(video(3).id));
    act(() => useYtLibrary.setState({ tab: 'liked' }));
    act(() => useYtLibrary.setState({ tab: 'playlists' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(nowId()).toBe(video(3).id);
  });

  it('Shuffle asks for a shuffled start', async () => {
    await mounted();
    const d = deferred();
    reads = () => d.p;
    await startFromMenu('Shuffle');
    expect(pending()).toEqual({ id: playlist(1).id, shuffled: true });
    await act(async () => d.release(page(SONGS)));
    await waitFor(() => expect(pending()).toBeNull());
    expect(nowId()).not.toBeNull();
  });

  it('is cleared when the playlist closes, and nothing plays when the page arrives', async () => {
    await mounted();
    const d = deferred();
    reads = () => d.p;
    await startFromMenu('Play');
    act(() => closePlaylist());
    expect(pending()).toBeNull();
    await act(async () => d.release(page(SONGS)));
    expect(nowId()).toBeNull();
  });

  it('is cleared when another playlist opens, and only the new one plays', async () => {
    await mounted();
    const d = deferred();
    reads = () => d.p;
    await startFromMenu('Play');
    act(() => openPlaylist(playlist(2)));
    expect(pending()).toBeNull();
    await act(async () => d.release(page(SONGS)));
    expect(nowId()).toBeNull();
  });

  it('is cleared when the first page fails, and the view shows its own line', async () => {
    await mounted();
    const d = deferred();
    reads = () => d.p;
    await startFromMenu('Play');
    await act(async () => d.fail(new Error('read failed')));
    await waitFor(() => expect(pending()).toBeNull());
    expect(nowId()).toBeNull();
    expect(useYtLibrary.getState().songs.problem).not.toBeNull();
  });

  it('plays nothing when no video on the first page can play outside YouTube', async () => {
    await mounted();
    reads = async () => page([video(2, 'embed'), video(0, 'removed', 0)]);
    await startFromMenu('Play');
    await waitFor(() => expect(pending()).toBeNull());
    expect(nowId()).toBeNull();
  });
});

describe('the row menu', () => {
  const opened = async () => {
    await mounted();
    fireEvent.click(tile('Mix 1'));
    await screen.findByText('Clip 1');
  };

  it('lists Play, Add to a playlist, Open in YouTube, then Pin to the left, and Play runs once', async () => {
    await opened();
    fireEvent.contextMenu(playBtn('Clip 1'), { clientX: 40, clientY: 40 });
    expect(within(libMenu()!).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Play', 'Add to a playlist', 'Open in YouTube', 'Pin to the left']);
    fireEvent.click(item('Play'));
    expect(nowId()).toBe(video(1).id);
    expect(libMenu()).toBeNull();
  });

  it('opens on the ContextMenu key and Shift+F10, and never on a greyed row', async () => {
    await opened();
    fireEvent.keyDown(playBtn('Clip 1'), { key: 'ContextMenu' });
    expect(libMenu()).not.toBeNull();
    shut();
    fireEvent.keyDown(playBtn('Clip 3'), { key: 'F10', shiftKey: true });
    expect(libMenu()).not.toBeNull();
    shut();
    // Clip 2 only plays on YouTube: no button, no handler.
    fireEvent.contextMenu(row('Clip 2'));
    fireEvent.contextMenu(row('Clip 2').querySelector('.yt-cells') as HTMLElement);
    expect(libMenu()).toBeNull();
  });

  it('Add to a playlist hands over to the row add menu and closes the library menu', async () => {
    await opened();
    fireEvent.contextMenu(playBtn('Clip 1'), { clientX: 40, clientY: 40 });
    fireEvent.click(item('Add to a playlist'));
    expect(libMenu()).toBeNull();
    expect(screen.getByRole('menu', { name: 'Add this video to a playlist' })).toBeTruthy();
  });

  it('Open in YouTube asks the wall to open the video, and says so when it fails', async () => {
    const seen: unknown[] = [];
    mocks.set('wall2_watch_open', (a) => void seen.push(a));
    await opened();
    fireEvent.contextMenu(playBtn('Clip 1'), { clientX: 40, clientY: 40 });
    fireEvent.click(item('Open in YouTube'));
    await waitFor(() => expect(seen).toEqual([{ kind: 'video', id: video(1).id }]));
    mocks.set('wall2_watch_open', () => {
      throw new Error('no browser');
    });
    fireEvent.contextMenu(playBtn('Clip 3'), { clientX: 40, clientY: 40 });
    fireEvent.click(item('Open in YouTube'));
    await waitFor(() => expect(libMenu()).toBeNull());
    fireEvent.mouseEnter(row('Clip 3'));
    await waitFor(() => expect(screen.queryByText('Could not open the browser')).not.toBeNull(), { timeout: 3000 });
  });

  it('a row with no length pins as a video, never a live stream, so one key per video', async () => {
    reads = async () => page([video(1), video(7, 'yes', 0)]);
    await opened();
    fireEvent.contextMenu(playBtn('Clip 7'), { clientX: 40, clientY: 40 });
    expect(useLibraryMenu.getState().open?.entry.kind).toBe('video');
    shut();
    fireEvent.contextMenu(playBtn('Clip 1'), { clientX: 40, clientY: 40 });
    expect(useLibraryMenu.getState().open?.entry.kind).toBe('video');
  });

  it('Escape closes only the chooser, and the next Escape closes the playlist', async () => {
    await opened();
    fireEvent.contextMenu(playBtn('Clip 1'), { clientX: 40, clientY: 40 });
    fireEvent.click(item('Pin to the left'));
    expect(screen.getByText(/in place of/)).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(libMenu()).toBeNull();
    expect(useYtLibrary.getState().opened).not.toBeNull();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(useYtLibrary.getState().opened).toBeNull();
  });

  it('a library menu opened from the keyboard closes an open add menu', async () => {
    await opened();
    fireEvent.click(row('Clip 1').querySelector('.yt-add') as HTMLButtonElement);
    expect(screen.getByRole('menu', { name: 'Add this video to a playlist' })).toBeTruthy();
    fireEvent.keyDown(playBtn('Clip 3'), { key: 'ContextMenu' });
    expect(screen.queryByRole('menu', { name: 'Add this video to a playlist' })).toBeNull();
    expect(libMenu()).not.toBeNull();
  });
});

describe('pins follow the library', () => {
  it('a renamed playlist updates its pin when the list loads', async () => {
    usePins.setState({ places: [{ kind: 'playlist', id: playlist(1).id, name: 'Old name', art: undefined }, null, null] });
    await mounted();
    await waitFor(() => expect((usePins.getState().places[0] as { name: string }).name).toBe('Mix 1'));
    expect((usePins.getState().places[0] as { art?: string }).art).toBe(THUMB(1));
  });
});

describe('a pending start does not outlive the screen', () => {
  it('Play while pending, unmount, the page arrives, remount: nothing starts', async () => {
    serve();
    const first = side();
    await screen.findByText('Mix 1');
    const d = deferred();
    reads = () => d.p;
    fireEvent.contextMenu(tile('Mix 1'), { clientX: 30, clientY: 30 });
    fireEvent.click(item('Play'));
    expect(pending()).not.toBeNull();
    first.unmount();
    expect(pending()).toBeNull();
    await act(async () => d.release(page(SONGS)));
    reads = null;
    side();
    await new Promise((r) => setTimeout(r, 100));
    expect(nowId()).toBeNull();
  });
});

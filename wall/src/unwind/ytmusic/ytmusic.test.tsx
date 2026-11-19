import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { youtube, type YoutubeStatus, type YtPage, type YtPlayable, type YtPlaylist, type YtVideo } from '../../music/youtube';
import { resetTools, useToolsStore } from '../../tools/store';
import { hideTip, HoverTipLayer } from '../../ui/HoverTip';
import { resetListenSource, useListenSource } from '../spotify/model';
import { SpotifyCard } from '../spotify/SpotifyCard';
import { resetSpotifyStatus } from '../spotify/status';
import { hintFor, lengthText, mergePage, rowWords, safeThumb, searchesLine, searchSpent, searchWords, sideMode, videosLine, ytProblem, MAX_PAGES } from './model';
import { resetYoutubeStatus, useYoutubeStatus } from './status';
import { loadList, resetLibrary, runSearch, useYtLibrary } from './store';
import { useWatchStore } from '../watch/store';
import { YT_STATUS_POLL_MS } from './status';
import { YtMusicSide } from './YtMusicSide';

vi.setConfig({ testTimeout: 20_000 });

const THUMB = (n: number) => `https://i.ytimg.com/vi/${String(n).padStart(11, 'a')}/mqdefault.jpg`;
const playlist = (n: number, count = 41): YtPlaylist => ({ id: `PLtest${n}`, title: `Mix ${n}`, count, thumb: THUMB(n) });
const video = (n: number, playable: YtPlayable = 'yes', seconds = 200 + n): YtVideo => ({ id: String(n).padStart(11, 'v'), title: `Clip ${n}`, channel: `Channel ${n}`, seconds, thumb: THUMB(n), playable });
const page = <T,>(items: T[], next: string | null = null): YtPage<T> => ({ items, next });
const signedIn = (searchesLeft: number | null = 100): YoutubeStatus => ({ setup: true, signedIn: true, reason: null, searchesLeft });

interface Calls { playlists: unknown[]; items: unknown[]; liked: unknown[]; search: unknown[]; status: number }
function setup(opts: { status?: YoutubeStatus | (() => YoutubeStatus); playlists?: () => YtPage<YtPlaylist> | Promise<YtPage<YtPlaylist>>; items?: (a: Record<string, unknown>) => YtPage<YtVideo> | Promise<YtPage<YtVideo>>; liked?: () => YtPage<YtVideo>; search?: (q: string) => YtPage<YtVideo> } = {}): Calls {
  const calls: Calls = { playlists: [], items: [], liked: [], search: [], status: 0 };
  mocks.set('wall2_youtube_status', () => {
    calls.status += 1;
    const s = opts.status ?? signedIn();
    return typeof s === 'function' ? s() : s;
  });
  mocks.set('wall2_youtube_playlists', (a) => { calls.playlists.push(a); return opts.playlists ? opts.playlists() : page([playlist(1), playlist(2, 1), playlist(3)]); });
  mocks.set('wall2_youtube_items', (a) => { calls.items.push(a); return opts.items ? opts.items(a ?? {}) : page([video(1), video(2, 'embed'), video(3, 'region'), video(4, 'private', 0), video(5, 'removed', 0), video(6)]); });
  mocks.set('wall2_youtube_liked', (a) => { calls.liked.push(a); return opts.liked ? opts.liked() : page([video(11), video(12)]); });
  mocks.set('wall2_youtube_search', (a) => { calls.search.push(a); return opts.search ? opts.search(String(a?.query)) : page([video(21), video(22)]); });
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
  hideTip(true);
  mocks.clear();
});

const side = (tall = false) => render(<YtMusicSide tall={tall} remote={<div data-testid="remote">remote</div>} />);
const library = async (tall = false, opts?: Parameters<typeof setup>[0]) => {
  const calls = setup(opts);
  const r = side(tall);
  await screen.findByText('Mix 1');
  return { calls, r };
};
const tile = (name: string) => screen.getByText(name).closest('button') as HTMLButtonElement;

let calls0 = 0;
beforeEach(() => { calls0 = 0; });

describe('model', () => {
  it('maps the bridge words to problems and lines', () => {
    expect(ytProblem(new Error('not set up'))).toBe('notsetup');
    expect(ytProblem('sign in again')).toBe('needsSignIn');
    expect(ytProblem('setup broken')).toBe('broken');
    expect(ytProblem('busy')).toBe('busy');
    expect(ytProblem('quota')).toBe('quota');
    expect(ytProblem('quota-all')).toBe('quotaAll');
    expect(ytProblem('not found')).toBe('gone');
    expect(ytProblem('invalid')).toBe('invalid');
    expect(ytProblem('down')).toBe('down');
    expect(ytProblem(42)).toBe('down');
    expect(ytProblem(new Error('something unexpected'))).toBe('down');
  });

  it('words each kind of row, the counts and the lengths', () => {
    expect(rowWords('yes')).toBeNull();
    expect(rowWords('embed')).toBe('Only on YouTube');
    expect(rowWords('region')).toBe('Only on YouTube');
    expect(rowWords('private')).toBe('Private');
    expect(rowWords('removed')).toBe('Removed');
    expect(videosLine(41)).toBe('41 videos');
    expect(videosLine(1)).toBe('1 video');
    expect(videosLine(2000)).toBe('2,000 videos');
    expect(videosLine(Number.NaN)).toBe('0 videos');
    expect(lengthText(214)).toBe('3:34');
    expect(lengthText(3723)).toBe('1:02:03');
    expect(lengthText(0)).toBe('');
    expect(searchesLine(12)).toBe('12 searches left today');
    expect(searchesLine(1)).toBe('1 search left today');
    expect(searchesLine(19)).toBe('19 searches left today');
    expect(searchesLine(20)).toBeNull();
    expect(searchesLine(0)).toBeNull();
    expect(searchesLine(null)).toBeNull();
    expect(searchSpent(0, false)).toBe(true);
    expect(searchSpent(5, true)).toBe(true);
    expect(searchSpent(5, false)).toBe(false);
    expect(searchSpent(null, false)).toBe(false);
  });

  it('merges a page without repeating a video', () => {
    const merged = mergePage([video(1), video(2)], [video(2), video(3)]);
    expect(merged.map((v) => v.id)).toEqual([video(1).id, video(2).id, video(3).id]);
    expect(mergePage([], [])).toEqual([]);
    expect(mergePage([], [video(1), video(1), video(2)]).map((v) => v.id)).toEqual([video(1).id, video(2).id]);
  });

  it('draws only pictures from YouTube’s picture host (and the mocks’ own motif in a development build)', () => {
    expect(safeThumb(THUMB(1))).toBe(THUMB(1));
    expect(safeThumb('data:image/svg+xml,%3Csvg%3E')).not.toBeNull();
    for (const bad of ['http://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg', 'https://evil.example/vi/x.jpg', 'https://i.ytimg.com.evil.example/vi/x', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://i.ytimg.com/other', '', null, undefined]) {
      expect(safeThumb(bad as string | null | undefined)).toBeNull();
    }
  });

  it('checks the search words as Rust does', () => {
    expect(searchWords('  night drive ')).toBe('night drive');
    expect(searchWords('')).toBeNull();
    expect(searchWords('   ')).toBeNull();
    expect(searchWords('a\nb')).toBeNull();
    expect(searchWords('a‮b')).toBeNull();
    expect(searchWords('x'.repeat(100))).not.toBeNull();
    expect(searchWords('x'.repeat(101))).toBeNull();
  });

  it('picks what the side shows for each status', () => {
    const s = (setupOk: boolean, signed: boolean, reason: string | null): YoutubeStatus => ({ setup: setupOk, signedIn: signed, reason, searchesLeft: null });
    expect(sideMode(null, false)).toBe('checking');
    expect(sideMode(null, true)).toBe('unreadable');
    expect(sideMode(s(false, false, 'not set up'), false)).toBe('notsetup');
    expect(sideMode(s(true, false, null), false)).toBe('nosignin');
    expect(sideMode(s(true, false, 'sign in again'), false)).toBe('again');
    expect(sideMode(s(true, true, 'setup broken'), false)).toBe('broken');
    expect(sideMode(s(true, false, 'setup broken'), false)).toBe('broken');
    expect(sideMode(s(false, true, 'setup missing'), false)).toBe('notsetup');
    expect(sideMode(s(true, true, null), false)).toBe('library');
    expect(hintFor('library')).toBeNull();
    expect(hintFor('checking')).toBeNull();
  });
});

describe('bridge', () => {
  it('refuses a bad playlist id or page token before calling', async () => {
    const calls = setup();
    for (const bad of ['', 'a', 'bad id', 'x&y', 'x/y', 'p'.repeat(65)]) await expect(youtube.items(bad)).rejects.toThrow('invalid');
    for (const bad of ['', 'a&b', 'a b', 't'.repeat(129)]) {
      await expect(youtube.playlists(bad)).rejects.toThrow('invalid');
      await expect(youtube.liked(bad)).rejects.toThrow('invalid');
      await expect(youtube.items('PLok', bad)).rejects.toThrow('invalid');
    }
    expect(calls.playlists.length + calls.items.length + calls.liked.length).toBe(0);
    await youtube.items('PLok', 'tok_1', true);
    await youtube.playlists();
    expect(calls.items).toEqual([{ playlistId: 'PLok', pageToken: 'tok_1', fresh: true }]);
    expect(calls.playlists).toEqual([{ pageToken: null, fresh: false }]);
  });
});

describe('the side', () => {
  const lineFor = async (status: YoutubeStatus | null, text: string, button: string, failing = false) => {
    if (failing) mocks.set('wall2_youtube_status', () => { throw new Error('failed'); });
    else setup({ status: status as YoutubeStatus });
    side();
    await screen.findByText(text);
    expect(screen.getByTestId('remote')).toBeTruthy();
    expect(screen.queryByText('Search YouTube Music')).toBeNull();
    return screen.getByRole('button', { name: button });
  };

  it('keeps the remote and says what to do while not set up', async () => {
    const b = await lineFor({ setup: false, signedIn: false, reason: 'not set up', searchesLeft: null }, 'Set up YouTube in Tools to see your playlists here. About ten minutes, once.', 'Open Tools');
    fireEvent.click(b);
    expect(useToolsStore.getState().open).toBe(true);
  });

  it('says to sign in when signed out, and again when the sign-in died', async () => {
    await lineFor({ setup: true, signedIn: false, reason: null, searchesLeft: null }, 'Sign in to YouTube in Tools to see your playlists here.', 'Open Tools');
  });

  it('says so for a new sign-in, a refused setup and a status that cannot be read', async () => {
    setup({ status: { setup: true, signedIn: false, reason: 'sign in again', searchesLeft: null } });
    const r1 = side();
    await screen.findByText('YouTube needs a new sign-in.');
    r1.unmount();
    resetYoutubeStatus();
    setup({ status: { setup: true, signedIn: true, reason: 'setup broken', searchesLeft: null } });
    const r2 = side();
    await screen.findByText('YouTube refused this setup. Tools says what to do.');
    r2.unmount();
    resetYoutubeStatus();
    mocks.set('wall2_youtube_status', () => { throw new Error('failed'); });
    side();
    await screen.findByText('Could not check YouTube.');
    let n = 0;
    mocks.set('wall2_youtube_status', () => { n += 1; throw new Error('failed'); });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(n).toBe(1));
  });

  it('shows the remote alone until the first status answers', () => {
    mocks.set('wall2_youtube_status', () => new Promise(() => undefined));
    side();
    expect(screen.getByTestId('remote')).toBeTruthy();
    expect(document.querySelector('.yt-hint')).toBeNull();
  });

  it('reads the status again when the Tools drawer closes', async () => {
    const calls = setup();
    side();
    await screen.findByText('Mix 1');
    const before = calls.status;
    act(() => useToolsStore.getState().openDrawer('accounts'));
    expect(calls.status).toBe(before);
    act(() => useToolsStore.getState().close());
    await waitFor(() => expect(calls.status).toBe(before + 1));
  });

  it('empties the library when the status stops being signed in', async () => {
    await library();
    expect(useYtLibrary.getState().playlists.items.length).toBe(3);
    act(() => useYoutubeStatus.setState({ status: { setup: true, signedIn: false, reason: null, searchesLeft: null } }));
    await screen.findByText('Sign in to YouTube in Tools to see your playlists here.');
    expect(useYtLibrary.getState().playlists.items.length).toBe(0);
    expect(useYtLibrary.getState().playlists.loaded).toBe(false);
  });

  it('is what the YouTube side of the card shows, the remote with its line when not set up', async () => {
    setup({ status: { setup: false, signedIn: false, reason: 'not set up', searchesLeft: null } });
    mocks.set('get_now_playing', () => null);
    useListenSource.getState().setSource('youtube');
    render(<SpotifyCard />);
    await screen.findByText('Set up YouTube in Tools to see your playlists here. About ten minutes, once.');
    expect(screen.getByRole('button', { name: /Open YouTube Music/ })).toBeTruthy();
    expect(document.querySelector('.sp-card.yt')).toBeTruthy();
  });

  it('is the library inside the card once signed in, and the remote is gone', async () => {
    setup();
    mocks.set('get_now_playing', () => null);
    useListenSource.getState().setSource('youtube');
    render(<SpotifyCard />);
    await screen.findByText('Mix 1');
    expect(screen.queryByRole('button', { name: /Open YouTube Music/ })).toBeNull();
    expect(document.querySelector('.yt-lib')).toBeTruthy();
  });
});

describe('the library', () => {
  it('shows the playlists as tiles with their counts', async () => {
    await library();
    expect(screen.getAllByText('41 videos', { selector: '.yt-count' }).length).toBe(2);
    expect(screen.getByText('1 video')).toBeTruthy();
    expect(document.querySelectorAll('.yt-tile').length).toBe(3);
    expect(screen.getByRole('tab', { name: 'Playlists' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByPlaceholderText('Search YouTube Music')).toBeTruthy();
  });

  it('says on hover what a tile click does', async () => {
    vi.useFakeTimers();
    try {
      setup();
      render(
        <>
          <YtMusicSide tall={false} remote={null} />
          <HoverTipLayer />
        </>,
      );
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      fireEvent.mouseEnter(tile('Mix 1'));
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      const tipEl = document.querySelector('.hover-tip') as HTMLElement;
      expect(tipEl.textContent).toContain('Mix 1');
      expect(tipEl.textContent).toContain('41 videos');
      expect(tipEl.textContent).toContain('Click to see its videos');
    } finally {
      hideTip(true);
      vi.useRealTimers();
    }
  });

  it('draws every picture without a referrer, lazily, from the allowed host, and falls back to a neutral tile', async () => {
    await library();
    const imgs = [...document.querySelectorAll('.yt-lib img')] as HTMLImageElement[];
    expect(imgs.length).toBe(3);
    for (const img of imgs) {
      expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
      expect(img.getAttribute('alt')).toBe('');
      expect(img.getAttribute('loading')).toBe('lazy');
      expect(img.src.startsWith('https://i.ytimg.com/vi/')).toBe(true);
    }
    fireEvent.error(imgs[0]);
    expect(document.querySelectorAll('.yt-lib img').length).toBe(2);
    expect(document.querySelector('.yt-lib .yt-cover svg')).toBeTruthy();
  });

  it('draws a playlist without a picture, or with a foreign address, as a neutral tile', async () => {
    setup({ playlists: () => page([{ ...playlist(1), thumb: null }, { ...playlist(2), thumb: 'https://evil.example/x.jpg' }, { ...playlist(3), thumb: 'javascript:alert(1)' }]) });
    side();
    await screen.findByText('Mix 1');
    expect(document.querySelectorAll('.yt-lib img').length).toBe(0);
    expect(document.querySelectorAll('.yt-lib .yt-cover svg').length).toBe(3);
  });

  it('renders a Google string as plain text, never markup', async () => {
    const evil = '<img src=x onerror=alert(1)><b>bold</b>';
    setup({ playlists: () => page([{ ...playlist(1), title: evil }]) });
    side();
    await screen.findByText(evil);
    expect(document.querySelector('.yt-lib b')).toBeNull();
    expect(document.querySelectorAll('.yt-lib img').length).toBe(1);
  });

  it('opens a playlist on a click and goes back on Back and on Escape', async () => {
    const { calls } = await library(true);
    fireEvent.click(tile('Mix 1'));
    await screen.findByText('Clip 1');
    expect(calls.items).toEqual([{ playlistId: 'PLtest1', pageToken: null, fresh: false }]);
    expect(screen.getByText('Playlist', { selector: '.sp-kick' })).toBeTruthy();
    expect(useYtLibrary.getState().opened?.id).toBe('PLtest1');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Playlists' }));
    await screen.findByText('Mix 2');
    expect(useYtLibrary.getState().opened).toBeNull();
    fireEvent.click(tile('Mix 2'));
    await screen.findByText('Clip 1');
    fireEvent.keyDown(document, { key: 'Escape' });
    await screen.findByText('Mix 2');
    expect(document.querySelector('.sp-songs')).toBeNull();
  });

  it('at rest the opened playlist takes the card (no tabs or field); tall it keeps them', async () => {
    await library(false);
    fireEvent.click(tile('Mix 1'));
    await screen.findByText('Clip 1');
    expect(screen.queryByPlaceholderText('Search YouTube Music')).toBeNull();
    expect(document.querySelector('.yt-lib')).toBeTruthy();
    expect(document.querySelector('.yt-songs.tall')).toBeNull();
  });

  it('keeps the opened playlist and three read pages when the tall view opens and closes', async () => {
    const calls = setup({ playlists: () => page([playlist(calls0++)], 'next_tok') });
    useYoutubeStatus.setState({ status: signedIn(), failed: false });
    const r = render(<YtMusicSide tall={false} remote={null} />);
    await screen.findByText('Mix 0');
    for (let i = 0; i < 2; i += 1) {
      await act(async () => { fireEvent.scroll(document.querySelector('.yt-scroll') as HTMLElement); });
      await waitFor(() => expect(useYtLibrary.getState().playlists.loading).toBe(false));
    }
    expect(calls.playlists.length).toBe(3);
    r.rerender(<YtMusicSide tall remote={null} />);
    r.rerender(<YtMusicSide tall={false} remote={null} />);
    await act(async () => { await new Promise((ok) => setTimeout(ok, 30)); });
    expect(calls.playlists.length).toBe(3);
    expect(useYtLibrary.getState().playlists.items.length).toBe(3);
    expect(screen.getByText('Mix 2')).toBeTruthy();
  });

  it('keeps the arrow-key walk between tiles', async () => {
    await library();
    const first = tile('Mix 1');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tile('Mix 2'));
    fireEvent.keyDown(tile('Mix 2'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tile('Mix 1'));
  });

  it('shows liked videos as rows', async () => {
    const { calls } = await library();
    fireEvent.click(screen.getByRole('tab', { name: 'Liked' }));
    await screen.findByText('Clip 11');
    expect(calls.liked.length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.yt-row').length).toBe(2);
    expect(document.querySelector('.yt-grid')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Liked' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('the rows', () => {
  const open = async () => {
    await library();
    fireEvent.click(tile('Mix 1'));
    await screen.findByText('Clip 1');
  };

  it('hold a button only when they play: greyed rows are plain list items that do nothing on a click', async () => {
    await open();
    const rows = [...document.querySelectorAll('.yt-row')] as HTMLElement[];
    expect(rows.length).toBe(6);
    for (const row of rows) {
      expect(row.tagName).toBe('LI');
      const grey = row.classList.contains('off');
      expect(!!row.querySelector('button')).toBe(!grey);
      if (grey) {
        expect(row.querySelector('button, [role="button"], a, input')).toBeNull();
        expect(row.hasAttribute('tabindex')).toBe(false);
        fireEvent.click(row);
      }
    }
    expect(useWatchStore.getState().playing).toBeNull();
  });

  it('grey what will not play outside YouTube and say why in their length column', async () => {
    await open();
    const row = (title: string) => screen.getByText(title).closest('.yt-row') as HTMLElement;
    expect(row('Clip 1').classList.contains('off')).toBe(false);
    expect(within(row('Clip 1')).getByText('3:21')).toBeTruthy();
    expect(row('Clip 2').classList.contains('off')).toBe(true);
    expect(within(row('Clip 2')).getByText('Only on YouTube')).toBeTruthy();
    expect(within(row('Clip 3')).getByText('Only on YouTube')).toBeTruthy();
    expect(within(row('Clip 4')).getByText('Private')).toBeTruthy();
    expect(within(row('Clip 5')).getByText('Removed')).toBeTruthy();
    expect(row('Clip 6').getAttribute('data-playable')).toBe('yes');
  });

  it('show the whole title, the channel, the length and why on hover', async () => {
    vi.useFakeTimers();
    try {
      setup();
      render(
        <>
          <YtMusicSide tall={false} remote={null} />
          <HoverTipLayer />
        </>,
      );
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      fireEvent.click(tile('Mix 1'));
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      fireEvent.mouseEnter(screen.getByText('Clip 2').closest('.yt-row') as HTMLElement);
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      const tipEl = document.querySelector('.hover-tip') as HTMLElement;
      expect(tipEl.textContent).toContain('Clip 2');
      expect(tipEl.textContent).toContain('Channel 2');
      expect(tipEl.textContent).toContain('The owner of this video allows it to play only on YouTube.');
    } finally {
      hideTip(true);
      vi.useRealTimers();
    }
  });

  it('read the playlist again from YouTube on Refresh, and say when', async () => {
    const calls = setup();
    side();
    await screen.findByText('Mix 1');
    fireEvent.click(tile('Mix 1'));
    await screen.findByText('Clip 1');
    // At rest the time is in Refresh's hover card, not on the row of buttons (the tall view shows it as text).
    expect(screen.queryByText(/^Read at /)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(calls.items.length).toBe(2));
    expect(calls.items[1]).toEqual({ playlistId: 'PLtest1', pageToken: null, fresh: true });
  });
});

describe('search', () => {
  it('runs on Enter only, never while typing, and the same words twice make one call', async () => {
    const { calls } = await library();
    const field = screen.getByPlaceholderText('Search YouTube Music') as HTMLInputElement;
    for (const text of ['n', 'ni', 'nig', 'night', 'night d', 'night drive']) fireEvent.change(field, { target: { value: text } });
    expect(calls.search.length).toBe(0);
    fireEvent.keyDown(field, { key: 'Enter' });
    await screen.findByText('Clip 21');
    expect(calls.search).toEqual([{ query: 'night drive' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    await screen.findByText('Mix 1');
    expect(field.value).toBe('');
    fireEvent.change(field, { target: { value: ' Night Drive ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await screen.findByText('Clip 21');
    expect(calls.search.length).toBe(1);
  });

  it('refuses empty and over-long words without a call', async () => {
    const { calls } = await library();
    const field = screen.getByPlaceholderText('Search YouTube Music') as HTMLInputElement;
    expect(field.maxLength).toBe(100);
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.change(field, { target: { value: 'x'.repeat(101) } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(calls.search.length).toBe(0);
  });

  it('says Nothing found for an empty answer', async () => {
    const { calls } = await library(false, { search: () => page([]) });
    const field = screen.getByPlaceholderText('Search YouTube Music');
    fireEvent.change(field, { target: { value: 'zzz' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await screen.findByText('Nothing found. Try other words.');
    expect(calls.search.length).toBe(1);
  });

  it('shows how many searches are left under 20, and nothing above', async () => {
    await library(false, { status: signedIn(12) });
    await screen.findByText('12 searches left today');
    cleanup();
    resetLibrary();
    resetYoutubeStatus();
    await library(false, { status: signedIn(60) });
    await waitFor(() => expect(useYoutubeStatus.getState().status?.searchesLeft).toBe(60));
    expect(screen.queryByText(/searches left today/)).toBeNull();
  });

  it('disables the field at none left and says so, while Playlists and Liked keep working', async () => {
    const { calls } = await library(false, { status: signedIn(0) });
    const field = (await screen.findByLabelText('Searches are used up until midnight Pacific')) as HTMLInputElement;
    expect(field.disabled).toBe(true);
    expect(screen.getByText('Searches are used up until midnight Pacific', { selector: '.yt-spent' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Liked' }));
    await screen.findByText('Clip 11');
    expect(calls.search.length).toBe(0);
  });

  it('disables the field after YouTube says the searches are used up', async () => {
    mocks.set('wall2_youtube_search', () => { throw new Error('quota'); });
    await library(false, { search: () => { throw new Error('quota'); } });
    const field = screen.getByPlaceholderText('Search YouTube Music');
    fireEvent.change(field, { target: { value: 'night' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await screen.findByText('Searches are used up until midnight Pacific.');
    await waitFor(() => expect((screen.getByLabelText('Searches are used up until midnight Pacific') as HTMLInputElement).disabled).toBe(true));
  });
});

describe('every state', () => {
  const failing = async (word: string, ...expected: string[]) => {
    setup({ playlists: () => { throw new Error(word); } });
    side();
    for (const text of expected) await screen.findByText(text);
  };

  it('shows skeletons while loading, with no text and no spinner', async () => {
    setup({ playlists: () => new Promise(() => undefined) });
    side();
    await waitFor(() => expect(document.querySelector('[data-skeleton="tiles"]')).toBeTruthy());
    expect(document.querySelectorAll('.yt-skel-tile').length).toBe(8);
    expect(document.querySelector('.yt-grid')?.textContent).toBe('');
    expect(document.querySelector('[role="progressbar"], .spinner')).toBeNull();
  });

  it('shows row skeletons while Liked loads', async () => {
    const calls = setup({ liked: () => new Promise(() => undefined) as never });
    side();
    await screen.findByText('Mix 1');
    fireEvent.click(screen.getByRole('tab', { name: 'Liked' }));
    await waitFor(() => expect(document.querySelector('[data-skeleton="rows"]')).toBeTruthy());
    expect(calls.liked.length).toBe(1);
  });

  it('says No playlists yet and No liked videos yet', async () => {
    setup({ playlists: () => page([]), liked: () => page([]) });
    side();
    await screen.findByText('No playlists yet');
    fireEvent.click(screen.getByRole('tab', { name: 'Liked' }));
    await screen.findByText('No liked videos yet');
  });

  it('says YouTube is not answering, with Retry that reads again', async () => {
    await failing('down', 'YouTube is not answering.');
    let n = 0;
    mocks.set('wall2_youtube_playlists', () => { n += 1; return page([playlist(1)]); });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Mix 1');
    expect(n).toBe(1);
  });

  it('says YouTube is busy, with Retry', async () => {
    await failing('busy', 'YouTube is busy. Try again in a minute.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('says YouTube needs a new sign-in, with Open Tools', async () => {
    await failing('sign in again', 'YouTube needs a new sign-in.');
    fireEvent.click(screen.getByRole('button', { name: 'Open Tools' }));
    expect(useToolsStore.getState().open).toBe(true);
  });

  it('says the reads are used up until midnight Pacific', async () => {
    await failing('quota-all', 'YouTube reads are used up until midnight Pacific.');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('says a playlist is gone, with Back', async () => {
    const { calls } = await library(false, { items: () => { throw new Error('not found'); } });
    fireEvent.click(tile('Mix 1'));
    await screen.findByText('This playlist is gone.');
    expect(calls.items.length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByText('Mix 2');
  });

  it('keeps the rows read and offers Retry when a later page fails', async () => {
    let n = 0;
    setup({ playlists: () => { n += 1; if (n === 1) return page([playlist(1)], 'tok_2'); throw new Error('busy'); } });
    side();
    await screen.findByText('Mix 1');
    fireEvent.scroll(document.querySelector('.yt-scroll') as HTMLElement);
    await screen.findByText('YouTube is busy. Try again in a minute.');
    expect(screen.getByText('Mix 1')).toBeTruthy();
    fireEvent.scroll(document.querySelector('.yt-scroll') as HTMLElement);
    expect(n).toBe(2);
    mocks.set('wall2_youtube_playlists', () => { n += 1; return page([playlist(2)]); });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Mix 2');
    expect(screen.getByText('Mix 1')).toBeTruthy();
  });
});

describe('a dead page token', () => {
  it('a next page that fails with invalid forgets the token: Retry reads page one with no token, and the rows are exactly that page', async () => {
    let n = 0;
    const calls = setup({
      playlists: () => {
        n += 1;
        if (n === 1) return page([playlist(1), playlist(2)], 'tok_2');
        if (n === 2) return page([playlist(3)], 'tok_3');
        if (n === 3) throw new Error('invalid');
        // Page one again: a stale later-page row (3) is gone, and a repeated id shows once.
        return page([playlist(4), playlist(1), playlist(1)], null);
      },
    });
    side();
    await screen.findByText('Mix 1');
    fireEvent.scroll(document.querySelector('.yt-scroll') as HTMLElement);
    await screen.findByText('Mix 3');
    expect(useYtLibrary.getState().playlists.pages).toBe(2);
    fireEvent.scroll(document.querySelector('.yt-scroll') as HTMLElement);
    await waitFor(() => expect(useYtLibrary.getState().playlists.problem).toBe('invalid'));
    expect(calls.playlists[2]).toEqual({ pageToken: 'tok_3', fresh: false });
    expect(useYtLibrary.getState().playlists.next).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls.playlists.length).toBe(4));
    expect(calls.playlists[3]).toEqual({ pageToken: null, fresh: false });
    await screen.findByText('Mix 4');
    const lib = useYtLibrary.getState().playlists;
    expect(lib.items.map((i) => i.id)).toEqual(['PLtest4', 'PLtest1']);
    expect(lib.pages).toBe(1);
    expect(lib.next).toBeNull();
    expect(screen.queryByText('Mix 3')).toBeNull();
  });
});

describe('paging', () => {
  it('reads the next page near the end of the list, and stops at 40 pages with a line that says so', async () => {
    let calls = 0;
    const tokens: unknown[] = [];
    setup({ playlists: () => page([playlist(calls++)], 'next_token') });
    mocks.set('wall2_youtube_playlists', (a) => { tokens.push(a?.pageToken); const n = calls++; return page([playlist(1000 + n)], 'next_token'); });
    side();
    await screen.findByText('Mix 1000');
    for (let i = 0; i < MAX_PAGES + 6; i += 1) {
      await act(async () => { fireEvent.scroll(document.querySelector('.yt-scroll') as HTMLElement); });
      await waitFor(() => expect(useYtLibrary.getState().playlists.loading).toBe(false));
    }
    expect(calls).toBe(MAX_PAGES);
    expect(tokens[0]).toBeNull();
    expect(tokens.slice(1).every((t) => t === 'next_token')).toBe(true);
    expect(useYtLibrary.getState().playlists.pages).toBe(MAX_PAGES);
    expect(screen.getByText('Showing the first 2,000')).toBeTruthy();
  });

  it('adds a page without repeating a playlist it already has', async () => {
    let n = 0;
    setup({ playlists: () => { n += 1; return n === 1 ? page([playlist(1), playlist(2)], 'tok') : page([playlist(2), playlist(3)]); } });
    side();
    await screen.findByText('Mix 1');
    await act(async () => { fireEvent.scroll(document.querySelector('.yt-scroll') as HTMLElement); });
    await screen.findByText('Mix 3');
    expect(document.querySelectorAll('.yt-tile').length).toBe(3);
  });
});

// ---- fix round -----------------------------------------------------------------------------

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
let hiddenNow = false;
function setHidden(hidden: boolean) {
  hiddenNow = hidden;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hiddenNow });
  document.dispatchEvent(new Event('visibilitychange'));
}
const signedInStatus = () => useYoutubeStatus.setState({ status: signedIn(), failed: false });
const scrollFar = (el: HTMLElement, top: number, client: number, height: number) => {
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: client });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: height });
  el.scrollTop = top;
  fireEvent.scroll(el);
};

describe('reads and the page being shown', () => {
  afterEach(() => setHidden(false));

  it('reads nothing while the page is hidden, and the pending first read once it shows', async () => {
    const calls = setup();
    setHidden(true);
    signedInStatus();
    side();
    await act(async () => { await new Promise((ok) => setTimeout(ok, 40)); });
    expect(calls.playlists.length).toBe(0);
    act(() => setHidden(false));
    await screen.findByText('Mix 1');
    expect(calls.playlists.length).toBe(1);
  });

  it('polls the status every minute while shown and not at all while hidden', async () => {
    vi.useFakeTimers();
    try {
      const calls = setup();
      render(<YtMusicSide tall={false} remote={null} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      const first = calls.status;
      expect(first).toBeGreaterThan(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(YT_STATUS_POLL_MS); });
      expect(calls.status).toBe(first + 1);
      act(() => setHidden(true));
      await act(async () => { await vi.advanceTimersByTimeAsync(YT_STATUS_POLL_MS * 3); });
      expect(calls.status).toBe(first + 1);
      act(() => setHidden(false));
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(calls.status).toBe(first + 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes nothing from a read that was still running when the library was closed', async () => {
    const held = deferred<YtPage<YtPlaylist>>();
    const calls = setup({ playlists: () => held.promise });
    signedInStatus();
    const r = side();
    await waitFor(() => expect(calls.playlists.length).toBe(1));
    r.unmount();
    held.resolve(page([playlist(1)]));
    await act(async () => { await new Promise((ok) => setTimeout(ok, 30)); });
    expect(useYtLibrary.getState().playlists.items.length).toBe(0);
    expect(useYtLibrary.getState().playlists.loading).toBe(false);
    expect(useYtLibrary.getState().playlists.loaded).toBe(false);
    // Shown again, it reads once and shows the list.
    side();
    await screen.findByText('Mix 1');
    expect(calls.playlists.length).toBe(2);
  });

  it('a direct next-page read and a direct search make no native call while the page is hidden, and read again once it shows', async () => {
    const { calls } = await library(false, { playlists: () => page([playlist(1)], 'tok_2') });
    const before = calls.playlists.length;
    act(() => setHidden(true));
    await act(async () => {
      await loadList('playlists', true);
      await runSearch('night drive');
    });
    expect(calls.playlists.length).toBe(before);
    expect(calls.search.length).toBe(0);
    act(() => setHidden(false));
    await act(async () => {
      await loadList('playlists', true);
    });
    expect(calls.playlists.length).toBe(before + 1);
    expect(calls.playlists[before]).toEqual({ pageToken: 'tok_2', fresh: false });
    await act(async () => {
      await runSearch('night drive');
    });
    expect(calls.search.length).toBe(1);
  });

  it('every row-only scroll area is a labelled, focusable region', async () => {
    await library(true);
    fireEvent.click(screen.getByRole('tab', { name: /Liked/ }));
    await screen.findByText('Clip 11');
    const liked = screen.getByRole('region', { name: 'Liked videos' });
    expect(liked.getAttribute('tabindex')).toBe('0');
    fireEvent.click(screen.getByRole('tab', { name: /Playlists/ }));
    fireEvent.click(await screen.findByText('Mix 1'));
    await screen.findByText('Clip 1');
    const songs = screen.getByRole('region', { name: 'Videos in Mix 1' });
    expect(songs.getAttribute('tabindex')).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Playlists' }));
    await screen.findByText('Mix 2');
    const field = screen.getByPlaceholderText('Search YouTube Music') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'night' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await screen.findByText('Clip 21');
    const found = screen.getByRole('region', { name: 'Search results' });
    expect(found.getAttribute('tabindex')).toBe('0');
  });

  it('reads the next page only within 160 px of the end', async () => {
    let n = 0;
    const calls = setup({ playlists: () => page([playlist(++n)], 'more_tok') });
    signedInStatus();
    side();
    await screen.findByText('Mix 1');
    const el = document.querySelector('.yt-scroll') as HTMLElement;
    scrollFar(el, 0, 300, 2000);
    scrollFar(el, 1000, 300, 2000);
    scrollFar(el, 1539, 300, 2000);
    await act(async () => { await new Promise((ok) => setTimeout(ok, 30)); });
    expect(calls.playlists.length).toBe(1);
    scrollFar(el, 1540, 300, 2000);
    await screen.findByText('Mix 2');
    expect(calls.playlists.length).toBe(2);
  });
});

describe('searches that overlap', () => {
  const enter = (value: string) => {
    const field = screen.getByPlaceholderText('Search YouTube Music');
    fireEvent.change(field, { target: { value } });
    fireEvent.keyDown(field, { key: 'Enter' });
  };

  it('never lets an older answer replace a newer one, whatever order they come back in', async () => {
    const held: Record<string, ReturnType<typeof deferred<YtPage<YtVideo>>>> = { aaa: deferred(), bbb: deferred() };
    await library(false, { search: (q) => held[q].promise as never });
    enter('aaa');
    enter('bbb');
    await waitFor(() => expect(Object.keys(held).length).toBe(2));
    held.bbb.resolve(page([video(31)]));
    await screen.findByText('Clip 31');
    held.aaa.resolve(page([video(32)]));
    await act(async () => { await new Promise((ok) => setTimeout(ok, 30)); });
    expect(screen.queryByText('Clip 32')).toBeNull();
  });

  it('keeps the newest search when the older one answers first', async () => {
    const held: Record<string, ReturnType<typeof deferred<YtPage<YtVideo>>>> = { aaa: deferred(), bbb: deferred() };
    await library(false, { search: (q) => held[q].promise as never });
    enter('aaa');
    enter('bbb');
    held.aaa.resolve(page([video(32)]));
    await act(async () => { await new Promise((ok) => setTimeout(ok, 30)); });
    expect(screen.queryByText('Clip 32')).toBeNull();
    held.bbb.resolve(page([video(31)]));
    await screen.findByText('Clip 31');
  });

  it('makes one call for the same words asked twice while the first is on its way, and the second still applies', async () => {
    const held = deferred<YtPage<YtVideo>>();
    const { calls } = await library(false, { search: () => held.promise as never });
    enter('night');
    enter('Night ');
    expect(calls.search.length).toBe(1);
    held.resolve(page([video(41)]));
    await screen.findByText('Clip 41');
    expect(calls.search.length).toBe(1);
    // An older search with other words, asked in between, cannot spoil the shared answer either.
    expect(useYtLibrary.getState().found?.items.length).toBe(1);
  });

  it('the same words asked again after another search wait for the call already out', async () => {
    const held: Record<string, ReturnType<typeof deferred<YtPage<YtVideo>>>> = { aaa: deferred(), bbb: deferred() };
    const { calls } = await library(false, { search: (q) => held[q].promise as never });
    enter('aaa');
    enter('bbb');
    enter('aaa');
    expect(calls.search.length).toBe(2);
    held.aaa.resolve(page([video(51)]));
    await screen.findByText('Clip 51');
    held.bbb.resolve(page([video(52)]));
    await act(async () => { await new Promise((ok) => setTimeout(ok, 30)); });
    expect(screen.queryByText('Clip 52')).toBeNull();
  });

  it('repeats a failed search by asking again (Rust keeps the answer and reads the details only)', async () => {
    let n = 0;
    const { calls } = await library(false, { search: () => { n += 1; if (n === 1) throw new Error('down'); return page([video(61)]); } });
    enter('retry me');
    await screen.findByText('YouTube is not answering.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Clip 61');
    expect(calls.search).toEqual([{ query: 'retry me' }, { query: 'retry me' }]);
  });
});

describe('Retry repeats the read that failed', () => {
  it('a failed Refresh retries the first page, not the next one', async () => {
    let n = 0;
    const calls = setup({ items: () => { n += 1; if (n === 2) throw new Error('busy'); return page([video(1), video(2)], null); } });
    side();
    await screen.findByText('Mix 1');
    fireEvent.click(tile('Mix 1'));
    await screen.findByText('Clip 1');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('YouTube is busy. Try again in a minute.');
    expect(screen.getByText('Clip 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls.items.length).toBe(3));
    expect(calls.items[2]).toEqual({ playlistId: 'PLtest1', pageToken: null, fresh: true });
    await waitFor(() => expect(screen.queryByText('YouTube is busy. Try again in a minute.')).toBeNull());
  });

  it('a failed re-read of a list with rows and no next page retries too', async () => {
    let n = 0;
    const calls = setup({ playlists: () => { n += 1; return page([playlist(1)]); }, liked: () => { throw new Error('busy'); } });
    side();
    await screen.findByText('Mix 1');
    useYtLibrary.setState((s) => ({ playlists: { ...s.playlists, problem: 'busy', failed: 'first' } }));
    await screen.findByText('YouTube is busy. Try again in a minute.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls.playlists.length).toBe(2));
    expect(n).toBe(2);
  });

  it('a failed next page still retries the next page', async () => {
    let n = 0;
    const calls = setup({ playlists: () => { n += 1; if (n === 2) throw new Error('busy'); return page([playlist(n)], n === 1 ? 'tok_n' : null); } });
    side();
    await screen.findByText('Mix 1');
    await act(async () => { fireEvent.scroll(document.querySelector('.yt-scroll') as HTMLElement); });
    await screen.findByText('YouTube is busy. Try again in a minute.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Mix 3');
    expect(calls.playlists[2]).toEqual({ pageToken: 'tok_n', fresh: false });
  });
});

describe('the keyboard', () => {
  it('lets each list of rows take focus, labelled, so the arrow and page keys scroll it', async () => {
    await library(false);
    fireEvent.click(screen.getByRole('tab', { name: 'Liked' }));
    await screen.findByText('Clip 11');
    const liked = screen.getByRole('region', { name: 'Liked videos' });
    expect(liked.getAttribute('tabindex')).toBe('0');
    fireEvent.click(screen.getByRole('tab', { name: 'Playlists' }));
    fireEvent.click(tile('Mix 1'));
    await screen.findByText('Clip 1');
    expect(screen.getByRole('region', { name: 'Videos in Mix 1' }).getAttribute('tabindex')).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Playlists' }));
    const field = screen.getByPlaceholderText('Search YouTube Music');
    fireEvent.change(field, { target: { value: 'night' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await screen.findByText('Clip 21');
    expect(screen.getByRole('region', { name: 'Search results' }).getAttribute('tabindex')).toBe('0');
  });

  it('swaps the library row for the chips while a search shows, and Library brings it back', async () => {
    await library(false);
    const field = screen.getByPlaceholderText('Search YouTube Music');
    fireEvent.change(field, { target: { value: 'night' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await screen.findByText('Clip 21');
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getAllByRole('radio').map((r) => r.textContent?.replace(/\d+$/, ''))).toEqual(['All', 'Playlists', 'Songs']);
    fireEvent.click(screen.getByRole('button', { name: 'Library' }));
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['For you', 'Playlists', 'Liked']);
  });
});

describe('paging rules of the store', () => {
  it('shows a video repeated on the first page once', async () => {
    setup({ liked: () => page([video(1), video(1), video(2)]) });
    side();
    await screen.findByText('Mix 1');
    fireEvent.click(screen.getByRole('tab', { name: 'Liked' }));
    await screen.findByText('Clip 2');
    expect(document.querySelectorAll('.yt-row').length).toBe(2);
  });
});

describe('the card heading is a way home, and Open in YouTube', () => {
  const LONG = 'PLmockPlaylist0001';
  const longList = (): YtPage<YtPlaylist> => page([{ id: LONG, title: 'Long id mix', count: 3, thumb: THUMB(1) }, playlist(2)]);
  const heading = () => screen.getByRole('radio', { name: /YouTube Music/ });
  const card = async (tall = false, opts: Parameters<typeof setup>[0] = {}) => {
    setup({ playlists: longList, ...opts });
    mocks.set('get_now_playing', () => null);
    useListenSource.getState().setSource('youtube');
    render(tall ? <SpotifyCard /> : <SpotifyCard />);
    await screen.findByText('Long id mix');
  };

  it('on the first page the heading does nothing new; inside a playlist it goes back to the first page, with its tip', async () => {
    await card();
    render(<HoverTipLayer />);
    const tipOf = async () => {
      hideTip(true);
      await act(async () => void fireEvent.mouseEnter(heading()));
      await new Promise((r) => setTimeout(r, 400));
      return document.querySelector('.hover-tip')?.textContent ?? '';
    };
    expect(await tipOf()).toBe('Follow YouTube Music through Windows');
    fireEvent.click(heading());
    expect(useListenSource.getState().source).toBe('youtube');
    expect(useYtLibrary.getState().opened).toBeNull();
    fireEvent.click(tile('Long id mix'));
    await screen.findByText('Clip 1');
    expect(await tipOf()).toBe('Back to YouTube Music home');
    fireEvent.click(heading());
    await screen.findByText('Mix 2');
    expect(useYtLibrary.getState().opened).toBeNull();
    expect(useListenSource.getState().source).toBe('youtube');
  });

  it('the parent crumb of a tall playlist goes to the first page too', async () => {
    await card();
    fireEvent.click(heading().closest('.sp-card')!.querySelector('.sp-grow')!);
    fireEvent.click(tile('Long id mix'));
    await screen.findByText('Clip 1');
    fireEvent.click(screen.getByRole('button', { name: 'Playlists' }));
    await screen.findByText('Mix 2');
    expect(useYtLibrary.getState().opened).toBeNull();
  });

  it('Open in YouTube is a round icon button in the header that opens the playlist link through the existing command', async () => {
    const opened: unknown[] = [];
    mocks.set('wall2_watch_open', (a) => {
      opened.push(a);
      return undefined;
    });
    await card();
    fireEvent.click(tile('Long id mix'));
    await screen.findByText('Clip 1');
    const btn = screen.getByRole('button', { name: 'Open in YouTube' });
    expect(btn.className).toContain('u-rd');
    expect(btn.textContent).toBe('');
    await act(async () => void fireEvent.click(btn));
    expect(opened).toEqual([{ kind: 'playlist', id: LONG }]);
  });

  it('an id that fails the check is never sent', async () => {
    const opened: unknown[] = [];
    mocks.set('wall2_watch_open', (a) => {
      opened.push(a);
      return undefined;
    });
    await card();
    fireEvent.click(tile('Mix 2'));
    await screen.findByText('Clip 1');
    expect(useYtLibrary.getState().opened?.id).toBe('PLtest2');
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Open in YouTube' })));
    expect(opened).toEqual([]);
  });
});

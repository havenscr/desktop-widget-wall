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
import { resetLibrary, useYtLibrary } from './store';
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
    expect(screen.queryByText('Search music on YouTube')).toBeNull();
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
    expect(screen.getByPlaceholderText('Search music on YouTube')).toBeTruthy();
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
    expect(screen.queryByPlaceholderText('Search music on YouTube')).toBeNull();
    expect(document.querySelector('.yt-lib')).toBeTruthy();
    expect(document.querySelector('.yt-songs.tall')).toBeNull();
  });

  it('keeps the opened playlist when the tall view opens and closes', async () => {
    await library(false);
    fireEvent.click(tile('Mix 1'));
    await screen.findByText('Clip 1');
    const r = render(<div />);
    r.unmount();
    expect(useYtLibrary.getState().opened?.id).toBe('PLtest1');
    expect(useYtLibrary.getState().songs.items.length).toBe(6);
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

  it('are not buttons: no button, no role, no tab stop, and nothing plays on a click', async () => {
    await open();
    const rows = [...document.querySelectorAll('.yt-row')] as HTMLElement[];
    expect(rows.length).toBe(6);
    const played: unknown[] = [];
    mocks.set('wall2_watch_play', (a) => { played.push(a); });
    for (const row of rows) {
      expect(row.querySelector('button, [role="button"], a, input')).toBeNull();
      expect(row.getAttribute('role')).toBeNull();
      expect(row.hasAttribute('tabindex')).toBe(false);
      expect(row.tagName).toBe('LI');
      fireEvent.click(row);
    }
    expect(played).toEqual([]);
    expect(screen.queryByRole('button', { name: /^(Play|Shuffle)$/ })).toBeNull();
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
    expect(screen.getByText(/^Read at \d{1,2}:\d{2} (AM|PM)$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(calls.items.length).toBe(2));
    expect(calls.items[1]).toEqual({ playlistId: 'PLtest1', pageToken: null, fresh: true });
  });
});

describe('search', () => {
  it('runs on Enter only, never while typing, and the same words twice make one call', async () => {
    const { calls } = await library();
    const field = screen.getByPlaceholderText('Search music on YouTube') as HTMLInputElement;
    for (const text of ['n', 'ni', 'nig', 'night', 'night d', 'night drive']) fireEvent.change(field, { target: { value: text } });
    expect(calls.search.length).toBe(0);
    fireEvent.keyDown(field, { key: 'Enter' });
    await screen.findByText('Clip 21');
    expect(calls.search).toEqual([{ query: 'night drive' }]);
    expect(screen.getByText('Results for', { exact: false }).textContent).toBe('Results for night drive');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Playlists' }));
    await screen.findByText('Mix 1');
    expect(field.value).toBe('');
    fireEvent.change(field, { target: { value: ' Night Drive ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await screen.findByText('Clip 21');
    expect(calls.search.length).toBe(1);
  });

  it('refuses empty and over-long words without a call', async () => {
    const { calls } = await library();
    const field = screen.getByPlaceholderText('Search music on YouTube') as HTMLInputElement;
    expect(field.maxLength).toBe(100);
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.change(field, { target: { value: 'x'.repeat(101) } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(calls.search.length).toBe(0);
  });

  it('says Nothing found for an empty answer', async () => {
    const { calls } = await library(false, { search: () => page([]) });
    const field = screen.getByPlaceholderText('Search music on YouTube');
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
    const field = screen.getByPlaceholderText('Search music on YouTube');
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

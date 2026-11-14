import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { coverColours, floorColour, liveTint, resetCoverTint, setCoverTint, TINT_FADE_MS, TINT_MIN_LIGHT } from '../../music/coverTint';
import { PLAY_TINT } from '../../horizon/echo';
import type { SpotifyItem, SpotifyTrack } from '../../music/spotify';
import { resetNowPlaying } from '../../music/store';
import { resetTools, useToolsStore } from '../../tools/store';
import { isNowPlaying, kindLine, LISTEN_SOURCE_KEY, resetListenSource, spotifyProblem, tileLine, trackLength, UP_NEXT_NONE_LINE, upNextPlan, useLastContext, useListenSource, useSpotifyNow } from './model';
import { useNowPlayingStore } from '../../music/store';
import { hideTip } from '../../ui/HoverTip';
import { HoverTipLayer } from '../../ui/HoverTip';
import { useSpotifyStatusPoll } from './status';
import { Unwind } from '../../screens/Unwind';
import { useWatchStore } from '../watch/store';
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
  useSpotifyNow.setState({ id: null });
});
afterEach(() => {
  hideTip(true);
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
  expect(spotifyProblem('sign in again')).toBe('needsSignIn');
  expect(spotifyProblem('busy')).toBe('busy');
  expect(spotifyProblem('no device')).toBe('nodevice');
  expect(spotifyProblem(new Error('down'))).toBe('down');
  expect(spotifyProblem(42)).toBe('failed');
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
  await act(async () => (document.querySelector('.sp-tile') as HTMLButtonElement).click());
  await flush();
  expect(document.querySelector('.sp-shead')?.textContent).toContain('2,000 songs');
  const list = document.querySelector('.sp-tracks') as HTMLElement;
  Object.defineProperty(list, 'scrollHeight', { value: 2000, configurable: true });
  Object.defineProperty(list, 'clientHeight', { value: 300, configurable: true });
  list.scrollTop = 1600;
  fireEvent.scroll(list);
  await flush();
  expect(pages).toEqual([0, 1]);
  expect(document.querySelectorAll('.sp-track')).toHaveLength(100);
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

it('Up next hides when nothing is queued', async () => {
  signedIn();
  mocks.set('wall2_spotify_queue', () => ({ current: null, next: [] }));
  render(<UpNext />);
  await flush();
  expect(document.querySelector('.u-next')).toBeNull();
});

/** A promise and the hands that settle it, for answers that land in a chosen order. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const playingOn = (source: string) => useNowPlayingStore.setState({ info: { title: 'Song 1', artist: 'Some Artist', playback_status: 'playing', source_app: source } as never });

it('says each thing once: the kind with its owner or artist, the count under a tile, track lengths', () => {
  expect(kindLine(item(1))).toBe('Playlist');
  expect(kindLine({ ...item(1), subtitle: 'Playlist, Robin Vale' })).toBe('Playlist by Robin Vale');
  expect(kindLine(item(1, 'album'))).toBe('Album by Some Artist');
  expect(kindLine(item(1, 'track'))).toBe('Song by Some Artist');
  expect(tileLine(item(1))).toBe('20 songs');
  expect(tileLine({ ...item(1), count: null, subtitle: 'Playlist, Robin Vale' })).toBe('Playlist by Robin Vale');
  expect(trackLength(185_000)).toBe('3:05');
  expect(trackLength(3_725_000)).toBe('1:02:05');
});

it('marks the song playing by track id, else by title and artist, never by the title alone', () => {
  expect(isNowPlaying({ id: id(1), name: 'Same', artists: 'A' }, id(1), '', '')).toBe(true);
  expect(isNowPlaying({ id: id(2), name: 'Same', artists: 'A' }, id(1), 'Same', 'A')).toBe(false);
  expect(isNowPlaying({ id: null, name: 'Same', artists: 'Band A' }, null, 'Same', 'Band A')).toBe(true);
  expect(isNowPlaying({ id: null, name: 'Same', artists: 'Band B' }, null, 'Same', 'Band A')).toBe(false);
  expect(isNowPlaying({ id: null, name: 'Same', artists: 'Band A' }, null, 'Same', '')).toBe(false);
});

it('plans an Up next click without ever replacing the queue', () => {
  const last = { context: { kind: 'playlist' as const, id: id(9) }, ids: new Set([id(1), id(2)]) };
  // In its list only when the song playing now is in that list too.
  expect(upNextPlan(id(2), 0, last, id(1), true)).toEqual({ kind: 'context', context: last.context, offsetId: id(2) });
  expect(upNextPlan(id(2), 1, last, id(7), true)).toEqual({ kind: 'skip', skips: 2 });
  expect(upNextPlan(id(2), 1, last, null, true)).toEqual({ kind: 'skip', skips: 2 });
  // Not Spotify in front: nothing is sent.
  expect(upNextPlan(id(2), 1, last, id(7), false)).toEqual({ kind: 'none', line: UP_NEXT_NONE_LINE });
  expect(upNextPlan(id(3), 0, { context: null, ids: new Set() }, null, false).kind).toBe('none');
});

it('shows playlists as a grid of cover tiles; resting on one opens its details with Play, Shuffle and Songs', async () => {
  signedIn();
  mocks.set('wall2_spotify_playlists', () => [{ ...item(1), subtitle: 'Playlist, Robin Vale' }, { ...item(2), imageUrl: null, thumbUrl: null }]);
  mocks.set('wall2_spotify_playback', () => null);
  const calls: [string, unknown][] = [];
  for (const c of ['wall2_spotify_play', 'wall2_spotify_shuffle']) mocks.set(c, (a) => void calls.push([c, a]));
  mocks.set('wall2_spotify_tracks', () => ({ items: [track(1)], total: 1, more: false }));
  render(
    <>
      <SpotifyCard />
      <HoverTipLayer />
    </>,
  );
  await flush();
  const tiles = document.querySelectorAll('.sp-grid .sp-tile');
  expect(tiles).toHaveLength(2);
  expect(tiles[0].querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,big1');
  // A missing cover is a neutral tile with a note, never a gradient.
  expect(tiles[1].querySelector('img')).toBeNull();
  expect(tiles[0].textContent).toContain('20 songs');
  fireEvent.mouseEnter(tiles[0]);
  await flush(300);
  const card = document.querySelector('.hover-tip .sp-details') as HTMLElement;
  expect(card.textContent).toContain('Playlist by Robin Vale');
  expect(card.textContent).not.toContain('Length');
  expect(card.textContent).not.toContain('Last played');
  await act(async () => (screen.getByRole('button', { name: 'Shuffle' }) as HTMLButtonElement).click());
  await flush();
  expect(calls).toEqual([
    ['wall2_spotify_shuffle', { on: true }],
    ['wall2_spotify_play', { request: { kind: 'playlist', id: id(1) } }],
  ]);
  fireEvent.mouseEnter(tiles[0]);
  await flush(300);
  await act(async () => (screen.getByRole('button', { name: /^Songs/ }) as HTMLButtonElement).click());
  await flush();
  expect(document.querySelector('.sp-songs')).not.toBeNull();
});

it('opens a tile into its songs, plays a song in its list, marks the playing song by id, and goes back on Escape', async () => {
  signedIn();
  mocks.set('wall2_spotify_playlists', () => [item(1), item(2)]);
  mocks.set('wall2_spotify_playback', () => ({ playing: true, device: null, track: track(1), progressMs: 0, shuffle: false }));
  const tracks = vi.fn((a?: Record<string, unknown>) => ({ items: [track(1), track(2), track(3, false)], total: 3, more: false, ...a }));
  mocks.set('wall2_spotify_tracks', (a) => tracks(a));
  const plays: unknown[] = [];
  mocks.set('wall2_spotify_play', (a) => void plays.push(a));
  render(<SpotifyCard />);
  await flush();
  await act(async () => (document.querySelector('.sp-tile') as HTMLButtonElement).click());
  await flush();
  expect(tracks).toHaveBeenCalledWith(expect.objectContaining({ kind: 'playlist', id: id(1), page: 0 }));
  expect(document.querySelector('.sp-track.on')?.textContent).toContain('Song 1');
  expect(document.querySelectorAll('.sp-track.on')).toHaveLength(1);
  // Every song is read, so the whole length shows (3 songs of 3:05).
  expect(document.querySelector('.sp-shead')?.textContent).toContain('3 songs · 9 min');
  expect(document.querySelector('.sp-track.off')?.textContent).toContain('Song 3');
  await act(async () => screen.getByText('Song 2').closest('button')!.click());
  expect(plays.at(-1)).toEqual({ request: { kind: 'track', id: id(502), context: { kind: 'playlist', id: id(1) }, offsetId: id(502) } });
  expect(useLastContext.getState().ids.has(id(501))).toBe(true);
  await act(async () => screen.getByText('Song 3').closest('button')!.click());
  expect(plays).toHaveLength(1);
  fireEvent.keyDown(document, { key: 'Escape' });
  await flush();
  expect(document.querySelectorAll('.sp-tile')).toHaveLength(2);
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
  render(
    <>
      <SpotifyCard />
      <HoverTipLayer />
    </>,
  );
  await flush();
  fireEvent.mouseEnter(document.querySelector('.sp-tile')!);
  await flush(300);
  await act(async () => (screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).click());
  await flush();
  expect(screen.getByText('Open Spotify on this PC first, then try again.')).toBeTruthy();
  busy = true;
  await act(async () => screen.getByRole('tab', { name: 'Albums' }).click());
  await flush();
  expect(screen.getByText('Spotify is busy, try in a minute.')).toBeTruthy();
});

it('searches after a pause of 400 ms with two letters, or on Enter, songs as rows and lists as tiles', async () => {
  signedIn();
  mocks.set('wall2_spotify_playlists', () => []);
  const asked: unknown[] = [];
  mocks.set('wall2_spotify_search', (a) => {
    asked.push(a?.query);
    return { tracks: [item(7, 'track', 'Found Song')], albums: [], playlists: [item(8, 'playlist', 'Found List')] };
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
  expect(document.querySelector('.sp-list')?.textContent).toContain('Found Song');
  expect(document.querySelector('.sp-grid')?.textContent).toContain('Found List');
});

it('applies only the newest search: an older answer that lands last is dropped', async () => {
  signedIn();
  mocks.set('wall2_spotify_playlists', () => []);
  const pending: Record<string, ReturnType<typeof deferred<unknown>>> = {};
  mocks.set('wall2_spotify_search', (a) => {
    const d = deferred<unknown>();
    pending[String(a?.query)] = d;
    return d.promise;
  });
  render(<SpotifyCard />);
  await flush();
  const box = screen.getByRole('searchbox');
  fireEvent.change(box, { target: { value: 'ab' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  fireEvent.change(box, { target: { value: 'abc' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  await flush();
  // Newest first, then the older one late: the older must not overwrite the newer list.
  await act(async () => pending.abc.resolve({ tracks: [item(2, 'track', 'Newer')], albums: [], playlists: [] }));
  await act(async () => pending.ab.resolve({ tracks: [item(1, 'track', 'Older')], albums: [], playlists: [] }));
  await flush();
  expect(screen.queryByText('Older')).toBeNull();
  expect(screen.getByText('Newer')).toBeTruthy();
  // A late failure of an older search is dropped too.
  fireEvent.change(box, { target: { value: 'abcd' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  fireEvent.change(box, { target: { value: 'abcde' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  await flush();
  await act(async () => pending.abcde.resolve({ tracks: [item(3, 'track', 'Newest')], albums: [], playlists: [] }));
  await act(async () => pending.abcd.reject(new Error('down')));
  await flush();
  expect(screen.getByText('Newest')).toBeTruthy();
  expect(screen.queryByText('Spotify is not answering right now.')).toBeNull();
});

it('a failed search keeps the last good results under a note, offers Retry, and the same words can be asked again', async () => {
  signedIn();
  mocks.set('wall2_spotify_playlists', () => []);
  let fail = false;
  const asked: unknown[] = [];
  mocks.set('wall2_spotify_search', (a) => {
    asked.push(a?.query);
    if (fail) throw new Error('busy');
    return { tracks: [item(1, 'track', `Hit for ${String(a?.query)}`)], albums: [], playlists: [] };
  });
  render(<SpotifyCard />);
  await flush();
  const box = screen.getByRole('searchbox');
  fireEvent.change(box, { target: { value: 'ab' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  await flush();
  expect(screen.getByText('Hit for ab')).toBeTruthy();
  fail = true;
  fireEvent.change(box, { target: { value: 'abc' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  await flush();
  // The last good results stay, under the busy line, with Retry.
  expect(screen.getByText('Hit for ab')).toBeTruthy();
  expect(document.querySelector('.sp-stale')?.textContent).toContain('Spotify is busy, try in a minute.');
  fail = false;
  await act(async () => screen.getByRole('button', { name: 'Retry' }).click());
  await flush();
  expect(asked).toEqual(['ab', 'abc', 'abc']);
  expect(screen.getByText('Hit for abc')).toBeTruthy();
  expect(document.querySelector('.sp-stale')).toBeNull();
});

it('a failed first search shows the line with Retry, and typing the same words again asks again', async () => {
  signedIn();
  mocks.set('wall2_spotify_playlists', () => []);
  const asked: unknown[] = [];
  mocks.set('wall2_spotify_search', (a) => {
    asked.push(a?.query);
    throw new Error('down');
  });
  render(<SpotifyCard />);
  await flush();
  const box = screen.getByRole('searchbox');
  fireEvent.change(box, { target: { value: 'ab' } });
  await flush(450);
  expect(screen.getByText('Spotify is not answering right now.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  fireEvent.change(box, { target: { value: 'a' } });
  fireEvent.change(box, { target: { value: 'ab' } });
  await flush(450);
  expect(asked).toEqual(['ab', 'ab']);
});

describe('Up next clicks', () => {
  const queue = () => mocks.set('wall2_spotify_queue', () => ({ current: track(1), next: [track(2), track(3), track(4), track(5)] }));
  const setup = (playingId: string | null) => {
    signedIn();
    queue();
    mocks.set('wall2_spotify_playback', () => (playingId ? { playing: true, device: null, track: { ...track(1), id: playingId }, progressMs: 0, shuffle: false } : null));
    mocks.set('get_now_playing', () => null);
    const sent: [string, unknown][] = [];
    mocks.set('media_next', () => void sent.push(['media_next', null]));
    mocks.set('wall2_spotify_play', (a) => void sent.push(['play', a]));
    return sent;
  };
  const clickRow = async (i: number) => {
    await act(async () => (document.querySelectorAll('.u-next-row')[i] as HTMLButtonElement).click());
    await flush();
  };

  it('plays in its list when that list is what plays now', async () => {
    const sent = setup(id(501));
    useLastContext.setState({ context: { kind: 'playlist', id: id(9) }, ids: new Set([id(501), id(503)]) });
    playingOn('Spotify');
    render(<UpNext />);
    await flush();
    await clickRow(1);
    expect(sent).toEqual([['play', { request: { kind: 'track', id: id(503), context: { kind: 'playlist', id: id(9) }, offsetId: id(503) } }]]);
  });

  it('skips forward through Windows when Spotify is the current player and its list is not what plays', async () => {
    const sent = setup(id(777));
    useLastContext.setState({ context: { kind: 'playlist', id: id(9) }, ids: new Set([id(503)]) });
    playingOn('Spotify');
    render(<UpNext />);
    await flush();
    await clickRow(1);
    expect(sent).toEqual([
      ['media_next', null],
      ['media_next', null],
    ]);
  });

  it('sends nothing and says why when another player is in front', async () => {
    const sent = setup(null);
    playingOn('Edge');
    render(<UpNext />);
    await flush();
    await clickRow(0);
    expect(sent).toEqual([]);
    expect(screen.getByText(UP_NEXT_NONE_LINE)).toBeTruthy();
  });

  it('shows the next three with covers, hides with YouTube Music, and signed out says where to sign in', async () => {
    setup(null);
    const r = render(<UpNext />);
    await flush();
    expect([...document.querySelectorAll('.u-next-t')].map((e) => e.textContent)).toEqual(['Song 2', 'Song 3', 'Song 4']);
    // Song 2 has no cover: a neutral tile, never a gradient.
    expect(document.querySelectorAll('.u-next-row')[0].querySelector('img')).toBeNull();
    await act(async () => useListenSource.getState().setSource('youtube'));
    expect(document.querySelector('.u-next')).toBeNull();
    r.unmount();
    await act(async () => useListenSource.getState().setSource('spotify'));
    useSpotifyStatus.setState({ status: { setup: true, signedIn: false, reason: null } });
    render(<UpNext />);
    await flush();
    expect(screen.getByText('Sign in to Spotify in Tools to see what is next')).toBeTruthy();
  });
});

describe('polling stops when nobody can see it', () => {
  const hidden = (on: boolean) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => on });
  afterEach(() => hidden(false));

  it('Up next reads no queue while the page is hidden, and starts when it shows', async () => {
    signedIn();
    const reads = vi.fn(() => ({ current: track(1), next: [track(2)] }));
    mocks.set('wall2_spotify_queue', reads);
    hidden(true);
    render(<UpNext />);
    await flush(60_000);
    expect(reads).not.toHaveBeenCalled();
    hidden(false);
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    await flush();
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('the status poll stops while hidden', async () => {
    const reads = vi.fn(() => ({ setup: true, signedIn: true, reason: null }));
    mocks.set('wall2_spotify_status', reads);
    function Poll() {
      useSpotifyStatusPoll();
      return null;
    }
    render(<Poll />);
    await flush();
    expect(reads).toHaveBeenCalledTimes(1);
    hidden(true);
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    await flush(180_000);
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('nothing of Spotify is read while Unwind shows Watch', async () => {
    const reads: string[] = [];
    for (const c of ['wall2_spotify_status', 'wall2_spotify_queue', 'wall2_spotify_playlists', 'wall2_spotify_playback']) mocks.set(c, () => void reads.push(c));
    mocks.set('get_now_playing', () => null);
    useWatchStore.setState({ tab: 'watch' });
    try {
      render(<Unwind />);
      await flush(120_000);
      expect(reads).toEqual([]);
    } finally {
      useWatchStore.setState({ tab: 'listen' });
    }
  });
});

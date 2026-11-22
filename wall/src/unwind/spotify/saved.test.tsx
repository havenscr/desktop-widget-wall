import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import type { SpotifyItem, SpotifyTrack } from '../../music/spotify';
import { resetNowPlaying, useNowPlayingStore } from '../../music/store';
import { resetTools } from '../../tools/store';
import { HoverTipLayer, hideTip, resetTip } from '../../ui/HoverTip';
import {
  NOTHING_HEARD,
  NOTHING_QUEUED,
  PAGE_OFF_LINE,
  PAGE_READING,
  PAGE_NOTE_TIP,
  PAGE_OFF_HINT,
  PUBLIC_PAGE_KEY,
  pageLine,
  pageProblem,
  pageNoteMore,
  PAGE_NOTE,
  resetListenSource,
  resetPublicPage,
  usePublicPage,
  useSpotifyNow,
  useSpotifyStart,
  WHILE_HEADINGS,
  WHILE_PLAYS,
} from './model';
import { SpotifyCard } from './SpotifyCard';
import { QUEUE_POLL_MS } from './UpNext';
import { resetSpotifyStatus, useSpotifyStatus } from './status';

// Fake timers step only as far as each test needs; a loaded machine still gets room.
vi.setConfig({ testTimeout: 20_000 });

const id = (n: number) => String(n).padStart(22, '0');
const SAVED = 1;
const OWNED = 2;
const item = (n: number, count: number | null = 40): SpotifyItem => ({ id: id(n), kind: 'playlist', name: `List ${n}`, imageUrl: null, thumbUrl: null, subtitle: 'Playlist', count });
const track = (n: number, playable = true): SpotifyTrack => ({ id: playable ? id(500 + n) : null, name: `Song ${n}`, artists: 'Some Artist', album: 'Some Album', durationMs: 180_000, imageUrl: null, thumbUrl: null, playable });
const rows = (n: number, dim: number[] = []) => Array.from({ length: n }, (_, i) => track(i + 1, !dim.includes(i)));

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const signedIn = () => useSpotifyStatus.setState({ status: { setup: true, signedIn: true, reason: null }, failed: false });
const hidden = (on: boolean) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => on });

let calls: Record<string, unknown[]> = {};
const record = (name: string, result: unknown = undefined) =>
  mocks.set(name, (a) => {
    (calls[name] ??= []).push(a ?? null);
    return typeof result === 'function' ? (result as (x: unknown) => unknown)(a) : result;
  });
const count = (name: string) => (calls[name] ?? []).length;

/** The playlists tab holds a saved playlist and one the owner made; the saved one's songs are refused. */
async function setup(over: { page?: unknown; count?: number | null; playlistId?: string | null; queue?: SpotifyTrack[]; heard?: SpotifyTrack[]; nowPlayingId?: string } = {}) {
  signedIn();
  calls = {};
  mocks.set('wall2_spotify_playlists', () => [item(SAVED, over.count === undefined ? 40 : over.count), item(OWNED)]);
  mocks.set('wall2_spotify_tracks', (a) => {
    if ((a as { id: string }).id === id(SAVED)) throw new Error('not yours');
    return { items: rows(3), total: 3, more: false };
  });
  record('wall2_spotify_public_page', over.page ?? { items: rows(40), listed: 40 });
  record('wall2_spotify_playback', () => ({ playing: true, device: { name: 'Desk speakers', kind: 'Computer' }, track: { ...track(1), id: over.nowPlayingId ?? id(501) }, progressMs: 0, shuffle: false, playlistId: over.playlistId ?? null }));
  record('wall2_spotify_queue', () => ({ current: track(1), next: over.queue ?? [track(21), track(22), track(23)] }));
  record('wall2_spotify_heard', () => over.heard ?? []);
  record('wall2_spotify_play', 'played');
  record('wall2_spotify_next');
  record('media_next');
  mocks.set('wall2_spotify_devices', () => []);
  mocks.set('get_now_playing', () => null);
  render(
    <>
      <SpotifyCard />
      <HoverTipLayer />
    </>,
  );
  await flush();
}
const openList = async (n: number) => {
  await act(async () => (document.querySelectorAll('.sp-tile')[n - 1] as HTMLButtonElement).click());
  await flush();
};
const trackRows = () => [...document.querySelectorAll('.sp-track')] as HTMLButtonElement[];
const names = () => trackRows().map((r) => r.querySelector('.sp-tname')?.textContent);
const nowTitle = async (title: string) => {
  await act(async () => useNowPlayingStore.setState({ info: { title, artist: 'Some Artist', playback_status: 'playing', source_app: 'Spotify', source_app_id: 'Spotify.exe', session_key: 'Spotify.exe#1' } as never }));
  await flush();
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetListenSource();
  resetSpotifyStatus();
  resetTools();
  resetPublicPage();
  useSpotifyNow.setState({ id: null });
  useSpotifyStart.setState({ starting: false, rev: 0, name: '' });
});
afterEach(() => {
  hidden(false);
  hideTip(true);
  resetTip();
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  vi.restoreAllMocks();
});

describe('the words', () => {
  it('words the page failures and the source tag', () => {
    expect(pageProblem(new Error('not public'))).toBe('notPublic');
    expect(pageProblem('page changed')).toBe('changed');
    expect(pageProblem('page too big')).toBe('tooBig');
    expect(pageProblem('busy')).toBe('busy');
    expect(pageProblem('no connection')).toBe('connection');
    expect(pageProblem('weird')).toBe('failed');
    expect(pageProblem(42)).toBe('failed');
    expect(pageLine(null)).toBe('Spotify lists the songs only for playlists you made.');
    expect(pageLine('notPublic')).toBe("Spotify's public page does not list this playlist. It may be private.");
    expect(pageLine('changed')).toBe("Spotify's public page has changed, so the wall cannot read it.");
    expect(pageLine('tooBig')).toBe("Spotify's public page for this playlist is too large to read.");
    expect(pageLine('busy')).toBe("The wall reads Spotify's public page at most 20 times an hour. Try again later.");
    expect(pageLine('connection')).toBe("Spotify's public page did not answer.");
    expect(pageLine('failed')).toBe("Spotify's public page did not answer.");
    expect(PAGE_READING).toBe("Reading Spotify's public page.");
    expect(WHILE_PLAYS).toBe('Press Play or Shuffle: while it plays, this page shows the song playing, what comes next and what you have heard.');
    expect(Object.values(WHILE_HEADINGS)).toEqual(['Playing now', 'Paused', 'Up next in Spotify', 'Heard from this playlist']);
    expect(pageLine('empty')).toBe("Spotify's public page listed no songs for this playlist.");
    expect(NOTHING_QUEUED).toBe('Nothing queued.');
    expect(NOTHING_HEARD).toBe('Nothing heard yet. Spotify adds a song here after about half a minute of play.');
    expect(PAGE_NOTE).toBe('public page');
    expect(pageNoteMore(40, 40)).toBe('');
    expect(pageNoteMore(50, 40)).toBe('');
    expect(pageNoteMore(40, null)).toBe('');
    expect(pageNoteMore(100, 520)).toBe(' Only the first 100 of 520 songs are listed.');
  });
});

describe('a playlist the owner made', () => {
  it('reads only the Web API: no public page call and no source tag', async () => {
    await setup();
    await openList(OWNED);
    expect(names()).toEqual(['Song 1', 'Song 2', 'Song 3']);
    expect(count('wall2_spotify_public_page')).toBe(0);
    expect(document.querySelector('.sp-source')).toBeNull();
  });
});

describe('a saved playlist with the public page on', () => {
  it('says it is reading (busy), then lists the rows in page order under the tag', async () => {
    let release: (v: unknown) => void = () => undefined;
    await setup({ page: new Promise((resolve) => (release = resolve)), count: 5, nowPlayingId: id(999) });
    await openList(SAVED);
    expect(screen.getByText(PAGE_READING).getAttribute('aria-busy')).toBe('true');
    expect(trackRows()).toHaveLength(0);
    await act(async () => release({ items: rows(5), listed: 5 }));
    await flush();
    expect(screen.queryByText(PAGE_READING)).toBeNull();
    expect(screen.getByText('public page')).toBeTruthy();
    expect(names()).toEqual(['Song 1', 'Song 2', 'Song 3', 'Song 4', 'Song 5']);
    expect([...document.querySelectorAll('.sp-num')].map((n) => n.textContent)).toEqual(['1', '2', '3', '4', '5']);
    expect(count('wall2_spotify_public_page')).toBe(1);
    expect(calls['wall2_spotify_public_page'][0]).toEqual({ id: id(SAVED) });
  });

  it('says "first N of M" only when the page held fewer songs than the playlist, and sums the length only when every song is listed', async () => {
    await setup({ page: { items: rows(100), listed: 100 }, count: 520 });
    await openList(SAVED);
    expect(screen.getByText('public page')).toBeTruthy();
    const facts = document.querySelector('.sp-shead .sp-line')?.textContent ?? '';
    expect(facts).toContain('520 songs');
    expect(facts).not.toMatch(/\bmin\b/);
  });

  it('shows the whole length and the plain tag when every song is listed', async () => {
    await setup({ page: { items: rows(40), listed: 40 }, count: 40 });
    await openList(SAVED);
    expect(screen.getByText('public page')).toBeTruthy();
    const facts = document.querySelector('.sp-shead .sp-line')?.textContent ?? '';
    expect(facts).toContain('40 songs');
    expect(facts).toContain('2 h 0 min');
  });

  it('uses the page count when the playlist count is unknown', async () => {
    await setup({ page: { items: rows(7), listed: 7 }, count: null });
    await openList(SAVED);
    expect(screen.getByText('public page')).toBeTruthy();
    expect(document.querySelector('.sp-shead .sp-line')?.textContent).toContain('7 songs');
  });

  it('has no row of its own for the public page: the note is beside the playlist facts, with a tip that says what it means', async () => {
    await setup();
    await openList(SAVED);
    expect(document.querySelector('.sp-source')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
    const note = document.querySelector('.sp-shead .sp-line .sp-pnote') as HTMLElement;
    expect(note.textContent).toBe('public page');
    await act(async () => void fireEvent.mouseEnter(note));
    await flush(1000);
    expect(document.body.textContent).toContain(PAGE_NOTE_TIP);
    expect(PAGE_NOTE_TIP).toContain('not through the sign-in');
    expect(PAGE_NOTE_TIP).toContain('against Spotify');
  });

  it('the card heading is a way home: inside a playlist it closes it with a tip, on the first page it does nothing new', async () => {
    await setup();
    const heading = screen.getByRole('radio', { name: /Spotify/ });
    const tipOf = async () => {
      hideTip(true);
      await act(async () => void fireEvent.mouseEnter(heading));
      await flush(1000);
      return document.body.textContent ?? '';
    };
    expect(await tipOf()).not.toContain('Back to Spotify home');
    await act(async () => heading.click());
    expect(document.querySelector('.sp-songs')).toBeNull();
    await openList(SAVED);
    expect(document.querySelector('.sp-songs')).not.toBeNull();
    expect(await tipOf()).toContain('Back to Spotify home');
    await act(async () => heading.click());
    await flush();
    expect(document.querySelector('.sp-songs')).toBeNull();
    expect(await tipOf()).not.toContain('Back to Spotify home');
  });

  it('plays the playlist from a clicked row, and does nothing for a row that cannot play', async () => {
    await setup({ page: { items: rows(5, [1]), listed: 5 }, count: 5 });
    await openList(SAVED);
    const list = trackRows();
    await act(async () => list[2].click());
    await flush();
    expect(calls['wall2_spotify_play']).toHaveLength(1);
    expect(calls['wall2_spotify_play'][0]).toMatchObject({ request: { kind: 'track', id: id(503), context: { kind: 'playlist', id: id(SAVED) }, offsetId: id(503) } });
    // The dim row: marked, disabled, sends nothing, and its tip is today's.
    expect(list[1].className).toContain('off');
    expect(list[1].getAttribute('aria-disabled')).toBe('true');
    await act(async () => list[1].click());
    await flush();
    expect(calls['wall2_spotify_play']).toHaveLength(1);
    await act(async () => void fireEvent.mouseEnter(list[1]));
    await flush(1000);
    expect(document.body.textContent).toContain('This song cannot be played here: it is a local file, or not available in this country.');
  });

  it('marks the song playing now in the page rows', async () => {
    await setup({ page: { items: rows(5), listed: 5 }, count: 5, nowPlayingId: id(503) });
    await openList(SAVED);
    await nowTitle('Song 3');
    const on = [...document.querySelectorAll('.sp-track.on')];
    expect(on).toHaveLength(1);
    expect(on[0].querySelector('.sp-tname')?.textContent).toBe('Song 3');
  });
});

describe('a saved playlist with no list', () => {
  it('with the switch off asks no page at all and shows the switch off line and what Play does', async () => {
    await setup();
    usePublicPage.getState().setOn(false);
    await openList(SAVED);
    expect(count('wall2_spotify_public_page')).toBe(0);
    expect(screen.getByText(PAGE_OFF_LINE)).toBeTruthy();
    expect(screen.getByText(WHILE_PLAYS)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  const failing: [string, string, string][] = [
    ['not public', 'notPublic', "Spotify's public page does not list this playlist. It may be private."],
    ['page changed', 'changed', "Spotify's public page has changed, so the wall cannot read it."],
    ['page too big', 'tooBig', "Spotify's public page for this playlist is too large to read."],
    ['busy', 'busy', "The wall reads Spotify's public page at most 20 times an hour. Try again later."],
  ];
  for (const [word, , line] of failing) {
    it(`"${word}": its own line, what Play does, and no Retry`, async () => {
      await setup();
      mocks.set('wall2_spotify_public_page', () => {
        throw new Error(word);
      });
      await openList(SAVED);
      expect(screen.getByText(line)).toBeTruthy();
      expect(screen.getByText(WHILE_PLAYS)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });
  }

  it('"no connection": the did not answer line with Retry, which asks the page again', async () => {
    await setup();
    let asked = 0;
    mocks.set('wall2_spotify_public_page', () => {
      asked += 1;
      if (asked === 1) throw new Error('no connection');
      return { items: rows(3), listed: 3 };
    });
    await openList(SAVED);
    expect(screen.getByText("Spotify's public page did not answer.")).toBeTruthy();
    expect(screen.getByText(WHILE_PLAYS)).toBeTruthy();
    // The failure is kept for a minute: no Retry until it has passed, and the page says so.
    expect(screen.getByText('Try again in a minute.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    await flush(59_000);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    await flush(1_000);
    expect(screen.queryByText('Try again in a minute.')).toBeNull();
    await act(async () => screen.getByRole('button', { name: 'Retry' }).click());
    await flush();
    expect(asked).toBe(2);
    expect(names()).toEqual(['Song 1', 'Song 2', 'Song 3']);
  });

  it('an unknown failure also offers Retry (after a minute); an empty page has its own words', async () => {
    await setup();
    mocks.set('wall2_spotify_public_page', () => {
      throw new Error('weird');
    });
    await openList(SAVED);
    await flush(60_000);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    mocks.set('wall2_spotify_public_page', () => ({ items: [], listed: 0 }));
    await act(async () => screen.getByRole('button', { name: 'Retry' }).click());
    await flush();
    // A page that answers with no usable rows has its own words (not the private page line).
    expect(screen.getByText("Spotify's public page listed no songs for this playlist.")).toBeTruthy();
    expect(screen.queryByText("Spotify's public page does not list this playlist. It may be private.")).toBeNull();
  });

  it('the switch in the store stops the list at once and the off line points at Tools; turning it on reads again', async () => {
    await setup({ page: { items: rows(3), listed: 3 }, count: 3 });
    await openList(SAVED);
    expect(trackRows()).toHaveLength(3);
    await act(async () => usePublicPage.getState().setOn(false));
    await flush();
    expect(trackRows()).toHaveLength(0);
    expect(screen.getByText(PAGE_OFF_LINE)).toBeTruthy();
    expect(screen.getByText(PAGE_OFF_HINT)).toBeTruthy();
    expect(screen.getByText(WHILE_PLAYS)).toBeTruthy();
    expect(count('wall2_spotify_public_page')).toBe(1);
    await act(async () => usePublicPage.getState().setOn(true));
    await flush();
    expect(trackRows()).toHaveLength(3);
    expect(count('wall2_spotify_public_page')).toBe(2);
  });

  it('the off line from the start points at the switch in Tools', async () => {
    await setup();
    usePublicPage.getState().setOn(false);
    await openList(SAVED);
    expect(screen.getByText(PAGE_OFF_HINT)).toBeTruthy();
    expect(count('wall2_spotify_public_page')).toBe(0);
  });
});


describe('while it plays (no list)', () => {
  const failPage = () =>
    mocks.set('wall2_spotify_public_page', () => {
      throw new Error('not public');
    });
  const heard = [track(31), track(32), track(1)];

  it('this playlist playing: the song playing, the queue and what was heard, without the song playing', async () => {
    await setup({ playlistId: id(SAVED), heard, queue: [track(21), track(22), track(23)], nowPlayingId: id(501) });
    failPage();
    await openList(SAVED);
    const heads = [...document.querySelectorAll('.sp-sec')].map((h) => h.textContent);
    expect(heads).toEqual(['Playing now', 'Up next in Spotify', 'Heard from this playlist']);
    expect(names()).toEqual(['Song 1', 'Song 21', 'Song 22', 'Song 23', 'Song 31', 'Song 32']);
    expect(screen.queryByText(WHILE_PLAYS)).toBeNull();
    expect(document.querySelectorAll('.sp-track.on')).toHaveLength(1);
  });

  it('shows the first 8 queued songs with one line for the rest, and says when nothing is heard', async () => {
    await setup({ playlistId: id(SAVED), queue: Array.from({ length: 20 }, (_, n) => track(100 + n)), heard: [] });
    failPage();
    await openList(SAVED);
    expect(trackRows()).toHaveLength(9);
    expect(screen.getByText('12 more in Up next')).toBeTruthy();
    // Heard follows directly, in sight.
    expect(screen.getByText(NOTHING_HEARD)).toBeTruthy();
    expect(screen.queryByText(NOTHING_QUEUED)).toBeNull();
  });

  it('says nothing queued when the queue is empty', async () => {
    await setup({ playlistId: id(SAVED), queue: [], heard: [] });
    failPage();
    await openList(SAVED);
    expect(screen.getByText(NOTHING_QUEUED)).toBeTruthy();
  });

  it('another playlist playing, or nothing: only the line and what Play does', async () => {
    await setup({ playlistId: id(9) });
    failPage();
    await openList(SAVED);
    expect(screen.getByText("Spotify's public page does not list this playlist. It may be private.")).toBeTruthy();
    expect(screen.getByText(WHILE_PLAYS)).toBeTruthy();
    expect(document.querySelectorAll('.sp-sec')).toHaveLength(0);
    expect(count('wall2_spotify_queue')).toBe(0);
    expect(count('wall2_spotify_heard')).toBe(0);
    mocks.set('wall2_spotify_playback', () => null);
    await flush(QUEUE_POLL_MS);
    expect(document.querySelectorAll('.sp-sec')).toHaveLength(0);
  });

  it('reads playback and the queue on open, on a song change and every 20 s; heard on open and on a song change only', async () => {
    await setup({ playlistId: id(SAVED), heard });
    failPage();
    await openList(SAVED);
    expect([count('wall2_spotify_playback'), count('wall2_spotify_queue'), count('wall2_spotify_heard')]).toEqual([expect.any(Number), 1, 1]);
    const p0 = count('wall2_spotify_playback');
    await flush(QUEUE_POLL_MS);
    expect(count('wall2_spotify_queue')).toBe(2);
    expect(count('wall2_spotify_heard')).toBe(1);
    expect(count('wall2_spotify_playback')).toBeGreaterThan(p0);
    // A new title alone moves the queue read; the heard list follows the playing song's id from the playback read.
    await nowTitle('Song 22');
    expect(count('wall2_spotify_queue')).toBe(3);
    expect(count('wall2_spotify_heard')).toBe(1);
    record('wall2_spotify_playback', () => ({ playing: true, device: { name: 'Desk speakers', kind: 'Computer' }, track: { ...track(2), id: id(502) }, progressMs: 0, shuffle: false, playlistId: id(SAVED) }));
    await flush(QUEUE_POLL_MS);
    expect(count('wall2_spotify_heard')).toBe(2);
  });

  it('reads nothing while the page is hidden', async () => {
    await setup({ playlistId: id(SAVED), heard });
    failPage();
    await openList(SAVED);
    hidden(true);
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    await flush();
    // The card's own playing mark reads playback on a song change; this page adds no read of the queue or the heard list.
    const before = [count('wall2_spotify_queue'), count('wall2_spotify_heard')];
    await flush(120_000);
    await nowTitle('Song 99');
    expect([count('wall2_spotify_queue'), count('wall2_spotify_heard')]).toEqual(before);
  });

  it('a heard row plays the playlist from that song; the playing row does nothing', async () => {
    await setup({ playlistId: id(SAVED), heard, queue: [] });
    failPage();
    await openList(SAVED);
    const now = trackRows()[0];
    expect(now.getAttribute('aria-disabled')).toBe('true');
    await act(async () => now.click());
    await flush();
    expect(count('wall2_spotify_play')).toBe(0);
    const heardRow = trackRows().find((r) => r.querySelector('.sp-tname')?.textContent === 'Song 32') as HTMLButtonElement;
    await act(async () => heardRow.click());
    await flush();
    expect(calls['wall2_spotify_play']).toHaveLength(1);
    expect(calls['wall2_spotify_play'][0]).toMatchObject({ request: { kind: 'track', id: id(532), context: { kind: 'playlist', id: id(SAVED) }, offsetId: id(532) } });
  });

  it('an Up next row skips forward once per row up to it, and never starts anything', async () => {
    await setup({ playlistId: id(SAVED), heard: [], queue: [track(21), track(22), track(23)] });
    failPage();
    await openList(SAVED);
    const second = trackRows().find((r) => r.querySelector('.sp-tname')?.textContent === 'Song 22') as HTMLButtonElement;
    await act(async () => second.click());
    await flush();
    expect(count('wall2_spotify_next')).toBe(2);
    expect(count('wall2_spotify_play')).toBe(0);
  });
});

describe('the public page choice', () => {
  it('stays on by default, survives a restart when off, and works with storage blocked', () => {
    expect(usePublicPage.getState().on).toBe(true);
    usePublicPage.getState().setOn(false);
    expect(localStorage.getItem(PUBLIC_PAGE_KEY)).toBe('off');
    usePublicPage.setState({ on: true });
    resetPublicPage();
    expect(usePublicPage.getState().on).toBe(false);
    usePublicPage.getState().setOn(true);
    expect(localStorage.getItem(PUBLIC_PAGE_KEY)).toBe('on');
    localStorage.setItem(PUBLIC_PAGE_KEY, 'something else');
    resetPublicPage();
    expect(usePublicPage.getState().on).toBe(true);
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    resetPublicPage();
    expect(usePublicPage.getState().on).toBe(true);
    expect(() => usePublicPage.getState().setOn(false)).not.toThrow();
    expect(usePublicPage.getState().on).toBe(false);
  });
});

// Fix round 1, items 1 to 4: written before the changes, against the code as it was.
describe('fix round 1: no state of the page carries a switch of its own', () => {
  const TERMS = "Reading the page is against Spotify's developer terms and may stop working.";
  const failWith = (word: string): void => {
    mocks.set('wall2_spotify_public_page', () => {
      throw new Error(word);
    });
  };
  const hasOff = () => !!screen.queryByRole('button', { name: /^(Turn off|Read public page)$/ });
  const states: [string, () => void | Promise<void>][] = [
    ['listed', () => undefined],
    ['did not answer', () => failWith('no connection')],
    ['private or removed', () => failWith('not public')],
    ['hourly limit', () => failWith('busy')],
    ['page changed', () => failWith('page changed')],
    ['too big', () => failWith('page too big')],
  ];
  for (const [name, prepare] of states) {
    it(`page on, ${name}: no Turn off on the page`, async () => {
      await setup({ page: { items: rows(3), listed: 3 }, count: 3 });
      await prepare();
      await openList(SAVED);
      expect(hasOff()).toBe(false);
    });
  }
  it('page on, reading: no Turn off on the page', async () => {
    await setup({ page: new Promise(() => undefined), count: 3 });
    await openList(SAVED);
    expect(screen.getByText(PAGE_READING)).toBeTruthy();
    expect(hasOff()).toBe(false);
  });
  it('page on, no songs listed: no Turn off on the page', async () => {
    await setup({ page: { items: [], listed: 0 } });
    await openList(SAVED);
    expect(hasOff()).toBe(false);
  });
  it('page on, this playlist playing and the page failed: no Turn off on the page', async () => {
    await setup({ playlistId: id(SAVED) });
    failWith('not public');
    await openList(SAVED);
    expect(document.querySelectorAll('.sp-sec').length).toBe(3);
    expect(hasOff()).toBe(false);
  });
  it('page off, nothing playing: the terms sentence and the Tools hint are on the page', async () => {
    await setup();
    usePublicPage.getState().setOn(false);
    await openList(SAVED);
    expect(screen.getByText(PAGE_OFF_HINT)).toBeTruthy();
    expect(screen.getByText(TERMS)).toBeTruthy();
  });
  it('page off, this playlist playing: the terms sentence and the Tools hint are on the page', async () => {
    await setup({ playlistId: id(SAVED) });
    usePublicPage.getState().setOn(false);
    await openList(SAVED);
    expect(document.querySelectorAll('.sp-sec').length).toBe(3);
    expect(screen.getByText(PAGE_OFF_HINT)).toBeTruthy();
    expect(screen.getByText(TERMS)).toBeTruthy();
  });
  it('a page of more than 200 songs is labelled by the rows returned: first 200 of 500', async () => {
    await setup({ page: { items: rows(200), listed: 500 }, count: 500 });
    await openList(SAVED);
    expect(screen.getByText('public page')).toBeTruthy();
    await act(async () => void fireEvent.mouseEnter(screen.getByText('public page')));
    await flush(1000);
    expect(document.body.textContent).toContain('Only the first 200 of 500 songs are listed.');
    expect(trackRows()).toHaveLength(200);
  });
  it('a failed queue refresh leaves no clickable stale rows and says so', async () => {
    await setup({ playlistId: id(SAVED), heard: [], queue: [track(21), track(22), track(23)] });
    failWith('not public');
    await openList(SAVED);
    expect(names()).toContain('Song 22');
    mocks.set('wall2_spotify_queue', () => {
      throw new Error('down');
    });
    await flush(QUEUE_POLL_MS);
    expect(screen.getByText('Could not read the queue just now.')).toBeTruthy();
    const second = trackRows().find((r) => r.querySelector('.sp-tname')?.textContent === 'Song 22');
    if (second) await act(async () => second.click());
    await flush();
    expect(count('wall2_spotify_next')).toBe(0);
  });
});

describe('fix round 1: the rest', () => {
  const failPage = () =>
    mocks.set('wall2_spotify_public_page', () => {
      throw new Error('not public');
    });

  it('an answer that arrives late for an older page is dropped', async () => {
    // Two saved playlists whose songs are refused; each page read is held until the test lets it go.
    signedIn();
    calls = {};
    mocks.set('wall2_spotify_playlists', () => [item(SAVED, 3), item(OWNED, 3)]);
    mocks.set('wall2_spotify_tracks', () => {
      throw new Error('not yours');
    });
    const release: Record<string, (v: unknown) => void> = {};
    mocks.set('wall2_spotify_public_page', (a) => new Promise((resolve) => (release[(a as { id: string }).id] = resolve)));
    record('wall2_spotify_playback', null);
    mocks.set('wall2_spotify_devices', () => []);
    mocks.set('get_now_playing', () => null);
    render(<SpotifyCard />);
    await flush();
    await openList(SAVED);
    await act(async () => (document.querySelector('.sp-back') as HTMLButtonElement).click());
    await flush();
    await openList(OWNED);
    await act(async () => release[id(OWNED)]({ items: [{ ...track(7), name: 'Newer Page Song' }], listed: 1 }));
    await flush();
    expect(names()).toEqual(['Newer Page Song']);
    await act(async () => release[id(SAVED)]({ items: [{ ...track(8), name: 'Older Page Song' }], listed: 1 }));
    await flush();
    expect(names()).toEqual(['Newer Page Song']);
  });

  it('a song with no length gets an empty cell, and the total length waits for every length', async () => {
    const page = { items: [track(1), { ...track(2), durationMs: 0 }, track(3)], listed: 3 };
    await setup({ page, count: 3 });
    await openList(SAVED);
    const cells = [...document.querySelectorAll('.sp-tlen')].map((c) => c.textContent);
    expect(cells).toEqual(['3:00', '', '3:00']);
    expect(document.querySelector('.sp-shead .sp-line')?.textContent).not.toMatch(/\bmin\b/);
  });

  it('the section headings are real headings, and a paused song says Paused', async () => {
    await setup({ playlistId: id(SAVED), heard: [], queue: [] });
    failPage();
    record('wall2_spotify_playback', () => ({ playing: false, device: { name: 'Desk speakers', kind: 'Computer' }, track: track(1), progressMs: 0, shuffle: false, playlistId: id(SAVED) }));
    await openList(SAVED);
    expect(screen.getByRole('heading', { name: 'Paused' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Up next in Spotify' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Heard from this playlist' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Playing now' })).toBeNull();
  });

  it('a page row the page calls unplayable is not dimmed for that reason: only a row with no track id is', async () => {
    // The page's own flag describes a signed out reader, so the wall never reads it: rows arrive playable with an id.
    await setup({ page: { items: [track(1), track(2)], listed: 2 }, count: 2 });
    await openList(SAVED);
    expect(document.querySelectorAll('.sp-track.off')).toHaveLength(0);
  });

  it('the line for the rest of the queue is a button in the tall card and opens the Up next tab', async () => {
    await setup({ playlistId: id(SAVED), heard: [], queue: Array.from({ length: 20 }, (_, n) => track(100 + n)) });
    failPage();
    fireEvent.pointerEnter(document.querySelector('.sp-card') as HTMLElement);
    await flush(1500);
    await openList(SAVED);
    await act(async () => screen.getByRole('button', { name: '12 more in Up next' }).click());
    await flush();
    expect(document.querySelector('.sp-songs')).toBeNull();
    expect(document.querySelector('.mu-places [aria-selected="true"]')?.textContent).toBe('Up next');
  });
});

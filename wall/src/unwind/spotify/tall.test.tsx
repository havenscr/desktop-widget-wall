import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import type { SpotifyDevice, SpotifyItem, SpotifyTrack } from '../../music/spotify';
import { resetNowPlaying } from '../../music/store';
import { resetTools } from '../../tools/store';
import { hideTip, resetTip } from '../../ui/HoverTip';
import { deviceKindWord, GONE_LINE, LOCKED_LINE, NOT_YOURS_LINE, playDeviceId, resetSpotifyTarget, resetListenSource, seekPosition, SEARCH_WAIT_MS, TALL_CLOSE_MS, useListenSource, useSpotifyDevices, useSpotifyNow, useSpotifyStart, useSpotifyTarget } from './model';
import { deviceRows, DEVICES_FOOT, STALE_NOTE } from './PlayOn';
import { PLAYBACK_POLL_MS, SEEK_KEY_GAP_MS, SEEK_STEP_MS } from './PlayerRow';
import { SpotifyCard } from './SpotifyCard';
import { QUEUE_NOTE } from './TallViews';
import { arrowTarget, gridColumns } from './Tile';
import { resetSpotifyStatus, useSpotifyStatus } from './status';

vi.setConfig({ testTimeout: 20_000 });

const id = (n: number) => String(n).padStart(22, '0');
const dev = (n: number) => n.toString(16).padStart(40, '0');
const item = (n: number, kind: SpotifyItem['kind'] = 'playlist', name = `List ${n}`): SpotifyItem => ({ id: id(n), kind, name, imageUrl: null, thumbUrl: null, subtitle: kind === 'playlist' ? 'Playlist' : 'Some Artist', count: kind === 'track' ? null : 20 });
const track = (n: number): SpotifyTrack => ({ id: id(500 + n), name: `Song ${n}`, artists: 'Some Artist', album: 'Some Album', durationMs: 200_000, imageUrl: null, thumbUrl: null, playable: true });
const device = (n: number, name: string, kind: string, active = false, restricted = false): SpotifyDevice => ({ id: dev(n), name, kind, active, restricted, volume: 30 });
const DEVICES = [device(1, 'Desk speakers', 'Computer', true), device(2, 'Phone', 'Smartphone'), device(3, 'Kitchen speaker', 'Speaker')];

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const signedIn = () => useSpotifyStatus.setState({ status: { setup: true, signedIn: true, reason: null }, failed: false });
const windows = (app: string, id2: string) => mocks.set('get_now_playing', () => ({ title: 'Song 1', artist: 'Some Artist', playback_status: 'playing', source_app: app, source_app_id: id2 }));

let sent: [string, unknown][] = [];
const record = (name: string, result: unknown = undefined) => mocks.set(name, (a) => {
  sent.push([name, a]);
  return result;
});
let behind = vi.fn();

/** A signed-in card with every Spotify read mocked, and a button "Behind" outside it. */
async function setup(over: { devices?: SpotifyDevice[]; playing?: boolean } = {}) {
  signedIn();
  sent = [];
  behind = vi.fn();
  const playing = over.playing ?? true;
  mocks.set('wall2_spotify_playlists', () => Array.from({ length: 12 }, (_, n) => item(n + 1)));
  mocks.set('wall2_spotify_albums', () => [item(30, 'album')]);
  mocks.set('wall2_spotify_liked', () => [item(40, 'track')]);
  mocks.set('wall2_spotify_recent', () => []);
  mocks.set('wall2_spotify_tracks', () => ({ items: [track(1), track(2), track(3)], total: 3, more: false }));
  mocks.set('wall2_spotify_queue', () => ({ current: track(1), next: [track(2), track(3), track(4)] }));
  mocks.set('wall2_spotify_playback', () => (playing ? { playing: true, device: { name: 'Desk speakers', kind: 'Computer' }, track: track(1), progressMs: 65_000, shuffle: false } : null));
  mocks.set('wall2_spotify_devices', () => over.devices ?? DEVICES);
  mocks.set('wall2_spotify_search', () => ({ tracks: [1, 2, 3, 4].map((n) => item(n, 'track', `Hit ${n}`)), albums: [1, 2, 3, 4, 5].map((n) => item(50 + n, 'album', `Album ${n}`)), playlists: [1, 2, 3, 4, 5].map((n) => item(60 + n, 'playlist', `Mix ${n}`)) }));
  record('wall2_spotify_transfer');
  record('wall2_spotify_seek');
  record('wall2_spotify_play', 'played');
  record('media_next');
  record('media_previous');
  record('media_play_pause');
  record('wall2_spotify_pause');
  record('wall2_spotify_resume');
  record('wall2_spotify_next');
  record('wall2_spotify_previous');
  windows('Spotify', 'Spotify.exe');
  const view = render(
    <>
      <SpotifyCard />
      <button type="button" onClick={() => behind()}>
        Behind
      </button>
    </>,
  );
  await flush();
  return view;
}
const card = () => document.querySelector('.sp-card') as HTMLElement;
const isTall = () => card().getAttribute('data-tall') === 'true';
const openButton = () => screen.getByRole('button', { name: /the tall music view/ });
const open = async () => {
  // A click on the button has the pointer on the card.
  fireEvent.pointerEnter(card());
  await act(async () => openButton().click());
  await flush();
};
const chip = () => screen.getByRole('button', { name: /^Play on/ });
const key = (k: string) => fireEvent.keyDown(document.body, { key: k });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetListenSource();
  resetSpotifyStatus();
  resetTools();
  resetSpotifyTarget();
  useSpotifyNow.setState({ id: null });
  useSpotifyStart.setState({ starting: false, rev: 0, name: '' });
  useSpotifyDevices.setState({ devices: null, stale: false, problem: null });
});
afterEach(() => {
  hideTip(true);
  resetTip();
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
});

describe('helpers', () => {
  it('places a seek along the bar and never past the ends', () => {
    expect(seekPosition(0.5, 200_000)).toBe(100_000);
    expect(seekPosition(-1, 200_000)).toBe(0);
    expect(seekPosition(2, 200_000)).toBe(200_000);
    expect(seekPosition(0.5, 0)).toBe(0);
    expect(seekPosition(Number.NaN, 200_000)).toBe(0);
  });
  it('words a device kind and builds the chooser rows', () => {
    expect(deviceKindWord('Computer')).toBe('Computer');
    expect(deviceKindWord('Smartphone')).toBe('Phone');
    expect(deviceKindWord('unknown')).toBe('Player');
    const rows = deviceRows(DEVICES, null);
    expect(rows.map((r) => [r.name, r.on])).toEqual([['Desk speakers', true], ['Phone', false], ['Kitchen speaker', false]]);
    // The owner's pick wins over the active one.
    expect(deviceRows(DEVICES, dev(3)).map((r) => r.on)).toEqual([false, false, true]);
    // No computer awake: "This PC" comes first and says the wall starts Spotify.
    const none = deviceRows([DEVICES[1]], null);
    expect(none[0]).toMatchObject({ name: 'This PC', line: 'Spotify is closed. The wall starts it.' });
    expect(deviceRows([device(2, 'Phone', 'Smartphone', false, true)], null)[1].dim).toBe(true);
  });
});

describe('opening and closing the tall view', () => {
  it('starts closed with one round button, and opens on it and on the empty part of the top row', async () => {
    await setup();
    expect(isTall()).toBe(false);
    expect(document.querySelector('.sp-player')).toBeNull();
    await open();
    expect(isTall()).toBe(true);
    expect(document.querySelector('.sp-player')).not.toBeNull();
    // Closed again through the same button, then the top row.
    await act(async () => openButton().click());
    expect(isTall()).toBe(false);
    await act(async () => fireEvent.click(document.querySelector('.sp-top') as HTMLElement));
    expect(isTall()).toBe(true);
  });

  it('does not open on a click on the switch or the chip', async () => {
    await setup();
    await act(async () => screen.getByRole('radio', { name: 'Spotify' }).click());
    expect(isTall()).toBe(false);
    await act(async () => chip().click());
    expect(isTall()).toBe(false);
  });

  it('the open state is not kept: a new card starts closed', async () => {
    const view = await setup();
    await open();
    view.unmount();
    await setup();
    expect(isTall()).toBe(false);
  });

  it('closes on Escape and gives the focus back to the button', async () => {
    await setup();
    await open();
    key('Escape');
    expect(isTall()).toBe(false);
    expect(document.activeElement).toBe(openButton());
  });

  it('Escape closes the chooser first, then a playlist goes Back, then the view closes', async () => {
    await setup();
    await open();
    await act(async () => chip().click());
    await flush();
    expect(document.querySelector('.sp-devices')).not.toBeNull();
    await act(async () => (document.querySelector('.sp-tile') as HTMLButtonElement).click());
    await flush();
    expect(document.querySelector('.sp-songs.tall')).not.toBeNull();
    key('Escape');
    expect(document.querySelector('.sp-devices')).toBeNull();
    expect(document.querySelector('.sp-songs')).not.toBeNull();
    expect(isTall()).toBe(true);
    expect(document.activeElement).toBe(chip());
    key('Escape');
    expect(document.querySelector('.sp-songs')).toBeNull();
    expect(isTall()).toBe(true);
    key('Escape');
    expect(isTall()).toBe(false);
  });

  it('closes on a press outside, and that press does not also press what is behind (once)', async () => {
    await setup();
    await open();
    const target = screen.getByText('Behind');
    await act(async () => {
      fireEvent.pointerDown(target);
      fireEvent.mouseDown(target);
      fireEvent.pointerUp(target);
      fireEvent.mouseUp(target);
      fireEvent.click(target);
    });
    expect(isTall()).toBe(false);
    expect(behind).not.toHaveBeenCalled();
    await flush(1);
    await act(async () => fireEvent.click(target));
    expect(behind).toHaveBeenCalledTimes(1);
  });

  it('a press held for a long time still has its click swallowed, and only that one', async () => {
    await setup();
    await open();
    const target = screen.getByText('Behind');
    await act(async () => fireEvent.pointerDown(target));
    expect(isTall()).toBe(false);
    await flush(30_000);
    await act(async () => {
      fireEvent.mouseUp(target);
      fireEvent.click(target);
    });
    expect(behind).not.toHaveBeenCalled();
    await flush(1);
    await act(async () => fireEvent.click(target));
    expect(behind).toHaveBeenCalledTimes(1);
  });

  it('a press that is cancelled (or a context menu) stops the swallowing with it', async () => {
    await setup();
    await open();
    const target = screen.getByText('Behind');
    await act(async () => fireEvent.pointerDown(target));
    await act(async () => fireEvent.pointerCancel(target));
    await act(async () => fireEvent.click(target));
    expect(behind).toHaveBeenCalledTimes(1);
    await open();
    await act(async () => fireEvent.pointerDown(target));
    await act(async () => fireEvent.contextMenu(target));
    await act(async () => fireEvent.click(target));
    expect(behind).toHaveBeenCalledTimes(2);
  });

  it('a press inside the card, or on a tile details card, does not close it', async () => {
    await setup();
    await open();
    await act(async () => fireEvent.pointerDown(document.querySelector('.sp-tile') as HTMLElement));
    expect(isTall()).toBe(true);
    const tipCard = document.createElement('div');
    tipCard.className = 'hover-tip';
    const inner = document.createElement('button');
    tipCard.appendChild(inner);
    document.body.appendChild(tipCard);
    await act(async () => fireEvent.pointerDown(inner));
    expect(isTall()).toBe(true);
    tipCard.remove();
  });

  describe('by itself, 15 seconds after the pointer has left', () => {
    it('never while the pointer is on it; closes 15 s after it leaves; a re-entry starts over', async () => {
      await setup();
      await open();
      const c = card();
      fireEvent.pointerEnter(c);
      await flush(TALL_CLOSE_MS * 3);
      expect(isTall()).toBe(true);
      fireEvent.pointerLeave(c);
      await flush(TALL_CLOSE_MS - 1);
      expect(isTall()).toBe(true);
      fireEvent.pointerEnter(c);
      await flush(TALL_CLOSE_MS * 2);
      expect(isTall()).toBe(true);
      fireEvent.pointerLeave(c);
      await flush(TALL_CLOSE_MS - 1);
      expect(isTall()).toBe(true);
      await flush(1);
      expect(isTall()).toBe(false);
    });

    it('never while the search box has focus; the 15 s start when it loses it with the pointer away', async () => {
      await setup();
      await open();
      const c = card();
      const field = screen.getByRole('searchbox');
      fireEvent.pointerEnter(c);
      await act(async () => field.focus());
      fireEvent.pointerLeave(c);
      await flush(TALL_CLOSE_MS * 3);
      expect(isTall()).toBe(true);
      await act(async () => field.blur());
      await flush(TALL_CLOSE_MS - 1);
      expect(isTall()).toBe(true);
      await flush(1);
      expect(isTall()).toBe(false);
    });

    it('closes the chooser with it', async () => {
      await setup();
      await open();
      await act(async () => chip().click());
      fireEvent.pointerEnter(card());
      fireEvent.pointerLeave(card());
      await flush(TALL_CLOSE_MS);
      expect(isTall()).toBe(false);
      expect(document.querySelector('.sp-devices')).toBeNull();
    });
  });

  it('leaves no timer and no listener behind after it is taken away', async () => {
    const added: string[] = [];
    const removed: string[] = [];
    const add = vi.spyOn(document, 'addEventListener').mockImplementation(function (this: Document, type: string, ...rest: unknown[]) {
      added.push(type);
      return EventTarget.prototype.addEventListener.call(this, type, ...(rest as [EventListenerOrEventListenerObject]));
    } as never);
    const remove = vi.spyOn(document, 'removeEventListener').mockImplementation(function (this: Document, type: string, ...rest: unknown[]) {
      removed.push(type);
      return EventTarget.prototype.removeEventListener.call(this, type, ...(rest as [EventListenerOrEventListenerObject]));
    } as never);
    const view = await setup();
    await open();
    await act(async () => chip().click());
    fireEvent.pointerEnter(card());
    fireEvent.pointerLeave(card());
    await act(async () => fireEvent.pointerDown(document.body));
    view.unmount();
    const count = (list: string[], t: string) => list.filter((x) => x === t).length;
    for (const t of ['keydown', 'pointerdown', 'mousedown', 'mouseup', 'click']) {
      expect(count(removed, t), t).toBe(count(added, t));
    }
    add.mockRestore();
    remove.mockRestore();
    await flush(TALL_CLOSE_MS * 2);
    expect(vi.getTimerCount()).toBe(0);
    // A key or a press now reaches nothing of the card (it is gone, and nothing throws).
    key('Escape');
    fireEvent.pointerDown(document.body);
  });
});

describe('inside the tall view', () => {
  it('has the tabs and the search field in one row, no Search tab, and Up next; closing brings Search back', async () => {
    await setup();
    expect([...document.querySelectorAll('.sp-tabs button')].map((b) => b.textContent)).toEqual(['Search', 'Playlists', 'Albums', 'Liked', 'Recent']);
    await open();
    expect([...document.querySelectorAll('.sp-tabs button')].map((b) => b.textContent)).toEqual(['Playlists', 'Albums', 'Liked', 'Recent', 'Up next']);
    expect(document.querySelector('.sp-bar .sp-tabs')).not.toBeNull();
    expect(document.querySelector('.sp-bar .sp-search')).not.toBeNull();
    await act(async () => (document.querySelectorAll('.sp-tabs button')[4] as HTMLButtonElement).click());
    await flush();
    expect(screen.getByText('Playing now')).toBeTruthy();
    await act(async () => openButton().click());
    expect(document.querySelectorAll('.sp-tabs button')[1].getAttribute('aria-selected')).toBe('true');
  });

  it('keeps the tab row on the arrow keys', async () => {
    await setup();
    await open();
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('.sp-tabs button')];
    await act(async () => tabs[0].focus());
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    await flush();
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tabs[1], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('reaches the button, the tabs, the search, the lists, the player and then the chooser in order', async () => {
    await setup();
    await open();
    const order = (a: Element, b: Element) => expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const slider = screen.getByRole('slider');
    const tab = document.querySelector('.sp-tabs button[tabindex="0"]') as Element;
    order(chip(), openButton());
    order(openButton(), tab);
    order(tab, screen.getByRole('searchbox'));
    order(screen.getByRole('searchbox'), document.querySelector('.sp-tile') as Element);
    order(document.querySelector('.sp-tile') as Element, document.querySelector('.sp-pl-btn') as Element);
    order(document.querySelector('.sp-pl-btn') as Element, slider);
    // The chooser opens right under the chip in the page order, so Tab goes from the chip into it.
    await act(async () => chip().click());
    await flush();
    order(chip(), document.querySelector('.sp-device') as Element);
    order(document.querySelector('.sp-device') as Element, openButton());
  });

  it('shows two rows of covers: ten tiles at five a row, the rest scrolling', async () => {
    await setup();
    await open();
    expect(document.querySelectorAll('.sp-tile')).toHaveLength(12);
    expect(document.querySelector('.sp-grid')).not.toBeNull();
  });

  it('a playlist opened: Back with the list name, the cover, Play and Shuffle, the songs; a click plays from that song', async () => {
    await setup();
    await open();
    await act(async () => (document.querySelector('.sp-tile') as HTMLButtonElement).click());
    await flush();
    expect(document.querySelector('.sp-backlabel')?.textContent).toBe('Playlists');
    expect(document.querySelectorAll('.sp-shbtns .sp-btn')).toHaveLength(2);
    expect(document.querySelectorAll('.sp-track')).toHaveLength(3);
    await act(async () => (document.querySelectorAll('.sp-track')[1] as HTMLButtonElement).click());
    await flush();
    const play = sent.find((s) => s[0] === 'wall2_spotify_play');
    expect(play?.[1]).toMatchObject({ request: { kind: 'track', id: id(502), offsetId: id(502), context: { kind: 'playlist', id: id(1) } } });
    await act(async () => (document.querySelector('.sp-back') as HTMLButtonElement).click());
    expect(document.querySelector('.sp-songs')).toBeNull();
  });

  it('search is in groups: songs, then at most three albums and three playlists; emptying the field returns to the library', async () => {
    await setup();
    await open();
    const field = screen.getByRole('searchbox');
    await act(async () => fireEvent.change(field, { target: { value: 'hit' } }));
    await flush(SEARCH_WAIT_MS);
    expect(document.querySelectorAll('.sp-li')).toHaveLength(4);
    expect([...document.querySelectorAll('.sp-gk')].map((e) => e.textContent)).toEqual(['Songs', 'Albums', 'Playlists']);
    expect(document.querySelectorAll('.sp-grid3 .sp-tile')).toHaveLength(6);
    // A song plays on a click.
    await act(async () => (document.querySelectorAll('.sp-li')[2] as HTMLButtonElement).click());
    await flush();
    expect(sent.find((s) => s[0] === 'wall2_spotify_play')?.[1]).toMatchObject({ request: { kind: 'track', id: id(3) } });
    // None of the tabs is lit while results show; emptying the field goes back to Playlists.
    expect(document.querySelectorAll('.sp-tabs [aria-selected="true"]')).toHaveLength(0);
    await act(async () => fireEvent.change(field, { target: { value: '' } }));
    expect(document.querySelectorAll('.sp-tabs button')[0].getAttribute('aria-selected')).toBe('true');
  });

  it('search with nothing found says so in each group, and a failed search says why with Retry', async () => {
    await setup();
    mocks.set('wall2_spotify_search', () => ({ tracks: [], albums: [], playlists: [] }));
    await open();
    await act(async () => fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } }));
    await flush(SEARCH_WAIT_MS);
    expect(screen.getByText('Nothing found. Try other words.')).toBeTruthy();
    mocks.set('wall2_spotify_search', () => {
      throw new Error('down');
    });
    await act(async () => fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz' } }));
    await flush(SEARCH_WAIT_MS);
    expect(screen.getByText('Spotify is not answering right now.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  describe('Up next', () => {
    const tabUp = async () => {
      await open();
      await act(async () => (document.querySelectorAll('.sp-tabs button')[4] as HTMLButtonElement).click());
      await flush();
    };
    it('shows what plays and what follows, with the honest line', async () => {
      await setup();
      await tabUp();
      expect(screen.getByText(QUEUE_NOTE)).toBeTruthy();
      expect(document.querySelectorAll('.sp-qrow')).toHaveLength(4);
      expect(document.querySelector('.sp-qrow.on')?.textContent).toContain('Song 1');
    });
    it('a click skips ahead with Spotify\'s own next, by the row number, and never starts a list', async () => {
      await setup();
      await tabUp();
      await act(async () => (document.querySelectorAll('button.sp-qrow')[1] as HTMLButtonElement).click());
      await flush();
      expect(sent.filter((s) => s[0] === 'wall2_spotify_next')).toHaveLength(2);
      expect(sent.some((s) => s[0] === 'media_next' || s[0] === 'wall2_spotify_play')).toBe(false);
    });
    it('works with another program in front of Windows, because it does not use the media keys', async () => {
      await setup();
      windows('Edge', 'msedge');
      await flush(10_000);
      await tabUp();
      await act(async () => (document.querySelectorAll('button.sp-qrow')[0] as HTMLButtonElement).click());
      await flush();
      expect(sent.filter((s) => s[0] === 'wall2_spotify_next')).toHaveLength(1);
      expect(sent.some((s) => s[0] === 'media_next')).toBe(false);
    });
    it('says so when Spotify refuses a skip', async () => {
      await setup();
      mocks.set('wall2_spotify_next', () => {
        throw new Error('refused');
      });
      await tabUp();
      await act(async () => (document.querySelectorAll('button.sp-qrow')[0] as HTMLButtonElement).click());
      await flush();
      expect(screen.getByText('Could not skip. Spotify refused this list.')).toBeTruthy();
    });
    it('has its empty, error and busy states', async () => {
      await setup();
      mocks.set('wall2_spotify_queue', () => ({ current: null, next: [] }));
      await tabUp();
      expect(screen.getByText(/Nothing is queued/)).toBeTruthy();
      mocks.set('wall2_spotify_queue', () => {
        throw new Error('down');
      });
      await act(async () => (document.querySelectorAll('.sp-tabs button')[3] as HTMLButtonElement).click());
      await act(async () => (document.querySelectorAll('.sp-tabs button')[4] as HTMLButtonElement).click());
      await flush(QUEUE_POLL_MS_FOR_TEST);
      expect(screen.getByText('Spotify is not answering right now.')).toBeTruthy();
      mocks.set('wall2_spotify_queue', () => ({ current: track(1), next: [track(2)] }));
      await act(async () => screen.getByRole('button', { name: 'Retry' }).click());
      await flush();
      expect(document.querySelectorAll('.sp-qrow')).toHaveLength(2);
      // A busy answer keeps the rows it has.
      mocks.set('wall2_spotify_queue', () => {
        throw new Error('busy');
      });
      await flush(QUEUE_POLL_MS_FOR_TEST);
      expect(document.querySelectorAll('.sp-qrow')).toHaveLength(2);
    });
  });

  it('on the YouTube Music side the tall view holds today\'s content, with no chooser and no player row', async () => {
    await setup();
    await act(async () => screen.getByRole('radio', { name: 'YouTube Music' }).click());
    await open();
    expect(isTall()).toBe(true);
    expect(screen.getByRole('button', { name: 'Open YouTube Music' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Play on/ })).toBeNull();
    expect(document.querySelector('.sp-player')).toBeNull();
    expect(useListenSource.getState().source).toBe('youtube');
  });

  it('where Spotify cannot be browsed it still opens, with the line and no player row', async () => {
    useSpotifyStatus.setState({ status: { setup: false, signedIn: false, reason: null }, failed: false });
    render(<SpotifyCard />);
    await flush();
    expect(screen.getByText('Which player the wall follows')).toBeTruthy();
    await open();
    expect(isTall()).toBe(true);
    expect(screen.getByText(/not set up on this wall/)).toBeTruthy();
    expect(document.querySelector('.sp-player')).toBeNull();
  });
});

describe('the player row and seek', () => {
  const slider = () => screen.getByRole('slider') as HTMLElement;
  const rect = (el: HTMLElement) => {
    el.getBoundingClientRect = () => ({ left: 100, top: 0, width: 200, height: 6, right: 300, bottom: 6, x: 100, y: 0, toJSON: () => ({}) });
  };
  it('shows the song, its artist, the times, and the heart for a song with an id', async () => {
    await setup();
    await open();
    expect(document.querySelector('.sp-pl-title b')?.textContent).toBe('Song 1');
    expect(document.querySelector('.sp-pl-title small')?.textContent).toBe('Some Artist');
    expect(slider().getAttribute('aria-valuetext')).toBe('1:05 of 3:20');
    expect(screen.getByRole('button', { name: /liked songs/i })).toBeTruthy();
  });
  it('runs a local clock while playing and stops at a failed read', async () => {
    await setup();
    await open();
    await flush(3000);
    expect(slider().getAttribute('aria-valuetext')).toBe('1:08 of 3:20');
    mocks.set('wall2_spotify_playback', () => {
      throw new Error('down');
    });
    await flush(PLAYBACK_POLL_MS);
    const frozen = slider().getAttribute('aria-valuetext');
    await flush(5000);
    expect(slider().getAttribute('aria-valuetext')).toBe(frozen);
  });
  it('a drag moves the thumb while held and seeks once on release', async () => {
    await setup();
    await open();
    rect(slider());
    fireEvent.pointerDown(slider(), { clientX: 150, button: 0, pointerId: 1 });
    expect(slider().getAttribute('aria-valuenow')).toBe('50');
    fireEvent.pointerMove(slider(), { clientX: 250, pointerId: 1 });
    expect(sent.filter((s) => s[0] === 'wall2_spotify_seek')).toHaveLength(0);
    await act(async () => fireEvent.pointerUp(slider(), { clientX: 250, pointerId: 1 }));
    await flush();
    expect(sent.filter((s) => s[0] === 'wall2_spotify_seek')).toEqual([['wall2_spotify_seek', { positionMs: 150_000 }]]);
    expect(slider().getAttribute('aria-valuenow')).toBe('150');
  });
  it('a click past the ends stays inside the song', async () => {
    await setup();
    await open();
    rect(slider());
    fireEvent.pointerDown(slider(), { clientX: 900, button: 0, pointerId: 1 });
    await act(async () => fireEvent.pointerUp(slider(), { clientX: 900, pointerId: 1 }));
    expect(sent.find((s) => s[0] === 'wall2_spotify_seek')?.[1]).toEqual({ positionMs: 200_000 });
  });
  const seekCalls = () => sent.filter((s) => s[0] === 'wall2_spotify_seek').map((s) => (s[1] as { positionMs: number }).positionMs);
  it('an arrow key moves it five seconds and Home goes to the start', async () => {
    await setup();
    await open();
    await act(async () => slider().focus());
    await act(async () => fireEvent.keyDown(slider(), { key: 'ArrowRight' }));
    await act(async () => fireEvent.keyUp(slider(), { key: 'ArrowRight' }));
    await flush(SEEK_KEY_GAP_MS);
    await act(async () => fireEvent.keyDown(slider(), { key: 'Home' }));
    await act(async () => fireEvent.keyUp(slider(), { key: 'Home' }));
    expect(seekCalls()).toEqual([65_000 + SEEK_STEP_MS, 0]);
  });
  it('a held arrow key sends one seek at first, then at most one every 300 ms, and the final position on key up', async () => {
    await setup();
    await open();
    await act(async () => slider().focus());
    // Twelve repeats, 50 ms apart.
    for (let i = 0; i < 12; i++) {
      await act(async () => fireEvent.keyDown(slider(), { key: 'ArrowRight' }));
      await flush(50);
    }
    // First repeat at once (70 s), then the position reached after 300 ms; none more than one per 300 ms.
    expect(seekCalls().length).toBeLessThanOrEqual(3);
    expect(seekCalls()[0]).toBe(65_000 + SEEK_STEP_MS);
    // The bar follows every repeat even before a seek goes out.
    expect(slider().getAttribute('aria-valuenow')).toBe(String(65 + 12 * 5));
    await act(async () => fireEvent.keyUp(slider(), { key: 'ArrowRight' }));
    await flush(1);
    const calls = seekCalls();
    expect(calls[calls.length - 1]).toBe(65_000 + 12 * SEEK_STEP_MS);
    // Nothing is left to send afterwards.
    const n = calls.length;
    await flush(2000);
    expect(seekCalls().length).toBe(n);
  });
  it('a refused seek says so in the row and reads again', async () => {
    await setup();
    await open();
    mocks.set('wall2_spotify_seek', () => {
      throw new Error('busy');
    });
    rect(slider());
    fireEvent.pointerDown(slider(), { clientX: 200, button: 0, pointerId: 1 });
    await act(async () => fireEvent.pointerUp(slider(), { clientX: 200, pointerId: 1 }));
    await flush();
    expect(screen.getByText('Could not seek. Spotify is busy, try in a minute.')).toBeTruthy();
    await flush(6000);
    expect(screen.queryByText(/Could not seek/)).toBeNull();
  });
  it('with nothing playing it says so and the bar does nothing', async () => {
    await setup({ playing: false });
    await open();
    expect(document.querySelector('.sp-pl-title b')?.textContent).toBe('Nothing playing');
    rect(slider());
    fireEvent.pointerDown(slider(), { clientX: 200, button: 0, pointerId: 1 });
    fireEvent.pointerUp(slider(), { clientX: 200, pointerId: 1 });
    expect(sent.some((s) => s[0] === 'wall2_spotify_seek')).toBe(false);
  });
  const playbackOn = (name: string, kind: string, playing: boolean) =>
    mocks.set('wall2_spotify_playback', () => ({ playing, device: { name, kind }, track: track(1), progressMs: 65_000, shuffle: false }));
  const press = async (name: 'previous' | 'play' | 'next') => {
    await act(async () => (document.querySelector(`[data-control="${name}"]`) as HTMLButtonElement).click());
    await flush();
  };
  const names = () => sent.map((s) => s[0]);
  it('the three buttons use Spotify\'s own commands while Spotify reports a player', async () => {
    await setup();
    await open();
    await flush(2000);
    await press('next');
    await press('play');
    await press('previous');
    // Playing, so the middle button pauses.
    expect(names().filter((n) => n.startsWith('wall2_spotify_') && n !== 'wall2_spotify_play')).toEqual(['wall2_spotify_next', 'wall2_spotify_pause', 'wall2_spotify_previous']);
    expect(names().some((n) => n.startsWith('media_'))).toBe(false);
  });
  it('after a press the playback state is read again, at once and once more shortly after', async () => {
    let reads = 0;
    await setup();
    await open();
    mocks.set('wall2_spotify_playback', () => {
      reads++;
      return { playing: true, device: { name: 'Desk speakers', kind: 'Computer' }, track: track(1), progressMs: 65_000, shuffle: false };
    });
    const before = reads;
    await press('next');
    expect(reads - before).toBeGreaterThanOrEqual(1);
    const mid = reads;
    await flush(900);
    expect(reads).toBeGreaterThan(mid);
  });
  it('music moved to a phone while desktop Spotify is the paused Windows session: Play resumes the phone and never starts this PC', async () => {
    await setup();
    playbackOn('Phone', 'Smartphone', false);
    windows('Spotify', 'Spotify.exe');
    mocks.set('get_now_playing', () => ({ title: 'Song 1', artist: 'Some Artist', playback_status: 'paused', source_app: 'Spotify', source_app_id: 'Spotify.exe' }));
    await open();
    await flush(2000);
    const play = document.querySelector('[data-control="play"]') as HTMLButtonElement;
    expect(play.getAttribute('aria-label')).toBe('Play');
    expect(play.getAttribute('aria-disabled')).toBe('false');
    await press('play');
    expect(names()).toContain('wall2_spotify_resume');
    expect(names().some((n) => n === 'media_play_pause' || n === 'wall2_spotify_play')).toBe(false);
  });
  it('music on a chosen phone with another program as the Windows session: all three buttons work', async () => {
    await setup();
    playbackOn('Phone', 'Smartphone', true);
    windows('Edge', 'msedge');
    await open();
    await flush(2000);
    for (const c of ['previous', 'play', 'next'] as const) expect((document.querySelector(`[data-control="${c}"]`) as HTMLButtonElement).getAttribute('aria-disabled')).toBe('false');
    await press('previous');
    await press('play');
    await press('next');
    expect(names().filter((n) => n.startsWith('wall2_spotify_') && n !== 'wall2_spotify_play')).toEqual(['wall2_spotify_previous', 'wall2_spotify_pause', 'wall2_spotify_next']);
    expect(names().some((n) => n.startsWith('media_'))).toBe(false);
  });
  it('with nothing playing anywhere the buttons are marked unavailable and send nothing', async () => {
    await setup({ playing: false });
    windows('Edge', 'msedge');
    await open();
    await flush(2000);
    for (const c of ['previous', 'play', 'next'] as const) {
      const b = document.querySelector(`[data-control="${c}"]`) as HTMLButtonElement;
      expect(b.getAttribute('aria-disabled')).toBe('true');
      await act(async () => b.click());
    }
    expect(names().some((n) => n.startsWith('media_') || ['wall2_spotify_pause', 'wall2_spotify_resume', 'wall2_spotify_next', 'wall2_spotify_previous'].includes(n))).toBe(false);
  });
  it('only when Spotify reports no player and the Windows session is Spotify on this PC do the media keys serve', async () => {
    await setup({ playing: false });
    windows('Spotify', 'Spotify.exe');
    await open();
    await flush(2000);
    await press('next');
    await press('play');
    expect(names().filter((n) => n.startsWith('media_'))).toEqual(['media_next', 'media_play_pause']);
    expect(names().some((n) => ['wall2_spotify_pause', 'wall2_spotify_resume', 'wall2_spotify_next'].includes(n))).toBe(false);
  });
  it('a refused press says so in the row', async () => {
    await setup();
    mocks.set('wall2_spotify_pause', () => {
      throw new Error('no device');
    });
    await open();
    await flush(2000);
    await press('play');
    expect(screen.getByText('Could not pause. Open Spotify on this PC first.')).toBeTruthy();
  });
  it('reads again when a song\'s length is reached, not on every tick after', async () => {
    let reads = 0;
    await setup();
    mocks.set('wall2_spotify_playback', () => {
      reads++;
      return { playing: true, device: { name: 'Desk speakers', kind: 'Computer' }, track: { ...track(1), durationMs: 10_000 }, progressMs: 8_000, shuffle: false };
    });
    await open();
    await flush(500);
    const before = reads;
    await flush(2500);
    // 8 s plus 2 s reaches 10 s: one read, then the 3 s gap holds the next.
    expect(reads - before).toBe(1);
  });
  it('reads playback again every 20 seconds and when the song changes', async () => {
    let reads = 0;
    await setup();
    mocks.set('wall2_spotify_playback', () => {
      reads++;
      return { playing: true, device: null, track: track(1), progressMs: 0, shuffle: false };
    });
    await open();
    const before = reads;
    await flush(PLAYBACK_POLL_MS * 2);
    expect(reads - before).toBeGreaterThanOrEqual(2);
  });
});

describe('Play on', () => {
  it('shows the chip with where the music plays, and the owner\'s players with a tick on the active one', async () => {
    await setup();
    expect(chip().textContent).toContain('Desk speakers');
    await act(async () => chip().click());
    await flush();
    const rows = [...document.querySelectorAll('.sp-device')];
    expect(rows.map((r) => r.querySelector('b')?.textContent)).toEqual(['Desk speakers', 'Phone', 'Kitchen speaker']);
    expect(rows.map((r) => r.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(rows[0].querySelector('small')?.textContent).toBe('Computer, playing now');
    expect(screen.getByText(DEVICES_FOOT)).toBeTruthy();
  });

  it('also works in the resting card, and closes on a choice, an outside press and Escape', async () => {
    await setup();
    await act(async () => chip().click());
    await flush();
    expect(isTall()).toBe(false);
    expect(document.querySelector('.sp-devices')).not.toBeNull();
    await act(async () => fireEvent.pointerDown(screen.getByText('Behind')));
    expect(document.querySelector('.sp-devices')).toBeNull();
    await act(async () => chip().click());
    key('Escape');
    expect(document.querySelector('.sp-devices')).toBeNull();
    await act(async () => chip().click());
    await flush();
    await act(async () => (document.querySelectorAll('.sp-device')[0] as HTMLButtonElement).click());
    await flush();
    expect(document.querySelector('.sp-devices')).toBeNull();
  });

  it('moves the music with the transfer command while something plays', async () => {
    await setup();
    await act(async () => chip().click());
    await flush();
    await act(async () => (document.querySelectorAll('.sp-device')[2] as HTMLButtonElement).click());
    await flush();
    expect(sent.filter((s) => s[0] === 'wall2_spotify_transfer')).toEqual([['wall2_spotify_transfer', { deviceId: dev(3) }]]);
    expect(chip().textContent).toContain('Kitchen speaker');
    expect(playDeviceId()).toBe(dev(3));
  });

  it('choosing the active player sends nothing', async () => {
    await setup();
    await act(async () => chip().click());
    await flush();
    await act(async () => (document.querySelectorAll('.sp-device')[0] as HTMLButtonElement).click());
    await flush();
    expect(sent.some((s) => s[0] === 'wall2_spotify_transfer')).toBe(false);
  });

  it('with nothing playing only sets the target of the next Play, which then goes there', async () => {
    await setup({ playing: false });
    await act(async () => chip().click());
    await flush();
    await act(async () => (document.querySelectorAll('.sp-device')[1] as HTMLButtonElement).click());
    await flush();
    expect(sent.some((s) => s[0] === 'wall2_spotify_transfer')).toBe(false);
    expect(chip().textContent).toContain('Phone');
    await act(async () => (document.querySelector('.sp-tile') as HTMLButtonElement).click());
    await flush();
    await act(async () => (document.querySelector('.sp-shead .sp-btn.fill') as HTMLButtonElement).click());
    await flush();
    expect(sent.find((s) => s[0] === 'wall2_spotify_play')?.[1]).toMatchObject({ request: { kind: 'playlist', id: id(1), deviceId: dev(2) } });
  });

  it('without a pick, Play follows the active device the chip names', async () => {
    await setup({ devices: [device(1, 'Desk speakers', 'Computer'), device(3, 'Kitchen speaker', 'Speaker', true)] });
    expect(chip().textContent).toContain('Kitchen speaker');
    await act(async () => (document.querySelector('.sp-tile') as HTMLButtonElement).click());
    await flush();
    await act(async () => (document.querySelector('.sp-shead .sp-btn.fill') as HTMLButtonElement).click());
    await flush();
    expect(sent.find((s) => s[0] === 'wall2_spotify_play')?.[1]).toMatchObject({ request: { deviceId: dev(3) } });
  });

  it('with no computer awake lists "This PC" first, and picking it lets Play start Spotify there', async () => {
    await setup({ devices: [device(2, 'Phone', 'Smartphone', true)] });
    expect(chip().textContent).toContain('Phone');
    await act(async () => chip().click());
    await flush();
    const rows = [...document.querySelectorAll('.sp-device')];
    expect(rows[0].textContent).toContain('This PC');
    expect(rows[0].textContent).toContain('Spotify is closed. The wall starts it.');
    await act(async () => (rows[0] as HTMLButtonElement).click());
    await flush();
    expect(chip().textContent).toContain('This PC');
    expect(playDeviceId()).toBeUndefined();
    expect(sent.some((s) => s[0] === 'wall2_spotify_transfer')).toBe(false);
  });

  it('forgets a pick that is no longer awake, and does not let a restricted player be chosen', async () => {
    let list = [...DEVICES, device(4, 'Locked TV', 'TV', false, true)];
    await setup({ devices: list });
    await act(async () => chip().click());
    await flush();
    const locked = [...document.querySelectorAll('.sp-device')][3] as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
    await act(async () => (document.querySelectorAll('.sp-device')[2] as HTMLButtonElement).click());
    await flush();
    expect(chip().textContent).toContain('Kitchen speaker');
    list = DEVICES.slice(0, 2);
    mocks.set('wall2_spotify_devices', () => list);
    await act(async () => chip().click());
    await flush();
    expect(chip().textContent).toContain('Desk speakers');
    expect(playDeviceId()).toBe(dev(1));
  });

  it('says so in the chooser when a transfer fails, and keeps it open', async () => {
    await setup();
    mocks.set('wall2_spotify_transfer', () => {
      throw new Error('busy');
    });
    await act(async () => chip().click());
    await flush();
    await act(async () => (document.querySelectorAll('.sp-device')[2] as HTMLButtonElement).click());
    await flush();
    expect(screen.getByText('Could not move the music. Spotify is busy, try in a minute.')).toBeTruthy();
    expect(document.querySelector('.sp-devices')).not.toBeNull();
    expect(chip().textContent).toContain('Desk speakers');
  });

  it('the arrow keys move between players, and the chooser reads its own failure and empty states', async () => {
    await setup();
    await act(async () => chip().click());
    await flush();
    const rows = [...document.querySelectorAll<HTMLButtonElement>('.sp-device')];
    await act(async () => rows[0].focus());
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[0]);
    key('Escape');
    mocks.set('wall2_spotify_devices', () => []);
    await act(async () => chip().click());
    await flush();
    expect(document.querySelector('.sp-device')?.textContent).toContain('This PC');
    expect(screen.getByText(DEVICES_FOOT)).toBeTruthy();
  });

  it('the chip follows the start flow: this PC while Spotify starts, the real player after', async () => {
    await setup({ devices: [device(2, 'Phone', 'Smartphone')] });
    expect(chip().textContent).toContain('This PC');
    await act(async () => useSpotifyStart.setState({ starting: true, name: 'Night Drive' }));
    expect(chip().textContent).toContain('This PC');
    mocks.set('wall2_spotify_devices', () => DEVICES);
    await act(async () => useSpotifyStart.setState((s) => ({ starting: false, rev: s.rev + 1 })));
    await flush();
    expect(chip().textContent).toContain('Desk speakers');
  });

  it('shows a calm starting line with what plays once ready', async () => {
    await setup();
    mocks.set('wall2_spotify_play', () => 'starting');
    let calls = 0;
    mocks.set('wall2_spotify_start_status', () => (++calls < 2 ? { starting: true, result: null } : { starting: false, result: 'played' }));
    mocks.set('get_now_playing', () => null);
    await open();
    await act(async () => (document.querySelector('.sp-tile') as HTMLButtonElement).click());
    await flush();
    await act(async () => (document.querySelector('.sp-shbtns .sp-btn.fill') as HTMLButtonElement).click());
    await flush();
    expect(screen.getByText('Starting Spotify on this PC')).toBeTruthy();
    expect(screen.getByText('List 1 plays as soon as it is ready')).toBeTruthy();
    await flush(2000);
    expect(screen.queryByText('Starting Spotify on this PC')).toBeNull();
  });
});


const QUEUE_POLL_MS_FOR_TEST = 20_000;

describe('a chosen player that is gone, locked or unreachable', () => {
  const pickPhone = async () => {
    await act(async () => chip().click());
    await flush();
    await act(async () => (document.querySelectorAll('.sp-device')[1] as HTMLButtonElement).click());
    await flush();
  };
  const playOpened = async () => {
    await act(async () => (document.querySelector('.sp-tile') as HTMLButtonElement).click());
    await flush();
    await act(async () => (document.querySelector('.sp-shead .sp-btn.fill') as HTMLButtonElement).click());
    await flush();
  };
  const plays = () => sent.filter((s) => s[0] === 'wall2_spotify_play');

  it('awake: the chip names it and Play goes there', async () => {
    await setup({ playing: false });
    await pickPhone();
    expect(chip().textContent).toContain('Phone');
    await playOpened();
    expect(plays()).toHaveLength(1);
    expect(plays()[0][1]).toMatchObject({ request: { deviceId: dev(2) } });
  });

  it('gone: Play sends nothing, the line says so, the pick is cleared and the chip names the player that plays', async () => {
    await setup({ playing: false });
    await pickPhone();
    // The phone fell asleep: Spotify's list no longer has it.
    mocks.set('wall2_spotify_devices', () => [DEVICES[0], DEVICES[2]]);
    await act(async () => (document.querySelector('.sp-tile') as HTMLButtonElement).click());
    await flush();
    await act(async () => (document.querySelector('.sp-shead .sp-btn.fill') as HTMLButtonElement).click());
    await flush();
    expect(plays()).toHaveLength(0);
    expect(screen.getByText(GONE_LINE)).toBeTruthy();
    expect(useSpotifyTarget.getState().target).toBeNull();
    expect(chip().textContent).toContain('Desk speakers');
    // Choosing again afterwards plays on the player the chip names.
    await act(async () => (document.querySelector('.sp-shead .sp-btn.fill') as HTMLButtonElement).click());
    await flush();
    expect(plays()).toHaveLength(1);
    expect(plays()[0][1]).toMatchObject({ request: { deviceId: dev(1) } });
  });

  it('locked: Play sends nothing and says that player does not allow control', async () => {
    await setup({ playing: false });
    await pickPhone();
    mocks.set('wall2_spotify_devices', () => [DEVICES[0], { ...DEVICES[1], restricted: true }, DEVICES[2]]);
    await act(async () => (document.querySelector('.sp-tile') as HTMLButtonElement).click());
    await flush();
    await act(async () => (document.querySelector('.sp-shead .sp-btn.fill') as HTMLButtonElement).click());
    await flush();
    expect(plays()).toHaveLength(0);
    expect(screen.getByText(LOCKED_LINE)).toBeTruthy();
    expect(useSpotifyTarget.getState().target).toBeNull();
  });

  it('gone between the check and the play (Rust answers "device gone"): the same line and a cleared pick', async () => {
    await setup({ playing: false });
    await pickPhone();
    mocks.set('wall2_spotify_play', () => {
      throw new Error('device gone');
    });
    await playOpened();
    expect(screen.getByText(GONE_LINE)).toBeTruthy();
    expect(useSpotifyTarget.getState().target).toBeNull();
    expect(chip().textContent).not.toContain('Phone');
  });

  it('a chosen computer that is gone is refused like any other player, even with a phone active', async () => {
    await setup({ playing: false, devices: [device(1, 'Desk speakers', 'Computer'), device(2, 'Phone', 'Smartphone', true)] });
    await act(async () => chip().click());
    await flush();
    await act(async () => (document.querySelectorAll('.sp-device')[0] as HTMLButtonElement).click());
    await flush();
    expect(chip().textContent).toContain('Desk speakers');
    mocks.set('wall2_spotify_devices', () => [device(2, 'Phone', 'Smartphone', true)]);
    await playOpened();
    expect(plays()).toHaveLength(0);
    expect(screen.getByText(GONE_LINE)).toBeTruthy();
    expect(useSpotifyTarget.getState().target).toBeNull();
  });

  it('the chosen "This PC" that is not awake is started by Play, even with a phone active (built on purpose)', async () => {
    await setup({ playing: false, devices: [device(2, 'Phone', 'Smartphone', true)] });
    await act(async () => chip().click());
    await flush();
    await act(async () => (document.querySelectorAll('.sp-device')[0] as HTMLButtonElement).click());
    await flush();
    expect(useSpotifyTarget.getState().target).toMatchObject({ id: '', name: 'This PC' });
    await playOpened();
    expect(plays()).toHaveLength(1);
    expect((plays()[0][1] as { request: Record<string, unknown> }).request.deviceId).toBeUndefined();
    expect(screen.queryByText(GONE_LINE)).toBeNull();
  });

  it('a failed refresh before Play lets it go, since Rust checks the same list', async () => {
    await setup({ playing: false });
    await pickPhone();
    mocks.set('wall2_spotify_devices', () => {
      throw new Error('down');
    });
    await playOpened();
    expect(plays()).toHaveLength(1);
    expect(plays()[0][1]).toMatchObject({ request: { deviceId: dev(2) } });
  });

  it('the chooser reads the list again when it opens', async () => {
    await setup();
    let reads = 0;
    mocks.set('wall2_spotify_devices', () => {
      reads++;
      return DEVICES;
    });
    const before = reads;
    await act(async () => chip().click());
    await flush();
    expect(reads).toBeGreaterThan(before);
  });

  it('after a failed refresh the old rows stay, marked as possibly out of date and not as live', async () => {
    await setup();
    await act(async () => chip().click());
    await flush();
    expect(document.querySelector('.sp-devices .sp-device small')?.textContent).toBe('Computer, playing now');
    key('Escape');
    mocks.set('wall2_spotify_devices', () => {
      throw new Error('down');
    });
    await act(async () => chip().click());
    await flush();
    expect(screen.getByText(STALE_NOTE)).toBeTruthy();
    expect(document.querySelector('.sp-devices')?.classList.contains('stale')).toBe(true);
    const rows = [...document.querySelectorAll('.sp-device')];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.querySelector('small')?.textContent)).toEqual(['Computer', 'Phone', 'Speaker']);
    expect(rows.every((r) => r.getAttribute('aria-pressed') === 'false')).toBe(true);
    // A good read takes the marks away.
    mocks.set('wall2_spotify_devices', () => DEVICES);
    key('Escape');
    await act(async () => chip().click());
    await flush();
    expect(screen.queryByText(STALE_NOTE)).toBeNull();
  });

  it('music on a player that does not allow control: the chip names it and says so', async () => {
    await setup({ devices: [{ ...device(5, 'Living room TV', 'TV', true, true) }, device(1, 'Desk speakers', 'Computer')] });
    expect(chip().textContent).toContain('Living room TV');
    expect(chip().getAttribute('aria-label')).toContain('cannot be controlled from here');
    expect(chip().classList.contains('locked')).toBe(true);
    expect(chip().textContent).not.toContain('This PC');
  });
});

describe('every first read shows loading words, and a re-read keeps what is on screen', () => {
  const held = () => {
    let resolve: (v: unknown) => void = () => undefined;
    const promise = new Promise((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };
  const tabs = () => [...document.querySelectorAll<HTMLButtonElement>('.sp-tabs button')];

  it('Playlists, Albums, Liked and Recent', async () => {
    await setup();
    const lists: [string, string, string][] = [['wall2_spotify_albums', 'Reading your albums.', 'Albums'], ['wall2_spotify_liked', 'Reading your liked songs.', 'Liked'], ['wall2_spotify_recent', 'Reading what you played lately.', 'Recent']];
    for (const [cmd, line, label] of lists) {
      const h = held();
      mocks.set(cmd, () => h.promise);
      // Rest layout: the tab row has Search first.
      await act(async () => tabs().find((t) => t.textContent === label)?.click());
      await flush();
      const busy = document.querySelector('[aria-busy="true"]');
      expect(busy?.textContent, cmd).toBe(line);
      await act(async () => h.resolve([item(77, 'playlist', 'Held list')]));
      await flush();
      expect(document.querySelector('[aria-busy="true"]'), cmd).toBeNull();
      expect(screen.getByText('Held list')).toBeTruthy();
    }
  });

  it('the first view, Playlists, before its answer arrives', async () => {
    signedIn();
    const h = held();
    mocks.set('wall2_spotify_playlists', () => h.promise);
    mocks.set('get_now_playing', () => null);
    render(<SpotifyCard />);
    await flush();
    expect(document.querySelector('[aria-busy="true"]')?.textContent).toBe('Reading your playlists.');
    expect(document.querySelector('.sp-tile')).toBeNull();
    await act(async () => h.resolve([item(77, 'playlist', 'Held list')]));
    await flush();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByText('Held list')).toBeTruthy();
  });

  it('a search, and then a second search keeps the results on screen', async () => {
    await setup();
    await open();
    const h = held();
    mocks.set('wall2_spotify_search', () => h.promise);
    await act(async () => fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'first' } }));
    await flush(SEARCH_WAIT_MS);
    expect(document.querySelector('[aria-busy="true"]')?.textContent).toBe('Searching Spotify.');
    await act(async () => h.resolve({ tracks: [item(1, 'track', 'Hit 1')], albums: [], playlists: [] }));
    await flush();
    expect(screen.getByText('Hit 1')).toBeTruthy();
    const h2 = held();
    mocks.set('wall2_spotify_search', () => h2.promise);
    await act(async () => fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'second' } }));
    await flush(SEARCH_WAIT_MS);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByText('Hit 1')).toBeTruthy();
  });

  it('the songs of a playlist', async () => {
    await setup();
    const h = held();
    mocks.set('wall2_spotify_tracks', () => h.promise);
    await act(async () => (document.querySelector('.sp-tile') as HTMLButtonElement).click());
    await flush();
    expect(document.querySelector('.sp-tracks [aria-busy="true"]')?.textContent).toBe('Reading the songs.');
    expect(screen.queryByText(/No songs in this/)).toBeNull();
    await act(async () => h.resolve({ items: [track(1)], total: 1, more: false }));
    await flush();
    expect(document.querySelector('.sp-tracks [aria-busy="true"]')).toBeNull();
    expect(screen.getByText('Song 1')).toBeTruthy();
  });

  it('a first read that fails still ends in its error line, never in blank', async () => {
    await setup();
    mocks.set('wall2_spotify_albums', () => {
      throw new Error('down');
    });
    await act(async () => tabs().find((t) => t.textContent === 'Albums')?.click());
    await flush();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByText('Spotify is not answering right now.')).toBeTruthy();
  });
});

describe('arrow keys in the cover grid', () => {
  const columns = (grid: HTMLElement, n: number) => {
    grid.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
  };
  const tilesIn = (grid: Element) => [...grid.querySelectorAll<HTMLButtonElement>('.sp-tile')];
  const arrow = async (el: HTMLElement, k: string) => {
    await act(async () => {
      fireEvent.keyDown(el, { key: k });
    });
  };

  it('moves by the pure rule: edges stay, a short last row is reached by Down', () => {
    // Twelve tiles, five a row: rows of 5, 5 and 2.
    expect(arrowTarget(0, 12, 5, 'ArrowLeft')).toBe(0);
    expect(arrowTarget(0, 12, 5, 'ArrowUp')).toBe(0);
    expect(arrowTarget(4, 12, 5, 'ArrowRight')).toBe(5);
    expect(arrowTarget(11, 12, 5, 'ArrowRight')).toBe(11);
    expect(arrowTarget(7, 12, 5, 'ArrowUp')).toBe(2);
    expect(arrowTarget(7, 12, 5, 'ArrowDown')).toBe(11);
    expect(arrowTarget(3, 12, 5, 'ArrowDown')).toBe(8);
    expect(arrowTarget(11, 12, 5, 'ArrowDown')).toBe(11);
    expect(arrowTarget(10, 12, 5, 'ArrowDown')).toBe(10);
    expect(arrowTarget(0, 1, 5, 'ArrowDown')).toBe(0);
    expect(arrowTarget(0, 12, 1, 'ArrowDown')).toBe(1);
  });

  it('reads the column count from the style, the resolved tracks, or the layout', () => {
    const g = document.createElement('div');
    g.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
    document.body.appendChild(g);
    expect(gridColumns(g, [])).toBe(3);
    g.style.gridTemplateColumns = '143.8px 143.8px 143.8px 143.8px 143.8px';
    expect(gridColumns(g, [])).toBe(5);
    g.style.gridTemplateColumns = '';
    expect(gridColumns(g, [])).toBe(1);
    g.remove();
  });

  for (const layout of ['the resting card', 'the tall view'] as const) {
    it(`walks the tiles of ${layout} and scrolls the focused one into view`, async () => {
      await setup();
      if (layout === 'the tall view') await open();
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      const grid = document.querySelector('.sp-grid') as HTMLElement;
      columns(grid, 5);
      const tiles = tilesIn(grid);
      expect(tiles).toHaveLength(12);
      await act(async () => tiles[7].focus());
      await arrow(tiles[7], 'ArrowRight');
      expect(document.activeElement).toBe(tiles[8]);
      await arrow(tiles[8], 'ArrowLeft');
      await arrow(tiles[7], 'ArrowUp');
      expect(document.activeElement).toBe(tiles[2]);
      await arrow(tiles[2], 'ArrowDown');
      expect(document.activeElement).toBe(tiles[7]);
      // Down from the second row on a column the short last row lacks lands on its last tile.
      await arrow(tiles[7], 'ArrowDown');
      expect(document.activeElement).toBe(tiles[11]);
      // The edges stay.
      await arrow(tiles[11], 'ArrowRight');
      expect(document.activeElement).toBe(tiles[11]);
      await arrow(tiles[11], 'ArrowDown');
      expect(document.activeElement).toBe(tiles[11]);
      await act(async () => tiles[0].focus());
      await arrow(tiles[0], 'ArrowLeft');
      await arrow(tiles[0], 'ArrowUp');
      expect(document.activeElement).toBe(tiles[0]);
      expect(scroll).toHaveBeenCalled();
    });
  }

  it('walks the three-column grids of a grouped search', async () => {
    await setup();
    await open();
    await act(async () => fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'hit' } }));
    await flush(SEARCH_WAIT_MS);
    const grids = [...document.querySelectorAll<HTMLElement>('.sp-grid3')];
    expect(grids).toHaveLength(2);
    columns(grids[0], 3);
    const albums = tilesIn(grids[0]);
    await act(async () => albums[1].focus());
    await arrow(albums[1], 'ArrowRight');
    expect(document.activeElement).toBe(albums[2]);
    // The arrows stay inside their own grid: no tile of the playlists group is reached from the albums.
    await arrow(albums[2], 'ArrowDown');
    expect(document.activeElement).toBe(albums[2]);
  });

  it('leaves Shift and Control arrows alone', async () => {
    await setup();
    const tiles = tilesIn(document.querySelector('.sp-grid') as Element);
    columns(document.querySelector('.sp-grid') as HTMLElement, 5);
    await act(async () => tiles[0].focus());
    await act(async () => {
      fireEvent.keyDown(tiles[0], { key: 'ArrowRight', shiftKey: true });
      fireEvent.keyDown(tiles[0], { key: 'ArrowRight', ctrlKey: true });
    });
    expect(document.activeElement).toBe(tiles[0]);
  });
});

describe('search songs show their length', () => {
  it('at the right edge of the row when Spotify gave one, and nothing when it did not', async () => {
    await setup();
    mocks.set('wall2_spotify_search', () => ({
      tracks: [{ ...item(1, 'track', 'Timed'), durationMs: 215_000 }, item(2, 'track', 'Untimed')],
      albums: [],
      playlists: [],
    }));
    await open();
    await act(async () => fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'hit' } }));
    await flush(SEARCH_WAIT_MS);
    const rows = [...document.querySelectorAll('.sp-li')];
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.sp-li-len')?.textContent).toBe('3:35');
    expect(rows[1].querySelector('.sp-li-len')).toBeNull();
  });
});

describe('closing by itself follows the keyboard focus too', () => {
  it('opened by keyboard with the pointer elsewhere it stays open while the focus is inside, then closes 15 s after the focus leaves', async () => {
    await setup();
    const b = openButton();
    await act(async () => b.focus());
    await act(async () => b.click());
    await flush(TALL_CLOSE_MS * 3);
    expect(isTall()).toBe(true);
    await act(async () => screen.getByText('Behind').focus());
    await flush(TALL_CLOSE_MS - 1);
    expect(isTall()).toBe(true);
    await flush(1);
    expect(isTall()).toBe(false);
  });

  it('focus moving between parts of the view does not start it', async () => {
    await setup();
    await act(async () => openButton().focus());
    await act(async () => openButton().click());
    await act(async () => screen.getByRole('searchbox').focus());
    await flush(TALL_CLOSE_MS * 2);
    expect(isTall()).toBe(true);
  });

  it('opened with neither the pointer nor the focus on it, the 15 seconds start at once', async () => {
    await setup();
    await act(async () => openButton().click());
    await flush(TALL_CLOSE_MS - 1);
    expect(isTall()).toBe(true);
    await flush(1);
    expect(isTall()).toBe(false);
  });

  it('a search field that went away while focused no longer holds it open', async () => {
    await setup();
    await open();
    const c = card();
    await act(async () => screen.getByRole('searchbox').focus());
    // Closing and opening again rebuilds the field; nothing is focused afterwards.
    await act(async () => openButton().click());
    expect(isTall()).toBe(false);
    await open();
    expect(document.activeElement).not.toBe(screen.getByRole('searchbox'));
    fireEvent.pointerLeave(c);
    await flush(TALL_CLOSE_MS);
    expect(isTall()).toBe(false);
  });
});

describe('a saved playlist that is not his (Spotify shows its songs only to its maker)', () => {
  const words = 'Spotify shows the songs only for playlists you made. To see these, copy it into a playlist of your own in Spotify. Play and Shuffle still work.';
  const notYours = () =>
    mocks.set('wall2_spotify_tracks', () => {
      throw new Error('not yours');
    });
  const openIt = async () => {
    await act(async () => (document.querySelector('.sp-tile') as HTMLButtonElement).click());
    await flush();
  };

  it('at rest: the new words, Play and Shuffle, no Retry and no Up next line', async () => {
    await setup();
    notYours();
    await openIt();
    expect(NOT_YOURS_LINE).toBe(words);
    expect(screen.getByText(words)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Shuffle' })).toBeTruthy();
    expect(screen.queryByText(/While it plays/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Up next' })).toBeNull();
  });

  it('in the tall view: the same words, no Retry, and a dim second line whose "Up next" is a button', async () => {
    await setup();
    notYours();
    await open();
    await openIt();
    expect(screen.getByText(words)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    const line = document.querySelector('.sp-hintline') as HTMLElement;
    expect(line.textContent).toBe('While it plays, Up next shows what is coming.');
    expect(line.querySelector('button')?.textContent).toBe('Up next');
  });

  it('the Up next button switches to that tab and leaves the list', async () => {
    await setup();
    notYours();
    await open();
    await openIt();
    await act(async () => (document.querySelector('.sp-hintline button') as HTMLButtonElement).click());
    await flush();
    expect(document.querySelector('.sp-songs')).toBeNull();
    expect(document.querySelector('.sp-tabs [aria-selected="true"]')?.textContent).toBe('Up next');
    expect(screen.getByText('Playing now')).toBeTruthy();
  });

  it('every other failure keeps its Retry', async () => {
    await setup();
    mocks.set('wall2_spotify_tracks', () => {
      throw new Error('down');
    });
    await openIt();
    expect(screen.getByText('Spotify is not answering right now.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText(/While it plays/)).toBeNull();
  });
});

describe('a swallowed outside press that never gets its click lets go of its listeners', () => {
  const spyDocument = () => {
    const added: string[] = [];
    const removed: string[] = [];
    const add = vi.spyOn(document, 'addEventListener').mockImplementation(function (this: Document, type: string, ...rest: unknown[]) {
      added.push(type);
      return EventTarget.prototype.addEventListener.call(this, type, ...(rest as [EventListenerOrEventListenerObject]));
    } as never);
    const remove = vi.spyOn(document, 'removeEventListener').mockImplementation(function (this: Document, type: string, ...rest: unknown[]) {
      removed.push(type);
      return EventTarget.prototype.removeEventListener.call(this, type, ...(rest as [EventListenerOrEventListenerObject]));
    } as never);
    const net = (t: string) => added.filter((x) => x === t).length - removed.filter((x) => x === t).length;
    return { net, restore: () => { add.mockRestore(); remove.mockRestore(); } };
  };
  // Listeners other parts of the card hold while it is open (the page-visibility one) are the baseline.
  const baseline = (spy: ReturnType<typeof spyDocument>) => Object.fromEntries(TYPES.map((t) => [t, spy.net(t)])) as Record<string, number>;
  const TYPES = ['mousedown', 'mouseup', 'click', 'pointerup', 'pointercancel', 'auxclick', 'contextmenu', 'dragend'];

  it('on the pointer going up outside, with no click after it', async () => {
    const spy = spyDocument();
    await setup();
    await open();
    const base = baseline(spy);
    const target = screen.getByText('Behind');
    await act(async () => fireEvent.pointerDown(target));
    // The follow-up listeners are waiting for the press's click.
    expect(spy.net('click') - base.click).toBe(1);
    await act(async () => fireEvent.pointerUp(target));
    await flush(1);
    for (const t of TYPES) expect(spy.net(t), t).toBe(base[t]);
    // The next click is the owner's own and reaches what it hits.
    await act(async () => fireEvent.click(target));
    expect(behind).toHaveBeenCalledTimes(1);
    spy.restore();
  });

  it('on the card being taken away (a place or tab change) before the click', async () => {
    const spy = spyDocument();
    const view = await setup();
    await open();
    await act(async () => fireEvent.pointerDown(screen.getByText('Behind')));
    expect(spy.net('click')).toBe(1);
    view.unmount();
    for (const t of TYPES) expect(spy.net(t), t).toBe(0);
    spy.restore();
  });

  it('on the page being hidden mid-press', async () => {
    const spy = spyDocument();
    await setup();
    await open();
    const base = baseline(spy);
    await act(async () => fireEvent.pointerDown(screen.getByText('Behind')));
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    for (const t of TYPES) expect(spy.net(t), t).toBe(base[t]);
    // Nothing is left to swallow: the next click reaches what it hits.
    await act(async () => fireEvent.click(screen.getByText('Behind')));
    expect(behind).toHaveBeenCalledTimes(1);
    spy.restore();
  });

  it('the usual press, released by its own click, still leaves nothing behind', async () => {
    const spy = spyDocument();
    await setup();
    await open();
    const base = baseline(spy);
    const target = screen.getByText('Behind');
    await act(async () => {
      fireEvent.pointerDown(target);
      fireEvent.mouseDown(target);
      fireEvent.pointerUp(target);
      fireEvent.mouseUp(target);
      fireEvent.click(target);
    });
    await flush(1);
    expect(behind).not.toHaveBeenCalled();
    for (const t of TYPES) expect(spy.net(t), t).toBe(base[t]);
    spy.restore();
  });
});

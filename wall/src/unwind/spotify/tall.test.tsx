import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import type { SpotifyDevice, SpotifyItem, SpotifyTrack } from '../../music/spotify';
import { resetNowPlaying } from '../../music/store';
import { resetTools } from '../../tools/store';
import { hideTip, resetTip } from '../../ui/HoverTip';
import { deviceKindWord, playDeviceId, resetSpotifyTarget, resetListenSource, seekPosition, SEARCH_WAIT_MS, TALL_CLOSE_MS, useListenSource, useSpotifyNow, useSpotifyStart } from './model';
import { deviceRows, DEVICES_FOOT } from './PlayOn';
import { PLAYBACK_POLL_MS, SEEK_STEP_MS } from './PlayerRow';
import { SpotifyCard } from './SpotifyCard';
import { QUEUE_NOTE } from './TallViews';
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

  it('a press outside that never becomes a click stops swallowing after a moment', async () => {
    await setup();
    await open();
    const target = screen.getByText('Behind');
    await act(async () => fireEvent.pointerDown(target));
    expect(isTall()).toBe(false);
    await flush(700);
    await act(async () => fireEvent.click(target));
    expect(behind).toHaveBeenCalledTimes(1);
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
    it('a click skips ahead through Windows by the row number and never starts a list', async () => {
      await setup();
      await tabUp();
      await act(async () => (document.querySelectorAll('button.sp-qrow')[1] as HTMLButtonElement).click());
      await flush();
      expect(sent.filter((s) => s[0] === 'media_next')).toHaveLength(2);
      expect(sent.some((s) => s[0] === 'wall2_spotify_play')).toBe(false);
    });
    it('with another player in front it sends nothing and says why', async () => {
      await setup();
      windows('Edge', 'msedge');
      await flush(10_000);
      await tabUp();
      await act(async () => (document.querySelectorAll('button.sp-qrow')[0] as HTMLButtonElement).click());
      await flush();
      expect(sent.some((s) => s[0] === 'media_next')).toBe(false);
      expect(screen.getByText('Open its list to play it')).toBeTruthy();
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
  it('shows the song, its artist, the times, and no Save to Liked', async () => {
    await setup();
    await open();
    expect(document.querySelector('.sp-pl-title b')?.textContent).toBe('Song 1');
    expect(document.querySelector('.sp-pl-title small')?.textContent).toBe('Some Artist');
    expect(slider().getAttribute('aria-valuetext')).toBe('1:05 of 3:20');
    expect(screen.queryByRole('button', { name: /liked/i })).toBeNull();
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
  it('the arrow keys move it five seconds, Home goes to the start', async () => {
    await setup();
    await open();
    await act(async () => slider().focus());
    await act(async () => fireEvent.keyDown(slider(), { key: 'ArrowRight' }));
    await act(async () => fireEvent.keyDown(slider(), { key: 'Home' }));
    const seeks = sent.filter((s) => s[0] === 'wall2_spotify_seek').map((s) => (s[1] as { positionMs: number }).positionMs);
    expect(seeks).toEqual([65_000 + SEEK_STEP_MS, 0]);
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
  it('the buttons go through Windows while Spotify is in front, and say why they cannot otherwise', async () => {
    await setup();
    await open();
    await flush(2000);
    await act(async () => (document.querySelector('[data-control="next"]') as HTMLButtonElement).click());
    await act(async () => (document.querySelector('[data-control="play"]') as HTMLButtonElement).click());
    await act(async () => (document.querySelector('[data-control="previous"]') as HTMLButtonElement).click());
    expect(sent.map((s) => s[0]).filter((n) => n.startsWith('media_'))).toEqual(['media_next', 'media_play_pause', 'media_previous']);
    sent.length = 0;
    windows('Edge', 'msedge');
    await flush(10_000);
    const next = document.querySelector('[data-control="next"]') as HTMLButtonElement;
    expect(next.getAttribute('aria-disabled')).toBe('true');
    await act(async () => next.click());
    expect(sent.some((s) => s[0] === 'media_next')).toBe(false);
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

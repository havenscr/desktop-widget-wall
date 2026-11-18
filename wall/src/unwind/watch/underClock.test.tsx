// @ts-ignore node's own file call; the stylesheet rules are read as text.
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { resetNowPlaying } from '../../music/store';
import { usePlaceStore } from '../../state/places';
import { HoverTipLayer, resetTip } from '../../ui/HoverTip';
import { resetListenSource } from '../spotify/model';
import { resetSpotifyStatus, useSpotifyStatus } from '../spotify/status';
import { underClock } from '../UnderClock';
import { PIN_MENU_CLOSE_MS } from './PinMenu';
import { PINS_KEY, resetPins, usePins } from './pins';
import { LEVEL_EVERY_MS, framePoster, PlayerFrame } from './PlayerFrame';
import { SAVED_KEY, type SavedItem } from './saved';
import { resetSleep, stepSleep, useSleep } from './sleep';
import { resetWatch, useWatchStore, VOLUME_KEY } from './store';
import { UnwindView } from './testView';
import { YOUTUBE_EMBED_ORIGIN } from './urls';
import { ctlTiming, CTL_REST_MS } from './Watch';

vi.setConfig({ testTimeout: 20_000 });

const ITEMS: SavedItem[] = [
  { kind: 'video', id: 'Ab3dEfGh1jK', label: 'Night drive mix' },
  { kind: 'live', id: 'Lofi_Live01', label: 'Lofi beats radio, live' },
  { kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor' },
  { kind: 'playlist', id: 'PLmockPlaylist0001', label: 'Weekend list' },
];
const keys = ITEMS.map((i) => `${i.kind}:${i.id}`);
const sets: unknown[] = [];

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

function seed(opts: { saved?: SavedItem[]; pins?: (string | null)[]; volume?: number } = {}) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(opts.saved ?? ITEMS));
  if (opts.pins) localStorage.setItem(PINS_KEY, JSON.stringify(opts.pins));
  if (opts.volume !== undefined) localStorage.setItem(VOLUME_KEY, String(opts.volume));
  resetWatch();
  resetPins();
}

async function show(tab: 'listen' | 'watch' = 'watch') {
  useWatchStore.getState().setTab(tab);
  const r = render(
    <>
      <UnwindView />
      <HoverTipLayer />
    </>,
  );
  await flush();
  return r;
}

const quick = () => document.querySelector('.u-quick') as HTMLElement;
const pins = () => [...document.querySelectorAll<HTMLButtonElement>('.u-pin')];
const slider = () => document.querySelector('.u-qvol input') as HTMLInputElement;
const sound = () => document.querySelector('.u-snd') as HTMLButtonElement;
const chip = () => document.querySelector('.u-sleep') as HTMLButtonElement;
const menu = () => document.querySelector('.u-pin-menu') as HTMLElement | null;
const hover = async (el: Element) => {
  fireEvent.mouseEnter(el);
  await flush(1000);
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sets.length = 0;
  resetWatch();
  resetPins();
  resetSleep();
  resetListenSource();
  resetSpotifyStatus();
  usePlaceStore.setState({ active: 'unwind', from: 'work' });
  mocks.set('get_now_playing', () => null);
  mocks.set('set_audio_session_volume', (a) => void sets.push(a));
  underClock.hold = false;
  ctlTiming.restMs = CTL_REST_MS;
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});
afterEach(() => {
  resetTip();
  resetSleep();
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
  localStorage.clear();
  framePoster.render = null;
});

describe('the pins', () => {
  it('shows three dashed places when nothing is pinned', async () => {
    seed();
    await show();
    expect(pins()).toHaveLength(3);
    for (const p of pins()) {
      expect(p.className).toContain('add');
      expect(p.textContent).toBe('Add a pin');
    }
  });

  it('shows each pin with the list label, so a rename shows on it, and an empty place for an item that left', async () => {
    seed({ pins: [keys[0]!, keys[1]!, 'video:Zz9yXxWw8vU'] });
    await show();
    expect(pins().map((p) => p.textContent)).toEqual(['Night drive mix', 'Lofi beats radio, live', 'Add a pin']);
    act(() => useWatchStore.getState().rename(keys[0]!, 'Renamed mix'));
    expect(pins()[0]!.textContent).toBe('Renamed mix');
  });

  it('plays a pin from Watch or Listen, switches to Watch and lights it; the lit pin does not restart', async () => {
    seed({ pins: [keys[0]!, keys[1]!, null] });
    await show('listen');
    await act(async () => pins()[1]!.click());
    const st = useWatchStore.getState();
    expect(st.tab).toBe('watch');
    expect(st.playing?.id).toBe('Lofi_Live01');
    expect(pins()[1]!.className).toContain(' on');
    expect(pins()[1]!.getAttribute('aria-pressed')).toBe('true');
    expect(pins()[0]!.className).not.toContain(' on');
    act(() => useWatchStore.getState().setReport({ started: true, time: 40 }));
    await act(async () => pins()[1]!.click());
    expect(useWatchStore.getState().report.started).toBe(true);
    await act(async () => pins()[0]!.click());
    expect(useWatchStore.getState().playing?.id).toBe('Ab3dEfGh1jK');
    expect(useWatchStore.getState().report.started).toBe(false);
  });

  it('says what a pin is in its hover tip', async () => {
    seed({ pins: [keys[0]!, null, null] });
    await show();
    await hover(pins()[0]!);
    expect(screen.getByText(/YouTube video · Click to play/)).toBeTruthy();
  });
});

describe('the pin menu', () => {
  it('opens from an empty place with the heading and every item not already pinned, and pins the choice', async () => {
    seed({ pins: [keys[0]!, null, null] });
    await show();
    await act(async () => pins()[1]!.click());
    const m = menu()!;
    expect(within(m).getByText('Pin from the Watch list')).toBeTruthy();
    expect(within(m).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Lofi beats radio, live', 'pixel_harbor', 'Weekend list']);
    await act(async () => within(m).getByText('pixel_harbor').click());
    expect(menu()).toBeNull();
    expect(usePins.getState().places).toEqual([keys[0], keys[2], null]);
    expect(document.activeElement).toBe(pins()[1]);
  });

  it('with an empty Watch list says to add a video first and has an Open Watch button', async () => {
    seed({ saved: [] });
    await show('listen');
    await act(async () => pins()[0]!.click());
    const m = menu()!;
    expect(within(m).getByText('Add a video to the Watch list first.')).toBeTruthy();
    await act(async () => within(m).getByRole('menuitem', { name: 'Open Watch' }).click());
    expect(useWatchStore.getState().tab).toBe('watch');
    expect(menu()).toBeNull();
  });

  it('opens Replace and Remove on a right click; Remove empties the place, Replace brings the list', async () => {
    seed({ pins: [keys[0]!, keys[1]!, null] });
    await show();
    fireEvent.contextMenu(pins()[0]!);
    expect(within(menu()!).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Replace', 'Remove']);
    await act(async () => within(menu()!).getByText('Remove').click());
    expect(usePins.getState().places).toEqual([null, keys[1], null]);
    fireEvent.contextMenu(pins()[1]!);
    await act(async () => within(menu()!).getByText('Replace').click());
    expect(within(menu()!).getByText('Pin from the Watch list')).toBeTruthy();
    await act(async () => within(menu()!).getByText('Weekend list').click());
    expect(usePins.getState().places).toEqual([null, keys[3], null]);
  });

  it('opens an add menu on a right click of an empty place', async () => {
    seed();
    await show();
    fireEvent.contextMenu(pins()[2]!);
    expect(within(menu()!).getByText('Pin from the Watch list')).toBeTruthy();
  });

  it('opens from the keyboard (Shift+F10, the menu key), moves with the arrows and closes on Escape with focus back on the pin', async () => {
    seed({ pins: [keys[0]!, null, null] });
    await show();
    pins()[0]!.focus();
    fireEvent.keyDown(pins()[0]!, { key: 'F10', shiftKey: true });
    const rows = within(menu()!).getAllByRole('menuitem');
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(menu()!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(menu()!, { key: 'ArrowUp' });
    fireEvent.keyDown(menu()!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(pins()[0]);
    fireEvent.keyDown(pins()[0]!, { key: 'ContextMenu' });
    expect(menu()).not.toBeNull();
  });

  it('closes on a press elsewhere and after the wait with the pointer away', async () => {
    seed();
    await show();
    await act(async () => pins()[0]!.click());
    expect(menu()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(menu()).toBeNull();
    await act(async () => pins()[0]!.click());
    await flush(PIN_MENU_CLOSE_MS + 10);
    expect(menu()).toBeNull();
  });

  it('stays open while the pointer is over it', async () => {
    seed();
    await show();
    await act(async () => pins()[0]!.click());
    fireEvent.pointerEnter(menu()!);
    await flush(PIN_MENU_CLOSE_MS * 2);
    expect(menu()).not.toBeNull();
  });
});

describe('the pin menu opened by the keyboard', () => {
  it('opened by Enter then a click stays open past the close delay with no key', async () => {
    seed();
    await show();
    act(() => pins()[0]!.focus());
    fireEvent.keyDown(pins()[0]!, { key: 'Enter' });
    await act(async () => pins()[0]!.click());
    expect(menu()).not.toBeNull();
    await flush(PIN_MENU_CLOSE_MS * 2);
    expect(menu()).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menu()).toBeNull();
  });

  it('opened by Space the same way stays open', async () => {
    seed();
    await show();
    act(() => pins()[1]!.focus());
    fireEvent.keyDown(pins()[1]!, { key: ' ' });
    fireEvent.keyUp(pins()[1]!, { key: ' ' });
    await act(async () => pins()[1]!.click());
    expect(menu()).not.toBeNull();
    await flush(PIN_MENU_CLOSE_MS * 2);
    expect(menu()).not.toBeNull();
  });

  it('opened by the mouse still closes after the delay with the pointer away', async () => {
    seed();
    await show();
    fireEvent.pointerDown(pins()[2]!);
    await act(async () => pins()[2]!.click());
    await flush(PIN_MENU_CLOSE_MS + 10);
    expect(menu()).toBeNull();
  });

  it('shows a long label whole in a tip on hover and on keyboard focus, not in a title attribute', async () => {
    const long = 'Night drive mix for the long way home, the whole album';
    seed({ saved: [{ kind: 'video', id: 'Ab3dEfGh1jK', label: long }, ...ITEMS.slice(1)] });
    await show();
    await act(async () => pins()[0]!.click());
    const row = within(menu()!).getAllByRole('menuitem')[0]!;
    expect(row.hasAttribute('title')).toBe(false);
    const before = screen.getAllByText(long).length;
    await hover(row);
    expect(screen.getAllByText(long).length).toBe(before + 1);
    resetTip();
    act(() => row.blur());
    await act(async () => void row.focus());
    await flush(10);
    expect(screen.getAllByText(long).length).toBe(before + 1);
  });
});

describe('rest and shown', () => {
  const zoneRect = (r: DOMRect) => {
    const zone = document.querySelector('.u-zone') as HTMLElement;
    zone.getBoundingClientRect = () => r;
  };
  const rect = new DOMRect(100, 100, 470, 230);
  const move = (x: number, y: number) => act(() => void document.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true })));

  it('starts at rest, comes up with the pointer on the column and goes quiet CTL_REST_MS after it leaves', async () => {
    seed({ pins: [keys[0]!, null, null] });
    await show();
    zoneRect(rect);
    expect(quick().hasAttribute('data-rest')).toBe(true);
    move(300, 150);
    expect(quick().hasAttribute('data-rest')).toBe(false);
    move(900, 150);
    await flush(CTL_REST_MS - 50);
    expect(quick().hasAttribute('data-rest')).toBe(false);
    await flush(100);
    expect(quick().hasAttribute('data-rest')).toBe(true);
  });

  it('is held shown by keyboard focus inside, by an open menu and by the dev hold', async () => {
    seed();
    await show();
    fireEvent.keyDown(document, { key: 'Tab' });
    act(() => pins()[0]!.focus());
    expect(quick().hasAttribute('data-rest')).toBe(false);
    act(() => pins()[0]!.blur());
    await flush(CTL_REST_MS + 10);
    expect(quick().hasAttribute('data-rest')).toBe(true);
    await act(async () => pins()[0]!.click());
    await flush(CTL_REST_MS * 1);
    expect(quick().hasAttribute('data-rest')).toBe(false);
  });

  it('is held shown by keyboard focus on the Listen and Watch tabs, not by a click on one', async () => {
    seed();
    await show();
    fireEvent.keyDown(document, { key: 'Tab' });
    act(() => (document.querySelector('.u-tab') as HTMLElement).focus());
    expect(quick().hasAttribute('data-rest')).toBe(false);
    act(() => (document.querySelector('.u-tab') as HTMLElement).blur());
    await flush(CTL_REST_MS + 10);
    expect(quick().hasAttribute('data-rest')).toBe(true);
    fireEvent.pointerDown(document.querySelector('.u-tab')!);
    act(() => (document.querySelector('.u-tab') as HTMLElement).focus());
    expect(quick().hasAttribute('data-rest')).toBe(true);
  });

  it('keeps the lit pin cyan at rest in the stylesheet, and has no transition under reduced motion', () => {
    const css = readFileSync('src/styles/unwind.css', 'utf8') as string;
    expect(css).toMatch(/\.u-quick\[data-rest\] :is\(\.u-pin:not\(\.on\), \.u-sleep:not\(\.on\), \.u-snd\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.u-pin,[\s\S]*?transition: none;/);
  });
});

describe('the volume on Watch (the wall video)', () => {
  it('shows the stored level, moves it, keeps it, and mutes through the same state as the play row', async () => {
    seed({ volume: 40 });
    await show();
    expect(slider().value).toBe('40');
    expect(document.querySelector('.u-qval')!.textContent).toBe('40');
    expect(slider().getAttribute('aria-valuetext')).toBe('40 percent');
    fireEvent.change(slider(), { target: { value: '25' } });
    expect(useWatchStore.getState().volume).toBe(25);
    expect(localStorage.getItem(VOLUME_KEY)).toBe('25');
    fireEvent.keyDown(slider(), { key: 'ArrowRight' });
    expect(useWatchStore.getState().volume).toBe(30);
    fireEvent.keyDown(slider(), { key: 'ArrowDown' });
    expect(useWatchStore.getState().volume).toBe(25);
    await act(async () => sound().click());
    expect(useWatchStore.getState().muted).toBe(true);
    expect(sound().getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.u-qvol')!.hasAttribute('data-dim')).toBe(true);
    expect(slider().disabled).toBe(false);
    fireEvent.change(slider(), { target: { value: '60' } });
    expect(useWatchStore.getState().volume).toBe(60);
  });

  it('bounds the level and defaults to 100', () => {
    seed();
    expect(useWatchStore.getState().volume).toBe(100);
    useWatchStore.getState().setVolume(140);
    expect(useWatchStore.getState().volume).toBe(100);
    useWatchStore.getState().setVolume(-5);
    expect(useWatchStore.getState().volume).toBe(0);
    useWatchStore.getState().setVolume(33.6);
    expect(useWatchStore.getState().volume).toBe(34);
    localStorage.setItem(VOLUME_KEY, '250');
    useWatchStore.getState().load();
    expect(useWatchStore.getState().volume).toBe(100);
    localStorage.setItem(VOLUME_KEY, 'loud');
    useWatchStore.getState().load();
    expect(useWatchStore.getState().volume).toBe(100);
  });

  it('with nothing playing the slider still sets the level the next video starts at', async () => {
    seed({ volume: 40 });
    await show();
    await hover(document.querySelector('.u-qvol')!);
    expect(screen.getByText('The next video starts at 40 percent')).toBeTruthy();
  });

  it('is dim and disabled for Twitch, with its tip', async () => {
    seed();
    useWatchStore.getState().play(ITEMS[2]!);
    await show();
    expect(slider().disabled).toBe(true);
    expect(sound().getAttribute('aria-disabled')).toBe('true');
    expect(document.querySelector('.u-qval')!.textContent).toBe('');
    await hover(sound());
    expect(screen.getByText('Twitch keeps its own volume. Use the sound control on the video.')).toBeTruthy();
    await act(async () => sound().click());
    expect(useWatchStore.getState().muted).toBe(false);
  });

  it('never sets a Windows audio session for the wall video, a web view or a browser', async () => {
    seed();
    mocks.set('get_audio_sessions', () => ({ master: { volume: 50, muted: false }, sessions: [{ id: '1:msedgewebview2.exe', name: 'msedgewebview2.exe', volume: 70, muted: false }, { id: '2:msedge.exe', name: 'msedge.exe', volume: 70, muted: false }] }));
    mocks.set('get_now_playing', () => ({ title: 'Night drive mix', artist: 'Channel', playback_status: 'playing', source_app: 'msedgewebview2.exe' }));
    useWatchStore.getState().play(ITEMS[0]!);
    await show('watch');
    fireEvent.change(slider(), { target: { value: '10' } });
    await act(async () => sound().click());
    await flush(500);
    // Listen with the video playing out of sight: still the wall video.
    act(() => useWatchStore.getState().setTab('listen'));
    await flush(3500);
    fireEvent.change(slider(), { target: { value: '20' } });
    await flush(500);
    expect(useWatchStore.getState().volume).toBe(20);
    expect(sets).toEqual([]);
  });
});

describe('the volume on Listen (the player app)', () => {
  it('never names the web view in the row, its tips or its labels', async () => {
    seed();
    mocks.set('get_audio_sessions', () => ({ master: { volume: 50, muted: false }, sessions: [{ id: '1:msedgewebview2.exe', name: 'msedgewebview2.exe', volume: 70, muted: false }] }));
    mocks.set('get_now_playing', () => ({ title: 'Mail alert', playback_status: 'playing', source_app_id: 'msedgewebview2.exe' }));
    await show('listen');
    await flush(3500);
    await hover(sound());
    const words = [document.body.textContent ?? '', ...[...document.querySelectorAll('[aria-label], [title]')].map((e) => `${e.getAttribute('aria-label')} ${e.getAttribute('title')}`)].join(' ');
    expect(words.toLowerCase()).not.toContain('webview');
  });

  const session = (name: string, volume = 70) => ({ master: { volume: 50, muted: false }, sessions: [{ id: `1:${name}`, name, volume, muted: false }] });
  const spotifyPlaying = () => mocks.set('get_now_playing', () => ({ title: 'Song 1', artist: 'Some Artist', playback_status: 'playing', source_app: 'Spotify' }));

  it('reads the app session, sets it through the existing path, silences it and brings the level back', async () => {
    seed();
    spotifyPlaying();
    mocks.set('get_audio_sessions', () => session('Spotify.exe'));
    await show('listen');
    await flush(3000);
    expect(slider().value).toBe('70');
    expect(document.querySelector('.u-qval')!.textContent).toBe('70');
    await hover(document.querySelector('.u-qvol')!);
    expect(screen.getByText('Volume of what plays: Spotify, 70 percent')).toBeTruthy();
    fireEvent.change(slider(), { target: { value: '35' } });
    expect(sets).toEqual([{ sessionName: 'Spotify.exe', level: 35 }]);
    await act(async () => sound().click());
    await flush(150);
    expect(sets[sets.length - 1]).toEqual({ sessionName: 'Spotify.exe', level: 0 });
    expect(sound().getAttribute('aria-pressed')).toBe('true');
    await act(async () => sound().click());
    await flush(150);
    expect(sets[sets.length - 1]).toEqual({ sessionName: 'Spotify.exe', level: 35 });
  });

  it('is dim and disabled with no session, with the tip and an empty value', async () => {
    seed();
    spotifyPlaying();
    mocks.set('get_audio_sessions', () => ({ master: { volume: 50, muted: false }, sessions: [] }));
    await show('listen');
    await flush(3000);
    expect(slider().disabled).toBe(true);
    expect(document.querySelector('.u-qval')!.textContent).toBe('');
    await hover(sound());
    expect(screen.getByText('Nothing playing on this PC can be turned up or down here.')).toBeTruthy();
    await act(async () => sound().click());
    expect(sets).toEqual([]);
  });

  it('never moves a browser session from this row', async () => {
    seed();
    mocks.set('get_now_playing', () => ({ title: 'A tab', artist: 'Site', playback_status: 'playing', source_app: 'Edge' }));
    mocks.set('get_audio_sessions', () => session('msedge.exe'));
    await show('listen');
    await flush(3000);
    expect(slider().disabled).toBe(true);
    await act(async () => sound().click());
    await flush(300);
    expect(sets).toEqual([]);
  });

  it('keeps Up next to one song under the rows', async () => {
    seed();
    useSpotifyStatus.setState({ status: { setup: true, signedIn: true, reason: null }, failed: false });
    const t = (n: number) => ({ id: String(n).padStart(22, '0'), name: `Song ${n}`, artists: 'Some Artist', album: 'Some Album', durationMs: 185_000, imageUrl: null, thumbUrl: null, playable: true });
    mocks.set('wall2_spotify_queue', () => ({ current: t(1), next: [t(2), t(3), t(4)] }));
    mocks.set('wall2_spotify_status', () => ({ setup: true, signedIn: true, reason: null }));
    await show('listen');
    await flush(100);
    expect(document.querySelectorAll('.u-next-row')).toHaveLength(1);
    expect(screen.getByText('Song 2')).toBeTruthy();
    expect(screen.queryByText('Song 3')).toBeNull();
  });
});

describe('the sleep chip', () => {
  it('steps through 30, 60, 90 and off on a click and says the minutes left', async () => {
    seed();
    await show();
    expect(chip().textContent).toBe('Stop in 30 min');
    await act(async () => chip().click());
    expect(chip().textContent).toBe('Stops in 30 min');
    expect(chip().className).toContain(' on');
    await act(async () => chip().click());
    expect(chip().textContent).toBe('Stops in 60 min');
    await flush(25 * 60_000);
    expect(chip().textContent).toBe('Stops in 35 min');
    await act(async () => chip().click());
    await act(async () => chip().click());
    expect(chip().textContent).toBe('Stop in 30 min');
    expect(useSleep.getState().endsAt).toBeNull();
  });

  it('names the clock time and the next step in its tip, and what it cannot stop', async () => {
    seed();
    await show();
    act(() => stepSleep());
    await hover(chip());
    expect(screen.getByText(/^Stops at \d{1,2}:\d{2} (AM|PM)\. Click for 60 min\.$/)).toBeTruthy();
    expect(screen.getByText("Stops the wall's video and pauses the player shown on Listen; an app Windows cannot name is left alone")).toBeTruthy();
  });

  it('does not tick its words while the page is hidden, and reads them at once when it shows', async () => {
    seed();
    await show();
    act(() => stepSleep());
    expect(chip().textContent).toBe('Stops in 30 min');
    // Visible: the words follow the clock every ten seconds.
    vi.setSystemTime(Date.now() + 2 * 60_000);
    await flush(10_000);
    expect(chip().textContent).toBe('Stops in 28 min');
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    vi.setSystemTime(Date.now() + 10 * 60_000);
    await flush(60_000);
    expect(chip().textContent).toBe('Stops in 28 min');
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(chip().textContent).toBe('Stops in 17 min');
  });

  it('ends a playing video with its line', async () => {
    seed();
    useWatchStore.getState().play(ITEMS[0]!);
    await show();
    await act(async () => chip().click());
    await flush(30 * 60_000 + 50);
    await flush(10);
    expect(useWatchStore.getState().playing).toBeNull();
    expect(screen.getByText(/Stopped by the sleep timer\./)).toBeTruthy();
    expect(chip().textContent).toBe('Stop in 30 min');
  });
});

describe('the keyboard order and sizes', () => {
  it('tabs pins left to right, then the sound button, the slider and the chip', async () => {
    seed();
    await show();
    const order = [...quick().querySelectorAll<HTMLElement>('button, input')].filter((e) => !(e as HTMLInputElement).disabled);
    expect(order.map((e) => e.className.split(' ')[0])).toEqual(['u-pin', 'u-pin', 'u-pin', 'u-snd', '', 'u-sleep']);
    expect(order[4]!.tagName).toBe('INPUT');
  });

  it('draws the rows from the stylesheet at the sizes the picture has', () => {
    const css = readFileSync('src/styles/unwind.css', 'utf8') as string;
    const rule = (sel: string) => css.slice(css.lastIndexOf(`\n${sel} {`)).split('}')[0]!;
    expect(rule('.u-quick')).toContain('top: 252px');
    expect(rule('.u-pin')).toContain('height: 48px');
    expect(rule('.u-pin')).toContain('font: 500 16px/18px');
    expect(rule('.u-snd')).toContain('width: 40px');
    expect(rule('.u-sleep')).toContain('height: 40px');
    expect(rule('.u-sleep')).toContain('width: 173px');
    expect(rule('.u-qvol input')).toContain('height: 40px');
    expect(rule('.u-qval')).toContain('width: 36px');
    expect(rule('.u-next')).toContain('top: 362px');
  });
});

describe('the level reaches the player', () => {
  const V = 'Ab3dEfGh1jK';
  const posts = (win: Window) => vi.spyOn(win, 'postMessage').mockImplementation(() => {});
  const levelCalls = (post: ReturnType<typeof posts>) => post.mock.calls.map((c) => JSON.parse(c[0] as string)).filter((m) => m.func === 'setVolume').map((m) => m.args[0]);

  async function frame() {
    seed({ saved: [{ kind: 'video', id: V, label: 'Night drive mix' }] });
    useWatchStore.getState().play({ kind: 'video', id: V });
    render(<PlayerFrame item={{ kind: 'video', id: V }} title="t" />);
    await flush();
    const f = document.querySelector('iframe')!;
    const post = posts(f.contentWindow!);
    act(() => void fireEvent.load(f));
    return { f, post };
  }
  const ready = (f: HTMLIFrameElement) => act(() => void window.dispatchEvent(new MessageEvent('message', { origin: YOUTUBE_EMBED_ORIGIN, data: JSON.stringify({ event: 'onStateChange', info: 1 }), source: f.contentWindow })));

  it('starts at the stored level (the default 100 changes nothing) and follows the store, at most every 100 ms and ending on the last value', async () => {
    const { f, post } = await frame();
    ready(f);
    expect(levelCalls(post)).toEqual([100]);
    post.mockClear();
    act(() => useWatchStore.getState().setVolume(80));
    expect(levelCalls(post)).toEqual([80]);
    act(() => useWatchStore.getState().setVolume(70));
    act(() => useWatchStore.getState().setVolume(60));
    act(() => useWatchStore.getState().setVolume(50));
    expect(levelCalls(post)).toEqual([80]);
    await flush(LEVEL_EVERY_MS + 5);
    expect(levelCalls(post)).toEqual([80, 50]);
    for (const c of post.mock.calls) expect(c[1]).toBe(YOUTUBE_EMBED_ORIGIN);
  });

  it('sends no level while muted, and the level with the unmute', async () => {
    const { f, post } = await frame();
    ready(f);
    act(() => useWatchStore.getState().setMuted(true));
    post.mockClear();
    act(() => useWatchStore.getState().setVolume(30));
    await flush(LEVEL_EVERY_MS * 3);
    expect(levelCalls(post)).toEqual([]);
    act(() => useWatchStore.getState().setMuted(false));
    expect(levelCalls(post)).toEqual([30]);
  });

  it('starts a later video at the level kept for it', async () => {
    seed({ saved: [{ kind: 'video', id: V, label: 'Night drive mix' }], volume: 45 });
    useWatchStore.getState().play({ kind: 'video', id: V });
    render(<PlayerFrame item={{ kind: 'video', id: V }} title="t" />);
    await flush();
    const f = document.querySelector('iframe')!;
    const post = posts(f.contentWindow!);
    act(() => void fireEvent.load(f));
    ready(f);
    expect(levelCalls(post)).toEqual([45]);
  });
});

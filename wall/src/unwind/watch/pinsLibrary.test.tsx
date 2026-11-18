import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoverTipLayer, resetTip } from '../../ui/HoverTip';
import { Tile } from '../spotify/Tile';
import { useLibraryMenu, closeLibraryMenu, placeBox } from './libraryMenuModel';
import { LibraryMenuLayer } from './LibraryMenu';
import { PinArtSquare } from './PinArt';
import { PinButton } from './PinButton';
import { resetArtFailed } from './pinArtModel';
import { dropGone, makeLibraryPin, parsePins, pinKey, pinnable, pinnedAt, refreshLibraryPins, resetPins, usePins, validSpotifyImage, withLibraryPin, type LibraryPin } from './pins';
import type { SavedItem } from './saved';
import { resetWatch, useWatchStore } from './store';

const SP = 'AbCdEfGhIjKlMnOpQrStUv';
const SP2 = 'ZzCdEfGhIjKlMnOpQrStUv';
const ART = 'https://i.scdn.co/image/ab67616d00001e02aaaa';
const LIST: SavedItem[] = [
  { kind: 'video', id: 'Ab3dEfGh1jK', label: 'Night drive mix' },
  { kind: 'live', id: 'Lofi_Live01', label: 'Lofi beats radio' },
];
const lib = (over: Partial<LibraryPin> = {}): LibraryPin => ({ kind: 'spotify-playlist', id: SP, name: 'Harbor lights', art: ART, ...over });

// The accept and refuse lists of `valid_image` and `spotify_image_host` in the Rust side, copied here.
const ACCEPT = ['https://i.scdn.co/image/a', 'https://mosaic.scdn.co/640/a', 'https://image-cdn-ak.spotifycdn.com/image/a', 'https://image-cdn-fa.spotifycdn.com/image/a', 'https://lineup-images.scdn.co/a.jpg', 'https://I.SCDN.CO/image/a', 'https://i.scdn.co:443/image/a'];
const REFUSE = ['http://i.scdn.co/image/a', 'https://scdn.co/a', 'https://spotifycdn.com/a', 'https://i.scdn.co.evil.example/a', 'https://evilscdn.co/a', 'https://evil-scdn.co/a', 'https://i.scdn.co:8443/a', 'https://user@i.scdn.co/a', 'https://i.scdn.co./a', 'https://example.com/i.scdn.co', 'https://evil.example/?x=.scdn.co', 'https://evil.example#.scdn.co'];

beforeEach(() => {
  localStorage.clear();
  resetWatch();
  useWatchStore.setState({ saved: LIST });
  resetPins();
  resetArtFailed();
  resetTip();
  closeLibraryMenu();
});
afterEach(() => cleanup());

describe('library pins as stored', () => {
  it('keeps old strings and reads objects', () => {
    expect(parsePins(JSON.stringify(['video:Ab3dEfGh1jK', lib(), null]))).toEqual(['video:Ab3dEfGh1jK', lib(), null]);
  });
  it('checks the cover address by the Rust accept and refuse lists', () => {
    for (const a of ACCEPT) expect(validSpotifyImage(a), a).toBe(a.length <= 200);
    for (const a of REFUSE) expect(validSpotifyImage(a), a).toBe(false);
    expect(validSpotifyImage(`https://i.scdn.co/${'a'.repeat(190)}`)).toBe(false);
    expect(makeLibraryPin(lib({ art: 'https://evil.example/a' }))).toEqual({ kind: 'spotify-playlist', id: SP, name: 'Harbor lights' });
  });
  it('checks the YouTube cover shape and drops art for videos', () => {
    const good = 'https://i.ytimg.com/vi/Qk3mPz7aXy1/mqdefault.jpg';
    expect(makeLibraryPin({ kind: 'playlist', id: 'PLmocklistpin0001', name: 'x', art: good })?.art).toBe(good);
    expect(makeLibraryPin({ kind: 'playlist', id: 'PLmocklistpin0001', name: 'x', art: good.replace('mqdefault', 'hqdefault') })?.art).toBeUndefined();
    expect(makeLibraryPin({ kind: 'video', id: 'Ab3dEfGh1jK', name: 'x', art: good })?.art).toBeUndefined();
  });
  it('refuses bad ids, unknown kinds, extra fields are dropped, a key twice empties the second', () => {
    expect(makeLibraryPin({ kind: 'spotify-album', id: 'short', name: 'x' })).toBeNull();
    expect(makeLibraryPin({ kind: 'playlist', id: 'PLshort', name: 'x' })).toBeNull();
    expect(makeLibraryPin({ kind: 'radio', id: SP, name: 'x' })).toBeNull();
    expect(makeLibraryPin({ ...lib(), extra: 1 })).toEqual(lib());
    expect(parsePins(JSON.stringify([lib(), lib(), null]))).toEqual([lib(), null, null]);
    // A YouTube object and a Watch string for one video are one key.
    expect(parsePins(JSON.stringify([{ kind: 'video', id: 'Ab3dEfGh1jK', name: 'v' }, 'video:Ab3dEfGh1jK']))[1]).toBeNull();
  });
  it('reads three worst case objects and refuses 4001 characters whole', () => {
    const worst = (n: number) => ({ kind: 'spotify-playlist', id: `${n}`.repeat(22).slice(0, 22), name: '"'.repeat(60), art: `https://i.scdn.co/${'a'.repeat(180)}` });
    expect(parsePins(JSON.stringify([worst(1), worst(2), worst(3)])).filter(Boolean)).toHaveLength(3);
    // A bad entry empties only its own place.
    expect(parsePins(JSON.stringify([lib(), { kind: 'radio', id: SP, name: 'x' }, lib({ id: SP2 })]))).toEqual([lib(), null, lib({ id: SP2 })]);
    expect(parsePins(' '.repeat(4001))).toEqual([null, null, null]);
    expect(parsePins(`[${'null,'.repeat(400)}null]`)).toEqual([null, null, null]);
  });
  it("shows the old reader empty places for objects while its own strings still read", () => {
    const old = (raw: string) => {
      const v = JSON.parse(raw) as unknown[];
      return v.map((k) => (typeof k === 'string' && /^(video|live|playlist|twitch):/.test(k) ? k : null));
    };
    expect(old(JSON.stringify([lib(), 'video:Ab3dEfGh1jK']))).toEqual([null, 'video:Ab3dEfGh1jK']);
  });
});

describe('library pins as kept', () => {
  it('writes at the index, replaces, and refuses a pinned key, a bad index and a bad entry', () => {
    const a = withLibraryPin([null, null, null], LIST, 1, lib());
    expect(a[1]).toEqual(lib());
    expect(withLibraryPin(a, LIST, 1, lib({ id: SP2 }))[1]).toMatchObject({ id: SP2 });
    expect(withLibraryPin(a, LIST, 0, lib())).toEqual(a);
    expect(withLibraryPin(a, LIST, 5, lib({ id: SP2 }))).toEqual(a);
    expect(withLibraryPin(a, LIST, 0, { kind: 'x' })).toEqual(a);
    const w = withLibraryPin(['video:Ab3dEfGh1jK', null, null], LIST, 1, { kind: 'video', id: 'Ab3dEfGh1jK', name: 'v' });
    expect(w).toEqual(['video:Ab3dEfGh1jK', null, null]);
    expect(pinnedAt(a, pinKey(lib()))).toBe(1);
    expect(pinnedAt(a, 'x:y')).toBe(-1);
  });
  it('keeps objects when a Watch item leaves, and never offers a pinned key', () => {
    expect(dropGone([lib(), 'video:Gone0000000', null], LIST)).toEqual([lib(), null, null]);
    expect(pinnable([{ kind: 'video', id: 'Ab3dEfGh1jK', name: 'v' }, null, null], LIST).map((i) => i.id)).toEqual(['Lofi_Live01']);
  });
  it('refreshes a name and cover in one write, and none when nothing differs', () => {
    const places = [lib(), null, null];
    expect(refreshLibraryPins(places, [{ kind: 'spotify-playlist', id: SP, name: 'Harbor lights', art: ART }])).toBe(places);
    const next = refreshLibraryPins(places, [{ kind: 'spotify-playlist', id: SP, name: 'New name', art: ART }]);
    expect(next[0]).toMatchObject({ name: 'New name', art: ART });
    usePins.setState({ places });
    usePins.getState().refresh([{ kind: 'spotify-playlist', id: SP, name: 'New name', art: ART }]);
    expect(JSON.parse(localStorage.getItem('wall2-watch-pins')!)[0].name).toBe('New name');
  });
});

describe('playPinned', () => {
  it('plays an item that is not in the Watch list and shows Watch', () => {
    expect(useWatchStore.getState().playPinned({ kind: 'video', id: 'Zz9yXxWw8vU' }, 'Rain')).toBe(true);
    const s = useWatchStore.getState();
    expect([s.playing?.id, s.source, s.tab]).toEqual(['Zz9yXxWw8vU', 'watch', 'watch']);
    expect(useWatchStore.getState().playPinned({ kind: 'twitch', id: 'pixel_harbor' }, 'x')).toBe(false);
  });
});

describe('the pin art', () => {
  it('shows the cover with a badge, falls back on error, and never for Twitch', () => {
    const { container, rerender } = render(<PinArtSquare shown={{ key: 'k', kind: 'spotify-playlist', art: ART }} />);
    expect(container.querySelector('img')).not.toBeNull();
    expect(container.querySelector('.u-pin-badge')).not.toBeNull();
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.u-pin-badge')).toBeNull();
    rerender(<PinArtSquare shown={{ key: 't', kind: 'twitch', art: ART }} />);
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('placement', () => {
  it('flips at the right edge and the foot, and clamps', () => {
    expect(placeBox({ x: 100, y: 100 }, 350, 200, 2560, 720)).toEqual({ left: 100, top: 100 });
    expect(placeBox({ x: 2500, y: 100 }, 350, 200, 2560, 720)).toEqual({ left: 2150, top: 100 });
    expect(placeBox({ x: 100, y: 700 }, 350, 200, 2560, 720)).toEqual({ left: 100, top: 500 });
    expect(placeBox({ x: 100, y: 100 }, 350, 900, 2560, 720)).toEqual({ left: 100, top: 8 });
    expect(placeBox({ x: 1, y: 1 }, 350, 200, 2560, 720)).toEqual({ left: 8, top: 8 });
  });
});

function Harness({ play = vi.fn() }: { play?: () => void }) {
  return (
    <>
      <Tile item={{ id: SP, name: 'Harbor lights', kind: 'playlist', imageUrl: ART, thumbUrl: null, subtitle: null, count: 3 }} kindWord onOpen={() => undefined} onPlay={play} onShuffle={() => undefined} />
      <LibraryMenuLayer />
      <HoverTipLayer />
    </>
  );
}

describe('the right-click menu on a Spotify tile', () => {
  it('opens on right-click with its actions and Pin to the left, runs an action once, and Escape returns focus', async () => {
    const play = vi.fn();
    render(<Harness play={play} />);
    const tile = document.querySelector('.sp-tile') as HTMLElement;
    fireEvent.contextMenu(tile, { clientX: 20, clientY: 20 });
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Play', 'Shuffle', 'Songs', 'Pin to the left']);
    expect(document.querySelector('[role=separator]')).not.toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Play' }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(useLibraryMenu.getState().open).toBeNull();
    fireEvent.keyDown(tile, { key: 'ContextMenu' });
    expect(useLibraryMenu.getState().open?.byKeyboard).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useLibraryMenu.getState().open).toBeNull();
    expect(document.activeElement).toBe(tile);
    expect(document.querySelector('.hover-tip')).toBeNull();
  });
  it('opens on Shift+F10 and a second open replaces the first', () => {
    render(<Harness />);
    const tile = document.querySelector('.sp-tile') as HTMLElement;
    fireEvent.keyDown(tile, { key: 'F10', shiftKey: true });
    expect(useLibraryMenu.getState().open).not.toBeNull();
    fireEvent.contextMenu(tile, { clientX: 5, clientY: 5 });
    expect(document.querySelectorAll('.u-lib-menu')).toHaveLength(1);
  });
  it('the chooser lists three places, writes on a click and closes, and ArrowLeft goes back', () => {
    usePins.setState({ places: ['video:Ab3dEfGh1jK', null, null] });
    render(<Harness />);
    const tile = document.querySelector('.sp-tile') as HTMLElement;
    fireEvent.contextMenu(tile, { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByRole('menuitem', { name: /Pin to the left/ }));
    const rows = screen.getAllByRole('menuitem');
    expect(rows.map((r) => r.textContent)).toEqual(['Pin 1Night drive mix', 'Pin 2Empty', 'Pin 3Empty']);
    expect(document.querySelector('.u-lib-empty')).not.toBeNull();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowLeft' });
    expect(screen.getByText('Pin to the left')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /Pin to the left/ }));
    fireEvent.click(screen.getAllByRole('menuitem')[1]!);
    expect(usePins.getState().places[1]).toMatchObject({ kind: 'spotify-playlist', id: SP });
    expect(useLibraryMenu.getState().open).toBeNull();
    // Already pinned now: the Pin row is off and says where.
    fireEvent.contextMenu(tile, { clientX: 20, clientY: 20 });
    const off = screen.getByRole('menuitem', { name: 'Pinned in Pin 2' });
    expect(off.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(off);
    expect(screen.queryByText('Pin 1Night drive mix')).toBeNull();
  });
  it('a menu opened right after the chooser shows the actions again', () => {
    render(<Harness />);
    const tile = document.querySelector('.sp-tile') as HTMLElement;
    fireEvent.contextMenu(tile, { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByRole('menuitem', { name: /Pin to the left/ }));
    expect(screen.getByText(/in place of/)).toBeTruthy();
    fireEvent.keyDown(tile, { key: 'ContextMenu' });
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Play', 'Shuffle', 'Songs', 'Pin to the left']);
    act(() => closeLibraryMenu());
    fireEvent.click(tile);
    fireEvent.contextMenu(tile, { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByRole('menuitem', { name: /Pin to the left/ }));
    act(() => closeLibraryMenu());
    fireEvent.keyDown(tile, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menuitem', { name: 'Play' })).toBeTruthy();
  });
  it('says so when the item was pinned elsewhere while the chooser was open', () => {
    render(<Harness />);
    const tile = document.querySelector('.sp-tile') as HTMLElement;
    fireEvent.contextMenu(tile, { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByRole('menuitem', { name: /Pin to the left/ }));
    act(() => usePins.getState().pinLibrary(2, { kind: 'spotify-playlist', id: SP, name: 'Harbor lights' }));
    fireEvent.click(screen.getAllByRole('menuitem')[0]!);
    expect(screen.getByRole('status').textContent).toBe('Already pinned in Pin 3');
    expect(useLibraryMenu.getState().open).not.toBeNull();
    expect(usePins.getState().places[0]).toBeNull();
  });
  it('closes when the source scrolls', () => {
    render(<Harness />);
    fireEvent.contextMenu(document.querySelector('.sp-tile') as HTMLElement, { clientX: 20, clientY: 20 });
    expect(useLibraryMenu.getState().open).not.toBeNull();
    const box = document.querySelector('.sp-tilebox') as HTMLElement;
    fireEvent.scroll(box);
    expect(useLibraryMenu.getState().open).toBeNull();
  });
  it('a right-click on a track tile opens nothing', () => {
    render(<Tile item={{ id: SP, name: 'Song', kind: 'track', imageUrl: null, thumbUrl: null, subtitle: null, count: null }} kindWord={false} onOpen={() => undefined} onPlay={() => undefined} onShuffle={() => undefined} />);
    fireEvent.contextMenu(document.querySelector('.sp-tile') as HTMLElement);
    expect(useLibraryMenu.getState().open).toBeNull();
  });
});

describe('the opened view Pin button', () => {
  it('opens the chooser when enabled and is off with its tip when pinned or not keepable', () => {
    const entry = { kind: 'spotify-playlist' as const, id: SP, name: 'Harbor lights', art: ART };
    const { rerender } = render(
      <>
        <PinButton entry={entry} name="Harbor lights" className="sp-btn" cannotLine="no" />
        <LibraryMenuLayer />
        <HoverTipLayer />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    closeLibraryMenu();
    act(() => usePins.getState().pinLibrary(2, entry));
    const b = screen.getByRole('button', { name: 'Pin' });
    expect(b.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(b);
    expect(useLibraryMenu.getState().open).toBeNull();
    rerender(<PinButton entry={{ ...entry, id: 'bad' }} name="x" className="sp-btn" cannotLine="This playlist cannot be pinned." />);
    expect(screen.getByRole('button', { name: 'Pin' }).getAttribute('data-disabled')).toBe('');
  });
});

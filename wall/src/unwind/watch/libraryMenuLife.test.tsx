import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { resetNowPlaying } from '../../music/store';
import { usePlaceStore } from '../../state/places';
import { HoverTipLayer, resetTip } from '../../ui/HoverTip';
import { resetListenSource } from '../spotify/model';
import { Tile } from '../spotify/Tile';
import { resetSpotifyStatus } from '../spotify/status';
import { closeLibraryMenu, useLibraryMenu } from './libraryMenuModel';
import { LibraryMenuLayer } from './LibraryMenu';
import { resetArtFailed } from './pinArtModel';
import { resetPins, usePins, type LibraryPin } from './pins';
import { SAVED_KEY, type SavedItem } from './saved';
import { resetWatch, useWatchStore } from './store';
import { UnwindView } from './testView';

vi.setConfig({ testTimeout: 20_000 });

const SP = 'AbCdEfGhIjKlMnOpQrStUv';
const LIST: SavedItem[] = [
  { kind: 'video', id: 'Ab3dEfGh1jK', label: 'Night drive mix' },
  { kind: 'playlist', id: 'PLmockPlaylist0001', label: 'Weekend list' },
];
const pin: LibraryPin = { kind: 'spotify-playlist', id: SP, name: 'Harbor lights' };
const item = { id: 'ZzCdEfGhIjKlMnOpQrStUv', name: 'Quiet hours', kind: 'playlist' as const, imageUrl: null, thumbUrl: null, subtitle: null, count: 3 };

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const pins = () => [...document.querySelectorAll<HTMLButtonElement>('.u-pin')];
const pinMenu = () => document.querySelector('.u-pin-menu:not(.u-lib-menu)') as HTMLElement | null;
const tile = () => document.querySelector('.sp-tile') as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem(SAVED_KEY, JSON.stringify(LIST));
  resetWatch();
  resetPins();
  resetArtFailed();
  resetTip();
  resetListenSource();
  resetSpotifyStatus();
  closeLibraryMenu();
  usePlaceStore.setState({ active: 'unwind', from: 'work' });
  mocks.set('get_now_playing', () => null);
  useWatchStore.setState({ saved: LIST });
  usePins.setState({ places: [pin, 'video:Ab3dEfGh1jK', null] });
});
afterEach(() => {
  cleanup();
  closeLibraryMenu();
  resetTip();
  vi.useRealTimers();
  mocks.clear();
  resetNowPlaying();
});

async function show() {
  render(
    <>
      <UnwindView />
      <Tile item={item} kindWord onOpen={() => undefined} onPlay={() => undefined} onShuffle={() => undefined} />
      <LibraryMenuLayer />
      <HoverTipLayer />
    </>,
  );
  await flush();
}

describe('the pin menu on a library pin', () => {
  it('offers Replace and Remove; Remove empties the place, Replace brings the Watch list and writes a Watch key', async () => {
    await show();
    fireEvent.contextMenu(pins()[0]!);
    expect(within(pinMenu()!).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Replace', 'Remove']);
    await act(async () => within(pinMenu()!).getByText('Remove').click());
    expect(usePins.getState().places).toEqual([null, 'video:Ab3dEfGh1jK', null]);
    // Put the library pin back and replace it from the Watch list.
    act(() => usePins.getState().pinLibrary(0, pin));
    fireEvent.contextMenu(pins()[0]!);
    await act(async () => within(pinMenu()!).getByText('Replace').click());
    expect(within(pinMenu()!).getByText('Pin from the Watch list')).toBeTruthy();
    await act(async () => within(pinMenu()!).getByText('Weekend list').click());
    expect(usePins.getState().places).toEqual(['playlist:PLmockPlaylist0001', 'video:Ab3dEfGh1jK', null]);
  });
});

describe('one menu at a time', () => {
  it('a library menu opened from the keyboard closes an open pin menu', async () => {
    await show();
    fireEvent.contextMenu(pins()[0]!);
    expect(pinMenu()).not.toBeNull();
    fireEvent.keyDown(tile(), { key: 'ContextMenu' });
    expect(pinMenu()).toBeNull();
    expect(useLibraryMenu.getState().open?.byKeyboard).toBe(true);
    expect(document.querySelectorAll('.u-lib-menu')).toHaveLength(1);
  });
  it('a library menu opened from the keyboard closes an open pin menu on Shift+F10 too', async () => {
    await show();
    fireEvent.contextMenu(pins()[2]!);
    expect(pinMenu()).not.toBeNull();
    fireEvent.keyDown(tile(), { key: 'F10', shiftKey: true });
    expect(pinMenu()).toBeNull();
    expect(useLibraryMenu.getState().open).not.toBeNull();
  });
});

describe('the tile card and an open library menu', () => {
  it('does not come back on mouse-enter or focus while the menu is open, and does again after it closes', async () => {
    await show();
    fireEvent.contextMenu(tile(), { clientX: 10, clientY: 10 });
    expect(useLibraryMenu.getState().open).not.toBeNull();
    fireEvent.mouseLeave(tile());
    fireEvent.mouseEnter(tile());
    await flush(2000);
    expect(document.querySelector('.hover-tip')).toBeNull();
    act(() => tile().focus());
    await flush(2000);
    expect(document.querySelector('.hover-tip')).toBeNull();
    act(() => closeLibraryMenu());
    fireEvent.mouseLeave(tile());
    fireEvent.mouseEnter(tile());
    await flush(2000);
    expect(document.querySelector('.hover-tip')).not.toBeNull();
  });
});

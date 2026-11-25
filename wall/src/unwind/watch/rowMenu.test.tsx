import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mocks } from '../../bridge/tauri';
import { HoverTipLayer, resetTip } from '../../ui/HoverTip';
import { resetNowPlaying } from '../../music/store';
import { useSignalStore } from '../../signals/store';
import { usePlaceStore } from '../../state/places';
import { resetLastPlayed } from '../lastPlayed';
import { ADD_ERRORS, SAVED_KEY, type SavedItem } from './saved';
import { LINK_ERRORS } from './links';
import { linkText, relinkSaved } from './rowMenuModel';
import { PINS_KEY, resetPins, usePins } from './pins';
import { resetWatch, useWatchStore } from './store';
import { UnwindView } from './testView';

const A = 'Ab3dEfGh1jK';
const B = 'Zy9xWvUt8sR';
const LIST: SavedItem[] = [
  { kind: 'video', id: A, label: 'Night drive mix', named: true },
  { kind: 'video', id: B, label: 'YouTube video' },
  { kind: 'live', id: 'Lofi_Live01', label: 'Lofi radio' },
];

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

async function open() {
  localStorage.setItem(SAVED_KEY, JSON.stringify(LIST));
  resetWatch();
  render(
    <>
      <UnwindView />
      <HoverTipLayer />
    </>,
  );
  await flush();
  act(() => useWatchStore.getState().setTab('watch'));
  await flush();
}
const rows = () => [...document.querySelectorAll<HTMLElement>('.w-list .w-row')];

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetWatch();
  usePlaceStore.setState({ active: 'unwind', from: 'work' });
  useSignalStore.setState({ call: null });
  mocks.set('get_now_playing', () => null);
});
afterEach(() => {
  vi.useRealTimers();
  resetTip();
  mocks.clear();
  resetNowPlaying();
  resetLastPlayed();
  localStorage.clear();
});

describe('relinkSaved', () => {
  it('keeps a custom name and the place, and takes the kind default for a default name', () => {
    const r = relinkSaved(LIST, `video:${A}`, 'https://youtu.be/QqQqQqQqQq1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.map((i) => i.id)).toEqual(['QqQqQqQqQq1', B, 'Lofi_Live01']);
    expect(r.items[0]!.label).toBe('Night drive mix');
    const d = relinkSaved(LIST, `video:${B}`, 'https://www.twitch.tv/pixel_harbor');
    expect(d.ok && d.items[1]).toEqual({ kind: 'twitch', id: 'pixel_harbor', label: 'pixel_harbor on Twitch' });
  });

  it('refuses a bad link with the paste box reason, and a link already in the list', () => {
    expect(relinkSaved(LIST, `video:${A}`, 'https://example.com/x')).toEqual({ ok: false, error: LINK_ERRORS.other });
    expect(relinkSaved(LIST, `video:${A}`, linkText(LIST[1]!))).toEqual({ ok: false, error: ADD_ERRORS.dup });
  });
});

describe('the row menu', () => {
  it('right-click opens exactly two items; Escape closes it', async () => {
    await open();
    fireEvent.contextMenu(rows()[0]!);
    await flush();
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Edit link', 'Open on YouTube']);
    fireEvent.keyDown(document, { key: 'Escape' });
    await flush();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Shift+F10 and the Menu key open it from a focused row; a press outside closes it', async () => {
    await open();
    fireEvent.keyDown(rows()[1]!.querySelector('.w-play')!, { key: 'F10', shiftKey: true });
    await flush();
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    await flush();
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.keyDown(rows()[1]!.querySelector('.w-play')!, { key: 'ContextMenu' });
    await flush();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('Open on YouTube sends the kind and id to the browser opener', async () => {
    const opened: unknown[] = [];
    mocks.set('wall2_watch_open', (a: unknown) => void opened.push(a));
    await open();
    fireEvent.contextMenu(rows()[0]!);
    await flush();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open on YouTube' }));
    await flush();
    expect(opened).toEqual([{ kind: 'video', id: A }]);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Edit link saves a new link in place; a bad link shows an error and keeps the old one', async () => {
    await open();
    fireEvent.contextMenu(rows()[0]!);
    await flush();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit link' }));
    await flush();
    const field = screen.getByLabelText('Link for Night drive mix') as HTMLInputElement;
    expect(field.value).toBe(linkText(LIST[0]!));
    fireEvent.change(field, { target: { value: 'https://example.com/nope' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await flush();
    expect(screen.getByRole('alert').textContent).toBe(LINK_ERRORS.other);
    expect(useWatchStore.getState().saved[0]!.id).toBe(A);
    fireEvent.change(field, { target: { value: 'https://www.youtube.com/watch?v=QqQqQqQqQq1' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await flush();
    const saved = useWatchStore.getState().saved;
    expect(saved[0]).toEqual({ kind: 'video', id: 'QqQqQqQqQq1', label: 'Night drive mix', named: true });
    expect(JSON.parse(localStorage.getItem(SAVED_KEY)!)[0].id).toBe('QqQqQqQqQq1');
    expect(screen.queryByLabelText(/^Link for/)).toBeNull();
  });

  it('Escape in the link field keeps the old link', async () => {
    await open();
    fireEvent.contextMenu(rows()[0]!);
    await flush();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit link' }));
    await flush();
    fireEvent.keyDown(screen.getByLabelText('Link for Night drive mix'), { key: 'Escape' });
    await flush();
    expect(useWatchStore.getState().saved[0]!.id).toBe(A);
    expect(screen.queryByLabelText(/^Link for/)).toBeNull();
  });
});

describe('hover tips and focus', () => {
  it('each menu item shows a hover tip', async () => {
    await open();
    fireEvent.contextMenu(rows()[0]!);
    await flush();
    for (const [name, text] of [['Edit link', 'Change the link of this youtube video'], ['Open on YouTube', 'Open this page on YouTube in your browser']] as const) {
      fireEvent.focus(screen.getByRole('menuitem', { name }));
      await flush(1000);
      expect(document.body.textContent).toContain(text);
    }
  });

  it('focus returns to the row after Escape and after a save', async () => {
    await open();
    const start = async () => {
      fireEvent.contextMenu(rows()[0]!);
      await flush();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit link' }));
      await flush();
      return screen.getByLabelText('Link for Night drive mix');
    };
    fireEvent.keyDown(await start(), { key: 'Escape' });
    await flush();
    expect(document.activeElement).toBe(rows()[0]!.querySelector('.w-play'));
    const field = await start();
    fireEvent.change(field, { target: { value: 'https://www.youtube.com/watch?v=QqQqQqQqQq1' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await flush();
    expect(document.activeElement).toBe(rows()[0]!.querySelector('.w-play'));
  });
});

describe("relink and the owner's data", () => {
  it('a typed name is kept; a fetched title goes back to the default so the next title can be fetched', () => {
    const typed: SavedItem[] = [{ kind: 'video', id: A, label: 'My pick', named: true }];
    const a = relinkSaved(typed, `video:${A}`, 'https://youtu.be/QqQqQqQqQq1');
    expect(a.ok && a.items[0]).toEqual({ kind: 'video', id: 'QqQqQqQqQq1', label: 'My pick', named: true });
    const fetched: SavedItem[] = [{ kind: 'video', id: A, label: 'Old fetched title' }];
    const b = relinkSaved(fetched, `video:${A}`, 'https://youtu.be/QqQqQqQqQq1');
    expect(b.ok && b.items[0]).toEqual({ kind: 'video', id: 'QqQqQqQqQq1', label: 'YouTube video' });
  });

  it('rename marks a name as typed; records without the field still load', () => {
    localStorage.setItem(SAVED_KEY, JSON.stringify([{ kind: 'video', id: A, label: 'Old record' }]));
    resetWatch();
    expect(useWatchStore.getState().saved[0]!.named).toBeUndefined();
    act(() => useWatchStore.getState().rename(`video:${A}`, 'Typed'));
    expect(useWatchStore.getState().saved[0]).toEqual({ kind: 'video', id: A, label: 'Typed', named: true });
    resetWatch();
    expect(useWatchStore.getState().saved[0]!.named).toBe(true);
  });

  it('a pin on the old link moves to the new one and is saved', () => {
    localStorage.setItem(SAVED_KEY, JSON.stringify(LIST));
    localStorage.setItem(PINS_KEY, JSON.stringify([`video:${A}`, null, null]));
    resetWatch();
    resetPins();
    expect(useWatchStore.getState().relink(`video:${A}`, 'https://youtu.be/QqQqQqQqQq1')).toBeNull();
    expect(usePins.getState().places[0]).toBe('video:QqQqQqQqQq1');
    expect(JSON.parse(localStorage.getItem(PINS_KEY)!)[0]).toBe('video:QqQqQqQqQq1');
  });
});
